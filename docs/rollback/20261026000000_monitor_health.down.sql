-- Reversión de supabase/migrations/20261026000000_monitor_health.sql.
-- Correr sólo junto con la reversión de la app (la app de la etapa 3 llama a
-- monitor_health y a claim_sources con p_min_gap_seconds).
-- Se pierde: umbrales por fuente y del clasificador, latidos de los procesos y
-- las reglas de alerta "monitor_health" (se borran; sus eventos se conservan).
begin;

delete from public.alert_rules where kind = 'monitor_health';
alter table public.alert_rules drop constraint alert_rules_kind_check;
alter table public.alert_rules add constraint alert_rules_kind_check
  check (kind in ('spike', 'sentiment_drop', 'risk_term', 'media_negative', 'daily_digest'));

drop function public.monitor_health(uuid);

-- claim_sources de la etapa 2 (sin frecuencia ni espera manual).
drop function public.claim_sources(uuid, integer, integer, public.source_type[], uuid[], uuid, boolean, integer);
create function public.claim_sources(
  p_lease_id uuid, p_limit integer, p_lease_seconds integer, p_types public.source_type[],
  p_source_ids uuid[] default null, p_org_id uuid default null, p_respect_backoff boolean default true
)
returns setof public.sources
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with picked as (
    select s.id from public.sources s
    where s.is_active and s.type = any (p_types)
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
  from picked where s.id = picked.id
  returning s.*;
end;
$$;
revoke execute on function public.claim_sources(uuid, integer, integer, public.source_type[], uuid[], uuid, boolean) from public, anon, authenticated;
grant execute on function public.claim_sources(uuid, integer, integer, public.source_type[], uuid[], uuid, boolean) to service_role;

create or replace function public.refresh_mention_stats()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.refresh_mention_stats();
end;
$$;

drop function public.record_heartbeat(text, text, text);
drop table public.worker_heartbeats;
drop table public.monitor_settings;
alter table public.sources drop column expected_every_minutes, drop column stale_after_minutes, drop column quiet_after_hours;

delete from supabase_migrations.schema_migrations where version = '20261026000000';
commit;
