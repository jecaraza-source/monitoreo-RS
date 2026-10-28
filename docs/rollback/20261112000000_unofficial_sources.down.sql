-- Rollback of 20261112000000_unofficial_sources.sql.
-- Postgres cannot drop enum values; this pauses those sources and removes the
-- guard (the values stay unused, harmless). Mentions already read are kept.
begin;
update public.sources set is_active = false where type::text in ('rss_bridge', 'apify');
drop trigger if exists guard_unofficial_source on public.sources;
drop function if exists private.guard_unofficial_source();
delete from supabase_migrations.schema_migrations where version = '20261112000000';
commit;
