-- Stage 2: ingestion storage and coverage bookkeeping, classification claims
-- with lease, transactional saves, human corrections, retries and the review
-- queue. Fictitious data; other pending mentions of the seed are set aside.
begin;
select plan(47);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

update public.mentions set status = 'classified' where status = 'pending';
insert into public.sources (id, org_id, name, type, config, is_active) values
  ('00000000-0000-4000-e300-000000000001', '00000000-0000-4000-a000-000000000001', 'Feed de prueba', 'rss', '{"url":"https://diario.example/feed"}', true);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

-- ---------------------------------------------------------------------------
-- ingest_mentions: dedupe by (source, external_id), query version kept, metrics refreshed
-- ---------------------------------------------------------------------------
select is(
  public.ingest_mentions('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e300-000000000001', '[
    {"external_id":"n1","text":"Fuga de agua en Centro","published_at":"2026-10-09T10:00:00Z","metrics":{"likes":1},"query_id":"00000000-0000-4000-e100-000000000001"},
    {"external_id":"n2","text":"Bacheo en Las Flores","published_at":"2026-10-09T11:00:00Z","metrics":{}},
    {"external_id":"n3","text":"Alumbrado en Los Pinos","published_at":"2026-10-09T12:00:00Z","metrics":{"likes":5}},
    {"external_id":"n3","text":"Alumbrado en Los Pinos","published_at":"2026-10-09T12:00:00Z","metrics":{"likes":5}}
  ]'::jsonb),
  '{"inserted": 3, "updated": 0, "unchanged": 1}'::jsonb, 'new items are inserted once even if repeated in one batch');

update public.mentions set status = 'classified' where source_id = '00000000-0000-4000-e300-000000000001' and external_id = 'n1';
select is(
  public.ingest_mentions('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e300-000000000001', '[
    {"external_id":"n1","text":"TEXTO CAMBIADO","published_at":"2026-10-09T10:00:00Z","metrics":{"likes":40,"shares":3},"query_id":null},
    {"external_id":"n2","text":"Bacheo en Las Flores","published_at":"2026-10-09T11:00:00Z","metrics":{}}
  ]'::jsonb),
  '{"inserted": 0, "updated": 1, "unchanged": 1}'::jsonb, 'a known item is not inserted again; changed metrics count as updated');
select is(
  (select array[text, metrics::text, query_id::text, status::text, (metrics_updated_at is not null)::text]
   from public.mentions where source_id = '00000000-0000-4000-e300-000000000001' and external_id = 'n1'),
  array['Fuga de agua en Centro', '{"likes": 40, "shares": 3}', '00000000-0000-4000-e100-000000000001', 'classified', 'true'],
  'metrics take the latest value; text, capturing query version and status stay as first captured');

-- ---------------------------------------------------------------------------
-- Sources: one worker at a time, state written only by the lease owner
-- ---------------------------------------------------------------------------
select is((select count(*) from public.claim_sources('00000000-0000-4000-9300-00000000000a', 10, 120, '{rss}',
  '{00000000-0000-4000-e300-000000000001}')), 1::bigint, 'a worker claims the source');
select is((select count(*) from public.claim_sources('00000000-0000-4000-9300-00000000000b', 10, 120, '{rss}',
  '{00000000-0000-4000-e300-000000000001}')), 0::bigint, 'a second worker does not get it while leased');

select is(public.finish_source_run('00000000-0000-4000-e300-000000000001', '00000000-0000-4000-9300-00000000000b',
  '{"status":"ok","covered_until":"2026-10-10T00:00:00Z"}', '{"trigger":"cron","started_at":"2026-10-10T00:00:00Z"}'),
  false, 'a worker without the lease writes nothing');
select is((select covered_until from public.sources where id = '00000000-0000-4000-e300-000000000001'), null,
  'coverage unchanged by the stale worker');

