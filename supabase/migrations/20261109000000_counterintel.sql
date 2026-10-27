-- Oficina de Contrainteligencia: a restricted space for a few authorized
-- officials to follow disinformation campaigns about the municipality,
-- accounts impersonating the city hall or its officials, coordinated
-- inauthentic behavior (bots) and threats to officials or facilities.
--
-- Limits (CLAUDE.md): it never profiles citizens, journalists or opponents.
-- It works on content, accounts that present themselves as official, domains
-- and narratives. Citizens stay anonymous in every list; only media and public
-- figures are named. Every consultation is logged.
--
-- Repeatable (if not exists / or replace). Rollback: docs/rollback/20261109000000_counterintel.down.sql

-- ---------------------------------------------------------------------------
-- Access: an explicit grant per member. Not automatic for admins: the office
-- is limited to the officials an admin authorizes (an admin may authorize
-- themselves; the change is audited like any membership change).
-- ---------------------------------------------------------------------------

alter table public.memberships add column if not exists can_view_counterintel boolean not null default false;

create or replace function private.can_view_counterintel(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.org_id = p_org_id
      and m.user_id = (select auth.uid())
      and m.can_view_counterintel
      and m.role in ('admin', 'comunicacion', 'lectura')
  );
$$;

-- Registering and updating reports: authorized admin or comunicacion (lectura only reads).
create or replace function private.can_edit_counterintel(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.org_id = p_org_id
      and m.user_id = (select auth.uid())
      and m.can_view_counterintel
      and m.role in ('admin', 'comunicacion')
  );
$$;
revoke execute on function private.can_view_counterintel(uuid) from public, anon;
revoke execute on function private.can_edit_counterintel(uuid) from public, anon;
grant execute on function private.can_view_counterintel(uuid) to authenticated;
grant execute on function private.can_edit_counterintel(uuid) to authenticated;

-- Whether the current user may open the office (for the menu).
create or replace function public.can_view_counterintel(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_view_counterintel(p_org_id);
$$;
revoke execute on function public.can_view_counterintel(uuid) from public, anon;
grant execute on function public.can_view_counterintel(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Register of reports (what the office follows). No deletes: a report is
-- closed with a note, and every change lands in the audit log.
-- ---------------------------------------------------------------------------

create table if not exists public.ci_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('disinformation', 'impersonation', 'bot_network', 'threat')),
  title text not null check (char_length(btrim(title)) between 3 and 160),
  summary text not null default '' check (char_length(summary) <= 4000),
  severity public.priority not null default 'medium',
  status text not null default 'open' check (status in ('open', 'monitoring', 'closed')),
  -- Accounts that present themselves as official, URLs, domains, hashtags: never a citizen.
  indicators text[] not null default '{}' check (cardinality(indicators) <= 30),
  -- Mentions of the monitor that evidence the report (same org, checked below).
  mention_ids uuid[] not null default '{}' check (cardinality(mention_ids) <= 50),
  closed_note text check (closed_note is null or char_length(closed_note) <= 2000),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists ci_reports_org_status_idx on public.ci_reports (org_id, status, updated_at desc);

create or replace function private.ci_reports_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from unnest(new.indicators) i where char_length(btrim(i)) not between 1 and 300) then
    raise exception 'Cada indicador debe tener entre 1 y 300 caracteres.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(new.mention_ids) x
             where not exists (select 1 from public.mentions m where m.id = x and m.org_id = new.org_id)) then
    raise exception 'Alguna mención no existe en este municipio.' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' then
    if new.org_id <> old.org_id or new.created_by <> old.created_by or new.created_at <> old.created_at then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    new.updated_at := now();
  end if;
  new.closed_at := case when new.status = 'closed' then coalesce(new.closed_at, now()) end;
  if new.status <> 'closed' then
    new.closed_note := null;
  end if;
  return new;
end;
$$;
revoke execute on function private.ci_reports_guard() from public, anon, authenticated;

drop trigger if exists ci_reports_guard on public.ci_reports;
create trigger ci_reports_guard before insert or update on public.ci_reports
  for each row execute function private.ci_reports_guard();
