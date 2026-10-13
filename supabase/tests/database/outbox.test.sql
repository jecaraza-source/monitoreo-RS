-- Stage 7: durable outbox (service role, in its own file). Idempotent
-- enqueue, leases between concurrent workers, fenced completion, backoff,
-- attempts log, a vanished worker (email retried, WhatsApp left uncertain),
-- quiet hours, hourly limit and channel preferences for normal messages,
-- never for critical ones. Fictitious data.
begin;
select plan(33);

create function pg_temp.service() returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
$$;
create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create temp table ids (k text primary key, v uuid) on commit drop;
grant all on ids to service_role, authenticated;
-- 12:00 in Mexico City, outside quiet hours (22–7).
create function pg_temp.noon(p_minutes integer default 0) returns timestamptz language sql as $$
  select '2026-12-01 12:00-06'::timestamptz + make_interval(mins => p_minutes)
$$;

select pg_temp.service();
set local role service_role;
insert into ids values ('a', public.enqueue_outbox('00000000-0000-4000-a000-000000000001', 'test:alert:1:email', 'alert', 'email',
  'comunicacion@monitoreo.test', '{"title":"Prueba"}', 'normal', '00000000-0000-4000-d000-000000000002'));
select is(public.enqueue_outbox('00000000-0000-4000-a000-000000000001', 'test:alert:1:email', 'alert', 'email',
  'comunicacion@monitoreo.test', '{"title":"Otra"}'), (select v from ids where k = 'a'), 'the same key returns the same message');
reset role;
select is((select count(*)::int from public.outbox where idempotency_key = 'test:alert:1:email'), 1, 'one logical delivery per key');

-- Two workers at once: only one gets it.
select pg_temp.service();
set local role service_role;
select is((select count(*)::int from public.claim_outbox('worker-a', 10, 120, pg_temp.noon()) where id = (select v from ids where k = 'a')), 1,
  'worker A leases it');
select is((select count(*)::int from public.claim_outbox('worker-b', 10, 120, pg_temp.noon()) where id = (select v from ids where k = 'a')), 0,
  'worker B does not get it while leased');
select is(public.complete_outbox((select v from ids where k = 'a'), 'worker-b', 1, true, 'x'), 'stale', 'a worker without the lease cannot settle it');
select is(public.complete_outbox((select v from ids where k = 'a'), 'worker-a', 1, false, null, 'Resend 503', true, pg_temp.noon()), 'pending', 'a failure is retried');
reset role;
select is((select array[status, attempts::text, (next_attempt_at = pg_temp.noon(1))::text, last_error] from public.outbox where id = (select v from ids where k = 'a')),
  array['pending', '1', 'true', 'Resend 503'], 'backoff: one minute after the first failure');

select pg_temp.service();
set local role service_role;
select is((select count(*)::int from public.claim_outbox('worker-a', 10, 120, pg_temp.noon()) where id = (select v from ids where k = 'a')), 0,
  'not before its next attempt');
select is((select count(*)::int from public.claim_outbox('worker-a', 10, 120, pg_temp.noon(2)) where id = (select v from ids where k = 'a')), 1,
  'retried after it');
select is(public.complete_outbox((select v from ids where k = 'a'), 'worker-a', 2, true, 'email_mock_42', null, true, pg_temp.noon(2)), 'sent', 'sent');
select is(public.complete_outbox((select v from ids where k = 'a'), 'worker-a', 2, true, 'email_mock_43'), 'stale', 'a sent message is not settled twice');
reset role;
select is((select array[status, provider_message_id] from public.outbox where id = (select v from ids where k = 'a')),
  array['sent', 'email_mock_42'], 'the provider id is kept');
select is((select array_agg(result || ':' || coalesce(provider_message_id, '-') order by attempt) from public.outbox_attempts where outbox_id = (select v from ids where k = 'a')),
  array['retry:-', 'sent:email_mock_42'], 'one log row per attempt');
select throws_ok($$ update public.outbox_attempts set error = 'x' where outbox_id = (select v from ids where k = 'a') $$, '42501', null,
  'the attempts log is not rewritten');

-- A worker that vanished mid-send.
select pg_temp.service();
set local role service_role;
insert into ids values ('mail', public.enqueue_outbox('00000000-0000-4000-a000-000000000001', 'test:report:1:to1', 'report', 'email',
  'cabildo@monitoreo.test', '{}'));
insert into ids values ('wa', public.enqueue_outbox('00000000-0000-4000-a000-000000000001', 'test:reminder:1:wa', 'reminder', 'whatsapp',
  '5215550000001', '{}', 'normal', '00000000-0000-4000-d000-000000000003'));
select is((select count(*)::int from public.claim_outbox('worker-crash', 10, 60, pg_temp.noon(10)) where id in ((select v from ids where k = 'mail'), (select v from ids where k = 'wa'))),
  2, 'a worker leases both and vanishes');
select is((select count(*)::int from public.claim_outbox('worker-b', 10, 60, pg_temp.noon(10)) where id in ((select v from ids where k = 'mail'), (select v from ids where k = 'wa'))),
  0, 'nobody else takes them before the lease expires');
select is((select count(*)::int from public.claim_outbox('worker-b', 10, 60, pg_temp.noon(12)) where id = (select v from ids where k = 'mail')), 1,
  'after it, the email is retried (the provider de-duplicates by key)');
