-- Stage 9: KPI figures and their reconciliation. A fictitious scenario in
-- January 2025 (far from the seed's recent data) with known answers:
-- conversation in mentions, attention in cases, Mexico City day boundaries,
-- a reopened case, a merged duplicate, partitions that add up, the hourly
-- rollup that reconciles with the base tables, corrections that show at once,
-- permissions, and report versions that freeze their figures.
begin;
select plan(45);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
-- Mexico City wall time (UTC−6, no DST) → timestamptz.
create function pg_temp.mx(p text) returns timestamptz language sql as $$ select (p || ' America/Mexico_City')::timestamptz $$;

-- ---------------------------------------------------------------------------
-- Scenario
-- ---------------------------------------------------------------------------
-- Current period: 13, 14 and 15 Jan 2025 (CDMX). Previous: 10, 11 and 12 Jan.
insert into public.mentions (id, org_id, source_id, external_id, text, published_at, metrics, status) values
  ('00000000-0000-4000-9e00-000000000001', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e200-000000000002', 'kpi-1', 'Gracias por la reparación', pg_temp.mx('2025-01-13 09:00'), '{"likes":10,"shares":2}', 'classified'),
  ('00000000-0000-4000-9e00-000000000002', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e200-000000000002', 'kpi-2', 'Sin agua otra vez', pg_temp.mx('2025-01-13 18:00'), '{}', 'classified'),
  ('00000000-0000-4000-9e00-000000000003', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e200-000000000002', 'kpi-3', 'Bache enorme', pg_temp.mx('2025-01-14 08:00'), '{}', 'classified'),
  ('00000000-0000-4000-9e00-000000000004', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e200-000000000002', 'kpi-4', '¿Cuándo terminan la obra?', pg_temp.mx('2025-01-15 10:00'), '{}', 'classified'),
  ('00000000-0000-4000-9e00-000000000005', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e200-000000000002', 'kpi-5', 'Pendiente de clasificar', pg_temp.mx('2025-01-15 12:00'), '{}', 'pending'),
  -- 23:30 of the 15th in CDMX is already the 16th in UTC: it belongs to the period.
  ('00000000-0000-4000-9e00-000000000006', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e200-000000000002', 'kpi-6', 'Tarde y molesto', pg_temp.mx('2025-01-15 23:30'), '{}', 'classified'),
  -- 00:30 of the 16th in CDMX: next period.
  ('00000000-0000-4000-9e00-000000000007', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e200-000000000002', 'kpi-7', 'Ya es otro día', pg_temp.mx('2025-01-16 00:30'), '{}', 'classified'),
  ('00000000-0000-4000-9e00-000000000008', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e200-000000000002', 'kpi-8', 'Periodo anterior', pg_temp.mx('2025-01-12 23:59'), '{}', 'classified');
insert into public.classifications (org_id, mention_id, sentiment, confidence, emotion, topic, intent, priority, department_id, neighborhood_id, model) values
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9e00-000000000001', 'positive', 0.9, 'gratitud', 'agua potable', 'elogio', 'low', '00000000-0000-4000-b000-000000000002', '00000000-0000-4000-c000-000000000001', 'test'),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9e00-000000000002', 'negative', 0.9, 'enojo', 'agua potable', 'queja', 'high', '00000000-0000-4000-b000-000000000002', null, 'test'),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9e00-000000000003', 'negative', 0.9, 'enojo', 'baches', 'queja', 'medium', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-c000-000000000003', 'test'),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9e00-000000000004', 'neutral', 0.9, 'neutral', 'baches', 'pregunta', 'low', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-c000-000000000003', 'test'),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9e00-000000000006', 'negative', 0.9, 'enojo', null, 'otro', 'low', null, null, 'test'),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9e00-000000000007', 'negative', 0.9, 'enojo', 'baches', 'queja', 'low', null, null, 'test'),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9e00-000000000008', 'positive', 0.9, 'gratitud', 'baches', 'elogio', 'low', null, null, 'test');

-- Cases with their history at known instants (triggers off to backdate it).
set local session_replication_role = replica;
insert into public.cases (id, org_id, number, title, category, priority, status, cycle, department_id, opened_at, due_at, accept_due_at,
                          location_status, location_source) values
  -- K1 (Agua): accepted 4 h after opening, closed after 29 h, reopened on the 15th, overdue at the cut.
  ('00000000-0000-4000-9f00-000000000001', '00000000-0000-4000-a000-000000000001', 9001, 'Caso ficticio 1', 'agua potable', 'high', 'in_progress', 2,
   '00000000-0000-4000-b000-000000000002', pg_temp.mx('2025-01-13 10:00'), pg_temp.mx('2025-01-15 12:00'), null, 'unavailable', 'sin_dato'),
  -- K2 (Obras): assigned, acceptance deadline passed, never accepted.
  ('00000000-0000-4000-9f00-000000000002', '00000000-0000-4000-a000-000000000001', 9002, 'Caso ficticio 2', 'baches', 'medium', 'assigned', 1,
   '00000000-0000-4000-b000-000000000001', pg_temp.mx('2025-01-14 08:00'), pg_temp.mx('2025-01-20 12:00'), pg_temp.mx('2025-01-14 12:00'), 'unavailable', 'sin_dato'),
  -- K3 (Obras): opened and accepted in the previous period, closed on the 13th.
  ('00000000-0000-4000-9f00-000000000003', '00000000-0000-4000-a000-000000000001', 9003, 'Caso ficticio 3', 'baches', 'medium', 'closed', 1,
   '00000000-0000-4000-b000-000000000001', pg_temp.mx('2025-01-11 09:00'), pg_temp.mx('2025-01-14 09:00'), null, 'unavailable', 'sin_dato'),
  -- K4: a duplicate merged into K1: never counted.
  ('00000000-0000-4000-9f00-000000000004', '00000000-0000-4000-a000-000000000001', 9004, 'Caso ficticio 4', 'agua potable', 'high', 'merged', 1,
   '00000000-0000-4000-b000-000000000002', pg_temp.mx('2025-01-15 09:00'), null, null, 'unavailable', 'sin_dato'),
  -- K5: new, no category, no department.
  ('00000000-0000-4000-9f00-000000000005', '00000000-0000-4000-a000-000000000001', 9005, 'Caso ficticio 5', null, 'low', 'new', 1,
   null, pg_temp.mx('2025-01-15 20:00'), null, null, 'unavailable', 'sin_dato'),
  -- K6: after the period.
  ('00000000-0000-4000-9f00-000000000006', '00000000-0000-4000-a000-000000000001', 9006, 'Caso ficticio 6', 'baches', 'low', 'new', 1,
   null, pg_temp.mx('2025-01-17 09:00'), null, null, 'unavailable', 'sin_dato');
insert into public.case_milestones (org_id, case_id, cycle, status, from_status, at) values
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9f00-000000000001', 1, 'new', null, pg_temp.mx('2025-01-13 10:00')),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9f00-000000000001', 1, 'assigned', 'new', pg_temp.mx('2025-01-13 11:00')),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9f00-000000000001', 1, 'accepted', 'assigned', pg_temp.mx('2025-01-13 14:00')),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9f00-000000000001', 1, 'in_progress', 'accepted', pg_temp.mx('2025-01-14 09:00')),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9f00-000000000001', 1, 'resolved', 'in_progress', pg_temp.mx('2025-01-14 12:00')),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9f00-000000000001', 1, 'closed', 'resolved', pg_temp.mx('2025-01-14 15:00')),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9f00-000000000001', 2, 'in_progress', 'closed', pg_temp.mx('2025-01-15 10:00')),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9f00-000000000002', 1, 'new', null, pg_temp.mx('2025-01-14 08:00')),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9f00-000000000002', 1, 'assigned', 'new', pg_temp.mx('2025-01-14 09:00')),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9f00-000000000003', 1, 'new', null, pg_temp.mx('2025-01-11 09:00')),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9f00-000000000003', 1, 'assigned', 'new', pg_temp.mx('2025-01-11 10:00')),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9f00-000000000003', 1, 'accepted', 'assigned', pg_temp.mx('2025-01-11 12:00')),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9f00-000000000003', 1, 'in_progress', 'accepted', pg_temp.mx('2025-01-12 09:00')),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9f00-000000000003', 1, 'resolved', 'in_progress', pg_temp.mx('2025-01-13 09:00')),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9f00-000000000003', 1, 'closed', 'resolved', pg_temp.mx('2025-01-13 12:00')),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9f00-000000000004', 1, 'new', null, pg_temp.mx('2025-01-15 09:00')),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9f00-000000000004', 1, 'merged', 'new', pg_temp.mx('2025-01-15 09:30')),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9f00-000000000005', 1, 'new', null, pg_temp.mx('2025-01-15 20:00')),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9f00-000000000006', 1, 'new', null, pg_temp.mx('2025-01-17 09:00'));
set local session_replication_role = origin;

