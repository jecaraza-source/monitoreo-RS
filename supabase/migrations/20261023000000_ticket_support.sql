-- Routing to several departments, and a guard for user management.
--
-- A mention can be routed to several departments at once: one leads it
-- (principal) and the others support it (apoyo), e.g. a water leak in a
-- street: Agua Potable leads and Obras Públicas repairs the pavement. Each
-- department keeps its own ticket, status and deadline.

alter table public.tickets add column is_primary boolean not null default true;

-- Mentions already routed to several departments: the first one leads.
update public.tickets t
set is_primary = false
where exists (
  select 1 from public.tickets o
  where o.mention_id = t.mention_id
    and (o.created_at, o.id) < (t.created_at, t.id)
);

create unique index tickets_one_primary_idx on public.tickets (mention_id) where is_primary;

-- route_mentions (security invoker) sets it; only editors may change it.
grant update (is_primary) on public.tickets to authenticated;

create function private.check_ticket_primary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and not private.has_role(new.org_id, '{admin,comunicacion}') then
    raise exception 'only admin and comunicacion choose the leading department' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function private.check_ticket_primary() from public, anon, authenticated;

create trigger tickets_check_primary
  before update of is_primary on public.tickets
  for each row when (old.is_primary is distinct from new.is_primary)
  execute function private.check_ticket_primary();

-- Routes mentions to a leading department and, optionally, supporting ones,
-- with one deadline. Routing again is a new assignment for every department
-- named (back to open, notified and followed up again); departments routed
-- before and not named keep their tickets, as support.
drop function public.route_mentions(uuid[], uuid, timestamptz);

create function public.route_mentions(
  p_mention_ids uuid[],
  p_department_id uuid,
  p_due_at timestamptz,
  p_support_ids uuid[] default '{}'
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
  v_support integer;
begin
  -- The previous leader (if another department) becomes support first, so the
  -- one-leader index never sees two.
  update public.tickets
  set is_primary = false
  where mention_id = any (p_mention_ids) and department_id <> p_department_id and is_primary;

  insert into public.tickets (org_id, mention_id, department_id, due_at, is_primary)
  select m.org_id, m.id, p_department_id, p_due_at, true
  from public.mentions m
  where m.id = any (p_mention_ids)
  on conflict (mention_id, department_id)
    do update set due_at = excluded.due_at, status = 'open', resolved_at = null, assigned_at = now(), is_primary = true,
                  whatsapp_notified_at = null, whatsapp_reminded_at = null, whatsapp_escalated_at = null;
  get diagnostics v_count = row_count;

  insert into public.tickets (org_id, mention_id, department_id, due_at, is_primary)
  select m.org_id, m.id, d.id, p_due_at, false
  from public.mentions m
  cross join (select distinct unnest(p_support_ids) as id) d
  where m.id = any (p_mention_ids) and d.id <> p_department_id
  on conflict (mention_id, department_id)
    do update set due_at = excluded.due_at, status = 'open', resolved_at = null, assigned_at = now(), is_primary = false,
                  whatsapp_notified_at = null, whatsapp_reminded_at = null, whatsapp_escalated_at = null;
  get diagnostics v_support = row_count;

  update public.mentions set triage = 'routed' where id = any (p_mention_ids);
  return v_count + v_support;
end;
$$;

revoke execute on function public.route_mentions(uuid[], uuid, timestamptz, uuid[]) from public, anon;
grant execute on function public.route_mentions(uuid[], uuid, timestamptz, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Users: an organization never loses its last administrator
-- ---------------------------------------------------------------------------

create function private.keep_last_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'admin'
     and (tg_op = 'DELETE' or new.role <> 'admin')
     and exists (select 1 from public.organizations o where o.id = old.org_id)
     and not exists (
       select 1 from public.memberships m
       where m.org_id = old.org_id and m.role = 'admin' and m.id <> old.id
     ) then
    raise exception 'an organization needs at least one admin' using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;
revoke execute on function private.keep_last_admin() from public, anon, authenticated;

create trigger memberships_keep_last_admin
  before update of role or delete on public.memberships
  for each row execute function private.keep_last_admin();
