-- User management: admins edit and remove members, but never the last admin.
begin;
select plan(4);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

select pg_temp.login('00000000-0000-4000-d000-000000000001'); -- admin (the only one)
set local role authenticated;
select throws_ok($$ update public.memberships set role = 'comunicacion' where user_id = '00000000-0000-4000-d000-000000000001' $$,
  '23514', null, 'the last admin cannot be demoted');
select lives_ok($$ update public.memberships set role = 'admin' where user_id = '00000000-0000-4000-d000-000000000002' $$,
  'admins promote another member');
select lives_ok($$ update public.memberships set role = 'comunicacion' where user_id = '00000000-0000-4000-d000-000000000001' $$,
  'with a second admin, the first can step down');
reset role;
delete from public.memberships where user_id = '00000000-0000-4000-d000-000000000005';
select is((select count(*)::int from public.memberships where user_id = '00000000-0000-4000-d000-000000000005'), 0,
  'a member can be removed');

select * from finish();
rollback;
