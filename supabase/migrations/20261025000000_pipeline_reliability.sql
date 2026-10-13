-- Ingestion coverage and reliable classification (stage 2).
--
-- Ingestion
--   sources.covered_until: every item published up to here was read (except
--   gaps reported in ingest_runs). It only moves when a window is complete;
--   last_success_at keeps meaning "last run that ended without error".
--   A source is run by one worker at a time (lease), and its state and run
--   log are written in one transaction (finish_source_run).
--   ingest_mentions inserts new items and refreshes the interaction metrics
--   of known ones (latest observed value), never their text, query or status.
--
-- Classification
--   Pending mentions are claimed in batches with a lease (claim_mentions,
--   FOR UPDATE SKIP LOCKED): two workers never get the same mention. Results
--   and status are saved in one transaction (complete_classifications), only
--   by the claim's owner, and never over a human correction. Failures retry
--   with backoff up to a maximum, then go to a reviewable queue
--   (pipeline_failures) instead of looping.
--
-- Additive: new columns, tables and functions; the backfill only copies
-- last_success_at into covered_until and queues mentions already failed, and
-- can be run again. Rollback: docs/rollback/20261025000000_pipeline_reliability.down.sql.

-- ---------------------------------------------------------------------------
-- Sources: coverage watermark and run lease
-- ---------------------------------------------------------------------------
alter table public.sources
  add column covered_until timestamptz,
  add column run_lease_id uuid,
  add column run_lease_until timestamptz;

comment on column public.sources.covered_until is
  'Everything published up to this instant was read (gaps are reported in ingest_runs). Next window starts here minus an overlap.';

update public.sources set covered_until = last_success_at where covered_until is null and last_success_at is not null;

-- ---------------------------------------------------------------------------
-- Mentions: metrics refresh and classification claim
-- ---------------------------------------------------------------------------
alter table public.mentions
  add column metrics_updated_at timestamptz,
  add column claim_id uuid,
  add column claim_expires_at timestamptz,
  add column attempts smallint not null default 0 check (attempts >= 0),
  add column next_attempt_at timestamptz,
  add column last_error text;

create index mentions_pending_claim_idx on public.mentions (created_at) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Run log
-- ---------------------------------------------------------------------------
alter table public.ingest_runs drop constraint ingest_runs_status_check;
alter table public.ingest_runs
  add constraint ingest_runs_status_check check (status in ('ok', 'partial', 'error')),
  add column run_id uuid,
  -- Known items seen again whose interaction metrics changed.
  add column updated integer not null default 0,
  add column window_from timestamptz,
  add column window_to timestamptz,
  -- Whether the window was read to the end; when not, the rest is read next run.
  add column complete boolean,
  add column covered_until timestamptz,
  -- Caps reached (pages, time, comments…): [{kind, detail}].
  add column limits jsonb not null default '[]'::jsonb,
  -- Items the provider can no longer return (e.g. a feed that rolled past them).
  add column gap_from timestamptz,
  add column gap_to timestamptz;

-- One row per worker run and organization, with counters returned by the database.
create table public.worker_runs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  kind text not null check (kind in ('ingest', 'classify')),
  trigger text not null check (trigger in ('cron', 'manual')),
  org_id uuid not null references public.organizations (id) on delete cascade,
  status text not null check (status in ('ok', 'partial', 'error')),
  started_at timestamptz not null,
  finished_at timestamptz not null default now(),
  counters jsonb not null default '{}'::jsonb,
  stopped_by text,
  unique (run_id, org_id)
);
create index worker_runs_org_started_idx on public.worker_runs (org_id, kind, started_at desc);

alter table public.worker_runs enable row level security;
create policy "readers read worker runs" on public.worker_runs
  for select to authenticated using ((select private.can_read_all(org_id)));
revoke all on public.worker_runs from anon;
revoke insert, update, delete on public.worker_runs from authenticated;

