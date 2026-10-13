-- Stage 7: SLA with a calendar, escalation levels, a durable outbox and
-- report jobs.
--
--   * SLA: per org, wall-clock ("corridas") or business hours ("hábiles")
--     with work days, a work window, non-working days, always in
--     America/Mexico_City. Acceptance and attention targets by category
--     (topic) and priority. Every saved configuration is a version; a version
--     is a reference value until an admin approves it as the operational
--     agreement. A case records the version (and terms) it was assigned with.
--   * Escalation: reminder before the deadline, then the department's link
--     (enlace), its head (titular) and the coordinator, by delay. Recipients
--     are members resolved from verified configuration (never free text).
--     Each step is a notification_events row: reason, deadline, recipient
--     and result. Kinds: reminder, escalation, emergency.
--   * Outbox: every alert, report and escalation message is a row with an
--     idempotency key, state, lease, retries with backoff and one row per
--     attempt, keeping the provider id. Email carries the key to the
--     provider (Idempotency-Key), so a retry after an accepted send that was
--     not recorded does not deliver twice; WhatsApp has no such key, so an
--     attempt with an unknown outcome is left "uncertain" for a person.
--     Channel preferences, quiet hours and a per-recipient hourly limit
--     defer normal messages; critical ones are never deferred.
--   * Report jobs: one per org, kind and period (unique), advanced stage by
--     stage under a lease (draft → approval → PDF → send → done); a report
--     is marked sent only when its emails were accepted.
--
-- Additive. Seeds are repeatable. Rollback: docs/rollback/20261031000000_sla_outbox.down.sql.

-- ---------------------------------------------------------------------------
-- SLA configuration
-- ---------------------------------------------------------------------------
create table public.sla_calendars (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  -- calendar: hours run around the clock; business: only inside the work window.
  mode text not null default 'calendar' check (mode in ('calendar', 'business')),
  -- ISO days of the week (1 = Monday … 7 = Sunday).
  workdays smallint[] not null default '{1,2,3,4,5}'
    check (cardinality(workdays) between 1 and 7 and workdays <@ '{1,2,3,4,5,6,7}'::smallint[]),
  day_start time not null default '09:00',
  day_end time not null default '17:00',
  time_zone text not null default 'America/Mexico_City' check (time_zone = 'America/Mexico_City'),
  updated_at timestamptz not null default now(),
  check (day_end > day_start)
);

create table public.sla_holidays (
  org_id uuid not null references public.organizations (id) on delete cascade,
  day date not null,
  name text not null check (char_length(name) between 2 and 80),
  primary key (org_id, day)
);

create table public.sla_targets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- A topic of the taxonomy; null: any category.
  category text check (char_length(category) <= 80),
  priority public.priority not null,
  accept_hours numeric(6, 2) not null check (accept_hours > 0 and accept_hours <= 720),
  attention_hours numeric(7, 2) not null check (attention_hours > 0 and attention_hours <= 2160),
  check (accept_hours <= attention_hours),
  unique nulls not distinct (org_id, category, priority)
);

-- Every saved configuration, as it was. Not approved: reference values.
create table public.sla_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  approved boolean not null default false,
  approved_at timestamptz,
  approved_by uuid references auth.users (id),
  approval_note text check (char_length(approval_note) <= 500),
  unique (org_id, version),
  unique (org_id, id),
  check (approved = (approved_at is not null))
);

alter table public.cases
  add column sla_version_id uuid,
  -- The terms the assignment was computed with (hours, mode, approved, deadlines, override).
  add column sla_terms jsonb,
  add constraint cases_sla_version_fk foreign key (org_id, sla_version_id) references public.sla_versions (org_id, id);

alter table public.sla_calendars enable row level security;
alter table public.sla_holidays enable row level security;
alter table public.sla_targets enable row level security;
alter table public.sla_versions enable row level security;
create policy "members read sla calendars" on public.sla_calendars for select to authenticated using ((select private.is_member(org_id)));
create policy "members read sla holidays" on public.sla_holidays for select to authenticated using ((select private.is_member(org_id)));
create policy "members read sla targets" on public.sla_targets for select to authenticated using ((select private.is_member(org_id)));
create policy "members read sla versions" on public.sla_versions for select to authenticated using ((select private.is_member(org_id)));
-- Written only through save_sla_config / approve_sla_version (one version per save).
revoke all on public.sla_calendars, public.sla_holidays, public.sla_targets, public.sla_versions from anon;
revoke insert, update, delete, truncate on public.sla_calendars, public.sla_holidays, public.sla_targets, public.sla_versions from authenticated;

create function private.sla_snapshot(p_org_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'calendar', (select jsonb_build_object('mode', c.mode, 'workdays', c.workdays, 'day_start', c.day_start, 'day_end', c.day_end,
                                           'time_zone', c.time_zone)
                 from public.sla_calendars c where c.org_id = p_org_id),
    'holidays', coalesce((select jsonb_agg(jsonb_build_object('day', h.day, 'name', h.name) order by h.day)
                          from public.sla_holidays h where h.org_id = p_org_id), '[]'),
    'targets', coalesce((select jsonb_agg(jsonb_build_object('category', t.category, 'priority', t.priority,
                                                             'accept_hours', t.accept_hours, 'attention_hours', t.attention_hours)
                                          order by t.category nulls first, t.priority)
                         from public.sla_targets t where t.org_id = p_org_id), '[]'));
$$;

