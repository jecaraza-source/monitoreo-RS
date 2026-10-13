-- Stage 8: cases on the map.
--
--   * Location of a case: confirmed (an analyst checked it), inferred (from
--     the classification of its first mention or captured with the case,
--     never exact) or unavailable; with its source and confidence. Only a
--     confirmed location may carry a point, and an inferred colonia never
--     produces coordinates. Every change is in case_location_events.
--   * set_case_location / clear_case_location: admin and comunicación
--     confirm, correct or remove it, with a reason when correcting.
--   * map_case_rows: the cases of the map (security invoker: RLS scopes a
--     department to its own cases), with the same filters as /casos. Points
--     leave the database rounded to ~100 m and without title or text.
--   * map_unlocated_mentions: the mentions without colonia of the
--     conversation layer, counted and listed (no text).
--
-- Additive; the backfill is repeatable (only cases without a location
-- source). Rollback: docs/rollback/20261101000000_map_cases.down.sql.

-- ---------------------------------------------------------------------------
-- Location of a case
-- ---------------------------------------------------------------------------
alter table public.cases
  add column location_status text not null default 'unavailable'
    check (location_status in ('confirmed', 'inferred', 'unavailable')),
  -- analista: confirmed or corrected by a person; clasificacion: the model
  -- read the colonia in the first mention; clasificacion_revisada: a person
  -- corrected that classification; captura: chosen when the case was
  -- opened or edited, not confirmed; sin_dato: nothing to infer from.
  add column location_source text
    check (location_source in ('analista', 'clasificacion', 'clasificacion_revisada', 'captura', 'sin_dato')),
  add column location_confidence numeric(3, 2) check (location_confidence between 0 and 1),
  -- A point, only for a confirmed location (WGS84; Mexico's bounding box).
  add column location_lat numeric(8, 5) check (location_lat between 14 and 33),
  add column location_lng numeric(8, 5) check (location_lng between -119 and -86),
  add column location_updated_at timestamptz,
  add column location_updated_by uuid references auth.users (id),
  add constraint cases_location_point_pair check ((location_lat is null) = (location_lng is null)),
  add constraint cases_location_point_confirmed check (location_lat is null or location_status = 'confirmed');

create index cases_map_idx on public.cases (org_id, opened_at) include (status, priority, neighborhood_id, department_id);

create table public.case_location_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  at timestamptz not null default now(),
  actor_id uuid references auth.users (id),
  actor_name text not null default '',
  status text not null,
  source text,
  confidence numeric(3, 2),
  neighborhood_id uuid,
  lat numeric(8, 5),
  lng numeric(8, 5),
  reason text,
  -- The location before the change.
  previous jsonb,
  foreign key (org_id, case_id) references public.cases (org_id, id) on delete cascade
);
create index case_location_events_case_idx on public.case_location_events (case_id, at);
alter table public.case_location_events enable row level security;
-- Same audience as the case history (departments read the cases they work on).
create policy "read case location events" on public.case_location_events for select to authenticated
  using ((select private.can_read_all(org_id)) or private.case_visible_to_department(org_id, case_id));
revoke all on public.case_location_events from anon;
revoke insert, update, delete, truncate on public.case_location_events from authenticated;
revoke update, delete, truncate on public.case_location_events from service_role;
create trigger case_location_events_append_only before update on public.case_location_events
  for each row execute function private.case_append_only();