select is(public.finish_source_run('00000000-0000-4000-e300-000000000001', '00000000-0000-4000-9300-00000000000a',
  '{"status":"partial","covered_until":null,"cursor":{"backfill":{"since":"2026-10-09T00:00:00Z","until":"2026-10-09T12:00:00Z","coverTo":"2026-10-10T00:00:00Z"}}}',
  '{"trigger":"cron","started_at":"2026-10-10T00:00:00Z","fetched":100,"inserted":90,"updated":2,"duplicates":8,"complete":false,
    "window_from":"2026-10-08T23:45:00Z","window_to":"2026-10-10T00:00:00Z","limits":[{"kind":"pages","detail":"10 páginas"}]}'),
  true, 'the owner records a partial run');
select is((select array[covered_until::text, (cursor -> 'backfill' ->> 'until'), (run_lease_id is null)::text, (last_success_at is not null)::text]
  from public.sources where id = '00000000-0000-4000-e300-000000000001'),
  array[null, '2026-10-09T12:00:00Z', 'true', 'true'],
  'a partial run keeps the watermark, stores the backfill and frees the lease');
select is((select array[status, complete::text, updated::text, limits -> 0 ->> 'kind'] from public.ingest_runs
  where source_id = '00000000-0000-4000-e300-000000000001'),
  array['partial', 'false', '2', 'pages'], 'the run log keeps completeness, metric updates and caps');

-- Five failures in a row: reviewable; the next success resolves it.
update public.sources set consecutive_failures = 4 where id = '00000000-0000-4000-e300-000000000001';
select is((select count(*) from public.claim_sources('00000000-0000-4000-9300-00000000000c', 10, 120, '{rss}',
  '{00000000-0000-4000-e300-000000000001}')), 1::bigint, 'claimed again after the lease was released');
select ok(public.finish_source_run('00000000-0000-4000-e300-000000000001', '00000000-0000-4000-9300-00000000000c',
  '{"status":"error","error":"El feed respondió HTTP 503."}', '{"trigger":"cron","started_at":"2026-10-10T01:00:00Z"}'), 'error recorded');
select is((select array[attempts::text, error] from public.pipeline_failures where source_id = '00000000-0000-4000-e300-000000000001' and resolved_at is null),
  array['5', 'El feed respondió HTTP 503.'], 'the fifth failure in a row goes to the review queue');
select is((select count(*) from public.claim_sources('00000000-0000-4000-9300-00000000000d', 10, 120, '{rss}',
  '{00000000-0000-4000-e300-000000000001}')), 0::bigint, 'a failing source waits its backoff in cron runs');
select is((select count(*) from public.claim_sources('00000000-0000-4000-9300-00000000000d', 10, 120, '{rss}',
  '{00000000-0000-4000-e300-000000000001}', null, false)), 1::bigint, 'a manual run ignores the backoff');
select ok(public.finish_source_run('00000000-0000-4000-e300-000000000001', '00000000-0000-4000-9300-00000000000d',
  '{"status":"ok","covered_until":"2026-10-10T02:00:00Z"}', '{"trigger":"manual","started_at":"2026-10-10T02:00:00Z"}'), 'success recorded');
select is((select resolution from public.pipeline_failures where source_id = '00000000-0000-4000-e300-000000000001'), 'recovered',
  'a success resolves the queued source failure');

-- ---------------------------------------------------------------------------
-- Classification claims
-- ---------------------------------------------------------------------------
select ok((public.ingest_mentions('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e300-000000000001',
  '[{"external_id":"n4","text":"Basura sin recoger en Valle Verde","published_at":"2026-10-09T13:00:00Z"}]') ->> 'inserted') = '1', 'a fourth item');
reset role;
-- Oldest first: n2, n4, then n3.
update public.mentions set created_at = case external_id when 'n2' then now() - interval '3 minutes'
  when 'n4' then now() - interval '2 minutes' else now() - interval '1 minute' end
where source_id = '00000000-0000-4000-e300-000000000001';
set local role service_role;
select is((select count(*) from public.claim_mentions('00000000-0000-4000-9400-00000000000a', 2, 180, 5)), 2::bigint,
  'worker A claims two mentions');
select is((select count(*) from public.claim_mentions('00000000-0000-4000-9400-00000000000b', 10, 180, 5)), 1::bigint,
  'worker B gets only the one A did not claim');
select is((select count(*) from public.claim_mentions('00000000-0000-4000-9400-00000000000c', 10, 180, 5)), 0::bigint,
  'nothing is claimed twice while leases are alive');
