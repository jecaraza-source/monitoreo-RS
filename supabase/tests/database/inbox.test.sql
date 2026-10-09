-- Inbox permissions: triage, routing, notes, corrections and source labels.
begin;
select plan(14);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- A fresh, unrouted mention to work with.
create temporary table target as
select m.id from public.mentions m
where not exists (select 1 from public.tickets t where t.mention_id = m.id)
  and exists (select 1 from public.classifications c where c.mention_id = m.id)
limit 1;
grant select on target to authenticated;

-- comunicacion ---------------------------------------------------------------
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;

select is(
  public.route_mentions(array[(select id from target)], '00000000-0000-4000-b000-000000000001', now() + interval '2 days'),
  1, 'comunicacion routes a mention to Obras');
select is((select triage::text from public.mentions where id = (select id from target)), 'routed', 'routing marks the mention as routed');
select is((select created_by from public.tickets where mention_id = (select id from target)),
  '00000000-0000-4000-d000-000000000002'::uuid, 'the ticket records who routed it');

update public.classifications set sentiment = 'positive', corrected_by = null where mention_id = (select id from target);
select is((select corrected_by from public.classifications where mention_id = (select id from target)),
  '00000000-0000-4000-d000-000000000002'::uuid, 'corrected_by is stamped with the real user');
select ok((select corrected_at is not null from public.classifications where mention_id = (select id from target)), 'corrected_at is set');

insert into public.mention_notes (org_id, mention_id, body)
values ('00000000-0000-4000-a000-000000000001', (select id from target), 'Se turna a Obras.');
select is((select author_name from public.mention_notes where mention_id = (select id from target)), 'Comunicación Social',
  'note author name comes from the account');

select throws_ok($$ update public.mentions set text = 'x' where id = (select id from target) $$, '42501', null,
  'only the triage column is writable');

-- obras (dependencia) ---------------------------------------------------------
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;

select is((select count(*) from public.mentions where id = (select id from target)), 1::bigint, 'obras now sees the routed mention');
select is((select count(*) from public.mention_notes where mention_id = (select id from target)), 1::bigint, 'obras reads its notes');
select lives_ok($$ insert into public.mention_notes (org_id, mention_id, body)
  values ('00000000-0000-4000-a000-000000000001', (select id from target), 'Cuadrilla programada.') $$, 'obras adds a note');

update public.mentions set triage = 'discarded' where id = (select id from target);
reset role;
select is((select triage::text from public.mentions where id = (select id from target)), 'routed', 'obras cannot change triage');

select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;
select ok((select count(*) from public.source_labels('00000000-0000-4000-a000-000000000001')) > 0, 'obras gets source labels');

-- agua cannot note a mention it cannot see; lectura cannot route ------------------
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000004');
set local role authenticated;
select throws_ok($$ insert into public.mention_notes (org_id, mention_id, body)
  values ('00000000-0000-4000-a000-000000000001', (select id from target), 'x') $$, '42501', null,
  'agua cannot add notes to a mention routed elsewhere');

reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000005');
set local role authenticated;
select throws_ok($$ select public.route_mentions(array[(select id from target)], '00000000-0000-4000-b000-000000000002', null) $$,
  '42501', null, 'lectura cannot route');

reset role;
select * from finish();
rollback;
