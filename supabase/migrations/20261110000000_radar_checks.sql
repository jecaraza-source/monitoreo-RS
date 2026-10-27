-- Radar Social, verification tools: official domains and watch terms per
-- municipality, and a log of every check made against public verification
-- services (domain/URL reputation, certificate transparency, published fact
-- checks, news). Checks look at indicators (domains, URLs, claims), never at
-- people. Same access as the register: reading needs the Radar Social grant,
-- writing needs it plus admin or comunicación.
-- Repeatable (if not exists / or replace). Rollback: docs/rollback/20261110000000_radar_checks.down.sql

create table if not exists public.ci_settings (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  -- The municipality's own domains (e.g. alvarado.gob.mx); lookalikes exclude them and their subdomains.
  official_domains text[] not null default '{}' check (cardinality(official_domains) <= 20),
  -- Words a fake domain would use (e.g. alvarado); at least 4 characters each.
  watch_terms text[] not null default '{}' check (cardinality(watch_terms) <= 20),
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

create or replace function private.ci_settings_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.official_domains := array(select distinct lower(btrim(d)) from unnest(new.official_domains) d where btrim(d) <> '');
  new.watch_terms := array(select distinct lower(btrim(t)) from unnest(new.watch_terms) t where btrim(t) <> '');
  if exists (select 1 from unnest(new.official_domains) d where d !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$') then
    raise exception 'Algún dominio oficial no es válido (ejemplo: alvarado.gob.mx).' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(new.watch_terms) t where char_length(t) not between 4 and 40 or t !~ '^[a-z0-9-]+$') then
    raise exception 'Cada término debe tener de 4 a 40 letras, números o guiones, sin espacios.' using errcode = '22023';
  end if;
  new.updated_at := now();
  new.updated_by := coalesce((select auth.uid()), new.updated_by);
  return new;
end;
$$;
revoke execute on function private.ci_settings_guard() from public, anon, authenticated;

drop trigger if exists ci_settings_guard on public.ci_settings;
create trigger ci_settings_guard before insert or update on public.ci_settings
  for each row execute function private.ci_settings_guard();
drop trigger if exists audit_ci_settings on public.ci_settings;
create trigger audit_ci_settings after insert or update or delete on public.ci_settings
  for each row execute function private.audit_row();

alter table public.ci_settings enable row level security;
drop policy if exists "radar reads settings" on public.ci_settings;
create policy "radar reads settings" on public.ci_settings
  for select to authenticated using ((select private.can_view_counterintel(org_id)));
drop policy if exists "radar adds settings" on public.ci_settings;
create policy "radar adds settings" on public.ci_settings
  for insert to authenticated with check ((select private.can_edit_counterintel(org_id)));
drop policy if exists "radar edits settings" on public.ci_settings;
create policy "radar edits settings" on public.ci_settings
  for update to authenticated
  using ((select private.can_edit_counterintel(org_id)))
  with check ((select private.can_edit_counterintel(org_id)));
revoke all on public.ci_settings from anon;

-- One row per check. Append-only: no updates or deletes.
create table if not exists public.ci_checks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  report_id uuid references public.ci_reports (id) on delete set null,
  provider text not null check (provider in ('urlhaus', 'phishstats', 'safe_browsing', 'crtsh', 'factcheck', 'gdelt')),
  subject text not null check (char_length(subject) between 1 and 300),
  -- flagged: the service lists it; clear: it does not; found: a search returned results;
  -- skipped: the service is not configured; error: the service failed.
  status text not null check (status in ('flagged', 'clear', 'found', 'skipped', 'error')),
  summary text not null default '' check (char_length(summary) <= 500),
  details jsonb not null default '{}',
  checked_by uuid not null default auth.uid() references auth.users (id),
  checked_at timestamptz not null default now()
);
create index if not exists ci_checks_org_idx on public.ci_checks (org_id, provider, checked_at desc);
create index if not exists ci_checks_report_idx on public.ci_checks (report_id, checked_at desc) where report_id is not null;

create or replace function private.ci_checks_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.report_id is not null
     and not exists (select 1 from public.ci_reports r where r.id = new.report_id and r.org_id = new.org_id) then
    raise exception 'El reporte no es de este municipio.' using errcode = '22023';
  end if;
  if octet_length(new.details::text) > 200000 then
    raise exception 'El resultado es demasiado grande.' using errcode = '22023';
  end if;
  new.checked_at := now();
  return new;
end;
$$;
revoke execute on function private.ci_checks_guard() from public, anon, authenticated;

drop trigger if exists ci_checks_guard on public.ci_checks;
create trigger ci_checks_guard before insert on public.ci_checks
  for each row execute function private.ci_checks_guard();

alter table public.ci_checks enable row level security;
drop policy if exists "radar reads checks" on public.ci_checks;
create policy "radar reads checks" on public.ci_checks
  for select to authenticated using ((select private.can_view_counterintel(org_id)));
drop policy if exists "radar adds checks" on public.ci_checks;
create policy "radar adds checks" on public.ci_checks
  for insert to authenticated
  with check ((select private.can_edit_counterintel(org_id)) and checked_by = (select auth.uid()));
revoke all on public.ci_checks from anon;
