-- Backoff of claim_sources without overflow. The old expression computed
-- power(2, consecutive_failures - 3) * interval '1 hour' before capping it at
-- 24 hours: from 35 consecutive failures that interval is out of range, the
-- whole claim fails and the cron reads no source at all (production, from
-- 2026-11-11 22:00 UTC, with two RSS feeds answering 404 for weeks).
-- The exponent is capped at 5 (32 h), so the wait is still 1 h, 2 h, 4 h…
-- up to 24 h, same as before and as backoffUntil in src/lib/health/model.ts.
-- Same signature, grants unchanged. Repeatable.
-- Rollback: docs/rollback/20261124000000_claim_backoff_cap.down.sql
create or replace function public.claim_sources(
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
           or s.last_error_at + least(power(2, least(s.consecutive_failures - 3, 5)) * interval '1 hour', interval '24 hours') <= now())
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