drop trigger if exists audit_ci_reports on public.ci_reports;
create trigger audit_ci_reports after insert or update or delete on public.ci_reports
  for each row execute function private.audit_row();

alter table public.ci_reports enable row level security;
drop policy if exists "office reads reports" on public.ci_reports;
create policy "office reads reports" on public.ci_reports
  for select to authenticated using (org_id in (select m.org_id from public.memberships m
                                                where m.user_id = (select auth.uid()) and m.can_view_counterintel
                                                  and m.role in ('admin', 'comunicacion', 'lectura')));
drop policy if exists "office adds reports" on public.ci_reports;
create policy "office adds reports" on public.ci_reports
  for insert to authenticated
  with check ((select private.can_edit_counterintel(org_id)) and created_by = (select auth.uid()));
drop policy if exists "office edits reports" on public.ci_reports;
create policy "office edits reports" on public.ci_reports
  for update to authenticated
  using ((select private.can_edit_counterintel(org_id)))
  with check ((select private.can_edit_counterintel(org_id)));
revoke all on public.ci_reports from anon;

-- ---------------------------------------------------------------------------
-- Leads for the office, computed from what the monitor already collects.
-- ---------------------------------------------------------------------------

-- Unverified accounts are stored pseudonymized (20261103000000_ai_governance),
-- so impersonation is followed by content: mentions whose text carries an
-- indicator (URL, domain, hashtag, page name) of a report the office keeps
-- open or in follow-up. Threats: high or emergency severity about violence or
-- public safety. Citizens are never named in either list.
create or replace function public.ci_overview(p_org_id uuid, p_from timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_threats jsonb;
  v_matches jsonb;
begin
  if not private.can_view_counterintel(p_org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, changes)
  values (p_org_id, (select auth.uid()), 'view', 'counterintel', null, jsonb_build_object('from', p_from));

  select coalesce(jsonb_agg(t order by t.rank desc, t.published_at desc), '[]') into v_threats
  from (
    select m.id, m.published_at, left(m.text, 600) as text, s.name as source,
           c.severity, c.incident_type,
           case when c.severity = 'emergency' then 2 else 1 end as rank,
           case when a.kind in ('media', 'public_figure') then coalesce(a.display_name, a.handle) end as author,
           case when a.kind in ('media', 'public_figure') then m.url end as url
    from public.mentions m
    join public.classifications c on c.mention_id = m.id
    left join public.sources s on s.id = m.source_id
    left join public.authors a on a.id = m.author_id
    where m.org_id = p_org_id and m.published_at >= p_from
      and c.severity in ('high', 'emergency')
      and c.incident_type in ('violence', 'public_safety')
    order by rank desc, m.published_at desc
    limit 50
  ) t;

  with indicators as (
    select distinct r.id as report_id, r.title, btrim(i) as indicator
    from public.ci_reports r
    cross join unnest(r.indicators) as i
    where r.org_id = p_org_id and r.status in ('open', 'monitoring')
      and char_length(btrim(i)) >= 4
  ),
  hits as (
    select distinct on (m.id) m.id, m.published_at, left(m.text, 600) as text, s.name as source,
           i.report_id, i.title as report_title, i.indicator,
           case when a.kind in ('media', 'public_figure') then coalesce(a.display_name, a.handle) end as author,
           case when a.kind in ('media', 'public_figure') then m.url end as url
    from public.mentions m
    join indicators i on strpos(lower(m.text), lower(i.indicator)) > 0
    left join public.sources s on s.id = m.source_id
    left join public.authors a on a.id = m.author_id
    where m.org_id = p_org_id and m.published_at >= p_from
    order by m.id, m.published_at desc
  )
  select coalesce(jsonb_agg(h order by h.published_at desc), '[]') into v_matches
  from (select * from hits order by published_at desc limit 50) h;

  return jsonb_build_object('threats', v_threats, 'matches', v_matches);
end;
$$;
revoke execute on function public.ci_overview(uuid, timestamptz) from public, anon;
grant execute on function public.ci_overview(uuid, timestamptz) to authenticated;
