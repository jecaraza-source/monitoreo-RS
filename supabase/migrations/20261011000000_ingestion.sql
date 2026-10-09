-- Ingestion: per-source run state, encrypted credentials (Vault) and a run log.

-- ---------------------------------------------------------------------------
-- Source state
-- ---------------------------------------------------------------------------
alter table public.sources
  -- `since` for the next run; last_run_at (existing) is the last attempt.
  add column last_success_at timestamptz,
  add column last_error text,
  add column last_error_at timestamptz,
  add column consecutive_failures integer not null default 0,
  -- Connector-specific progress (e.g. recent YouTube videos to poll for comments).
  add column cursor jsonb not null default '{}'::jsonb,
  -- Whether a credential is stored in Vault; the credential itself never leaves the server.
  add column has_secret boolean not null default false;

-- Editors manage what a source is; run state and has_secret are written only by
-- the worker (service role) and the SECURITY DEFINER functions below.
revoke insert, update on public.sources from authenticated;
grant insert (org_id, name, type, config, is_active) on public.sources to authenticated;
grant update (name, config, is_active) on public.sources to authenticated;

-- ---------------------------------------------------------------------------
-- Credentials in Supabase Vault
-- ---------------------------------------------------------------------------
create table private.source_secrets (
  source_id uuid primary key references public.sources (id) on delete cascade,
  secret_id uuid not null
);
revoke all on private.source_secrets from public, anon, authenticated;

-- Stores or replaces a source credential (e.g. a Meta page token). Editors only.
create function public.set_source_secret(p_source_id uuid, p_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_secret_id uuid;
begin
  select org_id into v_org from public.sources where id = p_source_id;
  if v_org is null or not private.has_role(v_org, '{admin,comunicacion}') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if coalesce(length(trim(p_secret)), 0) = 0 then
    raise exception 'empty secret' using errcode = '22023';
  end if;

  select secret_id into v_secret_id from private.source_secrets where source_id = p_source_id;
  if v_secret_id is null then
    v_secret_id := vault.create_secret(trim(p_secret), 'source:' || p_source_id, 'Credential for a monitoring source');
    insert into private.source_secrets (source_id, secret_id) values (p_source_id, v_secret_id);
  else
    perform vault.update_secret(v_secret_id, trim(p_secret));
  end if;
  update public.sources set has_secret = true where id = p_source_id;
end;
$$;

create function public.clear_source_secret(p_source_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_secret_id uuid;
begin
  select org_id into v_org from public.sources where id = p_source_id;
  if v_org is null or not private.has_role(v_org, '{admin,comunicacion}') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from private.source_secrets where source_id = p_source_id returning secret_id into v_secret_id;
  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
  end if;
  update public.sources set has_secret = false where id = p_source_id;
end;
$$;

-- Plain-text credential for the ingestion worker. Service role only.
create function public.get_source_secret(p_source_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select ds.decrypted_secret
  from private.source_secrets ss
  join vault.decrypted_secrets ds on ds.id = ss.secret_id
  where ss.source_id = p_source_id;
$$;

revoke execute on function public.set_source_secret(uuid, text) from public, anon;
revoke execute on function public.clear_source_secret(uuid) from public, anon;
grant execute on function public.set_source_secret(uuid, text) to authenticated;
grant execute on function public.clear_source_secret(uuid) to authenticated;
revoke execute on function public.get_source_secret(uuid) from public, anon, authenticated;
grant execute on function public.get_source_secret(uuid) to service_role;

-- Deleting a source also removes its Vault secret.
create function private.drop_source_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where id = old.secret_id;
  return old;
end;
$$;
create trigger source_secrets_drop_vault after delete on private.source_secrets
  for each row execute function private.drop_source_secret();

-- ---------------------------------------------------------------------------
-- Run log
-- ---------------------------------------------------------------------------
create table public.ingest_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  source_id uuid not null references public.sources (id) on delete cascade,
  trigger text not null check (trigger in ('cron', 'manual')),
  status text not null check (status in ('ok', 'error')),
  started_at timestamptz not null,
  finished_at timestamptz not null default now(),
  fetched integer not null default 0,
  inserted integer not null default 0,
  duplicates integer not null default 0,
  -- Fetched items that matched no active query and were not kept.
  unmatched integer not null default 0,
  error text,
  created_at timestamptz not null default now()
);

create index ingest_runs_source_started_idx on public.ingest_runs (source_id, started_at desc);
create index ingest_runs_org_started_idx on public.ingest_runs (org_id, started_at desc);

alter table public.ingest_runs enable row level security;
-- Written only by the worker (service role); readable like the sources themselves.
create policy "readers read ingest runs" on public.ingest_runs
  for select to authenticated using ((select private.can_read_all(org_id)));
revoke all on public.ingest_runs from anon;
revoke insert, update, delete on public.ingest_runs from authenticated;
