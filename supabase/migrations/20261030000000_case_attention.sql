-- Stage 6: attention of a case, from assignment to validated closing.
--
-- Builds on the stage 4 workflow (states, history, tickets) without changing
-- its states. What is added:
--   * who performs each transition (coordination, the responsible department,
--     or validation), checked in the database. Coordination may register a
--     department step on its behalf only with a reason.
--   * closing only through validate_case (evidence checked, result written)
--     and reopening through reopen_case (new cycle, evidence of persistence);
--     transition_case can no longer close or reject a validation by itself.
--   * the assignment carries a responsible person, an acceptance deadline and
--     an attention commitment (assign_case).
--   * case_tasks: work for supporting areas, with a primary responsible (the
--     lead department) and per-area visibility.
--   * case_updates and case_evidence: progress with date, author and note;
--     files in the private bucket "case-evidence" under <org>/<case>/<id>.<ext>,
--     uploaded and read under RLS (no service role, no permanent URLs).
--   * case_validations: every validation decision, append-only.
--   * case_milestones: every state reached, per cycle, append-only; the case
--     columns keep showing the current cycle, nothing earlier is lost.
--   * Coordination = the existing roles admin and comunicación, through one
--     function (private.is_case_coordinator). No new role.
--
-- Additive: new columns are nullable or defaulted, new tables, replaced
-- functions keep their signatures. The milestone backfill is repeatable
-- (only cases without milestones). Rollback:
-- docs/rollback/20261030000000_case_attention.down.sql.

-- ---------------------------------------------------------------------------
-- Cases: assignment terms, coordinator, cycle, result
-- ---------------------------------------------------------------------------
alter table public.cases
  add column accept_due_at timestamptz,
  add column commitment text check (char_length(commitment) <= 1000),
  add column coordinator_user_id uuid references auth.users (id),
  add column cycle integer not null default 1 check (cycle > 0),
  add column result text check (char_length(result) <= 2000);

-- Who coordinates cases: admin and comunicación (existing roles). The single
-- place to change if a municipality later designates coordinators.
create function private.is_case_coordinator(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_role(p_org_id, '{admin,comunicacion}');
$$;

-- The caller belongs to the lead (primary responsible) department of the case.
create function private.is_case_lead(p_org_id uuid, p_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.cases c
    where c.id = p_case_id and c.org_id = p_org_id and c.department_id is not null
      and c.department_id = private.user_department(p_org_id)
  );
$$;

-- Who performs each allowed transition:
--   department    the responsible department (accept, start, request
--                 validation, return by competence);
--   validation    coordination, only through validate_case;
--   coordination  everything else (review, assign, discard, reopen).
create function public.case_transition_actor(p_from public.case_status, p_to public.case_status)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when not public.case_transition_allowed(p_from, p_to) then null
    when public.case_transition_by_department(p_from, p_to) then 'department'
    when p_from = 'resolved' and p_to in ('closed', 'in_progress') then 'validation'
    else 'coordination'
  end;
$$;

-- ---------------------------------------------------------------------------
-- Milestones: every state reached, per cycle (append-only)
-- ---------------------------------------------------------------------------
create table public.case_milestones (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  cycle integer not null check (cycle > 0),
  status public.case_status not null,
  from_status public.case_status,
  department_id uuid,
  at timestamptz not null default now(),
  actor_id uuid references auth.users (id),
  source text not null default 'live' check (source in ('live', 'backfill')),
  foreign key (org_id, case_id) references public.cases (org_id, id) on delete cascade
);
create index case_milestones_case_idx on public.case_milestones (case_id, cycle, at);

-- A reopening starts a new cycle; the result of the previous one stays in case_validations.
create function private.case_cycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('closed', 'discarded') and new.status = 'in_review' then
    new.cycle := old.cycle + 1;
    new.result := null;
  end if;
  return new;
end;
$$;
create trigger cases_cycle before update of status on public.cases
  for each row execute function private.case_cycle();

-- Security definer: also written when the service role or a definer RPC moves the case.
create function private.case_milestone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.case_milestones (org_id, case_id, cycle, status, from_status, department_id, actor_id)
    values (new.org_id, new.id, new.cycle, new.status, case when tg_op = 'UPDATE' then old.status end, new.department_id, (select auth.uid()));
  end if;
  return null;
end;
$$;
create trigger cases_milestone after insert or update of status on public.cases
  for each row execute function private.case_milestone();

-- ---------------------------------------------------------------------------
-- Tasks, updates, evidence, validations
-- ---------------------------------------------------------------------------
create type public.case_task_status as enum ('pending', 'in_progress', 'done', 'cancelled');

create table public.case_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  -- The area that does the work (the lead or a supporting department of the case).
  department_id uuid not null,
  responsible_user_id uuid references auth.users (id),
  title text not null check (char_length(title) between 3 and 200),
  detail text not null default '' check (char_length(detail) <= 2000),
  due_at timestamptz,
  status public.case_task_status not null default 'pending',
  status_note text check (char_length(status_note) <= 500),
  cycle integer not null,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  done_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (org_id, case_id) references public.cases (org_id, id) on delete cascade,
  foreign key (org_id, department_id) references public.departments (org_id, id)
);
create index case_tasks_case_idx on public.case_tasks (case_id, created_at);

