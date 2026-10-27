-- Rollback of 20261109000000_counterintel.sql (Oficina de Contrainteligencia).
-- Drops the register and the grant; the audit log keeps its history.
begin;
drop function if exists public.ci_overview(uuid, timestamptz);
drop table if exists public.ci_reports;
drop function if exists private.ci_reports_guard();
drop function if exists public.can_view_counterintel(uuid);
drop function if exists private.can_edit_counterintel(uuid);
drop function if exists private.can_view_counterintel(uuid);
alter table public.memberships drop column if exists can_view_counterintel;
delete from supabase_migrations.schema_migrations where version = '20261109000000';
commit;
