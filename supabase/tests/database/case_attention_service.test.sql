-- Stage 6, server side (service role, in its own file: plan caching would
-- hide privilege problems of triggers run by the service role). Cases moved
-- by the system still get their milestones, and the system cannot close a
-- case without validation either. Fictitious data.
begin;
select plan(4);

create temp table free on commit drop as
  select id from public.mentions m
  where m.org_id = '00000000-0000-4000-a000-000000000001'
    and not exists (select 1 from public.tickets t where t.mention_id = m.id)
    and not exists (select 1 from public.case_mentions cm where cm.mention_id = m.id)
  order by m.published_at, m.id limit 1;
create temp table ids (k text primary key, v uuid) on commit drop;
grant all on free, ids to service_role;

select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
insert into ids values ('c', public.create_case('00000000-0000-4000-a000-000000000001', array[(select id from free)], 'Caso del sistema'));
select lives_ok($$ select public.transition_case((select v from ids where k = 'c'), 'in_review') $$, 'the system moves a case');
select throws_ok($$ select public.transition_case((select v from ids where k = 'c'), 'closed') $$, '22023', null, 'but cannot jump to closed');
reset role;

select is((select array_agg(status::text order by id) from public.case_milestones where case_id = (select v from ids where k = 'c')),
  array['new', 'in_review'], 'its milestones are written');
select is((select array_agg(cycle) from public.case_milestones where case_id = (select v from ids where k = 'c')), array[1, 1], 'in the first cycle');

select * from finish();
rollback;
