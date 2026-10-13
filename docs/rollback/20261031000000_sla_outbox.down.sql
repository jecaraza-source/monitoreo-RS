-- Rollback of 20261031000000_sla_outbox.sql (stage 7).
--
-- Run it only together with reverting the app (the stage 7 app calls
-- claim_outbox, enqueue_case_escalations, report jobs and the SLA RPCs).
--
-- Before running it, export what would be lost:
--   copy (select * from public.sla_versions) to stdout with csv header;
--   copy (select * from public.notification_events) to stdout with csv header;
--   copy (select * from public.outbox) to stdout with csv header;
--   copy (select * from public.outbox_attempts) to stdout with csv header;
--   copy (select * from public.report_jobs) to stdout with csv header;
-- Messages still pending in the outbox are not sent after the rollback.
-- sla_policies keeps the general attention hours (the stage 4/5 SLA).

begin;

drop trigger if exists organizations_seed_sla_targets on public.organizations;
drop function if exists private.seed_org_attention();

drop function if exists public.advance_report_job(uuid, text, text, uuid, text, boolean, timestamptz);
drop function if exists public.claim_report_jobs(text, integer, integer, timestamptz);
drop function if exists public.enqueue_report_job(uuid, uuid, public.report_period, date, date, boolean, text[]);
alter table public.reports drop column if exists job_id;
drop table if exists public.report_job_events;
drop table if exists public.report_jobs;

drop function if exists public.enqueue_case_escalations(timestamptz, integer);
drop function if exists private.notify_case_step(public.cases, text, timestamptz, text, text, boolean, timestamptz);
drop function if exists private.escalation_recipient(public.cases, text);

drop function if exists public.retry_outbox(uuid);
drop function if exists public.complete_outbox(uuid, text, integer, boolean, text, text, boolean, timestamptz);
drop function if exists public.claim_outbox(text, integer, integer, timestamptz);
drop function if exists private.outbox_hold(public.outbox, timestamptz);
drop function if exists public.enqueue_outbox(uuid, text, text, text, text, jsonb, text, uuid, uuid, uuid, uuid);
drop table if exists public.outbox_attempts;
drop table if exists public.outbox;
drop table if exists public.notification_events;
drop table if exists public.notification_preferences;
drop table if exists public.notification_settings;

drop function if exists public.set_department_contacts(uuid, uuid, uuid);
drop trigger if exists memberships_release_department_head on public.memberships;
drop trigger if exists departments_check_head on public.departments;
drop function if exists private.release_department_head();
drop function if exists private.check_department_head();
alter table public.departments drop column if exists head_user_id;

-- Stage 6 assignment and the WhatsApp follow-ups, as they were.
create or replace function public.assign_case(
  p_case_id uuid,
  p_department_id uuid,
  p_due_at timestamptz,
  p_accept_due_at timestamptz,
  p_support_ids uuid[] default '{}',
  p_responsible_user_id uuid default null,
  p_commitment text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.cases;
  v_result jsonb;
begin
  select * into v_case from public.cases where id = p_case_id;
  if v_case.id is null or not private.is_case_coordinator(v_case.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_due_at is null or p_due_at <= now() then
    raise exception 'El compromiso de atención debe ser una fecha futura.' using errcode = '22023';
  end if;
  if p_accept_due_at is null or p_accept_due_at <= now() then
    raise exception 'El plazo de aceptación debe ser una fecha futura.' using errcode = '22023';
  end if;
  if p_accept_due_at > p_due_at then
    raise exception 'El plazo de aceptación debe terminar antes del compromiso de atención.' using errcode = '22023';
  end if;
  if p_responsible_user_id is not null and not exists (
    select 1 from public.memberships m
    where m.org_id = v_case.org_id and m.user_id = p_responsible_user_id and m.role = 'dependencia' and m.department_id = p_department_id) then
    raise exception 'La persona responsable debe ser de la dependencia asignada.' using errcode = '22023';
  end if;

  v_result := public.transition_case(p_case_id, 'assigned', p_reason, p_department_id, p_support_ids, p_due_at);

  update public.cases
  set accept_due_at = p_accept_due_at,
      commitment = nullif(btrim(p_commitment), ''),
      responsible_user_id = p_responsible_user_id
  where id = p_case_id;
  perform private.log_case_event(v_case.org_id, p_case_id, 'assignment_terms', null, null, null,
    jsonb_build_object('responsible_user_id', p_responsible_user_id, 'accept_due_at', p_accept_due_at,
                       'due_at', p_due_at, 'commitment', nullif(btrim(p_commitment), '')));
  return v_result;
end;
$$;


create or replace function public.claim_whatsapp_followups(p_now timestamptz, p_limit integer)
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


drop function if exists public.approve_sla_version(uuid, text);
drop function if exists public.save_sla_config(uuid, jsonb, jsonb, jsonb);
drop function if exists public.sla_terms(uuid, text, public.priority, timestamptz);
drop function if exists private.sla_target(uuid, text, public.priority);
drop function if exists public.sla_deadline(uuid, timestamptz, numeric);
drop function if exists private.seed_sla_config(uuid);
drop function if exists private.sla_snapshot(uuid);

alter table public.cases drop constraint if exists cases_sla_version_fk;
alter table public.cases drop column if exists sla_version_id, drop column if exists sla_terms;
drop table if exists public.sla_versions;
drop table if exists public.sla_targets;
drop table if exists public.sla_holidays;
drop table if exists public.sla_calendars;

delete from supabase_migrations.schema_migrations where version = '20261031000000';
commit;
