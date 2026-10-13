-- Stage 3: monitor health. Who reads the snapshot and what each role sees,
-- persisted heartbeats, source frequency and manual-run gap in claims, and
-- the configurable thresholds. Fictitious data.
begin;
select plan(27);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- A failing source with an error text and a partial run with caps.
update public.sources set is_active = true, consecutive_failures = 2, last_error = 'El feed respondió HTTP 503.',
  last_error_at = now(), last_run_at = now() - interval '2 hours', covered_until = now() - interval '3 hours'
where id = '00000000-0000-4000-e200-000000000002';
insert into public.ingest_runs (org_id, source_id, trigger, status, started_at, fetched, inserted, complete, limits, error)
values ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e200-000000000002', 'cron', 'partial', now() - interval '2 hours',
  100, 90, false, '[{"kind":"pages","detail":"10 páginas"}]', 'Meta respondió: límite');

-- ---------------------------------------------------------------------------
-- Who reads what
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select is((public.monitor_health('00000000-0000-4000-a000-000000000001') ->> 'editor')::boolean, true, 'comunicacion gets the detailed snapshot');
select is((select s ->> 'last_error' from jsonb_array_elements(public.monitor_health('00000000-0000-4000-a000-000000000001') -> 'sources') s
  where s ->> 'id' = '00000000-0000-4000-e200-000000000002'), 'El feed respondió HTTP 503.', 'editors see error texts');
select is((select s -> 'last_run' -> 'limits' -> 0 ->> 'kind' from jsonb_array_elements(public.monitor_health('00000000-0000-4000-a000-000000000001') -> 'sources') s
  where s ->> 'id' = '00000000-0000-4000-e200-000000000002'), 'pages', 'editors see the caps of the last run');
select is(jsonb_array_length(public.monitor_health('00000000-0000-4000-a000-000000000001') -> 'sources'),
  (select count(*)::integer from public.sources where org_id = '00000000-0000-4000-a000-000000000001'), 'every source of the org, none of another');
select ok(public.monitor_health('00000000-0000-4000-a000-000000000001') -> 'classifier' ? 'oldest_pending_at', 'classifier backlog is included');
select throws_ok($$ select public.monitor_health('00000000-0000-4000-a000-00000000000b') $$, '42501', 'not allowed', 'not another municipality');
reset role;

select pg_temp.login('00000000-0000-4000-d000-000000000005');
set local role authenticated;
select is((public.monitor_health('00000000-0000-4000-a000-000000000001') ->> 'editor')::boolean, false, 'lectura gets the summary snapshot');
select is((select count(*) from jsonb_array_elements(public.monitor_health('00000000-0000-4000-a000-000000000001') -> 'sources') s
  where s ->> 'last_error' is not null or s -> 'last_run' ->> 'error' is not null or jsonb_array_length(coalesce(s -> 'last_run' -> 'limits', '[]')) > 0),
  0::bigint, 'lectura sees no error texts or caps');
select is((select s ->> 'consecutive_failures' from jsonb_array_elements(public.monitor_health('00000000-0000-4000-a000-000000000001') -> 'sources') s
  where s ->> 'id' = '00000000-0000-4000-e200-000000000002'), '2', 'but lectura sees that a source fails');
update public.sources set expected_every_minutes = 15 where id = '00000000-0000-4000-e200-000000000002';
reset role;
select is((select expected_every_minutes from public.sources where id = '00000000-0000-4000-e200-000000000002'), 60, 'lectura cannot change thresholds');

select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;
select throws_ok($$ select public.monitor_health('00000000-0000-4000-a000-000000000001') $$, '42501', 'not allowed', 'dependencia has no access');
select is((select count(*) from public.sources), 0::bigint, 'dependencia reads no source configuration');
select throws_ok($$ select public.record_heartbeat('ingest', 'start') $$, '42501', null, 'users cannot write heartbeats');
reset role;

