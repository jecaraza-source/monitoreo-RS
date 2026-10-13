-- Monitor health (stage 3): per-source thresholds and frequency, classifier
-- thresholds per org, persisted heartbeats of the background jobs, one read
-- function for the health page and a "monitor_health" alert kind.
--
-- Additive. Defaults keep today's behavior: every source is expected hourly
-- (the ingest cron's cadence). Rollback: docs/rollback/20261026000000_monitor_health.down.sql.

-- ---------------------------------------------------------------------------
-- Per-source thresholds
-- ---------------------------------------------------------------------------
alter table public.sources
  -- How often the source should be read; the cron skips it until then.
  add column expected_every_minutes integer not null default 60 check (expected_every_minutes between 15 and 10080),
  -- Behind after this long without coverage; null = 3 × expected_every_minutes.
  add column stale_after_minutes integer check (stale_after_minutes between 15 and 43200),
  -- No new item for this long is reported as "the provider published nothing", not as an error.
  add column quiet_after_hours integer not null default 72 check (quiet_after_hours between 1 and 2160);

grant update (expected_every_minutes, stale_after_minutes, quiet_after_hours) on public.sources to authenticated;

-- ---------------------------------------------------------------------------
-- Per-org classifier and dashboard thresholds
-- ---------------------------------------------------------------------------
create table public.monitor_settings (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  -- Oldest pending mention older than this: backlog.
  classify_backlog_minutes integer not null default 30 check (classify_backlog_minutes between 5 and 1440),
  -- No classifier run for this long while mentions wait: stalled.
  classify_stale_minutes integer not null default 20 check (classify_stale_minutes between 5 and 1440),
  -- Dashboard rollup older than this while newer classifications exist: stale.
  dashboard_stale_minutes integer not null default 30 check (dashboard_stale_minutes between 5 and 1440),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) default auth.uid()
);

alter table public.monitor_settings enable row level security;
create policy "readers read monitor settings" on public.monitor_settings
  for select to authenticated using ((select private.can_read_all(org_id)));
create policy "editors insert monitor settings" on public.monitor_settings
  for insert to authenticated with check ((select private.has_role(org_id, '{admin,comunicacion}')));
create policy "editors update monitor settings" on public.monitor_settings
  for update to authenticated
  using ((select private.has_role(org_id, '{admin,comunicacion}')))
  with check ((select private.has_role(org_id, '{admin,comunicacion}')));
revoke all on public.monitor_settings from anon;
revoke insert, update, delete on public.monitor_settings from authenticated;
grant insert (org_id, classify_backlog_minutes, classify_stale_minutes, dashboard_stale_minutes) on public.monitor_settings to authenticated;
grant update (classify_backlog_minutes, classify_stale_minutes, dashboard_stale_minutes) on public.monitor_settings to authenticated;

create trigger audit_monitor_settings after insert or update or delete on public.monitor_settings
  for each row when (auth.uid() is not null) execute function private.audit_row();

-- ---------------------------------------------------------------------------
-- Heartbeats: when each background job last ran, persisted
-- ---------------------------------------------------------------------------
create table public.worker_heartbeats (
  kind text primary key check (kind in ('ingest', 'classify', 'dashboard')),
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_ok_at timestamptz,
  last_error text
);
-- Read only through monitor_health(); written by the service role.
alter table public.worker_heartbeats enable row level security;
revoke all on public.worker_heartbeats from anon, authenticated;

