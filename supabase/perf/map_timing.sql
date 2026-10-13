-- Times of the map's queries as an authenticated member (run after map_scale.sql).
--   psql "$DB_URL" -v user=00000000-0000-4000-d000-000000000002 -f supabase/perf/map_timing.sql
\set ON_ERROR_STOP on
\if :{?user} \else \set user 00000000-0000-4000-d000-000000000002 \endif
\timing on
begin;
select set_config('request.jwt.claims', json_build_object('sub', :'user', 'role', 'authenticated')::text, true);
set local role authenticated;
\echo '-- catalog (neighborhoods with geojson)'
select count(*), pg_size_pretty(sum(pg_column_size(geojson))::bigint) as geojson from public.neighborhoods where org_id = '00000000-0000-4000-a000-000000000001';
\echo '-- map_case_rows, open, 30 days'
select count(*), pg_size_pretty(sum(pg_column_size(r.*))::bigint) as rows_size
from public.map_case_rows('00000000-0000-4000-a000-000000000001', jsonb_build_object('from', (now() - interval '30 days')::date, 'to', now()::date, 'status', 'open')) r;
\echo '-- map_case_rows, all states, 30 days'
select count(*) from public.map_case_rows('00000000-0000-4000-a000-000000000001', jsonb_build_object('from', (now() - interval '30 days')::date, 'to', now()::date, 'status', 'all'));
\echo '-- map_stats, 30 days'
select pg_size_pretty(pg_column_size(public.map_stats('00000000-0000-4000-a000-000000000001', now() - interval '30 days', now(), now() - interval '60 days', null, null, null))::bigint);
\echo '-- map_unlocated_mentions, 30 days'
select (public.map_unlocated_mentions('00000000-0000-4000-a000-000000000001', now() - interval '30 days', now(), null, null, null, 50)) ->> 'count';
rollback;
