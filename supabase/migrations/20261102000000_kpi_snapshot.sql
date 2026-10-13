-- Stage 9: KPIs split into conversation/perception and attention/compliance,
-- one consistent snapshot per query, versioned reports.
--
--   * kpi_snapshot(): every figure of the dashboard's KPI cards and of the
--     reports, read from the base tables (not the hourly rollup) in one
--     statement, so they share one MVCC snapshot. Mentions are counted as
--     mentions (publications); incidents are cases. Each KPI is defined in
--     src/lib/kpi/dictionary.ts (versioned) and docs/etapa-9-kpi.md.
--   * report_context(): texts and examples for the narrative (per-bucket topics
--     and mentions, representative mentions, alerts), and report_snapshot()
--     returning both in one call.
--   * reports: version, previous_version_id (a revision of an approved report
--     is a new draft linked to it), kpi_version and snapshot_at; facts are
--     written only by the server; an approval needs facts.
--
-- Additive. Rollback: docs/rollback/20261102000000_kpi_snapshot.down.sql.

-- ---------------------------------------------------------------------------
-- Conversation and perception (unit: mentions)
-- ---------------------------------------------------------------------------
create function private.kpi_conversation(p_org_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'mentions', count(*),
    -- Classified: the mention has a classification with a sentiment (the
    -- same rule as mention_stats_hourly, so both reconcile).
    'classified', count(*) filter (where c.sentiment is not null),
    'unclassified', count(*) filter (where c.sentiment is null),
    'pending', count(*) filter (where c.sentiment is null and m.status = 'pending'),
    'failed', count(*) filter (where c.sentiment is null and m.status = 'failed'),
    'positive', count(*) filter (where c.sentiment = 'positive'),
    'neutral', count(*) filter (where c.sentiment = 'neutral'),
    'negative', count(*) filter (where c.sentiment = 'negative'),
    'complaints', count(*) filter (where c.sentiment is not null and c.intent in ('queja', 'denuncia')),
    'reviewed', count(*) filter (where c.corrected_at is not null or c.confirmed_at is not null),
    'without_neighborhood', count(*) filter (where c.sentiment is not null and c.neighborhood_id is null),
    'without_topic', count(*) filter (where c.sentiment is not null and c.topic is null),
    'discarded', count(*) filter (where m.triage = 'discarded'),
    'interactions', coalesce(sum(
      coalesce((m.metrics ->> 'likes')::bigint, 0) + coalesce((m.metrics ->> 'shares')::bigint, 0)
      + coalesce((m.metrics ->> 'comments')::bigint, 0)), 0)
  )
  from public.mentions m
  left join public.classifications c on c.mention_id = m.id
  where m.org_id = p_org_id and m.published_at >= p_from and m.published_at < p_to;
$$;

-- ---------------------------------------------------------------------------
-- Attention and compliance (unit: cases). A merged case is a duplicate: its
-- work lives in the case it was merged into, so it is never counted.
-- ---------------------------------------------------------------------------

