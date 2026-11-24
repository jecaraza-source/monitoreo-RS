-- Voces críticas: the negative conversation aggregated by topic, place,
-- platform and emotion, with the previous period; never authors. Fictitious
-- scenario in February 2025, far from the seed's recent data.
begin;
select plan(14);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.cv() returns jsonb language sql as $$
  select public.critical_voices('00000000-0000-4000-a000-000000000001',
    '2025-02-10T06:00:00Z', '2025-02-17T06:00:00Z', '2025-02-03T06:00:00Z', '2025-02-10T06:00:00Z', 'day')
$$;

-- Current week: 6 negative about water (5 in Centro), 1 negative about potholes, 1 positive.
-- Previous week: 1 negative about water, 2 about potholes.
insert into public.mentions (id, org_id, source_id, external_id, text, published_at, metrics, status, author_id)
select ('00000000-0000-4000-9c00-0000000000' || lpad(i::text, 2, '0'))::uuid, '00000000-0000-4000-a000-000000000001',
  '00000000-0000-4000-e200-000000000002', 'cv-' || i, t, p, m::jsonb, 'classified',
  (select id from public.authors where org_id = '00000000-0000-4000-a000-000000000001' limit 1)
from (values
  (1, '@vecino_1 otra vez sin agua en Centro', '2025-02-11T15:00:00Z'::timestamptz, '{"likes":30,"shares":5}'),
  (2, 'Sin agua desde el lunes', '2025-02-11T16:00:00Z', '{}'),
  (3, 'Fuga de agua y sin agua', '2025-02-12T15:00:00Z', '{"likes":2}'),
  (4, 'Seguimos sin agua', '2025-02-13T15:00:00Z', '{}'),
  (5, 'Sin agua en la colonia', '2025-02-14T15:00:00Z', '{}'),
  (6, 'Sin agua, nadie responde', '2025-02-15T15:00:00Z', '{}'),
  (7, 'Bache enorme en la avenida', '2025-02-15T16:00:00Z', '{}'),
  (8, 'Gracias por reparar la tubería', '2025-02-16T15:00:00Z', '{}'),
  (9, 'Sin agua', '2025-02-05T15:00:00Z', '{}'),
  (10, 'Bache', '2025-02-06T15:00:00Z', '{}'),
  (11, 'Otro bache', '2025-02-07T15:00:00Z', '{}')
) v(i, t, p, m);
insert into public.classifications (org_id, mention_id, sentiment, emotion, topic, priority, department_id, neighborhood_id, model)
select '00000000-0000-4000-a000-000000000001', ('00000000-0000-4000-9c00-0000000000' || lpad(i::text, 2, '0'))::uuid,
  s::public.sentiment, e, t, 'medium', d::uuid, n::uuid, 'test'
from (values
  (1, 'negative', 'enojo', 'agua potable', '00000000-0000-4000-b000-000000000002', '00000000-0000-4000-c000-000000000001'),
  (2, 'negative', 'enojo', 'agua potable', '00000000-0000-4000-b000-000000000002', '00000000-0000-4000-c000-000000000001'),
  (3, 'negative', 'frustración', 'agua potable', '00000000-0000-4000-b000-000000000002', '00000000-0000-4000-c000-000000000001'),
  (4, 'negative', 'enojo', 'agua potable', '00000000-0000-4000-b000-000000000002', '00000000-0000-4000-c000-000000000001'),
  (5, 'negative', 'enojo', 'agua potable', '00000000-0000-4000-b000-000000000002', '00000000-0000-4000-c000-000000000001'),
  (6, 'negative', 'frustración', 'agua potable', '00000000-0000-4000-b000-000000000002', null),
  (7, 'negative', 'enojo', 'baches', null, null),
  (8, 'positive', 'gratitud', 'agua potable', null, null),
  (9, 'negative', 'enojo', 'agua potable', null, '00000000-0000-4000-c000-000000000001'),
  (10, 'negative', 'enojo', 'baches', null, null),
  (11, 'negative', 'enojo', 'baches', null, null)
) v(i, s, e, t, d, n);

-- Comunicación reads it.
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select is(pg_temp.cv() -> 'totals', '{"negative": 7, "classified": 8, "prev_negative": 3, "prev_classified": 3}'::jsonb,
  'totals of the period and the previous one');
select is(pg_temp.cv() -> 'topics' -> 0, '{"topic": "agua potable", "negative": 6, "prev_negative": 1, "classified": 7}'::jsonb,
  'topics by negative mentions, with the previous period and the topic''s classified total');
select is(pg_temp.cv() -> 'topics' -> 1 ->> 'prev_negative', '2', 'a topic that went down keeps its previous count');
select is((pg_temp.cv() -> 'neighborhoods' -> 0 ->> 'negative')::int, 5, 'negative mentions by neighborhood');
select is((pg_temp.cv() -> 'neighborhoods' -> 0 ->> 'prev_negative')::int, 1, 'with the previous period');
select is((pg_temp.cv() -> 'departments' -> 0 ->> 'negative')::int, 6, 'and by department');
select is(pg_temp.cv() -> 'emotions' -> 0, '{"emotion": "enojo", "negative": 5}'::jsonb, 'emotions of the negative mentions');
select is(jsonb_array_length(pg_temp.cv() -> 'series'), 6, 'one point per day with mentions');
select is(pg_temp.cv() -> 'top' -> 0 ->> 'interactions', '35', 'the negative mention with most reach first');
select is(jsonb_array_length(pg_temp.cv() -> 'texts'), 7, 'texts of the negative mentions for the frequent terms');
select ok(pg_temp.cv()::text !~* '"(author|author_id|handle|display_name)"', 'no author field anywhere');
reset role;

-- A department, another municipality and bad parameters are refused.
select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;
select throws_ok($$ select pg_temp.cv() $$, '42501', null, 'a department cannot read it');
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000011');
set local role authenticated;
select throws_ok($$ select pg_temp.cv() $$, '42501', null, 'nor another municipality');
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select throws_ok($$ select public.critical_voices('00000000-0000-4000-a000-000000000001', '2025-01-01', '2025-06-01', '2024-01-01', '2025-01-01') $$,
  '22023', null, 'a period over 93 days is refused');
reset role;

select * from finish();
rollback;
