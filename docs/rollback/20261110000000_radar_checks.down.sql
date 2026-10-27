-- Rollback of 20261110000000_radar_checks.sql (Radar Social verification tools).
begin;
drop table if exists public.ci_checks;
drop function if exists private.ci_checks_guard();
drop table if exists public.ci_settings;
drop function if exists private.ci_settings_guard();
delete from supabase_migrations.schema_migrations where version = '20261110000000';
commit;