-- State of every case at an instant: the last milestone up to then (the case's
-- current state when it has none, i.e. rows from before the milestones).
create function private.case_states_at(p_org_id uuid, p_cut timestamptz)
returns table (
  case_id uuid, department_id uuid, status public.case_status, opened_at timestamptz,
  due_at timestamptz, accept_due_at timestamptz, category text, priority public.priority,
  neighborhood_id uuid, folio text, location_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  -- The last milestone of every case up to the cut, in one sorted pass.
  with last as (
    select distinct on (ms.case_id) ms.case_id, ms.status
    from public.case_milestones ms
    where ms.org_id = p_org_id and ms.at <= p_cut
    order by ms.case_id, ms.at desc, ms.id desc
  )
  select k.id, k.department_id, coalesce(last.status, k.status),
         k.opened_at, k.due_at, k.accept_due_at, k.category, k.priority, k.neighborhood_id, k.folio, k.location_status
  from public.cases k
  left join last on last.case_id = k.id
  where k.org_id = p_org_id and k.status <> 'merged' and k.opened_at <= p_cut;
$$;

-- Without SET options so the planner inlines it (it reads no tables).
create function private.case_is_open(p_status public.case_status)
returns boolean
language sql
immutable
as $$
  select p_status in ('new'::public.case_status, 'in_review', 'assigned', 'accepted', 'in_progress', 'resolved', 'returned');
$$;

-- Overdue: the deadline of the step the case is in (acceptance while
-- assigned, attention while accepted or in progress) has passed.
create function private.case_overdue_at(p_status public.case_status, p_due timestamptz, p_accept_due timestamptz, p_cut timestamptz)
returns boolean
language sql
immutable
as $$
  select coalesce(case when p_status = 'assigned'::public.case_status then least(p_accept_due, p_due)
                       when p_status in ('accepted'::public.case_status, 'in_progress') then p_due end < p_cut, false);
$$;

-- Cycles of the period from their milestones (index case_id, cycle, at),
-- without aggregating every cycle of the org: first acceptance and validated
-- closure, each with the start of its cycle. Same rule as case_cycle_times.
create function private.cycle_steps(p_org_id uuid, p_from timestamptz, p_to timestamptz)
returns table (case_id uuid, department_id uuid, step text, hours numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select ms.case_id, k.department_id,
         case when ms.status = 'closed' then 'closed' else 'accepted' end,
         (extract(epoch from ms.at - (select min(s.at) from public.case_milestones s where s.case_id = ms.case_id and s.cycle = ms.cycle)) / 3600.0)::numeric
  from public.case_milestones ms
  join public.cases k on k.id = ms.case_id and k.status <> 'merged'
  where ms.org_id = p_org_id and ms.at >= p_from and ms.at < p_to
    and (ms.status = 'closed'
         or (ms.status = 'accepted' and not exists (
               select 1 from public.case_milestones e
               where e.case_id = ms.case_id and e.cycle = ms.cycle and e.status = 'accepted' and (e.at, e.id) < (ms.at, ms.id))));
$$;

create function private.kpi_attention(p_org_id uuid, p_from timestamptz, p_to timestamptz, p_cut timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with live as (
    select k.id, k.opened_at, k.category, k.location_status, k.due_at
    from public.cases k where k.org_id = p_org_id and k.status <> 'merged'
  ),
  states as (select * from private.case_states_at(p_org_id, p_cut)),
  first_attention as (select hours from private.cycle_steps(p_org_id, p_from, p_to) where step = 'accepted'),
  resolution as (select hours from private.cycle_steps(p_org_id, p_from, p_to) where step = 'closed'),
  steps as (
    select ms.status, ms.from_status, ms.at
    from public.case_milestones ms join live on live.id = ms.case_id
    where ms.org_id = p_org_id and ms.at >= p_from and ms.at < p_to
  )
  select jsonb_build_object(
    'opened', (select count(*) from live where opened_at >= p_from and opened_at < p_to),
    'opened_without_category', (select count(*) from live where opened_at >= p_from and opened_at < p_to and category is null),
    'opened_without_location', (select count(*) from live where opened_at >= p_from and opened_at < p_to and location_status = 'unavailable'),
    'open_at_cut', (select count(*) from states s where private.case_is_open(s.status)),
    'overdue_at_cut', (select count(*) from states s
                       where private.case_is_open(s.status) and private.case_overdue_at(s.status, s.due_at, s.accept_due_at, p_cut)),
    'open_without_due', (select count(*) from states s
                         where s.status in ('assigned', 'accepted', 'in_progress') and s.due_at is null),
    'awaiting_first_attention', (select count(*) from states s where s.status in ('new', 'in_review', 'assigned')),
    'first_attention_n', (select count(*) from first_attention),
    'first_attention_median_h', (select round(percentile_cont(0.5) within group (order by hours)::numeric, 1) from first_attention),
    'first_attention_p90_h', (select round(percentile_cont(0.9) within group (order by hours)::numeric, 1) from first_attention),
    'resolution_n', (select count(*) from resolution),
    'resolution_median_h', (select round(percentile_cont(0.5) within group (order by hours)::numeric, 1) from resolution),
    'resolution_p90_h', (select round(percentile_cont(0.9) within group (order by hours)::numeric, 1) from resolution),
    'validated_closures', (select count(*) from steps where status = 'closed'),
    'validation_rejections', (select count(*) from public.case_validations v join live on live.id = v.case_id
                              where v.org_id = p_org_id and v.decision = 'rejected' and v.at >= p_from and v.at < p_to),
    'reopenings', (select count(*) from steps where from_status = 'closed'),
    'discarded', (select count(*) from steps where status = 'discarded')
  );
$$;

-- Per department (the case's current department; "Sin asignar" when none).
-- Grouped aggregates joined on the department (a null department is its own
-- row), so the cost does not grow with the number of departments.
create function private.kpi_departments(p_org_id uuid, p_from timestamptz, p_to timestamptz, p_cut timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with live as (
    select k.id, k.department_id, k.opened_at from public.cases k where k.org_id = p_org_id and k.status <> 'merged'
  ),
  opened as (
    select department_id, count(*) as n from live where opened_at >= p_from and opened_at < p_to group by 1
  ),
  states as (
    select department_id,
           count(*) filter (where private.case_is_open(status)) as open,
           count(*) filter (where private.case_is_open(status) and private.case_overdue_at(status, due_at, accept_due_at, p_cut)) as overdue
    from private.case_states_at(p_org_id, p_cut) group by 1
  ),
  closed as (
    select department_id, count(*) as n,
           round(percentile_cont(0.5) within group (order by hours)::numeric, 1) as median,
           round(percentile_cont(0.9) within group (order by hours)::numeric, 1) as p90
    from private.cycle_steps(p_org_id, p_from, p_to) where step = 'closed'
    group by 1
  ),
  reopened as (
    select live.department_id, count(*) as n
    from public.case_milestones ms join live on live.id = ms.case_id
    where ms.org_id = p_org_id and ms.from_status = 'closed' and ms.at >= p_from and ms.at < p_to
    group by 1
  ),
  mentions as (
    select c.department_id, count(*) as mentions,
           count(*) filter (where c.sentiment = 'positive') as positive,
           count(*) filter (where c.sentiment = 'negative') as negative,
           count(*) filter (where c.intent in ('queja', 'denuncia')) as complaints
    from public.mentions m join public.classifications c on c.mention_id = m.id
    where m.org_id = p_org_id and m.published_at >= p_from and m.published_at < p_to and c.sentiment is not null
    group by 1
  ),
  keys as (
    select department_id from opened
    union select department_id from states where open > 0
    union select department_id from closed
    union select department_id from reopened
    union select department_id from mentions where department_id is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', k.department_id,
      'name', coalesce(d.name, 'Sin asignar'),
      'created_at', d.created_at,
      'opened', coalesce(o.n, 0),
      'open_at_cut', coalesce(st.open, 0),
      'overdue_at_cut', coalesce(st.overdue, 0),
      'validated_closures', coalesce(cl.n, 0),
      'resolution_median_h', cl.median,
      'resolution_p90_h', cl.p90,
      'reopenings', coalesce(r.n, 0),
      'mentions', coalesce(mm.mentions, 0),
      'positive_mentions', coalesce(mm.positive, 0),
      'negative_mentions', coalesce(mm.negative, 0),
      'complaint_mentions', coalesce(mm.complaints, 0)
    ) order by coalesce(d.name, 'zzz')), '[]')
  from keys k
  left join public.departments d on d.id = k.department_id
  left join opened o on o.department_id is not distinct from k.department_id
  left join states st on st.department_id is not distinct from k.department_id
  left join closed cl on cl.department_id is not distinct from k.department_id
  left join reopened r on r.department_id is not distinct from k.department_id
  left join mentions mm on mm.department_id is not distinct from k.department_id;
$$;

-- ---------------------------------------------------------------------------
-- kpi_snapshot: current and previous period, coverage and catalog changes.
-- p_to may be in the future (today's period): the cut is then now().
-- ---------------------------------------------------------------------------
create function public.kpi_snapshot(
  p_org_id uuid, p_from timestamptz, p_to timestamptz, p_prev_from timestamptz, p_prev_to timestamptz,
  p_bucket text default 'day'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cut timestamptz := least(p_to, now());
  -- The previous period is cut at the same point of its length.
  v_prev_cut timestamptz := least(p_prev_to, p_prev_from + (least(p_to, now()) - p_from));
  v_result jsonb;
begin
  if not (private.can_read_all(p_org_id) or private.is_service_role()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_bucket not in ('hour', 'day') or p_from >= p_to or p_prev_from >= p_prev_to then
    raise exception 'invalid period' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'snapshot_version', 1,
    'as_of', now(),
    'period', jsonb_build_object('from', p_from, 'to', p_to, 'cut', v_cut,
                                 'prev_from', p_prev_from, 'prev_to', p_prev_to, 'prev_cut', v_prev_cut),
    'conversation', jsonb_build_object(
      'current', private.kpi_conversation(p_org_id, p_from, v_cut),
      'previous', private.kpi_conversation(p_org_id, p_prev_from, v_prev_cut)),
    'attention', jsonb_build_object(
      'current', private.kpi_attention(p_org_id, p_from, v_cut, v_cut),
      'previous', private.kpi_attention(p_org_id, p_prev_from, v_prev_cut, v_prev_cut)),
    'departments', private.kpi_departments(p_org_id, p_from, v_cut, v_cut),
    'series', coalesce((
      select jsonb_agg(jsonb_build_object('bucket', b.bucket, 'positive', b.positive, 'neutral', b.neutral,
                                          'negative', b.negative, 'pending', b.pending) order by b.bucket)
      from (
        select case when p_bucket = 'hour' then date_trunc('hour', m.published_at)
                    else (date_trunc('day', m.published_at at time zone 'America/Mexico_City')) at time zone 'America/Mexico_City'
               end as bucket,
               count(*) filter (where c.sentiment = 'positive') as positive,
               count(*) filter (where c.sentiment = 'neutral') as neutral,
               count(*) filter (where c.sentiment = 'negative') as negative,
               count(*) filter (where c.sentiment is null) as pending
        from public.mentions m left join public.classifications c on c.mention_id = m.id
        where m.org_id = p_org_id and m.published_at >= p_from and m.published_at < v_cut
        group by 1) b), '[]'),
    'attention_series', coalesce((
      select jsonb_agg(jsonb_build_object('bucket', b.bucket, 'opened', b.opened, 'closed', b.closed) order by b.bucket)
      from (
        select bucket, count(*) filter (where kind = 'opened') as opened, count(*) filter (where kind = 'closed') as closed
        from (
          select case when p_bucket = 'hour' then date_trunc('hour', k.opened_at)
                      else (date_trunc('day', k.opened_at at time zone 'America/Mexico_City')) at time zone 'America/Mexico_City' end as bucket,
                 'opened' as kind
          from public.cases k
          where k.org_id = p_org_id and k.status <> 'merged' and k.opened_at >= p_from and k.opened_at < v_cut
          union all
          select case when p_bucket = 'hour' then date_trunc('hour', ms.at)
                      else (date_trunc('day', ms.at at time zone 'America/Mexico_City')) at time zone 'America/Mexico_City' end,
                 'closed'
          from public.case_milestones ms join public.cases k on k.id = ms.case_id and k.status <> 'merged'
          where ms.org_id = p_org_id and ms.status = 'closed' and ms.at >= p_from and ms.at < v_cut
        ) e group by bucket) b), '[]'),
    'topics', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.total desc, t.topic) from (
        select c.topic, count(*) as total,
               count(*) filter (where c.sentiment = 'positive') as positive,
               count(*) filter (where c.sentiment = 'negative') as negative,
               count(*) filter (where c.intent in ('queja', 'denuncia')) as complaints
        from public.mentions m join public.classifications c on c.mention_id = m.id
        where m.org_id = p_org_id and m.published_at >= p_from and m.published_at < v_cut
          and c.sentiment is not null and c.topic is not null
        group by c.topic order by count(*) desc, c.topic limit 15) t), '[]'),
    -- Open cases past their deadline at the cut: what is still pending (no title or text).
    'pending_cases', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.overdue_hours desc nulls last, p.folio) from (
        select s.case_id as id, s.folio, s.category, s.priority, s.status, d.name as department, n.name as neighborhood,
               round((extract(epoch from v_cut - case when s.status = 'assigned' then least(s.accept_due_at, s.due_at) else s.due_at end) / 3600.0)::numeric, 1) as overdue_hours
        from private.case_states_at(p_org_id, v_cut) s
        left join public.departments d on d.id = s.department_id
        left join public.neighborhoods n on n.id = s.neighborhood_id
        where private.case_is_open(s.status) and private.case_overdue_at(s.status, s.due_at, s.accept_due_at, v_cut)
        order by 8 desc nulls last, s.folio limit 15) p), '[]'),
    'coverage', jsonb_build_object(
      'sources_active', (select count(*) from public.sources s where s.org_id = p_org_id and s.is_active),
      -- Active sources not read up to the cut: the period's figures may grow.
      'sources_partial', coalesce((
        select jsonb_agg(jsonb_build_object('name', s.name, 'type', s.type, 'covered_until', s.covered_until) order by s.name)
        from public.sources s
        where s.org_id = p_org_id and s.is_active and (s.covered_until is null or s.covered_until < v_cut)), '[]'),
      'last_mention_at', (select max(m.created_at) from public.mentions m where m.org_id = p_org_id),
      'last_classified_at', (select max(c.created_at) from public.classifications c where c.org_id = p_org_id),
      'rollup_refreshed_at', (select h.last_ok_at from public.worker_heartbeats h where h.kind = 'dashboard'),
      'pending_corrections', (select count(*) from public.stats_invalidations i
                              where i.org_id = p_org_id and i.processed_at is null)
    ),
    -- Catalog changes since the start of the previous period: comparisons
    -- across them are explained, and rankings are not drawn.
    'catalog', jsonb_build_object(
      'departments_added', coalesce((select jsonb_agg(d.name order by d.name) from public.departments d
                                     where d.org_id = p_org_id and d.created_at >= p_prev_from), '[]'),
      'neighborhoods_added', (select count(*) from public.neighborhoods n where n.org_id = p_org_id and n.created_at >= p_prev_from),
      'sources_added', coalesce((select jsonb_agg(s.name order by s.name) from public.sources s
                                 where s.org_id = p_org_id and s.created_at >= p_prev_from), '[]')
    )
  ) into v_result;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Texts for the narrative: per bucket (day or hour) its top topics and
