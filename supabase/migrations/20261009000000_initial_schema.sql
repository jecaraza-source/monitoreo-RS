-- Initial schema for Monitoreo Municipal.
--
-- Tenancy: every business table carries org_id and is protected by RLS.
-- Roles (memberships.role):
--   admin        full read/write inside the org
--   comunicacion full read; writes operational data (projects, queries, sources,
--                classifications, tickets, alerts, reports)
--   dependencia  reads only what was routed (ticket) to its department; updates
--                its own tickets
--   lectura      full read, no writes
-- Ingestion and AI classification run with the service role (bypasses RLS).

-- ---------------------------------------------------------------------------
-- Extensions and full-text search
-- ---------------------------------------------------------------------------

create extension if not exists unaccent with schema extensions;

-- Spanish stemming that ignores accents: "atención" and "atencion" match.
create text search configuration public.spanish_unaccent (copy = pg_catalog.spanish);
alter text search configuration public.spanish_unaccent
  alter mapping for hword, hword_part, word
  with extensions.unaccent, pg_catalog.spanish_stem;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.membership_role as enum ('admin', 'comunicacion', 'dependencia', 'lectura');
create type public.source_type as enum ('meta', 'rss', 'youtube', 'x');
create type public.author_kind as enum ('media', 'public_figure', 'citizen');
create type public.mention_status as enum ('pending', 'classified', 'failed');
create type public.sentiment as enum ('positive', 'neutral', 'negative');
create type public.priority as enum ('low', 'medium', 'high', 'critical');
create type public.ticket_status as enum ('open', 'in_progress', 'resolved', 'closed');
create type public.report_period as enum ('daily', 'weekly', 'monthly');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- The organization row is the tenant itself, so its id is the org_id that
-- every other table references.
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  state text,
  created_at timestamptz not null default now()
);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  short_name text,
  created_at timestamptz not null default now(),
  unique (org_id, name),
  unique (org_id, id)
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.membership_role not null,
  department_id uuid,
  created_at timestamptz not null default now(),
  unique (org_id, user_id),
  foreign key (org_id, department_id) references public.departments (org_id, id),
  constraint dependencia_requires_department
    check (role <> 'dependencia' or department_id is not null)
);

create table public.neighborhoods (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  -- GeoJSON Feature or Polygon geometry (WGS84) for MapLibre.
  geojson jsonb,
  created_at timestamptz not null default now(),
  unique (org_id, name),
  unique (org_id, id)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  goal text,
  kpis jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (org_id, id)
);

create table public.queries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid not null,
  name text not null,
  expression text not null,
  filters jsonb not null default '{}'::jsonb,
  version integer not null default 1 check (version > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, project_id) references public.projects (org_id, id) on delete cascade
);

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  type public.source_type not null,
  -- Non-secret settings only (feed URL, page id, channel id). Tokens live in env.
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, id)
);

-- Author analysis is limited to media and public figures (see CLAUDE.md);
-- citizen rows exist only to attribute a mention, never to build a profile.
create table public.authors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  platform public.source_type not null,
  handle text not null,
  display_name text,
  followers integer check (followers >= 0),
  kind public.author_kind not null default 'citizen',
  created_at timestamptz not null default now(),
  unique (org_id, platform, handle),
  unique (org_id, id)
);

create table public.mentions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  source_id uuid not null,
  external_id text not null,
  url text,
  text text not null,
  published_at timestamptz not null,
  author_id uuid,
  metrics jsonb not null default '{}'::jsonb,
  query_id uuid,
  status public.mention_status not null default 'pending',
  search tsvector generated always as (
    to_tsvector('public.spanish_unaccent'::regconfig, coalesce(text, ''))
  ) stored,
  created_at timestamptz not null default now(),
  unique (source_id, external_id),
  unique (org_id, id),
  foreign key (org_id, source_id) references public.sources (org_id, id) on delete cascade,
  foreign key (org_id, author_id) references public.authors (org_id, id),
  foreign key (org_id, query_id) references public.queries (org_id, id)
);

