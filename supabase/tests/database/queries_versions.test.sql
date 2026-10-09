-- save_query_version(): versioning and who may write; risk_terms visibility.
begin;
select plan(10);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- comunicacion saves a new version of the seeded "Servicios básicos" query.
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;

select is(
  (select version from public.save_query_version(
    '00000000-0000-4000-e000-000000000001', 'Servicios básicos', 'agua OR drenaje', '{"groups":[]}',
    '00000000-0000-4000-e110-000000000002')),
  2, 'a save creates version 2');
select is(
  (select count(*) from public.queries where lineage_id = '00000000-0000-4000-e110-000000000002' and is_active),
  1::bigint, 'exactly one version stays active');
select is(
  (select version from public.queries where lineage_id = '00000000-0000-4000-e110-000000000002' and is_active),
  2, 'the new version is the active one');
select is(
  (select expression from public.queries where lineage_id = '00000000-0000-4000-e110-000000000002' and version = 1),
  '(agua OR fuga* OR bache* OR basura OR luminaria* OR drenaje) AND NOT (garrafon* OR "agua mineral")',
  'previous versions are kept unchanged');
select is(
  (select version from public.save_query_version(
    '00000000-0000-4000-e000-000000000001', 'Nueva consulta', 'luz')),
  1, 'a null lineage starts a new query at version 1');

-- lectura can read but not save.
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000005');
set local role authenticated;
select throws_ok(
  $$ select public.save_query_version('00000000-0000-4000-e000-000000000001', 'x', 'x', null, '00000000-0000-4000-e110-000000000002') $$,
  '42501', null, 'lectura cannot save versions');

-- dependencia cannot even see the project.
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;
select throws_ok(
  $$ select public.save_query_version('00000000-0000-4000-e000-000000000001', 'x', 'x') $$,
  'P0002', 'project not found', 'dependencia cannot save into a project it cannot see');
select is((select count(*) from public.risk_terms), 0::bigint, 'dependencia does not read risk terms');

-- comunicacion reads risk terms but cannot change them.
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select is((select count(*) from public.risk_terms), 6::bigint, 'comunicacion reads risk terms');
select throws_ok(
  $$ insert into public.risk_terms (org_id, term, normalized) values ('00000000-0000-4000-a000-000000000001', 'x', 'x') $$,
  '42501', null, 'only admins edit risk terms');

reset role;
select * from finish();
rollback;
