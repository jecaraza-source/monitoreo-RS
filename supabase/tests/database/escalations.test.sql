-- Stage 7: escalation of case deadlines (service role runs the evaluator).
-- Reminder before the deadline, then link, head and coordinator by delay;
-- each step once, with reason, deadline, recipient and result; emergencies
-- are critical; recipients only from configuration. Fictitious data.
begin;
select plan(21);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.service() returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
$$;
create temp table ids (k text primary key, v uuid) on commit drop;
create temp table free on commit drop as
  select m.id from public.mentions m where m.org_id = '00000000-0000-4000-a000-000000000001'
    and not exists (select 1 from public.tickets t where t.mention_id = m.id)
    and not exists (select 1 from public.case_mentions cm where cm.mention_id = m.id)
  order by m.id limit 2;
grant all on ids, free to authenticated, service_role;
create function pg_temp.run(p_at text) returns integer language sql as $$
  select (public.enqueue_case_escalations(p_at::timestamptz) ->> 'events')::integer
$$;
create function pg_temp.steps(p_case text) returns text[] language sql as $$
  select array_agg(e.kind || ':' || coalesce(e.level, '-') || ':' || e.phase order by e.phase, e.kind <> 'reminder', array_position(array['link','head','coordinator'], e.level))
  from public.notification_events e where e.case_id = (select v from ids where k = p_case)
$$;

-- Obras: link = its liaison, head = the admin (verified members).
select pg_temp.login('00000000-0000-4000-d000-000000000001');
set local role authenticated;
select lives_ok($$ select public.set_department_contacts('00000000-0000-4000-b000-000000000001',
  '00000000-0000-4000-d000-000000000003', '00000000-0000-4000-d000-000000000001') $$, 'admin names link and head');
select throws_ok($$ select public.set_department_contacts('00000000-0000-4000-b000-000000000001',
  '00000000-0000-4000-d000-000000000004', null) $$, '22023', null, 'a person of another department cannot be its link');
reset role;

select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
insert into ids values ('leak', public.create_case('00000000-0000-4000-a000-000000000001', array[(select id from free order by id limit 1)], 'Fuga en Juárez', '', null, null, 'medium'));
insert into ids values ('fire', public.create_case('00000000-0000-4000-a000-000000000001', array[(select id from free order by id offset 1 limit 1)], 'Incendio en bodega', '', null, null, 'critical'));
select public.assign_case((select v from ids where k = 'leak'), '00000000-0000-4000-b000-000000000001', now() + interval '3 days', now() + interval '1 day',
  '{}', '00000000-0000-4000-d000-000000000003');
select public.assign_case((select v from ids where k = 'fire'), '00000000-0000-4000-b000-000000000002', now() + interval '3 days', now() + interval '1 day');
select throws_ok($$ select public.enqueue_case_escalations() $$, '42501', null, 'people cannot run the evaluator');
reset role;

-- Fixed clock: assigned 8:00, accept by 12:00, attend by Dec 3 12:00 (Mexico City; wall-clock SLA).
update public.cases set assigned_at = '2026-12-01 08:00-06', accept_due_at = '2026-12-01 12:00-06', due_at = '2026-12-03 12:00-06'
where id in (select v from ids);

select pg_temp.service();
set local role service_role;
select is(pg_temp.run('2026-12-01 10:00-06'), 0, 'nothing before 75% of the window');
select is(pg_temp.run('2026-12-01 11:30-06'), 2, 'at 75%: one reminder per case');
select is(pg_temp.run('2026-12-01 11:45-06'), 0, 'reminders are not repeated');
select is(pg_temp.run('2026-12-01 12:30-06'), 2, 'past the deadline: escalated to the link');
select is(pg_temp.run('2026-12-01 16:30-06'), 2, '+4 h: to the head');
select is(pg_temp.run('2026-12-02 12:30-06'), 2, '+24 h: to the coordinator');
select is(pg_temp.run('2026-12-02 13:00-06'), 0, 'concurrent or repeated runs add nothing');
reset role;

select is(pg_temp.steps('leak'), array['reminder:link:acceptance', 'escalation:link:acceptance', 'escalation:head:acceptance', 'escalation:coordinator:acceptance'],
  'the leak: reminder, link, head, coordinator');
select is((select array_agg(recipient_user_id::text order by kind <> 'reminder', array_position(array['link','head','coordinator'], level)) from public.notification_events where case_id = (select v from ids where k = 'leak')),
  array['00000000-0000-4000-d000-000000000003', '00000000-0000-4000-d000-000000000003', '00000000-0000-4000-d000-000000000001', '00000000-0000-4000-d000-000000000002'],
  'recipients from configuration: link, link, head, the case''s coordinator');
select ok((select bool_and(deadline = '2026-12-01 12:00-06' and reason like (select folio from public.cases where id = (select v from ids where k = 'leak')) || ':%' and result = 'queued')
           from public.notification_events where case_id = (select v from ids where k = 'leak')),
  'each step keeps the deadline, the reason and its result');
select is((select count(*)::int from public.outbox o join public.notification_events e on e.id = o.event_id where e.case_id = (select v from ids where k = 'leak')), 4,
  'one email per step (no WhatsApp contact)');

-- The fire is an emergency: critical, and Agua has no link or head configured.
select is((select array_agg(distinct kind) from public.notification_events where case_id = (select v from ids where k = 'fire')), array['emergency'],
  'a critical case notifies as an emergency');
select is((select array_agg(result || ':' || level order by kind, array_position(array['link','head','coordinator'], level), result) from public.notification_events where case_id = (select v from ids where k = 'fire')),
  array['no_recipient:link', 'no_recipient:link', 'no_recipient:head', 'queued:coordinator'],
  'without a configured person the step is recorded as such, never sent to a guessed address');
select is((select array_agg(distinct urgency) from public.outbox o join public.notification_events e on e.id = o.event_id where e.case_id = (select v from ids where k = 'fire')),
  array['critical'], 'its messages are critical');

-- Accepted: the attention deadline starts its own steps.
update public.cases set status = 'accepted', accepted_at = '2026-12-01 13:00-06' where id = (select v from ids where k = 'leak');
select pg_temp.service();
set local role service_role;
select is(pg_temp.run('2026-12-03 01:00-06'), 1, 'attention reminder at 75% of its window');
reset role;

-- Who reads the events.
select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;
select is((select count(*)::int from public.notification_events where recipient_user_id <> '00000000-0000-4000-d000-000000000003'), 0,
  'a department person reads only what was sent to them');
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000005');
set local role authenticated;
select ok((select count(*) from public.notification_events) >= 9, 'lectura reads them all');
select throws_ok($$ update public.notification_events set reason = 'x' $$, '42501', null, 'and nobody rewrites them');
reset role;

select * from finish();
rollback;
