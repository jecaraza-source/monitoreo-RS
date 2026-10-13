-- Stage 6: attention of a case. Who performs each transition, assignment
-- terms, return by competence, tasks per area, progress and evidence
-- (private bucket, per org/case paths, RLS on upload and read), validation
-- with evidence, reopening in a new cycle and milestones that are never
-- overwritten. Fictitious data.
begin;
select plan(86);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.st(p_case uuid) returns text language sql as $$ select status::text from public.cases where id = p_case $$;

create temp table free on commit drop as
  select id from public.mentions m
  where m.org_id = '00000000-0000-4000-a000-000000000001'
    and not exists (select 1 from public.tickets t where t.mention_id = m.id)
    and not exists (select 1 from public.case_mentions cm where cm.mention_id = m.id)
  order by m.published_at, m.id limit 2;
create temp table ids (k text primary key, v uuid) on commit drop;
-- Evidence paths: <org>/<case>/<uuid>.<ext>, filled once the case exists.
create temp table files (k text primary key, path text) on commit drop;
grant all on free, ids, files to authenticated;

create function pg_temp.v(p_k text) returns uuid language sql as $$ select v from ids where k = p_k $$;
create function pg_temp.f(p_k text) returns text language sql as $$ select path from files where k = p_k $$;
-- What the Storage API writes when the caller uploads (owner = the caller).
create function pg_temp.upload(p_k text, p_mime text default 'image/jpeg', p_size integer default 120000) returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('case-evidence', (select path from files where k = p_k), (select auth.uid())::text,
          jsonb_build_object('size', p_size, 'mimetype', p_mime));
$$;

-- ---------------------------------------------------------------------------
-- Assignment with terms (comunicación)
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
insert into ids values ('leak', public.create_case('00000000-0000-4000-a000-000000000001', array[(select id from free order by id limit 1)],
  'Fuga en la calle Morelos', '', 'agua potable', null, 'high'));
insert into ids values ('pothole', public.create_case('00000000-0000-4000-a000-000000000001', array[(select id from free order by id offset 1 limit 1)],
  'Bache en avenida Juárez'));
reset role;
insert into files
select k, format('00000000-0000-4000-a000-000000000001/%s/%s.%s', (select v from ids where k = c), gen_random_uuid(), ext)
from (values ('agua1', 'leak', 'jpg'), ('obras1', 'leak', 'png'), ('obras2', 'leak', 'pdf'), ('agua_html', 'leak', 'jpg'),
             ('reopen', 'leak', 'jpg'), ('pothole1', 'pothole', 'jpg'), ('bad', 'leak', 'exe')) x (k, c, ext);

select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select throws_ok($$ select public.assign_case(pg_temp.v('leak'), '00000000-0000-4000-b000-000000000001', now() + interval '1 day', now() + interval '2 days') $$,
  '22023', 'El plazo de aceptación debe terminar antes del compromiso de atención.', 'acceptance comes before the commitment');
select throws_ok($$ select public.assign_case(pg_temp.v('leak'), '00000000-0000-4000-b000-000000000001', now() - interval '1 hour', now() - interval '2 hours') $$,
  '22023', 'El compromiso de atención debe ser una fecha futura.', 'no deadlines in the past');
select throws_ok($$ select public.assign_case(pg_temp.v('leak'), '00000000-0000-4000-b000-000000000001', now() + interval '3 days', now() + interval '4 hours',
                     '{}', '00000000-0000-4000-d000-000000000004') $$,
  '22023', 'La persona responsable debe ser de la dependencia asignada.', 'the responsible person belongs to the assigned department');
select lives_ok($$ select public.assign_case(pg_temp.v('leak'), '00000000-0000-4000-b000-000000000001', now() + interval '3 days', now() + interval '4 hours',
                    array['00000000-0000-4000-b000-000000000002'::uuid], '00000000-0000-4000-d000-000000000003', 'Reparar la fuga y reponer el pavimento') $$,
  'assigned to Obras (lead) with Agua (support), a responsible person, acceptance deadline and commitment');
