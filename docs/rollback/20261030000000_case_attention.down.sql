-- Rollback of 20261030000000_case_attention.sql (stage 6).
--
-- Run it only together with reverting the app (the stage 6 app calls
-- assign_case, validate_case, reopen_case, add_case_update and reads the new tables).
--
-- Before running it, export what people wrote (it is dropped with the tables):
--   copy (select * from public.case_updates) to stdout with csv header;
--   copy (select * from public.case_evidence) to stdout with csv header;
--   copy (select * from public.case_validations) to stdout with csv header;
--   copy (select * from public.case_tasks) to stdout with csv header;
--   copy (select * from public.case_milestones) to stdout with csv header;
-- The files in the "case-evidence" bucket are NOT deleted here: download them
-- or remove them from the Storage dashboard (or the Storage API) on purpose.
-- Cases keep their state, history (case_events) and notes.

begin;

drop view if exists public.case_cycle_times;

drop function if exists public.reopen_case(uuid, text, text[]);
drop function if exists public.validate_case(uuid, text, text, boolean);
drop function if exists public.add_case_update(uuid, text, text, uuid, text[]);
drop function if exists private.add_case_update(public.cases, text, text, uuid, text[], text);
drop function if exists public.update_case_task(uuid, public.case_task_status, text);
drop function if exists public.add_case_task(uuid, uuid, text, text, timestamptz, uuid);
drop function if exists public.department_people(uuid);
drop function if exists public.case_areas(uuid);
drop function if exists public.assign_case(uuid, uuid, timestamptz, timestamptz, uuid[], uuid, text, text);

drop policy if exists "upload case evidence" on storage.objects;
drop policy if exists "read case evidence files" on storage.objects;
drop policy if exists "remove unregistered case evidence" on storage.objects;
drop function if exists private.can_upload_case_evidence(text);
drop function if exists private.case_evidence_registered(text);

drop table if exists public.case_validations;
drop table if exists public.case_evidence;
drop table if exists public.case_updates;
drop table if exists public.case_tasks;
drop type if exists public.case_task_status;

drop trigger if exists cases_milestone on public.cases;
drop trigger if exists cases_cycle on public.cases;
drop function if exists private.case_milestone();
drop function if exists private.case_cycle();
drop table if exists public.case_milestones;

-- Stage 4 workflow and stage 5 inbox, as they were.
create or replace function private.apply_case_transition(p_case_id uuid, p_to public.case_status, p_reason text)
returns public.cases
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.cases;
  v_editor boolean;
  v_dept boolean;
