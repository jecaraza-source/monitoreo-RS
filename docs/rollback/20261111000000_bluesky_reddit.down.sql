-- Rollback of 20261111000000_bluesky_reddit.sql.
-- Postgres cannot drop enum values; this pauses those sources instead and the
-- values stay unused (harmless). Mentions already read are kept.
begin;
update public.sources set is_active = false where type::text in ('bluesky', 'reddit');
delete from supabase_migrations.schema_migrations where version = '20261111000000';
commit;