-- ---------------------------------------------------------------------------
-- Reviewable failures
-- ---------------------------------------------------------------------------
create table public.pipeline_failures (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('classify', 'ingest')),
  mention_id uuid,
  source_id uuid,
  attempts integer not null default 0,
  error text,
  first_failed_at timestamptz not null default now(),
  last_failed_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id),
  resolution text check (resolution in ('retried', 'dismissed', 'recovered')),
  check ((kind = 'classify') = (mention_id is not null)),
  check ((kind = 'ingest') = (source_id is not null)),
  foreign key (org_id, mention_id) references public.mentions (org_id, id) on delete cascade,
  foreign key (org_id, source_id) references public.sources (org_id, id) on delete cascade
);
create unique index pipeline_failures_open_mention_idx on public.pipeline_failures (mention_id) where resolved_at is null;
create unique index pipeline_failures_open_source_idx on public.pipeline_failures (source_id) where resolved_at is null;
create index pipeline_failures_org_open_idx on public.pipeline_failures (org_id, last_failed_at desc) where resolved_at is null;

alter table public.pipeline_failures enable row level security;
create policy "editors read pipeline failures" on public.pipeline_failures
  for select to authenticated using ((select private.has_role(org_id, '{admin,comunicacion}')));
revoke all on public.pipeline_failures from anon;
revoke insert, update, delete on public.pipeline_failures from authenticated;

-- Mentions the classifier already gave up on: reviewable now (repeatable).
insert into public.pipeline_failures (org_id, kind, mention_id, attempts, error, first_failed_at, last_failed_at)
select m.org_id, 'classify', m.id, greatest(m.attempts, 1), 'Falló antes de la etapa 2 (sin detalle).', m.created_at, m.created_at
from public.mentions m
where m.status = 'failed'
  and not exists (select 1 from public.pipeline_failures f where f.mention_id = m.id and f.resolved_at is null);

-- ---------------------------------------------------------------------------
-- Ingestion functions (service role)
-- ---------------------------------------------------------------------------

-- Claims due sources for one worker. Cron runs skip sources in backoff
-- (1 h, 2 h, 4 h… up to 24 h after the third consecutive failure).
create function public.claim_sources(
  p_lease_id uuid,
  p_limit integer,
  p_lease_seconds integer,
  p_types public.source_type[],
  p_source_ids uuid[] default null,
  p_org_id uuid default null,
  p_respect_backoff boolean default true
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

-- Inserts new items and refreshes metrics of known ones, in one statement.
-- p_rows: [{external_id, url, text, published_at, author_id, metrics, query_id}]
create function public.ingest_mentions(p_org_id uuid, p_source_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer := 0;
  v_updated integer := 0;
  v_total integer := jsonb_array_length(coalesce(p_rows, '[]'::jsonb));
begin
  with incoming as (
    select distinct on (r.external_id) r.*
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
      external_id text, url text, text text, published_at timestamptz, author_id uuid, metrics jsonb, query_id uuid)
    order by r.external_id
  ),
  written as (
    insert into public.mentions as m (org_id, source_id, external_id, url, text, published_at, author_id, metrics, query_id,
                                      status, metrics_updated_at)
    select p_org_id, p_source_id, i.external_id, i.url, i.text, i.published_at, i.author_id, coalesce(i.metrics, '{}'::jsonb),
           i.query_id, 'pending', now()
    from incoming i
    on conflict (source_id, external_id) do update
      -- Policy: the latest observed metrics win; text, query, author and status stay as first captured.
      set metrics = excluded.metrics, metrics_updated_at = now()
      where m.metrics is distinct from excluded.metrics
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted)
  into v_inserted, v_updated
  from written;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'unchanged', v_total - v_inserted - v_updated);
end;
$$;