create table public.classifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  mention_id uuid not null unique,
  sentiment public.sentiment not null,
  confidence numeric(4, 3) check (confidence between 0 and 1),
  emotion text,
  topic text,
  intent text,
  priority public.priority not null default 'low',
  department_id uuid,
  neighborhood_id uuid,
  -- Set when a person overrides the model's output.
  corrected_by uuid references auth.users (id),
  model text not null,
  created_at timestamptz not null default now(),
  foreign key (org_id, mention_id) references public.mentions (org_id, id) on delete cascade,
  foreign key (org_id, department_id) references public.departments (org_id, id),
  foreign key (org_id, neighborhood_id) references public.neighborhoods (org_id, id)
);

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  mention_id uuid not null,
  department_id uuid not null,
  assignee_id uuid references auth.users (id),
  status public.ticket_status not null default 'open',
  due_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (mention_id, department_id),
  foreign key (org_id, mention_id) references public.mentions (org_id, id) on delete cascade,
  foreign key (org_id, department_id) references public.departments (org_id, id)
);

create table public.alert_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  -- e.g. {"sentiment":"negative","min_mentions":20,"window_minutes":60}
  condition jsonb not null,
  -- e.g. {"email":["prensa@municipio.gob.mx"]}
  channels jsonb not null default '{}'::jsonb,
  -- Optional: scope the rule (and its events) to one department.
  department_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, department_id) references public.departments (org_id, id)
);

create table public.alert_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  rule_id uuid not null,
  mention_id uuid,
  department_id uuid,
  payload jsonb not null default '{}'::jsonb,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (org_id, rule_id) references public.alert_rules (org_id, id) on delete cascade,
  foreign key (org_id, mention_id) references public.mentions (org_id, id) on delete set null (mention_id),
  foreign key (org_id, department_id) references public.departments (org_id, id)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  period public.report_period not null,
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  content jsonb not null default '{}'::jsonb,
  -- Path inside the "reports" Storage bucket.
  pdf_path text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index mentions_org_published_idx on public.mentions (org_id, published_at desc);
create index mentions_search_idx on public.mentions using gin (search);
create index mentions_org_status_idx on public.mentions (org_id, status);
create index mentions_author_idx on public.mentions (author_id);
create index mentions_query_idx on public.mentions (query_id);

create index classifications_department_idx on public.classifications (department_id);
create index classifications_neighborhood_idx on public.classifications (neighborhood_id);
create index classifications_org_sentiment_idx on public.classifications (org_id, sentiment);

create index tickets_org_department_status_idx on public.tickets (org_id, department_id, status);
create index tickets_assignee_idx on public.tickets (assignee_id);

create index memberships_user_idx on public.memberships (user_id);
create index queries_project_idx on public.queries (project_id);
create index alert_events_org_created_idx on public.alert_events (org_id, created_at desc);
create index alert_events_rule_idx on public.alert_events (rule_id);
create index reports_org_period_idx on public.reports (org_id, period_start desc);

-- ---------------------------------------------------------------------------
-- Authorization helpers
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so policies can read memberships without recursing into
-- memberships' own RLS. Kept in a schema that the Data API does not expose.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create function private.has_role(p_org_id uuid, p_roles public.membership_role[])
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
      and m.role = any (p_roles)
  );
$$;

-- admin, comunicacion and lectura read everything in the org.
create function private.can_read_all(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_role(p_org_id, '{admin,comunicacion,lectura}');
$$;

create function private.is_member(p_org_id uuid)
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
  );
$$;