-- Comunicación reads the snapshot (and so does lectura).
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
create temp table snap on commit drop as
  select public.kpi_snapshot('00000000-0000-4000-a000-000000000001',
    pg_temp.mx('2025-01-13 00:00'), pg_temp.mx('2025-01-16 00:00'),
    pg_temp.mx('2025-01-10 00:00'), pg_temp.mx('2025-01-13 00:00')) as s;
reset role;
create function pg_temp.c(p_key text) returns numeric language sql as $$ select (s -> 'conversation' -> 'current' ->> p_key)::numeric from snap $$;
create function pg_temp.a(p_key text) returns numeric language sql as $$ select (s -> 'attention' -> 'current' ->> p_key)::numeric from snap $$;
create function pg_temp.ap(p_key text) returns numeric language sql as $$ select (s -> 'attention' -> 'previous' ->> p_key)::numeric from snap $$;
create function pg_temp.dep(p_name text, p_key text) returns numeric language sql as $$
  select (d ->> p_key)::numeric from snap, jsonb_array_elements(s -> 'departments') d where d ->> 'name' = p_name
$$;

-- ---------------------------------------------------------------------------
-- Conversation: mentions (publications), CDMX days
-- ---------------------------------------------------------------------------
select is(pg_temp.c('mentions'), 6::numeric, 'six mentions in the three CDMX days (23:30 of the 15th in, 00:30 of the 16th out)');
select is(pg_temp.c('classified'), 5::numeric, 'five classified');
select is(pg_temp.c('unclassified'), 1::numeric, 'one still unclassified, reported apart');
select is(array[pg_temp.c('positive'), pg_temp.c('neutral'), pg_temp.c('negative')], array[1, 1, 3]::numeric[], 'sentiment over the classified');
select is(pg_temp.c('complaints'), 2::numeric, 'two complaint mentions (they are publications, not incidents)');
select is(pg_temp.c('without_neighborhood'), 2::numeric, 'two classified without colonia');
select is(pg_temp.c('without_topic'), 1::numeric, 'one classified without topic');
select is(pg_temp.c('interactions'), 12::numeric, 'interactions summed');
select is((select (s -> 'conversation' -> 'previous' ->> 'mentions')::numeric from snap), 1::numeric, 'the previous period has its own mention');
select is((select sum((p ->> 'positive')::int + (p ->> 'neutral')::int + (p ->> 'negative')::int + (p ->> 'pending')::int)
           from snap, jsonb_array_elements(s -> 'series') p), 6::bigint, 'the daily series adds up to the total');
