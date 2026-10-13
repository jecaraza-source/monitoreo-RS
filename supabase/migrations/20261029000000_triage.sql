-- Stage 5: operational inbox and human review.
--
-- * Sentiment, severity and need of attention are separate: a negative
--   critique is not an emergency. Severity, incident type and need of
--   attention are new classification fields; priority stays the operational
--   urgency.
-- * Every change to a classification keeps the previous version
--   (classification_versions, append-only) for audit and evaluation.
-- * Low confidence, high risk and doubtful classifications go to a human
--   review queue (classification_reviews); decisions keep the change and
--   the reason.
-- * Incident policies tell, before routing an emergency, which institutional
--   channel handles it.
-- * A correction enqueues a durable invalidation (stats_invalidations) that
--   the server processes within the dashboard freshness SLA.
-- * inbox_items: one invoker function (RLS applies) behind the queue views
--   and their counters, so a counter is exactly the size of its list.
--
-- Additive. The backfill of needs_attention is repeatable (only null rows).
-- Rollback: docs/rollback/20261029000000_triage.down.sql.

-- ---------------------------------------------------------------------------
-- Classification: severity, incident type, need of attention
-- ---------------------------------------------------------------------------
create type public.severity as enum ('none', 'low', 'moderate', 'high', 'emergency');

alter table public.classifications
  add column severity public.severity,
  add column incident_type text check (incident_type in (
    'none', 'public_service', 'infrastructure', 'public_safety', 'violence', 'health',
    'civil_protection', 'environment', 'corruption', 'other')),
  add column needs_attention boolean,
  -- A person confirmed the incident type and urgency as they are.
  add column confirmed_by uuid references auth.users (id),
  add column confirmed_at timestamptz;

-- Repeatable backfill: rows classified before this stage get a need of
-- attention from their intent (complaints, reports and questions need one).
-- Severity and incident type stay unknown (null) until the model or a person sets them.
update public.classifications
set needs_attention = intent in ('queja', 'denuncia', 'pregunta')
where needs_attention is null;

-- Who may edit: same policy as before (admin, comunicacion); the new columns too.
-- (classifications has table-level update for authenticated; RLS limits it to editors.)

-- ---------------------------------------------------------------------------
-- Versions: the state before every change, append-only
-- ---------------------------------------------------------------------------
create table public.classification_versions (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  mention_id uuid not null,
  version integer not null,
  -- The classification as it was (all columns).
  snapshot jsonb not null,
  -- Who produced that state: the model or a person.
  source text not null check (source in ('model', 'human')),
  replaced_at timestamptz not null default now(),
  replaced_by uuid references auth.users (id),
  reason text,
  unique (mention_id, version),
  foreign key (org_id, mention_id) references public.mentions (org_id, id) on delete cascade
);
create index classification_versions_org_idx on public.classification_versions (org_id, replaced_at desc);

create function private.append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Este registro de auditoría no se modifica.' using errcode = '42501';
end;
$$;
create trigger classification_versions_append_only before update on public.classification_versions
  for each row execute function private.append_only();

alter table public.classification_versions enable row level security;
create policy "readers read classification versions" on public.classification_versions
  for select to authenticated using ((select private.can_read_all(org_id)));
revoke all on public.classification_versions from anon;
revoke insert, update, delete, truncate on public.classification_versions from authenticated;
revoke update, delete, truncate on public.classification_versions from service_role;

-- Fields whose change makes a new version (confirmation alone does not).
create function private.classification_changed(o public.classifications, n public.classifications)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (o.sentiment, o.confidence, o.emotion, o.topic, o.intent, o.priority, o.department_id, o.neighborhood_id,
          o.severity, o.incident_type, o.needs_attention, o.model)
         is distinct from
         (n.sentiment, n.confidence, n.emotion, n.topic, n.intent, n.priority, n.department_id, n.neighborhood_id,
          n.severity, n.incident_type, n.needs_attention, n.model);
$$;

-- A person's update stamps the correction only when it changes the
-- classification (a confirmation alone is not a correction).
create or replace function private.stamp_correction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and private.classification_changed(old, new) then
    new.corrected_by := (select auth.uid());
    new.corrected_at := now();
  elsif (select auth.uid()) is not null then
    new.corrected_by := old.corrected_by;
    new.corrected_at := old.corrected_at;
  end if;
  return new;