-- Department of the current user when their role is dependencia, else null.
create function private.user_department(p_org_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.department_id
  from public.memberships m
  where m.org_id = p_org_id
    and m.user_id = (select auth.uid())
    and m.role = 'dependencia';
$$;

-- A dependencia user sees a mention only when it was routed to its department.
create function private.mention_routed_to_user(p_org_id uuid, p_mention_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tickets t
    where t.org_id = p_org_id
      and t.mention_id = p_mention_id
      and t.department_id = private.user_department(p_org_id)
  );
$$;

create function private.author_visible_to_user(p_org_id uuid, p_author_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tickets t
    join public.mentions m on m.id = t.mention_id
    where t.org_id = p_org_id
      and m.author_id = p_author_id
      and t.department_id = private.user_department(p_org_id)
  );
$$;

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.departments enable row level security;
alter table public.memberships enable row level security;
alter table public.neighborhoods enable row level security;
alter table public.projects enable row level security;
alter table public.queries enable row level security;
alter table public.sources enable row level security;
alter table public.authors enable row level security;
alter table public.mentions enable row level security;
alter table public.classifications enable row level security;
alter table public.tickets enable row level security;
alter table public.alert_rules enable row level security;
alter table public.alert_events enable row level security;
alter table public.reports enable row level security;

-- Nothing is readable without a session.
revoke all on all tables in schema public from anon;

-- Column-level UPDATE grants: keys (org_id, mention_id) are never rewritable
-- through the API, so an update policy cannot be used to pull another row's
-- data into a user's visibility.
revoke update on public.tickets, public.classifications, public.alert_events from authenticated;
grant update (department_id, assignee_id, status, due_at, resolved_at) on public.tickets to authenticated;
grant update (sentiment, emotion, topic, intent, priority, department_id, neighborhood_id, corrected_by)
  on public.classifications to authenticated;
grant update (acknowledged_at) on public.alert_events to authenticated;

-- organizations
create policy "members read their org" on public.organizations
  for select to authenticated using ((select private.is_member(id)));
create policy "admins update their org" on public.organizations
  for update to authenticated
  using ((select private.has_role(id, '{admin}')))
  with check ((select private.has_role(id, '{admin}')));

-- memberships: everyone sees their own row; admins manage the org's members.
create policy "users read own membership" on public.memberships
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.has_role(org_id, '{admin}')));
create policy "admins manage memberships" on public.memberships
  for all to authenticated
  using ((select private.has_role(org_id, '{admin}')))
  with check ((select private.has_role(org_id, '{admin}')));

-- Reference catalogs: readable by every member, managed by admins.
create policy "members read departments" on public.departments
  for select to authenticated using ((select private.is_member(org_id)));
create policy "admins manage departments" on public.departments
  for all to authenticated
  using ((select private.has_role(org_id, '{admin}')))
  with check ((select private.has_role(org_id, '{admin}')));

create policy "members read neighborhoods" on public.neighborhoods
  for select to authenticated using ((select private.is_member(org_id)));
create policy "admins manage neighborhoods" on public.neighborhoods
  for all to authenticated
  using ((select private.has_role(org_id, '{admin}')))
  with check ((select private.has_role(org_id, '{admin}')));

-- Monitoring configuration and executive output: not visible to dependencia.
create policy "readers read projects" on public.projects
  for select to authenticated using ((select private.can_read_all(org_id)));
create policy "editors manage projects" on public.projects
  for all to authenticated
  using ((select private.has_role(org_id, '{admin,comunicacion}')))
  with check ((select private.has_role(org_id, '{admin,comunicacion}')));

create policy "readers read queries" on public.queries
  for select to authenticated using ((select private.can_read_all(org_id)));
create policy "editors manage queries" on public.queries
  for all to authenticated
  using ((select private.has_role(org_id, '{admin,comunicacion}')))
  with check ((select private.has_role(org_id, '{admin,comunicacion}')));

create policy "readers read sources" on public.sources
  for select to authenticated using ((select private.can_read_all(org_id)));
create policy "editors manage sources" on public.sources
  for all to authenticated
  using ((select private.has_role(org_id, '{admin,comunicacion}')))
  with check ((select private.has_role(org_id, '{admin,comunicacion}')));

create policy "readers read reports" on public.reports
  for select to authenticated using ((select private.can_read_all(org_id)));
create policy "editors manage reports" on public.reports
  for all to authenticated
  using ((select private.has_role(org_id, '{admin,comunicacion}')))
  with check ((select private.has_role(org_id, '{admin,comunicacion}')));

-- mentions: inserted by ingestion (service role); dependencia sees routed ones.
create policy "read mentions" on public.mentions
  for select to authenticated
  using (
    (select private.can_read_all(org_id))
    or private.mention_routed_to_user(org_id, id)
  );

create policy "read authors" on public.authors
  for select to authenticated
  using (
    (select private.can_read_all(org_id))
    or private.author_visible_to_user(org_id, id)
  );

