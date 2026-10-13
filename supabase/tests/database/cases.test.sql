-- Stage 4: cases. One case from 18 mentions of a leak, the workflow by role,
-- assignments as tickets, isolation between departments and municipalities,
-- append-only history, links, merges and suggestions. Fictitious data.
begin;
select plan(67);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.st(p_case uuid) returns text language sql as $$ select status::text from public.cases where id = p_case $$;

-- 18 mentions of the same leak (none routed yet), plus two more for a second case.
create temp table leak on commit drop as
  select id from public.mentions m
  where m.org_id = '00000000-0000-4000-a000-000000000001' and not exists (select 1 from public.tickets t where t.mention_id = m.id)
  order by m.published_at, m.id limit 18;
create temp table other on commit drop as
  select id from public.mentions m
  where m.org_id = '00000000-0000-4000-a000-000000000001' and not exists (select 1 from public.tickets t where t.mention_id = m.id)
    and m.id not in (select id from leak)
  order by m.published_at, m.id limit 3;
create temp table ids (k text primary key, v uuid) on commit drop;
grant all on leak, other, ids to authenticated;
create temp table mention_count on commit drop as select count(*) as n from public.mentions where org_id = '00000000-0000-4000-a000-000000000001';
grant select on mention_count to authenticated;

-- ---------------------------------------------------------------------------
-- comunicacion opens the case
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
insert into ids values ('leak', public.create_case('00000000-0000-4000-a000-000000000001', (select array_agg(id) from leak),
  'Fuga de agua en Centro', 'Vecinos reportan una fuga en la calle Hidalgo.', 'agua potable', '00000000-0000-4000-c000-000000000001', 'high'));
select is((select folio from public.cases where id = (select v from ids where k = 'leak')), 'C-00001', 'the first case of the org gets folio C-00001');
select is((select count(*) from public.case_mentions where case_id = (select v from ids where k = 'leak')), 18::bigint, '18 mentions linked to one case');
select is((select count(*) from public.mentions where org_id = '00000000-0000-4000-a000-000000000001'), (select n from mention_count),
  'and they still count as 18 mentions: no mention was created or removed');
select is(pg_temp.st((select v from ids where k = 'leak')), 'new', 'a new case is "new"');
select is((select opened_by from public.cases where id = (select v from ids where k = 'leak')), '00000000-0000-4000-d000-000000000002'::uuid,
  'the case records who opened it (not the authors of the posts)');
select is((select array[operation, actor_kind, actor_id::text, to_status::text] from public.case_events where case_id = (select v from ids where k = 'leak')),
  array['created', 'user', '00000000-0000-4000-d000-000000000002', 'new'], 'creation is in the history with its actor');
select throws_ok($$ select public.create_case('00000000-0000-4000-a000-000000000001', array[(select id from leak limit 1)], 'Otro caso') $$,
  '23505', 'Alguna mención ya pertenece a C-00001.', 'a mention belongs to at most one case');
select throws_ok($$ select public.create_case('00000000-0000-4000-a000-000000000001', array['00000000-0000-4000-f200-000000000001'::uuid], 'Cruce') $$,
  '22023', 'Alguna mención no existe en este municipio.', 'no mentions of another municipality');
select throws_ok($$ select public.create_case('00000000-0000-4000-a000-00000000000b', array[(select id from other limit 1)], 'Cruce') $$,
  '42501', 'not allowed', 'not in another municipality');
select throws_ok($$ insert into public.cases (org_id, number, title) values ('00000000-0000-4000-a000-000000000001', 99, 'Directo') $$,
  '42501', null, 'cases are not written directly');
select throws_ok($$ select public.transition_case((select v from ids where k = 'leak'), 'assigned') $$,
  '22023', 'Elige la dependencia responsable.', 'assigning needs a department');
select throws_ok($$ select public.transition_case((select v from ids where k = 'leak'), 'closed') $$,
  '22023', null, 'transitions are explicit (new cannot jump to closed)');
select throws_ok($$ select public.transition_case((select v from ids where k = 'leak'), 'discarded') $$,
  '22023', 'Este cambio requiere un motivo.', 'discarding needs a reason');
select lives_ok($$ select public.transition_case((select v from ids where k = 'leak'), 'in_review') $$, 'detected → in review');
select lives_ok($$ select public.transition_case((select v from ids where k = 'leak'), 'assigned', null,
  '00000000-0000-4000-b000-000000000002', array['00000000-0000-4000-b000-000000000001'::uuid], now() + interval '2 days') $$,
  'assigned to Agua (lead) with Obras (support)');
select is((select array_agg(department_id::text || ':' || is_primary || ':' || status order by is_primary desc) from public.tickets
  where case_id = (select v from ids where k = 'leak')),
  array['00000000-0000-4000-b000-000000000002:true:open', '00000000-0000-4000-b000-000000000001:false:open'],
  'assignments are tickets on the primary mention (one per department)');
