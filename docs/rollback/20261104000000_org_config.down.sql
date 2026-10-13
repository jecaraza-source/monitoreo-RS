-- Rollback of stage 11 (20261104000000_org_config.sql).
-- Order: deploy the previous app version first, then run this script.
-- What is lost: case categories and capabilities, the retention policy and
-- holds, onboarding checks (their audit_log rows stay). Cases keep their
-- category text and deadlines (including any reapplied SLA).
begin;

drop trigger if exists audit_case_categories on public.case_categories;
drop trigger if exists audit_department_capabilities on public.department_capabilities;
drop trigger if exists audit_sla_calendars on public.sla_calendars;
drop trigger if exists audit_sla_holidays on public.sla_holidays;
drop trigger if exists audit_sla_targets on public.sla_targets;
drop trigger if exists audit_ai_limits on public.ai_limits;
drop trigger if exists audit_ai_invoices on public.ai_invoices;

drop function if exists public.reapply_sla(uuid, uuid[], text, boolean);
drop function if exists public.sla_reapply_preview(uuid, uuid[], boolean);
drop function if exists public.log_export(uuid, text, jsonb, integer);
drop function if exists public.retention_preview(uuid, integer);
drop function if exists public.purge_org_mentions(uuid, integer, integer, text);
drop function if exists private.retention_held(uuid, timestamptz);

drop table if exists public.onboarding_checks;
drop table if exists public.retention_holds;
drop function if exists private.guard_retention_hold();
drop table if exists public.retention_policies;
drop table if exists public.department_capabilities;
drop table if exists public.case_categories;

-- The global purge as it was before stage 11 (it did not protect cases).
create or replace function public.purge_old_mentions(p_months integer, p_batch integer default 5000)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz := now() - make_interval(months => p_months);
  v_deleted integer;
begin
  if p_months < 1 then
    raise exception 'retention must be at least 1 month' using errcode = '22023';
  end if;
  with doomed as (
    select id, org_id from public.mentions where published_at < v_cutoff order by published_at limit p_batch
  ), gone as (
    delete from public.mentions m using doomed d where m.id = d.id returning d.org_id
  ), counts as (
    select org_id, count(*)::integer as n from gone group by org_id
  ), logged as (
    insert into public.audit_log (org_id, actor_id, action, entity, entity_id, changes)
    select org_id, null, 'purge', 'mentions', null, jsonb_build_object('before', v_cutoff, 'months', p_months, 'deleted', n)
    from counts
    returning (changes ->> 'deleted')::integer as n
  )
  select coalesce(sum(n), 0) into v_deleted from logged;
  if v_deleted > 0 then
    delete from public.authors a
    where a.kind = 'citizen' and not exists (select 1 from public.mentions m where m.author_id = a.id);
  end if;
  return v_deleted;
end;
$$;

delete from supabase_migrations.schema_migrations where version = '20261104000000';
commit;
