-- Alerts: configurable rules evaluated after each classification run, one
-- event per rule and fingerprint per cooldown, feedback, crisis-room log.

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------
-- kind decides how `condition` is read (validated by the app with zod):
--   spike          {window_minutes, baseline_days, k, min_mentions}
--   sentiment_drop {window_minutes, baseline_days, drop_points, min_mentions}
--   risk_term      {window_minutes, min_severity}
--   media_negative {window_minutes}
--   daily_digest   {hour}
-- channels: {"email": [...], "whatsapp": [...]}; in-app is always on.

alter table public.alert_rules
  add column kind text not null default 'spike'
    check (kind in ('spike', 'sentiment_drop', 'risk_term', 'media_negative', 'daily_digest')),
  add column cooldown_minutes integer not null default 120 check (cooldown_minutes between 5 and 10080),
  add column updated_at timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------

alter table public.alert_events
  add column kind text,
  add column severity public.priority not null default 'medium',
  add column title text not null default '',
  add column summary text not null default '',
  -- What the cooldown deduplicates on: "spike", "term:balacera", "author:<id>", "digest:2026-10-09".
  add column fingerprint text,
  -- Example mentions behind the alert (the first is also in mention_id).
  add column mention_ids uuid[] not null default '{}',
  add column feedback text check (feedback in ('useful', 'false_alarm')),
  add column feedback_by uuid references auth.users (id),
  add column feedback_at timestamptz,
  -- Delivery result per channel: {"email": {"status": "sent"}, "whatsapp": {"status": "not_configured"}}.
  add column notifications jsonb not null default '{}'::jsonb;

create index alert_events_rule_fingerprint_idx on public.alert_events (rule_id, fingerprint, created_at desc);

-- Readers mark alerts as seen and rate them; who and when is stamped here.
revoke update on public.alert_events from authenticated;
grant update (acknowledged_at, feedback) on public.alert_events to authenticated;

create policy "departments rate own alerts" on public.alert_events
  for update to authenticated
  using (department_id = (select private.user_department(org_id)))
  with check (department_id = (select private.user_department(org_id)));

create function private.stamp_alert_feedback()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.feedback is distinct from old.feedback and (select auth.uid()) is not null then
    new.feedback_by := (select auth.uid());
    new.feedback_at := now();
    new.acknowledged_at := coalesce(new.acknowledged_at, now());
  end if;
  return new;
end;
$$;

create trigger alert_events_stamp_feedback
  before update on public.alert_events
  for each row execute function private.stamp_alert_feedback();

-- Fires an alert unless the same rule fired the same fingerprint within its
-- cooldown. The advisory lock makes concurrent evaluations agree.
create function public.fire_alert(
  p_rule_id uuid,
  p_fingerprint text,
  p_kind text,
  p_severity public.priority,
  p_title text,
  p_summary text,
  p_payload jsonb,
  p_mention_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.alert_rules;
  v_id uuid;
begin
  select * into v_rule from public.alert_rules where id = p_rule_id;
  if v_rule.id is null then
    raise exception 'rule not found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_rule_id::text || ':' || p_fingerprint, 0));
  if exists (
    select 1 from public.alert_events e
    where e.rule_id = p_rule_id
      and e.fingerprint = p_fingerprint
      and e.created_at > now() - make_interval(mins => v_rule.cooldown_minutes)
  ) then
    return null;
  end if;

  insert into public.alert_events (org_id, rule_id, department_id, mention_id, mention_ids, kind, severity,
                                   title, summary, fingerprint, payload)
  values (v_rule.org_id, v_rule.id, v_rule.department_id, p_mention_ids[1], coalesce(p_mention_ids, '{}'),
          p_kind, p_severity, p_title, p_summary, p_fingerprint, coalesce(p_payload, '{}'))
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Rule inputs (service role only: the evaluator runs after classification)
-- ---------------------------------------------------------------------------

-- Mentions in the last window vs. the same-size windows of the baseline.
create function public.alert_volume_window(
  p_org_id uuid,
  p_window_minutes integer,
  p_baseline_days integer,
  p_department_id uuid default null
)
returns table (current_count integer, baseline_mean numeric, baseline_stddev numeric, baseline_windows integer)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select now() - make_interval(mins => p_window_minutes) as t_start
  ),
  scoped as (
    select m.published_at
    from public.mentions m
    left join public.classifications c on c.mention_id = m.id
    where m.org_id = p_org_id
      and (p_department_id is null or c.department_id = p_department_id)
      and m.published_at >= (select t_start from bounds) - make_interval(days => p_baseline_days)
  ),
  per_window as (
    select floor(extract(epoch from ((select t_start from bounds) - s.published_at)) / (p_window_minutes * 60))::integer as w,
           count(*) as n
    from scoped s
    where s.published_at < (select t_start from bounds)
    group by 1
  ),
  series as (
    select coalesce(p.n, 0) as n
    from generate_series(0, (p_baseline_days * 1440 / p_window_minutes) - 1) as g(w)
    left join per_window p on p.w = g.w
  )
  select
    (select count(*)::integer from scoped s where s.published_at >= (select t_start from bounds)),
    round(avg(n)::numeric, 3),
    round(coalesce(stddev_samp(n), 0)::numeric, 3),
    count(*)::integer
  from series;
