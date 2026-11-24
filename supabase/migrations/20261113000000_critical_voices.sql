-- Voces críticas: what the negative conversation is about, without identities.
--
-- critical_voices() aggregates the classified negative mentions of a period
-- (and the period right before it) by topic, neighborhood, department,
-- platform and emotion, plus the publications with most reach and a sample of
-- texts for the frequent terms. It never returns authors: the panel reads
-- what is said, not who says it (CLAUDE.md: no profiles of citizens,
-- journalists or opponents). Same readers as the dashboard. Read from the base
-- tables, like kpi_snapshot, so its figures reconcile with the KPI cards.
--
-- Additive and repeatable. Rollback: docs/rollback/20261113000000_critical_voices.down.sql.

create or replace function public.critical_voices(
  p_org_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_prev_from timestamptz,
  p_prev_to timestamptz,
  p_bucket text default 'day'
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
  if p_bucket not in ('hour', 'day') then
    raise exception 'invalid bucket' using errcode = '22023';
  end if;
  if p_from >= p_to or p_prev_from >= p_prev_to or p_to - p_from > interval '93 days' then
    raise exception 'invalid period' using errcode = '22023';
  end if;

  with base as (
    select m.id, m.text, m.url, m.published_at, m.metrics, m.source_id,
      c.sentiment, c.topic, c.neighborhood_id, c.department_id, c.emotion,
      (m.published_at >= p_from) as is_current
    from public.mentions m
    join public.classifications c on c.mention_id = m.id
    where m.org_id = p_org_id
      and c.sentiment is not null
      and ((m.published_at >= p_from and m.published_at < p_to)
        or (m.published_at >= p_prev_from and m.published_at < p_prev_to))
  ),
  neg as (
    select * from base where sentiment = 'negative'
  ),
  series as (
    select
      case when p_bucket = 'hour' then date_trunc('hour', b.published_at)
           else (date_trunc('day', b.published_at at time zone 'America/Mexico_City')) at time zone 'America/Mexico_City'
      end as bucket,
      count(*) filter (where b.sentiment = 'negative') as negative,
      count(*) as classified
    from base b where b.is_current
    group by 1
  ),
  topics as (
    select b.topic,
      count(*) filter (where b.is_current and b.sentiment = 'negative') as negative,
      count(*) filter (where not b.is_current and b.sentiment = 'negative') as prev_negative,
      count(*) filter (where b.is_current) as classified
    from base b where b.topic is not null
    group by 1
  ),
  places as (
    select n.id, n.name,
      count(*) filter (where b.is_current) as negative,
      count(*) filter (where not b.is_current) as prev_negative
    from neg b join public.neighborhoods n on n.id = b.neighborhood_id
    group by n.id, n.name
  ),
  departments as (
    select d.id, d.name,
      count(*) filter (where b.is_current) as negative,
      count(*) filter (where not b.is_current) as prev_negative
    from neg b join public.departments d on d.id = b.department_id
    group by d.id, d.name
  ),
  platforms as (
    select s.type::text as type, count(*) as negative
    from neg b join public.sources s on s.id = b.source_id
    where b.is_current
    group by 1
  ),
  emotions as (
    select b.emotion, count(*) as negative
    from neg b where b.is_current and b.emotion is not null
    group by 1
  ),
  reach as (
    select b.id, b.text, b.url, b.published_at, b.topic, s.type::text as source_type, n.name as neighborhood,
      coalesce((b.metrics ->> 'likes')::bigint, 0) + coalesce((b.metrics ->> 'shares')::bigint, 0)
        + coalesce((b.metrics ->> 'comments')::bigint, 0) as interactions
    from neg b
    join public.sources s on s.id = b.source_id
    left join public.neighborhoods n on n.id = b.neighborhood_id
    where b.is_current
  )
  select jsonb_build_object(
    'totals', (select jsonb_build_object(
        'negative', count(*) filter (where is_current and sentiment = 'negative'),
        'classified', count(*) filter (where is_current),
        'prev_negative', count(*) filter (where not is_current and sentiment = 'negative'),
        'prev_classified', count(*) filter (where not is_current)) from base),
    'series', coalesce((select jsonb_agg(to_jsonb(s) order by s.bucket) from series s), '[]'),
    'topics', coalesce((select jsonb_agg(to_jsonb(t) order by t.negative desc, t.topic)
        from topics t where t.negative > 0 or t.prev_negative > 0), '[]'),
    'neighborhoods', coalesce((select jsonb_agg(to_jsonb(p) order by p.negative desc, p.name) from places p), '[]'),
    'departments', coalesce((select jsonb_agg(to_jsonb(d) order by d.negative desc, d.name) from departments d), '[]'),
    'platforms', coalesce((select jsonb_agg(to_jsonb(p) order by p.negative desc, p.type) from platforms p), '[]'),
    'emotions', coalesce((select jsonb_agg(to_jsonb(e) order by e.negative desc, e.emotion) from emotions e), '[]'),
    'top', coalesce((select jsonb_agg(to_jsonb(r)) from (
        select * from reach order by interactions desc, published_at desc limit 8) r), '[]'),
    -- Texts for the frequent terms (computed by the app, which also strips @handles and links).
    'texts', coalesce((select jsonb_agg(x.text) from (
        select text from neg where is_current order by published_at desc limit 1000) x), '[]')
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.critical_voices(uuid, timestamptz, timestamptz, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.critical_voices(uuid, timestamptz, timestamptz, timestamptz, timestamptz, text) to authenticated;