select is((select array[status::text, responsible_user_id::text, coordinator_user_id::text, commitment, (accept_due_at < due_at)::text]
           from public.cases where id = pg_temp.v('leak')),
  array['assigned', '00000000-0000-4000-d000-000000000003', '00000000-0000-4000-d000-000000000002', 'Reparar la fuga y reponer el pavimento', 'true'],
  'the case keeps the terms and who coordinates it');
select is((select operation from public.case_events where case_id = pg_temp.v('leak') order by id desc limit 1), 'assignment_terms',
  'the terms are in the history');
select throws_ok($$ select public.transition_case(pg_temp.v('leak'), 'closed') $$, '22023', null, 'no jumping from assigned to closed');
select throws_ok($$ select public.transition_case(pg_temp.v('leak'), 'accepted') $$,
  '22023', 'Este paso es de la dependencia: para registrarlo en su nombre escribe el motivo.', 'accepting is the department''s step');
select is((select count(*)::int from public.department_people('00000000-0000-4000-a000-000000000001')
           where department_id = '00000000-0000-4000-b000-000000000001'), 1, 'coordination lists the people of each department');
reset role;

select pg_temp.login('00000000-0000-4000-d000-000000000005'); -- lectura
set local role authenticated;
select throws_ok($$ select public.assign_case(pg_temp.v('pothole'), '00000000-0000-4000-b000-000000000001', now() + interval '3 days', now() + interval '4 hours') $$,
  '42501', 'not allowed', 'lectura does not assign');
select throws_ok($$ select public.add_case_update(pg_temp.v('leak'), 'Intento de lectura') $$, '42501', 'not allowed', 'nor reports progress');
select throws_ok($$ select public.reopen_case(pg_temp.v('leak'), 'Intento de lectura') $$, '42501', 'not allowed', 'nor reopens');
reset role;

-- ---------------------------------------------------------------------------
-- The lead department: accepts, adds tasks, reports
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-4000-d000-000000000003'); -- Obras
set local role authenticated;
select throws_ok($$ select public.transition_case(pg_temp.v('leak'), 'in_progress') $$, '42501', 'not allowed', 'no skipping acceptance');
select lives_ok($$ select public.transition_case(pg_temp.v('leak'), 'accepted') $$, 'Obras accepts');
select throws_ok($$ select public.validate_case(pg_temp.v('leak'), 'approved', 'Listo', true) $$, '42501', 'not allowed', 'a department does not validate');
select throws_ok($$ select public.add_case_task(pg_temp.v('leak'), '00000000-0000-4000-b000-000000000003', 'Tarea ajena') $$,
  '22023', 'La dependencia de la tarea debe ser la responsable o una de apoyo del caso.', 'tasks only for the areas of the case');
insert into ids values ('task_agua', public.add_case_task(pg_temp.v('leak'), '00000000-0000-4000-b000-000000000002', 'Cerrar la válvula de la red',
  'Antes de excavar', now() + interval '1 day', '00000000-0000-4000-d000-000000000004'));
insert into ids values ('task_obras', public.add_case_task(pg_temp.v('leak'), '00000000-0000-4000-b000-000000000001', 'Reponer el pavimento'));
select lives_ok($$ select public.add_case_update(pg_temp.v('leak'), 'Presupuesto interno de la reparación.', 'coordination') $$,
  'Obras reports to coordination only');
select lives_ok($$ select public.transition_case(pg_temp.v('leak'), 'in_progress') $$, 'Obras starts the attention');
reset role;

-- ---------------------------------------------------------------------------
-- The supporting department: its tasks and what it may see
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-4000-d000-000000000004'); -- Agua
set local role authenticated;
select is((select count(*)::int from public.cases where id = pg_temp.v('leak')), 1, 'the support area sees the case');
select is((select array_agg(title) from public.case_tasks), array['Cerrar la válvula de la red'], 'but only its own task');
select is((select array_agg(department_id::text order by is_primary desc) from public.case_areas(pg_temp.v('leak'))),
  array['00000000-0000-4000-b000-000000000001', '00000000-0000-4000-b000-000000000002'], 'and which areas work on it (ids only)');
