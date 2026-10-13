-- Reversión de supabase/migrations/20261027000000_cases.sql.
-- Correr sólo junto con la reversión de la app (la app de la etapa 4 llama a
-- create_case, transition_case y compañía, y lee tickets.case_id).
--
-- Se conserva: todas las menciones, turnos (tickets), notas de menciones y su
-- estado actual. Los turnos creados al asignar casos se quedan como turnos
-- normales de su mención.
-- Se pierde: los casos, sus vínculos con menciones, su historial y sus notas.
-- Si hay que conservarlos, exportarlos antes (ver docs/etapa-4-casos.md).
begin;

-- Funciones previas (antes de casos): turnar sin casos, botones de WhatsApp
-- sobre el turno y visibilidad de dependencia sólo por turnos.
-- private.mention_routed_to_user: versión de 20261009000000_initial_schema.sql.
create or replace function private.mention_routed_to_user(p_org_id uuid, p_mention_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tickets t
    where t.org_id = p_org_id
      and t.mention_id = p_mention_id
      and t.department_id = private.user_department(p_org_id)
  );
$$;

-- private.author_visible_to_user: versión de 20261009000000_initial_schema.sql.
create or replace function private.author_visible_to_user(p_org_id uuid, p_author_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tickets t
    join public.mentions m on m.id = t.mention_id
    where t.org_id = p_org_id
      and m.author_id = p_author_id
      and t.department_id = private.user_department(p_org_id)
  );
$$;

-- public.route_mentions: versión de 20261023000000_ticket_support.sql.
create or replace function public.route_mentions(
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

-- public.whatsapp_ticket_action: versión de 20261020000000_whatsapp_tickets.sql.
create or replace function public.whatsapp_ticket_action(
  p_contact_id uuid,
  p_ticket_id uuid,
  p_status public.ticket_status default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact public.whatsapp_contacts;
  v_ticket public.tickets;
  v_member public.memberships;
  v_labels jsonb := '{"open":"Abierto","in_progress":"En proceso","resolved":"Resuelto","closed":"Cerrado"}';
begin
  select * into v_contact from public.whatsapp_contacts where id = p_contact_id and status = 'active';
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'inactive');
  end if;
  select * into v_ticket from public.tickets where id = p_ticket_id and org_id = v_contact.org_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  select * into v_member from public.memberships where org_id = v_contact.org_id and user_id = v_contact.user_id;
  if not found or not (
    v_member.role in ('admin', 'comunicacion')
    or (v_member.role = 'dependencia' and v_member.department_id = v_ticket.department_id)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  -- From here on, auth.uid() is the official: triggers stamp and audit them.
  perform set_config('request.jwt.claims', json_build_object('sub', v_contact.user_id, 'role', 'authenticated')::text, true);
  perform set_config('app.channel', 'whatsapp', true);

  if p_status is not null and p_status <> v_ticket.status then
    if v_ticket.status = 'closed' then
      return jsonb_build_object('ok', false, 'reason', 'closed', 'status', v_ticket.status);
    end if;
    update public.tickets
    set status = p_status,
        resolved_at = case when p_status in ('resolved', 'closed') then now() else null end
    where id = v_ticket.id;
    insert into public.mention_notes (org_id, mention_id, body)
    values (v_ticket.org_id, v_ticket.mention_id, format('Cambió el turno a «%s» desde WhatsApp.', v_labels ->> p_status::text));
  end if;

  if nullif(btrim(p_note), '') is not null then
    insert into public.mention_notes (org_id, mention_id, body)
    values (v_ticket.org_id, v_ticket.mention_id, left(btrim(p_note), 2000));
  end if;

  perform set_config('app.channel', '', true);
  return jsonb_build_object('ok', true, 'status', coalesce(p_status, v_ticket.status), 'mention_id', v_ticket.mention_id);
end;
$$;

drop trigger tickets_guard_case on public.tickets;
drop function private.guard_case_ticket();

drop function public.case_people(uuid);
drop function public.apply_ticket_backfill(uuid);
drop function public.simulate_ticket_backfill(uuid);
drop function private.ticket_backfill_plan(uuid);
drop function public.suggest_case_mentions(uuid, integer);
drop function public.merge_cases(uuid, uuid[], text);
drop function public.add_case_note(uuid, text, text);
drop function public.case_ticket_status(uuid, public.ticket_status);
drop function public.transition_case(uuid, public.case_status, text, uuid, uuid[], timestamptz);
drop function private.apply_case_transition(uuid, public.case_status, text);
drop function private.sync_case_tickets(public.cases);
drop function public.update_case(uuid, jsonb);
drop function public.case_remove_mention(uuid, uuid, text);
drop function public.case_add_mentions(uuid, uuid[], text);
drop function public.create_case(uuid, uuid[], text, text, text, uuid, public.priority);
drop function public.case_transition_by_department(public.case_status, public.case_status);
drop function public.case_transition_needs_reason(public.case_status, public.case_status);
drop function public.case_transition_allowed(public.case_status, public.case_status);
drop function private.next_case_number(uuid);
drop function private.log_case_event(uuid, uuid, text, public.case_status, public.case_status, text, jsonb, boolean);
drop function private.case_actor();

alter table public.tickets drop column case_id;

drop table public.case_notes;
drop table public.case_events;
drop table public.case_mentions;
drop table public.cases;
drop table public.case_counters;
drop function private.case_append_only();
drop function private.case_visible_to_department(uuid, uuid);
drop type public.case_status;

delete from supabase_migrations.schema_migrations where version = '20261027000000';
commit;
