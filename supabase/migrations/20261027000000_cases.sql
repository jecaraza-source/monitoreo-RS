-- Cases (stage 4): the operational unit that groups mentions about one
-- problem (e.g. 18 posts about the same water leak) and carries it through
-- review, assignment, attention, validation and closing.
--
-- Model (aditive; mentions and tickets are preserved):
--   cases            one problem, with a per-org folio (C-00001), title,
--                    category, colonia, priority, responsible department and
--                    person, deadline and ONE workflow state.
--   case_mentions    which mentions belong to the case (a mention to at most
--                    one case). Mentions stay mentions: counts do not change.
--   case_events      append-only history: actor (person, WhatsApp or system),
--                    time, operation, state change, reason, changes.
--   case_notes       internal (comunicación) or shared with the department.
--   tickets.case_id  tickets are the case's ASSIGNMENTS to departments: they
--                    hang from the case's primary mention (one per
--                    department: lead or support), keep their WhatsApp
--                    folios, SLA and notices, and their status MIRRORS the
--                    case (the case is the only state machine). Changing the
--                    status of a case ticket goes through the case.
--   Mentions not in a case keep working exactly as before.
--
-- Everything is written through SECURITY DEFINER functions that check the
-- role, the org of every row and the allowed transition, and write the
-- history in the same transaction. Rollback: docs/rollback/20261027000000_cases.down.sql.

create type public.case_status as enum (
  'new',          -- detectado
  'in_review',    -- en revisión (comunicación)
  'assigned',     -- asignado a una dependencia
  'accepted',     -- aceptado por la dependencia
  'in_progress',  -- en atención
  'resolved',     -- atendido, por validar
  'closed',       -- validado y cerrado
  'returned',     -- devuelto por competencia
  'discarded',    -- descartado (no es un caso)
  'merged'        -- fusionado en otro caso
);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.case_counters (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  last_number integer not null default 0
);
alter table public.case_counters enable row level security;
revoke all on public.case_counters from anon, authenticated;

create table public.cases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  number integer not null check (number > 0),
  folio text generated always as ('C-' || lpad(number::text, 5, '0')) stored,
  title text not null check (char_length(title) between 3 and 200),
  description text not null default '' check (char_length(description) <= 4000),
  -- A topic of the project taxonomy (same vocabulary as classifications.topic).
  category text check (char_length(category) <= 80),
  neighborhood_id uuid,
  priority public.priority not null default 'medium',
  department_id uuid,
  responsible_user_id uuid references auth.users (id),
  due_at timestamptz,
  status public.case_status not null default 'new',
  status_reason text,
  -- Assignments (tickets) hang from this mention.
  primary_mention_id uuid,
  merged_into_id uuid,
  -- The person who opened the case (null: the system, e.g. the backfill).
  -- Not to be confused with the authors of the publications.
  opened_by uuid references auth.users (id),
  opened_at timestamptz not null default now(),
  assigned_at timestamptz,
  accepted_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  updated_at timestamptz not null default now(),
  -- Stable mapping of the ticket backfill: 'mention:<uuid>'.
  backfill_key text,
  unique (org_id, number),
  unique (org_id, id),
  unique (org_id, backfill_key),
  foreign key (org_id, neighborhood_id) references public.neighborhoods (org_id, id),
  foreign key (org_id, department_id) references public.departments (org_id, id),
  foreign key (org_id, primary_mention_id) references public.mentions (org_id, id) on delete set null (primary_mention_id),
  foreign key (org_id, merged_into_id) references public.cases (org_id, id)
);
create index cases_org_status_idx on public.cases (org_id, status, updated_at desc);
create index cases_department_idx on public.cases (org_id, department_id) where department_id is not null;

create table public.case_mentions (
  -- A mention belongs to at most one case.
  mention_id uuid primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  added_by uuid references auth.users (id),
  added_at timestamptz not null default now(),
  reason text,
  foreign key (org_id, case_id) references public.cases (org_id, id) on delete cascade,
  foreign key (org_id, mention_id) references public.mentions (org_id, id) on delete cascade
);
create index case_mentions_case_idx on public.case_mentions (case_id);

create table public.case_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  at timestamptz not null default now(),
  actor_id uuid references auth.users (id),
  actor_name text not null default '',
  actor_kind text not null check (actor_kind in ('user', 'whatsapp', 'system')),
  operation text not null,
  from_status public.case_status,
  to_status public.case_status,
  reason text,
  changes jsonb not null default '{}'::jsonb,
  -- Hidden from the department (e.g. an internal note was added).
  internal boolean not null default false,
  foreign key (org_id, case_id) references public.cases (org_id, id) on delete cascade
);
create index case_events_case_idx on public.case_events (case_id, at);

create table public.case_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  author_id uuid references auth.users (id),
  author_name text not null default '',
  body text not null check (char_length(body) between 1 and 2000),
  visibility text not null check (visibility in ('internal', 'department')),
  created_at timestamptz not null default now(),
  foreign key (org_id, case_id) references public.cases (org_id, id) on delete cascade
);
create index case_notes_case_idx on public.case_notes (case_id, created_at);

alter table public.tickets add column case_id uuid;
alter table public.tickets
  add constraint tickets_case_fk foreign key (org_id, case_id) references public.cases (org_id, id) on delete set null (case_id);
create index tickets_case_idx on public.tickets (case_id) where case_id is not null;

-- History and notes cannot be rewritten (also not by the service role).
create function private.case_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'El historial de casos no se modifica.' using errcode = '42501';
end;
$$;
create trigger case_events_append_only before update on public.case_events
  for each row execute function private.case_append_only();
create trigger case_notes_append_only before update on public.case_notes
  for each row execute function private.case_append_only();
revoke update, delete, truncate on public.case_events, public.case_notes from authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Visibility
-- ---------------------------------------------------------------------------

-- A department sees a case when it has (or had) an assignment in it.
create function private.case_visible_to_department(p_org_id uuid, p_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tickets t
    where t.org_id = p_org_id and t.case_id = p_case_id
      and t.department_id = private.user_department(p_org_id)
  );
$$;
revoke execute on function private.case_visible_to_department(uuid, uuid) from public, anon;
-- Called by the RLS policies, as the querying user.
grant execute on function private.case_visible_to_department(uuid, uuid) to authenticated;

