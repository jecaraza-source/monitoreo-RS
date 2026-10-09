-- Dashboard rollup and payload: org-wide readers only.
begin;
select plan(6);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

select is(
  (select sum(mentions) from public.mention_stats_hourly where org_id = '00000000-0000-4000-a000-000000000001'),
  (select count(*) from public.mentions where org_id = '00000000-0000-4000-a000-000000000001'),
  'the rollup counts every mention once');

select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select is(
  (public.dashboard_stats('00000000-0000-4000-a000-000000000001', now() - interval '30 days', now() + interval '1 day') -> 'totals' ->> 'mentions')::int,
  (select count(*)::int from public.mentions), 'comunicacion gets the totals');
select ok(
  jsonb_array_length(public.dashboard_stats('00000000-0000-4000-a000-000000000001', now() - interval '30 days', now() + interval '1 day') -> 'series') > 0,
  'and the daily series');
select ok(
  public.dashboard_stats('00000000-0000-4000-a000-000000000001', now() - interval '30 days', now(), 'day', false) ? 'totals'
  and not public.dashboard_stats('00000000-0000-4000-a000-000000000001', now() - interval '30 days', now(), 'day', false) ? 'series',
  'p_detail = false returns only totals');
select throws_ok(
  $$ select public.refresh_mention_stats() $$, '42501', null, 'authenticated users cannot refresh the rollup');

reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;
select throws_ok(
  $$ select public.dashboard_stats('00000000-0000-4000-a000-000000000001', now() - interval '7 days', now()) $$,
  '42501', null, 'dependencia cannot read the org dashboard');

reset role;
select * from finish();
rollback;
