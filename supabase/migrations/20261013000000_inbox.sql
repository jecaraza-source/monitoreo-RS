-- Inbox (/bandeja): triage state of each mention, notes, routing in one call,
-- audited corrections and Realtime.

-- ---------------------------------------------------------------------------
-- Triage: what Comunicación did with a mention (independent of the AI status)
-- ---------------------------------------------------------------------------

create type public.triage_status as enum ('new', 'reviewed', 'routed', 'discarded');

alter table public.mentions add column triage public.triage_status not null default 'new';
create index mentions_org_triage_published_idx on public.mentions (org_id, triage, published_at desc, id desc);

-- Editors change only the triage column; everything else stays service-role only.
revoke update on public.mentions from authenticated;
grant update (triage) on public.mentions to authenticated;
create policy "editors triage mentions" on public.mentions
  for update to authenticated
  using ((select private.has_role(org_id, '{admin,comunicacion}')))
  with check ((select private.has_role(org_id, '{admin,comunicacion}')));

-- ---------------------------------------------------------------------------
-- Corrections: who and when is stamped by the database, not the client
-- ---------------------------------------------------------------------------

alter table public.classifications add column corrected_at timestamptz;

create function private.stamp_correction()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Service-role writes (the classifier) carry no user; people always do.
  if (select auth.uid()) is not null then
    new.corrected_by := (select auth.uid());
    new.corrected_at := now();
  end if;
  return new;
end;
$$;

create trigger classifications_stamp_correction
  before update on public.classifications
  for each row execute function private.stamp_correction();

-- ---------------------------------------------------------------------------
-- Tickets: who routed it
-- ---------------------------------------------------------------------------

alter table public.tickets add column created_by uuid references auth.users (id) default auth.uid();
create index tickets_org_due_idx on public.tickets (org_id, due_at) where status in ('open', 'in_progress');

-- Routes several mentions to one department in a single transaction. Runs as
-- the caller, so the tickets/mentions RLS policies decide who may do it.
create function public.route_mentions(p_mention_ids uuid[], p_department_id uuid, p_due_at timestamptz)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.tickets (org_id, mention_id, department_id, due_at)
  select m.org_id, m.id, p_department_id, p_due_at
  from public.mentions m
  where m.id = any (p_mention_ids)
  on conflict (mention_id, department_id)
    do update set due_at = excluded.due_at, status = 'open', resolved_at = null;
  get diagnostics v_count = row_count;

  update public.mentions set triage = 'routed' where id = any (p_mention_ids);
  return v_count;
end;
$$;

revoke execute on function public.route_mentions(uuid[], uuid, timestamptz) from public, anon;
grant execute on function public.route_mentions(uuid[], uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Notes on a mention, shared by Comunicación and the department it was routed to
-- ---------------------------------------------------------------------------

create table public.mention_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  mention_id uuid not null,
  author_id uuid not null default auth.uid() references auth.users (id),
  -- Snapshot of the author's name, filled by the trigger below.
  author_name text not null default '',
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  foreign key (org_id, mention_id) references public.mentions (org_id, id) on delete cascade
);
create index mention_notes_mention_idx on public.mention_notes (mention_id, created_at);

alter table public.mention_notes enable row level security;

create policy "read notes" on public.mention_notes
  for select to authenticated
  using (
    (select private.can_read_all(org_id))
    or private.mention_routed_to_user(org_id, mention_id)
  );
create policy "workers add notes" on public.mention_notes
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and (
      (select private.has_role(org_id, '{admin,comunicacion}'))
      or private.mention_routed_to_user(org_id, mention_id)
    )
  );

revoke all on public.mention_notes from anon;
revoke update, delete on public.mention_notes from authenticated;

create function private.fill_note_author()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.author_id := (select auth.uid());
  select coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), u.email, '')
    into new.author_name
  from auth.users u
  where u.id = new.author_id;
  new.author_name := coalesce(new.author_name, '');
  return new;
end;
$$;

revoke execute on function private.fill_note_author() from public, anon, authenticated;

create trigger mention_notes_fill_author
  before insert on public.mention_notes
  for each row execute function private.fill_note_author();

-- ---------------------------------------------------------------------------
-- Source labels for every member (dependencia cannot read public.sources)
-- ---------------------------------------------------------------------------

create function public.source_labels(p_org_id uuid)
returns table (id uuid, name text, type public.source_type)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.name, s.type
  from public.sources s
  where s.org_id = p_org_id
    and private.is_member(p_org_id)
  order by s.name;
$$;

revoke execute on function public.source_labels(uuid) from public, anon;
grant execute on function public.source_labels(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: changes reach each subscriber filtered by these tables' RLS
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime
      add table public.mentions, public.classifications, public.tickets, public.mention_notes;
  end if;
end;
$$;
