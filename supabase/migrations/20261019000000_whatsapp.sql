-- WhatsApp channel, phase 1: a common SLA per priority, one responsible person
-- per department, the officials' WhatsApp numbers (with their consent) and a
-- log of every message sent or received. Only officials: never citizens.

-- ---------------------------------------------------------------------------
-- SLA: hours to attend a routed mention, by priority (one table per org)
-- ---------------------------------------------------------------------------

create table public.sla_policies (
  org_id uuid not null references public.organizations (id) on delete cascade,
  priority public.priority not null,
  hours integer not null check (hours between 1 and 2160),
  updated_at timestamptz not null default now(),
  primary key (org_id, priority)
);

alter table public.sla_policies enable row level security;
create policy "members read sla" on public.sla_policies
  for select to authenticated using ((select private.is_member(org_id)));
create policy "admins write sla" on public.sla_policies
  for all to authenticated
  using ((select private.has_role(org_id, '{admin}')))
  with check ((select private.has_role(org_id, '{admin}')));
revoke all on public.sla_policies from anon;

-- Same defaults the inbox used before this table existed.
insert into public.sla_policies (org_id, priority, hours)
select o.id, p.priority, p.hours
from public.organizations o
cross join (values ('critical'::public.priority, 12), ('high', 24), ('medium', 72), ('low', 168)) as p(priority, hours);

create function private.seed_sla()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.sla_policies (org_id, priority, hours)
  values (new.id, 'critical', 12), (new.id, 'high', 24), (new.id, 'medium', 72), (new.id, 'low', 168);
  return new;
end;
$$;
revoke execute on function private.seed_sla() from public, anon, authenticated;

create trigger organizations_seed_sla
  after insert on public.organizations
  for each row execute function private.seed_sla();

-- ---------------------------------------------------------------------------
-- Responsible person per department (receives its routed mentions)
-- ---------------------------------------------------------------------------

-- References auth.users, not memberships: a second departments↔memberships
-- foreign key would make PostgREST embeds between them ambiguous.
alter table public.departments add column responsible_user_id uuid references auth.users (id) on delete set null;

-- The responsible must be able to act on the department's tickets: a
-- dependencia user of that department, or someone who sees everything.
create function private.check_responsible()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.responsible_user_id is not null and not exists (
    select 1 from public.memberships m
    where m.org_id = new.org_id
      and m.user_id = new.responsible_user_id
      and (m.role in ('admin', 'comunicacion') or (m.role = 'dependencia' and m.department_id = new.id))
  ) then
    raise exception 'the responsible must belong to the department or be admin/comunicacion' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function private.check_responsible() from public, anon, authenticated;

create trigger departments_check_responsible
  before insert or update of responsible_user_id on public.departments
  for each row execute function private.check_responsible();

-- A member who leaves or changes role/department stops being responsible
-- where they no longer qualify.
create function private.release_responsible()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.departments d
  set responsible_user_id = null
  where d.org_id = old.org_id
    and d.responsible_user_id = old.user_id
    and (
      tg_op = 'DELETE'
      or not (new.role in ('admin', 'comunicacion') or (new.role = 'dependencia' and new.department_id = d.id))
    );
  return null;
end;
$$;
revoke execute on function private.release_responsible() from public, anon, authenticated;

create trigger memberships_release_responsible
  after update of role, department_id or delete on public.memberships
  for each row execute function private.release_responsible();

-- ---------------------------------------------------------------------------
-- Officials' WhatsApp numbers
-- ---------------------------------------------------------------------------

-- pending: invitation sent, waiting for the official to accept on WhatsApp.
-- active: accepted; receives messages. declined / opted_out: never messaged
-- again until an admin re-invites (declined) or the official writes ALTA.
create type public.whatsapp_contact_status as enum ('pending', 'active', 'declined', 'opted_out');

create table public.whatsapp_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null,
  -- E.164 digits without "+", e.g. 5215512345678.
  phone text not null check (phone ~ '^[1-9][0-9]{9,14}$'),
  status public.whatsapp_contact_status not null default 'pending',
  invited_at timestamptz,
  confirmed_at timestamptz,
  opted_out_at timestamptz,
  -- Last message from the official: free-form replies are allowed for 24 h.
  last_inbound_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, user_id),
  unique (org_id, id),
  foreign key (org_id, user_id) references public.memberships (org_id, user_id) on delete cascade
);
-- One shared SIGMA number serves every municipality: an incoming message must
-- map to exactly one official, so a live number belongs to one contact.
create unique index whatsapp_contacts_live_phone_idx on public.whatsapp_contacts (phone)
  where status in ('pending', 'active');