-- ---------------------------------------------------------------------------
-- Thresholds
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
update public.sources set expected_every_minutes = 360, stale_after_minutes = 1440, quiet_after_hours = 168
where id = '00000000-0000-4000-e200-000000000002';
select is((select array[expected_every_minutes, stale_after_minutes, quiet_after_hours] from public.sources where id = '00000000-0000-4000-e200-000000000002'),
  array[360, 1440, 168], 'editors set a source''s frequency and thresholds');
select throws_ok($$ update public.sources set expected_every_minutes = 5 where id = '00000000-0000-4000-e200-000000000002' $$,
  '23514', null, 'thresholds are bounded');
select lives_ok($$ insert into public.monitor_settings (org_id, classify_backlog_minutes) values ('00000000-0000-4000-a000-000000000001', 45) $$,
  'editors set the classifier thresholds');
select is((public.monitor_health('00000000-0000-4000-a000-000000000001') -> 'settings' ->> 'classify_backlog_minutes'), '45', 'the snapshot carries them');
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000005');
set local role authenticated;
select throws_ok($$ insert into public.monitor_settings (org_id) values ('00000000-0000-4000-a000-000000000001') $$, '42501', null, 'lectura cannot');
reset role;

-- ---------------------------------------------------------------------------
-- Heartbeats and claims (service role)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is((public.monitor_health('00000000-0000-4000-a000-000000000001') ->> 'editor')::boolean, true, 'the service role reads it (health alerts)');

select public.record_heartbeat('classify', 'start');
select public.record_heartbeat('classify', 'finish', 'Anthropic 529: overloaded');
select is((select array[(last_finished_at is not null)::text, (last_ok_at is null)::text, last_error] from public.worker_heartbeats where kind = 'classify'),
  array['true', 'true', 'Anthropic 529: overloaded'], 'a failed run is recorded as such');
select public.record_heartbeat('classify', 'finish');
select is((select array[(last_ok_at is not null)::text, coalesce(last_error, 'null')] from public.worker_heartbeats where kind = 'classify'),
  array['true', 'null'], 'the next good run clears the error');

select public.refresh_mention_stats();
select ok((select last_finished_at > now() - interval '1 minute' from public.worker_heartbeats where kind = 'dashboard'),
  'rebuilding the dashboard rollup is persisted');

-- Frequency: read 2 h ago, expected every 6 h → the cron skips it; a manual run does not.
update public.sources set consecutive_failures = 0, last_error_at = null where id = '00000000-0000-4000-e200-000000000002';
select is((select count(*) from public.claim_sources('00000000-0000-4000-9500-00000000000a', 10, 120, '{rss}',
  '{00000000-0000-4000-e200-000000000002}')), 0::bigint, 'the cron respects the source''s frequency');
select is((select count(*) from public.claim_sources('00000000-0000-4000-9500-00000000000b', 10, 120, '{rss}',
  '{00000000-0000-4000-e200-000000000002}', null, false, 60)), 1::bigint, 'a manual run reads it now');
-- Manual gap: the same source again within a minute is refused (also once the lease is released).
update public.sources set run_lease_id = null, run_lease_until = null, last_run_at = now() - interval '20 seconds'
where id = '00000000-0000-4000-e200-000000000002';
select is((select count(*) from public.claim_sources('00000000-0000-4000-9500-00000000000c', 10, 120, '{rss}',
  '{00000000-0000-4000-e200-000000000002}', null, false, 60)), 0::bigint, 'a second manual run within 60 s is refused');
select is((select count(*) from public.claim_sources('00000000-0000-4000-9500-00000000000d', 10, 120, '{rss}',
  '{00000000-0000-4000-e200-000000000002}', null, false, 10)), 1::bigint, 'after the gap it runs');
reset role;

-- Health alerts are a rule kind.
select lives_ok($$ insert into public.alert_rules (org_id, name, kind, condition) values
  ('00000000-0000-4000-a000-000000000001', 'Salud', 'monitor_health', '{}') $$, 'monitor_health rules can be created');

select * from finish();
rollback;