-- Where an unconfirmed colonia comes from, and how much to trust it. An
-- inference never exceeds 0.70; a colonia a person chose without confirming
-- it is 0.80; only an analyst's confirmation is 1.
create function private.infer_case_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class public.classifications;
begin
  -- set_case_location / clear_case_location write the location themselves.
  if coalesce(current_setting('app.case_location', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.neighborhood_id is not distinct from old.neighborhood_id then
    -- Location columns only change through those functions.
    new.location_status := old.location_status;
    new.location_source := old.location_source;
    new.location_confidence := old.location_confidence;
    new.location_lat := old.location_lat;
    new.location_lng := old.location_lng;
    new.location_updated_at := old.location_updated_at;
    new.location_updated_by := old.location_updated_by;
    return new;
  end if;

  new.location_lat := null;
  new.location_lng := null;
  new.location_updated_at := now();
  new.location_updated_by := (select auth.uid());
  if new.neighborhood_id is not null then
    new.location_status := 'inferred';
    new.location_source := 'captura';
    new.location_confidence := 0.80;
    return new;
  end if;
  if tg_op = 'INSERT' and new.primary_mention_id is not null then
    select * into v_class from public.classifications c where c.mention_id = new.primary_mention_id;
    if v_class.neighborhood_id is not null then
      new.neighborhood_id := v_class.neighborhood_id;
      new.location_status := 'inferred';
      new.location_source := case when v_class.corrected_at is not null then 'clasificacion_revisada' else 'clasificacion' end;
      new.location_confidence := case when v_class.corrected_at is not null then 0.80
                                      else least(coalesce(v_class.confidence, 0.5), 0.70) end;
      return new;
    end if;
  end if;
  new.location_status := 'unavailable';
  new.location_source := 'sin_dato';
  new.location_confidence := null;
  return new;
end;
$$;
create trigger cases_infer_location
  before insert or update of neighborhood_id, location_status, location_source, location_confidence, location_lat, location_lng
  on public.cases
  for each row execute function private.infer_case_location();

-- History of every location change (any path: RPCs, edits, backfill).
create function private.log_case_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.location_status, new.location_source, new.location_confidence, new.neighborhood_id, new.location_lat, new.location_lng)
     is not distinct from (old.location_status, old.location_source, old.location_confidence, old.neighborhood_id, old.location_lat, old.location_lng) then
    return null;
  end if;
  insert into public.case_location_events (org_id, case_id, actor_id, actor_name, status, source, confidence, neighborhood_id, lat, lng, reason, previous)
  select new.org_id, new.id, a.actor_id, a.actor_name, new.location_status, new.location_source, new.location_confidence,
         new.neighborhood_id, new.location_lat, new.location_lng, nullif(current_setting('app.case_location_reason', true), ''),
         case when tg_op = 'UPDATE' then jsonb_build_object('status', old.location_status, 'source', old.location_source,
                                                            'confidence', old.location_confidence, 'neighborhood_id', old.neighborhood_id,
                                                            'lat', old.location_lat, 'lng', old.location_lng) end
  from private.case_actor() a;
  return null;
end;
$$;
create trigger cases_log_location after insert or update on public.cases
  for each row execute function private.log_case_location();

-- Point in a colonia's polygon (GeoJSON Polygon or MultiPolygon, as a bare
-- geometry or a Feature): ray casting over every ring (holes subtract).
create function private.point_in_geojson(p_geojson jsonb, p_lng numeric, p_lat numeric)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_geom jsonb := case when p_geojson ? 'geometry' then p_geojson -> 'geometry' else p_geojson end;
  v_polys jsonb;
  v_poly jsonb;
  v_ring jsonb;
  v_inside boolean;
  v_in_poly boolean;
  v_n integer;
  i integer;
  j integer;
  xi numeric; yi numeric; xj numeric; yj numeric;
  v_ring_index integer;
begin
  if v_geom ->> 'type' = 'Polygon' then
    v_polys := jsonb_build_array(v_geom -> 'coordinates');
  elsif v_geom ->> 'type' = 'MultiPolygon' then
    v_polys := v_geom -> 'coordinates';
  else
    return null;
  end if;
  for v_poly in select * from jsonb_array_elements(v_polys) loop
    v_in_poly := false;
    v_ring_index := 0;
    for v_ring in select * from jsonb_array_elements(v_poly) loop
      v_inside := false;
      v_n := jsonb_array_length(v_ring);
      j := v_n - 1;
      for i in 0 .. v_n - 1 loop
        xi := (v_ring -> i ->> 0)::numeric; yi := (v_ring -> i ->> 1)::numeric;
        xj := (v_ring -> j ->> 0)::numeric; yj := (v_ring -> j ->> 1)::numeric;
        if ((yi > p_lat) <> (yj > p_lat)) and (p_lng < (xj - xi) * (p_lat - yi) / nullif(yj - yi, 0) + xi) then
          v_inside := not v_inside;
        end if;
        j := i;
      end loop;
      if v_ring_index = 0 then
        v_in_poly := v_inside;
      elsif v_inside then
        v_in_poly := false; -- inside a hole
      end if;
      v_ring_index := v_ring_index + 1;
    end loop;
    if v_in_poly then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

