-- Map of colonias: where each polygon came from, per-colonia stats with the
-- previous period and filters, and the detail panel of one colonia.

-- 'file' (uploaded GeoJSON), 'osm' (outline drawn in OpenStreetMap) or
-- 'osm_approx' (zone derived from an OSM point; shown dashed on the map).
alter table public.neighborhoods
  add column shape_source text check (shape_source in ('file', 'osm', 'osm_approx'));

update public.neighborhoods set shape_source = 'file' where geojson is not null;

-- ---------------------------------------------------------------------------
-- map_stats: mentions, complaints and sentiment per colonia for a period and
-- the one before it, optionally filtered by topic, department and sentiment.
-- ---------------------------------------------------------------------------
create function public.map_stats(
  p_org_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_prev_from timestamptz,
  p_topic text default null,
  p_department uuid default null,
  p_sentiment public.sentiment default null
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
    select s.*, s.hour >= p_from as current
    from public.mention_stats_hourly s
    where s.org_id = p_org_id and s.hour >= p_prev_from and s.hour < p_to
      and (p_topic is null or s.topic = p_topic)
      and (p_department is null or s.department_id = p_department)
      and (p_sentiment is null or s.sentiment = p_sentiment)
  ),
  per_colonia as (
    select b.neighborhood_id as id,
      coalesce(sum(b.mentions) filter (where b.current), 0) as total,
      coalesce(sum(b.mentions) filter (where b.current and b.complaint), 0) as complaints,
      coalesce(sum(b.mentions) filter (where b.current and b.sentiment = 'positive'), 0) as positive,
      coalesce(sum(b.mentions) filter (where b.current and b.sentiment = 'neutral'), 0) as neutral,
      coalesce(sum(b.mentions) filter (where b.current and b.sentiment = 'negative'), 0) as negative,
      coalesce(sum(b.mentions) filter (where not b.current), 0) as prev_total,
      coalesce(sum(b.mentions) filter (where not b.current and b.complaint), 0) as prev_complaints,
      coalesce(sum(b.mentions) filter (where not b.current and b.sentiment is not null), 0) as prev_classified,
      coalesce(sum(b.mentions) filter (where not b.current and b.sentiment = 'positive'), 0) as prev_positive,
      coalesce(sum(b.mentions) filter (where not b.current and b.sentiment = 'negative'), 0) as prev_negative
    from base b
    where b.neighborhood_id is not null
    group by 1
  ),
  colonia_topics as (
    select x.neighborhood_id, jsonb_agg(jsonb_build_object('topic', x.topic, 'total', x.total) order by x.total desc, x.topic) as topics
    from (
      select b.neighborhood_id, b.topic, sum(b.mentions) as total,
        row_number() over (partition by b.neighborhood_id order by sum(b.mentions) desc, b.topic) as rank
      from base b
      where b.current and b.neighborhood_id is not null and b.topic is not null
      group by 1, 2
    ) x
    where x.rank <= 3
    group by 1
  ),
  -- Filter options: every topic of the period (unfiltered by topic itself).
  all_topics as (
    select distinct s.topic
    from public.mention_stats_hourly s
    where s.org_id = p_org_id and s.hour >= p_from and s.hour < p_to and s.topic is not null
  )
  select jsonb_build_object(
    'neighborhoods', coalesce((
      select jsonb_agg(to_jsonb(p) || jsonb_build_object('topics', coalesce(t.topics, '[]'::jsonb)) order by p.total desc)
      from per_colonia p left join colonia_topics t on t.neighborhood_id = p.id), '[]'::jsonb),
    'unassigned', (select coalesce(sum(b.mentions), 0) from base b where b.current and b.neighborhood_id is null),
    'total', (select coalesce(sum(b.mentions), 0) from base b where b.current),
    'topics', coalesce((select jsonb_agg(a.topic order by a.topic) from all_topics a), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke execute on function public.map_stats(uuid, timestamptz, timestamptz, timestamptz, text, uuid, public.sentiment) from public, anon;
grant execute on function public.map_stats(uuid, timestamptz, timestamptz, timestamptz, text, uuid, public.sentiment) to authenticated;

-- ---------------------------------------------------------------------------
-- neighborhood_detail: the side panel of one colonia. Topics and sentiment of
-- the period, routed tickets per department (open now, overdue, resolved in
-- the period) and the latest mentions. Never authors: the panel is about the
-- place, not about who wrote.
-- ---------------------------------------------------------------------------
create function public.neighborhood_detail(p_org_id uuid, p_neighborhood_id uuid, p_from timestamptz, p_to timestamptz)
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

  with m as (
    select mm.id, mm.text, mm.url, mm.published_at, c.sentiment, c.topic, c.intent
    from public.mentions mm
    join public.classifications c on c.mention_id = mm.id
    where mm.org_id = p_org_id and c.neighborhood_id = p_neighborhood_id
  ),
  in_period as (
    select * from m where m.published_at >= p_from and m.published_at < p_to
  ),
  topics as (
    select ip.topic, count(*) as total,
      count(*) filter (where ip.sentiment = 'negative') as negative,
      count(*) filter (where ip.intent in ('queja', 'denuncia')) as complaints
    from in_period ip where ip.topic is not null
    group by 1
  ),
  tickets as (
    select t.department_id as id, d.name,
      count(*) filter (where t.status in ('open', 'in_progress')) as open,
      count(*) filter (where t.status in ('open', 'in_progress') and t.due_at < now()) as overdue,
      count(*) filter (where t.resolved_at >= p_from and t.resolved_at < p_to) as resolved
    from public.tickets t
    join m on m.id = t.mention_id
    join public.departments d on d.id = t.department_id
    where t.org_id = p_org_id
    group by 1, 2
  )
  select jsonb_build_object(
    'id', n.id,
    'name', n.name,
    'shape_source', n.shape_source,
    'totals', (select jsonb_build_object(
        'mentions', count(*),
        'complaints', count(*) filter (where ip.intent in ('queja', 'denuncia')),
        'positive', count(*) filter (where ip.sentiment = 'positive'),
        'neutral', count(*) filter (where ip.sentiment = 'neutral'),
        'negative', count(*) filter (where ip.sentiment = 'negative')) from in_period ip),
    'topics', coalesce((select jsonb_agg(to_jsonb(t) order by t.total desc, t.topic) from (select * from topics order by total desc, topic limit 6) t), '[]'::jsonb),
    'tickets', coalesce((select jsonb_agg(to_jsonb(k) order by k.open desc, k.name)
        from tickets k where k.open > 0 or k.resolved > 0), '[]'::jsonb),
    'latest', coalesce((select jsonb_agg(to_jsonb(l) order by l.published_at desc) from (
        select ip.id, left(ip.text, 280) as text, ip.url, ip.published_at, ip.sentiment, ip.topic
        from in_period ip order by ip.published_at desc limit 5) l), '[]'::jsonb)
  )
  into v_result
  from public.neighborhoods n
  where n.id = p_neighborhood_id and n.org_id = p_org_id;

  return v_result;
end;
$$;

revoke execute on function public.neighborhood_detail(uuid, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.neighborhood_detail(uuid, uuid, timestamptz, timestamptz) to authenticated;