-- Starting values (repeatable): wall-clock hours, the org's existing
-- attention hours per priority and acceptance windows that fit inside them.
-- Version 1 is a reference, not an approved agreement.
create function private.seed_sla_config(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.sla_calendars (org_id) values (p_org_id) on conflict do nothing;
  insert into public.sla_targets (org_id, category, priority, accept_hours, attention_hours)
  select p_org_id, null, d.priority,
         least(case d.priority when 'critical' then 1 when 'high' then 4 when 'medium' then 8 else 24 end, coalesce(s.hours, d.hours)),
         coalesce(s.hours, d.hours)
  from (values ('critical'::public.priority, 12), ('high', 24), ('medium', 72), ('low', 168)) d (priority, hours)
  left join public.sla_policies s on s.org_id = p_org_id and s.priority = d.priority
  on conflict do nothing;
  if not exists (select 1 from public.sla_versions v where v.org_id = p_org_id) then
    insert into public.sla_versions (org_id, version, snapshot) values (p_org_id, 1, private.sla_snapshot(p_org_id));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- SLA computation (America/Mexico_City)
-- ---------------------------------------------------------------------------
-- p_start + p_hours of SLA time. Wall-clock mode: plain hours. Business mode:
-- only minutes inside the work window of work days that are not non-working
-- days count; a start outside the window begins at the next opening.
create function public.sla_deadline(p_org_id uuid, p_start timestamptz, p_hours numeric)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cal public.sla_calendars;
  v_local timestamp;
  v_day date;
  v_open timestamp;
  v_close timestamp;
  v_from timestamp;
  v_left interval;
  v_avail interval;
  v_guard integer := 0;
begin
  if p_start is null or p_hours is null then
    return null;
  end if;
  select * into v_cal from public.sla_calendars where org_id = p_org_id;
  if v_cal.org_id is null or v_cal.mode = 'calendar' or p_hours <= 0 then
    return p_start + make_interval(secs => p_hours * 3600);
  end if;
  v_local := p_start at time zone v_cal.time_zone;
  v_left := make_interval(secs => p_hours * 3600);
  v_day := v_local::date;
  loop
    v_guard := v_guard + 1;
    if v_guard > 3660 then
      raise exception 'SLA: no hay días hábiles suficientes en el calendario.' using errcode = '22023';
    end if;
    if extract(isodow from v_day)::smallint = any (v_cal.workdays)
       and not exists (select 1 from public.sla_holidays h where h.org_id = p_org_id and h.day = v_day) then
      v_open := v_day + v_cal.day_start;
      v_close := v_day + v_cal.day_end;
      v_from := greatest(v_local, v_open);
      if v_from < v_close then
        v_avail := v_close - v_from;
        if v_avail >= v_left then
          return (v_from + v_left) at time zone v_cal.time_zone;
        end if;
        v_left := v_left - v_avail;
      end if;
    end if;
    v_day := v_day + 1;
  end loop;
end;
$$;

-- The target for a category and priority (the category's own, else the default).
create function private.sla_target(p_org_id uuid, p_category text, p_priority public.priority)
returns public.sla_targets
language sql
stable
security definer
set search_path = ''
as $$
  select t.* from public.sla_targets t
  where t.org_id = p_org_id and t.priority = p_priority and (t.category is null or t.category = p_category)
  order by t.category is null
  limit 1;
$$;

-- Deadlines a case would get if assigned at p_start, with the current version.
create function public.sla_terms(p_org_id uuid, p_category text, p_priority public.priority, p_start timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_target public.sla_targets;
  v_version public.sla_versions;
  v_mode text;
begin
  if not (private.is_member(p_org_id) or private.is_service_role()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_target := private.sla_target(p_org_id, p_category, p_priority);
  select * into v_version from public.sla_versions where org_id = p_org_id order by version desc limit 1;
  select mode into v_mode from public.sla_calendars where org_id = p_org_id;
  if v_target.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'version_id', v_version.id, 'version', v_version.version, 'approved', coalesce(v_version.approved, false),
    'mode', coalesce(v_mode, 'calendar'), 'category', v_target.category, 'priority', p_priority,
    'accept_hours', v_target.accept_hours, 'attention_hours', v_target.attention_hours,
    'accept_due_at', public.sla_deadline(p_org_id, p_start, v_target.accept_hours),
    'due_at', public.sla_deadline(p_org_id, p_start, v_target.attention_hours));
end;
$$;

-- Saves the whole configuration and records it as a new (unapproved) version.
-- p_calendar: {mode, workdays, day_start, day_end}; p_holidays: [{day, name}];
-- p_targets: [{category|null, priority, accept_hours, attention_hours}] (the
-- four default priorities are required).
create function public.save_sla_config(p_org_id uuid, p_calendar jsonb, p_holidays jsonb, p_targets jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version integer;
  v_id uuid;
begin
  if not private.has_role(p_org_id, '{admin}') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if (select count(distinct t ->> 'priority') from jsonb_array_elements(coalesce(p_targets, '[]')) t
      where nullif(t ->> 'category', '') is null) <> 4 then
    raise exception 'Define los plazos generales de las cuatro prioridades.' using errcode = '22023';
  end if;

  insert into public.sla_calendars (org_id, mode, workdays, day_start, day_end, updated_at)
  values (p_org_id, p_calendar ->> 'mode',
          array(select jsonb_array_elements_text(p_calendar -> 'workdays')::smallint),
          (p_calendar ->> 'day_start')::time, (p_calendar ->> 'day_end')::time, now())
  on conflict (org_id) do update
    set mode = excluded.mode, workdays = excluded.workdays, day_start = excluded.day_start, day_end = excluded.day_end, updated_at = now();

  delete from public.sla_holidays where org_id = p_org_id;
  insert into public.sla_holidays (org_id, day, name)
  select p_org_id, (h ->> 'day')::date, btrim(h ->> 'name') from jsonb_array_elements(coalesce(p_holidays, '[]')) h
  on conflict (org_id, day) do update set name = excluded.name;

  delete from public.sla_targets where org_id = p_org_id;
  insert into public.sla_targets (org_id, category, priority, accept_hours, attention_hours)
  select p_org_id, nullif(btrim(t ->> 'category'), ''), (t ->> 'priority')::public.priority,
         (t ->> 'accept_hours')::numeric, (t ->> 'attention_hours')::numeric
  from jsonb_array_elements(p_targets) t;

  -- The inbox's routing defaults (sla_policies) follow the general attention hours.
  insert into public.sla_policies (org_id, priority, hours, updated_at)
  select p_org_id, t.priority, greatest(1, least(2160, round(t.attention_hours)))::integer, now()
  from public.sla_targets t where t.org_id = p_org_id and t.category is null
  on conflict (org_id, priority) do update set hours = excluded.hours, updated_at = now();

  select coalesce(max(version), 0) + 1 into v_version from public.sla_versions where org_id = p_org_id;
  insert into public.sla_versions (org_id, version, snapshot, created_by)
  values (p_org_id, v_version, private.sla_snapshot(p_org_id), (select auth.uid()))
  returning id into v_id;
  return jsonb_build_object('version_id', v_id, 'version', v_version);
end;
$$;

-- An admin records that the current version is the agreed operational SLA.
create function public.approve_sla_version(p_version_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.sla_versions;
begin
  select * into v_version from public.sla_versions where id = p_version_id for update;
  if v_version.id is null or not private.has_role(v_version.org_id, '{admin}') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_version.version <> (select max(version) from public.sla_versions where org_id = v_version.org_id) then
    raise exception 'Sólo se aprueba la versión vigente.' using errcode = '22023';
  end if;
  if v_version.approved then
    raise exception 'Esta versión ya está aprobada.' using errcode = '22023';
  end if;
  update public.sla_versions
  set approved = true, approved_at = now(), approved_by = (select auth.uid()), approval_note = nullif(btrim(p_note), '')
  where id = p_version_id;
end;
$$;

create trigger audit_sla_versions after insert or update on public.sla_versions
  for each row execute function private.audit_row();

-- ---------------------------------------------------------------------------
-- Escalation: who is notified, when, through which channels
-- ---------------------------------------------------------------------------
-- The department's head (titular). The link (enlace) is the existing
-- departments.responsible_user_id; the coordinator is cases.coordinator_user_id.
alter table public.departments add column head_user_id uuid references auth.users (id) on delete set null;

create function private.check_department_head()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.head_user_id is not null and not exists (
    select 1 from public.memberships m
    where m.org_id = new.org_id and m.user_id = new.head_user_id
      and (m.role in ('admin', 'comunicacion') or (m.role = 'dependencia' and m.department_id = new.id))
  ) then
    raise exception 'the head must belong to the department or be admin/comunicacion' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger departments_check_head
  before insert or update of head_user_id on public.departments
  for each row execute function private.check_department_head();

create function private.release_department_head()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.departments d
  set head_user_id = null
  where d.org_id = old.org_id and d.head_user_id = old.user_id
    and (tg_op = 'DELETE'
         or not (new.role in ('admin', 'comunicacion') or (new.role = 'dependencia' and new.department_id = d.id)));
  return null;
end;
$$;
create trigger memberships_release_department_head
  after update of role, department_id or delete on public.memberships
  for each row execute function private.release_department_head();

-- Admin names the link (enlace) and head (titular) of a department.
create function public.set_department_contacts(p_department_id uuid, p_link_user_id uuid, p_head_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.departments where id = p_department_id;
  if v_org is null or not private.has_role(v_org, '{admin}') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.departments set responsible_user_id = p_link_user_id, head_user_id = p_head_user_id where id = p_department_id;
exception when check_violation then
  raise exception 'La persona debe ser de la dependencia (o de Administración o Comunicación).' using errcode = '22023';
end;
$$;

-- Per org: when each level fires, quiet hours and the hourly limit.
create table public.notification_settings (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  -- Reminder to the link at this share of the window (acceptance or attention).
  reminder_percent integer not null default 75 check (reminder_percent between 10 and 95),
  -- SLA hours after the deadline for each escalation level.
  link_after_hours numeric(6, 2) not null default 0 check (link_after_hours >= 0),
  head_after_hours numeric(6, 2) not null default 4,
  coordinator_after_hours numeric(6, 2) not null default 24,
  -- Mexico City hours; normal messages wait until quiet_end. Equal values: no quiet hours.
  quiet_start smallint not null default 22 check (quiet_start between 0 and 23),
  quiet_end smallint not null default 7 check (quiet_end between 0 and 23),
  -- Normal messages per recipient and channel per hour; the rest wait.
  max_per_hour integer not null default 6 check (max_per_hour between 1 and 100),
  -- Case notices by WhatsApp need the sigma_caso_aviso template approved by
  -- Meta: off until an admin turns it on (email works meanwhile).
  whatsapp_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) default auth.uid(),
  check (link_after_hours <= head_after_hours and head_after_hours <= coordinator_after_hours),
  -- For the audit log.
  id uuid not null unique default gen_random_uuid()
);
alter table public.notification_settings enable row level security;
create policy "readers read notification settings" on public.notification_settings
  for select to authenticated using ((select private.can_read_all(org_id)));
create policy "admins write notification settings" on public.notification_settings
  for update to authenticated using ((select private.has_role(org_id, '{admin}'))) with check ((select private.has_role(org_id, '{admin}')));
revoke all on public.notification_settings from anon;
revoke insert, delete, truncate on public.notification_settings from authenticated;
create trigger audit_notification_settings after update on public.notification_settings
  for each row execute function private.audit_row();

-- Each person's channels and quiet hours (null: the org's).
create table public.notification_preferences (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  email boolean not null default true,
  whatsapp boolean not null default true,
  quiet_start smallint check (quiet_start between 0 and 23),
  quiet_end smallint check (quiet_end between 0 and 23),
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id),
  check ((quiet_start is null) = (quiet_end is null))
);
alter table public.notification_preferences enable row level security;
create policy "people read their preferences" on public.notification_preferences
  for select to authenticated using (user_id = (select auth.uid()) or (select private.has_role(org_id, '{admin}')));
create policy "people write their preferences" on public.notification_preferences
  for insert to authenticated with check (user_id = (select auth.uid()) and (select private.is_member(org_id)));
create policy "people update their preferences" on public.notification_preferences
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and (select private.is_member(org_id)));
revoke all on public.notification_preferences from anon;

-- One row per notification decision: what, why, for which deadline, to whom
-- and the result of routing it (the deliveries are in the outbox).
create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('reminder', 'escalation', 'emergency', 'alert', 'report')),
  -- reminder/link: the department's link; head: its head; coordinator: the case's coordinator.
  level text check (level in ('link', 'head', 'coordinator')),
  case_id uuid,
  phase text check (phase in ('acceptance', 'attention')),
  cycle integer,
  deadline timestamptz,
  reason text not null check (char_length(reason) between 3 and 500),
  recipient_user_id uuid references auth.users (id) on delete set null,
  -- queued: messages in the outbox; no_recipient: nobody configured for the
  -- level; no_channel: the person has no active channel.
  result text not null check (result in ('queued', 'no_recipient', 'no_channel')),
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  foreign key (org_id, case_id) references public.cases (org_id, id) on delete cascade
);
create index notification_events_org_idx on public.notification_events (org_id, created_at desc);
create index notification_events_case_idx on public.notification_events (case_id, created_at) where case_id is not null;
alter table public.notification_events enable row level security;
create policy "readers and recipients read notification events" on public.notification_events
  for select to authenticated using ((select private.can_read_all(org_id)) or recipient_user_id = (select auth.uid()));
