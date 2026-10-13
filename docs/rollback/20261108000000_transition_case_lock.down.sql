-- Restores transition_case without the row lock on its first read (20261030000000_case_attention).

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
    if not private.is_case_coordinator(v_case.org_id) then
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
    if not public.case_transition_allowed(v_from, 'assigned') then
      raise exception 'Un caso % no puede pasar a %.', v_from, p_to using errcode = '22023';
    end if;
    v_changes := jsonb_build_object('department_id', jsonb_build_array(v_case.department_id, p_department_id),
                                    'support_ids', to_jsonb(coalesce(p_support_ids, '{}')));
    update public.cases c
    set department_id = p_department_id, due_at = coalesce(p_due_at, due_at), assigned_at = now(),
        responsible_user_id = case when exists (select 1 from public.memberships m
                                                where m.org_id = c.org_id and m.user_id = c.responsible_user_id
                                                  and m.role = 'dependencia' and m.department_id = p_department_id)
                                   then c.responsible_user_id end,
        coordinator_user_id = coalesce(c.coordinator_user_id, (select auth.uid()))
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

  if public.case_transition_actor(v_from, p_to) = 'department' and (select auth.uid()) is not null
     and v_case.department_id is distinct from private.user_department(v_case.org_id) then
    v_changes := v_changes || '{"on_behalf": true}';
  end if;

  v_case := private.apply_case_transition(p_case_id, p_to, p_reason);
  perform private.log_case_event(v_case.org_id, p_case_id, case when v_from in ('closed', 'discarded') and p_to = 'in_review' then 'reopened' else 'status' end,
    v_from, p_to, p_reason, v_changes);
  return jsonb_build_object('status', v_case.status, 'ticket_ids', to_jsonb(v_tickets));
end;
$$;