-- A department also sees every mention of the cases assigned to it (and
-- only those: not mentions of other cases).
create or replace function private.mention_routed_to_user(p_org_id uuid, p_mention_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tickets t
    where t.org_id = p_org_id and t.mention_id = p_mention_id
      and t.department_id = private.user_department(p_org_id)
  ) or exists (
    select 1 from public.case_mentions cm
    join public.tickets t on t.case_id = cm.case_id
    where cm.org_id = p_org_id and cm.mention_id = p_mention_id
      and t.department_id = private.user_department(p_org_id)
  );
$$;

create or replace function private.author_visible_to_user(p_org_id uuid, p_author_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.mentions m
    where m.org_id = p_org_id and m.author_id = p_author_id
      and private.mention_routed_to_user(p_org_id, m.id)
  );
$$;

alter table public.cases enable row level security;
alter table public.case_mentions enable row level security;
alter table public.case_events enable row level security;
alter table public.case_notes enable row level security;

create policy "read cases" on public.cases for select to authenticated
  using ((select private.can_read_all(org_id)) or private.case_visible_to_department(org_id, id));
create policy "read case mentions" on public.case_mentions for select to authenticated
  using ((select private.can_read_all(org_id)) or private.case_visible_to_department(org_id, case_id));
create policy "read case events" on public.case_events for select to authenticated
  using ((select private.can_read_all(org_id)) or (not internal and private.case_visible_to_department(org_id, case_id)));
create policy "read case notes" on public.case_notes for select to authenticated
  using ((select private.can_read_all(org_id)) or (visibility = 'department' and private.case_visible_to_department(org_id, case_id)));

-- Writes only through the functions below.
revoke all on public.cases, public.case_mentions, public.case_events, public.case_notes from anon;
revoke insert, update, delete on public.cases, public.case_mentions, public.case_events, public.case_notes from authenticated;

-- ---------------------------------------------------------------------------
-- Building blocks
-- ---------------------------------------------------------------------------

-- Who is acting: a person in the app, a person over WhatsApp, or the system.
create function private.case_actor()
returns table (actor_id uuid, actor_name text, actor_kind text)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id,
         coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), u.email, ''),
         case when coalesce(current_setting('app.channel', true), '') = 'whatsapp' then 'whatsapp' else 'user' end
  from auth.users u where u.id = (select auth.uid())
  union all
  select null, 'Sistema', 'system' where (select auth.uid()) is null;
$$;