end;
$$;

create function private.version_classification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.classification_changed(old, new) then
    return new;
  end if;
  insert into public.classification_versions (org_id, mention_id, version, snapshot, source, replaced_by, reason)
  values (
    old.org_id, old.mention_id,
    coalesce((select max(v.version) from public.classification_versions v where v.mention_id = old.mention_id), 0) + 1,
    to_jsonb(old),
    case when old.corrected_at is null then 'model' else 'human' end,
    (select auth.uid()),
    nullif(current_setting('app.correction_reason', true), '')
  );
  return new;
end;
$$;
create trigger classifications_version before update on public.classifications
  for each row execute function private.version_classification();

-- ---------------------------------------------------------------------------
-- Review settings and queue
-- ---------------------------------------------------------------------------
alter table public.monitor_settings
  add column review_confidence_below numeric(3, 2) not null default 0.60 check (review_confidence_below between 0.30 and 0.95);
grant insert (review_confidence_below) on public.monitor_settings to authenticated;
grant update (review_confidence_below) on public.monitor_settings to authenticated;

create table public.classification_reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  mention_id uuid not null,
  -- low_confidence, high_risk, risk_term, emergency, doubtful.
  reasons text[] not null check (cardinality(reasons) > 0),
  -- The model's output when it was queued.
  ai_output jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'corrected', 'dismissed')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users (id),
  decision_reason text,
  -- {field: [before, after]} for corrections.
  changes jsonb not null default '{}',
  foreign key (org_id, mention_id) references public.mentions (org_id, id) on delete cascade,
  check ((status = 'pending') = (decided_at is null))
);
create unique index classification_reviews_one_pending on public.classification_reviews (mention_id) where status = 'pending';
create index classification_reviews_queue_idx on public.classification_reviews (org_id, created_at) where status = 'pending';

alter table public.classification_reviews enable row level security;
-- Reviewing is editorial work: departments never see the queue.
create policy "readers read classification reviews" on public.classification_reviews
  for select to authenticated using ((select private.can_read_all(org_id)));
revoke all on public.classification_reviews from anon;
revoke insert, update, delete, truncate on public.classification_reviews from authenticated;

-- Why a model classification needs a person (empty: it does not).
create function private.review_reasons(c public.classifications)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select array_remove(array[
    case when c.confidence is not null and c.confidence < coalesce(
      (select s.review_confidence_below from public.monitor_settings s where s.org_id = c.org_id), 0.60)
      then 'low_confidence' end,
    case when c.severity = 'emergency' then 'emergency' end,
    case when c.severity = 'high' or (c.severity is null and c.priority in ('high', 'critical')) then 'high_risk' end,
    case when exists (
      select 1 from public.risk_terms r join public.mentions m on m.id = c.mention_id
      where r.org_id = c.org_id and r.severity in ('high', 'critical')
        and position(' ' || r.normalized in ' ' || regexp_replace(lower(extensions.unaccent(m.text)), '[^a-z0-9]+', ' ', 'g')) > 0
    ) then 'risk_term' end,
    -- Signals that contradict each other.
    case when (c.sentiment = 'positive' and c.intent in ('queja', 'denuncia'))
           or (c.sentiment = 'negative' and c.intent = 'elogio')
           or (c.severity in ('high', 'emergency') and c.needs_attention is false)
           or (c.severity = 'none' and c.priority in ('high', 'critical'))
      then 'doubtful' end
  ], null);
$$;

-- The model's writes (no person) queue what needs review; people's do not.
create function private.queue_classification_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reasons text[];
begin
  if (select auth.uid()) is not null or new.corrected_at is not null then
    return new;
  end if;
  v_reasons := private.review_reasons(new);
  if cardinality(v_reasons) = 0 then
    return new;
  end if;
  insert into public.classification_reviews (org_id, mention_id, reasons, ai_output)
  values (new.org_id, new.mention_id, v_reasons, to_jsonb(new))
  on conflict (mention_id) where status = 'pending'
    do update set reasons = excluded.reasons, ai_output = excluded.ai_output, created_at = now();
  return new;
