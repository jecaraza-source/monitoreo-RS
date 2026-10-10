-- Reports: generated drafts with an editable narrative, approval, PDF in
-- Storage, scheduled email delivery; plus the dashboard's "Lectura del día".
--
-- Workflow: draft (Claude narrative, editable) → approved (PDF rendered and
-- stored) → sent (emailed to the recipients). Only admin/comunicacion write;
-- lectura reads; dependencia has no access (reports cover the whole org).

-- ---------------------------------------------------------------------------
-- Organizations: report cover colors
-- ---------------------------------------------------------------------------
alter table public.organizations
  add column brand_primary text not null default '#032a50' check (brand_primary ~ '^#[0-9a-fA-F]{6}$'),
  add column brand_accent text not null default '#36c6c0' check (brand_accent ~ '^#[0-9a-fA-F]{6}$');

-- Admins may edit their org's cover colors (the row had no update policy).
create policy "admins update organization" on public.organizations
  for update to authenticated
  using ((select private.has_role(id, '{admin}')))
  with check ((select private.has_role(id, '{admin}')));
revoke update on public.organizations from authenticated;
grant update (brand_primary, brand_accent) on public.organizations to authenticated;

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------
create type public.report_status as enum ('draft', 'approved', 'sent');

alter table public.reports
  add column status public.report_status not null default 'draft',
  add column title text not null default '',
  -- ReportFacts (src/lib/reports/facts.ts): the only source of figures.
  add column facts jsonb not null default '{}'::jsonb,
  add column model text,
  add column recipients text[] not null default '{}',
  add column schedule_id uuid,
  add column created_by uuid references auth.users (id) default auth.uid(),
  add column approved_by uuid references auth.users (id),
  add column approved_at timestamptz,
  add column sent_at timestamptz,
  add column delivery jsonb not null default '{}'::jsonb,
  add column updated_at timestamptz not null default now();

comment on column public.reports.content is
  'Narrative (src/lib/ai/narrative.ts): headline, executive_summary, findings, risks, opportunities, recommendations, messaging. Editable while draft.';

-- An approved report is frozen: only delivery bookkeeping may change.
create function private.reports_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'draft' and (
       new.content is distinct from old.content or new.facts is distinct from old.facts
       or new.period_start is distinct from old.period_start or new.period_end is distinct from old.period_end) then
    raise exception 'El reporte ya fue aprobado y no se puede editar.' using errcode = '42501';
  end if;
  if new.status = 'draft' and old.status <> 'draft' then
    raise exception 'Un reporte aprobado no vuelve a borrador.' using errcode = '42501';
  end if;
  if new.status <> 'draft' and old.status = 'draft' then
    new.approved_at := coalesce(new.approved_at, now());
    new.approved_by := coalesce(new.approved_by, (select auth.uid()));
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger reports_guard before update on public.reports
  for each row execute function private.reports_guard();

-- ---------------------------------------------------------------------------
-- Schedules: the cron drafts a report per period; approving it emails the PDF.
-- ---------------------------------------------------------------------------
create table public.report_schedules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  period public.report_period not null,
  recipients text[] not null default '{}' check (cardinality(recipients) <= 30),
  -- Send without waiting for approval (the draft is approved as generated).
  auto_approve boolean not null default false,
  is_active boolean not null default true,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, period)
);

alter table public.reports
  add constraint reports_schedule_fk foreign key (schedule_id) references public.report_schedules (id) on delete set null;

alter table public.report_schedules enable row level security;
create policy "readers read report schedules" on public.report_schedules
  for select to authenticated using ((select private.can_read_all(org_id)));
create policy "editors manage report schedules" on public.report_schedules
  for all to authenticated
  using ((select private.has_role(org_id, '{admin,comunicacion}')))
  with check ((select private.has_role(org_id, '{admin,comunicacion}')));
revoke all on public.report_schedules from anon;

