-- Stage 8: cases on the map. Location confirmed / inferred / unavailable
-- with source and confidence; an inferred colonia never carries a point;
-- analysts confirm or correct with history; the map's case rows apply the
-- same filters as /casos and RLS scopes them by role and organization; the
-- mentions without colonia are counted and listed. Fictitious data.
begin;
select plan(43);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create temp table ids (k text primary key, v uuid) on commit drop;
create temp table free on commit drop as
  select m.id, row_number() over (order by m.id) as n from public.mentions m
  where m.org_id = '00000000-0000-4000-a000-000000000001'
    and not exists (select 1 from public.tickets t where t.mention_id = m.id)
    and not exists (select 1 from public.case_mentions cm where cm.mention_id = m.id)
  order by m.id limit 3;
grant all on ids, free to authenticated;
create function pg_temp.v(p_k text) returns uuid language sql as $$ select v from ids where k = p_k $$;
create function pg_temp.loc(p_k text) returns text[] language sql as $$
  select array[location_status, location_source, location_confidence::text, coalesce(location_lat::text, '-')]
  from public.cases where id = (select v from ids where k = p_k)
$$;

-- The first free mention was read by the model as Centro (fictitious, confidence 0.95).
update public.classifications set neighborhood_id = '00000000-0000-4000-c000-000000000001', confidence = 0.95, corrected_at = null
where mention_id = (select id from free where n = 1);
update public.classifications set neighborhood_id = null where mention_id in (select id from free where n > 1);

select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
insert into ids values ('model', public.create_case('00000000-0000-4000-a000-000000000001', array[(select id from free where n = 1)],
  'Fuga en Centro', '', 'agua potable', null, 'high'));
insert into ids values ('captured', public.create_case('00000000-0000-4000-a000-000000000001', array[(select id from free where n = 2)],
  'Bache en Las Flores', '', 'bacheo', '00000000-0000-4000-c000-000000000003', 'medium'));
insert into ids values ('none', public.create_case('00000000-0000-4000-a000-000000000001', array[(select id from free where n = 3)],
  'Queja sin lugar', '', 'agua potable', null, 'high'));
reset role;

select is(pg_temp.loc('model'), array['inferred', 'clasificacion', '0.70', '-'],
  'inferred from the classification, confidence capped at 0.70, no point');
select is((select neighborhood_id from public.cases where id = pg_temp.v('model')), '00000000-0000-4000-c000-000000000001'::uuid,
  'with the colonia the model read');
select is(pg_temp.loc('captured'), array['inferred', 'captura', '0.80', '-'], 'a colonia chosen when opening is captured, not confirmed');
select is(pg_temp.loc('none'), array['unavailable', 'sin_dato', null, '-'], 'without colonia: unavailable');

-- An inferred location cannot be given a point, not even directly.
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select throws_ok($$ update public.cases set location_status = 'confirmed' where id = pg_temp.v('model') $$,
  '42501', null, 'people do not write cases directly');
reset role;
select set_config('app.case_location', 'on', true);
select throws_ok($$ update public.cases set location_lat = 19.395, location_lng = -99.125 where id = pg_temp.v('model') $$,
  '23514', null, 'the database refuses a point on an inferred location');
select set_config('app.case_location', '', true);
update public.cases set location_status = 'confirmed', location_lat = 19.395, location_lng = -99.125 where id = pg_temp.v('model');
select is(pg_temp.loc('model'), array['inferred', 'clasificacion', '0.70', '-'], 'outside the location functions, location columns do not change');

-- Who may confirm.
select pg_temp.login('00000000-0000-4000-d000-000000000005');
set local role authenticated;
select throws_ok($$ select public.set_case_location(pg_temp.v('model'), '00000000-0000-4000-c000-000000000001') $$, '42501', 'not allowed', 'lectura does not confirm');
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000011');
set local role authenticated;
select throws_ok($$ select public.set_case_location(pg_temp.v('model'), '00000000-0000-4000-c000-000000000001') $$, '42501', 'not allowed', 'nor another municipality');
reset role;

select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select throws_ok($$ select public.set_case_location(pg_temp.v('model'), '00000000-0000-4000-c000-000000000001', 19.395, -99.115) $$,
  '22023', 'El punto no está dentro de la colonia Centro.', 'a point must fall inside the colonia''s polygon');
select throws_ok($$ select public.set_case_location(pg_temp.v('model'), '00000000-0000-4000-c000-000000000001', 40.0, -99.125) $$,
  '22023', 'El punto está fuera de México.', 'and inside Mexico');
select throws_ok($$ select public.set_case_location(pg_temp.v('model'), '00000000-0000-4000-c000-000000000001', 19.395) $$,
  '22023', 'El punto necesita latitud y longitud.', 'a point has both coordinates');