-- An analyst confirms or corrects the location: the colonia, and optionally
-- a point inside it (when the colonia has a drawn polygon). Correcting a
-- confirmed location or changing the colonia needs a reason.
create function public.set_case_location(p_case_id uuid, p_neighborhood_id uuid, p_lat numeric default null, p_lng numeric default null, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.cases;
  v_colonia public.neighborhoods;
begin
  select * into v_case from public.cases where id = p_case_id for update;
  if v_case.id is null or not private.is_case_coordinator(v_case.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_case.status = 'merged' then
    raise exception 'El caso fue fusionado: ubica el caso destino.' using errcode = '22023';
  end if;
  select * into v_colonia from public.neighborhoods n where n.id = p_neighborhood_id and n.org_id = v_case.org_id;
  if v_colonia.id is null then
    raise exception 'Elige una colonia del municipio.' using errcode = '22023';
  end if;
  if (p_lat is null) <> (p_lng is null) then
    raise exception 'El punto necesita latitud y longitud.' using errcode = '22023';
  end if;
  if p_lat is not null and not (p_lat between 14 and 33 and p_lng between -119 and -86) then
    raise exception 'El punto está fuera de México.' using errcode = '22023';
  end if;
  -- A point must fall inside a drawn polygon; approximate zones and colonias
  -- without polygon do not prove anything, so they accept it as given.
  if p_lat is not null and v_colonia.geojson is not null and coalesce(v_colonia.shape_source, 'file') <> 'osm_approx'
     and private.point_in_geojson(v_colonia.geojson, p_lng, p_lat) is false then
    raise exception 'El punto no está dentro de la colonia %.', v_colonia.name using errcode = '22023';
  end if;
  if (v_case.location_status = 'confirmed' or v_case.neighborhood_id is distinct from p_neighborhood_id)
     and char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Escribe el motivo de la corrección.' using errcode = '22023';
  end if;

  perform set_config('app.case_location', 'on', true);
  perform set_config('app.case_location_reason', coalesce(btrim(p_reason), ''), true);
  update public.cases
  set neighborhood_id = p_neighborhood_id, location_status = 'confirmed', location_source = 'analista', location_confidence = 1,
      location_lat = round(p_lat, 5), location_lng = round(p_lng, 5),
      location_updated_at = now(), location_updated_by = (select auth.uid()), updated_at = now()
  where id = p_case_id;
  perform set_config('app.case_location', '', true);
  perform set_config('app.case_location_reason', '', true);
  perform private.log_case_event(v_case.org_id, p_case_id,
    case when v_case.location_status = 'confirmed' then 'location_corrected' else 'location_confirmed' end, null, null, p_reason,
    jsonb_build_object('neighborhood_id', jsonb_build_array(v_case.neighborhood_id, p_neighborhood_id), 'point', p_lat is not null));
  return jsonb_build_object('status', 'confirmed', 'neighborhood_id', p_neighborhood_id,
    'operation', case when v_case.location_status = 'confirmed' then 'location_corrected' else 'location_confirmed' end);
end;
$$;

-- The location was wrong and there is none: no colonia, no point.
create function public.clear_case_location(p_case_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.cases;
begin
  select * into v_case from public.cases where id = p_case_id for update;
  if v_case.id is null or not private.is_case_coordinator(v_case.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Escribe por qué no hay ubicación.' using errcode = '22023';
  end if;
  perform set_config('app.case_location', 'on', true);
  perform set_config('app.case_location_reason', btrim(p_reason), true);
  update public.cases
  set neighborhood_id = null, location_status = 'unavailable', location_source = 'analista', location_confidence = null,
      location_lat = null, location_lng = null, location_updated_at = now(), location_updated_by = (select auth.uid()), updated_at = now()
  where id = p_case_id;
  perform set_config('app.case_location', '', true);
  perform set_config('app.case_location_reason', '', true);
  perform private.log_case_event(v_case.org_id, p_case_id, 'location_cleared', null, null, p_reason,
    jsonb_build_object('neighborhood_id', jsonb_build_array(v_case.neighborhood_id, null)));
end;
$$;

-- ---------------------------------------------------------------------------
-- Map queries
-- ---------------------------------------------------------------------------
-- The cases of the map, one row each, with the filters of /casos:
-- from/to (opened, Mexico City days), neighborhood (uuid or "none"),
-- category, priority, status ("open" by default, "all" or one status),
-- department. Security invoker: RLS decides which cases each role sees.
-- Points only for confirmed locations, rounded to 3 decimals (~100 m).
create function public.map_case_rows(p_org_id uuid, p_filters jsonb default '{}')
returns table (
  id uuid, folio text, status public.case_status, priority public.priority, category text,
  neighborhood_id uuid, department_id uuid, location_status text, location_confidence numeric,
  lat numeric, lng numeric, overdue boolean, opened_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select k.id, k.folio, k.status, k.priority, k.category, k.neighborhood_id, k.department_id,
         k.location_status, k.location_confidence,
         case when k.location_status = 'confirmed' then round(k.location_lat, 3) end,
         case when k.location_status = 'confirmed' then round(k.location_lng, 3) end,
         coalesce(case when k.status = 'assigned' then least(k.accept_due_at, k.due_at)
                       when k.status in ('accepted', 'in_progress') then k.due_at end < now(), false),
         k.opened_at
  from public.cases k
  where k.org_id = p_org_id
    and (p_filters ->> 'from' is null or k.opened_at >= ((p_filters ->> 'from')::date::timestamp at time zone 'America/Mexico_City'))
    and (p_filters ->> 'to' is null or k.opened_at < (((p_filters ->> 'to')::date + 1)::timestamp at time zone 'America/Mexico_City'))
    and (p_filters ->> 'neighborhood' is null
         or (p_filters ->> 'neighborhood' = 'none' and k.neighborhood_id is null)
         or (p_filters ->> 'neighborhood' <> 'none' and k.neighborhood_id = (p_filters ->> 'neighborhood')::uuid))
    and (p_filters ->> 'category' is null or k.category = p_filters ->> 'category')
    and (p_filters ->> 'priority' is null or k.priority = (p_filters ->> 'priority')::public.priority)
    and (p_filters ->> 'department' is null or k.department_id = (p_filters ->> 'department')::uuid)
    and case coalesce(p_filters ->> 'status', 'open')
          when 'open' then k.status in ('new', 'in_review', 'assigned', 'accepted', 'in_progress', 'resolved', 'returned')
          when 'all' then true
          else k.status::text = p_filters ->> 'status' end
  order by k.opened_at desc, k.id;
$$;

-- Mentions of the conversation layer without colonia: how many and the
-- latest (no text or author: the inbox shows them under its own rules).
create function public.map_unlocated_mentions(
  p_org_id uuid, p_from timestamptz, p_to timestamptz,
  p_topic text default null, p_department uuid default null, p_sentiment public.sentiment default null, p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.can_read_all(p_org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  with base as (
    select m.id, m.published_at, c.topic, c.sentiment, c.priority, c.intent in ('queja', 'denuncia') as complaint
    from public.mentions m
    left join public.classifications c on c.mention_id = m.id
    where m.org_id = p_org_id and m.published_at >= p_from and m.published_at < p_to
      and c.neighborhood_id is null
      and (p_topic is null or c.topic = p_topic)
      and (p_department is null or c.department_id = p_department)
      and (p_sentiment is null or c.sentiment = p_sentiment)
  )
  select jsonb_build_object(
    'count', (select count(*) from base),
    'complaints', (select count(*) from base where complaint),
    'items', coalesce((select jsonb_agg(to_jsonb(x) order by x.published_at desc)
                       from (select b.id, b.published_at, b.topic, b.sentiment, b.priority, coalesce(b.complaint, false) as complaint
                             from base b order by b.published_at desc, b.id limit least(greatest(coalesce(p_limit, 50), 1), 200)) x), '[]'))
  into v_result;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Backfill (repeatable: cases without a location source)
-- ---------------------------------------------------------------------------
-- A colonia already on a case was captured, not confirmed: inferred. Cases
-- without one stay without location (their colonia is not filled in here,
-- so the rollback leaves the cases as they were).
select set_config('app.case_location', 'on', true);
update public.cases
set location_status = 'inferred', location_source = 'captura', location_confidence = 0.80, location_updated_at = now()
where location_source is null and neighborhood_id is not null;
update public.cases
set location_status = 'unavailable', location_source = 'sin_dato', location_updated_at = now()
where location_source is null;
select set_config('app.case_location', '', true);

-- From now on a colonia means a location and the other way around.
alter table public.cases
  add constraint cases_location_colonia check ((location_status = 'unavailable') = (neighborhood_id is null));

-- ---------------------------------------------------------------------------
-- Read policy of cases at scale. The original policy evaluated
-- can_read_all(org_id) and case_visible_to_department(org_id, id) once per
-- row (~0.1 ms each: 2.3 s for 20 000 cases in /casos and the map). Same
-- rule, as uncorrelated sets the planner computes once per query.
-- ---------------------------------------------------------------------------

-- Orgs where the caller reads everything (admin, comunicación, lectura).
create function private.read_all_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.org_id from public.memberships m
  where m.user_id = (select auth.uid()) and m.role in ('admin', 'comunicacion', 'lectura');
$$;

-- Cases where the caller's department has (or had) an assignment:
-- exactly case_visible_to_department, for every case at once.
create function private.department_case_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.case_id
  from public.tickets t
  join public.memberships m
    on m.org_id = t.org_id and m.user_id = (select auth.uid()) and m.role = 'dependencia' and m.department_id = t.department_id
  where t.case_id is not null;
$$;
revoke execute on function private.read_all_org_ids(), private.department_case_ids() from public, anon;
-- Called by the RLS policy, as the querying user.
grant execute on function private.read_all_org_ids(), private.department_case_ids() to authenticated;

drop policy "read cases" on public.cases;
create policy "read cases" on public.cases for select to authenticated
  using (org_id in (select private.read_all_org_ids()) or id in (select private.department_case_ids()));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function private.infer_case_location() from public, anon, authenticated;
revoke execute on function private.log_case_location() from public, anon, authenticated;
revoke execute on function private.point_in_geojson(jsonb, numeric, numeric) from public, anon, authenticated;
revoke execute on function public.set_case_location(uuid, uuid, numeric, numeric, text) from public, anon;
revoke execute on function public.clear_case_location(uuid, text) from public, anon;
revoke execute on function public.map_case_rows(uuid, jsonb) from public, anon;
revoke execute on function public.map_unlocated_mentions(uuid, timestamptz, timestamptz, text, uuid, public.sentiment, integer) from public, anon;
grant execute on function public.set_case_location(uuid, uuid, numeric, numeric, text) to authenticated;
grant execute on function public.clear_case_location(uuid, text) to authenticated;
grant execute on function public.map_case_rows(uuid, jsonb) to authenticated;
grant execute on function public.map_unlocated_mentions(uuid, timestamptz, timestamptz, text, uuid, public.sentiment, integer) to authenticated;