create function public.record_heartbeat(p_kind text, p_phase text, p_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.worker_heartbeats as h (kind, last_started_at)
  values (p_kind, case when p_phase = 'start' then now() end)
  on conflict (kind) do update
    set last_started_at = case when p_phase = 'start' then now() else h.last_started_at end,
        last_finished_at = case when p_phase = 'finish' then now() else h.last_finished_at end,
        last_ok_at = case when p_phase = 'finish' and p_error is null then now() else h.last_ok_at end,
        last_error = case when p_phase = 'finish' then left(p_error, 500) else h.last_error end;
end;
$$;
revoke execute on function public.record_heartbeat(text, text, text) from public, anon, authenticated;
grant execute on function public.record_heartbeat(text, text, text) to service_role;

-- The dashboard rollup records when it was rebuilt.
create or replace function public.refresh_mention_stats()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.refresh_mention_stats();
  insert into public.worker_heartbeats as h (kind, last_started_at, last_finished_at, last_ok_at)
  values ('dashboard', now(), now(), now())
  on conflict (kind) do update set last_started_at = now(), last_finished_at = now(), last_ok_at = now(), last_error = null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Source claims: cron runs respect each source's frequency; manual runs of
-- the same source are at least p_min_gap_seconds apart.
-- ---------------------------------------------------------------------------
drop function public.claim_sources(uuid, integer, integer, public.source_type[], uuid[], uuid, boolean);

create function public.claim_sources(
  p_lease_id uuid,
  p_limit integer,
  p_lease_seconds integer,
  p_types public.source_type[],
  p_source_ids uuid[] default null,
  p_org_id uuid default null,
  -- Cron runs: backoff after failures and the source's expected frequency.
  p_respect_backoff boolean default true,
  p_min_gap_seconds integer default 0
)
returns setof public.sources
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with picked as (
    select s.id
    from public.sources s
    where s.is_active
      and s.type = any (p_types)
      and (s.run_lease_until is null or s.run_lease_until < now())
      and (p_source_ids is null or s.id = any (p_source_ids))
      and (p_org_id is null or s.org_id = p_org_id)
      and (not p_respect_backoff or s.consecutive_failures < 3 or s.last_error_at is null
           or s.last_error_at + least(power(2, s.consecutive_failures - 3) * interval '1 hour', interval '24 hours') <= now())
      -- 5 minutes of slack so an hourly source is not skipped by cron jitter.
      and (not p_respect_backoff or s.last_run_at is null
           or s.last_run_at <= now() - make_interval(mins => s.expected_every_minutes) + interval '5 minutes')
      and (p_min_gap_seconds = 0 or s.last_run_at is null or s.last_run_at <= now() - make_interval(secs => p_min_gap_seconds))
    order by s.last_run_at asc nulls first
    limit p_limit
    for update skip locked
  )
  update public.sources s
  set run_lease_id = p_lease_id, run_lease_until = now() + make_interval(secs => p_lease_seconds)
  from picked
  where s.id = picked.id
  returning s.*;
end;
$$;
revoke execute on function public.claim_sources(uuid, integer, integer, public.source_type[], uuid[], uuid, boolean, integer) from public, anon, authenticated;
grant execute on function public.claim_sources(uuid, integer, integer, public.source_type[], uuid[], uuid, boolean, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Health snapshot for one org, from persisted data only.
-- Readers of the whole org (admin, comunicacion, lectura) and the service
-- role (health alerts). Error texts and caps only for admin and comunicacion.
-- ---------------------------------------------------------------------------
create function public.monitor_health(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_editor boolean := private.has_role(p_org_id, '{admin,comunicacion}') or private.is_service_role();
begin
  if not (private.can_read_all(p_org_id) or private.is_service_role()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'as_of', now(),
    'editor', v_editor,
    'settings', coalesce(
      (select to_jsonb(ms) - 'org_id' - 'updated_by' from public.monitor_settings ms where ms.org_id = p_org_id),
      jsonb_build_object('classify_backlog_minutes', 30, 'classify_stale_minutes', 20, 'dashboard_stale_minutes', 30)),
    'heartbeats', coalesce((
      select jsonb_object_agg(h.kind, jsonb_build_object(
        'last_started_at', h.last_started_at, 'last_finished_at', h.last_finished_at, 'last_ok_at', h.last_ok_at,
        'failed', h.last_error is not null,
        'last_error', case when v_editor then h.last_error end))
      from public.worker_heartbeats h), '{}'::jsonb),
    'classifier', (
      select jsonb_build_object(
        'pending', count(*) filter (where m.status = 'pending'),
        'waiting_retry', count(*) filter (where m.status = 'pending' and m.next_attempt_at > now()),
        'in_flight', count(*) filter (where m.status = 'pending' and m.claim_expires_at > now()),
        'oldest_pending_at', min(m.created_at) filter (where m.status = 'pending'),
        'failed', count(*) filter (where m.status = 'failed'),
        'open_failures', (select count(*) from public.pipeline_failures f where f.org_id = p_org_id and f.resolved_at is null),
        'latest_classified_at', (select max(c.created_at) from public.classifications c where c.org_id = p_org_id))
      from public.mentions m
      where m.org_id = p_org_id and m.status in ('pending', 'failed')),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'type', s.type, 'is_active', s.is_active,
        'expected_every_minutes', s.expected_every_minutes,
        'stale_after_minutes', s.stale_after_minutes,
        'quiet_after_hours', s.quiet_after_hours,
        'last_run_at', s.last_run_at, 'last_success_at', s.last_success_at,
        'last_error_at', s.last_error_at, 'consecutive_failures', s.consecutive_failures,
        'last_error', case when v_editor then s.last_error end,
        'covered_until', s.covered_until,
        'catching_up', coalesce(s.cursor -> 'backfill', 'null'::jsonb) <> 'null'::jsonb,
        'running', s.run_lease_until > now(),
        'last_new_item_at', (select max(m.created_at) from public.mentions m where m.source_id = s.id),
        'last_run', (
          select jsonb_build_object(
            'id', r.id, 'status', r.status, 'trigger', r.trigger, 'started_at', r.started_at, 'complete', r.complete,
            'fetched', r.fetched, 'inserted', r.inserted, 'duplicates', r.duplicates, 'unmatched', r.unmatched, 'updated', r.updated,
            'gap_from', r.gap_from, 'gap_to', r.gap_to,
            'limits', case when v_editor then r.limits else '[]'::jsonb end,
            'error', case when v_editor then r.error end)
          from public.ingest_runs r where r.source_id = s.id order by r.started_at desc limit 1),
        'day', (
          select jsonb_build_object('runs', count(*), 'errors', count(*) filter (where r.status = 'error'),
            'partial', count(*) filter (where r.status = 'partial'),
            'fetched', coalesce(sum(r.fetched), 0), 'inserted', coalesce(sum(r.inserted), 0),
            'duplicates', coalesce(sum(r.duplicates), 0), 'unmatched', coalesce(sum(r.unmatched), 0))
          from public.ingest_runs r where r.source_id = s.id and r.started_at > now() - interval '24 hours')
      ) order by s.created_at)
      from public.sources s where s.org_id = p_org_id), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.monitor_health(uuid) from public, anon;
grant execute on function public.monitor_health(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Alerts: health of the monitor itself
-- ---------------------------------------------------------------------------
alter table public.alert_rules drop constraint alert_rules_kind_check;
alter table public.alert_rules add constraint alert_rules_kind_check
  check (kind in ('spike', 'sentiment_drop', 'risk_term', 'media_negative', 'daily_digest', 'monitor_health'));
