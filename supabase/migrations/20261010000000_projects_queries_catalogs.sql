-- Project sheet (territory), versioned queries and the risk-terms catalog.

-- ---------------------------------------------------------------------------
-- Projects: territory
-- ---------------------------------------------------------------------------
-- {"scope":"municipality"} or {"scope":"neighborhoods","neighborhood_ids":[...]}
-- plus optional "notes". Validated by the app (zod) before writing.
alter table public.projects
  add column territory jsonb not null default '{"scope":"municipality"}'::jsonb,
  add column updated_at timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- Queries: every change is a new version
-- ---------------------------------------------------------------------------
-- All versions of one query share lineage_id; exactly one is active. Mentions
-- keep pointing at the exact version that captured them.
alter table public.queries
  add column lineage_id uuid not null default gen_random_uuid(),
  -- Visual builder state the expression was generated from (null = typed by hand).
  add column builder jsonb,
  add column created_by uuid references auth.users (id) default auth.uid();

alter table public.queries add constraint queries_lineage_version_key unique (lineage_id, version);
create unique index queries_one_active_per_lineage on public.queries (lineage_id) where is_active;
create index queries_project_lineage_idx on public.queries (project_id, lineage_id, version desc);

-- Saves a new version (or the first one when p_lineage_id is null) and makes it
-- the active one. SECURITY INVOKER: RLS decides who may write queries.
create function public.save_query_version(
  p_project_id uuid,
  p_name text,
  p_expression text,
  p_builder jsonb default null,
  p_lineage_id uuid default null
)
returns public.queries
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_lineage uuid := coalesce(p_lineage_id, gen_random_uuid());
  v_version integer := 1;
  v_row public.queries;
begin
  select org_id into v_org_id from public.projects where id = p_project_id;
  if v_org_id is null then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  if p_lineage_id is not null then
    -- Serialize concurrent saves of the same query.
    perform pg_advisory_xact_lock(hashtextextended(p_lineage_id::text, 0));
    select max(version) + 1 into v_version
    from public.queries
    where lineage_id = p_lineage_id and project_id = p_project_id;
    if v_version is null then
      raise exception 'query not found' using errcode = 'P0002';
    end if;
    update public.queries set is_active = false
    where lineage_id = p_lineage_id and is_active;
  end if;

  insert into public.queries (org_id, project_id, lineage_id, version, name, expression, builder, is_active)
  values (v_org_id, p_project_id, v_lineage, v_version, p_name, p_expression, p_builder, true)
  returning * into v_row;
  return v_row;
end;
$$;

revoke execute on function public.save_query_version(uuid, text, text, jsonb, uuid) from public, anon;
grant execute on function public.save_query_version(uuid, text, text, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Risk terms: words that raise a mention's priority (topics, never people)
-- ---------------------------------------------------------------------------
create table public.risk_terms (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  term text not null,
  -- Lowercase, accent-free form computed by the app; keeps the catalog free of
  -- "Balacera" / "balacera" duplicates.
  normalized text not null,
  severity public.priority not null default 'high',
  created_at timestamptz not null default now(),
  unique (org_id, normalized)
);

alter table public.risk_terms enable row level security;

create policy "readers read risk terms" on public.risk_terms
  for select to authenticated using ((select private.can_read_all(org_id)));
create policy "admins manage risk terms" on public.risk_terms
  for all to authenticated
  using ((select private.has_role(org_id, '{admin}')))
  with check ((select private.has_role(org_id, '{admin}')));

revoke all on public.risk_terms from anon;