$$;

-- Net Sentiment Score of the last window and of the baseline before it.
create function public.alert_sentiment_window(
  p_org_id uuid,
  p_window_minutes integer,
  p_baseline_days integer,
  p_department_id uuid default null
)
returns table (current_classified integer, current_nss numeric, baseline_classified integer, baseline_nss numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (select now() - make_interval(mins => p_window_minutes) as t_start),
  scoped as (
    select m.published_at >= (select t_start from bounds) as current, c.sentiment
    from public.mentions m
    join public.classifications c on c.mention_id = m.id
    where m.org_id = p_org_id
      and (p_department_id is null or c.department_id = p_department_id)
      and m.published_at >= (select t_start from bounds) - make_interval(days => p_baseline_days)
  )
  select
    count(*) filter (where current)::integer,
    round(coalesce(100.0 * (count(*) filter (where current and sentiment = 'positive')
      - count(*) filter (where current and sentiment = 'negative')) / nullif(count(*) filter (where current), 0), 0), 1),
    count(*) filter (where not current)::integer,
    round(coalesce(100.0 * (count(*) filter (where not current and sentiment = 'positive')
      - count(*) filter (where not current and sentiment = 'negative')) / nullif(count(*) filter (where not current), 0), 0), 1)
  from scoped;
$$;

-- Mentions classified since p_since with their risk terms (word-start,
-- accent-insensitive) and author kind. Author names only for media and
-- public figures (see CLAUDE.md: no profiles of citizens).
create function public.alert_candidates(p_org_id uuid, p_since timestamptz, p_department_id uuid default null)
returns table (
  mention_id uuid,
  text text,
  published_at timestamptz,
  sentiment public.sentiment,
  priority public.priority,
  author_id uuid,
  author_kind public.author_kind,
  author_name text,
  terms text[],
  max_severity public.priority
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.id, m.text, m.published_at, c.sentiment, c.priority,
    case when a.kind in ('media', 'public_figure') then a.id end,
    a.kind,
    case when a.kind in ('media', 'public_figure') then coalesce(a.display_name, a.handle) end,
    coalesce(array_agg(r.term order by r.term) filter (where r.id is not null), '{}'),
    max(r.severity)
  from public.mentions m
  join public.classifications c on c.mention_id = m.id
  left join public.authors a on a.id = m.author_id
  left join public.risk_terms r
    on r.org_id = m.org_id
   -- Word-start match, accent-insensitive: "inundacion" finds "inundaciones".
   and position(' ' || r.normalized in
        ' ' || regexp_replace(lower(extensions.unaccent(m.text)), '[^a-z0-9]+', ' ', 'g')) > 0
  where m.org_id = p_org_id
    and c.created_at >= p_since
    and (p_department_id is null or c.department_id = p_department_id)
  group by m.id, m.text, m.published_at, c.sentiment, c.priority, a.id, a.kind, a.display_name, a.handle;
$$;

-- Numbers for the daily digest.
create function public.alert_digest(p_org_id uuid, p_from timestamptz, p_to timestamptz, p_department_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with scoped as (
    select m.id, c.sentiment, c.topic, c.intent, c.neighborhood_id
    from public.mentions m
    left join public.classifications c on c.mention_id = m.id
    where m.org_id = p_org_id and m.published_at >= p_from and m.published_at < p_to
      and (p_department_id is null or c.department_id = p_department_id)
  )
  select jsonb_build_object(
    'mentions', (select count(*) from scoped),
    'positive', (select count(*) from scoped where sentiment = 'positive'),
    'neutral', (select count(*) from scoped where sentiment = 'neutral'),
    'negative', (select count(*) from scoped where sentiment = 'negative'),
    'complaints', (select count(*) from scoped where intent in ('queja', 'denuncia')),
    'top_topics', coalesce((select jsonb_agg(t) from (
        select topic, count(*) as mentions from scoped where topic is not null
        group by topic order by count(*) desc limit 3) t), '[]'),
    'top_neighborhoods', coalesce((select jsonb_agg(n) from (
        select h.name, count(*) as complaints from scoped s join public.neighborhoods h on h.id = s.neighborhood_id
        where s.intent in ('queja', 'denuncia') group by h.name order by count(*) desc limit 3) n), '[]'),
    'open_tickets', (select count(*) from public.tickets t where t.org_id = p_org_id
        and t.status in ('open', 'in_progress') and (p_department_id is null or t.department_id = p_department_id))
  );
$$;

revoke execute on function public.fire_alert(uuid, text, text, public.priority, text, text, jsonb, uuid[]) from public, anon, authenticated;
revoke execute on function public.alert_volume_window(uuid, integer, integer, uuid) from public, anon, authenticated;
revoke execute on function public.alert_sentiment_window(uuid, integer, integer, uuid) from public, anon, authenticated;
revoke execute on function public.alert_candidates(uuid, timestamptz, uuid) from public, anon, authenticated;
revoke execute on function public.alert_digest(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.fire_alert(uuid, text, text, public.priority, text, text, jsonb, uuid[]) to service_role;
grant execute on function public.alert_volume_window(uuid, integer, integer, uuid) to service_role;
grant execute on function public.alert_sentiment_window(uuid, integer, integer, uuid) to service_role;
grant execute on function public.alert_candidates(uuid, timestamptz, uuid) to service_role;
grant execute on function public.alert_digest(uuid, timestamptz, timestamptz, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Crisis room
-- ---------------------------------------------------------------------------

create table public.crisis_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  alert_event_id uuid references public.alert_events (id) on delete set null,
  author_id uuid not null default auth.uid() references auth.users (id),
  author_name text not null default '',
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index crisis_log_org_created_idx on public.crisis_log (org_id, created_at desc);

alter table public.crisis_log enable row level security;
create policy "readers read crisis log" on public.crisis_log
  for select to authenticated using ((select private.can_read_all(org_id)));
create policy "editors write crisis log" on public.crisis_log
  for insert to authenticated
  with check (author_id = (select auth.uid()) and (select private.has_role(org_id, '{admin,comunicacion}')));
revoke all on public.crisis_log from anon;
revoke update, delete on public.crisis_log from authenticated;

-- Same author stamping as mention notes.
create trigger crisis_log_fill_author
  before insert on public.crisis_log
  for each row execute function private.fill_note_author();

-- Live picture for the crisis room: per-minute volume by sentiment, totals,
-- top media/public-figure spreaders and citizens only as an aggregate.
create function public.crisis_snapshot(p_org_id uuid, p_minutes integer default 60)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz := date_trunc('minute', now()) - make_interval(mins => greatest(least(p_minutes, 1440), 10) - 1);
begin
  if not private.can_read_all(p_org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  return (
    with scoped as (
      select m.id, m.published_at, m.author_id, c.sentiment, a.kind, coalesce(a.display_name, a.handle) as author,
        coalesce((m.metrics ->> 'likes')::bigint, 0) + coalesce((m.metrics ->> 'shares')::bigint, 0)
          + coalesce((m.metrics ->> 'comments')::bigint, 0) as interactions
      from public.mentions m
      left join public.classifications c on c.mention_id = m.id
      left join public.authors a on a.id = m.author_id
      where m.org_id = p_org_id and m.published_at >= v_from
    ),
    minutes as (
      select g.minute,
        count(s.id) filter (where s.sentiment = 'positive') as positive,
        count(s.id) filter (where s.sentiment = 'neutral') as neutral,
        count(s.id) filter (where s.sentiment = 'negative') as negative,
        count(s.id) filter (where s.id is not null and s.sentiment is null) as pending
      from generate_series(v_from, date_trunc('minute', now()), interval '1 minute') as g(minute)
      left join scoped s on date_trunc('minute', s.published_at) = g.minute
      group by g.minute
    )
    select jsonb_build_object(
      'from', v_from,
      'per_minute', (select jsonb_agg(to_jsonb(x) order by x.minute) from minutes x),
      'totals', (select jsonb_build_object(
          'mentions', count(*),
          'positive', count(*) filter (where sentiment = 'positive'),
          'neutral', count(*) filter (where sentiment = 'neutral'),
          'negative', count(*) filter (where sentiment = 'negative'),
          'interactions', coalesce(sum(interactions), 0)) from scoped),
      'spreaders', coalesce((select jsonb_agg(t) from (
          select s.author_id as id, max(s.author) as name, max(s.kind::text) as kind, count(*) as mentions,
            sum(s.interactions) as interactions, count(*) filter (where s.sentiment = 'negative') as negative
          from scoped s where s.kind in ('media', 'public_figure')
          group by s.author_id order by count(*) desc, sum(s.interactions) desc limit 8) t), '[]'),
      'citizens', (select jsonb_build_object('accounts', count(distinct s.author_id), 'mentions', count(*),
          'negative', count(*) filter (where s.sentiment = 'negative'))
          from scoped s where s.kind is null or s.kind = 'citizen')
    )
  );
end;
$$;

revoke execute on function public.crisis_snapshot(uuid, integer) from public, anon;
grant execute on function public.crisis_snapshot(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: new alerts (bell, toasts) and the crisis log
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.alert_events, public.crisis_log;
  end if;
end;
$$;
