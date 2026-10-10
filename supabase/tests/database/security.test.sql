-- Audit log, events, rate limiting, retention and the error log.
begin;
select plan(15);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- An admin edits a rule and a catalog: the log keeps who and what changed.
select pg_temp.login('00000000-0000-4000-d000-000000000001');
set local role authenticated;
update public.alert_rules set cooldown_minutes = 30 where id = '00000000-0000-4000-e300-000000000001';
insert into public.risk_terms (org_id, term, normalized, severity) values ('00000000-0000-4000-a000-000000000001', 'Fuga de gas', 'fuga de gas', 'critical');
reset role;
select is((select actor_id from public.audit_log where entity = 'alert_rules' and action = 'update' order by id desc limit 1),
  '00000000-0000-4000-d000-000000000001'::uuid, 'updates record the actor');
select is((select changes -> 'cooldown_minutes' from public.audit_log where entity = 'alert_rules' and action = 'update' order by id desc limit 1),
  '[120, 30]'::jsonb, 'updates record old and new values of the changed columns only');
select is((select changes ->> 'term' from public.audit_log where entity = 'risk_terms' and action = 'insert' order by id desc limit 1),
  'Fuga de gas', 'inserts record the new row');

-- comunicacion routes a mention; the department changes the ticket status.
select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;
update public.tickets set status = 'in_progress'
where id = (select id from public.tickets where department_id = '00000000-0000-4000-b000-000000000001' and status = 'open' limit 1);
reset role;
select is((select actor_id from public.audit_log where entity = 'tickets' and action = 'update' order by id desc limit 1),
  '00000000-0000-4000-d000-000000000003'::uuid, 'ticket changes by a department are logged');
-- Server-side writes (no user) to mentions stay out of the log.
update public.mentions set status = status where external_id = 'seed-1';
select is((select count(*) from public.audit_log where entity = 'mentions'), 0::bigint, 'ingestion writes are not logged');

-- Who reads the log.
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select is((select count(*) from public.audit_log), 0::bigint, 'comunicacion cannot read the audit log');
select throws_ok($$ insert into public.audit_log (org_id, action, entity) values ('00000000-0000-4000-a000-000000000001', 'update', 'x') $$,
  '42501', null, 'nobody writes the audit log directly');
-- Events: a member records an export of its own org; never of another.
select lives_ok($$ select public.log_event('00000000-0000-4000-a000-000000000001', 'export', 'reports', 'r1', '{"format":"pdf"}') $$,
  'members log exports of their org');
select throws_ok($$ select public.log_event('00000000-0000-4000-a000-000000000009', 'export', 'reports', 'r1') $$,
  '42501', 'not allowed', 'nobody logs events for another org');
select throws_ok($$ select * from public.rate_limit_hit('x', 1, 60) $$, '42501', null, 'users cannot call the rate limiter');
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000001');
set local role authenticated;
select is((select changes ->> 'format' from public.audit_log where action = 'export' order by id desc limit 1), 'pdf',
  'admins read events in the audit log');
reset role;

-- Rate limiter: the third hit in the window is refused.
set local role service_role;
select is((select array_agg(allowed order by n) from (select n, (public.rate_limit_hit('test:key', 2, 60)).allowed from generate_series(1, 3) n) x),
  array[true, true, false], 'allows the limit and refuses the rest of the window');

-- Retention: only mentions older than the cutoff go, with their tickets.
update public.mentions set published_at = now() - interval '14 months' where external_id in ('seed-1', 'seed-2');
select is(public.purge_old_mentions(12), 2, 'purges mentions older than the retention');
reset role;
select is((select count(*) from public.mentions where external_id in ('seed-1', 'seed-2')), 0::bigint, 'old mentions are gone');
select is((select (changes ->> 'deleted')::int from public.audit_log where action = 'purge' order by id desc limit 1), 2,
  'the purge is recorded in the audit log');

select * from finish();
rollback;