create index reports_org_status_idx on public.reports (org_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- Lectura del día: short summary cached per org (regenerated after 1 h)
-- ---------------------------------------------------------------------------
create table public.daily_readings (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  sentences text[] not null,
  facts jsonb not null default '{}'::jsonb,
  model text,
  generated_at timestamptz not null default now()
);

alter table public.daily_readings enable row level security;
create policy "readers read daily readings" on public.daily_readings
  for select to authenticated using ((select private.can_read_all(org_id)));
-- Written by the server with the service role only.
revoke all on public.daily_readings from anon;
revoke insert, update, delete on public.daily_readings from authenticated;

-- ---------------------------------------------------------------------------
-- Scheduled reports run on the server with the service role (no auth.uid()):
-- the report RPCs accept it besides readers of the org.
-- ---------------------------------------------------------------------------
create function private.is_service_role()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select auth.role()) = 'service_role', false);
$$;

-- ---------------------------------------------------------------------------
-- Report figures the dashboard RPC does not cover: peaks' main mentions,
-- representative mentions, alerts and attention by department. Authors are
-- named only when they are media or public figures (see CLAUDE.md).
-- ---------------------------------------------------------------------------
create function public.report_extras(
  p_org_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_peaks timestamptz[] default '{}',
  p_bucket text default 'day'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_step interval := case when p_bucket = 'hour' then interval '1 hour' else interval '1 day' end;
  v_result jsonb;
begin
  if not (private.can_read_all(p_org_id) or private.is_service_role()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_bucket not in ('hour', 'day') then
    raise exception 'invalid bucket' using errcode = '22023';
  end if;

  with m as (
    select m.id, left(m.text, 400) as text, m.url, m.published_at, c.sentiment, c.topic, c.intent, c.priority,
      d.name as department, n.name as neighborhood,
      case when a.kind in ('media', 'public_figure') then coalesce(a.display_name, a.handle) end as author,
      coalesce(a.kind::text, 'citizen') as author_kind,
      s.type::text as platform,
      coalesce((m.metrics ->> 'likes')::bigint, 0) + coalesce((m.metrics ->> 'shares')::bigint, 0)
        + coalesce((m.metrics ->> 'comments')::bigint, 0) as interactions
    from public.mentions m
    left join public.classifications c on c.mention_id = m.id
    left join public.departments d on d.id = c.department_id
    left join public.neighborhoods n on n.id = c.neighborhood_id
    left join public.authors a on a.id = m.author_id
    left join public.sources s on s.id = m.source_id
    where m.org_id = p_org_id and m.published_at >= p_from and m.published_at < p_to
  ),
  peaks as (
    select p.start, (
      select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (
        select id, text, sentiment, topic, author, author_kind, platform, interactions, published_at
        from m where m.published_at >= p.start and m.published_at < p.start + v_step
        order by (sentiment = 'negative') desc nulls last, interactions desc, published_at desc
        limit 3
      ) x
    ) as mentions,
    (select count(*) from m where m.published_at >= p.start and m.published_at < p.start + v_step) as total,
    (select jsonb_agg(t) from (
       select topic, count(*) as total from m
       where m.published_at >= p.start and m.published_at < p.start + v_step and topic is not null
       group by topic order by count(*) desc limit 3) t) as topics
    from unnest(p_peaks) as p(start)
  ),
  -- 15 representative mentions: reach, urgent negatives, praise and media.
  picks as (
    select id, 1 as grp, row_number() over (order by interactions desc, published_at desc) as rn from m
    union all
    select id, 2, row_number() over (order by (priority = 'critical') desc, published_at desc) from m
      where sentiment = 'negative' and priority in ('critical', 'high')
    union all
    select id, 3, row_number() over (order by interactions desc) from m where sentiment = 'positive'
    union all
    select id, 4, row_number() over (order by interactions desc) from m where author_kind in ('media', 'public_figure')
    union all
    select id, 5, row_number() over (order by published_at desc) from m where sentiment is not null
  ),
  chosen as (
    select id, min(grp * 100 + rn) as ord from picks
    where (grp = 1 and rn <= 5) or (grp = 2 and rn <= 5) or (grp = 3 and rn <= 3) or (grp = 4 and rn <= 3) or (grp = 5 and rn <= 15)
    group by id
    order by min(grp * 100 + rn)
    limit 15
  ),
  tickets as (
    select t.department_id, count(*) as opened,
      count(*) filter (where t.resolved_at is not null and t.resolved_at < p_to) as resolved,
      count(*) filter (where t.resolved_at is null and t.due_at < p_to) as overdue,
      round((avg(extract(epoch from t.resolved_at - t.created_at) / 3600.0)
        filter (where t.resolved_at is not null and t.resolved_at < p_to))::numeric, 1) as attention_hours
    from public.tickets t
    where t.org_id = p_org_id and t.created_at >= p_from and t.created_at < p_to
    group by t.department_id
  ),
  alerts as (
    select e.kind, e.severity, e.title, e.created_at, e.feedback
    from public.alert_events e
    where e.org_id = p_org_id and e.created_at >= p_from and e.created_at < p_to and e.kind <> 'daily_digest'
  ),
  hoods as (
    select neighborhood, count(*) as complaints,
      (select topic from m m2 where m2.neighborhood = m.neighborhood and m2.intent in ('queja', 'denuncia')
         and m2.topic is not null group by topic order by count(*) desc limit 1) as top_topic
    from m where neighborhood is not null and intent in ('queja', 'denuncia')
    group by neighborhood
  )
  select jsonb_build_object(
    'peaks', coalesce((select jsonb_agg(jsonb_build_object('start', p.start, 'total', p.total,
        'topics', coalesce(p.topics, '[]'), 'mentions', p.mentions) order by p.start) from peaks p), '[]'),
    'representative', coalesce((select jsonb_agg(jsonb_build_object(
        'id', m.id, 'text', m.text, 'sentiment', m.sentiment, 'topic', m.topic, 'intent', m.intent,
        'priority', m.priority, 'department', m.department, 'neighborhood', m.neighborhood,
        'author', m.author, 'author_kind', m.author_kind, 'platform', m.platform,
        'interactions', m.interactions, 'published_at', m.published_at) order by c.ord)
      from chosen c join m on m.id = c.id), '[]'),
    'attention', coalesce((select jsonb_agg(jsonb_build_object('department', coalesce(d.name, 'Sin dependencia'),
        'opened', t.opened, 'resolved', t.resolved, 'overdue', t.overdue, 'attention_hours', t.attention_hours)
        order by t.opened desc)
      from tickets t left join public.departments d on d.id = t.department_id), '[]'),
    'alerts', jsonb_build_object(
      'total', (select count(*) from alerts),
      'by_severity', coalesce((select jsonb_object_agg(severity, n) from (
          select severity::text, count(*) as n from alerts group by severity) s), '{}'),
      'useful', (select count(*) from alerts where feedback = 'useful'),
      'false_alarms', (select count(*) from alerts where feedback = 'false_alarm'),
      'latest', coalesce((select jsonb_agg(to_jsonb(a)) from (
          select kind, severity, title, created_at from alerts order by created_at desc limit 8) a), '[]')),
    'neighborhood_complaints', coalesce((select jsonb_agg(to_jsonb(h) order by h.complaints desc) from (
        select * from hoods order by complaints desc limit 10) h), '[]')
  )
  into v_result;

  return v_result;
end;
$$;

revoke execute on function public.report_extras(uuid, timestamptz, timestamptz, timestamptz[], text) from public, anon;
grant execute on function public.report_extras(uuid, timestamptz, timestamptz, timestamptz[], text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Storage: private bucket, files under <org_id>/…
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reports', 'reports', false, 20971520, array['application/pdf'])
on conflict (id) do nothing;

create policy "readers read report files" on storage.objects
  for select to authenticated
  using (bucket_id = 'reports' and (select private.can_read_all(((storage.foldername(name))[1])::uuid)));
-- Uploads happen on the server with the service role (after rendering the PDF).

-- ---------------------------------------------------------------------------
-- dashboard_stats: same body, now also callable by the service role (cron).
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_stats(
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
  if not (private.can_read_all(p_org_id) or private.is_service_role()) then
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

grant execute on function public.dashboard_stats(uuid, timestamptz, timestamptz, text, boolean) to service_role;