end;
$$;
create trigger classifications_queue_review after insert or update on public.classifications
  for each row execute function private.queue_classification_review();

-- ---------------------------------------------------------------------------
-- Incident policies: where an emergency goes before routing
-- ---------------------------------------------------------------------------
create table public.incident_policies (
  -- For the audit log (entity id).
  id uuid not null unique default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  incident_type text not null check (incident_type in (
    'public_service', 'infrastructure', 'public_safety', 'violence', 'health',
    'civil_protection', 'environment', 'corruption', 'other')),
  -- Institutional channel (e.g. "911", "Protección Civil municipal").
  channel text not null check (char_length(channel) between 2 and 120),
  instructions text not null check (char_length(instructions) between 10 and 2000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) default auth.uid(),
  primary key (org_id, incident_type)
);
alter table public.incident_policies enable row level security;
create policy "readers read incident policies" on public.incident_policies
  for select to authenticated using ((select private.can_read_all(org_id)));
create policy "admins write incident policies" on public.incident_policies
  for all to authenticated
  using ((select private.has_role(org_id, '{admin}')))
  with check ((select private.has_role(org_id, '{admin}')));
revoke all on public.incident_policies from anon;
create trigger audit_incident_policies after insert or update or delete on public.incident_policies
  for each row execute function private.audit_row();

