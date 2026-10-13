-- Reversión de supabase/migrations/20261029000000_triage.sql.
-- Correr sólo junto con la reversión de la app (la app de la etapa 5 llama a
-- inbox_queue, inbox_counts, correct_classification, decide_review y lee las
-- columnas nuevas de classifications).
--
-- Se conserva: menciones, clasificaciones (sentimiento, prioridad, tema…),
-- turnos y casos.
-- Se pierde: gravedad, tipo de incidente, necesidad de atención y
-- confirmaciones; la cola de revisión y sus decisiones; las versiones previas
-- de clasificaciones; las políticas de emergencia; la cola de invalidación.
-- Para conservarlos, exportar antes (ver docs/etapa-5-bandeja-operativa.md).
begin;

-- Funciones previas: el clasificador sin los campos nuevos y el sello de corrección original.
create or replace function public.complete_classifications(p_claim_id uuid, p_results jsonb, p_failures jsonb, p_max_attempts integer)
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

create or replace function private.stamp_correction()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Service-role writes (the classifier) carry no user; people always do.
  if (select auth.uid()) is not null then
    new.corrected_by := (select auth.uid());
    new.corrected_at := now();
  end if;
  return new;
end;
$$;

drop function public.inbox_counts(uuid, jsonb);
drop function public.inbox_queue(uuid, text, jsonb, jsonb, integer);
drop function public.inbox_items(uuid, jsonb);

drop function public.stats_invalidation_status(uuid);
drop function public.process_stats_invalidations();
drop trigger classifications_invalidate_stats on public.classifications;
drop function private.invalidate_stats_on_correction();
drop table public.stats_invalidations;
alter table public.reports drop column facts_stale_at;

drop function public.decide_review(uuid, text, jsonb, text);
drop function public.confirm_classification(uuid);
drop function public.correct_classification(uuid, jsonb, text);
drop function private.apply_classification_changes(uuid, jsonb, text);

drop trigger organizations_seed_incident_policies on public.organizations;
drop function private.seed_org_incident_policies();
drop function private.seed_incident_policies(uuid);
drop table public.incident_policies;

drop trigger classifications_queue_review on public.classifications;
drop function private.queue_classification_review();
drop function private.review_reasons(public.classifications);
drop table public.classification_reviews;
alter table public.monitor_settings drop column review_confidence_below;

drop trigger classifications_version on public.classifications;
drop function private.version_classification();
drop table public.classification_versions;
drop function private.classification_changed(public.classifications, public.classifications);
drop function private.append_only();

alter table public.classifications
  drop column severity,
  drop column incident_type,
  drop column needs_attention,
  drop column confirmed_by,
  drop column confirmed_at;
drop type public.severity;

delete from supabase_migrations.schema_migrations where version = '20261029000000';
commit;