create policy "read classifications" on public.classifications
  for select to authenticated
  using (
    (select private.can_read_all(org_id))
    or private.mention_routed_to_user(org_id, mention_id)
  );
-- Human corrections of the model's output.
create policy "editors correct classifications" on public.classifications
  for update to authenticated
  using ((select private.has_role(org_id, '{admin,comunicacion}')))
  with check ((select private.has_role(org_id, '{admin,comunicacion}')));

-- tickets: comunicacion routes; dependencia works its own and cannot re-route.
create policy "read tickets" on public.tickets
  for select to authenticated
  using (
    (select private.can_read_all(org_id))
    or department_id = (select private.user_department(org_id))
  );
create policy "editors route tickets" on public.tickets
  for insert to authenticated
  with check ((select private.has_role(org_id, '{admin,comunicacion}')));
create policy "editors update tickets" on public.tickets
  for update to authenticated
  using ((select private.has_role(org_id, '{admin,comunicacion}')))
  with check ((select private.has_role(org_id, '{admin,comunicacion}')));
create policy "departments update own tickets" on public.tickets
  for update to authenticated
  using (department_id = (select private.user_department(org_id)))
  with check (department_id = (select private.user_department(org_id)));
create policy "admins delete tickets" on public.tickets
  for delete to authenticated
  using ((select private.has_role(org_id, '{admin}')));

-- alerts: department-scoped rules/events are visible to that department.
create policy "read alert rules" on public.alert_rules
  for select to authenticated
  using (
    (select private.can_read_all(org_id))
    or department_id = (select private.user_department(org_id))
  );
create policy "editors manage alert rules" on public.alert_rules
  for all to authenticated
  using ((select private.has_role(org_id, '{admin,comunicacion}')))
  with check ((select private.has_role(org_id, '{admin,comunicacion}')));

create policy "read alert events" on public.alert_events
  for select to authenticated
  using (
    (select private.can_read_all(org_id))
    or department_id = (select private.user_department(org_id))
  );
create policy "editors acknowledge alert events" on public.alert_events
  for update to authenticated
  using ((select private.has_role(org_id, '{admin,comunicacion}')))
  with check ((select private.has_role(org_id, '{admin,comunicacion}')));

-- ---------------------------------------------------------------------------
-- Hourly stats
-- ---------------------------------------------------------------------------
-- Materialized views cannot have RLS, so this one is not granted to API roles.
-- Read it through public.mention_stats(), which applies the same visibility
-- rules as the tables. Refresh with private.refresh_mention_stats() (cron).

create materialized view public.mention_stats_hourly as
select
  m.org_id,
  date_trunc('hour', m.published_at) as hour,
  c.sentiment,
  c.department_id,
  count(*)::integer as mentions,
  coalesce(sum((m.metrics ->> 'likes')::bigint), 0)
    + coalesce(sum((m.metrics ->> 'shares')::bigint), 0)
    + coalesce(sum((m.metrics ->> 'comments')::bigint), 0) as interactions
from public.mentions m
left join public.classifications c on c.mention_id = m.id
group by 1, 2, 3, 4
with no data;

create unique index mention_stats_hourly_key
  on public.mention_stats_hourly (org_id, hour, sentiment, department_id) nulls not distinct;

revoke all on public.mention_stats_hourly from public, anon, authenticated;

create function private.refresh_mention_stats()
returns void
language sql
security definer
set search_path = ''
as $$
  refresh materialized view concurrently public.mention_stats_hourly;
$$;
revoke execute on function private.refresh_mention_stats() from public, anon, authenticated;

refresh materialized view public.mention_stats_hourly;

create function public.mention_stats(p_org_id uuid, p_from timestamptz, p_to timestamptz)
returns table (
  hour timestamptz,
  sentiment public.sentiment,
  department_id uuid,
  mentions integer,
  interactions bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.hour, s.sentiment, s.department_id, s.mentions, s.interactions
  from public.mention_stats_hourly s
  where s.org_id = p_org_id
    and s.hour >= p_from
    and s.hour < p_to
    and private.can_read_all(p_org_id)
  order by s.hour;
$$;
revoke execute on function public.mention_stats(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.mention_stats(uuid, timestamptz, timestamptz) to authenticated;