select is((select count(*)::int from public.case_updates where case_id = pg_temp.v('leak')), 0, 'and not what Obras sent only to coordination');
select is((select count(*)::int from public.case_events where operation like 'task%'), 0, 'nor other areas'' tasks in the history');
select throws_ok($$ select public.transition_case(pg_temp.v('leak'), 'resolved') $$, '42501', 'not allowed', 'support does not move the case');
select throws_ok($$ select public.update_case_task(pg_temp.v('task_agua'), 'cancelled', 'No aplica') $$, '42501', 'not allowed',
  'nor cancels its task (lead or coordination do)');
select lives_ok($$ select public.update_case_task(pg_temp.v('task_agua'), 'done') $$, 'it completes its task');
-- Evidence: upload to the case's folder (RLS on Storage), then register it.
select lives_ok($$ select pg_temp.upload('agua1') $$, 'it uploads a photo to the case folder');
select throws_ok($$ select pg_temp.upload('pothole1') $$, '42501', null, 'not to a case it does not work on');
select throws_ok($$ select pg_temp.upload('bad', 'application/octet-stream') $$, '42501', null, 'only jpg, png or pdf paths');
select lives_ok($$ select pg_temp.upload('agua_html', 'text/html') $$, 'a file with a disallowed type gets uploaded…');
select throws_ok($$ select public.add_case_update(pg_temp.v('leak'), 'Archivo', 'areas', null, array[pg_temp.f('agua_html')]) $$,
  '22023', 'Archivo no permitido: sólo JPG, PNG o PDF de hasta 3 MB.', '…but is not registered: the type comes from Storage, not the client');
select throws_ok($$ select public.add_case_update(pg_temp.v('leak'), 'Archivo ajeno', 'areas', null, array[pg_temp.f('obras1')]) $$,
  '22023', 'No se encontró el archivo subido.', 'only files the caller uploaded');
select lives_ok($$ select public.add_case_update(pg_temp.v('leak'), 'Válvula cerrada a las 9:00.', 'areas', pg_temp.v('task_agua'), array[pg_temp.f('agua1')]) $$,
  'it reports progress on its task with the photo');
reset role;

select is((select array[mime, size_bytes::text, department_id::text, audience] from public.case_evidence where path = (select path from files where k = 'agua1')),
  array['image/jpeg', '120000', '00000000-0000-4000-b000-000000000002', 'areas'], 'the evidence row: type and size from Storage, area and audience');
select is((select public from storage.buckets where id = 'case-evidence'), false, 'the evidence bucket is private');
select is((select file_size_limit from storage.buckets where id = 'case-evidence'), 3145728::bigint, 'with a 3 MB limit');

-- ---------------------------------------------------------------------------
-- Obras requests validation; comunicación validates
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;
select is((select count(*)::int from public.case_tasks where case_id = pg_temp.v('leak')), 2, 'the lead area sees every task of its case');
select lives_ok($$ select pg_temp.upload('obras1', 'image/png') $$, 'Obras uploads a photo');
select lives_ok($$ select pg_temp.upload('obras2', 'application/pdf') $$, 'and a document');
select lives_ok($$ select public.add_case_update(pg_temp.v('leak'), 'Fuga reparada, falta pavimento.', 'areas', null, array[pg_temp.f('obras1')]) $$,
  'progress with evidence for every area');
select lives_ok($$ select public.add_case_update(pg_temp.v('leak'), 'Factura del material.', 'coordination', null, array[pg_temp.f('obras2')]) $$,
  'evidence only for coordination');
select lives_ok($$ select public.transition_case(pg_temp.v('leak'), 'resolved') $$, 'Obras requests validation');
select throws_ok($$ select public.transition_case(pg_temp.v('leak'), 'closed') $$, '42501', 'not allowed', 'and cannot close it');
reset role;

select pg_temp.login('00000000-0000-4000-d000-000000000004');
set local role authenticated;
select is((select array[count(*) filter (where name = pg_temp.f('agua1')), count(*) filter (where name = pg_temp.f('obras1')),
                  count(*) filter (where name = pg_temp.f('obras2'))]::int[] from storage.objects where bucket_id = 'case-evidence'), array[1, 1, 0],
  'Agua reads its photo and Obras'' shared one, not the coordination-only document');
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000012'); -- another municipality
set local role authenticated;
select is((select count(*)::int from storage.objects where bucket_id = 'case-evidence')
          + (select count(*)::int from public.case_evidence) + (select count(*)::int from public.case_updates), 0,
  'another municipality sees no files, evidence or updates');
