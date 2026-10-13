-- Stage 4: people of a case (names only) for whoever can read the case;
-- nothing for a department the case is not assigned to. Fictitious data.
begin;
select plan(5);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

create temp table m on commit drop as
  select id from public.mentions where org_id = '00000000-0000-4000-a000-000000000001'
    and id not in (select mention_id from public.tickets) order by published_at, id limit 1;
grant select on m to authenticated;

select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
create temp table c on commit drop as select public.create_case('00000000-0000-4000-a000-000000000001', array[(select id from m)], 'Bache en avenida') as id;
grant select on c to authenticated;
select public.transition_case((select id from c), 'assigned', null, '00000000-0000-4000-b000-000000000001', '{}', now() + interval '2 days');
select public.update_case((select id from c), jsonb_build_object('responsible_user_id', '00000000-0000-4000-d000-000000000003'));
select ok(exists (select 1 from public.case_people((select id from c)) where user_id = '00000000-0000-4000-d000-000000000003' and is_responsible),
  'comunicación sees who is responsible');
select ok(not exists (select 1 from public.case_people((select id from c)) p where p.name like '%@%'), 'names only, never e-mails');
reset role;

select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;
select ok(exists (select 1 from public.case_people((select id from c))), 'the assigned department sees its people');
reset role;

select pg_temp.login('00000000-0000-4000-d000-000000000004');
set local role authenticated;
select is((select count(*) from public.case_people((select id from c))), 0::bigint, 'another department sees nobody');
reset role;

select pg_temp.login('00000000-0000-4000-d000-000000000011');
set local role authenticated;
select is((select count(*) from public.case_people((select id from c))), 0::bigint, 'nor another municipality');
reset role;

select * from finish();
rollback;