select is((select jsonb_array_length(s -> 'series') from snap), 3, 'one point per CDMX day');

-- ---------------------------------------------------------------------------
-- Attention: cases (incidents)
-- ---------------------------------------------------------------------------
select is(pg_temp.a('opened'), 3::numeric, 'three cases opened (the merged duplicate is not counted)');
select is(pg_temp.a('opened_without_category'), 1::numeric, 'one opened without category');
select is(pg_temp.a('opened_without_location'), 3::numeric, 'three opened without location');
select is(pg_temp.a('open_at_cut'), 3::numeric, 'three open at the cut (the closed one is not)');
select is(pg_temp.a('overdue_at_cut'), 2::numeric, 'two overdue at the cut (attention and acceptance deadlines)');
select is(pg_temp.a('awaiting_first_attention'), 2::numeric, 'two still without first attention');
select is(array[pg_temp.a('first_attention_n'), pg_temp.a('first_attention_median_h')], array[1, 4.0]::numeric[], 'first attention: one case, 4 h');
select is(array[pg_temp.a('resolution_n'), pg_temp.a('resolution_median_h'), pg_temp.a('resolution_p90_h')], array[2, 40.0, 48.8]::numeric[],
  'resolution per closed cycle: 29 h and 51 h → median 40, p90 48.8');
select is(pg_temp.a('validated_closures'), 2::numeric, 'two validated closures (the reopened case keeps its closure)');
select is(pg_temp.a('reopenings'), 1::numeric, 'one reopening');
select is(array[pg_temp.ap('opened'), pg_temp.ap('first_attention_median_h'), pg_temp.ap('open_at_cut'), pg_temp.ap('validated_closures')],
  array[1, 3.0, 1, 0]::numeric[], 'the previous period, cut at its own end');