select is((select count(distinct claim_id) from public.mentions where source_id = '00000000-0000-4000-e300-000000000001' and status = 'pending'),
  2::bigint, 'each pending mention belongs to exactly one claim');

-- Results are saved only for the claim's owner, in one transaction.
create temp table claimed_a as
  select id from public.mentions where claim_id = '00000000-0000-4000-9400-00000000000a' order by created_at;
grant select on claimed_a to service_role, authenticated;

select is(public.complete_classifications('00000000-0000-4000-9400-00000000000b',
  (select jsonb_agg(jsonb_build_object('mention_id', id, 'sentiment', 'negative', 'priority', 'high', 'model', 'm')) from claimed_a),
  '[]', 5) ->> 'stale', '2', 'another worker cannot save results for mentions it does not hold');
select is((select count(*) from public.classifications where mention_id in (select id from claimed_a)), 0::bigint, 'nothing was saved');

select throws_ok(
  $$ select public.complete_classifications('00000000-0000-4000-9400-00000000000a',
       (select jsonb_agg(jsonb_build_object('mention_id', id, 'sentiment', case when n = 1 then 'negative' else 'furioso' end, 'priority', 'high', 'model', 'm'))
        from (select id, row_number() over () as n from claimed_a) x), '[]', 5) $$,
  '22P02', null, 'a bad row fails the whole save');
select is((select array[count(*) filter (where status = 'pending' and claim_id = '00000000-0000-4000-9400-00000000000a')::text,
                        (select count(*) from public.classifications where mention_id in (select id from claimed_a))::text]
           from public.mentions where id in (select id from claimed_a)),
  array['2', '0'], 'after the failed transaction the mentions are still pending and claimed, with no partial classification');

select is(public.complete_classifications('00000000-0000-4000-9400-00000000000a',
  (select jsonb_agg(jsonb_build_object('mention_id', id, 'sentiment', 'negative', 'confidence', 0.9, 'topic', 'agua potable',
     'intent', 'queja', 'priority', 'high', 'model', 'claude-fast')) from claimed_a), '[]', 5),
  '{"saved": 2, "kept_correction": 0, "stale": 0, "retry": 0, "dead": 0}'::jsonb, 'the owner saves its results');
select is((select count(*) from public.mentions where id in (select id from claimed_a) and status = 'classified' and claim_id is null),
  2::bigint, 'classification and status are written together');

-- A person corrects one of them; a late worker that re-classifies it does not overwrite the correction.
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
update public.classifications set sentiment = 'positive', topic = 'programas sociales'
where mention_id = (select id from claimed_a order by id limit 1);
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
-- The mention goes back to pending (e.g. retried from the queue) and a worker claims it.
update public.mentions set status = 'pending', attempts = 0 where id = (select id from claimed_a order by id limit 1);
select is((select count(*) from public.claim_mentions('00000000-0000-4000-9400-00000000000d', 1, 180, 5)), 1::bigint, 'reclaimed');
select is(public.complete_classifications('00000000-0000-4000-9400-00000000000d',
  (select jsonb_agg(jsonb_build_object('mention_id', id, 'sentiment', 'negative', 'priority', 'low', 'model', 'claude-fast')) from (select id from claimed_a order by id limit 1) x),
  '[]', 5) ->> 'kept_correction', '1', 'the correction is reported as kept');
select is((select array[sentiment::text, topic, (corrected_by is not null)::text] from public.classifications where mention_id = (select id from claimed_a order by id limit 1)),
  array['positive', 'programas sociales', 'true'], 'a human correction survives a late worker');

-- Lease expiry: a crashed worker's mention is claimed again; attempts count every claim.
update public.mentions set claim_expires_at = now() - interval '1 second'
where claim_id = '00000000-0000-4000-9400-00000000000b';
select is((select attempts from public.claim_mentions('00000000-0000-4000-9400-00000000000e', 10, 180, 5)), 2::smallint,
  'an expired lease is recovered by another worker (second attempt)');

