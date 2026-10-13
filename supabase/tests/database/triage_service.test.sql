-- Stage 5, server side (service role, in its own file: plan caching would
-- hide privilege problems of triggers run by the service role). The
-- classifier writes severity, incident type and need of attention and queues
-- reviews; processing the invalidations rebuilds the rollup, drops the
-- "Lectura del día" and flags stale report drafts. Fictitious data.
begin;
select plan(13);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.service() returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
$$;

insert into public.mentions (id, org_id, source_id, external_id, text, published_at, status, claim_id) values
  ('00000000-0000-4000-9900-000000000001', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e200-000000000002', 'sv1',
   'Balacera ahorita frente al mercado municipal', date_trunc('hour', now()) - interval '2 hours', 'pending', '00000000-0000-4000-9900-0000000000cc'),
  ('00000000-0000-4000-9900-000000000002', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e200-000000000002', 'sv2',
   'Falta una luminaria en la calle 5 de Mayo', date_trunc('hour', now()) - interval '2 hours', 'pending', '00000000-0000-4000-9900-0000000000cc');

select pg_temp.service();
set local role service_role;
select is(public.complete_classifications('00000000-0000-4000-9900-0000000000cc', '[
  {"mention_id":"00000000-0000-4000-9900-000000000001","sentiment":"negative","confidence":0.96,"emotion":"miedo","topic":"seguridad pública",
   "intent":"denuncia","priority":"high","severity":"emergency","incident_type":"violence","needs_attention":true,"model":"smart"},
  {"mention_id":"00000000-0000-4000-9900-000000000002","sentiment":"negative","confidence":0.91,"emotion":"frustración","topic":"alumbrado público",
   "intent":"queja","priority":"medium","severity":"low","incident_type":"public_service","model":"fast"}
]'::jsonb, '[]'::jsonb, 5) ->> 'saved', '2', 'the classifier saves the new fields');
reset role;

select is((select array[severity::text, incident_type, needs_attention::text] from public.classifications where mention_id = '00000000-0000-4000-9900-000000000001'),
  array['emergency', 'violence', 'true'], 'severity, incident type and need of attention are stored');
select is((select needs_attention from public.classifications where mention_id = '00000000-0000-4000-9900-000000000002'), true,
  'without the field, a complaint needs attention');
select ok((select reasons @> array['emergency'] from public.classification_reviews where mention_id = '00000000-0000-4000-9900-000000000001' and status = 'pending'),
  'the service-role write queues the emergency for review');
select ok(not exists (select 1 from public.classification_reviews where mention_id = '00000000-0000-4000-9900-000000000002'),
  'an ordinary, confident complaint is not queued');

-- Rollup and readings as they are before the correction.
select pg_temp.service();
set local role service_role;
select public.refresh_mention_stats();
reset role;
insert into public.daily_readings (org_id, sentences) values ('00000000-0000-4000-a000-000000000001', array['Lectura de prueba.'])
  on conflict (org_id) do update set sentences = excluded.sentences;
insert into public.reports (id, org_id, period, status, title, period_start, period_end)
values ('00000000-0000-4000-9900-0000000000aa', '00000000-0000-4000-a000-000000000001', 'daily', 'draft', 'Borrador de prueba',
        (now() at time zone 'America/Mexico_City')::date - 1, (now() at time zone 'America/Mexico_City')::date);
create temp table before_stats on commit drop as
  select coalesce(sum(mentions), 0) as n from public.mention_stats_hourly
  where org_id = '00000000-0000-4000-a000-000000000001' and hour = date_trunc('hour', now()) - interval '2 hours' and topic = 'alumbrado público';

-- A person corrects the topic of the second mention.
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select ok(public.correct_classification('00000000-0000-4000-9900-000000000002', '{"topic":"obra pública"}', 'Es una obra en curso') ? 'topic',
  'comunicación corrects the topic');
select throws_ok($$ select public.process_stats_invalidations() $$, '42501', null, 'people cannot run the processor');
reset role;

select is((select count(*) from public.stats_invalidations where mention_id = '00000000-0000-4000-9900-000000000002' and processed_at is null), 1::bigint,
  'the correction is queued');

select pg_temp.service();
set local role service_role;
select ok((public.process_stats_invalidations() ->> 'processed')::int >= 1, 'the server processes the queue');
reset role;

select is((select coalesce(sum(mentions), 0) from public.mention_stats_hourly
           where org_id = '00000000-0000-4000-a000-000000000001' and hour = date_trunc('hour', now()) - interval '2 hours' and topic = 'alumbrado público'),
  (select n - 1 from before_stats), 'the rollup reflects the correction');
select is((select count(*) from public.stats_invalidations where processed_at is null and org_id = '00000000-0000-4000-a000-000000000001'), 0::bigint,
  'nothing left pending');
select is((select count(*) from public.daily_readings where org_id = '00000000-0000-4000-a000-000000000001'), 0::bigint,
  'the "Lectura del día" is regenerated on next view');
select ok((select facts_stale_at is not null from public.reports where id = '00000000-0000-4000-9900-0000000000aa'),
  'a draft covering the corrected mention is flagged');

select * from finish();
rollback;
