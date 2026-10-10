-- Security hardening: audit log (who changed or exported what), shared rate
-- limiting for /api/*, retention purge and an application error log.

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- Null when the change came from the server (cron, ingestion, classifier).
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (action in ('insert', 'update', 'delete', 'export', 'send', 'purge')),
  entity text not null,
  entity_id text,
  -- Changed columns for updates ({col: [old, new]}); key fields for inserts/deletes; details for events.
  changes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_org_created_idx on public.audit_log (org_id, created_at desc);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);

alter table public.audit_log enable row level security;
create policy "admins read audit log" on public.audit_log
  for select to authenticated using ((select private.has_role(org_id, '{admin}')));
-- Rows are written only by the trigger and log_event() below (SECURITY DEFINER).
revoke all on public.audit_log from anon;
revoke insert, update, delete on public.audit_log from authenticated;

-- Columns never copied into the log: bookkeeping, derived or bulky values.
create function private.audit_trim(p_row jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select p_row - '{updated_at,search,geojson,facts,content,secret,metrics}'::text[];
$$;

create function private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changes jsonb := '{}'::jsonb;
  v_key text;
begin
  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(v_new) loop
      if v_new -> v_key is distinct from v_old -> v_key and v_key not in ('updated_at', 'search') then
        v_changes := v_changes || jsonb_build_object(v_key,
          case when v_key in ('geojson', 'facts', 'content', 'metrics') then '"(modificado)"'::jsonb
               else jsonb_build_array(v_old -> v_key, v_new -> v_key) end);
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      return new;
    end if;
  else
    v_changes := private.audit_trim(v_row);
  end if;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, changes)
  values (
    coalesce((v_row ->> 'org_id')::uuid, (v_row ->> 'id')::uuid),
    (select auth.uid()),
    lower(tg_op),
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'user_id'),
    v_changes
  );
  return coalesce(new, old);
end;
$$;

-- Configuration and decisions: every change. Mentions, classifications and
-- tickets only when a person edits them (ingestion volume stays out of the log).
create trigger audit_memberships after insert or update or delete on public.memberships
  for each row execute function private.audit_row();
create trigger audit_departments after insert or update or delete on public.departments
  for each row execute function private.audit_row();
create trigger audit_neighborhoods after insert or update or delete on public.neighborhoods
  for each row execute function private.audit_row();
create trigger audit_risk_terms after insert or update or delete on public.risk_terms
  for each row execute function private.audit_row();
create trigger audit_projects after insert or update or delete on public.projects
  for each row execute function private.audit_row();
create trigger audit_queries after insert or update or delete on public.queries
  for each row execute function private.audit_row();
create trigger audit_sources after insert or update or delete on public.sources
  for each row execute function private.audit_row();
create trigger audit_alert_rules after insert or update or delete on public.alert_rules
  for each row execute function private.audit_row();
create trigger audit_reports after insert or update or delete on public.reports
  for each row execute function private.audit_row();
create trigger audit_report_schedules after insert or update or delete on public.report_schedules
  for each row execute function private.audit_row();
create trigger audit_organizations after update on public.organizations
  for each row execute function private.audit_row();
create trigger audit_tickets after insert or update or delete on public.tickets
  for each row when (auth.uid() is not null) execute function private.audit_row();
create trigger audit_classifications after update on public.classifications
  for each row when (auth.uid() is not null) execute function private.audit_row();
create trigger audit_mentions after update on public.mentions
  for each row when (auth.uid() is not null) execute function private.audit_row();

-- Events that are not row changes (PDF downloads, report emails). Members only,
-- always for their own org; the server records cron events with the service role.
create function public.log_event(p_org_id uuid, p_action text, p_entity text, p_entity_id text, p_details jsonb default '{}')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (private.is_member(p_org_id) or private.is_service_role()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_action not in ('export', 'send', 'purge') then
    raise exception 'invalid action' using errcode = '22023';
  end if;
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, changes)
  values (p_org_id, (select auth.uid()), p_action, p_entity, p_entity_id, coalesce(p_details, '{}'));
end;
$$;

revoke execute on function public.log_event(uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.log_event(uuid, text, text, text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Rate limiting (fixed windows, shared by every server instance)
-- ---------------------------------------------------------------------------
create table private.rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);

-- Counts one hit for `p_key` and says whether it is still within the limit.
create function public.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into private.rate_limits as r (key, window_start, hits)
  values (left(p_key, 200), v_start, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;
  -- Occasional cleanup of old windows.
  if random() < 0.01 then
    delete from private.rate_limits where window_start < now() - interval '1 day';
  end if;
  return query select v_hits <= p_limit, greatest(p_limit - v_hits, 0), v_start + make_interval(secs => p_window_seconds);
end;
$$;

revoke execute on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Retention: purge mentions older than N months (cron, service role)
-- ---------------------------------------------------------------------------
create function public.purge_old_mentions(p_months integer, p_batch integer default 5000)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz := now() - make_interval(months => p_months);
  v_deleted integer;
begin
  if p_months < 1 then
    raise exception 'retention must be at least 1 month' using errcode = '22023';
  end if;
  -- Classifications, tickets and notes go with their mention (ON DELETE CASCADE).
  with doomed as (
    select id, org_id from public.mentions where published_at < v_cutoff order by published_at limit p_batch
  ), gone as (
    delete from public.mentions m using doomed d where m.id = d.id returning d.org_id
  ), counts as (
    select org_id, count(*)::integer as n from gone group by org_id
  ), logged as (
    insert into public.audit_log (org_id, actor_id, action, entity, entity_id, changes)
    select org_id, null, 'purge', 'mentions', null, jsonb_build_object('before', v_cutoff, 'months', p_months, 'deleted', n)
    from counts
    returning (changes ->> 'deleted')::integer as n
  )
  select coalesce(sum(n), 0) into v_deleted from logged;

  if v_deleted > 0 then
    -- Citizen authors left without mentions go too (media and public figures stay).
    delete from public.authors a
    where a.kind = 'citizen' and not exists (select 1 from public.mentions m where m.author_id = a.id);
  end if;
  return v_deleted;
end;
$$;

revoke execute on function public.purge_old_mentions(integer, integer) from public, anon, authenticated;
grant execute on function public.purge_old_mentions(integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Application errors (server: instrumentation onRequestError; client: error
-- boundaries through /api/errors). Readable by admins; written by the server.
-- ---------------------------------------------------------------------------
create table public.app_errors (
  id bigint generated always as identity primary key,
  org_id uuid references public.organizations (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  source text not null check (source in ('server', 'client', 'cron')),
  message text not null,
  digest text,
  path text,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index app_errors_created_idx on public.app_errors (created_at desc);

alter table public.app_errors enable row level security;
create policy "admins read app errors" on public.app_errors
  for select to authenticated using (org_id is not null and (select private.has_role(org_id, '{admin}')));
revoke all on public.app_errors from anon;
revoke insert, update, delete on public.app_errors from authenticated;