create table public.case_updates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  cycle integer not null,
  -- progress: a step of the work; reopen: why the problem persists.
  kind text not null default 'progress' check (kind in ('progress', 'reopen')),
  -- areas: every department of the case and coordination;
  -- coordination: only the author's department (if any) and coordination.
  audience text not null check (audience in ('areas', 'coordination')),
  -- The author's department (null: coordination wrote it).
  department_id uuid,
  task_id uuid references public.case_tasks (id),
  author_id uuid references auth.users (id),
  author_name text not null default '',
  body text not null check (char_length(body) between 3 and 2000),
  created_at timestamptz not null default now(),
  foreign key (org_id, case_id) references public.cases (org_id, id) on delete cascade
);
create index case_updates_case_idx on public.case_updates (case_id, created_at);

create table public.case_evidence (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  update_id uuid not null references public.case_updates (id) on delete cascade,
  cycle integer not null,
  -- Copied from the update (immutable), so policies need no join.
  audience text not null check (audience in ('areas', 'coordination')),
  department_id uuid,
  path text not null unique check (path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|pdf)$'),
  mime text not null check (mime in ('image/jpeg', 'image/png', 'application/pdf')),
  size_bytes integer not null check (size_bytes between 1 and 3145728),
  uploaded_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  foreign key (org_id, case_id) references public.cases (org_id, id) on delete cascade,
  -- The file lives in the case's own folder.
  check (split_part(path, '/', 1) = org_id::text and split_part(path, '/', 2) = case_id::text)
);
create index case_evidence_case_idx on public.case_evidence (case_id, created_at);

create table public.case_validations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  cycle integer not null,
  decision text not null check (decision in ('approved', 'rejected')),
  note text not null check (char_length(note) between 3 and 2000),
  evidence_sufficient boolean not null,
  updates_count integer not null,
  evidence_count integer not null,
  validator_id uuid references auth.users (id),
  validator_name text not null default '',
  at timestamptz not null default now(),
  foreign key (org_id, case_id) references public.cases (org_id, id) on delete cascade
);
create index case_validations_case_idx on public.case_validations (case_id, at);

-- Append-only, also for the service role (tasks change only through their RPC).
create trigger case_milestones_append_only before update on public.case_milestones
  for each row execute function private.case_append_only();
create trigger case_updates_append_only before update on public.case_updates
  for each row execute function private.case_append_only();
create trigger case_evidence_append_only before update on public.case_evidence
  for each row execute function private.case_append_only();
create trigger case_validations_append_only before update on public.case_validations
  for each row execute function private.case_append_only();
revoke update, delete, truncate on public.case_milestones, public.case_updates, public.case_evidence, public.case_validations
  from authenticated, service_role;

alter table public.case_milestones enable row level security;
alter table public.case_tasks enable row level security;
alter table public.case_updates enable row level security;
alter table public.case_evidence enable row level security;
alter table public.case_validations enable row level security;

create policy "read case milestones" on public.case_milestones for select to authenticated
  using ((select private.can_read_all(org_id)) or private.case_visible_to_department(org_id, case_id));
-- A department sees its own tasks; the lead department sees every task of its case.
create policy "read case tasks" on public.case_tasks for select to authenticated
  using ((select private.can_read_all(org_id))
         or department_id = (select private.user_department(org_id))
         or private.is_case_lead(org_id, case_id));
create policy "read case updates" on public.case_updates for select to authenticated
  using ((select private.can_read_all(org_id))
         or (audience = 'areas' and private.case_visible_to_department(org_id, case_id))
         or (department_id is not null and department_id = (select private.user_department(org_id))));
create policy "read case evidence" on public.case_evidence for select to authenticated
  using ((select private.can_read_all(org_id))
         or (audience = 'areas' and private.case_visible_to_department(org_id, case_id))
         or (department_id is not null and department_id = (select private.user_department(org_id))));
