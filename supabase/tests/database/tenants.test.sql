-- Two municipalities from the seed (A: San Andrés, B: Municipio de Prueba B):
-- every role sees only its own municipality, and dependencia only what was
-- routed to its department.
begin;
select plan(13);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.orgs_seen(p_table text) returns text language plpgsql as $$
declare r text;
begin
  execute format('select string_agg(distinct org_id::text, '','') from public.%I', p_table) into r;
  return r;
end $$;

-- Municipality B, one login per role ------------------------------------------
select pg_temp.login('00000000-0000-4000-d000-000000000011'); -- admin B
set local role authenticated;
select is(pg_temp.orgs_seen('mentions'), '00000000-0000-4000-a000-00000000000b', 'admin B sees only B mentions');
select is(pg_temp.orgs_seen('memberships'), '00000000-0000-4000-a000-00000000000b', 'admin B manages only B members');
select is((select count(*)::int from public.organizations), 1, 'admin B sees one municipality');

select pg_temp.login('00000000-0000-4000-d000-000000000012'); -- comunicacion B
select is((select count(*)::int from public.mentions), 3, 'comunicacion B sees the 3 B mentions');
select is(pg_temp.orgs_seen('tickets'), '00000000-0000-4000-a000-00000000000b', 'and only B tickets');

select pg_temp.login('00000000-0000-4000-d000-000000000013'); -- dependencia B
select is((select count(*)::int from public.mentions), 1, 'dependencia B sees only the mention routed to its department');
select is((select count(*)::int from public.tickets where department_id = '00000000-0000-4000-b000-000000000011'), 1,
  'and its ticket');

select pg_temp.login('00000000-0000-4000-d000-000000000014'); -- lectura B
select is((select count(*)::int from public.mentions), 3, 'lectura B reads the B mentions');
update public.mentions set triage = 'discarded';
reset role;
select is((select count(*)::int from public.mentions where org_id = '00000000-0000-4000-a000-00000000000b' and triage = 'discarded'), 0,
  'lectura B cannot change them');

-- Municipality A never sees B ------------------------------------------------
select pg_temp.login('00000000-0000-4000-d000-000000000001'); -- admin A
set local role authenticated;
select is((select count(*)::int from public.mentions where org_id = '00000000-0000-4000-a000-00000000000b'), 0,
  'admin A sees nothing of B');
select throws_ok($$ select public.dashboard_stats('00000000-0000-4000-a000-00000000000b', now() - interval '7 days', now()) $$,
  '42501', null, 'nor its dashboard');
select pg_temp.login('00000000-0000-4000-d000-000000000002'); -- comunicacion A
select is(public.route_mentions(array['00000000-0000-4000-f200-000000000002'::uuid],
  '00000000-0000-4000-b000-000000000011', now() + interval '1 day'), 0,
  'comunicacion A cannot route a B mention (it is invisible: nothing is routed)');
reset role;
select is((select count(*)::int from public.tickets where mention_id = '00000000-0000-4000-f200-000000000002'), 0,
  'and no ticket appears in B');

select * from finish();
rollback;
