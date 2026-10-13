-- Reversión de supabase/migrations/20261025000000_pipeline_reliability.sql.
-- Quita funciones, tablas y columnas nuevas. Correr sólo junto con la reversión
-- de la app (la app de la etapa 2 llama a estas funciones).
-- Se pierde: la cola de fallos (pipeline_failures), el registro por organización
-- (worker_runs), la marca de cobertura (covered_until) y las columnas de
-- reserva/intentos de las menciones. Las menciones, clasificaciones y corridas
-- (ingest_runs) se conservan; las corridas 'partial' pasan a 'ok' para cumplir
-- la restricción anterior.
begin;

drop function public.resolve_pipeline_failure(uuid, text);
drop function public.complete_classifications(uuid, jsonb, jsonb, integer);
drop function public.release_mentions(uuid, uuid[], boolean, text);
drop function public.claim_mentions(uuid, integer, integer, integer);
drop function public.finish_source_run(uuid, uuid, jsonb, jsonb);
drop function public.ingest_mentions(uuid, uuid, jsonb);
drop function public.claim_sources(uuid, integer, integer, public.source_type[], uuid[], uuid, boolean);

drop table public.pipeline_failures;
drop table public.worker_runs;

update public.ingest_runs set status = 'ok' where status = 'partial';
alter table public.ingest_runs drop constraint ingest_runs_status_check;
alter table public.ingest_runs add constraint ingest_runs_status_check check (status in ('ok', 'error'));
alter table public.ingest_runs
  drop column run_id, drop column updated, drop column window_from, drop column window_to, drop column complete,
  drop column covered_until, drop column limits, drop column gap_from, drop column gap_to;

-- Menciones reservadas por un worker que ya no existe vuelven a quedar pendientes sin reserva.
drop index public.mentions_pending_claim_idx;
alter table public.mentions
  drop column metrics_updated_at, drop column claim_id, drop column claim_expires_at, drop column attempts,
  drop column next_attempt_at, drop column last_error;

-- La app anterior lee desde last_success_at; covered_until nunca está por delante de él.
alter table public.sources drop column covered_until, drop column run_lease_id, drop column run_lease_until;

delete from supabase_migrations.schema_migrations where version = '20261025000000';
commit;