create policy "read case validations" on public.case_validations for select to authenticated
  using ((select private.can_read_all(org_id)) or private.case_visible_to_department(org_id, case_id));

revoke all on public.case_milestones, public.case_tasks, public.case_updates, public.case_evidence, public.case_validations from anon;
revoke insert, update, delete on public.case_milestones, public.case_tasks, public.case_updates, public.case_evidence, public.case_validations
  from authenticated;

-- ---------------------------------------------------------------------------
-- Evidence bucket (private). Paths: <org_id>/<case_id>/<uuid>.<jpg|png|pdf>.
-- Size and type are capped by the bucket and checked again on the server
-- (magic bytes) and when the file is registered.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('case-evidence', 'case-evidence', false, 3145728, array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do nothing;

-- May the caller add evidence to the case of this path? Coordination on any
-- case that is not merged; a department on cases it works on, while open.
create function private.can_upload_case_evidence(p_path text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[] := regexp_match(p_path, '^([0-9a-f-]{36})/([0-9a-f-]{36})/[0-9a-f-]{36}\.(jpg|png|pdf)$');
  v_case public.cases;
begin
  if v_parts is null then
    return false;
  end if;
  select * into v_case from public.cases where id = v_parts[2]::uuid and org_id = v_parts[1]::uuid;
  if v_case.id is null or v_case.status = 'merged' then
    return false;
  end if;
  return private.is_case_coordinator(v_case.org_id)
      or (private.has_role(v_case.org_id, '{dependencia}')
          and v_case.status in ('assigned', 'accepted', 'in_progress', 'resolved')
          and private.case_visible_to_department(v_case.org_id, v_case.id));
end;
$$;

create function private.case_evidence_registered(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.case_evidence e where e.path = p_path);
$$;

create policy "upload case evidence" on storage.objects for insert to authenticated
  with check (bucket_id = 'case-evidence' and private.can_upload_case_evidence(name));
-- Registered files: whoever may read their row (RLS of case_evidence).
-- Unregistered: only the uploader, until it is registered or removed.
create policy "read case evidence files" on storage.objects for select to authenticated
  using (bucket_id = 'case-evidence' and (
    exists (select 1 from public.case_evidence e where e.path = objects.name)
    or (owner_id = (select auth.uid())::text and not private.case_evidence_registered(objects.name))));
-- An upload whose registration failed is removed by its uploader; registered files stay.
create policy "remove unregistered case evidence" on storage.objects for delete to authenticated
  using (bucket_id = 'case-evidence' and owner_id = (select auth.uid())::text and not private.case_evidence_registered(name));

-- ---------------------------------------------------------------------------
-- Workflow: who performs each transition
-- ---------------------------------------------------------------------------
create or replace function private.apply_case_transition(p_case_id uuid, p_to public.case_status, p_reason text)
returns public.cases
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.cases;
  v_coord boolean;
  v_dept boolean;
  v_actor text;
begin
  select * into v_case from public.cases where id = p_case_id for update;
  if v_case.id is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_coord := private.is_case_coordinator(v_case.org_id) or (select auth.uid()) is null;
  v_dept := v_case.department_id is not null and v_case.department_id = private.user_department(v_case.org_id)
            and private.has_role(v_case.org_id, '{dependencia}');
  v_actor := public.case_transition_actor(v_case.status, p_to);
  if not (v_coord or (v_dept and coalesce(v_actor = 'department', false))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_actor is null then
    raise exception 'Un caso % no puede pasar a %.', v_case.status, p_to using errcode = '22023';
  end if;
  if v_actor = 'validation' and coalesce(current_setting('app.case_validation', true), '') <> 'on' then
    raise exception 'Para cerrar o devolver un caso pendiente de validación, valídalo: revisa la evidencia y registra el resultado o el motivo.'
      using errcode = '22023';
  end if;
  if public.case_transition_needs_reason(v_case.status, p_to) and nullif(btrim(p_reason), '') is null then
    raise exception 'Este cambio requiere un motivo.' using errcode = '22023';
  end if;
  -- Coordination registering a department step: only on its behalf, with a reason.
  if v_actor = 'department' and not v_dept and (select auth.uid()) is not null and nullif(btrim(p_reason), '') is null then
    raise exception 'Este paso es de la dependencia: para registrarlo en su nombre escribe el motivo.' using errcode = '22023';
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

-- Same signature and behavior as stage 4, plus: a department step done by
-- coordination is marked as on its behalf, and a new lead department drops a
-- responsible person who is not one of its members.
create or replace function public.transition_case(
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
    if not private.is_case_coordinator(v_case.org_id) then
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
    if not public.case_transition_allowed(v_from, 'assigned') then
      raise exception 'Un caso % no puede pasar a %.', v_from, p_to using errcode = '22023';
    end if;
    v_changes := jsonb_build_object('department_id', jsonb_build_array(v_case.department_id, p_department_id),
                                    'support_ids', to_jsonb(coalesce(p_support_ids, '{}')));
    update public.cases c
    set department_id = p_department_id, due_at = coalesce(p_due_at, due_at), assigned_at = now(),
        responsible_user_id = case when exists (select 1 from public.memberships m
                                                where m.org_id = c.org_id and m.user_id = c.responsible_user_id
                                                  and m.role = 'dependencia' and m.department_id = p_department_id)
                                   then c.responsible_user_id end,
        coordinator_user_id = coalesce(c.coordinator_user_id, (select auth.uid()))
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

  if public.case_transition_actor(v_from, p_to) = 'department' and (select auth.uid()) is not null
     and v_case.department_id is distinct from private.user_department(v_case.org_id) then
    v_changes := v_changes || '{"on_behalf": true}';
  end if;

  v_case := private.apply_case_transition(p_case_id, p_to, p_reason);
  perform private.log_case_event(v_case.org_id, p_case_id, case when v_from in ('closed', 'discarded') and p_to = 'in_review' then 'reopened' else 'status' end,
    v_from, p_to, p_reason, v_changes);
  return jsonb_build_object('status', v_case.status, 'ticket_ids', to_jsonb(v_tickets));
end;
$$;

-- ---------------------------------------------------------------------------
-- Assignment with terms
-- ---------------------------------------------------------------------------
create function public.assign_case(
  p_case_id uuid,
  p_department_id uuid,
  p_due_at timestamptz,
  p_accept_due_at timestamptz,
  p_support_ids uuid[] default '{}',
  p_responsible_user_id uuid default null,
  p_commitment text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.cases;
  v_result jsonb;
begin
  select * into v_case from public.cases where id = p_case_id;
  if v_case.id is null or not private.is_case_coordinator(v_case.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_due_at is null or p_due_at <= now() then
    raise exception 'El compromiso de atención debe ser una fecha futura.' using errcode = '22023';
  end if;
  if p_accept_due_at is null or p_accept_due_at <= now() then
    raise exception 'El plazo de aceptación debe ser una fecha futura.' using errcode = '22023';
  end if;
  if p_accept_due_at > p_due_at then
    raise exception 'El plazo de aceptación debe terminar antes del compromiso de atención.' using errcode = '22023';
  end if;
  if p_responsible_user_id is not null and not exists (
    select 1 from public.memberships m
    where m.org_id = v_case.org_id and m.user_id = p_responsible_user_id and m.role = 'dependencia' and m.department_id = p_department_id) then
    raise exception 'La persona responsable debe ser de la dependencia asignada.' using errcode = '22023';
  end if;

  v_result := public.transition_case(p_case_id, 'assigned', p_reason, p_department_id, p_support_ids, p_due_at);

  update public.cases
  set accept_due_at = p_accept_due_at,
      commitment = nullif(btrim(p_commitment), ''),
      responsible_user_id = p_responsible_user_id
  where id = p_case_id;
  perform private.log_case_event(v_case.org_id, p_case_id, 'assignment_terms', null, null, null,
    jsonb_build_object('responsible_user_id', p_responsible_user_id, 'accept_due_at', p_accept_due_at,
                       'due_at', p_due_at, 'commitment', nullif(btrim(p_commitment), '')));
  return v_result;
end;
$$;

-- People who may be named responsible: members of departments. Coordination
-- sees every department's; a department only its own. Names only.
create function public.department_people(p_org_id uuid)
returns table (user_id uuid, name text, department_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id,
         coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), split_part(u.email, '@', 1), ''),
         m.department_id
  from public.memberships m
  join auth.users u on u.id = m.user_id
  where m.org_id = p_org_id and m.role = 'dependencia'
    and (private.is_case_coordinator(p_org_id) or m.department_id = private.user_department(p_org_id))
  order by 3, 2;
$$;

-- The areas working on a case (lead and support with an active assignment),
-- for whoever can read it: a department reads only its own tickets, but the
-- lead area needs to know the others to give them tasks. Ids only.
create function public.case_areas(p_case_id uuid)
returns table (department_id uuid, is_primary boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select t.department_id, bool_or(t.is_primary)
  from public.cases c
  join public.tickets t on t.case_id = c.id and t.status <> 'closed'
  where c.id = p_case_id
    and (private.can_read_all(c.org_id) or private.case_visible_to_department(c.org_id, c.id))
  group by t.department_id
  order by 2 desc, 1;
$$;

-- ---------------------------------------------------------------------------
-- Tasks for the areas of a case
-- ---------------------------------------------------------------------------
create function public.add_case_task(
  p_case_id uuid,
  p_department_id uuid,
  p_title text,
  p_detail text default '',
  p_due_at timestamptz default null,
  p_responsible_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.cases;
  v_id uuid;
begin
  select * into v_case from public.cases where id = p_case_id;
  if v_case.id is null or not (private.is_case_coordinator(v_case.org_id)
                               or (private.has_role(v_case.org_id, '{dependencia}') and private.is_case_lead(v_case.org_id, p_case_id))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_case.status not in ('assigned', 'accepted', 'in_progress') then
    raise exception 'Las tareas se agregan mientras el caso está asignado o en atención.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tickets t where t.case_id = p_case_id and t.department_id = p_department_id and t.status <> 'closed') then
    raise exception 'La dependencia de la tarea debe ser la responsable o una de apoyo del caso.' using errcode = '22023';
  end if;
  if p_responsible_user_id is not null and not exists (
    select 1 from public.memberships m
    where m.org_id = v_case.org_id and m.user_id = p_responsible_user_id and m.role = 'dependencia' and m.department_id = p_department_id) then
    raise exception 'La persona responsable debe ser de la dependencia de la tarea.' using errcode = '22023';
  end if;
  if p_due_at is not null and p_due_at <= now() then
    raise exception 'El plazo de la tarea debe ser una fecha futura.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) < 3 then
    raise exception 'Escribe la tarea.' using errcode = '22023';
  end if;

  insert into public.case_tasks (org_id, case_id, department_id, responsible_user_id, title, detail, due_at, cycle, created_by)
  values (v_case.org_id, p_case_id, p_department_id, p_responsible_user_id, btrim(p_title), coalesce(btrim(p_detail), ''), p_due_at,
          v_case.cycle, (select auth.uid()))
  returning id into v_id;
  -- Internal: each area sees its tasks in the task list, not other areas' in the history.
  perform private.log_case_event(v_case.org_id, p_case_id, 'task_added', null, null, null,
    jsonb_build_object('task_id', v_id, 'department_id', p_department_id, 'title', btrim(p_title)), true);
  update public.cases set updated_at = now() where id = p_case_id;
  return v_id;
end;
$$;

-- Task steps: pending → in_progress → done, by its area, the lead area or
-- coordination. Cancelling or reopening a done task: lead area or
-- coordination, with a note.
create function public.update_case_task(p_task_id uuid, p_status public.case_task_status, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.case_tasks;
  v_case public.cases;
  v_manager boolean;
  v_worker boolean;
begin
  select * into v_task from public.case_tasks where id = p_task_id for update;
  if v_task.id is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_case from public.cases where id = v_task.case_id;
  v_manager := private.is_case_coordinator(v_task.org_id)
               or (private.has_role(v_task.org_id, '{dependencia}') and private.is_case_lead(v_task.org_id, v_task.case_id));
  v_worker := v_manager or (private.has_role(v_task.org_id, '{dependencia}') and v_task.department_id = private.user_department(v_task.org_id));
  if not v_worker then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_case.status not in ('assigned', 'accepted', 'in_progress', 'resolved') then
    raise exception 'El caso no está en atención.' using errcode = '22023';
  end if;
  if not ((v_task.status, p_status) in (('pending', 'in_progress'), ('pending', 'done'), ('in_progress', 'done'),
                                        ('pending', 'cancelled'), ('in_progress', 'cancelled'), ('done', 'in_progress'))) then
    raise exception 'La tarea no puede pasar de % a %.', v_task.status, p_status using errcode = '22023';
  end if;
  if (p_status = 'cancelled' or v_task.status = 'done') and not v_manager then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if (p_status = 'cancelled' or v_task.status = 'done') and char_length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Escribe el motivo.' using errcode = '22023';
  end if;

  update public.case_tasks
  set status = p_status,
      status_note = nullif(btrim(p_note), ''),
      done_at = case when p_status = 'done' then now() else null end,
      updated_at = now()
  where id = p_task_id;
  perform private.log_case_event(v_task.org_id, v_task.case_id, 'task_status', null, null, p_note,
    jsonb_build_object('task_id', p_task_id, 'title', v_task.title, 'status', jsonb_build_array(v_task.status, p_status)), true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Progress updates and evidence
-- ---------------------------------------------------------------------------
-- Registers files already uploaded by the caller to the case's folder: their
-- size and type are read from Storage, not from the client.
create function private.add_case_update(
  p_case public.cases,
  p_body text,
  p_audience text,
  p_task_id uuid,
  p_paths text[],
  p_kind text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_dept uuid := private.user_department(p_case.org_id);
  v_path text;
  v_object storage.objects;
  v_mime text;
  v_size bigint;
begin
  if p_audience not in ('areas', 'coordination') then
    raise exception 'Audiencia inválida.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_body, ''))) < 3 then
    raise exception 'Describe el avance.' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_paths), 0) > 4 then
    raise exception 'Máximo 4 archivos por avance.' using errcode = '22023';
  end if;
  if p_task_id is not null and not exists (
    select 1 from public.case_tasks t where t.id = p_task_id and t.case_id = p_case.id
      and (v_dept is null or t.department_id = v_dept or private.is_case_lead(p_case.org_id, p_case.id))) then
    raise exception 'La tarea no es de este caso o de tu área.' using errcode = '22023';
  end if;

  insert into public.case_updates (org_id, case_id, cycle, kind, audience, department_id, task_id, author_id, author_name, body)
  select p_case.org_id, p_case.id, p_case.cycle, p_kind, p_audience, v_dept, p_task_id, a.actor_id, a.actor_name, btrim(p_body)
  from private.case_actor() a
  returning id into v_id;

  foreach v_path in array coalesce(p_paths, '{}') loop
    if split_part(v_path, '/', 1) <> p_case.org_id::text or split_part(v_path, '/', 2) <> p_case.id::text then
      raise exception 'El archivo no es de este caso.' using errcode = '22023';
    end if;
    select * into v_object from storage.objects o
    where o.bucket_id = 'case-evidence' and o.name = v_path and o.owner_id = (select auth.uid())::text;
    if v_object.id is null then
      raise exception 'No se encontró el archivo subido.' using errcode = '22023';
    end if;
    v_mime := v_object.metadata ->> 'mimetype';
    v_size := (v_object.metadata ->> 'size')::bigint;
    if v_mime not in ('image/jpeg', 'image/png', 'application/pdf') or v_size is null or v_size < 1 or v_size > 3145728 then
      raise exception 'Archivo no permitido: sólo JPG, PNG o PDF de hasta 3 MB.' using errcode = '22023';
    end if;
    insert into public.case_evidence (org_id, case_id, update_id, cycle, audience, department_id, path, mime, size_bytes, uploaded_by)
    values (p_case.org_id, p_case.id, v_id, p_case.cycle, p_audience, v_dept, v_path, v_mime, v_size, (select auth.uid()));
  end loop;

  perform private.log_case_event(p_case.org_id, p_case.id, case p_kind when 'reopen' then 'reopen_evidence' else 'update' end, null, null, null,
    jsonb_build_object('update_id', v_id, 'files', coalesce(cardinality(p_paths), 0), 'audience', p_audience),
    p_audience = 'coordination');
  update public.cases set updated_at = now() where id = p_case.id;
  return v_id;
end;
$$;

-- Coordination on any case not merged or discarded; a department on the
-- cases it works on, from assignment until validation.
create function public.add_case_update(
  p_case_id uuid,
  p_body text,
  p_audience text default 'areas',
  p_task_id uuid default null,
  p_paths text[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.cases;
begin
  select * into v_case from public.cases where id = p_case_id;
  if v_case.id is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if private.is_case_coordinator(v_case.org_id) then
    if v_case.status in ('merged', 'discarded', 'closed') then
      raise exception 'El caso está cerrado: para agregar evidencia, reábrelo.' using errcode = '22023';
    end if;
  elsif private.has_role(v_case.org_id, '{dependencia}') and private.case_visible_to_department(v_case.org_id, p_case_id) then
    if v_case.status not in ('assigned', 'accepted', 'in_progress', 'resolved') then
      raise exception 'El caso no está en atención.' using errcode = '22023';
    end if;
  else
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return private.add_case_update(v_case, p_body, p_audience, p_task_id, p_paths, 'progress');
end;
$$;

-- ---------------------------------------------------------------------------
-- Validation and reopening
-- ---------------------------------------------------------------------------
-- Coordination checks the evidence of the current cycle and either closes
-- with a result or returns the case to attention with a reason. Closing
-- needs at least one progress update in the cycle, no open tasks and the
-- explicit confirmation that the evidence is sufficient.
create function public.validate_case(p_case_id uuid, p_decision text, p_note text, p_evidence_sufficient boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.cases;
  v_updates integer;
  v_evidence integer;
begin
  select * into v_case from public.cases where id = p_case_id for update;
  if v_case.id is null or not private.is_case_coordinator(v_case.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_case.status <> 'resolved' then
    raise exception 'Sólo se valida un caso pendiente de validación.' using errcode = '22023';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decisión inválida.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception '%', case p_decision when 'approved' then 'Escribe el resultado de la atención.' else 'Escribe el motivo de la devolución.' end
      using errcode = '22023';
  end if;
  select count(*) into v_updates from public.case_updates where case_id = p_case_id and cycle = v_case.cycle;
  select count(*) into v_evidence from public.case_evidence where case_id = p_case_id and cycle = v_case.cycle;
  if p_decision = 'approved' then
    if not coalesce(p_evidence_sufficient, false) then
      raise exception 'Confirma que la evidencia es suficiente para cerrar.' using errcode = '22023';
    end if;
    if v_updates = 0 then
      raise exception 'No hay avances ni evidencias en este ciclo: pide evidencia o devuelve el caso.' using errcode = '22023';
    end if;
    if exists (select 1 from public.case_tasks t where t.case_id = p_case_id and t.status in ('pending', 'in_progress')) then
      raise exception 'Hay tareas abiertas: deben terminarse o cancelarse antes de cerrar.' using errcode = '22023';
    end if;
  end if;

  perform set_config('app.case_validation', 'on', true);
  perform public.transition_case(p_case_id, case p_decision when 'approved' then 'closed' else 'in_progress' end::public.case_status, btrim(p_note));
  perform set_config('app.case_validation', '', true);
  if p_decision = 'approved' then
    update public.cases set result = btrim(p_note) where id = p_case_id;
  end if;
  insert into public.case_validations (org_id, case_id, cycle, decision, note, evidence_sufficient, updates_count, evidence_count, validator_id, validator_name)
  select v_case.org_id, p_case_id, v_case.cycle, p_decision, btrim(p_note), coalesce(p_evidence_sufficient, false), v_updates, v_evidence, a.actor_id, a.actor_name
  from private.case_actor() a;
  return jsonb_build_object('status', case p_decision when 'approved' then 'closed' else 'in_progress' end, 'cycle', v_case.cycle);
end;
$$;

-- Coordination reopens a closed case when the problem persists: a new cycle
-- starts (earlier milestones, updates, evidence and validations stay) and the
-- reason, with its evidence, is the first update of the new cycle.
create function public.reopen_case(p_case_id uuid, p_reason text, p_paths text[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.cases;
begin
  select * into v_case from public.cases where id = p_case_id;
  if v_case.id is null or not private.is_case_coordinator(v_case.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_case.status <> 'closed' then
    raise exception 'Sólo se reabre un caso cerrado.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Escribe por qué el problema persiste.' using errcode = '22023';
  end if;
  perform public.transition_case(p_case_id, 'in_review', btrim(p_reason));
  select * into v_case from public.cases where id = p_case_id;
  perform private.add_case_update(v_case, p_reason, 'areas', null, p_paths, 'reopen');
  return jsonb_build_object('status', v_case.status, 'cycle', v_case.cycle);
end;
$$;

-- ---------------------------------------------------------------------------
-- Times per cycle (from the milestones; RLS of the milestones applies)
-- ---------------------------------------------------------------------------
create view public.case_cycle_times with (security_invoker = true) as
select
  m.org_id, m.case_id, m.cycle,
  min(m.at) as started_at,
  min(m.at) filter (where m.status = 'assigned') as first_assigned_at,
  max(m.at) filter (where m.status = 'assigned') as last_assigned_at,
  min(m.at) filter (where m.status = 'accepted') as accepted_at,
  min(m.at) filter (where m.status = 'in_progress' and m.from_status = 'accepted') as attention_started_at,
  min(m.at) filter (where m.status = 'resolved') as validation_requested_at,
  max(m.at) filter (where m.status = 'closed') as closed_at,
  count(*) filter (where m.status = 'returned')::integer as returns,
  count(*) filter (where m.status = 'in_progress' and m.from_status = 'resolved')::integer as validation_rejections
from public.case_milestones m
group by m.org_id, m.case_id, m.cycle;

-- ---------------------------------------------------------------------------
-- Inbox: an assigned case is due by its acceptance deadline
-- ---------------------------------------------------------------------------
create or replace function public.inbox_items(p_org_id uuid, p_filters jsonb default '{}')
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
    select k.id, k.status, k.priority, k.department_id, k.opened_at,
           -- Assigned: the acceptance deadline comes first; then the attention commitment.
           case when k.status = 'assigned' then least(k.accept_due_at, k.due_at)
                when k.status in ('accepted', 'in_progress') then k.due_at end as due_at
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
    ci.due_at,
    ci.opened_at,
    ci.status = 'new',
    ci.priority in ('critical', 'high') and ci.status <> 'resolved',
    ci.status in ('new', 'in_review', 'returned'),
    ci.status = 'assigned',
    ci.due_at < now(),
    ci.status = 'resolved'
  from case_items ci;
$$;

-- ---------------------------------------------------------------------------
-- Backfill (repeatable: only cases without milestones)
-- ---------------------------------------------------------------------------
-- Milestones from the history; a case created by the stage 4 ticket backfill
-- gets its original dates (the case columns written before that event).
-- The cycle is one plus the reopenings before each step.
insert into public.case_milestones (org_id, case_id, cycle, status, from_status, department_id, at, actor_id, source)
select x.org_id, x.case_id, x.cycle, x.status, x.from_status, null, x.at, x.actor_id, 'backfill'
from (
  select e.org_id, e.case_id, e.to_status as status, e.from_status, e.at, e.actor_id,
         1 + count(*) filter (where e.operation = 'reopened') over (partition by e.case_id order by e.at, e.id) as cycle
  from public.case_events e
  where e.to_status is not null and e.operation <> 'backfill'
  union all
  select c.org_id, c.id, s.status, null, s.at, null, 1
  from public.case_events e
  join public.cases c on c.id = e.case_id
  cross join lateral (values
    ('new'::public.case_status, c.opened_at), ('assigned', c.assigned_at), ('accepted', c.accepted_at),
    ('resolved', c.resolved_at), ('closed', c.closed_at)) s (status, at)
  where e.operation = 'backfill' and s.at is not null and s.at <= e.at
) x
where not exists (select 1 from public.case_milestones m where m.case_id = x.case_id);

update public.cases c
set cycle = 1 + (select count(*) from public.case_events e where e.case_id = c.id and e.operation = 'reopened')
where c.cycle <> 1 + (select count(*) from public.case_events e where e.case_id = c.id and e.operation = 'reopened');

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function private.is_case_coordinator(uuid) from public, anon;
revoke execute on function private.is_case_lead(uuid, uuid) from public, anon;
revoke execute on function private.can_upload_case_evidence(text) from public, anon;
revoke execute on function private.case_evidence_registered(text) from public, anon;
-- Called by RLS policies, as the querying user.
grant execute on function private.is_case_coordinator(uuid) to authenticated;
grant execute on function private.is_case_lead(uuid, uuid) to authenticated;
grant execute on function private.can_upload_case_evidence(text) to authenticated;
grant execute on function private.case_evidence_registered(text) to authenticated;
revoke execute on function private.case_cycle() from public, anon, authenticated;
revoke execute on function private.case_milestone() from public, anon, authenticated;
revoke execute on function private.add_case_update(public.cases, text, text, uuid, text[], text) from public, anon, authenticated;

revoke execute on function public.assign_case(uuid, uuid, timestamptz, timestamptz, uuid[], uuid, text, text) from public, anon;
revoke execute on function public.department_people(uuid) from public, anon;
revoke execute on function public.case_areas(uuid) from public, anon;
revoke execute on function public.add_case_task(uuid, uuid, text, text, timestamptz, uuid) from public, anon;
revoke execute on function public.update_case_task(uuid, public.case_task_status, text) from public, anon;
revoke execute on function public.add_case_update(uuid, text, text, uuid, text[]) from public, anon;
revoke execute on function public.validate_case(uuid, text, text, boolean) from public, anon;
revoke execute on function public.reopen_case(uuid, text, text[]) from public, anon;
grant execute on function public.assign_case(uuid, uuid, timestamptz, timestamptz, uuid[], uuid, text, text) to authenticated;
grant execute on function public.department_people(uuid) to authenticated;
grant execute on function public.case_areas(uuid) to authenticated;
grant execute on function public.add_case_task(uuid, uuid, text, text, timestamptz, uuid) to authenticated;
grant execute on function public.update_case_task(uuid, public.case_task_status, text) to authenticated;
grant execute on function public.add_case_update(uuid, text, text, uuid, text[]) to authenticated;
grant execute on function public.validate_case(uuid, text, text, boolean) to authenticated;
grant execute on function public.reopen_case(uuid, text, text[]) to authenticated;

revoke all on public.case_cycle_times from anon;
grant select on public.case_cycle_times to authenticated;