create function private.log_case_event(
  p_org_id uuid, p_case_id uuid, p_operation text,
  p_from public.case_status default null, p_to public.case_status default null,
  p_reason text default null, p_changes jsonb default '{}', p_internal boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.case_events (org_id, case_id, actor_id, actor_name, actor_kind, operation, from_status, to_status, reason, changes, internal)
  select p_org_id, p_case_id, a.actor_id, a.actor_name, a.actor_kind, p_operation, p_from, p_to, nullif(btrim(p_reason), ''), coalesce(p_changes, '{}'), p_internal
  from private.case_actor() a;
end;
$$;

create function private.next_case_number(p_org_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number integer;
begin
  insert into public.case_counters as c (org_id, last_number) values (p_org_id, 1)
  on conflict (org_id) do update set last_number = c.last_number + 1
  returning last_number into v_number;
  return v_number;
end;
$$;

-- The only workflow: which state changes exist and which need a reason.
create function public.case_transition_allowed(p_from public.case_status, p_to public.case_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from::text, p_to::text) in (
    ('new', 'in_review'), ('new', 'assigned'), ('new', 'discarded'),
    ('in_review', 'assigned'), ('in_review', 'discarded'),
    ('assigned', 'accepted'), ('assigned', 'returned'), ('assigned', 'assigned'),
    ('accepted', 'in_progress'), ('accepted', 'returned'), ('accepted', 'assigned'),
    ('in_progress', 'resolved'), ('in_progress', 'assigned'),
    ('resolved', 'closed'), ('resolved', 'in_progress'),
    ('returned', 'assigned'), ('returned', 'in_review'),
    ('closed', 'in_review'), ('discarded', 'in_review')
  );
$$;

-- Returning, discarding, rejecting a validation and reopening need a reason.
create function public.case_transition_needs_reason(p_from public.case_status, p_to public.case_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_to in ('returned', 'discarded')
      or (p_from = 'resolved' and p_to = 'in_progress')
      or (p_from in ('closed', 'discarded') and p_to = 'in_review');
$$;

-- What the department of the case may do itself; everything else is for admin and comunicación.
create function public.case_transition_by_department(p_from public.case_status, p_to public.case_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from::text, p_to::text) in (
    ('assigned', 'accepted'), ('assigned', 'returned'),
    ('accepted', 'in_progress'), ('accepted', 'returned'),
    ('in_progress', 'resolved')
  );
$$;

-- Assignment tickets follow the case (tickets on the primary mention).
create function private.sync_case_tickets(p_case public.cases)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.ticket_status := case p_case.status
    when 'assigned' then 'open' when 'accepted' then 'open' when 'in_progress' then 'in_progress'
    when 'resolved' then 'resolved' else 'closed' end;
begin
  perform set_config('app.case_sync', 'on', true);
  update public.tickets t
  set status = v_status,
      resolved_at = case when v_status in ('resolved', 'closed') then coalesce(t.resolved_at, now()) else null end
  where t.case_id = p_case.id and t.mention_id = p_case.primary_mention_id
    and t.status is distinct from v_status
    -- A closed assignment of a department that was replaced stays closed;
    -- the lead's ticket always follows the case.
    and (t.department_id = p_case.department_id or t.status <> 'closed');
  perform set_config('app.case_sync', '', true);
end;
$$;

-- A case ticket's status only changes through its case.
create function private.guard_case_ticket()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.case_id is not null and new.status is distinct from old.status
     and coalesce(current_setting('app.case_sync', true), '') <> 'on' then
    raise exception 'Este turno es parte de un caso: cambia el estado del caso.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger tickets_guard_case before update of status on public.tickets
  for each row execute function private.guard_case_ticket();

-- Applies one transition: checks, stamps, syncs tickets, writes history.
create function private.apply_case_transition(p_case_id uuid, p_to public.case_status, p_reason text)
returns public.cases
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.cases;
  v_editor boolean;
  v_dept boolean;
begin
  select * into v_case from public.cases where id = p_case_id for update;
  if v_case.id is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_editor := private.has_role(v_case.org_id, '{admin,comunicacion}') or (select auth.uid()) is null;
  v_dept := v_case.department_id is not null and v_case.department_id = private.user_department(v_case.org_id)
            and private.has_role(v_case.org_id, '{dependencia}');
  if not (v_editor or (v_dept and public.case_transition_by_department(v_case.status, p_to))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not public.case_transition_allowed(v_case.status, p_to) then
    raise exception 'Un caso % no puede pasar a %.', v_case.status, p_to using errcode = '22023';
  end if;
  if public.case_transition_needs_reason(v_case.status, p_to) and nullif(btrim(p_reason), '') is null then
    raise exception 'Este cambio requiere un motivo.' using errcode = '22023';
  end if;
  if p_to = 'assigned' and v_case.department_id is null then
    raise exception 'Elige la dependencia responsable.' using errcode = '22023';
  end if;

  update public.cases
  set status = p_to,
      status_reason = nullif(btrim(p_reason), ''),
      accepted_at = case when p_to = 'accepted' then now() when p_to = 'assigned' then null else accepted_at end,
      resolved_at = case when p_to = 'resolved' then now() when p_to in ('in_progress', 'in_review', 'assigned') then null else resolved_at end,
      closed_at = case when p_to = 'closed' then now() when p_to = 'in_review' then null else closed_at end,
      updated_at = now()
  where id = p_case_id
  returning * into v_case;

  perform private.sync_case_tickets(v_case);
  return v_case;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public operations
-- ---------------------------------------------------------------------------

-- Opens a case from one or more mentions of the caller's org.
create function public.create_case(
  p_org_id uuid,
  p_mention_ids uuid[],
  p_title text,
  p_description text default '',
  p_category text default null,
  p_neighborhood_id uuid default null,
  p_priority public.priority default 'medium'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_taken text;
  v_primary uuid;
begin
  if not private.has_role(p_org_id, '{admin,comunicacion}') and (select auth.uid()) is not null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_mention_ids), 0) = 0 then
    raise exception 'Elige al menos una mención.' using errcode = '22023';
  end if;
  if (select count(*) from public.mentions m where m.id = any (p_mention_ids) and m.org_id = p_org_id) <> cardinality(array(select distinct unnest(p_mention_ids))) then
    raise exception 'Alguna mención no existe en este municipio.' using errcode = '22023';
  end if;
  select string_agg(distinct c.folio, ', ') into v_taken
  from public.case_mentions cm join public.cases c on c.id = cm.case_id where cm.mention_id = any (p_mention_ids);
  if v_taken is not null then
    raise exception 'Alguna mención ya pertenece a %.', v_taken using errcode = '23505';
  end if;
  if p_neighborhood_id is not null and not exists (select 1 from public.neighborhoods n where n.id = p_neighborhood_id and n.org_id = p_org_id) then
    raise exception 'Colonia inválida.' using errcode = '22023';
  end if;

  -- The primary mention: the earliest one (assignments hang from it).
  select m.id into v_primary from public.mentions m where m.id = any (p_mention_ids) order by m.published_at, m.id limit 1;

  insert into public.cases (org_id, number, title, description, category, neighborhood_id, priority, primary_mention_id, opened_by)
  values (p_org_id, private.next_case_number(p_org_id), btrim(p_title), coalesce(btrim(p_description), ''), nullif(btrim(p_category), ''),
          p_neighborhood_id, p_priority, v_primary, (select auth.uid()))
  returning id into v_id;

  insert into public.case_mentions (org_id, case_id, mention_id, added_by)
  select p_org_id, v_id, m, (select auth.uid()) from (select distinct unnest(p_mention_ids) as m) x;

  perform private.log_case_event(p_org_id, v_id, 'created', null, 'new', null,
    jsonb_build_object('title', btrim(p_title), 'mentions', cardinality(array(select distinct unnest(p_mention_ids)))));
  return v_id;
end;
$$;

-- Adds mentions to a case (with a reason when the case is already being worked).
create function public.case_add_mentions(p_case_id uuid, p_mention_ids uuid[], p_reason text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.cases;
  v_taken text;
  v_count integer;
begin
  select * into v_case from public.cases where id = p_case_id for update;
  if v_case.id is null or not private.has_role(v_case.org_id, '{admin,comunicacion}') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_case.status = 'merged' then
    raise exception 'El caso fue fusionado en otro.' using errcode = '22023';
  end if;
  if (select count(*) from public.mentions m where m.id = any (p_mention_ids) and m.org_id = v_case.org_id) <> cardinality(array(select distinct unnest(p_mention_ids))) then
    raise exception 'Alguna mención no existe en este municipio.' using errcode = '22023';
  end if;
  select string_agg(distinct c.folio, ', ') into v_taken
  from public.case_mentions cm join public.cases c on c.id = cm.case_id
  where cm.mention_id = any (p_mention_ids) and cm.case_id <> p_case_id;
  if v_taken is not null then
    raise exception 'Alguna mención ya pertenece a %.', v_taken using errcode = '23505';
  end if;

  insert into public.case_mentions (org_id, case_id, mention_id, added_by, reason)
  select v_case.org_id, p_case_id, m, (select auth.uid()), nullif(btrim(p_reason), '')
  from (select distinct unnest(p_mention_ids) as m) x
  on conflict (mention_id) do nothing;
  get diagnostics v_count = row_count;

  if v_count > 0 then
    update public.cases set updated_at = now() where id = p_case_id;
    perform private.log_case_event(v_case.org_id, p_case_id, 'mentions_added', null, null, p_reason,
      jsonb_build_object('mention_ids', to_jsonb(p_mention_ids), 'added', v_count));
  end if;
  return v_count;
end;
$$;

-- Removes one mention from a case, with a reason. It stays a mention.
create function public.case_remove_mention(p_case_id uuid, p_mention_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.cases;
  v_next uuid;
begin
  select * into v_case from public.cases where id = p_case_id for update;
  if v_case.id is null or not private.has_role(v_case.org_id, '{admin,comunicacion}') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Quitar una mención requiere un motivo.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.case_mentions where case_id = p_case_id and mention_id = p_mention_id) then
    raise exception 'La mención no pertenece a este caso.' using errcode = '22023';
  end if;
  if (select count(*) from public.case_mentions where case_id = p_case_id) = 1 then
    raise exception 'Un caso necesita al menos una mención.' using errcode = '22023';
  end if;
  if p_mention_id = v_case.primary_mention_id then
    if exists (select 1 from public.tickets t where t.case_id = p_case_id and t.mention_id = p_mention_id) then
      raise exception 'Es la mención principal del caso y tiene las asignaciones; no se puede quitar.' using errcode = '22023';
    end if;
    select cm.mention_id into v_next from public.case_mentions cm join public.mentions m on m.id = cm.mention_id
    where cm.case_id = p_case_id and cm.mention_id <> p_mention_id order by m.published_at, m.id limit 1;
    update public.cases set primary_mention_id = v_next where id = p_case_id;
  end if;

  delete from public.case_mentions where case_id = p_case_id and mention_id = p_mention_id;
  -- Its own tickets (if any) go back to being standalone turns.
  update public.tickets set case_id = null where case_id = p_case_id and mention_id = p_mention_id;
  update public.cases set updated_at = now() where id = p_case_id;
  perform private.log_case_event(v_case.org_id, p_case_id, 'mention_removed', null, null, p_reason,
    jsonb_build_object('mention_id', p_mention_id));
end;
$$;

-- Edits descriptive fields; records old and new values.
-- p_fields: any of title, description, category, neighborhood_id, priority, due_at, responsible_user_id.
create function public.update_case(p_case_id uuid, p_fields jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.cases;
  v_new public.cases;
  v_changes jsonb := '{}';
  v_key text;
begin
  select * into v_old from public.cases where id = p_case_id for update;
  if v_old.id is null or not private.has_role(v_old.org_id, '{admin,comunicacion}') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if exists (select 1 from jsonb_object_keys(p_fields) k
             where k not in ('title', 'description', 'category', 'neighborhood_id', 'priority', 'due_at', 'responsible_user_id')) then
    raise exception 'Campo no editable.' using errcode = '22023';
  end if;
  if p_fields ? 'neighborhood_id' and p_fields ->> 'neighborhood_id' is not null
     and not exists (select 1 from public.neighborhoods n where n.id = (p_fields ->> 'neighborhood_id')::uuid and n.org_id = v_old.org_id) then
    raise exception 'Colonia inválida.' using errcode = '22023';
  end if;
  if p_fields ? 'responsible_user_id' and p_fields ->> 'responsible_user_id' is not null
     and not exists (select 1 from public.memberships m where m.user_id = (p_fields ->> 'responsible_user_id')::uuid and m.org_id = v_old.org_id) then
    raise exception 'La persona responsable no es de este municipio.' using errcode = '22023';
  end if;

  update public.cases c
  set title = case when p_fields ? 'title' then btrim(p_fields ->> 'title') else c.title end,
      description = case when p_fields ? 'description' then coalesce(p_fields ->> 'description', '') else c.description end,
      category = case when p_fields ? 'category' then nullif(btrim(p_fields ->> 'category'), '') else c.category end,
      neighborhood_id = case when p_fields ? 'neighborhood_id' then (p_fields ->> 'neighborhood_id')::uuid else c.neighborhood_id end,
      priority = case when p_fields ? 'priority' then (p_fields ->> 'priority')::public.priority else c.priority end,
      due_at = case when p_fields ? 'due_at' then (p_fields ->> 'due_at')::timestamptz else c.due_at end,
      responsible_user_id = case when p_fields ? 'responsible_user_id' then (p_fields ->> 'responsible_user_id')::uuid else c.responsible_user_id end,
      updated_at = now()
  where c.id = p_case_id
  returning * into v_new;

  for v_key in select jsonb_object_keys(p_fields) loop
    if to_jsonb(v_old) -> v_key is distinct from to_jsonb(v_new) -> v_key then
      v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_array(to_jsonb(v_old) -> v_key, to_jsonb(v_new) -> v_key));
    end if;
  end loop;
  -- Keep the assignments' deadline in line with the case.
  if v_changes ? 'due_at' then
    update public.tickets set due_at = v_new.due_at where case_id = p_case_id and mention_id = v_new.primary_mention_id and status in ('open', 'in_progress');
  end if;
  if v_changes <> '{}' then
    perform private.log_case_event(v_old.org_id, p_case_id, 'updated', null, null, null, v_changes);
  end if;
end;
$$;

-- Moves the case to another state. Assigning names the lead department (and
-- optional supporting ones): their assignment tickets are created on the
-- primary mention, with the case's deadline.
create function public.transition_case(
  p_case_id uuid,
  p_to public.case_status,
  p_reason text default null,
  p_department_id uuid default null,
  p_support_ids uuid[] default '{}',
  p_due_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.cases;
  v_from public.case_status;
  v_tickets uuid[] := '{}';
  v_changes jsonb := '{}';
begin
  select * into v_case from public.cases where id = p_case_id;
  if v_case.id is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_from := v_case.status;
  if p_to = 'merged' then
    raise exception 'Para fusionar usa merge_cases.' using errcode = '22023';
  end if;

  if p_to = 'assigned' then
    if not private.has_role(v_case.org_id, '{admin,comunicacion}') then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    if p_department_id is null or not exists (select 1 from public.departments d where d.id = p_department_id and d.org_id = v_case.org_id) then
      raise exception 'Elige la dependencia responsable.' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(coalesce(p_support_ids, '{}')) s
               where not exists (select 1 from public.departments d where d.id = s and d.org_id = v_case.org_id)) then
      raise exception 'Dependencia de apoyo inválida.' using errcode = '22023';
    end if;
    if v_case.primary_mention_id is null then
      raise exception 'El caso no tiene mención principal.' using errcode = '22023';
    end if;
    v_changes := jsonb_build_object('department_id', jsonb_build_array(v_case.department_id, p_department_id),
                                    'support_ids', to_jsonb(coalesce(p_support_ids, '{}')));
    update public.cases
    set department_id = p_department_id, due_at = coalesce(p_due_at, due_at), assigned_at = now()
    where id = p_case_id;

    -- Assignment tickets (route_mentions' rules, tied to the case).
    perform set_config('app.case_sync', 'on', true);
    update public.tickets set is_primary = false
    where mention_id = v_case.primary_mention_id and department_id <> p_department_id and is_primary;
    -- A replaced lead department is done with it.
    update public.tickets set status = 'closed', resolved_at = coalesce(resolved_at, now())
    where case_id = p_case_id and mention_id = v_case.primary_mention_id
      and department_id <> p_department_id and not (department_id = any (coalesce(p_support_ids, '{}'))) and status <> 'closed';

    with lead as (
      insert into public.tickets (org_id, mention_id, department_id, due_at, is_primary, case_id)
      values (v_case.org_id, v_case.primary_mention_id, p_department_id, coalesce(p_due_at, v_case.due_at), true, p_case_id)
      on conflict (mention_id, department_id) do update
        set due_at = excluded.due_at, status = 'open', resolved_at = null, assigned_at = now(), is_primary = true, case_id = p_case_id,
            whatsapp_notified_at = null, whatsapp_reminded_at = null, whatsapp_escalated_at = null
      returning id
    ), support as (
      insert into public.tickets (org_id, mention_id, department_id, due_at, is_primary, case_id)
      select v_case.org_id, v_case.primary_mention_id, s, coalesce(p_due_at, v_case.due_at), false, p_case_id
      from (select distinct unnest(coalesce(p_support_ids, '{}')) as s) x where s <> p_department_id
      on conflict (mention_id, department_id) do update
        set due_at = excluded.due_at, status = 'open', resolved_at = null, assigned_at = now(), is_primary = false, case_id = p_case_id,
            whatsapp_notified_at = null, whatsapp_reminded_at = null, whatsapp_escalated_at = null
      returning id
    )
    select array(select id from lead union all select id from support) into v_tickets;
    perform set_config('app.case_sync', '', true);
    update public.mentions set triage = 'routed' where id in (select mention_id from public.case_mentions where case_id = p_case_id);
  end if;

  v_case := private.apply_case_transition(p_case_id, p_to, p_reason);
  perform private.log_case_event(v_case.org_id, p_case_id, case when v_from in ('closed', 'discarded') and p_to = 'in_review' then 'reopened' else 'status' end,
    v_from, p_to, p_reason, v_changes);
  return jsonb_build_object('status', v_case.status, 'ticket_ids', to_jsonb(v_tickets));
end;
$$;

-- A department (or WhatsApp) moves a case ticket: walks the case forward
-- (assigned → accepted → in_progress → resolved). The case is the state.
create function public.case_ticket_status(p_ticket_id uuid, p_status public.ticket_status)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket public.tickets;
  v_case public.cases;
  v_target public.case_status := case p_status when 'in_progress' then 'in_progress' when 'resolved' then 'resolved' else null end;
  v_step public.case_status;
  v_path public.case_status[] := array['assigned', 'accepted', 'in_progress', 'resolved']::public.case_status[];
begin
  select * into v_ticket from public.tickets where id = p_ticket_id;
  if v_ticket.case_id is null then
    raise exception 'El turno no es parte de un caso.' using errcode = '22023';
  end if;
  if not (private.has_role(v_ticket.org_id, '{admin,comunicacion}')
          or v_ticket.department_id = private.user_department(v_ticket.org_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_case from public.cases where id = v_ticket.case_id;
  if v_target is null then
    raise exception 'Desde el turno sólo se marca en atención o atendido; abrir o cerrar se hace en el caso.' using errcode = '22023';
  end if;
  if v_ticket.department_id is distinct from v_case.department_id then
    raise exception 'Sólo la dependencia responsable avanza el caso.' using errcode = '42501';
  end if;
  if array_position(v_path, v_case.status) is null or array_position(v_path, v_case.status) >= array_position(v_path, v_target) then
    return jsonb_build_object('ok', true, 'status', v_case.status, 'case_id', v_case.id);
  end if;
  foreach v_step in array v_path[array_position(v_path, v_case.status) + 1 : array_position(v_path, v_target)] loop
    perform public.transition_case(v_case.id, v_step);
  end loop;
  return jsonb_build_object('ok', true, 'status', v_target, 'case_id', v_case.id);
end;
$$;

-- Notes: internal (only comunicación and admin, lectura reads them) or shared with the department.
create function public.add_case_note(p_case_id uuid, p_body text, p_visibility text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.cases;
  v_id uuid;
  v_editor boolean;
begin
  select * into v_case from public.cases where id = p_case_id;
  if v_case.id is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_editor := private.has_role(v_case.org_id, '{admin,comunicacion}');
  if not (v_editor or (private.has_role(v_case.org_id, '{dependencia}') and private.case_visible_to_department(v_case.org_id, p_case_id))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_visibility not in ('internal', 'department') or (p_visibility = 'internal' and not v_editor) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.case_notes (org_id, case_id, author_id, author_name, body, visibility)
  select v_case.org_id, p_case_id, a.actor_id, a.actor_name, btrim(p_body), p_visibility from private.case_actor() a
  returning id into v_id;
  perform private.log_case_event(v_case.org_id, p_case_id, 'note', null, null, null,
    jsonb_build_object('note_id', v_id, 'visibility', p_visibility), p_visibility = 'internal');
  return v_id;
end;
$$;

-- Merges source cases into a target: mentions and history stay, folios stay
-- (the sources become "merged" and point to the target). Never automatic.
create function public.merge_cases(p_target_id uuid, p_source_ids uuid[], p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.cases;
  v_source public.cases;
  v_count integer := 0;
begin
  select * into v_target from public.cases where id = p_target_id for update;
  if v_target.id is null or not private.has_role(v_target.org_id, '{admin,comunicacion}') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_target.status = 'merged' then
    raise exception 'El caso destino ya fue fusionado.' using errcode = '22023';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Fusionar requiere un motivo.' using errcode = '22023';
  end if;

  for v_source in select * from public.cases where id = any (p_source_ids) and id <> p_target_id for update loop
    if v_source.org_id <> v_target.org_id then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    if v_source.status = 'merged' then
      continue;
    end if;
    update public.case_mentions set case_id = p_target_id where case_id = v_source.id;
    -- Its assignments are over (the target carries the work) but stay linked for history and visibility.
    perform set_config('app.case_sync', 'on', true);
    update public.tickets set status = 'closed', resolved_at = coalesce(resolved_at, now())
    where case_id = v_source.id and status <> 'closed';
    update public.tickets set case_id = p_target_id where case_id = v_source.id;
    perform set_config('app.case_sync', '', true);
    update public.cases set status = 'merged', merged_into_id = p_target_id, status_reason = btrim(p_reason), updated_at = now()
    where id = v_source.id;
    perform private.log_case_event(v_source.org_id, v_source.id, 'merged_into', v_source.status, 'merged', p_reason,
      jsonb_build_object('target_id', p_target_id, 'target_folio', v_target.folio));
    perform private.log_case_event(v_target.org_id, p_target_id, 'merged_from', null, null, p_reason,
      jsonb_build_object('source_id', v_source.id, 'source_folio', v_source.folio));
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then
    raise exception 'No hay casos que fusionar.' using errcode = '22023';
  end if;
  update public.cases set updated_at = now() where id = p_target_id;
  return v_count;
end;
$$;

-- Suggestions to grow a case: mentions in no case, close in time, from the
-- same colonia and/or with similar wording. Sentiment never counts. They are
-- only suggestions: a person adds them.
create function public.suggest_case_mentions(p_case_id uuid, p_limit integer default 10)
returns table (mention_id uuid, score numeric, same_neighborhood boolean, same_topic boolean, word_overlap numeric, hours_apart numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_case public.cases;
begin
  select * into v_case from public.cases where id = p_case_id;
  if v_case.id is null or not private.has_role(v_case.org_id, '{admin,comunicacion}') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
  with mine as (
    select m.id, m.published_at, m.search, c.neighborhood_id, c.topic
    from public.case_mentions cm
    join public.mentions m on m.id = cm.mention_id
    left join public.classifications c on c.mention_id = m.id
    where cm.case_id = p_case_id
  ),
  span as (select min(published_at) - interval '72 hours' as lo, max(published_at) + interval '72 hours' as hi from mine),
  words as (select array_agg(distinct w) as lexemes from mine, unnest(tsvector_to_array(mine.search)) w where char_length(w) > 3),
  candidates as (
    select m.id, m.published_at, c.neighborhood_id, c.topic,
      (select count(*) from unnest(tsvector_to_array(m.search)) w where char_length(w) > 3 and w in (select unnest(lexemes) from words))::numeric
        / greatest(1, (select count(*) from unnest(tsvector_to_array(m.search)) w where char_length(w) > 3)) as overlap
    from public.mentions m
    left join public.classifications c on c.mention_id = m.id
    where m.org_id = v_case.org_id
      and m.published_at between (select lo from span) and (select hi from span)
      and not exists (select 1 from public.case_mentions x where x.mention_id = m.id)
  )
  select k.id,
         round((case when same_n then 2 else 0 end + case when same_t then 1 else 0 end + k.overlap * 3)::numeric, 2),
         same_n, same_t, round(k.overlap, 2),
         round((abs(extract(epoch from k.published_at - (select min(published_at) from mine))) / 3600)::numeric, 1)
  from (
    select cand.*,
      coalesce(cand.neighborhood_id is not null and cand.neighborhood_id in (select neighborhood_id from mine union select v_case.neighborhood_id), false) as same_n,
      coalesce(cand.topic is not null and cand.topic in (select topic from mine union select v_case.category), false) as same_t
    from candidates cand
  ) k
  -- Location or strong wording must back it (a shared topic, sentiment or a
  -- couple of words is not enough), and a known different colonia rules it out.
  where k.same_n
     or (k.overlap >= 0.5 and (k.neighborhood_id is null or not exists (
           select 1 from mine where mine.neighborhood_id is not null)
         and (v_case.neighborhood_id is null or k.neighborhood_id is null or k.neighborhood_id = v_case.neighborhood_id)))
  order by 2 desc, k.published_at desc
  limit greatest(1, least(p_limit, 50));
end;
$$;

-- ---------------------------------------------------------------------------
-- Turns that belong to a case are moved through the case
-- ---------------------------------------------------------------------------

-- Routing a mention that belongs to a case is routing the case.
create or replace function public.route_mentions(
  p_mention_ids uuid[],
  p_department_id uuid,
  p_due_at timestamptz,
  p_support_ids uuid[] default '{}'
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
  v_support integer;
  v_folio text;
begin
  select string_agg(distinct c.folio, ', ') into v_folio
  from public.case_mentions cm join public.cases c on c.id = cm.case_id where cm.mention_id = any (p_mention_ids);
  if v_folio is not null then
    raise exception 'La mención pertenece al caso %: asígnalo desde el caso.', v_folio using errcode = '22023';
  end if;

  update public.tickets
  set is_primary = false
  where mention_id = any (p_mention_ids) and department_id <> p_department_id and is_primary;

  insert into public.tickets (org_id, mention_id, department_id, due_at, is_primary)
  select m.org_id, m.id, p_department_id, p_due_at, true
  from public.mentions m
  where m.id = any (p_mention_ids)
  on conflict (mention_id, department_id)
    do update set due_at = excluded.due_at, status = 'open', resolved_at = null, assigned_at = now(), is_primary = true,
                  whatsapp_notified_at = null, whatsapp_reminded_at = null, whatsapp_escalated_at = null;
  get diagnostics v_count = row_count;

  insert into public.tickets (org_id, mention_id, department_id, due_at, is_primary)
  select m.org_id, m.id, d.id, p_due_at, false
  from public.mentions m
  cross join (select distinct unnest(p_support_ids) as id) d
  where m.id = any (p_mention_ids) and d.id <> p_department_id
  on conflict (mention_id, department_id)
    do update set due_at = excluded.due_at, status = 'open', resolved_at = null, assigned_at = now(), is_primary = false,
                  whatsapp_notified_at = null, whatsapp_reminded_at = null, whatsapp_escalated_at = null;
  get diagnostics v_support = row_count;

  update public.mentions set triage = 'routed' where id = any (p_mention_ids);
  return v_count + v_support;
end;
$$;

-- WhatsApp buttons on a case ticket move the case.
create or replace function public.whatsapp_ticket_action(
  p_contact_id uuid,
  p_ticket_id uuid,
  p_status public.ticket_status default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact public.whatsapp_contacts;
  v_ticket public.tickets;
  v_member public.memberships;
  v_labels jsonb := '{"open":"Abierto","in_progress":"En proceso","resolved":"Resuelto","closed":"Cerrado"}';
  v_result jsonb;
begin
  select * into v_contact from public.whatsapp_contacts where id = p_contact_id and status = 'active';
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'inactive');
  end if;
  select * into v_ticket from public.tickets where id = p_ticket_id and org_id = v_contact.org_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  select * into v_member from public.memberships where org_id = v_contact.org_id and user_id = v_contact.user_id;
  if not found or not (
    v_member.role in ('admin', 'comunicacion')
    or (v_member.role = 'dependencia' and v_member.department_id = v_ticket.department_id)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_contact.user_id, 'role', 'authenticated')::text, true);
  perform set_config('app.channel', 'whatsapp', true);

  if p_status is not null and p_status <> v_ticket.status then
    if v_ticket.status = 'closed' then
      return jsonb_build_object('ok', false, 'reason', 'closed', 'status', v_ticket.status);
    end if;
    if v_ticket.case_id is not null then
      begin
        v_result := public.case_ticket_status(v_ticket.id, p_status);
      exception when others then
        perform set_config('app.channel', '', true);
        return jsonb_build_object('ok', false, 'reason', 'case', 'status', v_ticket.status);
      end;
      select * into v_ticket from public.tickets where id = p_ticket_id;
    else
      update public.tickets
      set status = p_status,
          resolved_at = case when p_status in ('resolved', 'closed') then now() else null end
      where id = v_ticket.id;
    end if;
    insert into public.mention_notes (org_id, mention_id, body)
    values (v_ticket.org_id, v_ticket.mention_id, format('Cambió el turno a «%s» desde WhatsApp.', v_labels ->> p_status::text));
  end if;

  if nullif(btrim(p_note), '') is not null then
    insert into public.mention_notes (org_id, mention_id, body)
    values (v_ticket.org_id, v_ticket.mention_id, left(btrim(p_note), 2000));
  end if;

  perform set_config('app.channel', '', true);
  return jsonb_build_object('ok', true, 'status', coalesce(p_status, v_ticket.status), 'mention_id', v_ticket.mention_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Backfill: existing tickets → cases (one case per routed mention)
-- ---------------------------------------------------------------------------
-- Policy: a mention with tickets becomes one case (backfill_key
-- 'mention:<id>', so it runs once). Its lead ticket (is_primary, or the
-- oldest) names the responsible department; supporting tickets stay as the
-- case's support assignments. The case state comes from the lead ticket:
-- open → assigned, in_progress → in_progress, resolved → resolved, closed →
-- closed; dates from the tickets. Notes stay on the mention (the case shows
-- its mentions' notes). Mentions already in a case are left alone and
-- reported.

create function private.ticket_backfill_plan(p_org_id uuid)
returns table (
  mention_id uuid, lead_ticket_id uuid, department_id uuid, ticket_status public.ticket_status,
  tickets integer, departments integer, already_in_case boolean, created_at timestamptz,
  assigned_at timestamptz, due_at timestamptz, resolved_at timestamptz, created_by uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (t.mention_id)
    t.mention_id, t.id, t.department_id, t.status,
    (count(*) over (partition by t.mention_id))::integer,
    (count(*) over (partition by t.mention_id))::integer,
    exists (select 1 from public.case_mentions cm where cm.mention_id = t.mention_id),
    min(t.created_at) over (partition by t.mention_id),
    coalesce(t.assigned_at, t.created_at), t.due_at, t.resolved_at, t.created_by
  from public.tickets t
  where t.org_id = p_org_id and t.case_id is null
  order by t.mention_id, t.is_primary desc, t.created_at, t.id;
$$;

-- Dry run: what the backfill would do, without writing.
create function public.simulate_ticket_backfill(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (private.has_role(p_org_id, '{admin}') or private.is_service_role()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'tickets_total', (select count(*) from public.tickets where org_id = p_org_id),
      'tickets_in_cases', (select count(*) from public.tickets where org_id = p_org_id and case_id is not null),
      'tickets_to_link', coalesce(sum(p.tickets) filter (where not p.already_in_case), 0),
      'cases_to_create', count(*) filter (where not p.already_in_case),
      'cases_already_backfilled', (select count(*) from public.cases where org_id = p_org_id and backfill_key is not null),
      'mentions_with_several_departments', count(*) filter (where not p.already_in_case and p.departments > 1),
      'skipped_mentions_already_in_a_case', count(*) filter (where p.already_in_case),
      'skipped_tickets', coalesce(sum(p.tickets) filter (where p.already_in_case), 0),
      'by_status', coalesce((select jsonb_object_agg(s, n) from (
          select x.ticket_status::text as s, count(*) as n from private.ticket_backfill_plan(p_org_id) x
          where not x.already_in_case group by 1) y), '{}'::jsonb)
    )
    from private.ticket_backfill_plan(p_org_id) p
  );
end;
$$;

create function public.apply_ticket_backfill(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_plan record;
  v_case_id uuid;
  v_status public.case_status;
  v_title text;
  v_created integer := 0;
  v_linked integer := 0;
  v_n integer;
  v_tickets_before integer;
begin
  if not (private.has_role(p_org_id, '{admin}') or private.is_service_role()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- One backfill per org at a time.
  perform pg_advisory_xact_lock(hashtextextended('case_backfill:' || p_org_id::text, 0));
  v_before := public.simulate_ticket_backfill(p_org_id);
  select count(*) into v_tickets_before from public.tickets where org_id = p_org_id;

  for v_plan in select * from private.ticket_backfill_plan(p_org_id) where not already_in_case loop
    v_status := case v_plan.ticket_status when 'open' then 'assigned' when 'in_progress' then 'in_progress'
                  when 'resolved' then 'resolved' else 'closed' end;
    select left(coalesce(nullif(initcap(c.topic), '') || coalesce(' en ' || n.name, ''), regexp_replace(m.text, '\s+', ' ', 'g')), 200)
      into v_title
    from public.mentions m
    left join public.classifications c on c.mention_id = m.id
    left join public.neighborhoods n on n.id = c.neighborhood_id
    where m.id = v_plan.mention_id;

    insert into public.cases (org_id, number, title, description, category, neighborhood_id, priority, department_id, due_at,
                              status, primary_mention_id, opened_by, opened_at, assigned_at, accepted_at, resolved_at, closed_at, backfill_key)
    select p_org_id, private.next_case_number(p_org_id),
           case when char_length(v_title) >= 3 then v_title else 'Caso sin título' end,
           left(m.text, 4000), c.topic, c.neighborhood_id, coalesce(c.priority, 'medium'), v_plan.department_id, v_plan.due_at,
           v_status, m.id, v_plan.created_by, v_plan.created_at, v_plan.assigned_at,
           case when v_status in ('in_progress', 'resolved', 'closed') then v_plan.assigned_at end,
           case when v_status in ('resolved', 'closed') then v_plan.resolved_at end,
           case when v_status = 'closed' then v_plan.resolved_at end,
           'mention:' || m.id
    from public.mentions m
    left join public.classifications c on c.mention_id = m.id
    where m.id = v_plan.mention_id
    on conflict (org_id, backfill_key) do nothing
    returning id into v_case_id;
    continue when v_case_id is null;

    insert into public.case_mentions (org_id, case_id, mention_id, reason)
    values (p_org_id, v_case_id, v_plan.mention_id, 'Migración de turnos existentes');
    -- Linking does not change any ticket's status (no sync here).
    update public.tickets set case_id = v_case_id where org_id = p_org_id and mention_id = v_plan.mention_id and case_id is null;
    get diagnostics v_n = row_count;
    v_linked := v_linked + v_n;
    v_created := v_created + 1;
    perform private.log_case_event(p_org_id, v_case_id, 'backfill', null, v_status, 'Creado desde turnos existentes',
      jsonb_build_object('mention_id', v_plan.mention_id, 'tickets', v_n, 'lead_ticket_id', v_plan.lead_ticket_id,
                         'ticket_status', v_plan.ticket_status));
  end loop;

  return jsonb_build_object(
    'before', v_before,
    'cases_created', v_created,
    'tickets_linked', v_linked,
    'tickets_before', v_tickets_before,
    'tickets_after', (select count(*) from public.tickets where org_id = p_org_id),
    'tickets_in_cases_after', (select count(*) from public.tickets where org_id = p_org_id and case_id is not null),
    'after', public.simulate_ticket_backfill(p_org_id)
  );
end;
$$;

-- People of a case: the members of its responsible department (who can be
-- named responsible) plus the current responsible, by name only. For whoever
-- can read the case; never e-mails, never citizens.
create function public.case_people(p_case_id uuid)
returns table (user_id uuid, name text, is_responsible boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id,
         coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), split_part(u.email, '@', 1), ''),
         u.id is not distinct from c.responsible_user_id
  from public.cases c
  join public.memberships m on m.org_id = c.org_id
   and (m.user_id = c.responsible_user_id or (m.role = 'dependencia' and m.department_id = c.department_id))
  join auth.users u on u.id = m.user_id
  where c.id = p_case_id
    and (private.can_read_all(c.org_id) or private.case_visible_to_department(c.org_id, c.id))
  order by 3 desc, 2;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function private.case_actor() from public, anon, authenticated;
revoke execute on function private.log_case_event(uuid, uuid, text, public.case_status, public.case_status, text, jsonb, boolean) from public, anon, authenticated;
revoke execute on function private.next_case_number(uuid) from public, anon, authenticated;
revoke execute on function private.sync_case_tickets(public.cases) from public, anon, authenticated;
revoke execute on function private.apply_case_transition(uuid, public.case_status, text) from public, anon, authenticated;
revoke execute on function private.ticket_backfill_plan(uuid) from public, anon, authenticated;
revoke execute on function private.case_append_only() from public, anon, authenticated;
revoke execute on function private.guard_case_ticket() from public, anon, authenticated;

revoke execute on function public.create_case(uuid, uuid[], text, text, text, uuid, public.priority) from public, anon;
revoke execute on function public.case_add_mentions(uuid, uuid[], text) from public, anon;
revoke execute on function public.case_remove_mention(uuid, uuid, text) from public, anon;
revoke execute on function public.update_case(uuid, jsonb) from public, anon;
revoke execute on function public.transition_case(uuid, public.case_status, text, uuid, uuid[], timestamptz) from public, anon;
revoke execute on function public.case_ticket_status(uuid, public.ticket_status) from public, anon;
revoke execute on function public.add_case_note(uuid, text, text) from public, anon;
revoke execute on function public.merge_cases(uuid, uuid[], text) from public, anon;
revoke execute on function public.suggest_case_mentions(uuid, integer) from public, anon;
revoke execute on function public.case_people(uuid) from public, anon;
revoke execute on function public.simulate_ticket_backfill(uuid) from public, anon;
revoke execute on function public.apply_ticket_backfill(uuid) from public, anon;
grant execute on function public.create_case(uuid, uuid[], text, text, text, uuid, public.priority) to authenticated, service_role;
grant execute on function public.case_add_mentions(uuid, uuid[], text) to authenticated;
grant execute on function public.case_remove_mention(uuid, uuid, text) to authenticated;
grant execute on function public.update_case(uuid, jsonb) to authenticated;
grant execute on function public.transition_case(uuid, public.case_status, text, uuid, uuid[], timestamptz) to authenticated;
grant execute on function public.case_ticket_status(uuid, public.ticket_status) to authenticated;
grant execute on function public.add_case_note(uuid, text, text) to authenticated;
grant execute on function public.merge_cases(uuid, uuid[], text) to authenticated;
grant execute on function public.suggest_case_mentions(uuid, integer) to authenticated;
grant execute on function public.case_people(uuid) to authenticated;
grant execute on function public.simulate_ticket_backfill(uuid) to authenticated, service_role;
grant execute on function public.apply_ticket_backfill(uuid) to authenticated, service_role;
