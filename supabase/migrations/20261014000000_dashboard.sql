-- Executive dashboard: richer hourly rollup (topic, neighborhood, complaint)
-- and one function that returns everything the page needs in a single call.

-- ---------------------------------------------------------------------------
-- Hourly rollup with the dimensions the dashboard slices by
-- ---------------------------------------------------------------------------

drop function public.mention_stats(uuid, timestamptz, timestamptz);
drop materialized view public.mention_stats_hourly;

-- One row per (org, hour, sentiment, department, neighborhood, topic, complaint).
-- sentiment is null while a mention is still pending classification.
create materialized view public.mention_stats_hourly as
select
  m.org_id,
  date_trunc('hour', m.published_at) as hour,
  c.sentiment,
  c.department_id,
  c.neighborhood_id,
  c.topic,
  coalesce(c.intent in ('queja', 'denuncia'), false) as complaint,
  count(*)::integer as mentions,
  coalesce(sum((m.metrics ->> 'likes')::bigint), 0)
    + coalesce(sum((m.metrics ->> 'shares')::bigint), 0)
    + coalesce(sum((m.metrics ->> 'comments')::bigint), 0) as interactions
from public.mentions m
left join public.classifications c on c.mention_id = m.id
group by 1, 2, 3, 4, 5, 6, 7
with no data;

create unique index mention_stats_hourly_key
  on public.mention_stats_hourly (org_id, hour, sentiment, department_id, neighborhood_id, topic, complaint)
  nulls not distinct;

revoke all on public.mention_stats_hourly from public, anon, authenticated;
refresh materialized view public.mention_stats_hourly;