-- Per department: breakdown with its volume, never one ranking.
select is(array[pg_temp.dep('Agua Potable y Alcantarillado', 'opened'), pg_temp.dep('Agua Potable y Alcantarillado', 'overdue_at_cut'),
                pg_temp.dep('Agua Potable y Alcantarillado', 'validated_closures'), pg_temp.dep('Agua Potable y Alcantarillado', 'resolution_median_h'),
                pg_temp.dep('Agua Potable y Alcantarillado', 'reopenings'), pg_temp.dep('Agua Potable y Alcantarillado', 'mentions')],
  array[1, 1, 1, 29.0, 1, 2]::numeric[], 'Agua: opened, overdue, closures, resolution, reopenings and mentions');
select is(array[pg_temp.dep('Obras Públicas', 'opened'), pg_temp.dep('Obras Públicas', 'open_at_cut'), pg_temp.dep('Obras Públicas', 'resolution_median_h')],
  array[1, 1, 51.0]::numeric[], 'Obras: its own cases');
select is(array[pg_temp.dep('Sin asignar', 'opened'), pg_temp.dep('Sin asignar', 'open_at_cut')], array[1, 1]::numeric[], 'unassigned cases have their row');
select is((select jsonb_array_length(s -> 'pending_cases') from snap), 2, 'the two overdue cases are listed as pending');
select ok((select not (s -> 'pending_cases' -> 0 ? 'title') from snap), 'pending cases carry no title');
select is((select jsonb_array_length(s -> 'catalog' -> 'departments_added') from snap), 5, 'catalog changes since the previous period are reported');

-- ---------------------------------------------------------------------------
-- Reconciliation by periods
-- ---------------------------------------------------------------------------
-- Three single days add up to the three-day period.
create temp table days on commit drop as
  select d, public.kpi_snapshot('00000000-0000-4000-a000-000000000001',
           pg_temp.mx(d::text || ' 00:00'), pg_temp.mx((d + 1)::text || ' 00:00'),
           pg_temp.mx((d - 1)::text || ' 00:00'), pg_temp.mx(d::text || ' 00:00')) as s
  from unnest(array['2025-01-13', '2025-01-14', '2025-01-15']::date[]) d;
select is((select sum((s -> 'conversation' -> 'current' ->> 'mentions')::int) from days), pg_temp.c('mentions')::bigint, 'mentions: days add up to the period');
select is((select sum((s -> 'conversation' -> 'current' ->> 'negative')::int) from days), pg_temp.c('negative')::bigint, 'negative: days add up');
select is((select sum((s -> 'attention' -> 'current' ->> 'opened')::int) from days), pg_temp.a('opened')::bigint, 'cases opened: days add up');
select is((select sum((s -> 'attention' -> 'current' ->> 'validated_closures')::int) from days), pg_temp.a('validated_closures')::bigint, 'closures: days add up');
select is((select (s -> 'attention' -> 'current' ->> 'open_at_cut')::int from days where d = '2025-01-15'), pg_temp.a('open_at_cut')::int,
  'open at the cut is a stock: the last day equals the period');

-- The hourly rollup (dashboard charts) reconciles with the base tables.
select private.refresh_mention_stats();
select is((select array[sum(mentions), sum(mentions) filter (where sentiment is not null), sum(mentions) filter (where sentiment = 'negative'),
                        sum(mentions) filter (where sentiment is not null and complaint)]
           from public.mention_stats_hourly where org_id = '00000000-0000-4000-a000-000000000001'
             and hour >= pg_temp.mx('2025-01-13 00:00') and hour < pg_temp.mx('2025-01-16 00:00')),
  array[pg_temp.c('mentions'), pg_temp.c('classified'), pg_temp.c('negative'), pg_temp.c('complaints')]::bigint[],
  'rollup and snapshot agree: mentions, classified, negative, complaints');
create temp table seed_window on commit drop as
  select public.kpi_snapshot('00000000-0000-4000-a000-000000000001', date_trunc('hour', now()) - interval '7 days', date_trunc('hour', now()) + interval '1 hour',
                             date_trunc('hour', now()) - interval '14 days', date_trunc('hour', now()) - interval '7 days') as s;
