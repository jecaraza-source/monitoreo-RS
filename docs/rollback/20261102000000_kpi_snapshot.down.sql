-- Rollback of 20261102000000_kpi_snapshot.sql (stage 9).
--
-- Run it only together with reverting the app (the stage 9 app calls
-- kpi_snapshot and report_snapshot, and writes report versions).
--
-- Before running it, export the report versions (revisions are kept as
-- separate reports; only the link between them is lost):
--   copy (select id, version, previous_version_id, kpi_version, snapshot_at from public.reports
--         where previous_version_id is not null or kpi_version is not null) to stdout with csv header;
-- Approved reports keep their frozen facts and text.

begin;

drop function if exists public.report_snapshot(uuid, timestamptz, timestamptz, timestamptz, timestamptz, text);
drop function if exists public.report_context(uuid, timestamptz, timestamptz, text);
drop function if exists public.kpi_snapshot(uuid, timestamptz, timestamptz, timestamptz, timestamptz, text);
drop function if exists private.kpi_departments(uuid, timestamptz, timestamptz, timestamptz);
drop function if exists private.kpi_attention(uuid, timestamptz, timestamptz, timestamptz);
drop function if exists private.cycle_steps(uuid, timestamptz, timestamptz);
drop function if exists private.case_overdue_at(public.case_status, timestamptz, timestamptz, timestamptz);
drop function if exists private.case_is_open(public.case_status);
drop function if exists private.case_states_at(uuid, timestamptz);
drop function if exists private.kpi_conversation(uuid, timestamptz, timestamptz);

drop trigger if exists reports_version_freeze on public.reports;
drop trigger if exists reports_version_guard on public.reports;
drop function if exists private.reports_freeze_guard();
drop function if exists private.reports_version_guard();
drop index if exists public.reports_previous_version_idx;
alter table public.reports
  drop column if exists snapshot_at,
  drop column if exists kpi_version,
  drop column if exists previous_version_id,
  drop column if exists version;

-- Editors write facts again (stage 1 column privileges).
grant insert (id, org_id, period, period_start, period_end, title, facts, content, model, recipients, schedule_id)
  on public.reports to authenticated;

delete from supabase_migrations.schema_migrations where version = '20261102000000';

commit;