alter table public.whatsapp_contacts enable row level security;
create policy "admins read whatsapp contacts" on public.whatsapp_contacts
  for select to authenticated using ((select private.has_role(org_id, '{admin}')));
create policy "officials read own whatsapp contact" on public.whatsapp_contacts
  for select to authenticated using (user_id = (select auth.uid()));
-- Admins only register a number through invite_whatsapp_contact() below;
-- it becomes active only when the official accepts on WhatsApp (webhook,
-- service role).
revoke all on public.whatsapp_contacts from anon;
revoke insert, update, delete on public.whatsapp_contacts from authenticated;

-- Registers (or re-invites) an official's number as pending. Runs as definer
-- so the audit log records the admin who did it.
create function public.invite_whatsapp_contact(p_org_id uuid, p_user_id uuid, p_phone text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.has_role(p_org_id, '{admin}') then
    raise exception 'only admins register WhatsApp numbers' using errcode = '42501';
  end if;
  insert into public.whatsapp_contacts as c (org_id, user_id, phone, status, invited_at)
  values (p_org_id, p_user_id, p_phone, 'pending', now())
  on conflict (org_id, user_id) do update
    set phone = excluded.phone, status = 'pending', invited_at = now(),
        confirmed_at = null, opted_out_at = null
  returning c.id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.invite_whatsapp_contact(uuid, uuid, text) from public, anon;
grant execute on function public.invite_whatsapp_contact(uuid, uuid, text) to authenticated;

-- Removes an official's number (stops every message to them).
create function public.remove_whatsapp_contact(p_org_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role(p_org_id, '{admin}') then
    raise exception 'only admins remove WhatsApp numbers' using errcode = '42501';
  end if;
  delete from public.whatsapp_contacts where org_id = p_org_id and user_id = p_user_id;
end;
$$;

revoke execute on function public.remove_whatsapp_contact(uuid, uuid) from public, anon;
grant execute on function public.remove_whatsapp_contact(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Message log (both directions) and delivery status from Meta's webhook
-- ---------------------------------------------------------------------------

create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  -- Null for messages from numbers that belong to no official.
  org_id uuid references public.organizations (id) on delete cascade,
  contact_id uuid references public.whatsapp_contacts (id) on delete set null,
  direction text not null check (direction in ('out', 'in')),
  -- Meta's message id (wamid); unique so a retried webhook is processed once.
  wa_message_id text unique,
  kind text not null check (kind in ('template', 'text', 'button', 'interactive', 'other')),
  template text,
  -- Short summary only (first 500 characters).
  body text check (char_length(body) <= 500),
  status text not null check (status in ('sent', 'delivered', 'read', 'failed', 'received')),
  error text,
  ticket_id uuid references public.tickets (id) on delete set null,
  status_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index whatsapp_messages_org_created_idx on public.whatsapp_messages (org_id, created_at desc);
create index whatsapp_messages_contact_idx on public.whatsapp_messages (contact_id, created_at desc);

alter table public.whatsapp_messages enable row level security;
create policy "admins read whatsapp messages" on public.whatsapp_messages
  for select to authenticated using ((select private.has_role(org_id, '{admin}')));
revoke all on public.whatsapp_messages from anon;
revoke insert, update, delete on public.whatsapp_messages from authenticated;

-- ---------------------------------------------------------------------------
-- Audit: SLA and contact changes (departments are already audited)
-- ---------------------------------------------------------------------------

create trigger audit_sla_policies after insert or update or delete on public.sla_policies
  for each row execute function private.audit_row();
create trigger audit_whatsapp_contacts after insert or update or delete on public.whatsapp_contacts
  for each row execute function private.audit_row();

-- ---------------------------------------------------------------------------
-- Retention: the message log follows RETENTION_MONTHS like mentions
-- ---------------------------------------------------------------------------

create function public.purge_old_whatsapp_messages(p_months integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if p_months < 1 then
    raise exception 'retention must be at least 1 month' using errcode = '22023';
  end if;
  delete from public.whatsapp_messages where created_at < now() - make_interval(months => p_months);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.purge_old_whatsapp_messages(integer) from public, anon, authenticated;
grant execute on function public.purge_old_whatsapp_messages(integer) to service_role;