-- mentions, so any peak picked in code has its examples in the same snapshot.
-- ---------------------------------------------------------------------------
create function public.report_context(p_org_id uuid, p_from timestamptz, p_to timestamptz, p_bucket text default 'day')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not (private.can_read_all(p_org_id) or private.is_service_role()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_bucket not in ('hour', 'day') then
    raise exception 'invalid bucket' using errcode = '22023';
  end if;

  with m as (
    select m.id, left(m.text, 400) as text, m.published_at, c.sentiment, c.topic, c.intent, c.priority,
      d.name as department, n.name as neighborhood,
      case when a.kind in ('media', 'public_figure') then coalesce(a.display_name, a.handle) end as author,
      coalesce(a.kind::text, 'citizen') as author_kind,
      s.type::text as platform,
      coalesce((m.metrics ->> 'likes')::bigint, 0) + coalesce((m.metrics ->> 'shares')::bigint, 0)
        + coalesce((m.metrics ->> 'comments')::bigint, 0) as interactions,
      case when p_bucket = 'hour' then date_trunc('hour', m.published_at)
           else (date_trunc('day', m.published_at at time zone 'America/Mexico_City')) at time zone 'America/Mexico_City' end as bucket
    from public.mentions m
    left join public.classifications c on c.mention_id = m.id
    left join public.departments d on d.id = c.department_id
    left join public.neighborhoods n on n.id = c.neighborhood_id
    left join public.authors a on a.id = m.author_id
    left join public.sources s on s.id = m.source_id
    where m.org_id = p_org_id and m.published_at >= p_from and m.published_at < least(p_to, now())
  ),
  -- Per bucket, its three top topics and mentions (window functions, one pass).
  bucket_topics as (
    select bucket, jsonb_agg(jsonb_build_object('topic', topic, 'total', n) order by rn) as topics
    from (select bucket, topic, count(*) as n, row_number() over (partition by bucket order by count(*) desc, topic) as rn
          from m where topic is not null group by bucket, topic) t
    where rn <= 3 group by bucket
  ),
  bucket_mentions as (
    select bucket, jsonb_agg(jsonb_build_object('id', id, 'text', text, 'sentiment', sentiment, 'topic', topic, 'author', author,
             'author_kind', author_kind, 'platform', platform, 'interactions', interactions, 'published_at', published_at) order by rn) as mentions
    from (select *, row_number() over (partition by bucket order by (sentiment = 'negative') desc nulls last, interactions desc, published_at desc, id) as rn
          from m) x
    where rn <= 3 group by bucket
  ),
  buckets as (
    select bm.bucket, coalesce(bt.topics, '[]') as topics, bm.mentions
    from bucket_mentions bm left join bucket_topics bt on bt.bucket = bm.bucket
  ),
  picks as (
    select id, 1 as grp, row_number() over (order by interactions desc, published_at desc, id) as rn from m
    union all
    select id, 2, row_number() over (order by (priority = 'critical') desc, published_at desc, id) from m
      where sentiment = 'negative' and priority in ('critical', 'high')
    union all
    select id, 3, row_number() over (order by interactions desc, id) from m where sentiment = 'positive'
    union all
    select id, 4, row_number() over (order by interactions desc, id) from m where author_kind in ('media', 'public_figure')
    union all
    select id, 5, row_number() over (order by published_at desc, id) from m where sentiment is not null
  ),
  chosen as (
    select id, min(grp * 100 + rn) as ord from picks
    where (grp = 1 and rn <= 5) or (grp = 2 and rn <= 5) or (grp = 3 and rn <= 3) or (grp = 4 and rn <= 3) or (grp = 5 and rn <= 15)
    group by id order by min(grp * 100 + rn) limit 15
  ),
  alerts as (
    select e.kind, e.severity, e.title, e.created_at, e.feedback
    from public.alert_events e
    where e.org_id = p_org_id and e.created_at >= p_from and e.created_at < p_to and e.kind <> 'daily_digest'
  ),
  hood_topics as (
    select neighborhood, topic
    from (select neighborhood, topic, row_number() over (partition by neighborhood order by count(*) desc, topic) as rn
          from m where neighborhood is not null and intent in ('queja', 'denuncia') and topic is not null
          group by neighborhood, topic) t
    where rn = 1
  ),
  hoods as (
    select h.neighborhood, h.complaints, ht.topic as top_topic
    from (select neighborhood, count(*) as complaints from m
          where neighborhood is not null and intent in ('queja', 'denuncia') group by neighborhood) h
    left join hood_topics ht on ht.neighborhood = h.neighborhood
  )
  select jsonb_build_object(
    'buckets', coalesce((select jsonb_agg(jsonb_build_object('start', b.bucket, 'topics', b.topics, 'mentions', b.mentions)
                                          order by b.bucket) from buckets b), '[]'),
    'representative', coalesce((select jsonb_agg(jsonb_build_object(
        'id', m.id, 'text', m.text, 'sentiment', m.sentiment, 'topic', m.topic, 'intent', m.intent,
        'priority', m.priority, 'department', m.department, 'neighborhood', m.neighborhood,
        'author', m.author, 'author_kind', m.author_kind, 'platform', m.platform,
        'interactions', m.interactions, 'published_at', m.published_at) order by c.ord)
      from chosen c join m on m.id = c.id), '[]'),
    'alerts', jsonb_build_object(
      'total', (select count(*) from alerts),
      'by_severity', coalesce((select jsonb_object_agg(severity, n) from (
          select severity::text, count(*) as n from alerts group by severity) s), '{}'),
      'useful', (select count(*) from alerts where feedback = 'useful'),
      'false_alarms', (select count(*) from alerts where feedback = 'false_alarm'),
      'latest', coalesce((select jsonb_agg(to_jsonb(a)) from (
          select kind, severity, title, created_at from alerts order by created_at desc limit 8) a), '[]')),
    'neighborhood_complaints', coalesce((select jsonb_agg(to_jsonb(h) order by h.complaints desc, h.neighborhood) from (
        select * from hoods order by complaints desc, neighborhood limit 10) h), '[]')
  ) into v_result;
  return v_result;
end;
$$;

-- Both in one statement: one snapshot for every figure and example of a report.
create function public.report_snapshot(
  p_org_id uuid, p_from timestamptz, p_to timestamptz, p_prev_from timestamptz, p_prev_to timestamptz,
  p_bucket text default 'day'
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'kpi', public.kpi_snapshot(p_org_id, p_from, p_to, p_prev_from, p_prev_to, p_bucket),
    'context', public.report_context(p_org_id, p_from, p_to, p_bucket));
$$;

-- ---------------------------------------------------------------------------
-- Report versions
-- ---------------------------------------------------------------------------
alter table public.reports
  add column version integer not null default 1 check (version > 0),
  add column previous_version_id uuid references public.reports (id) on delete restrict,
  add column kpi_version text,
  add column snapshot_at timestamptz;
-- A version has at most one revision (the chain is linear).
create unique index reports_previous_version_idx on public.reports (previous_version_id) where previous_version_id is not null;

-- A revision continues an approved report of the same org and period.
create function private.reports_version_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_prev public.reports;
begin
  if new.previous_version_id is null then
    new.version := 1;
    return new;
  end if;
  select * into v_prev from public.reports where id = new.previous_version_id;
  if v_prev.id is null or v_prev.org_id <> new.org_id then
    raise exception 'La versión anterior no existe.' using errcode = '22023';
  end if;
  if v_prev.status = 'draft' then
    raise exception 'Sólo se revisa un reporte aprobado: edita el borrador.' using errcode = '22023';
  end if;
  if v_prev.period <> new.period or v_prev.period_start <> new.period_start or v_prev.period_end <> new.period_end then
    raise exception 'Una revisión conserva el periodo del reporte.' using errcode = '22023';
  end if;
  new.version := v_prev.version + 1;
  return new;
end;
$$;
revoke execute on function private.reports_version_guard() from public, anon, authenticated;
create trigger reports_version_guard before insert on public.reports
  for each row execute function private.reports_version_guard();

-- Version data never changes; an approval needs the figures it freezes.
create function private.reports_freeze_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.version is distinct from old.version or new.previous_version_id is distinct from old.previous_version_id then
    raise exception 'La versión de un reporte no se puede cambiar.' using errcode = '42501';
  end if;
  if old.status <> 'draft' and (new.kpi_version is distinct from old.kpi_version or new.snapshot_at is distinct from old.snapshot_at) then
    raise exception 'El reporte ya fue aprobado y no se puede editar.' using errcode = '42501';
  end if;
  if old.status = 'draft' and new.status <> 'draft' and coalesce(new.facts, '{}'::jsonb) = '{}'::jsonb then
    raise exception 'El reporte no tiene cifras: genéralo de nuevo.' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke execute on function private.reports_freeze_guard() from public, anon, authenticated;
-- Named to fire after reports_guard (triggers run in name order), whose messages stay first.
create trigger reports_version_freeze before update on public.reports
  for each row execute function private.reports_freeze_guard();

-- Figures are computed by the server (service role) from report_snapshot:
-- editors no longer write facts, the KPI version or the snapshot instant.
revoke insert on public.reports from authenticated;
grant insert (id, org_id, period, period_start, period_end, title, content, model, recipients, schedule_id)
  on public.reports to authenticated;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function private.kpi_conversation(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function private.case_states_at(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function private.cycle_steps(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function private.kpi_attention(uuid, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function private.kpi_departments(uuid, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.kpi_snapshot(uuid, timestamptz, timestamptz, timestamptz, timestamptz, text) from public, anon;
revoke execute on function public.report_context(uuid, timestamptz, timestamptz, text) from public, anon;
revoke execute on function public.report_snapshot(uuid, timestamptz, timestamptz, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.kpi_snapshot(uuid, timestamptz, timestamptz, timestamptz, timestamptz, text) to authenticated, service_role;
grant execute on function public.report_context(uuid, timestamptz, timestamptz, text) to authenticated, service_role;
grant execute on function public.report_snapshot(uuid, timestamptz, timestamptz, timestamptz, timestamptz, text) to authenticated, service_role;