select throws_ok($$ select pg_temp.upload('pothole1') $$, '42501', null, 'nor uploads into this municipality''s folders');
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000005');
set local role authenticated;
select is((select count(*)::int from storage.objects where bucket_id = 'case-evidence'), 3, 'lectura reads every registered file');
reset role;

select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select throws_ok($$ select public.transition_case(pg_temp.v('leak'), 'closed') $$, '22023',
  'Para cerrar o devolver un caso pendiente de validación, valídalo: revisa la evidencia y registra el resultado o el motivo.',
  'closing requires validation');
select throws_ok($$ select public.transition_case(pg_temp.v('leak'), 'in_progress', 'x') $$, '22023', null, 'and so does returning it');
select throws_ok($$ select public.validate_case(pg_temp.v('leak'), 'approved', 'Reparado') $$,
  '22023', 'Confirma que la evidencia es suficiente para cerrar.', 'the validator confirms the evidence');
select throws_ok($$ select public.validate_case(pg_temp.v('leak'), 'approved', 'Reparado', true) $$,
  '22023', 'Hay tareas abiertas: deben terminarse o cancelarse antes de cerrar.', 'no closing with open tasks');
select is(public.validate_case(pg_temp.v('leak'), 'rejected', 'Falta la foto del pavimento repuesto') ->> 'status', 'in_progress',
  'comunicación returns it with a reason');
select is((select count(*)::int from public.case_evidence where case_id = pg_temp.v('leak')), 3, 'returning keeps the evidence');
reset role;

select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;
select lives_ok($$ select public.update_case_task(pg_temp.v('task_obras'), 'done') $$, 'Obras finishes its task');
select lives_ok($$ select public.add_case_update(pg_temp.v('leak'), 'Pavimento repuesto.', 'areas', pg_temp.v('task_obras')) $$, 'reports it');
select lives_ok($$ select public.transition_case(pg_temp.v('leak'), 'resolved') $$, 'and requests validation again');
reset role;

select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select is(public.validate_case(pg_temp.v('leak'), 'approved', 'Fuga reparada y pavimento repuesto.', true) ->> 'status', 'closed',
  'comunicación closes it with a result');
reset role;

select is((select array[status::text, result, cycle::text] from public.cases where id = pg_temp.v('leak')),
  array['closed', 'Fuga reparada y pavimento repuesto.', '1'], 'closed with its result');
select is((select array_agg(decision || ':' || evidence_count order by at) from public.case_validations where case_id = pg_temp.v('leak')),
  array['rejected:3', 'approved:3'], 'both validations are recorded, with the evidence they saw');
select is((select array_agg(distinct status::text) from public.tickets where case_id = pg_temp.v('leak')), array['closed'], 'the assignments close');
select is((select array[accepted_at is not null, attention_started_at is not null, closed_at is not null]
           from public.case_cycle_times where case_id = pg_temp.v('leak') and cycle = 1), array[true, true, true],
  'acceptance, attention and closing times of the cycle');
select is((select validation_rejections from public.case_cycle_times where case_id = pg_temp.v('leak') and cycle = 1), 1, 'and the rejected validation');
select is((select count(*)::int from public.case_milestones where case_id = pg_temp.v('leak') and status = 'resolved'), 2,
  'both validation requests are milestones');

create temp table before_reopen on commit drop as
  select count(*) as n, min(at) filter (where status = 'accepted') as accepted from public.case_milestones where case_id = (select v from ids where k = 'leak');

-- ---------------------------------------------------------------------------
-- Reopening on evidence that the problem persists
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;
select throws_ok($$ select public.reopen_case(pg_temp.v('leak'), 'Sigue saliendo agua') $$, '42501', 'not allowed', 'a department does not reopen');
select throws_ok($$ select pg_temp.upload('reopen') $$, '42501', null, 'nor uploads to a closed case');
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select throws_ok($$ select public.reopen_case(pg_temp.v('leak'), ' ') $$, '22023', 'Escribe por qué el problema persiste.', 'reopening needs a reason');
select throws_ok($$ select public.add_case_update(pg_temp.v('leak'), 'Nota') $$, '22023', 'El caso está cerrado: para agregar evidencia, reábrelo.',
  'a closed case gets no more updates');
