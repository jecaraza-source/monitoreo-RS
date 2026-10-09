-- org_members() is only answered for the org's admins.
begin;
select plan(3);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

select pg_temp.login('00000000-0000-4000-d000-000000000001');
set local role authenticated;
select is((select count(*) from public.org_members('00000000-0000-4000-a000-000000000001')), 5::bigint,
  'admin lists every member with email');

reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select is((select count(*) from public.org_members('00000000-0000-4000-a000-000000000001')), 0::bigint,
  'comunicacion gets no member list');

reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;
select is((select count(*) from public.org_members('00000000-0000-4000-a000-000000000001')), 0::bigint,
  'dependencia gets no member list');

reset role;
select * from finish();
rollback;