begin
  select * into v_case from public.cases where id = p_case_id for update;
  if v_case.id is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_editor := private.has_role(v_case.org_id, '{admin,comunicacion}') or (select auth.uid()) is null;
  v_dept := v_case.department_id is not null and v_case.department_id = private.user_department(v_case.org_id)
            and private.has_role(v_case.org_id, '{dependencia}');
  if not (v_editor or (v_dept and public.case_transition_by_department(v_case.status, p_to))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not public.case_transition_allowed(v_case.status, p_to) then
    raise exception 'Un caso % no puede pasar a %.', v_case.status, p_to using errcode = '22023';
  end if;
  if public.case_transition_needs_reason(v_case.status, p_to) and nullif(btrim(p_reason), '') is null then
    raise exception 'Este cambio requiere un motivo.' using errcode = '22023';
  end if;
  if p_to = 'assigned' and v_case.department_id is null then
    raise exception 'Elige la dependencia responsable.' using errcode = '22023';
  end if;

  update public.cases
  set status = p_to,
      status_reason = nullif(btrim(p_reason), ''),
      accepted_at = case when p_to = 'accepted' then now() when p_to = 'assigned' then null else accepted_at end,
      resolved_at = case when p_to = 'resolved' then now() when p_to in ('in_progress', 'in_review', 'assigned') then null else resolved_at end,
      closed_at = case when p_to = 'closed' then now() when p_to = 'in_review' then null else closed_at end,
      updated_at = now()
  where id = p_case_id
  returning * into v_case;

  perform private.sync_case_tickets(v_case);
  return v_case;
end;
$$;


create or replace function public.transition_case(
  p_case_id uuid,
  p_to public.case_status,
  p_reason text default null,
  p_department_id uuid default null,
  p_support_ids uuid[] default '{}',
  p_due_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.cases;
  v_from public.case_status;
  v_tickets uuid[] := '{}';
  v_changes jsonb := '{}';
begin
  select * into v_case from public.cases where id = p_case_id;
  if v_case.id is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_from := v_case.status;
  if p_to = 'merged' then
    raise exception 'Para fusionar usa merge_cases.' using errcode = '22023';
  end if;

  if p_to = 'assigned' then
    if not private.has_role(v_case.org_id, '{admin,comunicacion}') then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    if p_department_id is null or not exists (select 1 from public.departments d where d.id = p_department_id and d.org_id = v_case.org_id) then
      raise exception 'Elige la dependencia responsable.' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(coalesce(p_support_ids, '{}')) s
               where not exists (select 1 from public.departments d where d.id = s and d.org_id = v_case.org_id)) then
      raise exception 'Dependencia de apoyo inválida.' using errcode = '22023';
    end if;
    if v_case.primary_mention_id is null then
      raise exception 'El caso no tiene mención principal.' using errcode = '22023';
    end if;
    v_changes := jsonb_build_object('department_id', jsonb_build_array(v_case.department_id, p_department_id),
                                    'support_ids', to_jsonb(coalesce(p_support_ids, '{}')));
    update public.cases
    set department_id = p_department_id, due_at = coalesce(p_due_at, due_at), assigned_at = now()
    where id = p_case_id;

    -- Assignment tickets (route_mentions' rules, tied to the case).
    perform set_config('app.case_sync', 'on', true);
    update public.tickets set is_primary = false
    where mention_id = v_case.primary_mention_id and department_id <> p_department_id and is_primary;
    -- A replaced lead department is done with it.
    update public.tickets set status = 'closed', resolved_at = coalesce(resolved_at, now())
    where case_id = p_case_id and mention_id = v_case.primary_mention_id
      and department_id <> p_department_id and not (department_id = any (coalesce(p_support_ids, '{}'))) and status <> 'closed';

    with lead as (
      insert into public.tickets (org_id, mention_id, department_id, due_at, is_primary, case_id)
      values (v_case.org_id, v_case.primary_mention_id, p_department_id, coalesce(p_due_at, v_case.due_at), true, p_case_id)
      on conflict (mention_id, department_id) do update
        set due_at = excluded.due_at, status = 'open', resolved_at = null, assigned_at = now(), is_primary = true, case_id = p_case_id,
            whatsapp_notified_at = null, whatsapp_reminded_at = null, whatsapp_escalated_at = null
      returning id
    ), support as (
      insert into public.tickets (org_id, mention_id, department_id, due_at, is_primary, case_id)
      select v_case.org_id, v_case.primary_mention_id, s, coalesce(p_due_at, v_case.due_at), false, p_case_id
      from (select distinct unnest(coalesce(p_support_ids, '{}')) as s) x where s <> p_department_id
      on conflict (mention_id, department_id) do update
        set due_at = excluded.due_at, status = 'open', resolved_at = null, assigned_at = now(), is_primary = false, case_id = p_case_id,
            whatsapp_notified_at = null, whatsapp_reminded_at = null, whatsapp_escalated_at = null
      returning id
    )
    select array(select id from lead union all select id from support) into v_tickets;
    perform set_config('app.case_sync', '', true);
    update public.mentions set triage = 'routed' where id in (select mention_id from public.case_mentions where case_id = p_case_id);
  end if;

  v_case := private.apply_case_transition(p_case_id, p_to, p_reason);
  perform private.log_case_event(v_case.org_id, p_case_id, case when v_from in ('closed', 'discarded') and p_to = 'in_review' then 'reopened' else 'status' end,
    v_from, p_to, p_reason, v_changes);
  return jsonb_build_object('status', v_case.status, 'ticket_ids', to_jsonb(v_tickets));
end;
$$;


create or replace function public.inbox_items(p_org_id uuid, p_filters jsonb default '{}')
returns table (
  kind text, id uuid, urgency integer, due_at timestamptz, item_at timestamptz,
  is_new boolean, is_urgent boolean, is_unassigned boolean, awaiting_acceptance boolean,
  is_overdue boolean, awaiting_validation boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with f as (
    select
      nullif(p_filters ->> 'q', '') as q,
      (p_filters ->> 'from')::date as day_from,
      (p_filters ->> 'to')::date as day_to,
      (p_filters ->> 'source')::uuid as source_id,
      (p_filters ->> 'sentiment')::public.sentiment as sentiment,
      nullif(p_filters ->> 'topic', '') as topic,
      (p_filters ->> 'department')::uuid as department_id,
      (p_filters ->> 'neighborhood')::uuid as neighborhood_id,
      (p_filters ->> 'priority')::public.priority as priority,
      (p_filters ->> 'author')::uuid as author_id,
      (p_filters ->> 'mention')::uuid as mention_id
  ),
  mention_items as (
    select
      m.id, m.published_at, m.triage, m.status, c.priority, c.severity, c.needs_attention, c.intent,
      t.status as ticket_status, t.due_at as ticket_due, (t.id is not null) as routed
    from public.mentions m
    cross join f
    left join public.classifications c on c.mention_id = m.id
    left join lateral (
      select tk.status, tk.due_at, tk.id from public.tickets tk
      where tk.mention_id = m.id and tk.case_id is null
      order by tk.is_primary desc, tk.created_at limit 1
    ) t on true
    where m.org_id = p_org_id
      and m.triage <> 'discarded'
      and not exists (select 1 from public.case_mentions cm where cm.mention_id = m.id)
      and (f.q is null or m.search @@ websearch_to_tsquery('public.spanish_unaccent', f.q))
      and (f.day_from is null or m.published_at >= (f.day_from::timestamp at time zone 'America/Mexico_City'))
      and (f.day_to is null or m.published_at < ((f.day_to + 1)::timestamp at time zone 'America/Mexico_City'))
      and (f.source_id is null or m.source_id = f.source_id)
      and (f.author_id is null or m.author_id = f.author_id)
      and (f.mention_id is null or m.id = f.mention_id)
      and (f.sentiment is null or c.sentiment = f.sentiment)
      and (f.topic is null or c.topic = f.topic)
      and (f.department_id is null or c.department_id = f.department_id)
      and (f.neighborhood_id is null or c.neighborhood_id = f.neighborhood_id)
      and (f.priority is null or c.priority = f.priority)
  ),
  case_items as (
    select k.id, k.status, k.priority, k.department_id, k.due_at, k.opened_at
    from public.cases k
    cross join f
    left join public.mentions pm on pm.id = k.primary_mention_id
    left join public.classifications pc on pc.mention_id = k.primary_mention_id
    where k.org_id = p_org_id
      and k.status not in ('merged', 'discarded', 'closed')
      and (f.q is null or k.title ilike '%' || f.q || '%' or pm.search @@ websearch_to_tsquery('public.spanish_unaccent', f.q))
      and (f.day_from is null or k.opened_at >= (f.day_from::timestamp at time zone 'America/Mexico_City'))
      and (f.day_to is null or k.opened_at < ((f.day_to + 1)::timestamp at time zone 'America/Mexico_City'))
      and (f.source_id is null or pm.source_id = f.source_id)
      and (f.author_id is null or pm.author_id = f.author_id)
      and (f.mention_id is null or exists (select 1 from public.case_mentions cm where cm.case_id = k.id and cm.mention_id = f.mention_id))
      and (f.sentiment is null or pc.sentiment = f.sentiment)
      and (f.topic is null or pc.topic = f.topic)
      and (f.department_id is null or k.department_id = f.department_id)
      and (f.neighborhood_id is null or k.neighborhood_id = f.neighborhood_id)
      and (f.priority is null or k.priority = f.priority)
  )
  select
    'mention', mi.id,
    case mi.priority when 'critical' then 3 when 'high' then 2 when 'medium' then 1 else 0 end
      + case when mi.severity = 'emergency' then 2 when mi.severity = 'high' then 1 else 0 end,
    case when mi.ticket_status in ('open', 'in_progress') then mi.ticket_due end,
    mi.published_at,
    mi.triage = 'new',
    (mi.priority in ('critical', 'high') or mi.severity in ('high', 'emergency'))
      and (mi.triage in ('new', 'reviewed') or mi.ticket_status in ('open', 'in_progress')),
    not mi.routed and mi.triage in ('new', 'reviewed') and mi.status = 'classified'
      and coalesce(mi.needs_attention, mi.intent in ('queja', 'denuncia', 'pregunta')),
    mi.ticket_status = 'open',
    mi.ticket_status in ('open', 'in_progress') and mi.ticket_due < now(),
    mi.ticket_status = 'resolved'
  from mention_items mi
  union all
  select
    'case', ci.id,
    case ci.priority when 'critical' then 3 when 'high' then 2 when 'medium' then 1 else 0 end,
    case when ci.status in ('assigned', 'accepted', 'in_progress') then ci.due_at end,
    ci.opened_at,
    ci.status = 'new',
    ci.priority in ('critical', 'high') and ci.status <> 'resolved',
    ci.status in ('new', 'in_review', 'returned'),
    ci.status = 'assigned',
    ci.status in ('assigned', 'accepted', 'in_progress') and ci.due_at < now(),
    ci.status = 'resolved'
  from case_items ci;
$$;


drop function if exists public.case_transition_actor(public.case_status, public.case_status);
drop function if exists private.is_case_lead(uuid, uuid);
drop function if exists private.is_case_coordinator(uuid);

alter table public.cases
  drop column if exists accept_due_at,
  drop column if exists commitment,
  drop column if exists coordinator_user_id,
  drop column if exists cycle,
  drop column if exists result;

delete from supabase_migrations.schema_migrations where version = '20261030000000';
commit;