-- Same signature and columns as before, now summed over the new dimensions.
create function public.mention_stats(p_org_id uuid, p_from timestamptz, p_to timestamptz)
returns table (
  hour timestamptz,
  sentiment public.sentiment,
  department_id uuid,
  mentions integer,
  interactions bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.hour, s.sentiment, s.department_id, sum(s.mentions)::integer, sum(s.interactions)::bigint
  from public.mention_stats_hourly s
  where s.org_id = p_org_id
    and s.hour >= p_from
    and s.hour < p_to
    and private.can_read_all(p_org_id)
  group by 1, 2, 3
  order by 1;
$$;
revoke execute on function public.mention_stats(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.mention_stats(uuid, timestamptz, timestamptz) to authenticated;

-- Refreshed by the ingest and classify crons (service role) after they write.
create function public.refresh_mention_stats()
returns void
language sql
security definer
set search_path = ''
as $$
  select private.refresh_mention_stats();
$$;
revoke execute on function public.refresh_mention_stats() from public, anon, authenticated;
grant execute on function public.refresh_mention_stats() to service_role;

-- ---------------------------------------------------------------------------
-- Dashboard payload
-- ---------------------------------------------------------------------------
-- Volume and sentiment come from the rollup; tickets, top mentions and media
-- from the base tables. Readers of the whole org only (not dependencia).
-- p_bucket: 'hour' or 'day' (calendar day in America/Mexico_City).
-- p_detail = false returns only the totals (used for the previous period).

create function public.dashboard_stats(
  p_org_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_bucket text default 'day',
  p_detail boolean default true
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_totals jsonb;
  v_result jsonb;
begin
  if not private.can_read_all(p_org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_bucket not in ('hour', 'day') then
    raise exception 'invalid bucket' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'mentions', coalesce(sum(s.mentions), 0),
    'classified', coalesce(sum(s.mentions) filter (where s.sentiment is not null), 0),
    'positive', coalesce(sum(s.mentions) filter (where s.sentiment = 'positive'), 0),
    'neutral', coalesce(sum(s.mentions) filter (where s.sentiment = 'neutral'), 0),
    'negative', coalesce(sum(s.mentions) filter (where s.sentiment = 'negative'), 0),
    'interactions', coalesce(sum(s.interactions), 0)
  )
  into v_totals
  from public.mention_stats_hourly s
  where s.org_id = p_org_id and s.hour >= p_from and s.hour < p_to;

  -- Complaints routed in the period that are still open, and mean time to
  -- resolve the tickets closed in the period (hours).
  v_totals := v_totals || (
    select jsonb_build_object(
      'open_tickets', count(*) filter (
        where t.created_at >= p_from and t.created_at < p_to and t.status in ('open', 'in_progress')),
      'resolved_tickets', count(*) filter (where t.resolved_at >= p_from and t.resolved_at < p_to),
      'attention_hours', round((avg(extract(epoch from t.resolved_at - t.created_at) / 3600.0)
        filter (where t.resolved_at >= p_from and t.resolved_at < p_to))::numeric, 1)
    )
    from public.tickets t
    where t.org_id = p_org_id
  );

  if not p_detail then
    return jsonb_build_object('totals', v_totals);
  end if;

  with base as (
    select * from public.mention_stats_hourly s
    where s.org_id = p_org_id and s.hour >= p_from and s.hour < p_to
  ),
  series as (
    select
      case when p_bucket = 'hour' then b.hour
           else (date_trunc('day', b.hour at time zone 'America/Mexico_City')) at time zone 'America/Mexico_City'
      end as bucket,
      sum(b.mentions) filter (where b.sentiment = 'positive') as positive,
      sum(b.mentions) filter (where b.sentiment = 'neutral') as neutral,
      sum(b.mentions) filter (where b.sentiment = 'negative') as negative,
      sum(b.mentions) filter (where b.sentiment is null) as pending
    from base b
    group by 1
  ),
  topics as (
    select b.topic, sum(b.mentions) as total,
      sum(b.mentions) filter (where b.sentiment = 'positive') as positive,
      sum(b.mentions) filter (where b.sentiment = 'negative') as negative
    from base b where b.topic is not null
    group by 1
  ),
  departments as (
    select b.department_id as id, sum(b.mentions) as total,
      sum(b.mentions) filter (where b.sentiment = 'positive') as positive,
      sum(b.mentions) filter (where b.sentiment = 'negative') as negative
    from base b where b.department_id is not null
    group by 1
  ),
  neighborhoods as (
    select b.neighborhood_id as id, sum(b.mentions) as total,
      sum(b.mentions) filter (where b.complaint) as complaints,
      sum(b.mentions) filter (where b.sentiment = 'negative') as negative
    from base b where b.neighborhood_id is not null
    group by 1
  ),
  reach as (
    select m.id, m.text, m.url, m.published_at, m.source_id, c.sentiment,
      a.display_name, a.handle, a.kind,
      coalesce((m.metrics ->> 'likes')::bigint, 0) + coalesce((m.metrics ->> 'shares')::bigint, 0)
        + coalesce((m.metrics ->> 'comments')::bigint, 0) as interactions
    from public.mentions m
    left join public.classifications c on c.mention_id = m.id
    left join public.authors a on a.id = m.author_id
    where m.org_id = p_org_id and m.published_at >= p_from and m.published_at < p_to
  ),
  -- Author rankings are limited to media and public figures (see CLAUDE.md).
  media as (
    select a.id, coalesce(a.display_name, a.handle) as name, a.kind, count(*) as mentions,
      sum(r.interactions) as interactions,
      count(*) filter (where r.sentiment = 'positive') as positive,
      count(*) filter (where r.sentiment = 'negative') as negative
    from reach r
    join public.mentions m on m.id = r.id
    join public.authors a on a.id = m.author_id
    where a.kind in ('media', 'public_figure')
    group by a.id, a.display_name, a.handle, a.kind
  )
  select jsonb_build_object(
    'totals', v_totals,
    'series', coalesce((select jsonb_agg(jsonb_build_object(
        'bucket', s.bucket, 'positive', coalesce(s.positive, 0), 'neutral', coalesce(s.neutral, 0),
        'negative', coalesce(s.negative, 0), 'pending', coalesce(s.pending, 0)) order by s.bucket) from series s), '[]'),
    'topics', coalesce((select jsonb_agg(to_jsonb(t) order by t.total desc) from topics t), '[]'),
    'departments', coalesce((select jsonb_agg(to_jsonb(d) order by d.total desc) from departments d), '[]'),
    'neighborhoods', coalesce((select jsonb_agg(to_jsonb(n) order by n.complaints desc nulls last) from neighborhoods n), '[]'),
    'top_mentions', coalesce((select jsonb_agg(to_jsonb(r)) from (
        select * from reach order by interactions desc, published_at desc limit 5) r), '[]'),
    'top_media', coalesce((select jsonb_agg(to_jsonb(x)) from (
        select * from media order by mentions desc, interactions desc limit 5) x), '[]')
  )
  into v_result;

  return v_result;
end;
$$;

revoke execute on function public.dashboard_stats(uuid, timestamptz, timestamptz, text, boolean) from public, anon;
grant execute on function public.dashboard_stats(uuid, timestamptz, timestamptz, text, boolean) to authenticated;

-- Ticket KPIs filter by creation date (the rollup's unique index already leads with org_id, hour).
create index tickets_org_created_idx on public.tickets (org_id, created_at);
