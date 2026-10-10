-- Map of colonias: per-colonia stats and the colonia panel, org-wide readers only.
begin;
select plan(9);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- Expected numbers straight from the tables (superuser).
create temporary table expected on commit drop as
select c.neighborhood_id as id, count(*)::int as total,
  (count(*) filter (where c.intent in ('queja', 'denuncia')))::int as complaints
from public.mentions m join public.classifications c on c.mention_id = m.id
where m.org_id = '00000000-0000-4000-a000-000000000001' and m.published_at >= now() - interval '30 days'
  and c.neighborhood_id is not null
group by 1;
grant select on expected to authenticated;

select pg_temp.login('00000000-0000-4000-d000-000000000005');
set local role authenticated;

create temporary table got on commit drop as
select (n ->> 'id')::uuid as id, (n ->> 'total')::int as total, (n ->> 'complaints')::int as complaints, n
from jsonb_array_elements(public.map_stats('00000000-0000-4000-a000-000000000001',
  now() - interval '30 days', now() + interval '1 hour', now() - interval '60 days') -> 'neighborhoods') n;

select is((select count(*) from got g join expected e using (id) where g.total = e.total and g.complaints = e.complaints),
  (select count(*) from expected), 'lectura gets mentions and complaints of every colonia');
select ok((select bool_and(jsonb_array_length(n -> 'topics') between 1 and 3) from got), 'each colonia carries its top topics');
select is(
  (public.map_stats('00000000-0000-4000-a000-000000000001', now() - interval '30 days', now() + interval '1 hour',
     now() - interval '60 days', p_sentiment => 'negative') -> 'neighborhoods' -> 0 ->> 'positive')::int,
  0, 'the sentiment filter leaves only that sentiment');
select is(
  (select sum((n ->> 'total')::int)::int from jsonb_array_elements(public.map_stats('00000000-0000-4000-a000-000000000001',
     now() - interval '30 days', now() + interval '1 hour', now() - interval '60 days', p_topic => 'drenaje') -> 'neighborhoods') n),
  (select count(*)::int from public.mentions m join public.classifications c on c.mention_id = m.id
   where c.topic = 'drenaje' and c.neighborhood_id is not null and m.published_at >= now() - interval '30 days'),
  'the topic filter counts only that topic');

select is(
  (public.neighborhood_detail('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-c000-000000000001',
     now() - interval '30 days', now() + interval '1 hour') -> 'totals' ->> 'mentions')::int,
  (select total from expected where id = '00000000-0000-4000-c000-000000000001'), 'the panel totals match the map');
select ok(
  jsonb_array_length(public.neighborhood_detail('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-c000-000000000001',
     now() - interval '30 days', now() + interval '1 hour') -> 'latest') between 1 and 5,
  'and lists the latest mentions');
select ok(
  not (public.neighborhood_detail('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-c000-000000000001',
     now() - interval '30 days', now() + interval '1 hour') -> 'latest' -> 0 ? 'author'),
  'without authors');

reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;
select throws_ok(
  $$ select public.map_stats('00000000-0000-4000-a000-000000000001', now() - interval '7 days', now(), now() - interval '14 days') $$,
  '42501', null, 'dependencia cannot read the org-wide map');
select throws_ok(
  $$ select public.neighborhood_detail('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-c000-000000000001', now() - interval '7 days', now()) $$,
  '42501', null, 'nor a colonia panel');

reset role;
select * from finish();
rollback;