select is((select sum(mentions) from public.mention_stats_hourly where org_id = '00000000-0000-4000-a000-000000000001'
             and hour >= date_trunc('hour', now()) - interval '7 days' and hour < date_trunc('hour', now()) + interval '1 hour'),
  (select (s -> 'conversation' -> 'current' ->> 'mentions')::bigint from seed_window), 'they also agree over the seed''s last 7 days');

-- A correction shows at once in the snapshot (base tables, not the rollup).
update public.classifications set sentiment = 'negative' where mention_id = '00000000-0000-4000-9e00-000000000004';
select is((select (public.kpi_snapshot('00000000-0000-4000-a000-000000000001', pg_temp.mx('2025-01-13 00:00'), pg_temp.mx('2025-01-16 00:00'),
             pg_temp.mx('2025-01-10 00:00'), pg_temp.mx('2025-01-13 00:00')) -> 'conversation' -> 'current' ->> 'negative')::int), 4,
  'a reclassified mention is counted with its new sentiment');

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;
select throws_ok($$ select public.kpi_snapshot('00000000-0000-4000-a000-000000000001', now() - interval '1 day', now(), now() - interval '2 days', now() - interval '1 day') $$,
  '42501', 'not allowed', 'a department does not read the org-wide KPIs');
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000011');
set local role authenticated;
select throws_ok($$ select public.report_snapshot('00000000-0000-4000-a000-000000000001', now() - interval '1 day', now(), now() - interval '2 days', now() - interval '1 day') $$,
  '42501', 'not allowed', 'nor another municipality');
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000005');
set local role authenticated;
select lives_ok($$ select public.report_snapshot('00000000-0000-4000-a000-000000000001', now() - interval '1 day', now(), now() - interval '2 days', now() - interval '1 day') $$,
  'lectura reads them');
reset role;

-- ---------------------------------------------------------------------------
-- Report versions: approved figures are frozen; a revision is a new version
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select throws_ok($$ insert into public.reports (org_id, period, period_start, period_end, facts)
                    values ('00000000-0000-4000-a000-000000000001', 'weekly', '2025-01-13', '2025-01-15', '{"kpis":[]}') $$,
  '42501', null, 'editors do not write figures: the server computes them');
reset role;
insert into public.reports (id, org_id, period, period_start, period_end, title, facts, content, kpi_version, snapshot_at) values
  ('00000000-0000-4000-9d00-000000000001', '00000000-0000-4000-a000-000000000001', 'weekly', '2025-01-13', '2025-01-15', 'Semana',
   jsonb_build_object('attention', (select s -> 'attention' from snap)), '{}', 'KPI-2026.11', now());
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
update public.reports set status = 'approved' where id = '00000000-0000-4000-9d00-000000000001';
reset role;
-- New operational data after the approval do not touch the frozen figures.
update public.cases set status = 'closed' where id = '00000000-0000-4000-9f00-000000000002';
select is((select (facts -> 'attention' -> 'current' ->> 'open_at_cut')::int from public.reports where id = '00000000-0000-4000-9d00-000000000001'), 3,
  'the approved report keeps its figures after the data change');
select throws_ok($$ update public.reports set facts = '{}' where id = '00000000-0000-4000-9d00-000000000001' $$,
  '42501', 'El reporte ya fue aprobado y no se puede editar.', 'and nobody rewrites them');
insert into public.reports (id, org_id, period, period_start, period_end, title, facts, content, previous_version_id) values
  ('00000000-0000-4000-9d00-000000000002', '00000000-0000-4000-a000-000000000001', 'weekly', '2025-01-13', '2025-01-15', 'Semana (revisión)',
   '{"kpis":[]}', '{}', '00000000-0000-4000-9d00-000000000001');
select is((select version from public.reports where id = '00000000-0000-4000-9d00-000000000002'), 2, 'a revision is version 2, linked to the approved one');
select throws_ok($$ insert into public.reports (org_id, period, period_start, period_end, previous_version_id)
                    values ('00000000-0000-4000-a000-000000000001', 'weekly', '2025-01-13', '2025-01-15', '00000000-0000-4000-9d00-000000000001') $$,
  '23505', null, 'a version has one revision');
select throws_ok($$ insert into public.reports (org_id, period, period_start, period_end, previous_version_id)
                    values ('00000000-0000-4000-a000-000000000001', 'weekly', '2025-01-13', '2025-01-15', '00000000-0000-4000-9d00-000000000002') $$,
  '22023', 'Sólo se revisa un reporte aprobado: edita el borrador.', 'a draft is edited, not revised');

select * from finish();
rollback;