select lives_ok($$ select public.set_case_location(pg_temp.v('model'), '00000000-0000-4000-c000-000000000001', 19.39512, -99.12534) $$,
  'comunicación confirms Centro with a point');
select is(pg_temp.loc('model'), array['confirmed', 'analista', '1.00', '19.39512'], 'confirmed by an analyst, confidence 1');
select is(public.set_case_location(pg_temp.v('model'), '00000000-0000-4000-c000-000000000001', 19.39512, -99.12534, 'Revisado en sitio') ->> 'operation',
  'location_corrected', 'confirming again is a correction (with its reason)');
select throws_ok($$ select public.set_case_location(pg_temp.v('model'), '00000000-0000-4000-c000-000000000003') $$,
  '22023', 'Escribe el motivo de la corrección.', 'correcting a confirmed location needs a reason');
select lives_ok($$ select public.set_case_location(pg_temp.v('captured'), '00000000-0000-4000-c000-000000000003') $$,
  'confirming the same colonia needs no reason');
select throws_ok($$ select public.clear_case_location(pg_temp.v('none'), '') $$, '22023', 'Escribe por qué no hay ubicación.', 'removing needs a reason');
reset role;

-- Editing the colonia outside the confirmation downgrades it to inferred and drops the point.
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select public.update_case(pg_temp.v('captured'), '{"neighborhood_id":"00000000-0000-4000-c000-000000000004"}');
reset role;
select is(pg_temp.loc('captured'), array['inferred', 'captura', '0.80', '-'], 'an edit is not a confirmation');
select is((select array_agg(status || ':' || coalesce(source, '-') order by id) from public.case_location_events where case_id = pg_temp.v('captured')),
  array['inferred:captura', 'confirmed:analista', 'inferred:captura'], 'every change is in the location history');
select is((select previous ->> 'status' from public.case_location_events where case_id = pg_temp.v('captured') order by id desc limit 1), 'confirmed',
  'with the previous location');
select throws_ok($$ update public.case_location_events set reason = 'x' $$, '42501', null, 'the history is not rewritten');

-- Map rows: rounded points only for confirmed locations, no title.
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select is((select array[lat::text, lng::text] from public.map_case_rows('00000000-0000-4000-a000-000000000001') where id = pg_temp.v('model')),
  array['19.395', '-99.125'], 'the map gets the point rounded to ~100 m');
select is((select count(*)::int from public.map_case_rows('00000000-0000-4000-a000-000000000001') where location_status <> 'confirmed' and lat is not null), 0,
  'no point for an inferred or unavailable location');
select ok(not exists (select 1 from information_schema.columns c
                      where c.table_schema = 'public' and c.table_name = 'map_case_rows' and c.column_name in ('title', 'description')),
  'no title or text columns');

-- Same filters as /casos (opened in Mexico City days, open by default).
select is((select count(*)::int from public.map_case_rows('00000000-0000-4000-a000-000000000001')),
  (select count(*)::int from public.cases where org_id = '00000000-0000-4000-a000-000000000001'
     and status in ('new', 'in_review', 'assigned', 'accepted', 'in_progress', 'resolved', 'returned')), 'open cases = /casos open');
select is((select count(*)::int from public.map_case_rows('00000000-0000-4000-a000-000000000001', '{"neighborhood":"none","status":"all"}')),
  (select count(*)::int from public.cases where org_id = '00000000-0000-4000-a000-000000000001' and neighborhood_id is null), 'without location');
select is((select count(*)::int from public.map_case_rows('00000000-0000-4000-a000-000000000001', '{"category":"agua potable","priority":"high"}')), 2,
  'by category and priority');
select is((select count(*)::int from public.map_case_rows('00000000-0000-4000-a000-000000000001',
  jsonb_build_object('from', (now() at time zone 'America/Mexico_City')::date, 'to', (now() at time zone 'America/Mexico_City')::date))), 3,
  'opened today (Mexico City)');
select is((select count(*)::int from public.map_case_rows('00000000-0000-4000-a000-000000000001',
  jsonb_build_object('to', (now() at time zone 'America/Mexico_City')::date - 1))), 0, 'none opened before today');
reset role;

-- Role and organization scope: a department sees only its cases; another municipality nothing.
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select public.assign_case(pg_temp.v('model'), '00000000-0000-4000-b000-000000000002', now() + interval '3 days', now() + interval '1 day');
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000004'); -- Agua
set local role authenticated;
select is((select array_agg(id) from public.map_case_rows('00000000-0000-4000-a000-000000000001', '{"status":"all"}')), array[pg_temp.v('model')],
  'Agua''s map has only the case assigned to it');
