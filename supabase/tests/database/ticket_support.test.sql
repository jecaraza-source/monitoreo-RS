-- Routing to a leading department and supporting ones.
begin;
select plan(10);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

create temporary table target as
select m.id from public.mentions m
where not exists (select 1 from public.tickets t where t.mention_id = m.id)
limit 1;
grant select on target to authenticated;

-- Agua leads a water leak; Obras and Servicios support it.
select pg_temp.login('00000000-0000-4000-d000-000000000002'); -- comunicacion
set local role authenticated;
select is(
  public.route_mentions(array[(select id from target)], '00000000-0000-4000-b000-000000000002', now() + interval '1 day',
    array['00000000-0000-4000-b000-000000000001', '00000000-0000-4000-b000-000000000003', '00000000-0000-4000-b000-000000000002']::uuid[]),
  3, 'one ticket for the leader and one per supporting department (the leader is not repeated)');
select is((select department_id from public.tickets where mention_id = (select id from target) and is_primary),
  '00000000-0000-4000-b000-000000000002'::uuid, 'Agua leads');
select is((select count(*)::int from public.tickets where mention_id = (select id from target) and not is_primary), 2,
  'the others support');

-- Obras moves its own ticket, but cannot make itself the leader.
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000003'); -- obras
set local role authenticated;
update public.tickets set status = 'in_progress'
where mention_id = (select id from target) and department_id = '00000000-0000-4000-b000-000000000001';
select throws_ok($$ update public.tickets set is_primary = true, status = 'open'
  where mention_id = (select id from target) and department_id = '00000000-0000-4000-b000-000000000001' $$,
  '42501', null, 'a department cannot change who leads');
reset role;
select is((select status::text from public.tickets where mention_id = (select id from target)
  and department_id = '00000000-0000-4000-b000-000000000001'), 'in_progress', 'each department keeps its own status');

-- Routing again with Obras as leader: Agua stays, now as support.
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select public.route_mentions(array[(select id from target)], '00000000-0000-4000-b000-000000000001', now() + interval '2 days');
reset role;
select is((select department_id from public.tickets where mention_id = (select id from target) and is_primary),
  '00000000-0000-4000-b000-000000000001'::uuid, 'a new leader takes over');
select is((select is_primary from public.tickets where mention_id = (select id from target)
  and department_id = '00000000-0000-4000-b000-000000000002'), false, 'the old leader keeps its ticket as support');
select is((select count(*)::int from public.tickets where mention_id = (select id from target)), 3, 'no ticket is lost');
select is((select status::text from public.tickets where mention_id = (select id from target)
  and department_id = '00000000-0000-4000-b000-000000000003'), 'open', 'departments not named again are untouched');

select throws_ok($$ insert into public.tickets (org_id, mention_id, department_id, is_primary)
  select org_id, id, '00000000-0000-4000-b000-000000000004', true from public.mentions where id = (select id from target) $$,
  '23505', null, 'a mention has one leader');

select * from finish();
rollback;