reset role;
select is((select array[status, attempts::text] from public.outbox where id = (select v from ids where k = 'wa')), array['uncertain', '1'],
  'the WhatsApp message is left uncertain, not sent twice');
select is((select array_agg(result order by attempt) from public.outbox_attempts where outbox_id = (select v from ids where k = 'mail')),
  array['lost', null], 'the lost attempt is recorded');

-- Last attempt: dead, visible.
update public.outbox set max_attempts = 2 where id = (select v from ids where k = 'mail');
select pg_temp.service();
set local role service_role;
select is(public.complete_outbox((select v from ids where k = 'mail'), 'worker-b', 2, false, null, 'Resend 500', true, pg_temp.noon(12)), 'dead',
  'after the last attempt it is dead, not retried forever');
select is(public.complete_outbox((select v from ids where k = 'a'), 'worker-a', 3, false), 'stale', 'unknown attempts are ignored');
reset role;

-- Quiet hours, limit, preferences; critical always goes.
select pg_temp.service();
set local role service_role;
insert into ids values ('night', public.enqueue_outbox('00000000-0000-4000-a000-000000000001', 'test:reminder:2:email', 'reminder', 'email',
  'obras@monitoreo.test', '{}', 'normal', '00000000-0000-4000-d000-000000000003'));
insert into ids values ('crit', public.enqueue_outbox('00000000-0000-4000-a000-000000000001', 'test:emergency:2:email', 'emergency', 'email',
  'obras@monitoreo.test', '{}', 'critical', '00000000-0000-4000-d000-000000000003'));
select is((select array_agg(id::text) from public.claim_outbox('worker-n', 10, 60, '2026-12-01 23:30-06')
           where id in ((select v from ids where k = 'night'), (select v from ids where k = 'crit'))),
  array[(select v from ids where k = 'crit')::text], 'at 23:30 only the critical message goes out');
reset role;
select is((select array[status, deferred_reason, (next_attempt_at = '2026-12-02 07:00-06'::timestamptz)::text] from public.outbox where id = (select v from ids where k = 'night')),
  array['pending', 'quiet_hours', 'true'], 'the normal one waits until 7:00, not dropped');

-- Hourly limit: six normal messages already sent to the address.
insert into public.outbox (org_id, idempotency_key, kind, channel, address, status, sent_at, attempts)
select '00000000-0000-4000-a000-000000000001', 'test:flood:' || g, 'alert', 'email', 'agua@monitoreo.test', 'sent', pg_temp.noon(-10), 1
from generate_series(1, 6) g;
select pg_temp.service();
set local role service_role;
insert into ids values ('flood', public.enqueue_outbox('00000000-0000-4000-a000-000000000001', 'test:alert:flood7', 'alert', 'email', 'agua@monitoreo.test', '{}'));
insert into ids values ('flood_crit', public.enqueue_outbox('00000000-0000-4000-a000-000000000001', 'test:alert:flood8', 'alert', 'email', 'agua@monitoreo.test', '{}', 'critical'));
select is((select array_agg(id::text) from public.claim_outbox('worker-n', 10, 60, pg_temp.noon())
           where id in ((select v from ids where k = 'flood'), (select v from ids where k = 'flood_crit'))),
  array[(select v from ids where k = 'flood_crit')::text], 'over the hourly limit only the critical one goes');
reset role;
select is((select array[status, deferred_reason] from public.outbox where id = (select v from ids where k = 'flood')), array['pending', 'hourly_limit'],
  'the normal one waits 15 minutes');

-- A person turned WhatsApp off.
select pg_temp.login('00000000-0000-4000-d000-000000000004');
set local role authenticated;
insert into public.notification_preferences (org_id, user_id, whatsapp) values ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-d000-000000000004', false);
select throws_ok($$ insert into public.notification_preferences (org_id, user_id) values ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-d000-000000000003') $$,
  '42501', null, 'nobody sets another person''s preferences');
select throws_ok($$ select * from public.claim_outbox('intruso', 10) $$, '42501', null, 'people cannot claim messages');
reset role;
select pg_temp.service();
set local role service_role;
insert into ids values ('off', public.enqueue_outbox('00000000-0000-4000-a000-000000000001', 'test:reminder:3:wa', 'reminder', 'whatsapp',
  '5215550000004', '{}', 'normal', '00000000-0000-4000-d000-000000000004'));
reset role;

select pg_temp.service();
set local role service_role;
select is((select count(*)::int from public.claim_outbox('worker-n', 10, 60, pg_temp.noon()) where id = (select v from ids where k = 'off')), 0,
  'a channel the person turned off is not used');
reset role;
select is((select array[status, deferred_reason] from public.outbox where id = (select v from ids where k = 'off')), array['cancelled', 'channel_off'],
  'and the message records why');

-- Who sees the outbox; manual retry.
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select is((select count(*)::int from public.outbox), 0, 'comunicación does not read addresses in the outbox');
select throws_ok($$ select public.retry_outbox((select v from ids where k = 'wa')) $$, '42501', 'not allowed', 'nor retries');
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000001');
set local role authenticated;
select ok((select count(*) from public.outbox) > 0, 'admin reads the outbox');
select lives_ok($$ select public.retry_outbox((select v from ids where k = 'wa')) $$, 'admin re-queues the uncertain message on purpose');
reset role;

select * from finish();
rollback;