-- Failures retry with backoff, then go to the queue at the last attempt.
select is(public.complete_classifications('00000000-0000-4000-9400-00000000000e', '[]',
  (select jsonb_agg(jsonb_build_object('mention_id', id, 'error', 'respuesta inválida')) from public.mentions where claim_id = '00000000-0000-4000-9400-00000000000e'),
  5) ->> 'retry', '1', 'a failure before the last attempt is retried');
select is((select array[status::text, (next_attempt_at > now())::text, last_error, (claim_id is null)::text]
  from public.mentions where source_id = '00000000-0000-4000-e300-000000000001' and external_id = 'n3'),
  array['pending', 'true', 'respuesta inválida', 'true'], 'it waits its backoff, with the error kept');
select is((select count(*) from public.claim_mentions('00000000-0000-4000-9400-00000000000f', 10, 180, 5)), 0::bigint,
  'not claimed again before the backoff');

update public.mentions set next_attempt_at = null, attempts = 4 where external_id = 'n3' and source_id = '00000000-0000-4000-e300-000000000001';
select is((select attempts from public.claim_mentions('00000000-0000-4000-9400-00000000000f', 10, 180, 5)), 5::smallint, 'last attempt');
select is(public.complete_classifications('00000000-0000-4000-9400-00000000000f', '[]',
  (select jsonb_agg(jsonb_build_object('mention_id', id, 'error', 'respuesta inválida otra vez')) from public.mentions where claim_id = '00000000-0000-4000-9400-00000000000f'),
  5) ->> 'dead', '1', 'the last failure goes to the queue');
select is((select array[m.status::text, f.error, f.attempts::text] from public.mentions m join public.pipeline_failures f on f.mention_id = m.id
  where m.external_id = 'n3' and m.source_id = '00000000-0000-4000-e300-000000000001' and f.resolved_at is null),
  array['failed', 'respuesta inválida otra vez', '5'], 'failed and reviewable, no endless loop');

-- A worker that keeps dying: after the last attempt the expired claim is queued, not reclaimed.
update public.mentions set status = 'pending', attempts = 5, claim_id = '00000000-0000-4000-9400-0000000000ff',
  claim_expires_at = now() - interval '1 second'
where external_id = 'n2' and source_id = '00000000-0000-4000-e300-000000000001';
select is((select count(*) from public.claim_mentions('00000000-0000-4000-9400-000000000010', 10, 180, 5)), 0::bigint,
  'an exhausted expired claim is not handed out again');
select is((select status::text from public.mentions where external_id = 'n2' and source_id = '00000000-0000-4000-e300-000000000001'),
  'failed', 'it is queued for review');
reset role;

-- ---------------------------------------------------------------------------
-- Review queue and access
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-4000-d000-000000000005');
set local role authenticated;
select is((select count(*) from public.pipeline_failures), 0::bigint, 'lectura does not see the failure queue');
select throws_ok($$ select public.resolve_pipeline_failure((select id from public.pipeline_failures limit 1), 'retry') $$,
  '42501', null, 'lectura cannot retry');
select throws_ok($$ select public.claim_mentions('00000000-0000-4000-9400-000000000011', 10, 180, 5) $$,
  '42501', null, 'users cannot claim mentions');
select is((select count(*) from public.worker_runs), 0::bigint, 'worker runs are readable (none yet in this test)');
reset role;

select pg_temp.login('00000000-0000-4000-d000-000000000012');
set local role authenticated;
select is((select count(*) from public.pipeline_failures where org_id = '00000000-0000-4000-a000-000000000001'), 0::bigint,
  'another municipality does not see the queue');
reset role;

select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select lives_ok($$ select public.resolve_pipeline_failure(
  (select f.id from public.pipeline_failures f join public.mentions m on m.id = f.mention_id where m.external_id = 'n3' and f.resolved_at is null), 'retry') $$,
  'comunicacion retries a failed mention');
reset role;
select is((select array[m.status::text, m.attempts::text, f.resolution] from public.mentions m join public.pipeline_failures f on f.mention_id = m.id
  where m.external_id = 'n3' and m.source_id = '00000000-0000-4000-e300-000000000001'),
  array['pending', '0', 'retried'], 'the retried mention starts over and the queue entry is resolved');

select * from finish();
rollback;