-- Starting policies for every municipality (repeatable; an admin edits them).
create function private.seed_incident_policies(p_org_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.incident_policies (org_id, incident_type, channel, instructions, updated_by)
  values
    (p_org_id, 'public_safety', '911 · Seguridad Pública',
     'Si hay riesgo inmediato para personas, se reporta al 911 antes de turnar. El turno a la dependencia es seguimiento, no sustituye la llamada.', null),
    (p_org_id, 'violence', '911',
     'Violencia en curso o amenazas: reportar al 911. No se contacta a quien publica ni se difunde su identidad.', null),
    (p_org_id, 'civil_protection', 'Protección Civil municipal',
     'Inundaciones, fugas de gas, incendios, derrumbes: avisar a Protección Civil por su línea de guardia y después turnar para seguimiento.', null),
    (p_org_id, 'health', '911 · Servicios de salud',
     'Emergencias médicas: 911. Riesgos sanitarios (aguas negras en viviendas, brotes): Salud municipal o Jurisdicción Sanitaria.', null)
  on conflict (org_id, incident_type) do nothing;
$$;
select private.seed_incident_policies(id) from public.organizations;

-- New municipalities start with the same policies.
create function private.seed_org_incident_policies()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_incident_policies(new.id);
  return new;
end;
$$;
create trigger organizations_seed_incident_policies after insert on public.organizations
  for each row execute function private.seed_org_incident_policies();

-- ---------------------------------------------------------------------------
-- Decisions: correct, confirm or dismiss (admin, comunicacion)
-- ---------------------------------------------------------------------------
-- p_changes: any of sentiment, topic, intent, priority, department_id,
-- neighborhood_id, severity, incident_type, needs_attention. Returns the
-- {field: [before, after]} actually changed.
create function private.apply_classification_changes(p_mention_id uuid, p_changes jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.classifications;
  v_new public.classifications;
  v_diff jsonb := '{}';
  v_key text;
begin
  if exists (select 1 from jsonb_object_keys(coalesce(p_changes, '{}')) k
             where k not in ('sentiment', 'topic', 'intent', 'priority', 'department_id', 'neighborhood_id',
                             'severity', 'incident_type', 'needs_attention')) then
    raise exception 'Campo no editable.' using errcode = '22023';
  end if;
  select * into v_old from public.classifications where mention_id = p_mention_id for update;
  if v_old.id is null then
    raise exception 'Esta mención aún no tiene clasificación.' using errcode = '22023';
  end if;
  if p_changes ? 'department_id' and p_changes ->> 'department_id' is not null
     and not exists (select 1 from public.departments d where d.id = (p_changes ->> 'department_id')::uuid and d.org_id = v_old.org_id) then
    raise exception 'Dependencia no encontrada.' using errcode = '22023';
  end if;
  if p_changes ? 'neighborhood_id' and p_changes ->> 'neighborhood_id' is not null
     and not exists (select 1 from public.neighborhoods n where n.id = (p_changes ->> 'neighborhood_id')::uuid and n.org_id = v_old.org_id) then
    raise exception 'Colonia no encontrada.' using errcode = '22023';
  end if;

  perform set_config('app.correction_reason', coalesce(btrim(p_reason), ''), true);
  update public.classifications c set
    sentiment = case when p_changes ? 'sentiment' then (p_changes ->> 'sentiment')::public.sentiment else c.sentiment end,
    topic = case when p_changes ? 'topic' then p_changes ->> 'topic' else c.topic end,
    intent = case when p_changes ? 'intent' then p_changes ->> 'intent' else c.intent end,
    priority = case when p_changes ? 'priority' then (p_changes ->> 'priority')::public.priority else c.priority end,
    department_id = case when p_changes ? 'department_id' then (p_changes ->> 'department_id')::uuid else c.department_id end,
    neighborhood_id = case when p_changes ? 'neighborhood_id' then (p_changes ->> 'neighborhood_id')::uuid else c.neighborhood_id end,
    severity = case when p_changes ? 'severity' then (p_changes ->> 'severity')::public.severity else c.severity end,
    incident_type = case when p_changes ? 'incident_type' then p_changes ->> 'incident_type' else c.incident_type end,
    needs_attention = case when p_changes ? 'needs_attention' then (p_changes ->> 'needs_attention')::boolean else c.needs_attention end,
    corrected_by = (select auth.uid())
  where c.id = v_old.id
  returning * into v_new;
  perform set_config('app.correction_reason', '', true);

  foreach v_key in array array['sentiment', 'topic', 'intent', 'priority', 'department_id', 'neighborhood_id',
                               'severity', 'incident_type', 'needs_attention'] loop
    if to_jsonb(v_old) -> v_key is distinct from to_jsonb(v_new) -> v_key then
      v_diff := v_diff || jsonb_build_object(v_key, jsonb_build_array(to_jsonb(v_old) -> v_key, to_jsonb(v_new) -> v_key));
    end if;
  end loop;
  return v_diff;
end;
$$;

-- Correction from the inbox detail (outside the queue). Settles a pending review.
create function public.correct_classification(p_mention_id uuid, p_changes jsonb, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_diff jsonb;
begin
  select org_id into v_org from public.classifications where mention_id = p_mention_id;
  if v_org is null then
    raise exception 'Esta mención aún no tiene clasificación.' using errcode = '22023';
  end if;
  if not private.has_role(v_org, '{admin,comunicacion}') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_diff := private.apply_classification_changes(p_mention_id, p_changes, p_reason);
  if v_diff <> '{}' then
    update public.classification_reviews
    set status = 'corrected', decided_at = now(), decided_by = (select auth.uid()),
        decision_reason = coalesce(nullif(btrim(p_reason), ''), 'Corregida desde la bandeja'), changes = v_diff
    where mention_id = p_mention_id and status = 'pending';
  end if;
  return v_diff;
end;
$$;

-- A person confirms incident type and urgency as they are (no field changes).
create function public.confirm_classification(p_mention_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.classifications where mention_id = p_mention_id;
  if v_org is null then
    raise exception 'Esta mención aún no tiene clasificación.' using errcode = '22023';
  end if;
  if not private.has_role(v_org, '{admin,comunicacion}') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.classifications set confirmed_by = (select auth.uid()), confirmed_at = now()
  where mention_id = p_mention_id;
  update public.classification_reviews
  set status = 'confirmed', decided_at = now(), decided_by = (select auth.uid()), decision_reason = 'Confirmada desde la bandeja'
  where mention_id = p_mention_id and status = 'pending';
end;
$$;

-- p_decision: confirmed (the model was right, incident and urgency as they
-- are), corrected (p_changes applied), dismissed (no operational relevance:
-- the mention is discarded from the inbox; its classification is kept).
create function public.decide_review(p_review_id uuid, p_decision text, p_changes jsonb default '{}', p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review public.classification_reviews;
  v_diff jsonb := '{}';
begin
  select * into v_review from public.classification_reviews where id = p_review_id for update;
  if v_review.id is null or not private.has_role(v_review.org_id, '{admin,comunicacion}') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_review.status <> 'pending' then
    raise exception 'Esta revisión ya se decidió.' using errcode = '22023';
  end if;
  if p_decision not in ('confirmed', 'corrected', 'dismissed') then
    raise exception 'Decisión inválida.' using errcode = '22023';
  end if;
  if p_decision in ('corrected', 'dismissed') and char_length(coalesce(btrim(p_reason), '')) < 3 then
    raise exception 'Escribe el motivo de la decisión.' using errcode = '22023';
  end if;

  if p_decision = 'corrected' then
    v_diff := private.apply_classification_changes(v_review.mention_id, p_changes, p_reason);
    if v_diff = '{}' then
      raise exception 'No hay cambios: usa «Confirmar».' using errcode = '22023';
    end if;
  elsif p_decision = 'confirmed' then
    update public.classifications
    set confirmed_by = (select auth.uid()), confirmed_at = now()
    where mention_id = v_review.mention_id;
  else
    update public.mentions set triage = 'discarded'
    where id = v_review.mention_id and triage in ('new', 'reviewed');
  end if;

  update public.classification_reviews
  set status = p_decision, decided_at = now(), decided_by = (select auth.uid()),
      decision_reason = nullif(btrim(p_reason), ''), changes = v_diff
  where id = p_review_id;
  return jsonb_build_object('status', p_decision, 'changes', v_diff);
end;
$$;

-- ---------------------------------------------------------------------------
-- Durable invalidation of aggregates
-- ---------------------------------------------------------------------------
create table public.stats_invalidations (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  mention_id uuid,
  reason text not null,
  requested_at timestamptz not null default now(),
  processed_at timestamptz
);
create index stats_invalidations_pending_idx on public.stats_invalidations (org_id, requested_at) where processed_at is null;
alter table public.stats_invalidations enable row level security;
create policy "readers read stats invalidations" on public.stats_invalidations
  for select to authenticated using ((select private.can_read_all(org_id)));
revoke all on public.stats_invalidations from anon;
revoke insert, update, delete, truncate on public.stats_invalidations from authenticated;

-- A person's change to what the aggregates count queues a refresh.
create function private.invalidate_stats_on_correction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new; -- the classifier refreshes after its own runs
  end if;
  if (old.sentiment, old.topic, old.intent, old.department_id, old.neighborhood_id)
     is distinct from (new.sentiment, new.topic, new.intent, new.department_id, new.neighborhood_id) then
    insert into public.stats_invalidations (org_id, mention_id, reason) values (new.org_id, new.mention_id, 'correction');
  end if;
  return new;
end;
$$;
create trigger classifications_invalidate_stats after update on public.classifications
  for each row execute function private.invalidate_stats_on_correction();

alter table public.reports add column facts_stale_at timestamptz;

-- Rebuilds what corrections made stale: the hourly rollup, the "Lectura del
-- día" (regenerated on next view) and flags drafts whose period includes a
-- corrected mention. Server only (cron and correction actions).
create function public.process_stats_invalidations()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids bigint[];
  v_orgs uuid[];
  v_oldest timestamptz;
begin
  if not private.is_service_role() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- One processor at a time; a concurrent call returns at once.
  if not pg_try_advisory_xact_lock(hashtext('process_stats_invalidations')) then
    return jsonb_build_object('processed', 0, 'busy', true);
  end if;
  select array_agg(id), array_agg(distinct org_id), min(requested_at)
  into v_ids, v_orgs, v_oldest
  from public.stats_invalidations where processed_at is null;
  if v_ids is null then
    return jsonb_build_object('processed', 0);
  end if;

  perform public.refresh_mention_stats();
  delete from public.daily_readings where org_id = any (v_orgs);
  update public.reports r set facts_stale_at = now()
  where r.status = 'draft' and r.org_id = any (v_orgs)
    and exists (
      select 1 from public.stats_invalidations i join public.mentions m on m.id = i.mention_id
      where i.id = any (v_ids) and m.org_id = r.org_id
        and m.published_at >= (r.period_start::timestamp at time zone 'America/Mexico_City')
        and m.published_at < ((r.period_end + 1)::timestamp at time zone 'America/Mexico_City')
    );
  update public.stats_invalidations set processed_at = now() where id = any (v_ids);
  return jsonb_build_object('processed', cardinality(v_ids), 'orgs', cardinality(v_orgs),
                            'oldest_seconds', extract(epoch from now() - v_oldest)::integer);
end;
$$;

-- Freshness of corrections for Salud: oldest pending invalidation.
create function public.stats_invalidation_status(p_org_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when private.can_read_all(p_org_id) or private.is_service_role() then
    jsonb_build_object(
      'pending', count(*) filter (where processed_at is null),
      'oldest_pending_at', min(requested_at) filter (where processed_at is null),
      'last_processed_at', max(processed_at))
  end
  from public.stats_invalidations where org_id = p_org_id;
$$;

-- ---------------------------------------------------------------------------
-- Inbox queues: one function behind every view and its counter
-- ---------------------------------------------------------------------------
-- Security invoker: RLS decides which mentions, tickets and cases each role
-- sees, for the list and for the counters alike. Items are mentions that are
-- not part of a case, and cases (not merged). p_filters: the inbox URL
-- filters (q, from, to, source, sentiment, topic, department, neighborhood,
-- priority, author, mention).
create function public.inbox_items(p_org_id uuid, p_filters jsonb default '{}')
returns table (
  kind text, id uuid, urgency integer, due_at timestamptz, item_at timestamptz,
  is_new boolean, is_urgent boolean, is_unassigned boolean, awaiting_acceptance boolean,
  is_overdue boolean, awaiting_validation boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with f as (
    select
      nullif(p_filters ->> 'q', '') as q,
      (p_filters ->> 'from')::date as day_from,
      (p_filters ->> 'to')::date as day_to,
      (p_filters ->> 'source')::uuid as source_id,
      (p_filters ->> 'sentiment')::public.sentiment as sentiment,
      nullif(p_filters ->> 'topic', '') as topic,
      (p_filters ->> 'department')::uuid as department_id,
      (p_filters ->> 'neighborhood')::uuid as neighborhood_id,
      (p_filters ->> 'priority')::public.priority as priority,
      (p_filters ->> 'author')::uuid as author_id,
      (p_filters ->> 'mention')::uuid as mention_id
  ),
  mention_items as (
    select
      m.id, m.published_at, m.triage, m.status, c.priority, c.severity, c.needs_attention, c.intent,
      t.status as ticket_status, t.due_at as ticket_due, (t.id is not null) as routed
    from public.mentions m
    cross join f
    left join public.classifications c on c.mention_id = m.id
    left join lateral (
      select tk.status, tk.due_at, tk.id from public.tickets tk
      where tk.mention_id = m.id and tk.case_id is null
      order by tk.is_primary desc, tk.created_at limit 1
    ) t on true
    where m.org_id = p_org_id
      and m.triage <> 'discarded'
      and not exists (select 1 from public.case_mentions cm where cm.mention_id = m.id)
      and (f.q is null or m.search @@ websearch_to_tsquery('public.spanish_unaccent', f.q))
      and (f.day_from is null or m.published_at >= (f.day_from::timestamp at time zone 'America/Mexico_City'))
      and (f.day_to is null or m.published_at < ((f.day_to + 1)::timestamp at time zone 'America/Mexico_City'))
      and (f.source_id is null or m.source_id = f.source_id)
      and (f.author_id is null or m.author_id = f.author_id)
      and (f.mention_id is null or m.id = f.mention_id)
      and (f.sentiment is null or c.sentiment = f.sentiment)
      and (f.topic is null or c.topic = f.topic)
      and (f.department_id is null or c.department_id = f.department_id)
      and (f.neighborhood_id is null or c.neighborhood_id = f.neighborhood_id)
      and (f.priority is null or c.priority = f.priority)
  ),
  case_items as (
    select k.id, k.status, k.priority, k.department_id, k.due_at, k.opened_at
    from public.cases k
    cross join f
    left join public.mentions pm on pm.id = k.primary_mention_id
    left join public.classifications pc on pc.mention_id = k.primary_mention_id
    where k.org_id = p_org_id
      and k.status not in ('merged', 'discarded', 'closed')
      and (f.q is null or k.title ilike '%' || f.q || '%' or pm.search @@ websearch_to_tsquery('public.spanish_unaccent', f.q))
      and (f.day_from is null or k.opened_at >= (f.day_from::timestamp at time zone 'America/Mexico_City'))
      and (f.day_to is null or k.opened_at < ((f.day_to + 1)::timestamp at time zone 'America/Mexico_City'))
      and (f.source_id is null or pm.source_id = f.source_id)
      and (f.author_id is null or pm.author_id = f.author_id)
      and (f.mention_id is null or exists (select 1 from public.case_mentions cm where cm.case_id = k.id and cm.mention_id = f.mention_id))
      and (f.sentiment is null or pc.sentiment = f.sentiment)
      and (f.topic is null or pc.topic = f.topic)
      and (f.department_id is null or k.department_id = f.department_id)
      and (f.neighborhood_id is null or k.neighborhood_id = f.neighborhood_id)
      and (f.priority is null or k.priority = f.priority)
  )
  select
    'mention', mi.id,
    case mi.priority when 'critical' then 3 when 'high' then 2 when 'medium' then 1 else 0 end
      + case when mi.severity = 'emergency' then 2 when mi.severity = 'high' then 1 else 0 end,
    case when mi.ticket_status in ('open', 'in_progress') then mi.ticket_due end,
    mi.published_at,
    mi.triage = 'new',
    (mi.priority in ('critical', 'high') or mi.severity in ('high', 'emergency'))
      and (mi.triage in ('new', 'reviewed') or mi.ticket_status in ('open', 'in_progress')),
    not mi.routed and mi.triage in ('new', 'reviewed') and mi.status = 'classified'
      and coalesce(mi.needs_attention, mi.intent in ('queja', 'denuncia', 'pregunta')),
    mi.ticket_status = 'open',
    mi.ticket_status in ('open', 'in_progress') and mi.ticket_due < now(),
    mi.ticket_status = 'resolved'
  from mention_items mi
  union all
  select
    'case', ci.id,
    case ci.priority when 'critical' then 3 when 'high' then 2 when 'medium' then 1 else 0 end,
    case when ci.status in ('assigned', 'accepted', 'in_progress') then ci.due_at end,
    ci.opened_at,
    ci.status = 'new',
    ci.priority in ('critical', 'high') and ci.status <> 'resolved',
    ci.status in ('new', 'in_review', 'returned'),
    ci.status = 'assigned',
    ci.status in ('assigned', 'accepted', 'in_progress') and ci.due_at < now(),
    ci.status = 'resolved'
  from case_items ci;
$$;

-- One page of a view, by urgency, due date and age, with a stable tie-break.
-- p_cursor: the last row of the previous page {urgency, due_at, item_at, kind, id}.
create function public.inbox_queue(p_org_id uuid, p_view text, p_filters jsonb default '{}', p_cursor jsonb default null, p_limit integer default 50)
returns table (kind text, id uuid, urgency integer, due_at timestamptz, item_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select i.kind, i.id, i.urgency, i.due_at, i.item_at
  from public.inbox_items(p_org_id, p_filters) i
  where case p_view
      when 'new' then i.is_new
      when 'urgent' then i.is_urgent
      when 'unassigned' then i.is_unassigned
      when 'acceptance' then i.awaiting_acceptance
      when 'overdue' then i.is_overdue
      when 'validation' then i.awaiting_validation
      else false end
    and (p_cursor is null or
         (-i.urgency, coalesce(i.due_at, 'infinity'), i.item_at, i.kind, i.id)
         > (-(p_cursor ->> 'urgency')::integer, coalesce((p_cursor ->> 'due_at')::timestamptz, 'infinity'),
            (p_cursor ->> 'item_at')::timestamptz, p_cursor ->> 'kind', (p_cursor ->> 'id')::uuid))
  order by -i.urgency, coalesce(i.due_at, 'infinity'), i.item_at, i.kind, i.id
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

-- Counters of every view with the same filters (same rows as inbox_queue).
create function public.inbox_counts(p_org_id uuid, p_filters jsonb default '{}')
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'new', count(*) filter (where i.is_new),
    'urgent', count(*) filter (where i.is_urgent),
    'unassigned', count(*) filter (where i.is_unassigned),
    'acceptance', count(*) filter (where i.awaiting_acceptance),
    'overdue', count(*) filter (where i.is_overdue),
    'validation', count(*) filter (where i.awaiting_validation),
    'review', (select count(*) from public.classification_reviews r where r.org_id = p_org_id and r.status = 'pending'))
  from public.inbox_items(p_org_id, p_filters) i;
$$;

-- ---------------------------------------------------------------------------
-- Classifier writes: the new fields
-- ---------------------------------------------------------------------------
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
      priority public.priority, department_id uuid, neighborhood_id uuid, model text,
      severity public.severity, incident_type text, needs_attention boolean)
    where r.mention_id = any (v_owned)
  ),
  written as (
    insert into public.classifications as c (org_id, mention_id, sentiment, confidence, emotion, topic, intent, priority,
                                             department_id, neighborhood_id, model, severity, incident_type, needs_attention)
    select m.org_id, i.mention_id, i.sentiment, i.confidence, i.emotion, i.topic, i.intent, i.priority,
           i.department_id, i.neighborhood_id, i.model, i.severity, i.incident_type,
           coalesce(i.needs_attention, i.intent in ('queja', 'denuncia', 'pregunta'))
    from incoming i join public.mentions m on m.id = i.mention_id
    on conflict (mention_id) do update
      set sentiment = excluded.sentiment, confidence = excluded.confidence, emotion = excluded.emotion,
          topic = excluded.topic, intent = excluded.intent, priority = excluded.priority,
          department_id = excluded.department_id, neighborhood_id = excluded.neighborhood_id, model = excluded.model,
          severity = excluded.severity, incident_type = excluded.incident_type, needs_attention = excluded.needs_attention
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
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function private.append_only() from public, anon, authenticated;
revoke execute on function private.classification_changed(public.classifications, public.classifications) from public, anon, authenticated;
revoke execute on function private.version_classification() from public, anon, authenticated;
revoke execute on function private.review_reasons(public.classifications) from public, anon, authenticated;
revoke execute on function private.queue_classification_review() from public, anon, authenticated;
revoke execute on function private.seed_incident_policies(uuid) from public, anon, authenticated;
revoke execute on function private.seed_org_incident_policies() from public, anon, authenticated;
revoke execute on function private.apply_classification_changes(uuid, jsonb, text) from public, anon, authenticated;
revoke execute on function private.invalidate_stats_on_correction() from public, anon, authenticated;

revoke execute on function public.correct_classification(uuid, jsonb, text) from public, anon;
revoke execute on function public.decide_review(uuid, text, jsonb, text) from public, anon;
revoke execute on function public.confirm_classification(uuid) from public, anon;
grant execute on function public.confirm_classification(uuid) to authenticated;
revoke execute on function public.process_stats_invalidations() from public, anon, authenticated;
revoke execute on function public.stats_invalidation_status(uuid) from public, anon;
revoke execute on function public.inbox_items(uuid, jsonb) from public, anon;
revoke execute on function public.inbox_queue(uuid, text, jsonb, jsonb, integer) from public, anon;
revoke execute on function public.inbox_counts(uuid, jsonb) from public, anon;
grant execute on function public.correct_classification(uuid, jsonb, text) to authenticated;
grant execute on function public.decide_review(uuid, text, jsonb, text) to authenticated;
grant execute on function public.process_stats_invalidations() to service_role;
grant execute on function public.stats_invalidation_status(uuid) to authenticated, service_role;
grant execute on function public.inbox_items(uuid, jsonb) to authenticated;
grant execute on function public.inbox_queue(uuid, text, jsonb, jsonb, integer) to authenticated;
grant execute on function public.inbox_counts(uuid, jsonb) to authenticated;
