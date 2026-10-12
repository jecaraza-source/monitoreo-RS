-- WhatsApp channel, phase 3: follow-up of routed mentions. A reminder to the
-- department's responsible at 75% of the deadline, an escalation when it
-- expires (to the responsible and to the org's escalation contact), and
-- WhatsApp alert recipients chosen among the officials who accepted.

-- When the current assignment started (routing again restarts it), and which
-- follow-ups already went out for it.
alter table public.tickets
  add column assigned_at timestamptz not null default now(),
  add column whatsapp_reminded_at timestamptz,
  add column whatsapp_escalated_at timestamptz;
update public.tickets set assigned_at = created_at;

-- Tickets already overdue or past 75% when this ships are not followed up:
-- the first run would otherwise send the whole backlog at once.
update public.tickets
set whatsapp_reminded_at = now(),
    whatsapp_escalated_at = case when due_at <= now() then now() end
where status in ('open', 'in_progress')
  and due_at is not null
  and created_at + (due_at - created_at) * 0.75 <= now();

-- Routing again is a new assignment: new deadline, notified and followed up again.
create or replace function public.route_mentions(p_mention_ids uuid[], p_department_id uuid, p_due_at timestamptz)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.tickets (org_id, mention_id, department_id, due_at)
  select m.org_id, m.id, p_department_id, p_due_at
  from public.mentions m
  where m.id = any (p_mention_ids)
  on conflict (mention_id, department_id)
    do update set due_at = excluded.due_at, status = 'open', resolved_at = null, assigned_at = now(),
                  whatsapp_notified_at = null, whatsapp_reminded_at = null, whatsapp_escalated_at = null;
  get diagnostics v_count = row_count;

  update public.mentions set triage = 'routed' where id = any (p_mention_ids);
  return v_count;
end;
$$;

grant update (assigned_at, whatsapp_reminded_at, whatsapp_escalated_at) on public.tickets to authenticated;

-- ---------------------------------------------------------------------------
-- Escalation contact: who hears about expired turns (one per org)
-- ---------------------------------------------------------------------------

create table public.whatsapp_settings (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  -- References auth.users, not memberships (same reason as departments.responsible_user_id).
  escalation_user_id uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.whatsapp_settings enable row level security;
create policy "admins and comunicacion read whatsapp settings" on public.whatsapp_settings
  for select to authenticated using ((select private.has_role(org_id, '{admin,comunicacion}')));
create policy "admins write whatsapp settings" on public.whatsapp_settings
  for all to authenticated
  using ((select private.has_role(org_id, '{admin}')))
  with check ((select private.has_role(org_id, '{admin}')));
revoke all on public.whatsapp_settings from anon;

create trigger audit_whatsapp_settings after insert or update or delete on public.whatsapp_settings
  for each row execute function private.audit_row();

-- The escalation contact sees every ticket: admin or comunicacion.
create function private.check_escalation_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.escalation_user_id is not null and not exists (
    select 1 from public.memberships m
    where m.org_id = new.org_id and m.user_id = new.escalation_user_id and m.role in ('admin', 'comunicacion')
  ) then
    raise exception 'the escalation contact must be admin or comunicacion' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function private.check_escalation_user() from public, anon, authenticated;

create trigger whatsapp_settings_check_escalation
  before insert or update of escalation_user_id on public.whatsapp_settings
  for each row execute function private.check_escalation_user();

create function private.release_escalation_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.whatsapp_settings s
  set escalation_user_id = null, updated_at = now()
  where s.org_id = old.org_id
    and s.escalation_user_id = old.user_id
    and (tg_op = 'DELETE' or new.role not in ('admin', 'comunicacion'));
  return null;
end;
$$;
revoke execute on function private.release_escalation_user() from public, anon, authenticated;

create trigger memberships_release_escalation_user
  after update of role or delete on public.memberships
  for each row execute function private.release_escalation_user();

-- ---------------------------------------------------------------------------
-- Follow-ups due now, claimed atomically (overlapping cron runs never send twice)
-- ---------------------------------------------------------------------------

-- 'reminder': 75% of the time between assignment and deadline has passed.
-- 'overdue': the deadline passed (in the last 3 days; older ones are stale).
create function public.claim_whatsapp_followups(p_now timestamptz, p_limit integer)
returns table (ticket_id uuid, kind text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with due as (
    select t.id, case when t.due_at <= p_now then 'overdue' else 'reminder' end as kind
    from public.tickets t
    where t.status in ('open', 'in_progress')
      and t.due_at is not null
      and (
        (t.due_at <= p_now and t.due_at > p_now - interval '3 days' and t.whatsapp_escalated_at is null)
        or (t.due_at > p_now and t.whatsapp_reminded_at is null
            and t.assigned_at + (t.due_at - t.assigned_at) * 0.75 <= p_now)
      )
    order by t.due_at
    limit least(greatest(p_limit, 1), 100)
    for update skip locked
  )
  update public.tickets t
  set whatsapp_reminded_at = coalesce(t.whatsapp_reminded_at, p_now),
      whatsapp_escalated_at = case when due.kind = 'overdue' then p_now else t.whatsapp_escalated_at end
  from due
  where t.id = due.id
  returning t.id, due.kind;
end;
$$;

revoke execute on function public.claim_whatsapp_followups(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.claim_whatsapp_followups(timestamptz, integer) to service_role;

-- ---------------------------------------------------------------------------
-- WhatsApp alert recipients: officials with a number, for the rule form
-- ---------------------------------------------------------------------------

-- Admin and comunicacion edit alert rules but only admins read numbers: this
-- gives them who has WhatsApp (email) and its status, never the number.
create function public.whatsapp_recipients(p_org_id uuid)
returns table (user_id uuid, email text, status public.whatsapp_contact_status)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_role(p_org_id, '{admin,comunicacion}') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
  select c.user_id, u.email::text, c.status
  from public.whatsapp_contacts c
  join auth.users u on u.id = c.user_id
  where c.org_id = p_org_id
  order by u.email;
end;
$$;

revoke execute on function public.whatsapp_recipients(uuid) from public, anon;
grant execute on function public.whatsapp_recipients(uuid) to authenticated;