select throws_ok($$ select public.route_mentions(array[(select id from leak limit 1)], '00000000-0000-4000-b000-000000000003', now() + interval '1 day') $$,
  '22023', 'La mención pertenece al caso C-00001: asígnalo desde el caso.', 'a mention of a case is not routed on its own');
select lives_ok($$ select public.add_case_note((select v from ids where k = 'leak'), 'Nota interna de comunicación.', 'internal') $$, 'internal note');
select lives_ok($$ select public.add_case_note((select v from ids where k = 'leak'), 'Favor de atender hoy.', 'department') $$, 'note for the department');
-- A second case nobody assigned yet.
insert into ids values ('second', public.create_case('00000000-0000-4000-a000-000000000001', array[(select id from other order by id limit 1)], 'Bache en San Miguel'));
reset role;

-- ---------------------------------------------------------------------------
-- The departments
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-4000-d000-000000000004'); -- Agua (lead)
set local role authenticated;
select is((select count(*) from public.cases), 1::bigint, 'the lead department sees only its case');
select is((select count(*) from public.mentions where id in (select id from leak)), 18::bigint, 'and the 18 mentions of its case');
select is((select count(*) from public.mentions where id in (select id from other)), 0::bigint, 'but not mentions of other cases');
select is((select array_agg(visibility) from public.case_notes), array['department'], 'no internal notes');
select is((select count(*) from public.case_events where internal), 0::bigint, 'no internal history entries');
select throws_ok($$ select public.transition_case((select v from ids where k = 'second'), 'in_review') $$, '42501', 'not allowed', 'nothing on other cases');
select throws_ok($$ select public.add_case_note((select v from ids where k = 'leak'), 'x', 'internal') $$, '42501', 'not allowed', 'a department cannot write internal notes');
select throws_ok($$ update public.tickets set status = 'resolved' where case_id = (select v from ids where k = 'leak') $$,
  '42501', 'Este turno es parte de un caso: cambia el estado del caso.', 'a case ticket is moved through its case');
select lives_ok($$ select public.transition_case((select v from ids where k = 'leak'), 'accepted') $$, 'the department accepts');
select throws_ok($$ select public.transition_case((select v from ids where k = 'leak'), 'closed') $$, '42501', 'not allowed', 'and cannot close it');
select lives_ok($$ select public.case_ticket_status((select id from public.tickets where case_id = (select v from ids where k = 'leak') and is_primary), 'in_progress') $$,
  'from its ticket (app or WhatsApp) it starts the work');
select is(pg_temp.st((select v from ids where k = 'leak')), 'in_progress', 'the case is in progress');
select is((select status::text from public.tickets where case_id = (select v from ids where k = 'leak') and is_primary), 'in_progress', 'and its ticket mirrors it');
select lives_ok($$ select public.add_case_note((select v from ids where k = 'leak'), 'Cuadrilla en sitio.', 'department') $$, 'the department adds a note');
select lives_ok($$ select public.add_case_update((select v from ids where k = 'leak'), 'Cuadrilla en sitio, fuga sellada.') $$, 'the department reports progress');
select lives_ok($$ select public.transition_case((select v from ids where k = 'leak'), 'resolved') $$, 'and marks it attended');
reset role;

select pg_temp.login('00000000-0000-4000-d000-000000000003'); -- Obras (support)
set local role authenticated;
select is((select count(*) from public.cases), 1::bigint, 'the support department sees the case too');
select is((select status::text from public.tickets where case_id = (select v from ids where k = 'leak') and not is_primary), 'resolved', 'its assignment follows the case');
select throws_ok($$ select public.transition_case((select v from ids where k = 'leak'), 'closed') $$, '42501', 'not allowed', 'support cannot validate');
reset role;

-- ---------------------------------------------------------------------------
-- Validation, reopening, return by competence
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select throws_ok($$ select public.validate_case((select v from ids where k = 'leak'), 'rejected', '') $$,
  '22023', 'Escribe el motivo de la devolución.', 'rejecting the validation needs a reason');
select lives_ok($$ select public.validate_case((select v from ids where k = 'leak'), 'approved', 'Fuga reparada y verificada.', true) $$, 'comunicación validates and closes');
select is((select array_agg(distinct status::text) from public.tickets where case_id = (select v from ids where k = 'leak')), array['closed'], 'its assignments close');
select throws_ok($$ select public.transition_case((select v from ids where k = 'leak'), 'in_review') $$,
  '22023', 'Este cambio requiere un motivo.', 'reopening needs a reason');
select lives_ok($$ select public.transition_case((select v from ids where k = 'leak'), 'in_review', 'Volvió a salir agua') $$, 'reopened with a reason');
select is((select operation from public.case_events where case_id = (select v from ids where k = 'leak') order by id desc limit 1), 'reopened', 'recorded as a reopening');

