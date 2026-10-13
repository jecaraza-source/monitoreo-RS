-- Stage 11: configuration per municipality, auditable and with explicit owners.
--
--   * case_categories / department_capabilities: catalog of case categories and
--     which departments can attend each one (capabilities).
--   * Audit (before/after, actor, date) for the configuration tables that were
--     not audited yet: SLA calendar, holidays and targets, escalation, AI
--     limits and invoices, the new catalogs and the retention policy.
--   * SLA changes never move existing commitments: reapply_sla() is the only
--     way to recompute open cases with the current version, explicit,
--     previewable and audited.
--   * Retention per municipality (retention_policies) with conservation holds
--     (retention_holds); the purge never deletes mentions that belong to a case
--     or fall under an active hold, and every run is logged.
--   * log_export(): authorized exports leave a trace in audit_log.
--
-- Additive; the backfills are repeatable. Rollback:
-- docs/rollback/20261104000000_org_config.down.sql.

-- ===========================================================================
-- 1. Case categories and department capabilities
-- ===========================================================================
create table public.case_categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  description text not null default '' check (char_length(description) <= 300),
  -- Suggested responsible department when a case of this category is assigned.
  default_department_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, default_department_id) references public.departments (org_id, id) on delete set null (default_department_id)
);
create unique index case_categories_name_key on public.case_categories (org_id, lower(name));

-- Which departments can attend a category (used to suggest and to check assignments).
create table public.department_capabilities (
  org_id uuid not null references public.organizations (id) on delete cascade,
  department_id uuid not null,
  category_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (department_id, category_id),
  foreign key (org_id, department_id) references public.departments (org_id, id) on delete cascade,
  foreign key (org_id, category_id) references public.case_categories (org_id, id) on delete cascade
);

alter table public.case_categories enable row level security;
alter table public.department_capabilities enable row level security;
-- Every member reads the catalogs (departments pick categories in their cases).
create policy "members read case categories" on public.case_categories
  for select to authenticated using ((select private.is_member(org_id)));
create policy "admin writes case categories" on public.case_categories
  for all to authenticated
  using ((select private.has_role(org_id, '{admin}')))
  with check ((select private.has_role(org_id, '{admin}')));
create policy "members read capabilities" on public.department_capabilities
  for select to authenticated using ((select private.is_member(org_id)));
create policy "admin writes capabilities" on public.department_capabilities
  for all to authenticated
  using ((select private.has_role(org_id, '{admin}')))
  with check ((select private.has_role(org_id, '{admin}')));
revoke all on public.case_categories, public.department_capabilities from anon;

-- Backfill (repeatable): categories already used by SLA targets and cases.
insert into public.case_categories (org_id, name)
select distinct on (org_id, lower(btrim(category))) org_id, btrim(category)
from (
  select org_id, category from public.sla_targets where category is not null
  union all
  select org_id, category from public.cases where category is not null
) c
where char_length(btrim(category)) between 2 and 80
on conflict do nothing;

-- ===========================================================================
-- 2. Audit of the configuration that was not audited yet
-- ===========================================================================
create trigger audit_case_categories after insert or update or delete on public.case_categories
  for each row execute function private.audit_row();
create trigger audit_department_capabilities after insert or update or delete on public.department_capabilities
  for each row execute function private.audit_row();
-- SLA: the version snapshot was audited; now also each table it is built from.
create trigger audit_sla_calendars after insert or update or delete on public.sla_calendars
  for each row when (auth.uid() is not null) execute function private.audit_row();
create trigger audit_sla_holidays after insert or update or delete on public.sla_holidays
  for each row when (auth.uid() is not null) execute function private.audit_row();
create trigger audit_sla_targets after insert or update or delete on public.sla_targets
  for each row when (auth.uid() is not null) execute function private.audit_row();
create trigger audit_ai_limits after insert or update or delete on public.ai_limits
  for each row execute function private.audit_row();
create trigger audit_ai_invoices after insert or update or delete on public.ai_invoices
  for each row execute function private.audit_row();

-- ===========================================================================
-- 3. SLA: no retroactive change without an explicit, audited operation
-- ===========================================================================
/**
 * What reapplying the current SLA version would do to open cases with a
 * commitment: old and new deadlines from the same start (the assignment).
 * Cases whose deadline was set by hand are listed but not changed unless
 * p_include_overridden.
 */
