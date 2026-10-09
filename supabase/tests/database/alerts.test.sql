-- Alerts: cooldown, feedback permissions, crisis log and snapshot.
begin;
select plan(13);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- Service role fires; the second call inside the cooldown is suppressed.
set local role service_role;
select isnt(public.fire_alert('00000000-0000-4000-e300-000000000001', 'spike', 'spike', 'high', 'Pico', 'x', '{}', '{}'), null,
  'the first spike fires');
select is(public.fire_alert('00000000-0000-4000-e300-000000000001', 'spike', 'spike', 'high', 'Pico', 'x', '{}', '{}'), null,
  'a repeat within the cooldown is suppressed');
select isnt(public.fire_alert('00000000-0000-4000-e300-000000000003', 'term:balacera', 'risk_term', 'critical', 'Balacera', 'x', '{}', '{}'), null,
  'another fingerprint fires on its own');
reset role;
select is((select count(*) from public.alert_events where rule_id = '00000000-0000-4000-e300-000000000001'), 1::bigint,
  'exactly one spike event');

-- comunicacion rates an org-wide alert; the database stamps who.
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select throws_ok($$ select public.fire_alert('00000000-0000-4000-e300-000000000001', 'x', 'spike', 'high', 't', 's', '{}', '{}') $$,
  '42501', null, 'users cannot fire alerts');
update public.alert_events set feedback = 'false_alarm' where rule_id = '00000000-0000-4000-e300-000000000001';
reset role;
select is((select feedback_by from public.alert_events where rule_id = '00000000-0000-4000-e300-000000000001'),
  '00000000-0000-4000-d000-000000000002'::uuid, 'feedback_by is stamped');
select ok((select acknowledged_at is not null from public.alert_events where rule_id = '00000000-0000-4000-e300-000000000001'),
  'rating also marks it as seen');

-- agua rates its own department alert; obras cannot see or rate it.
select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;
update public.alert_events set feedback = 'useful' where rule_id = '00000000-0000-4000-e300-000000000002';
reset role;
select is((select feedback from public.alert_events where rule_id = '00000000-0000-4000-e300-000000000002'), null,
  'obras cannot rate an Agua alert');
select pg_temp.login('00000000-0000-4000-d000-000000000004');
set local role authenticated;
update public.alert_events set feedback = 'useful' where rule_id = '00000000-0000-4000-e300-000000000002';
reset role;
select is((select feedback from public.alert_events where rule_id = '00000000-0000-4000-e300-000000000002'), 'useful',
  'agua rates its own alert');

-- Crisis room.
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
insert into public.crisis_log (org_id, body) values ('00000000-0000-4000-a000-000000000001', 'Se convocó a conferencia.');
select is((select author_name from public.crisis_log limit 1), 'Comunicación Social', 'log entries carry the author name');
select ok((public.crisis_snapshot('00000000-0000-4000-a000-000000000001', 60) -> 'per_minute') is not null, 'comunicacion gets the live snapshot');
reset role;

select pg_temp.login('00000000-0000-4000-d000-000000000005');
set local role authenticated;
select throws_ok($$ insert into public.crisis_log (org_id, body) values ('00000000-0000-4000-a000-000000000001', 'x') $$,
  '42501', null, 'lectura cannot write the crisis log');
reset role;

select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;
select throws_ok($$ select public.crisis_snapshot('00000000-0000-4000-a000-000000000001', 60) $$,
  '42501', null, 'dependencia cannot open the crisis room');
reset role;

select * from finish();
rollback;