-- Second case: Obras returns it as not theirs, it goes to Agua.
select lives_ok($$ select public.transition_case((select v from ids where k = 'second'), 'assigned', null, '00000000-0000-4000-b000-000000000001') $$, 'second case to Obras');
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;
select throws_ok($$ select public.transition_case((select v from ids where k = 'second'), 'returned') $$, '22023', 'Este cambio requiere un motivo.', 'returning needs a reason');
select lives_ok($$ select public.transition_case((select v from ids where k = 'second'), 'returned', 'Es de Agua Potable, no de Obras') $$, 'Obras returns it by competence');
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select lives_ok($$ select public.transition_case((select v from ids where k = 'second'), 'assigned', null, '00000000-0000-4000-b000-000000000002') $$, 'reassigned to Agua');
select is((select array_agg(department_id::text || ':' || status order by department_id) from public.tickets where case_id = (select v from ids where k = 'second')),
  array['00000000-0000-4000-b000-000000000001:closed', '00000000-0000-4000-b000-000000000002:open'], 'Obras keeps its closed ticket; Agua gets an open one');

-- ---------------------------------------------------------------------------
-- Links and merges
-- ---------------------------------------------------------------------------
select throws_ok($$ select public.case_remove_mention((select v from ids where k = 'leak'), (select id from leak order by id limit 1 offset 5), '') $$,
  '22023', 'Quitar una mención requiere un motivo.', 'removing a mention needs a reason');
select throws_ok($$ select public.case_remove_mention((select v from ids where k = 'leak'), (select primary_mention_id from public.cases where id = (select v from ids where k = 'leak')), 'x') $$,
  '22023', null, 'the primary mention with assignments stays');
select lives_ok($$ select public.case_remove_mention((select v from ids where k = 'leak'),
  (select id from leak where id <> (select primary_mention_id from public.cases where id = (select v from ids where k = 'leak')) order by id limit 1), 'No es la misma fuga') $$,
  'a mention is removed with a reason');
select is((select count(*) from public.case_mentions where case_id = (select v from ids where k = 'leak')), 17::bigint, '17 left in the case');
select is((select count(*) from public.mentions where org_id = '00000000-0000-4000-a000-000000000001'), (select n from mention_count), 'the removed one is still a mention');

insert into ids values ('third', public.create_case('00000000-0000-4000-a000-000000000001', array[(select id from other order by id offset 1 limit 1)], 'Otra fuga en Centro'));
select throws_ok($$ select public.merge_cases((select v from ids where k = 'leak'), array[(select v from ids where k = 'third')], ' ') $$,
  '22023', 'Fusionar requiere un motivo.', 'merging needs a reason');
select is(public.merge_cases((select v from ids where k = 'leak'), array[(select v from ids where k = 'third')], 'Es la misma fuga'), 1, 'merged');
select is((select array[status::text, folio, (merged_into_id = (select v from ids where k = 'leak'))::text] from public.cases where id = (select v from ids where k = 'third')),
  array['merged', 'C-00003', 'true'], 'the merged case keeps its folio and points to the target');
select is((select count(*) from public.case_mentions where case_id = (select v from ids where k = 'leak')), 18::bigint, 'its mention moved to the target');
select is((select count(*) from public.case_events where case_id = (select v from ids where k = 'third')), 2::bigint, 'its own history stays');
reset role;

-- ---------------------------------------------------------------------------
-- Other roles, other municipality, history
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-4000-d000-000000000005');
set local role authenticated;
select is((select count(*) from public.cases), 3::bigint, 'lectura reads every case');
select throws_ok($$ select public.transition_case((select v from ids where k = 'leak'), 'assigned', null, '00000000-0000-4000-b000-000000000002') $$,
  '42501', 'not allowed', 'lectura changes nothing');
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000012');
set local role authenticated;
select is((select count(*) from public.cases) + (select count(*) from public.case_events) + (select count(*) from public.case_notes), 0::bigint,
  'another municipality sees no cases, history or notes');
select throws_ok($$ select public.add_case_note((select v from ids where k = 'leak'), 'x', 'department') $$, '42501', 'not allowed', 'nor writes on them');
select throws_ok($$ select public.merge_cases((select v from ids where k = 'leak'), array[(select v from ids where k = 'second')], 'x') $$, '42501', 'not allowed', 'nor merges them');
reset role;

set local role service_role;
select throws_ok($$ update public.case_events set reason = 'reescrito' $$, '42501', null, 'the history cannot be rewritten');
select throws_ok($$ delete from public.case_events $$, '42501', null, 'nor deleted');
reset role;
select is((select array_agg(operation order by id) from public.case_events where case_id = (select v from ids where k = 'leak')),
  array['created', 'status', 'status', 'note', 'note', 'status', 'status', 'note', 'update', 'status', 'status', 'reopened', 'mention_removed', 'merged_from'],
  'every step of the case is in its history');

select * from finish();
rollback;