revoke all on public.notification_events from anon;
revoke insert, update, delete, truncate on public.notification_events from authenticated;
create trigger notification_events_append_only before update on public.notification_events
  for each row execute function private.case_append_only();

-- ---------------------------------------------------------------------------
-- Outbox
-- ---------------------------------------------------------------------------
create table public.outbox (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- The logical delivery: one key, one message, whatever the retries.
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 200),
  kind text not null check (kind in ('reminder', 'escalation', 'emergency', 'alert', 'report')),
  urgency text not null default 'normal' check (urgency in ('normal', 'critical')),
  channel text not null check (channel in ('email', 'whatsapp')),
  recipient_user_id uuid references auth.users (id) on delete set null,
  -- E-mail or WhatsApp number, resolved from verified configuration when queued.
  address text not null check (char_length(address) between 5 and 320),
  event_id uuid references public.notification_events (id) on delete set null,
  alert_event_id uuid references public.alert_events (id) on delete set null,
  report_id uuid references public.reports (id) on delete set null,
  payload jsonb not null default '{}',
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'dead', 'uncertain', 'cancelled')),
  attempts integer not null default 0,
  max_attempts integer not null default 6 check (max_attempts between 1 and 20),
  next_attempt_at timestamptz not null default now(),
  -- Why a normal message is waiting (quiet hours, hourly limit, channel off).
  deferred_reason text,
  lease_owner text,
  lease_expires_at timestamptz,
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'sending') = (lease_owner is not null))
);
create index outbox_due_idx on public.outbox (urgency desc, next_attempt_at) where status in ('pending', 'sending');
create index outbox_org_idx on public.outbox (org_id, created_at desc);
create index outbox_rate_idx on public.outbox (address, channel, sent_at) where status = 'sent';