select lives_ok($$ select pg_temp.upload('reopen') $$, 'comunicación uploads the photo of the new leak');
select is(public.reopen_case(pg_temp.v('leak'), 'Vecinos envían foto: sigue saliendo agua.', array[pg_temp.f('reopen')]) ->> 'cycle', '2',
  'reopened: a new cycle');
reset role;

select is((select array[status::text, coalesce(result, '-'), cycle::text] from public.cases where id = pg_temp.v('leak')), array['in_review', '-', '2'],
  'in review again, without the previous result');
select is((select count(*) from public.case_milestones where case_id = pg_temp.v('leak') and cycle = 1), (select n from before_reopen),
  'the first cycle''s milestones are untouched');
select is((select min(at) from public.case_milestones where case_id = pg_temp.v('leak') and status = 'accepted'), (select accepted from before_reopen),
  'including its acceptance time');
select is((select count(*)::int from public.case_validations where case_id = pg_temp.v('leak')), 2, 'and its validations');
select is((select array_agg(kind || ':' || cycle) from public.case_updates where case_id = pg_temp.v('leak') and cycle = 2),
  array['reopen:2'],'the reason opens the new cycle as an update');
select is((select count(*)::int from public.case_evidence where case_id = pg_temp.v('leak')), 4, 'with its evidence, next to the earlier one');
select is((select operation from public.case_events where case_id = pg_temp.v('leak') and operation in ('reopened', 'status') order by id desc limit 1),
  'reopened', 'recorded as a reopening');

-- ---------------------------------------------------------------------------
-- Return by competence and steps on the department's behalf
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select lives_ok($$ select public.assign_case(pg_temp.v('pothole'), '00000000-0000-4000-b000-000000000002', now() + interval '3 days', now() + interval '4 hours') $$,
  'the pothole goes to Agua');
select lives_ok($$ select public.transition_case(pg_temp.v('pothole'), 'accepted', 'Agua confirmó por teléfono') $$,
  'coordination registers the acceptance on Agua''s behalf, with a reason');
select is((select changes ->> 'on_behalf' from public.case_events where case_id = pg_temp.v('pothole') order by id desc limit 1), 'true',
  'marked as on its behalf');
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000004');
set local role authenticated;
select lives_ok($$ select public.transition_case(pg_temp.v('pothole'), 'returned', 'Es de Obras Públicas') $$, 'Agua returns it by competence');
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select ok(exists (select 1 from public.inbox_queue('00000000-0000-4000-a000-000000000001', 'unassigned', '{}', null, 500) q where q.id = pg_temp.v('pothole')),
  'back with coordination, in "Sin responsable": never without follow-up');
select lives_ok($$ select public.assign_case(pg_temp.v('pothole'), '00000000-0000-4000-b000-000000000001', now() + interval '3 days', now() + interval '1 hour') $$,
  'reassigned to Obras');
reset role;

-- An assigned case is overdue when its acceptance deadline passes.
update public.cases set accept_due_at = now() - interval '1 minute' where id = (select v from ids where k = 'pothole');
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select ok((select is_overdue from public.inbox_items('00000000-0000-4000-a000-000000000001') i where i.id = pg_temp.v('pothole')),
  'not accepted in time: overdue');
select throws_ok($$ insert into public.case_updates (org_id, case_id, cycle, audience, body)
                    values ('00000000-0000-4000-a000-000000000001', pg_temp.v('pothole'), 1, 'areas', 'Directo') $$,
  '42501', null, 'updates are not written directly');
reset role;

set local role service_role;
select throws_ok($$ update public.case_milestones set at = now() $$, '42501', null, 'milestones cannot be rewritten');
select throws_ok($$ update public.case_validations set note = 'x' $$, '42501', null, 'nor validations');
reset role;

select * from finish();
rollback;