-- Records the outcome of a source run atomically: source state, run log and
-- the failure queue. A worker whose lease was taken over writes nothing.
-- p_state: {status, covered_until, cursor, error}; p_run: ingest_runs columns.
create function public.finish_source_run(p_source_id uuid, p_lease_id uuid, p_state jsonb, p_run jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.sources;
  v_status text := p_state ->> 'status';
  v_failures integer;
begin
  select * into v_source from public.sources where id = p_source_id for update;
  if v_source.id is null or v_source.run_lease_id is distinct from p_lease_id then
    return false;
  end if;

  v_failures := case when v_status = 'error' then v_source.consecutive_failures + 1 else 0 end;

  update public.sources
  set last_run_at = (p_run ->> 'started_at')::timestamptz,
      last_success_at = case when v_status = 'error' then last_success_at else (p_run ->> 'started_at')::timestamptz end,
      covered_until = coalesce((p_state ->> 'covered_until')::timestamptz, covered_until),
      cursor = coalesce(p_state -> 'cursor', cursor),
      last_error = case when v_status = 'ok' then null else p_state ->> 'error' end,
      last_error_at = case when v_status = 'error' then now() else last_error_at end,
      consecutive_failures = v_failures,
      run_lease_id = null,
      run_lease_until = null
  where id = p_source_id;

  insert into public.ingest_runs (org_id, source_id, run_id, trigger, status, started_at, finished_at, fetched, inserted, updated,
                                  duplicates, unmatched, error, window_from, window_to, complete, covered_until, limits, gap_from, gap_to)
  values (v_source.org_id, p_source_id, (p_run ->> 'run_id')::uuid, p_run ->> 'trigger', v_status,
          (p_run ->> 'started_at')::timestamptz, now(),
          coalesce((p_run ->> 'fetched')::integer, 0), coalesce((p_run ->> 'inserted')::integer, 0),
          coalesce((p_run ->> 'updated')::integer, 0), coalesce((p_run ->> 'duplicates')::integer, 0),
          coalesce((p_run ->> 'unmatched')::integer, 0), p_state ->> 'error',
          (p_run ->> 'window_from')::timestamptz, (p_run ->> 'window_to')::timestamptz, (p_run ->> 'complete')::boolean,
          (p_state ->> 'covered_until')::timestamptz, coalesce(p_run -> 'limits', '[]'::jsonb),
          (p_run ->> 'gap_from')::timestamptz, (p_run ->> 'gap_to')::timestamptz);

  -- Five failures in a row: the source goes to the review queue (it keeps retrying with backoff).
  if v_failures >= 5 then
    insert into public.pipeline_failures (org_id, kind, source_id, attempts, error)
    values (v_source.org_id, 'ingest', p_source_id, v_failures, p_state ->> 'error')
    on conflict (source_id) where resolved_at is null
      do update set attempts = excluded.attempts, error = excluded.error, last_failed_at = now();
  elsif v_status <> 'error' then
    update public.pipeline_failures set resolved_at = now(), resolution = 'recovered'
    where source_id = p_source_id and resolved_at is null;
  end if;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Classification functions (service role)
-- ---------------------------------------------------------------------------

-- Claims up to p_limit pending mentions for one worker. Mentions whose lease
-- expired after the last allowed attempt (a worker that kept dying on them)
-- go to the failure queue instead of being claimed again.
create function public.claim_mentions(p_claim_id uuid, p_limit integer, p_lease_seconds integer, p_max_attempts integer)
returns table (
  id uuid, org_id uuid, text text, published_at timestamptz, attempts smallint,
  project_id uuid, source_type public.source_type, source_name text,
  author_name text, author_kind public.author_kind
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  with exhausted as (
    update public.mentions m
    set status = 'failed', claim_id = null, claim_expires_at = null,
        last_error = coalesce(m.last_error, 'El trabajo se interrumpió en cada intento.')
    where m.status = 'pending' and m.claim_expires_at < now() and m.attempts >= p_max_attempts
    returning m.id, m.org_id, m.attempts, m.last_error
  )
  insert into public.pipeline_failures (org_id, kind, mention_id, attempts, error)
  select e.org_id, 'classify', e.id, e.attempts, e.last_error from exhausted e
  on conflict (mention_id) where resolved_at is null
    do update set attempts = excluded.attempts, error = excluded.error, last_failed_at = now();

  return query
  with picked as (
    select m.id
    from public.mentions m
    where m.status = 'pending'
      and (m.claim_expires_at is null or m.claim_expires_at < now())
      and (m.next_attempt_at is null or m.next_attempt_at <= now())
      and m.attempts < p_max_attempts
    order by m.created_at
    limit p_limit
    for update skip locked
  ),
  claimed as (
    update public.mentions m
    set claim_id = p_claim_id, claim_expires_at = now() + make_interval(secs => p_lease_seconds), attempts = m.attempts + 1
    from picked
    where m.id = picked.id
    returning m.*
  )
  select c.id, c.org_id, c.text, c.published_at, c.attempts, q.project_id, s.type, s.name, a.display_name, a.kind
  from claimed c
  join public.sources s on s.id = c.source_id
  left join public.queries q on q.id = c.query_id
  left join public.authors a on a.id = c.author_id
  order by c.created_at;
end;
$$;

-- Gives back claimed mentions that were not processed (time budget, provider
-- down). With p_count_attempt false the attempt is not counted.
create function public.release_mentions(p_claim_id uuid, p_ids uuid[], p_count_attempt boolean default false, p_error text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.mentions
  set claim_id = null, claim_expires_at = null,
      attempts = case when p_count_attempt then attempts else greatest(attempts - 1, 0) end,
      last_error = coalesce(p_error, last_error)
  where id = any (p_ids) and claim_id = p_claim_id and status = 'pending';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Saves a worker's results and failures in one transaction. Only mentions
-- still claimed by p_claim_id are touched (a worker whose lease expired and
-- was taken over writes nothing), and a classification a person corrected is
-- never overwritten.
-- p_results: [{mention_id, sentiment, confidence, emotion, topic, intent, priority, department_id, neighborhood_id, model}]
-- p_failures: [{mention_id, error}]
create function public.complete_classifications(p_claim_id uuid, p_results jsonb, p_failures jsonb, p_max_attempts integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_saved integer := 0;
  v_kept_correction integer := 0;
  v_retry integer := 0;
  v_dead integer := 0;
  v_owned uuid[];
begin
  -- Lock the claimed rows first: a concurrent claim cannot take them mid-way.
  select coalesce(array_agg(o.id), '{}') into v_owned
  from (
    select m.id
    from public.mentions m
    where m.claim_id = p_claim_id and m.status = 'pending'
      and m.id in (select (r ->> 'mention_id')::uuid from jsonb_array_elements(coalesce(p_results, '[]') || coalesce(p_failures, '[]')) r)
    for update
  ) o;

  with incoming as (
    select r.* from jsonb_to_recordset(coalesce(p_results, '[]'::jsonb)) as r(
      mention_id uuid, sentiment public.sentiment, confidence numeric, emotion text, topic text, intent text,
      priority public.priority, department_id uuid, neighborhood_id uuid, model text)
    where r.mention_id = any (v_owned)
  ),
  written as (
    insert into public.classifications as c (org_id, mention_id, sentiment, confidence, emotion, topic, intent, priority,
                                             department_id, neighborhood_id, model)
    select m.org_id, i.mention_id, i.sentiment, i.confidence, i.emotion, i.topic, i.intent, i.priority,
           i.department_id, i.neighborhood_id, i.model
    from incoming i join public.mentions m on m.id = i.mention_id
    on conflict (mention_id) do update
      set sentiment = excluded.sentiment, confidence = excluded.confidence, emotion = excluded.emotion,
          topic = excluded.topic, intent = excluded.intent, priority = excluded.priority,
          department_id = excluded.department_id, neighborhood_id = excluded.neighborhood_id, model = excluded.model
      where c.corrected_at is null
    returning c.mention_id
  )
  select count(*) into v_saved from written;

  select count(*) into v_kept_correction
  from jsonb_to_recordset(coalesce(p_results, '[]'::jsonb)) as r(mention_id uuid)
  join public.classifications c on c.mention_id = r.mention_id
  where r.mention_id = any (v_owned) and c.corrected_at is not null;

  update public.mentions m
  set status = 'classified', claim_id = null, claim_expires_at = null, next_attempt_at = null, last_error = null
  where m.id = any (v_owned)
    and m.id in (select (r ->> 'mention_id')::uuid from jsonb_array_elements(coalesce(p_results, '[]')) r);

  -- Failures: retry later with backoff (2, 4, 8… minutes, up to 6 h) or, at the last attempt, to the queue.
  with f as (
    select r.mention_id, left(r.error, 500) as error
    from jsonb_to_recordset(coalesce(p_failures, '[]'::jsonb)) as r(mention_id uuid, error text)
    where r.mention_id = any (v_owned)
  ),
  retried as (
    update public.mentions m
    set claim_id = null, claim_expires_at = null, last_error = f.error,
        next_attempt_at = now() + least(power(2, m.attempts) * interval '1 minute', interval '6 hours')
    from f
    where m.id = f.mention_id and m.attempts < p_max_attempts
    returning m.id
  ),
  dead as (
    update public.mentions m
    set status = 'failed', claim_id = null, claim_expires_at = null, last_error = f.error
    from f
    where m.id = f.mention_id and m.attempts >= p_max_attempts
    returning m.id, m.org_id, m.attempts, f.error
  ),
  queued as (
    insert into public.pipeline_failures (org_id, kind, mention_id, attempts, error)
    select d.org_id, 'classify', d.id, d.attempts, d.error from dead d
    on conflict (mention_id) where resolved_at is null
      do update set attempts = excluded.attempts, error = excluded.error, last_failed_at = now()
    returning 1
  )
  select (select count(*) from retried), (select count(*) from dead) into v_retry, v_dead;

  return jsonb_build_object(
    'saved', v_saved,
    'kept_correction', v_kept_correction,
    'stale', jsonb_array_length(coalesce(p_results, '[]')) + jsonb_array_length(coalesce(p_failures, '[]')) - cardinality(v_owned),
    'retry', v_retry,
    'dead', v_dead
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Review queue (admin and comunicacion)
-- ---------------------------------------------------------------------------
create function public.resolve_pipeline_failure(p_failure_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_failure public.pipeline_failures;
begin
  select * into v_failure from public.pipeline_failures where id = p_failure_id for update;
  if v_failure.id is null or not private.has_role(v_failure.org_id, '{admin,comunicacion}') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_failure.resolved_at is not null then
    return;
  end if;
  if p_action not in ('retry', 'dismiss') then
    raise exception 'acción inválida' using errcode = '22023';
  end if;

  if p_action = 'retry' and v_failure.kind = 'classify' then
    update public.mentions
    set status = 'pending', attempts = 0, next_attempt_at = null, claim_id = null, claim_expires_at = null
    where id = v_failure.mention_id and status = 'failed';
  elsif p_action = 'retry' and v_failure.kind = 'ingest' then
    -- Out of backoff: the next cron run picks it up.
    update public.sources set last_error_at = null where id = v_failure.source_id;
  end if;

  update public.pipeline_failures
  set resolved_at = now(), resolved_by = (select auth.uid()),
      resolution = case when p_action = 'retry' then 'retried' else 'dismissed' end
  where id = p_failure_id;
end;
$$;

revoke execute on function public.claim_sources(uuid, integer, integer, public.source_type[], uuid[], uuid, boolean) from public, anon, authenticated;
revoke execute on function public.ingest_mentions(uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.finish_source_run(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.claim_mentions(uuid, integer, integer, integer) from public, anon, authenticated;
revoke execute on function public.release_mentions(uuid, uuid[], boolean, text) from public, anon, authenticated;
revoke execute on function public.complete_classifications(uuid, jsonb, jsonb, integer) from public, anon, authenticated;
grant execute on function public.claim_sources(uuid, integer, integer, public.source_type[], uuid[], uuid, boolean) to service_role;
grant execute on function public.ingest_mentions(uuid, uuid, jsonb) to service_role;
grant execute on function public.finish_source_run(uuid, uuid, jsonb, jsonb) to service_role;
grant execute on function public.claim_mentions(uuid, integer, integer, integer) to service_role;
grant execute on function public.release_mentions(uuid, uuid[], boolean, text) to service_role;
grant execute on function public.complete_classifications(uuid, jsonb, jsonb, integer) to service_role;

revoke execute on function public.resolve_pipeline_failure(uuid, text) from public, anon;
grant execute on function public.resolve_pipeline_failure(uuid, text) to authenticated;
