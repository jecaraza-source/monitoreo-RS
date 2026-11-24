-- Rollback of 20261113000000_critical_voices.sql. Read-only function: dropping it loses no data.
begin;
drop function if exists public.critical_voices(uuid, timestamptz, timestamptz, timestamptz, timestamptz, text);
delete from supabase_migrations.schema_migrations where version = '20261113000000';
commit;
