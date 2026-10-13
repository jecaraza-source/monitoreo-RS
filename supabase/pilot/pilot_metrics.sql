-- Pilot metrics (stage 12). READ ONLY: selects only, no writes. One row per
-- metric for one organization and one period; run weekly during the pilot and
-- paste the result in the pilot log (docs/etapa-12-piloto.md § 5).
--
--   psql "$DB_URL" -v org=<org uuid> -v days=7 -f supabase/pilot/pilot_metrics.sql
--
-- Fields with no data return null (never 0 for an unknown value).
\set ON_ERROR_STOP on
\if :{?days} \else \set days 7 \endif
begin transaction read only;

with p as (select :'org'::uuid as org, now() - make_interval(days => :days) as since, now() as until),
-- Coverage: active sources and how many read successfully in the period, plus open gaps.
coverage as (
  select
    (select count(*) from public.sources s, p where s.org_id = p.org and s.is_active) as active_sources,
    (select count(distinct r.source_id) from public.ingest_runs r, p where r.org_id = p.org and r.started_at >= p.since and r.status in ('ok', 'partial')) as sources_read,
    (select count(*) from public.ingest_runs r, p where r.org_id = p.org and r.started_at >= p.since and r.gap_from is not null) as runs_with_gap,
    (select count(*) from public.sources s, p where s.org_id = p.org and s.is_active
       and (s.last_success_at is null or s.last_success_at < now() - make_interval(mins => coalesce(s.stale_after_minutes, 180)))) as stale_sources
),
-- Backlog: what waits now.
backlog as (
  select
    (select count(*) from public.mentions m, p where m.org_id = p.org and m.status = 'pending') as pending_classification,
    (select count(*) from public.mentions m, p where m.org_id = p.org and m.status = 'pending' and m.created_at < now() - interval '1 hour') as pending_over_1h,
    (select count(*) from public.classification_reviews r, p where r.org_id = p.org and r.status = 'pending') as review_queue,
    (select count(*) from public.cases c, p where c.org_id = p.org and c.status in ('assigned', 'accepted', 'in_progress') and c.due_at < now()) as cases_overdue,
    (select count(*) from public.cases c, p where c.org_id = p.org and c.status = 'assigned' and c.accept_due_at < now()) as cases_acceptance_overdue
),
-- Errors in the period.
errors as (
  select
    (select count(*) from public.ingest_runs r, p where r.org_id = p.org and r.started_at >= p.since and r.status = 'error') as ingest_errors,
    (select count(*) from public.worker_runs w, p where w.org_id = p.org and w.started_at >= p.since and w.status = 'error') as classify_errors,
    (select count(*) from public.pipeline_failures f, p where f.org_id = p.org and f.resolved_at is null) as open_failures,
    (select count(*) from public.mentions m, p where m.org_id = p.org and m.status = 'failed') as failed_mentions,
    (select count(*) from public.outbox o, p where o.org_id = p.org and o.created_at >= p.since and o.status in ('dead', 'uncertain')) as notifications_failed,
    (select count(*) from public.outbox o, p where o.org_id = p.org and o.created_at >= p.since and o.status = 'sent') as notifications_sent
),
-- AI cost in the period (unknown cost counted apart, never as 0).
costs as (
  select
    (select sum(a.cost_usd) from public.ai_calls a, p where a.org_id = p.org and a.created_at >= p.since and a.status = 'settled') as ai_cost_usd,
    (select count(*) from public.ai_calls a, p where a.org_id = p.org and a.created_at >= p.since and a.cost_status = 'unknown') as ai_calls_unknown_cost,
    (select count(*) from public.ai_calls a, p where a.org_id = p.org and a.created_at >= p.since) as ai_calls,
    (select count(*) from public.mentions m, p where m.org_id = p.org and m.created_at >= p.since) as mentions_in_period
),
-- Attention: cases opened and closed, times to accept and to close.
attention as (
  select
    (select count(*) from public.cases c, p where c.org_id = p.org and c.opened_at >= p.since) as cases_opened,
    (select count(*) from public.cases c, p where c.org_id = p.org and c.closed_at >= p.since) as cases_closed,
    (select percentile_cont(0.5) within group (order by extract(epoch from c.accepted_at - c.assigned_at) / 3600)
       from public.cases c, p where c.org_id = p.org and c.accepted_at >= p.since and c.assigned_at is not null) as median_hours_to_accept,
    (select percentile_cont(0.5) within group (order by extract(epoch from c.closed_at - c.opened_at) / 3600)
       from public.cases c, p where c.org_id = p.org and c.closed_at >= p.since) as median_hours_to_close,
    (select count(*) filter (where c.closed_at > c.due_at)::numeric / nullif(count(*), 0)
       from public.cases c, p where c.org_id = p.org and c.closed_at >= p.since and c.due_at is not null) as share_closed_late
),
-- Accuracy as seen by people: corrections and review decisions in the period.
accuracy as (
  select
    (select count(*) from public.classifications c, p where c.org_id = p.org and c.corrected_at >= p.since) as corrections,
    (select count(*) from public.classifications c, p where c.org_id = p.org and c.created_at >= p.since) as classified_in_period,
    (select count(*) from public.classification_reviews r, p where r.org_id = p.org and r.decided_at >= p.since and r.status = 'confirmed') as reviews_confirmed,
    (select count(*) from public.classification_reviews r, p where r.org_id = p.org and r.decided_at >= p.since and r.status = 'corrected') as reviews_corrected
)
select 'cobertura' as grupo, to_jsonb(coverage) as valores from coverage
union all select 'atraso', to_jsonb(backlog) from backlog
union all select 'errores', to_jsonb(errors) from errors
union all select 'costos', to_jsonb(costs) from costs
union all select 'atencion', to_jsonb(attention) from attention
union all select 'exactitud', to_jsonb(accuracy) from accuracy;

rollback;