create function public.sla_reapply_preview(p_org_id uuid, p_case_ids uuid[] default null, p_include_overridden boolean default false)
returns table (case_id uuid, folio text, status public.case_status, version_from integer, version_to integer,
               due_from timestamptz, due_to timestamptz, accept_from timestamptz, accept_to timestamptz, overridden boolean, applies boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_role(p_org_id, '{admin}') then
    raise exception 'Sólo un administrador puede reaplicar el SLA.' using errcode = '42501';
  end if;
  return query
  with open_cases as (
    select c.*, coalesce(c.assigned_at, c.opened_at) as start_at,
           coalesce((c.sla_terms ->> 'overridden')::boolean, false) as manual
    from public.cases c
    where c.org_id = p_org_id
      and private.case_is_open(c.status)
      and c.due_at is not null
      and (p_case_ids is null or c.id = any (p_case_ids))
  )
  select o.id, o.folio, o.status,
         (o.sla_terms ->> 'version')::integer,
         (t ->> 'version')::integer,
         o.due_at, (t ->> 'due_at')::timestamptz,
         o.accept_due_at, (t ->> 'accept_due_at')::timestamptz,
         o.manual,
         t is not null and (not o.manual or p_include_overridden)
           and (o.due_at is distinct from (t ->> 'due_at')::timestamptz or o.sla_version_id is distinct from (t ->> 'version_id')::uuid)
  from open_cases o
  cross join lateral (select public.sla_terms(p_org_id, o.category, o.priority, o.start_at) as t) s;
end;
$$;

/**
 * Applies the current SLA version to the open cases the administrator chose,
 * with a reason. Each change is logged in the case history and in audit_log
 * with before/after; closed cases and cases with manual deadlines (unless
 * included) are never touched. Returns how many changed.
 */
create function public.reapply_sla(p_org_id uuid, p_case_ids uuid[], p_reason text, p_include_overridden boolean default false)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_terms jsonb;
  v_n integer := 0;
begin
  if not private.has_role(p_org_id, '{admin}') then
    raise exception 'Sólo un administrador puede reaplicar el SLA.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Explica el motivo (al menos 10 caracteres): queda en el historial de cada caso.' using errcode = '22023';
  end if;
  if p_case_ids is null or cardinality(p_case_ids) = 0 then
    raise exception 'Elige los casos a los que se aplicará el SLA vigente.' using errcode = '22023';
  end if;
  for r in select * from public.sla_reapply_preview(p_org_id, p_case_ids, p_include_overridden) p where p.applies loop
    select public.sla_terms(p_org_id, c.category, c.priority, coalesce(c.assigned_at, c.opened_at)) into v_terms
    from public.cases c where c.id = r.case_id;
    update public.cases
    set due_at = r.due_to,
        accept_due_at = coalesce(r.accept_to, accept_due_at),
        sla_version_id = (v_terms ->> 'version_id')::uuid,
        sla_terms = v_terms || jsonb_build_object('computed_due_at', v_terms -> 'due_at', 'computed_accept_due_at', v_terms -> 'accept_due_at',
                                                  'overridden', false, 'reapplied_at', now())
    where id = r.case_id;
    perform private.log_case_event(p_org_id, r.case_id, 'sla_reapplied', null, null, btrim(p_reason),
      jsonb_build_object('due_at', jsonb_build_array(r.due_from, r.due_to),
                         'accept_due_at', jsonb_build_array(r.accept_from, r.accept_to),
                         'sla_version', jsonb_build_array(r.version_from, r.version_to)));
    insert into public.audit_log (org_id, actor_id, action, entity, entity_id, changes)
    values (p_org_id, (select auth.uid()), 'update', 'cases', r.case_id::text,
            jsonb_build_object('operation', 'reapply_sla', 'reason', btrim(p_reason),
                               'due_at', jsonb_build_array(r.due_from, r.due_to),
                               'sla_version', jsonb_build_array(r.version_from, r.version_to)));
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke execute on function public.sla_reapply_preview(uuid, uuid[], boolean) from public, anon;
revoke execute on function public.reapply_sla(uuid, uuid[], text, boolean) from public, anon;
grant execute on function public.sla_reapply_preview(uuid, uuid[], boolean) to authenticated;
grant execute on function public.reapply_sla(uuid, uuid[], text, boolean) to authenticated;

-- ===========================================================================
-- 4. Retention per municipality, with conservation holds
-- ===========================================================================
create table public.retention_policies (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  -- Months after publication a mention may be deleted. Null = never automatically.
  mention_months integer check (mention_months between 1 and 240),
  -- The municipal agreement that sets it (no legal term is assumed by the app).
  agreement_reference text check (char_length(agreement_reference) <= 200),
  agreement_date date,
  notes text not null default '' check (char_length(notes) <= 1000),
  -- Purges are paused (e.g. while an agreement is reviewed) without losing the policy.
  paused boolean not null default false,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  check (mention_months is null or (char_length(btrim(coalesce(agreement_reference, ''))) >= 3 and agreement_date is not null))
);

-- Obligations to keep data: a hold blocks the purge of what it covers.
create table public.retention_holds (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- Publication dates covered (inclusive); both null = everything of the org.
  covers_from date,
  covers_to date,
  reason text not null check (char_length(btrim(reason)) between 10 and 500),
  reference text check (char_length(reference) <= 200),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  released_by uuid,
  release_reason text check (char_length(release_reason) <= 500),
  check (covers_from is null or covers_to is null or covers_from <= covers_to),
  check ((released_at is null) = (released_by is null)),
  check (released_at is null or char_length(btrim(coalesce(release_reason, ''))) >= 5)
);
create index retention_holds_active_idx on public.retention_holds (org_id) where released_at is null;

alter table public.retention_policies enable row level security;
alter table public.retention_holds enable row level security;
create policy "readers read retention policy" on public.retention_policies
  for select to authenticated using ((select private.has_role(org_id, '{admin,comunicacion}')));
create policy "admin writes retention policy" on public.retention_policies
  for insert to authenticated
  with check ((select private.has_role(org_id, '{admin}')) and updated_by = (select auth.uid()));
create policy "admin updates retention policy" on public.retention_policies
  for update to authenticated
  using ((select private.has_role(org_id, '{admin}')))
  with check ((select private.has_role(org_id, '{admin}')) and updated_by = (select auth.uid()));
create policy "readers read retention holds" on public.retention_holds
  for select to authenticated using ((select private.has_role(org_id, '{admin,comunicacion}')));
create policy "admin creates retention holds" on public.retention_holds
  for insert to authenticated
  with check ((select private.has_role(org_id, '{admin}')) and created_by = (select auth.uid()) and released_at is null);
-- A hold is released (never deleted): who, when and why stay.
create policy "admin releases retention holds" on public.retention_holds
  for update to authenticated
  using ((select private.has_role(org_id, '{admin}')))
  with check ((select private.has_role(org_id, '{admin}')) and released_by = (select auth.uid()));
revoke all on public.retention_policies, public.retention_holds from anon;
revoke delete, truncate on public.retention_policies, public.retention_holds from authenticated;

create trigger audit_retention_policies after insert or update or delete on public.retention_policies
  for each row execute function private.audit_row();
create trigger audit_retention_holds after insert or update or delete on public.retention_holds
  for each row execute function private.audit_row();

-- Only these columns of a hold can change, and only to release it.
create function private.guard_retention_hold()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.released_at is not null then
    raise exception 'La conservación ya fue liberada.' using errcode = '42501';
  end if;
  if (new.org_id, new.covers_from, new.covers_to, new.reason, new.reference, new.created_by, new.created_at)
     is distinct from (old.org_id, old.covers_from, old.covers_to, old.reason, old.reference, old.created_by, old.created_at) then
    raise exception 'Una conservación no se edita: libérala y crea otra.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger retention_holds_guard before update on public.retention_holds
  for each row execute function private.guard_retention_hold();

/** True when an active hold of the org covers that publication date. */
create function private.retention_held(p_org_id uuid, p_published_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.retention_holds h
    where h.org_id = p_org_id and h.released_at is null
      and (h.covers_from is null or (p_published_at at time zone 'America/Mexico_City')::date >= h.covers_from)
      and (h.covers_to is null or (p_published_at at time zone 'America/Mexico_City')::date <= h.covers_to)
  );
$$;

/**
 * What a purge with p_months would do now in the org: mentions older than
 * the cutoff, how many are kept because they belong to a case or fall under
 * a hold, and how many would be deleted. Read-only; used by the review
 * procedure before approving or changing a policy.
 */
create function public.retention_preview(p_org_id uuid, p_months integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz := now() - make_interval(months => p_months);
  v_result jsonb;
begin
  if not (private.has_role(p_org_id, '{admin,comunicacion}') or private.is_service_role()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_months is null or p_months < 1 then
    raise exception 'El plazo debe ser de al menos 1 mes.' using errcode = '22023';
  end if;
  select jsonb_build_object(
    'cutoff', v_cutoff,
    'older', count(*),
    'kept_in_case', count(*) filter (where in_case),
    'kept_by_hold', count(*) filter (where not in_case and held),
    'deletable', count(*) filter (where not in_case and not held))
  into v_result
  from (
    select exists (select 1 from public.case_mentions cm where cm.mention_id = m.id) as in_case,
           private.retention_held(m.org_id, m.published_at) as held
    from public.mentions m
    where m.org_id = p_org_id and m.published_at < v_cutoff
  ) x;
  return v_result;
end;
$$;

/**
 * Deletes, for one org, mentions older than p_months that are not in a case
 * and not under an active hold (classifications, tickets and notes go with
 * them). Logged in audit_log with the policy that allowed it. Service role.
 */
create function public.purge_org_mentions(p_org_id uuid, p_months integer, p_batch integer default 5000, p_basis text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz := now() - make_interval(months => p_months);
  v_deleted integer;
begin
  if p_months is null or p_months < 1 then
    raise exception 'retention must be at least 1 month' using errcode = '22023';
  end if;
  with doomed as (
    select m.id from public.mentions m
    where m.org_id = p_org_id and m.published_at < v_cutoff
      and not exists (select 1 from public.case_mentions cm where cm.mention_id = m.id)
      and not private.retention_held(m.org_id, m.published_at)
    order by m.published_at
    limit p_batch
  ), gone as (
    delete from public.mentions m using doomed d where m.id = d.id returning 1
  )
  select count(*) into v_deleted from gone;
  if v_deleted > 0 then
    insert into public.audit_log (org_id, actor_id, action, entity, entity_id, changes)
    values (p_org_id, null, 'purge', 'mentions', null,
            jsonb_build_object('before', v_cutoff, 'months', p_months, 'deleted', v_deleted, 'basis', coalesce(p_basis, 'policy'),
                               'kept', 'mentions in cases and under conservation holds'));
    delete from public.authors a
    where a.org_id = p_org_id and a.kind = 'citizen' and not exists (select 1 from public.mentions m where m.author_id = a.id);
  end if;
  return v_deleted;
end;
$$;

revoke execute on function private.retention_held(uuid, timestamptz) from public, anon;
revoke execute on function public.retention_preview(uuid, integer) from public, anon;
grant execute on function public.retention_preview(uuid, integer) to authenticated, service_role;
revoke execute on function public.purge_org_mentions(uuid, integer, integer, text) from public, anon, authenticated;
grant execute on function public.purge_org_mentions(uuid, integer, integer, text) to service_role;

-- The global purge no longer deletes what a case or a hold keeps.
create or replace function public.purge_old_mentions(p_months integer, p_batch integer default 5000)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_total integer := 0;
begin
  if p_months < 1 then
    raise exception 'retention must be at least 1 month' using errcode = '22023';
  end if;
  for v_org in select id from public.organizations loop
    v_total := v_total + public.purge_org_mentions(v_org, p_months, p_batch, 'deployment default');
  end loop;
  return v_total;
end;
$$;

-- ===========================================================================
-- 5. Authorized exports leave a trace
-- ===========================================================================
/** Records an export done by the server for the person in session. */
create function public.log_export(p_org_id uuid, p_kind text, p_filters jsonb, p_rows integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role(p_org_id, '{admin,comunicacion}') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, changes)
  values (p_org_id, (select auth.uid()), 'export', p_kind, null,
          jsonb_build_object('filters', coalesce(p_filters, '{}'::jsonb), 'rows', p_rows));
end;
$$;
revoke execute on function public.log_export(uuid, text, jsonb, integer) from public, anon;
grant execute on function public.log_export(uuid, text, jsonb, integer) to authenticated;

-- ===========================================================================
-- 6. Start of operation: manual checks (per-role tests, exercise), audited
-- ===========================================================================
create table public.onboarding_checks (
  org_id uuid not null references public.organizations (id) on delete cascade,
  key text not null check (key in ('prueba_admin', 'prueba_comunicacion', 'prueba_enlace', 'prueba_lectura',
                                   'destinatarios_prueba', 'ejercicio_operativo', 'procedimientos_revisados')),
  done_by uuid not null,
  done_at timestamptz not null default now(),
  note text not null check (char_length(btrim(note)) between 5 and 500),
  primary key (org_id, key)
);
alter table public.onboarding_checks enable row level security;
create policy "readers read onboarding checks" on public.onboarding_checks
  for select to authenticated using ((select private.has_role(org_id, '{admin,comunicacion}')));
create policy "admin records onboarding checks" on public.onboarding_checks
  for insert to authenticated
  with check ((select private.has_role(org_id, '{admin}')) and done_by = (select auth.uid()));
create policy "admin updates onboarding checks" on public.onboarding_checks
  for update to authenticated
  using ((select private.has_role(org_id, '{admin}')))
  with check ((select private.has_role(org_id, '{admin}')) and done_by = (select auth.uid()));
create policy "admin removes onboarding checks" on public.onboarding_checks
  for delete to authenticated using ((select private.has_role(org_id, '{admin}')));
revoke all on public.onboarding_checks from anon;
create trigger audit_onboarding_checks after insert or update or delete on public.onboarding_checks
  for each row execute function private.audit_row();
