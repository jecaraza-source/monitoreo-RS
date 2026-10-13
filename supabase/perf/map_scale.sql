-- Representative load for the map (stage 8). LOCAL ONLY: it writes fictitious
-- rows into the seed org; undo with `npx supabase db reset`. Never run it in
-- preview or production.
--
--   psql "$DB_URL" -v colonias=1500 -v cases=20000 -v mentions=100000 -f supabase/perf/map_scale.sql
--
-- Colonias: a grid of polygons of 64 vertices (a real catalog averages
-- 20-200), cases: 70 % with an inferred colonia, 10 % confirmed with a point,
-- 20 % without location; mentions: 85 % with colonia, 30 % complaints.
\set ON_ERROR_STOP on
\if :{?colonias} \else \set colonias 1500 \endif
\if :{?cases} \else \set cases 20000 \endif
\if :{?mentions} \else \set mentions 100000 \endif

begin;
-- Polygons around (-99.13, 19.39): 40 per row, cells of 0.004° (~400 m).
insert into public.neighborhoods (id, org_id, name, geojson, shape_source)
select gen_random_uuid(), '00000000-0000-4000-a000-000000000001', 'Perf colonia ' || lpad(n::text, 5, '0'),
       jsonb_build_object('type', 'Polygon', 'coordinates', jsonb_build_array((
         select jsonb_agg(jsonb_build_array(
                  round((-99.30 + (n % 40) * 0.004 + 0.002 + 0.0018 * cos(2 * pi() * k / 64))::numeric, 6),
                  round((19.20 + (n / 40) * 0.004 + 0.002 + 0.0018 * sin(2 * pi() * k / 64))::numeric, 6)) order by k)
         from generate_series(0, 64) k))),
       'file'
from generate_series(1, :colonias) n;

create temporary table perf_colonias on commit drop as
select id, row_number() over (order by name) as i, geojson
from public.neighborhoods where org_id = '00000000-0000-4000-a000-000000000001' and name like 'Perf colonia %';

insert into public.mentions (id, org_id, source_id, external_id, url, text, published_at, author_id, metrics, query_id, status)
select ('00000000-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid, '00000000-0000-4000-a000-000000000001',
       '00000000-0000-4000-e200-000000000002', 'perf-' || n, 'https://example.com/perf/' || n,
       'Mención ficticia de carga ' || n, now() - random() * interval '30 days', null, '{}',
       '00000000-0000-4000-e100-000000000002', 'classified'
from generate_series(1, :mentions) n;

insert into public.classifications (org_id, mention_id, sentiment, confidence, emotion, topic, intent, priority, department_id, neighborhood_id, model)
select '00000000-0000-4000-a000-000000000001', ('00000000-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid,
       (array['positive', 'neutral', 'negative']::public.sentiment[])[1 + n % 3], 0.9, 'neutral',
       (array['agua potable', 'baches y pavimentación', 'alumbrado público', 'recolección de basura'])[1 + n % 4],
       case when n % 10 < 3 then 'queja' else 'otro' end, 'medium', null,
       case when n % 20 < 17 then (select id from perf_colonias where i = 1 + n % :colonias) end, 'perf'
from generate_series(1, :mentions) n;

insert into public.cases (org_id, number, title, category, priority, status, neighborhood_id, opened_at, due_at)
select '00000000-0000-4000-a000-000000000001', 900000 + n, 'Caso ficticio de carga ' || n,
       (array['agua potable', 'baches y pavimentación', 'alumbrado público', 'recolección de basura'])[1 + n % 4],
       (array['critical', 'high', 'medium', 'low']::public.priority[])[1 + n % 4],
       (array['new', 'in_review', 'assigned', 'accepted', 'in_progress', 'resolved', 'closed']::public.case_status[])[1 + n % 7],
       case when n % 10 < 8 then (select id from perf_colonias where i = 1 + n % :colonias) end,
       now() - random() * interval '30 days', now() + (random() - 0.5) * interval '10 days'
from generate_series(1, :cases) n;

-- 10 % confirmed with a point at the center of its colonia.
select set_config('app.case_location', 'on', true);
update public.cases k
set location_status = 'confirmed', location_source = 'analista', location_confidence = 1,
    location_lat = round((19.20 + ((c.i - 1) / 40) * 0.004 + 0.002)::numeric, 5),
    location_lng = round((-99.30 + ((c.i - 1) % 40) * 0.004 + 0.002)::numeric, 5)
from perf_colonias c
where k.neighborhood_id = c.id and k.number % 10 = 0 and k.title like 'Caso ficticio de carga %';
select set_config('app.case_location', '', true);
commit;
analyze public.cases, public.mentions, public.classifications, public.neighborhoods;

select count(*) filter (where title like 'Caso ficticio%') as perf_cases,
       count(*) filter (where location_status = 'confirmed') as confirmed,
       count(*) filter (where location_status = 'inferred') as inferred,
       count(*) filter (where location_status = 'unavailable') as unavailable
from public.cases where org_id = '00000000-0000-4000-a000-000000000001';
