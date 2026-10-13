-- Stage 5: human review. The model's doubtful output is queued with its
-- reasons; a person confirms, corrects (with reason) or dismisses; the
-- previous version is kept (append-only); a correction queues the
-- aggregates' refresh. Departments and lectura cannot decide. Fictitious data.
begin;
select plan(26);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

insert into public.mentions (id, org_id, source_id, external_id, text, published_at, status) values
  ('00000000-0000-4000-9800-000000000001', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e200-000000000002', 'rv1',
   'Qué bonito, tercer día sin agua en San Miguel 👏', now() - interval '1 hour', 'classified'),
  ('00000000-0000-4000-9800-000000000002', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e200-000000000002', 'rv2',
   'Hay una fuga de gas en la escuela de Las Flores, huele muy fuerte', now() - interval '2 hours', 'classified'),
  ('00000000-0000-4000-9800-000000000003', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e200-000000000002', 'rv3',
   'El presidente municipal no sirve para nada', now() - interval '3 hours', 'classified');

-- Written by the model (no user in the session), as complete_classifications does.
insert into public.classifications (org_id, mention_id, sentiment, confidence, topic, intent, priority, severity, incident_type, needs_attention, model) values
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9800-000000000001', 'positive', 0.45, 'agua potable', 'elogio', 'low', 'none', 'none', false, 'fast'),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9800-000000000002', 'negative', 0.97, 'medio ambiente', 'queja', 'high', 'emergency', 'civil_protection', true, 'smart'),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9800-000000000003', 'negative', 0.93, 'gestión del gobierno', 'otro', 'low', 'none', 'none', false, 'fast');

create temp table r on commit drop as
  select mention_id, id, reasons from public.classification_reviews where mention_id::text like '00000000-0000-4000-9800-%' and status = 'pending';
grant select on r to authenticated;

select ok((select reasons from r where mention_id = '00000000-0000-4000-9800-000000000001') @> array['low_confidence'], 'low confidence is queued');
select ok((select reasons from r where mention_id = '00000000-0000-4000-9800-000000000002') @> array['emergency'], 'a possible emergency is queued');
select ok(not exists (select 1 from r where mention_id = '00000000-0000-4000-9800-000000000003'),
  'a confident negative critique is not queued: negative is not an emergency');
select is((select ai_output ->> 'model' from public.classification_reviews where mention_id = '00000000-0000-4000-9800-000000000002'), 'smart',
  'the queue keeps the model output (model, confidence)');

-- Departments and lectura do not decide; departments do not even see the queue.
select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;
select is((select count(*) from public.classification_reviews), 0::bigint, 'a department does not see the review queue');
select throws_ok($$ select public.decide_review((select id from r limit 1), 'confirmed') $$, '42501', 'not allowed', 'nor decides');
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000005');
set local role authenticated;
select ok((select count(*) from public.classification_reviews) > 0, 'lectura reads the queue');
select throws_ok($$ select public.decide_review((select id from r limit 1), 'confirmed') $$, '42501', 'not allowed', 'but does not decide');
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000011');
set local role authenticated;
select throws_ok($$ select public.decide_review((select id from r limit 1), 'confirmed') $$, '42501', 'not allowed', 'nor another municipality');
reset role;

-- Comunicación decides.
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select throws_ok($$ select public.decide_review((select id from r where mention_id = '00000000-0000-4000-9800-000000000001'), 'corrected',
                     '{"sentiment":"negative","intent":"queja"}') $$, '22023', 'Escribe el motivo de la decisión.', 'a correction needs a reason');
select is(public.decide_review((select id from r where mention_id = '00000000-0000-4000-9800-000000000001'), 'corrected',
            '{"sentiment":"negative","intent":"queja","severity":"moderate","needs_attention":true}', 'Sarcasmo: es una queja por falta de agua') -> 'changes' -> 'sentiment',
          '["positive", "negative"]'::jsonb, 'the decision stores the change as before/after');
select throws_ok($$ select public.decide_review((select id from r where mention_id = '00000000-0000-4000-9800-000000000001'), 'confirmed') $$,
  '22023', 'Esta revisión ya se decidió.', 'a review is decided once');
-- Confirm incident and urgency of the emergency without touching its sentiment.
select is(public.decide_review((select id from r where mention_id = '00000000-0000-4000-9800-000000000002'), 'confirmed') ->> 'status', 'confirmed', 'confirming keeps the classification');
reset role;

select is((select array[sentiment::text, intent, severity::text] from public.classifications where mention_id = '00000000-0000-4000-9800-000000000001'),
  array['negative', 'queja', 'moderate'], 'the correction is applied');
select ok((select corrected_at is not null from public.classifications where mention_id = '00000000-0000-4000-9800-000000000001'), 'and stamped as a correction');
select is((select array[sentiment::text, severity::text] from public.classifications where mention_id = '00000000-0000-4000-9800-000000000002'),
  array['negative', 'emergency'], 'a confirmation changes nothing');
select ok((select confirmed_at is not null and corrected_at is null from public.classifications where mention_id = '00000000-0000-4000-9800-000000000002'),
  'it is recorded as a confirmation, not as a correction');

-- Previous version kept for audit and evaluation.
select is((select count(*) from public.classification_versions where mention_id = '00000000-0000-4000-9800-000000000001'), 1::bigint, 'one previous version');
select is((select array[snapshot ->> 'sentiment', snapshot ->> 'model', source, reason] from public.classification_versions
           where mention_id = '00000000-0000-4000-9800-000000000001'),
  array['positive', 'fast', 'model', 'Sarcasmo: es una queja por falta de agua'], 'the version is the model output, with the reason of the change');
select is((select count(*) from public.classification_versions where mention_id = '00000000-0000-4000-9800-000000000002'), 0::bigint,
  'a confirmation makes no version');
select throws_ok($$ update public.classification_versions set reason = 'x' where mention_id = '00000000-0000-4000-9800-000000000001' $$,
  '42501', null, 'versions cannot be edited');

-- A correction of counted fields queues the aggregates' refresh.
select is((select count(*) from public.stats_invalidations where mention_id = '00000000-0000-4000-9800-000000000001' and processed_at is null), 1::bigint,
  'the correction queued a refresh of the aggregates');
select is((select count(*) from public.stats_invalidations where mention_id = '00000000-0000-4000-9800-000000000002'), 0::bigint,
  'a confirmation does not');

-- Incident policies: comunicación reads, only admin writes, departments do not see them.
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select ok((select count(*) from public.incident_policies) >= 4, 'starting policies exist and comunicación reads them');
select throws_ok($$ insert into public.incident_policies (org_id, incident_type, channel, instructions)
                    values ('00000000-0000-4000-a000-000000000001', 'other', 'Canal', 'Instrucciones de prueba') $$, '42501', null, 'comunicación does not write them');
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;
select is((select count(*) from public.incident_policies), 0::bigint, 'departments do not see them');
reset role;

select * from finish();
rollback;