create table public.outbox_attempts (
  id bigint generated always as identity primary key,
  outbox_id uuid not null references public.outbox (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  attempt integer not null,
  worker text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  -- sent, retry (will be tried again), dead (no more tries), uncertain
  -- (the worker vanished mid-send on a channel without idempotency), lost
  -- (the worker vanished; the provider de-duplicates, so it is retried).
  result text check (result in ('sent', 'retry', 'dead', 'uncertain', 'lost')),
  provider_message_id text,
  error text,
  unique (outbox_id, attempt)
);
alter table public.outbox enable row level security;
alter table public.outbox_attempts enable row level security;
-- Addresses of officials: admin only.
create policy "admins read outbox" on public.outbox for select to authenticated using ((select private.has_role(org_id, '{admin}')));
create policy "admins read outbox attempts" on public.outbox_attempts for select to authenticated using ((select private.has_role(org_id, '{admin}')));
revoke all on public.outbox, public.outbox_attempts from anon;
revoke insert, update, delete, truncate on public.outbox, public.outbox_attempts from authenticated;
revoke update, delete, truncate on public.outbox_attempts from service_role;
create trigger outbox_attempts_append_only before update on public.outbox_attempts
  for each row when (old.finished_at is not null)
  execute function private.case_append_only();

-- Queues one message (server only). Returns its id; an existing key returns
-- the existing message, never a second one.
create function public.enqueue_outbox(
  p_org_id uuid,
  p_key text,
  p_kind text,
  p_channel text,
  p_address text,
  p_payload jsonb,
  p_urgency text default 'normal',
  p_recipient_user_id uuid default null,
  p_event_id uuid default null,
  p_alert_event_id uuid default null,
  p_report_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.is_service_role() and (select auth.uid()) is not null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.outbox (org_id, idempotency_key, kind, channel, address, payload, urgency, recipient_user_id, event_id, alert_event_id, report_id)
  values (p_org_id, p_key, p_kind, p_channel, p_address, coalesce(p_payload, '{}'), p_urgency, p_recipient_user_id, p_event_id, p_alert_event_id, p_report_id)
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.outbox where idempotency_key = p_key;
  end if;
  return v_id;
end;
$$;

-- When a normal message to this person may go out (null: now).
create function private.outbox_hold(p_row public.outbox, p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings public.notification_settings;
  v_pref public.notification_preferences;
  v_start smallint;
  v_end smallint;
  v_hour integer := extract(hour from p_now at time zone 'America/Mexico_City');
  v_local timestamp := p_now at time zone 'America/Mexico_City';
  v_quiet boolean;
  v_sent integer;
begin
  if p_row.urgency = 'critical' or p_row.kind = 'report' then
    return null;
  end if;
  select * into v_settings from public.notification_settings where org_id = p_row.org_id;
  select * into v_pref from public.notification_preferences where org_id = p_row.org_id and user_id = p_row.recipient_user_id;
  if v_pref.user_id is not null and not (case p_row.channel when 'email' then v_pref.email else v_pref.whatsapp end) then
    return jsonb_build_object('cancel', true, 'reason', 'channel_off');
  end if;
  v_start := coalesce(v_pref.quiet_start, v_settings.quiet_start, 22);
  v_end := coalesce(v_pref.quiet_end, v_settings.quiet_end, 7);
  v_quiet := case when v_start = v_end then false
                  when v_start < v_end then v_hour >= v_start and v_hour < v_end
                  else v_hour >= v_start or v_hour < v_end end;
  if v_quiet then
    return jsonb_build_object('until',
      (date_trunc('day', v_local) + make_interval(hours => v_end) + case when v_hour >= v_end then interval '1 day' else interval '0' end)
        at time zone 'America/Mexico_City',
      'reason', 'quiet_hours');
  end if;
  select count(*) into v_sent from public.outbox o
  where o.address = p_row.address and o.channel = p_row.channel and o.status = 'sent' and o.urgency = 'normal'
    and o.sent_at > p_now - interval '1 hour';
  if v_sent >= coalesce(v_settings.max_per_hour, 6) then
    return jsonb_build_object('until', p_now + interval '15 minutes', 'reason', 'hourly_limit');
  end if;
  return null;
end;
$$;

-- Leases up to p_limit due messages (critical first) for one worker. A
-- message whose worker vanished mid-send is retried when the provider
-- de-duplicates (email) and left "uncertain" otherwise (WhatsApp).
create function public.claim_outbox(p_worker text, p_limit integer default 20, p_lease_seconds integer default 120, p_now timestamptz default now())
returns setof public.outbox
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.outbox;
  v_hold jsonb;
  v_taken integer := 0;
begin
  if not private.is_service_role() and (select auth.uid()) is not null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  for v_row in
    select * from public.outbox o
    where (o.status = 'pending' and o.next_attempt_at <= p_now)
       or (o.status = 'sending' and o.lease_expires_at < p_now)
    order by o.urgency = 'critical' desc, o.next_attempt_at, o.id
    limit least(greatest(coalesce(p_limit, 20), 1), 100) * 3
    for update skip locked
  loop
    exit when v_taken >= least(greatest(coalesce(p_limit, 20), 1), 100);
    -- The previous worker vanished: was it delivered?
    if v_row.status = 'sending' then
      if v_row.channel <> 'email' then
        update public.outbox_attempts set finished_at = p_now, result = 'uncertain', error = 'El proceso terminó sin confirmar el envío.'
        where outbox_id = v_row.id and attempt = v_row.attempts and finished_at is null;
        update public.outbox set status = 'uncertain', lease_owner = null, lease_expires_at = null, updated_at = p_now,
               last_error = 'Resultado desconocido: revisa antes de reenviar (WhatsApp no evita duplicados).'
        where id = v_row.id;
        continue;
      end if;
      update public.outbox_attempts set finished_at = p_now, result = 'lost', error = 'El proceso terminó sin confirmar el envío.'
      where outbox_id = v_row.id and attempt = v_row.attempts and finished_at is null;
      if v_row.attempts >= v_row.max_attempts then
        update public.outbox set status = 'dead', lease_owner = null, lease_expires_at = null, updated_at = p_now,
               last_error = 'Sin confirmación tras el último intento.'
        where id = v_row.id;
        continue;
      end if;
    end if;
    v_hold := private.outbox_hold(v_row, p_now);
    if v_hold ? 'cancel' then
      update public.outbox set status = 'cancelled', deferred_reason = v_hold ->> 'reason', lease_owner = null, lease_expires_at = null, updated_at = p_now
      where id = v_row.id;
      continue;
    end if;
    if v_hold is not null then
      update public.outbox set status = 'pending', next_attempt_at = (v_hold ->> 'until')::timestamptz, deferred_reason = v_hold ->> 'reason',
             lease_owner = null, lease_expires_at = null, updated_at = p_now
      where id = v_row.id;
      continue;
    end if;
    update public.outbox
    set status = 'sending', attempts = attempts + 1, lease_owner = p_worker,
        lease_expires_at = p_now + make_interval(secs => greatest(coalesce(p_lease_seconds, 120), 10)),
        deferred_reason = null, updated_at = p_now
    where id = v_row.id
    returning * into v_row;
    insert into public.outbox_attempts (outbox_id, org_id, attempt, worker, started_at)
    values (v_row.id, v_row.org_id, v_row.attempts, p_worker, p_now);
    v_taken := v_taken + 1;
    return next v_row;
  end loop;
end;
$$;

-- Records the outcome of one attempt. Fenced by worker and attempt: a worker
-- that lost its lease cannot overwrite a newer attempt. Backoff: 1, 2, 4…
-- minutes, at most 6 hours.
create function public.complete_outbox(
  p_id uuid,
  p_worker text,
  p_attempt integer,
  p_ok boolean,
  p_provider_id text default null,
  p_error text default null,
  p_retryable boolean default true,
  p_now timestamptz default now()
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.outbox;
  v_status text;
  v_result text;
begin
  if not private.is_service_role() and (select auth.uid()) is not null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_row from public.outbox where id = p_id for update;
  if v_row.id is null or v_row.status <> 'sending' or v_row.lease_owner is distinct from p_worker or v_row.attempts <> p_attempt then
    return 'stale';
  end if;
  if p_ok then
    v_status := 'sent';
    v_result := 'sent';
  elsif p_retryable and v_row.attempts < v_row.max_attempts then
    v_status := 'pending';
    v_result := 'retry';
  else
    v_status := 'dead';
    v_result := 'dead';
  end if;
  update public.outbox
  set status = v_status,
      provider_message_id = coalesce(p_provider_id, provider_message_id),
      last_error = case when p_ok then null else left(p_error, 500) end,
      sent_at = case when p_ok then p_now else sent_at end,
      next_attempt_at = case when v_status = 'pending'
                             then p_now + least(interval '1 minute' * power(2, v_row.attempts - 1), interval '6 hours') else next_attempt_at end,
      lease_owner = null, lease_expires_at = null, updated_at = p_now
  where id = p_id;
  update public.outbox_attempts
  set finished_at = p_now, result = v_result, provider_message_id = p_provider_id, error = left(p_error, 500)
  where outbox_id = p_id and attempt = p_attempt;
  return v_status;
end;
$$;

-- An admin re-queues a dead or uncertain message (one more try).
create function public.retry_outbox(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.outbox;
begin
  select * into v_row from public.outbox where id = p_id for update;
  if v_row.id is null or not private.has_role(v_row.org_id, '{admin}') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_row.status not in ('dead', 'uncertain', 'cancelled') then
    raise exception 'Sólo se reintenta un envío fallido, incierto o cancelado.' using errcode = '22023';
  end if;
  update public.outbox
  set status = 'pending', next_attempt_at = now(), max_attempts = least(greatest(max_attempts, attempts + 1), 20),
      deferred_reason = null, updated_at = now()
  where id = p_id;
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, changes)
  values (v_row.org_id, (select auth.uid()), 'send', 'outbox', p_id::text,
          jsonb_build_object('retry', true, 'status', v_row.status, 'kind', v_row.kind));
end;
$$;

-- ---------------------------------------------------------------------------
-- Case escalations: reminder, link, head, coordinator
-- ---------------------------------------------------------------------------
-- Who receives a level, from verified configuration: link = the case's
-- responsible person or the department's link; head = the department's
-- head; coordinator = the case's coordinator (still admin/comunicación) or
-- the org's escalation contact. Only current members qualify.
create function private.escalation_recipient(p_case public.cases, p_level text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case p_level
    when 'link' then coalesce(
      (select m.user_id from public.memberships m where m.org_id = p_case.org_id and m.user_id = p_case.responsible_user_id
         and m.role = 'dependencia' and m.department_id = p_case.department_id),
      (select d.responsible_user_id from public.departments d where d.id = p_case.department_id))
    when 'head' then (select d.head_user_id from public.departments d where d.id = p_case.department_id)
    when 'coordinator' then coalesce(
      (select m.user_id from public.memberships m where m.org_id = p_case.org_id and m.user_id = p_case.coordinator_user_id
         and m.role in ('admin', 'comunicacion')),
      (select w.escalation_user_id from public.whatsapp_settings w where w.org_id = p_case.org_id))
  end;
$$;

-- Records one step and queues its messages, once per case, cycle, phase,
-- deadline and level. Returns whether it was new.
create function private.notify_case_step(
  p_case public.cases, p_phase text, p_deadline timestamptz, p_kind text, p_level text, p_emergency boolean, p_now timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := format('case:%s:c%s:%s:%s:%s', p_case.id, p_case.cycle, p_phase, extract(epoch from p_deadline)::bigint,
                       case when p_kind = 'reminder' then 'reminder' else p_level end);
  v_recipient uuid;
  v_kind text := case when p_emergency then 'emergency' else p_kind end;
  v_email text;
  v_phone text;
  v_pref public.notification_preferences;
  v_event uuid;
  v_reason text;
  v_payload jsonb;
  v_when text := to_char(p_deadline at time zone 'America/Mexico_City', 'DD/MM/YYYY HH24:MI');
begin
  if exists (select 1 from public.notification_events e where e.dedupe_key = v_key) then
    return false;
  end if;
  v_recipient := private.escalation_recipient(p_case, p_level);
  v_reason := case
    when p_kind = 'reminder' then format('%s: el plazo de %s vence el %s.', p_case.folio,
                                         case p_phase when 'acceptance' then 'aceptación' else 'atención' end, v_when)
    else format('%s: el plazo de %s venció el %s; se escala %s.', p_case.folio,
                case p_phase when 'acceptance' then 'aceptación' else 'atención' end, v_when,
                case p_level when 'link' then 'al enlace' when 'head' then 'al titular' else 'a la coordinación' end)
  end || case when p_emergency then ' Caso de emergencia.' else '' end;

  if v_recipient is not null then
    select * into v_pref from public.notification_preferences where org_id = p_case.org_id and user_id = v_recipient;
    -- Emergencies ignore the person's channel preferences (critical events are never hidden).
    if p_emergency or coalesce(v_pref.email, true) then
      select u.email into v_email from auth.users u where u.id = v_recipient and u.email_confirmed_at is not null;
    end if;
    if (p_emergency or coalesce(v_pref.whatsapp, true))
       and coalesce((select n.whatsapp_enabled from public.notification_settings n where n.org_id = p_case.org_id), false) then
      select c.phone into v_phone from public.whatsapp_contacts c
      where c.org_id = p_case.org_id and c.user_id = v_recipient and c.status = 'active';
    end if;
  end if;

  insert into public.notification_events (org_id, kind, level, case_id, phase, cycle, deadline, reason, recipient_user_id, result, dedupe_key)
  values (p_case.org_id, v_kind, p_level, p_case.id, p_phase, p_case.cycle, p_deadline, v_reason, v_recipient,
          case when v_recipient is null then 'no_recipient' when v_email is null and v_phone is null then 'no_channel' else 'queued' end,
          v_key)
  on conflict (dedupe_key) do nothing
  returning id into v_event;
  if v_event is null then
    return false;
  end if;

  v_payload := jsonb_build_object('case_id', p_case.id, 'folio', p_case.folio, 'title', p_case.title, 'phase', p_phase,
                                  'level', p_level, 'deadline', p_deadline, 'reason', v_reason, 'emergency', p_emergency,
                                  'step', case when p_kind = 'reminder' then 'reminder' else 'escalation' end);
  if v_email is not null then
    perform public.enqueue_outbox(p_case.org_id, format('event:%s:email', v_event), v_kind, 'email', v_email, v_payload,
                                  case when p_emergency then 'critical' else 'normal' end, v_recipient, v_event);
  end if;
  if v_phone is not null then
    perform public.enqueue_outbox(p_case.org_id, format('event:%s:whatsapp', v_event), v_kind, 'whatsapp', v_phone, v_payload,
                                  case when p_emergency then 'critical' else 'normal' end, v_recipient, v_event);
  end if;
  return true;
end;
$$;

-- Evaluates every open case's acceptance or attention deadline (server
-- only; the notify cron). Safe to run concurrently: steps are unique.
-- Deadlines more than 7 days old are not escalated (no backlog bursts).
create function public.enqueue_case_escalations(p_now timestamptz default now(), p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.cases;
  v_settings public.notification_settings;
  v_phase text;
  v_deadline timestamptz;
  v_start timestamptz;
  v_emergency boolean;
  v_new integer := 0;
  v_cases integer := 0;
begin
  if not private.is_service_role() and (select auth.uid()) is not null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  for v_case in
    select k.* from public.cases k
    where k.status in ('assigned', 'accepted', 'in_progress') and k.department_id is not null
      and coalesce(case when k.status = 'assigned' then least(k.accept_due_at, k.due_at) else k.due_at end, 'infinity') > p_now - interval '7 days'
    order by k.updated_at
  loop
    exit when v_new >= least(greatest(coalesce(p_limit, 200), 1), 1000);
    v_phase := case when v_case.status = 'assigned' then 'acceptance' else 'attention' end;
    v_deadline := case when v_phase = 'acceptance' then least(v_case.accept_due_at, v_case.due_at) else v_case.due_at end;
    continue when v_deadline is null;
    v_cases := v_cases + 1;
    v_start := case when v_phase = 'acceptance' then coalesce(v_case.assigned_at, v_case.opened_at)
                    else coalesce(v_case.accepted_at, v_case.assigned_at, v_case.opened_at) end;
    select * into v_settings from public.notification_settings where org_id = v_case.org_id;
    v_emergency := v_case.priority = 'critical' or exists (
      select 1 from public.classifications c where c.mention_id = v_case.primary_mention_id and c.severity = 'emergency');

    if p_now < v_deadline and v_start < v_deadline
       and p_now >= v_start + (v_deadline - v_start) * coalesce(v_settings.reminder_percent, 75) / 100.0 then
      v_new := v_new + private.notify_case_step(v_case, v_phase, v_deadline, 'reminder', 'link', v_emergency, p_now)::integer;
    end if;
    if p_now >= public.sla_deadline(v_case.org_id, v_deadline, coalesce(v_settings.link_after_hours, 0)) then
      v_new := v_new + private.notify_case_step(v_case, v_phase, v_deadline, 'escalation', 'link', v_emergency, p_now)::integer;
    end if;
    if p_now >= public.sla_deadline(v_case.org_id, v_deadline, coalesce(v_settings.head_after_hours, 4)) then
      v_new := v_new + private.notify_case_step(v_case, v_phase, v_deadline, 'escalation', 'head', v_emergency, p_now)::integer;
    end if;
    if p_now >= public.sla_deadline(v_case.org_id, v_deadline, coalesce(v_settings.coordinator_after_hours, 24)) then
      v_new := v_new + private.notify_case_step(v_case, v_phase, v_deadline, 'escalation', 'coordinator', v_emergency, p_now)::integer;
    end if;
  end loop;
  return jsonb_build_object('cases', v_cases, 'events', v_new);
end;
$$;

-- Case tickets are followed up by their case (above); WhatsApp follow-ups
-- keep covering tickets of single mentions, as before.
create or replace function public.claim_whatsapp_followups(p_now timestamptz, p_limit integer)
returns table (ticket_id uuid, kind text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with due as (
    select t.id, case when t.due_at <= p_now then 'overdue' else 'reminder' end as kind
    from public.tickets t
    where t.status in ('open', 'in_progress')
      and t.due_at is not null
      and t.case_id is null
      and (
        (t.due_at <= p_now and t.due_at > p_now - interval '3 days' and t.whatsapp_escalated_at is null)
        or (t.due_at > p_now and t.whatsapp_reminded_at is null
            and t.assigned_at + (t.due_at - t.assigned_at) * 0.75 <= p_now)
      )
    order by t.due_at
    limit least(greatest(p_limit, 1), 100)
    for update skip locked
  )
  update public.tickets t
  set whatsapp_reminded_at = coalesce(t.whatsapp_reminded_at, p_now),
      whatsapp_escalated_at = case when due.kind = 'overdue' then p_now else t.whatsapp_escalated_at end
  from due
  where t.id = due.id
  returning t.id, due.kind;
end;
$$;

-- ---------------------------------------------------------------------------
-- Report jobs: one per org, kind and period; advanced stage by stage
-- ---------------------------------------------------------------------------
create table public.report_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  schedule_id uuid references public.report_schedules (id) on delete set null,
  kind public.report_period not null,
  period_start date not null,
  period_end date not null,
  -- Snapshot of the schedule when queued: approval only if explicitly configured.
  auto_approve boolean not null default false,
  recipients text[] not null default '{}' check (cardinality(recipients) <= 30),
  -- queued → drafted → (approved → rendered → sending → done) | awaiting_approval; failed after the last try.
  stage text not null default 'queued'
    check (stage in ('queued', 'drafted', 'approved', 'rendered', 'sending', 'done', 'awaiting_approval', 'failed')),
  report_id uuid references public.reports (id) on delete set null,
  attempts integer not null default 0,
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  next_attempt_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (org_id, kind, period_start, period_end),
  check (period_end >= period_start)
);
create index report_jobs_due_idx on public.report_jobs (next_attempt_at)
  where stage not in ('done', 'awaiting_approval', 'failed');

create table public.report_job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.report_jobs (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  from_stage text not null,
  to_stage text not null,
  ok boolean not null,
  error text,
  worker text not null,
  at timestamptz not null default now()
);

-- A report belongs to at most one job: a retry after a crash finds it instead of drafting another.
alter table public.reports add column job_id uuid unique references public.report_jobs (id) on delete set null;

alter table public.report_jobs enable row level security;
alter table public.report_job_events enable row level security;
create policy "readers read report jobs" on public.report_jobs for select to authenticated using ((select private.can_read_all(org_id)));
create policy "readers read report job events" on public.report_job_events for select to authenticated using ((select private.can_read_all(org_id)));
revoke all on public.report_jobs, public.report_job_events from anon;
revoke insert, update, delete, truncate on public.report_jobs, public.report_job_events from authenticated;
revoke update, delete, truncate on public.report_job_events from service_role;
create trigger report_job_events_append_only before update on public.report_job_events
  for each row execute function private.case_append_only();

-- Queues the job of a period once (concurrent crons get the same one).
create function public.enqueue_report_job(
  p_org_id uuid, p_schedule_id uuid, p_kind public.report_period, p_start date, p_end date, p_auto_approve boolean, p_recipients text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.is_service_role() and (select auth.uid()) is not null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.report_jobs (org_id, schedule_id, kind, period_start, period_end, auto_approve, recipients)
  values (p_org_id, p_schedule_id, p_kind, p_start, p_end, coalesce(p_auto_approve, false), coalesce(p_recipients, '{}'))
  on conflict (org_id, kind, period_start, period_end) do nothing
  returning id into v_id;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'created', true);
  end if;
  select id into v_id from public.report_jobs where org_id = p_org_id and kind = p_kind and period_start = p_start and period_end = p_end;
  return jsonb_build_object('id', v_id, 'created', false);
end;
$$;

-- Leases due jobs (not finished, lease free or expired).
create function public.claim_report_jobs(p_worker text, p_limit integer default 3, p_lease_seconds integer default 300, p_now timestamptz default now())
returns setof public.report_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_service_role() and (select auth.uid()) is not null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
  with due as (
    select j.id from public.report_jobs j
    where j.stage not in ('done', 'awaiting_approval', 'failed') and j.next_attempt_at <= p_now
      and (j.lease_owner is null or j.lease_expires_at < p_now)
    order by j.next_attempt_at, j.id
    limit least(greatest(coalesce(p_limit, 3), 1), 20)
    for update skip locked
  )
  update public.report_jobs j
  set lease_owner = p_worker, lease_expires_at = p_now + make_interval(secs => greatest(coalesce(p_lease_seconds, 300), 30)), updated_at = p_now
  from due where j.id = due.id
  returning j.*;
end;
$$;

-- Records the result of one stage. Fenced by the lease owner. An error keeps
-- the stage (it is retried with backoff) until the last attempt.
create function public.advance_report_job(
  p_id uuid, p_worker text, p_to_stage text, p_report_id uuid default null, p_error text default null,
  p_release boolean default false, p_now timestamptz default now()
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.report_jobs;
  v_stage text;
begin
  if not private.is_service_role() and (select auth.uid()) is not null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_job from public.report_jobs where id = p_id for update;
  if v_job.id is null or v_job.lease_owner is distinct from p_worker then
    return 'stale';
  end if;
  if p_error is not null then
    v_stage := case when v_job.attempts + 1 >= v_job.max_attempts then 'failed' else v_job.stage end;
    update public.report_jobs
    set attempts = attempts + 1, last_error = left(p_error, 500), stage = v_stage,
        next_attempt_at = p_now + least(interval '5 minutes' * power(2, v_job.attempts), interval '6 hours'),
        lease_owner = null, lease_expires_at = null, updated_at = p_now,
        finished_at = case when v_stage = 'failed' then p_now end
    where id = p_id;
    insert into public.report_job_events (job_id, org_id, from_stage, to_stage, ok, error, worker, at)
    values (p_id, v_job.org_id, v_job.stage, v_stage, false, left(p_error, 500), p_worker, p_now);
    return v_stage;
  end if;
  update public.report_jobs
  set stage = p_to_stage, report_id = coalesce(p_report_id, report_id), last_error = null, updated_at = p_now,
      lease_owner = case when p_release or p_to_stage in ('done', 'awaiting_approval', 'failed') then null else lease_owner end,
      lease_expires_at = case when p_release or p_to_stage in ('done', 'awaiting_approval', 'failed') then null else lease_expires_at end,
      finished_at = case when p_to_stage in ('done', 'awaiting_approval', 'failed') then p_now end,
      -- Released while waiting (e.g. for its emails): the next run looks again.
      next_attempt_at = case when p_release then p_now else next_attempt_at end
  where id = p_id;
  if p_to_stage <> v_job.stage then
    insert into public.report_job_events (job_id, org_id, from_stage, to_stage, ok, worker, at)
    values (p_id, v_job.org_id, v_job.stage, p_to_stage, true, p_worker, p_now);
  end if;
  return p_to_stage;
end;
$$;

-- ---------------------------------------------------------------------------
-- Assignment with the SLA: same signature as stage 6. Without dates, the
-- deadlines come from the SLA (category and priority of the case, calendar
-- of the org); with dates, the person's dates win and the case records that
-- they differ. Either way the case keeps the SLA version and its terms.
-- ---------------------------------------------------------------------------
create or replace function public.assign_case(
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
  v_terms jsonb;
  v_due timestamptz;
  v_accept timestamptz;
begin
  select * into v_case from public.cases where id = p_case_id;
  if v_case.id is null or not private.is_case_coordinator(v_case.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_terms := public.sla_terms(v_case.org_id, v_case.category, v_case.priority, now());
  v_due := coalesce(p_due_at, (v_terms ->> 'due_at')::timestamptz);
  v_accept := coalesce(p_accept_due_at, (v_terms ->> 'accept_due_at')::timestamptz);
  if v_due is null or v_due <= now() then
    raise exception 'El compromiso de atención debe ser una fecha futura.' using errcode = '22023';
  end if;
  if v_accept is null or v_accept <= now() then
    raise exception 'El plazo de aceptación debe ser una fecha futura.' using errcode = '22023';
  end if;
  if v_accept > v_due then
    raise exception 'El plazo de aceptación debe terminar antes del compromiso de atención.' using errcode = '22023';
  end if;
  if p_responsible_user_id is not null and not exists (
    select 1 from public.memberships m
    where m.org_id = v_case.org_id and m.user_id = p_responsible_user_id and m.role = 'dependencia' and m.department_id = p_department_id) then
    raise exception 'La persona responsable debe ser de la dependencia asignada.' using errcode = '22023';
  end if;

  v_result := public.transition_case(p_case_id, 'assigned', p_reason, p_department_id, p_support_ids, v_due);

  update public.cases
  set accept_due_at = v_accept,
      commitment = nullif(btrim(p_commitment), ''),
      responsible_user_id = p_responsible_user_id,
      sla_version_id = (v_terms ->> 'version_id')::uuid,
      sla_terms = case when v_terms is null then null else v_terms || jsonb_build_object(
        'computed_accept_due_at', v_terms -> 'accept_due_at', 'computed_due_at', v_terms -> 'due_at',
        'accept_due_at', v_accept, 'due_at', v_due,
        'overridden', abs(extract(epoch from v_due - (v_terms ->> 'due_at')::timestamptz)) > 60
                      or abs(extract(epoch from v_accept - (v_terms ->> 'accept_due_at')::timestamptz)) > 60) end
  where id = p_case_id;
  perform private.log_case_event(v_case.org_id, p_case_id, 'assignment_terms', null, null, null,
    jsonb_build_object('responsible_user_id', p_responsible_user_id, 'accept_due_at', v_accept,
                       'due_at', v_due, 'commitment', nullif(btrim(p_commitment), ''),
                       'sla_version', v_terms -> 'version', 'sla_approved', v_terms -> 'approved'));
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Seeds (repeatable) and new municipalities
-- ---------------------------------------------------------------------------
select private.seed_sla_config(id) from public.organizations;
insert into public.notification_settings (org_id, updated_by) select id, null from public.organizations on conflict do nothing;

create function private.seed_org_attention()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_sla_config(new.id);
  insert into public.notification_settings (org_id, updated_by) values (new.id, null) on conflict do nothing;
  return new;
end;
$$;
-- After organizations_seed_sla (alphabetical order of triggers): sla_policies exist.
create trigger organizations_seed_sla_targets
  after insert on public.organizations
  for each row execute function private.seed_org_attention();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function private.sla_snapshot(uuid) from public, anon, authenticated;
revoke execute on function private.seed_sla_config(uuid) from public, anon, authenticated;
revoke execute on function private.sla_target(uuid, text, public.priority) from public, anon, authenticated;
revoke execute on function private.check_department_head() from public, anon, authenticated;
revoke execute on function private.release_department_head() from public, anon, authenticated;
revoke execute on function private.outbox_hold(public.outbox, timestamptz) from public, anon, authenticated;
revoke execute on function private.escalation_recipient(public.cases, text) from public, anon, authenticated;
revoke execute on function private.notify_case_step(public.cases, text, timestamptz, text, text, boolean, timestamptz) from public, anon, authenticated;
revoke execute on function private.seed_org_attention() from public, anon, authenticated;

revoke execute on function public.sla_deadline(uuid, timestamptz, numeric) from public, anon;
revoke execute on function public.sla_terms(uuid, text, public.priority, timestamptz) from public, anon;
revoke execute on function public.save_sla_config(uuid, jsonb, jsonb, jsonb) from public, anon;
revoke execute on function public.approve_sla_version(uuid, text) from public, anon;
revoke execute on function public.set_department_contacts(uuid, uuid, uuid) from public, anon;
grant execute on function public.sla_deadline(uuid, timestamptz, numeric) to authenticated, service_role;
grant execute on function public.sla_terms(uuid, text, public.priority, timestamptz) to authenticated, service_role;
grant execute on function public.save_sla_config(uuid, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.approve_sla_version(uuid, text) to authenticated;
grant execute on function public.set_department_contacts(uuid, uuid, uuid) to authenticated;

-- Server only.
revoke execute on function public.enqueue_outbox(uuid, text, text, text, text, jsonb, text, uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.claim_outbox(text, integer, integer, timestamptz) from public, anon, authenticated;
revoke execute on function public.complete_outbox(uuid, text, integer, boolean, text, text, boolean, timestamptz) from public, anon, authenticated;
revoke execute on function public.enqueue_case_escalations(timestamptz, integer) from public, anon, authenticated;
revoke execute on function public.enqueue_report_job(uuid, uuid, public.report_period, date, date, boolean, text[]) from public, anon, authenticated;
revoke execute on function public.claim_report_jobs(text, integer, integer, timestamptz) from public, anon, authenticated;
revoke execute on function public.advance_report_job(uuid, text, text, uuid, text, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.enqueue_outbox(uuid, text, text, text, text, jsonb, text, uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.claim_outbox(text, integer, integer, timestamptz) to service_role;
grant execute on function public.complete_outbox(uuid, text, integer, boolean, text, text, boolean, timestamptz) to service_role;
grant execute on function public.enqueue_case_escalations(timestamptz, integer) to service_role;
grant execute on function public.enqueue_report_job(uuid, uuid, public.report_period, date, date, boolean, text[]) to service_role;
grant execute on function public.claim_report_jobs(text, integer, integer, timestamptz) to service_role;
grant execute on function public.advance_report_job(uuid, text, text, uuid, text, boolean, timestamptz) to service_role;

revoke execute on function public.retry_outbox(uuid) from public, anon;
grant execute on function public.retry_outbox(uuid) to authenticated;