select throws_ok($$ select public.map_unlocated_mentions('00000000-0000-4000-a000-000000000001', now() - interval '30 days', now()) $$,
  '42501', 'not allowed', 'and no conversation layer');
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000003'); -- Obras
set local role authenticated;
select is((select count(*)::int from public.map_case_rows('00000000-0000-4000-a000-000000000001', '{"status":"all"}')), 0, 'Obras sees none of them');
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000012');
set local role authenticated;
select is((select count(*)::int from public.map_case_rows('00000000-0000-4000-a000-000000000001', '{"status":"all"}')), 0, 'another municipality sees none');
reset role;

-- Mentions without colonia: counted like the map's "sin colonia", listed without text.
select public.refresh_mention_stats();
select pg_temp.login('00000000-0000-4000-d000-000000000005');
set local role authenticated;
create temp table window_ on commit drop as
  select date_trunc('day', now() - interval '60 days') as f, date_trunc('hour', now()) + interval '1 hour' as t;
select is((public.map_unlocated_mentions('00000000-0000-4000-a000-000000000001', (select f from window_), (select t from window_)) ->> 'count')::int,
  (public.map_stats('00000000-0000-4000-a000-000000000001', (select f from window_), (select t from window_), (select f from window_) - interval '60 days') ->> 'unassigned')::int,
  'the count of mentions without colonia matches the map');
select ok(not (public.map_unlocated_mentions('00000000-0000-4000-a000-000000000001', (select f from window_), (select t from window_)) -> 'items' -> 0 ? 'text'),
  'the list carries no text');
select ok(jsonb_array_length(public.map_unlocated_mentions('00000000-0000-4000-a000-000000000001', (select f from window_), (select t from window_), null, null, null, 5) -> 'items') <= 5,
  'and is limited');
reset role;

-- The read policy of cases (sets computed once) keeps the rule of
-- can_read_all OR case_visible_to_department, for every role.
create temp table policy_check (user_id uuid primary key, expected int, actual int) on commit drop;
grant all on policy_check to authenticated;
select pg_temp.login('00000000-0000-4000-d000-000000000002');
insert into policy_check (user_id, expected) select '00000000-0000-4000-d000-000000000002', count(*) from public.cases k
  where private.can_read_all(k.org_id) or private.case_visible_to_department(k.org_id, k.id);
set local role authenticated;
update policy_check set actual = (select count(*) from public.cases) where user_id = '00000000-0000-4000-d000-000000000002';
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000003');
insert into policy_check (user_id, expected) select '00000000-0000-4000-d000-000000000003', count(*) from public.cases k
  where private.can_read_all(k.org_id) or private.case_visible_to_department(k.org_id, k.id);
set local role authenticated;
update policy_check set actual = (select count(*) from public.cases) where user_id = '00000000-0000-4000-d000-000000000003';
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000004');
insert into policy_check (user_id, expected) select '00000000-0000-4000-d000-000000000004', count(*) from public.cases k
  where private.can_read_all(k.org_id) or private.case_visible_to_department(k.org_id, k.id);
set local role authenticated;
update policy_check set actual = (select count(*) from public.cases) where user_id = '00000000-0000-4000-d000-000000000004';
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000012');
insert into policy_check (user_id, expected) select '00000000-0000-4000-d000-000000000012', count(*) from public.cases k
  where private.can_read_all(k.org_id) or private.case_visible_to_department(k.org_id, k.id);
set local role authenticated;
update policy_check set actual = (select count(*) from public.cases) where user_id = '00000000-0000-4000-d000-000000000012';
reset role;
select is((select actual from policy_check where user_id = '00000000-0000-4000-d000-000000000002'), (select expected from policy_check where user_id = '00000000-0000-4000-d000-000000000002'),
  'comunicación: same cases as the rule');
select is((select actual from policy_check where user_id = '00000000-0000-4000-d000-000000000003'), (select expected from policy_check where user_id = '00000000-0000-4000-d000-000000000003'),
  'Obras: same cases as the rule');
select is((select actual from policy_check where user_id = '00000000-0000-4000-d000-000000000004'), (select expected from policy_check where user_id = '00000000-0000-4000-d000-000000000004'),
  'Agua: same cases as the rule');
select is((select actual from policy_check where user_id = '00000000-0000-4000-d000-000000000012'), (select expected from policy_check where user_id = '00000000-0000-4000-d000-000000000012'),
  'another municipality: same cases as the rule');

select is(private.point_in_geojson('{"type":"Feature","geometry":{"type":"MultiPolygon","coordinates":[[[[0,0],[4,0],[4,4],[0,4],[0,0]],[[1,1],[3,1],[3,3],[1,3],[1,1]]]]}}', 2, 2), false,
  'a point in a hole is outside');
select is(private.point_in_geojson('{"type":"MultiPolygon","coordinates":[[[[0,0],[4,0],[4,4],[0,4],[0,0]],[[1,1],[3,1],[3,3],[1,3],[1,1]]]]}', 0.5, 0.5), true,
  'and next to it, inside');

select * from finish();
rollback;
