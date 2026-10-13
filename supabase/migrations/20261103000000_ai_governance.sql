-- Stage 10: AI quotas and budgets with reservations, unknown cost, billing
-- reconciliation, persisted leases; catalog of verified authors and
-- pseudonymization of unverified accounts.
--
-- Additive: new tables, new columns with defaults, new functions. The
-- backfill at the end is repeatable (it only touches rows not yet migrated).
-- Rollback: docs/rollback/20261103000000_ai_governance.down.sql.

-- ===========================================================================
-- 1. AI usage: cost unknown is not zero
-- ===========================================================================
alter table public.ai_usage
  -- Calls of a model without a configured tariff: tokens counted, cost unknown.
  add column unpriced_requests integer not null default 0 check (unpriced_requests >= 0),
  add column unpriced_tokens bigint not null default 0 check (unpriced_tokens >= 0),
  -- Tariff version of the last priced call (src/lib/ai/pricing.ts).
  add column tariff_version text;

comment on column public.ai_usage.cost_usd is
  'Estimated USD of the priced calls only (list prices, src/lib/ai/pricing.ts). Calls without tariff are in unpriced_requests/unpriced_tokens; the invoice is the source of truth.';

-- Backfill: before stage 10 a model without tariff was recorded with cost 0.
-- Every tariff is > 0, so cost 0 with tokens means "cost unknown". Repeatable.
update public.ai_usage
set unpriced_requests = requests,
    unpriced_tokens = input_tokens + output_tokens + cache_read_tokens + cache_write_tokens
where cost_usd = 0
  and unpriced_requests = 0
  and input_tokens + output_tokens + cache_read_tokens + cache_write_tokens > 0;

-- ===========================================================================
-- 2. Limits per organization
-- ===========================================================================
create function private.ai_purposes()
returns text[]
language sql
immutable
set search_path = ''
as $$ select array['classify', 'report', 'assistant', 'daily_reading'] $$;

-- Concurrency per purpose when the org has no limits row (or no key for it).
create function private.ai_default_concurrency()
returns jsonb
language sql
immutable
set search_path = ''
as $$ select '{"classify": 2, "report": 2, "assistant": 6, "daily_reading": 1}'::jsonb $$;

create table public.ai_limits (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  -- Null = no budget of that kind.
  daily_budget_usd numeric(10, 2) check (daily_budget_usd > 0),
  monthly_budget_usd numeric(10, 2) check (monthly_budget_usd > 0),
  daily_token_budget bigint check (daily_token_budget > 0),
  -- Calls to the provider per user and Mexico City day (assistant, reports).
  user_daily_requests integer not null default 300 check (user_daily_requests between 1 and 100000),
  -- Calls at once per purpose; missing keys use private.ai_default_concurrency().
  -- Checks are inline: the service role cannot use the private schema.
  max_concurrent jsonb not null default '{"classify": 2, "report": 2, "assistant": 6, "daily_reading": 1}'
    check (
      jsonb_typeof(max_concurrent) = 'object'
      and max_concurrent - array['classify', 'report', 'assistant', 'daily_reading'] = '{}'::jsonb
      and jsonb_typeof(coalesce(max_concurrent -> 'classify', '1')) = 'number' and coalesce(max_concurrent ->> 'classify', '1') ~ '^([1-9]|[1-4][0-9]|50)$'
      and jsonb_typeof(coalesce(max_concurrent -> 'report', '1')) = 'number' and coalesce(max_concurrent ->> 'report', '1') ~ '^([1-9]|[1-4][0-9]|50)$'
      and jsonb_typeof(coalesce(max_concurrent -> 'assistant', '1')) = 'number' and coalesce(max_concurrent ->> 'assistant', '1') ~ '^([1-9]|[1-4][0-9]|50)$'
      and jsonb_typeof(coalesce(max_concurrent -> 'daily_reading', '1')) = 'number' and coalesce(max_concurrent ->> 'daily_reading', '1') ~ '^([1-9]|[1-4][0-9]|50)$'
    ),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

alter table public.ai_limits enable row level security;
create policy "readers read ai limits" on public.ai_limits
  for select to authenticated using ((select private.has_role(org_id, '{admin,comunicacion}')));
create policy "admin writes ai limits" on public.ai_limits
  for insert to authenticated
  with check ((select private.has_role(org_id, '{admin}')) and updated_by = (select auth.uid()));
create policy "admin updates ai limits" on public.ai_limits
  for update to authenticated
  using ((select private.has_role(org_id, '{admin}')))
  with check ((select private.has_role(org_id, '{admin}')) and updated_by = (select auth.uid()));
revoke all on public.ai_limits from anon;
revoke delete, truncate on public.ai_limits from authenticated;

-- ===========================================================================
-- 3. Ledger of calls: reservation before the provider, settlement after
-- ===========================================================================
create table public.ai_calls (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- The person who caused the call (null for cron work).
  user_id uuid,
  purpose text not null check (purpose in ('classify', 'report', 'assistant', 'daily_reading')),
  model text not null,
  status text not null default 'reserved' check (status in ('reserved', 'settled', 'released', 'expired')),
  -- Estimate held while the call runs; null when the model has no tariff.
  reserved_usd numeric(12, 6) check (reserved_usd >= 0),
  reserved_tokens bigint not null check (reserved_tokens >= 0),
  input_tokens bigint,
  output_tokens bigint,
  cache_read_tokens bigint,
  cache_write_tokens bigint,
  -- Null = cost unknown (no tariff); never stored as 0 for that case.
  cost_usd numeric(12, 6),
  cost_status text check (cost_status in ('priced', 'unknown')),
  tariff_version text,
  error text check (char_length(error) <= 500),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  settled_at timestamptz,
  check (status <> 'settled' or (cost_status is not null and settled_at is not null)),
  check (cost_status is distinct from 'unknown' or cost_usd is null)
);

create index ai_calls_reserved_idx on public.ai_calls (org_id, purpose) where status = 'reserved';
create index ai_calls_user_day_idx on public.ai_calls (org_id, user_id, created_at desc) where user_id is not null;
create index ai_calls_org_created_idx on public.ai_calls (org_id, created_at desc);

alter table public.ai_calls enable row level security;
create policy "readers read ai calls" on public.ai_calls
  for select to authenticated using ((select private.has_role(org_id, '{admin,comunicacion}')));
revoke all on public.ai_calls from anon;
revoke insert, update, delete, truncate on public.ai_calls from authenticated;

/**
 * Reserves capacity for one provider call. Serialized per organization with
 * an advisory lock, so simultaneous requests cannot overshoot a limit: each
 * sees the reservations of those before it. Returns allowed=false with a
 * message in Spanish when a limit would be exceeded.
 */
create function public.reserve_ai(
  p_org_id uuid,
  p_user_id uuid,
  p_purpose text,
  p_model text,
  p_estimated_usd numeric,
  p_estimated_tokens bigint,
  p_ttl_seconds integer default 180
)
returns table (call_id uuid, allowed boolean, reason text, message text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limits public.ai_limits;
  v_now timestamptz := now();
  v_day date := (now() at time zone 'America/Mexico_City')::date;
  v_day_start timestamptz := ((now() at time zone 'America/Mexico_City')::date)::timestamp at time zone 'America/Mexico_City';
  v_max integer;
  v_running integer;
  v_user_calls integer;
  v_held_usd numeric;
  v_held_tokens bigint;
  v_day_usd numeric;
  v_month_usd numeric;
  v_day_tokens bigint;
  v_id uuid;
begin
  if p_purpose is null or p_purpose <> all (private.ai_purposes()) then
    raise exception 'Propósito de IA desconocido: %', p_purpose using errcode = '22023';
  end if;
  if p_estimated_tokens is null or p_estimated_tokens < 0 or p_estimated_usd < 0 then
    raise exception 'Estimación inválida' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ai_budget:' || p_org_id::text, 0));

  -- Reservations of crashed or timed-out work stop holding capacity.
  update public.ai_calls
  set status = 'expired', error = coalesce(error, 'La reserva venció sin conciliarse.')
  where org_id = p_org_id and status = 'reserved' and expires_at < v_now;

  select * into v_limits from public.ai_limits where org_id = p_org_id;

  v_max := coalesce((v_limits.max_concurrent ->> p_purpose)::integer, (private.ai_default_concurrency() ->> p_purpose)::integer);
  select count(*) into v_running from public.ai_calls
  where org_id = p_org_id and status = 'reserved' and purpose = p_purpose;
  if v_running >= v_max then
    return query select null::uuid, false, 'concurrency',
      format('Hay %s solicitudes de %s en curso (máximo %s a la vez). Intenta de nuevo en unos segundos.',
             v_running, private.ai_purpose_label(p_purpose), v_max);
    return;
  end if;

  if p_user_id is not null then
    select count(*) into v_user_calls from public.ai_calls
    where org_id = p_org_id and user_id = p_user_id and created_at >= v_day_start and status <> 'released';
    if v_user_calls >= coalesce(v_limits.user_daily_requests, 300) then
      return query select null::uuid, false, 'user_quota',
        format('Llegaste al límite de %s solicitudes a la IA por día. Se reinicia a medianoche (hora del centro de México).',
               coalesce(v_limits.user_daily_requests, 300));
      return;
    end if;
  end if;

  select coalesce(sum(c.reserved_usd), 0), coalesce(sum(c.reserved_tokens), 0)
  into v_held_usd, v_held_tokens
  from public.ai_calls c
  where c.org_id = p_org_id and c.status = 'reserved';

  select coalesce(sum(u.cost_usd) filter (where u.day = v_day), 0),
         coalesce(sum(u.cost_usd), 0),
         coalesce(sum(u.input_tokens + u.output_tokens + u.cache_read_tokens + u.cache_write_tokens) filter (where u.day = v_day), 0)
  into v_day_usd, v_month_usd, v_day_tokens
  from public.ai_usage u
  where u.org_id = p_org_id and u.day >= date_trunc('month', v_day)::date;

  -- A dollar budget cannot be checked for a call whose cost is unknown:
  -- without a token budget as a backstop, it is not authorized.
  if p_estimated_usd is null
     and (v_limits.daily_budget_usd is not null or v_limits.monthly_budget_usd is not null)
     and v_limits.daily_token_budget is null then
    return query select null::uuid, false, 'unpriced',
      format('El modelo %s no tiene tarifa configurada y el presupuesto está en dólares: no se puede autorizar. Configura un límite diario de tokens o actualiza las tarifas.', p_model);
    return;
  end if;

  if v_limits.daily_budget_usd is not null
     and v_day_usd + v_held_usd + coalesce(p_estimated_usd, 0) > v_limits.daily_budget_usd then
    return query select null::uuid, false, 'daily_budget',
      format('Se alcanzó el presupuesto diario de IA (US$%s). Consumido y en curso hoy: US$%s.',
             to_char(v_limits.daily_budget_usd, 'FM999990.00'), to_char(v_day_usd + v_held_usd, 'FM999990.00'));
    return;
  end if;

  if v_limits.monthly_budget_usd is not null
     and v_month_usd + v_held_usd + coalesce(p_estimated_usd, 0) > v_limits.monthly_budget_usd then
    return query select null::uuid, false, 'monthly_budget',
      format('Se alcanzó el presupuesto mensual de IA (US$%s). Consumido y en curso este mes: US$%s.',
             to_char(v_limits.monthly_budget_usd, 'FM999990.00'), to_char(v_month_usd + v_held_usd, 'FM999990.00'));
    return;
  end if;

  if v_limits.daily_token_budget is not null
     and v_day_tokens + v_held_tokens + p_estimated_tokens > v_limits.daily_token_budget then
    return query select null::uuid, false, 'daily_tokens',
      format('Se alcanzó el límite diario de %s tokens de IA.', to_char(v_limits.daily_token_budget, 'FM999G999G999G999'));
    return;
  end if;

  insert into public.ai_calls (org_id, user_id, purpose, model, reserved_usd, reserved_tokens, expires_at)
  values (p_org_id, p_user_id, p_purpose, p_model, p_estimated_usd, p_estimated_tokens,
          v_now + make_interval(secs => greatest(30, least(coalesce(p_ttl_seconds, 180), 900))))
  returning id into v_id;

  return query select v_id, true, null::text, null::text;
end;
$$;

create function private.ai_purpose_label(p_purpose text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_purpose
    when 'classify' then 'clasificación'
    when 'report' then 'reportes'
    when 'assistant' then 'asistente'
    when 'daily_reading' then 'lectura del día'
    else p_purpose
  end;
$$;

/**
 * Records the real consumption of a reserved call (also when its reservation
 * already expired: a call that happened is paid for). Idempotent: a call is
 * settled once. A null cost is "unknown": counted in unpriced_*, never as 0.
 */
create function public.settle_ai(
  p_call_id uuid,
  p_model text,
  p_input_tokens bigint,
  p_output_tokens bigint,
  p_cache_read_tokens bigint,
  p_cache_write_tokens bigint,
  p_cost_usd numeric,
  p_tariff_version text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_purpose text;
  v_tokens bigint := coalesce(p_input_tokens, 0) + coalesce(p_output_tokens, 0)
                     + coalesce(p_cache_read_tokens, 0) + coalesce(p_cache_write_tokens, 0);
begin
  if p_cost_usd < 0 then raise exception 'Costo inválido' using errcode = '22023'; end if;

  update public.ai_calls
  set status = 'settled',
      model = coalesce(nullif(p_model, ''), model),
      input_tokens = coalesce(p_input_tokens, 0),
      output_tokens = coalesce(p_output_tokens, 0),
      cache_read_tokens = coalesce(p_cache_read_tokens, 0),
      cache_write_tokens = coalesce(p_cache_write_tokens, 0),
      cost_usd = p_cost_usd,
      cost_status = case when p_cost_usd is null then 'unknown' else 'priced' end,
      tariff_version = p_tariff_version,
      settled_at = now()
  where id = p_call_id and status in ('reserved', 'expired')
  returning org_id, purpose into v_org, v_purpose;
  if not found then return false; end if;

  insert into public.ai_usage as u (org_id, day, model, purpose, requests, input_tokens, output_tokens,
                                    cache_read_tokens, cache_write_tokens, cost_usd,
                                    unpriced_requests, unpriced_tokens, tariff_version)
  values (v_org, (now() at time zone 'America/Mexico_City')::date, coalesce(nullif(p_model, ''), 'desconocido'), v_purpose, 1,
          coalesce(p_input_tokens, 0), coalesce(p_output_tokens, 0), coalesce(p_cache_read_tokens, 0), coalesce(p_cache_write_tokens, 0),
          coalesce(p_cost_usd, 0),
          case when p_cost_usd is null then 1 else 0 end,
          case when p_cost_usd is null then v_tokens else 0 end,
          p_tariff_version)
  on conflict (org_id, day, model, purpose) do update set
    requests = u.requests + 1,
    input_tokens = u.input_tokens + excluded.input_tokens,
    output_tokens = u.output_tokens + excluded.output_tokens,
    cache_read_tokens = u.cache_read_tokens + excluded.cache_read_tokens,
    cache_write_tokens = u.cache_write_tokens + excluded.cache_write_tokens,
    cost_usd = u.cost_usd + excluded.cost_usd,
    unpriced_requests = u.unpriced_requests + excluded.unpriced_requests,
    unpriced_tokens = u.unpriced_tokens + excluded.unpriced_tokens,
    tariff_version = coalesce(excluded.tariff_version, u.tariff_version);
  return true;
end;
$$;

/** Frees a reservation whose call did not reach the provider or returned no usage. */
create function public.release_ai(p_call_id uuid, p_error text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with done as (
    update public.ai_calls
    set status = 'released', error = left(p_error, 500), settled_at = now()
    where id = p_call_id and status in ('reserved', 'expired')
    returning 1
  )
  select exists (select 1 from done);
$$;

revoke execute on function public.reserve_ai(uuid, uuid, text, text, numeric, bigint, integer) from public, anon, authenticated;
revoke execute on function public.settle_ai(uuid, text, bigint, bigint, bigint, bigint, numeric, text) from public, anon, authenticated;
revoke execute on function public.release_ai(uuid, text) from public, anon, authenticated;
grant execute on function public.reserve_ai(uuid, uuid, text, text, numeric, bigint, integer) to service_role;
grant execute on function public.settle_ai(uuid, text, bigint, bigint, bigint, bigint, numeric, text) to service_role;
grant execute on function public.release_ai(uuid, text) to service_role;

-- ===========================================================================
-- 4. Persisted leases (one generation at a time across instances)
-- ===========================================================================
create table public.ai_leases (
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  holder uuid not null,
  expires_at timestamptz not null,
  primary key (org_id, name)
);
alter table public.ai_leases enable row level security;
revoke all on public.ai_leases from anon, authenticated;

/** Takes the lease if free, expired or already ours. */
create function public.acquire_ai_lease(p_org_id uuid, p_name text, p_holder uuid, p_ttl_seconds integer)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with taken as (
    insert into public.ai_leases as l (org_id, name, holder, expires_at)
    values (p_org_id, p_name, p_holder, now() + make_interval(secs => greatest(5, least(p_ttl_seconds, 900))))
    on conflict (org_id, name) do update
      set holder = excluded.holder, expires_at = excluded.expires_at
      where l.expires_at < now() or l.holder = excluded.holder
    returning 1
  )
  select exists (select 1 from taken);
$$;

create function public.release_ai_lease(p_org_id uuid, p_name text, p_holder uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.ai_leases where org_id = p_org_id and name = p_name and holder = p_holder;
$$;

revoke execute on function public.acquire_ai_lease(uuid, text, uuid, integer) from public, anon, authenticated;
revoke execute on function public.release_ai_lease(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.acquire_ai_lease(uuid, text, uuid, integer) to service_role;
grant execute on function public.release_ai_lease(uuid, text, uuid) to service_role;

-- ===========================================================================
-- 5. Invoices for billing reconciliation
-- ===========================================================================
create table public.ai_invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  amount_usd numeric(12, 2) not null check (amount_usd >= 0),
  reference text check (char_length(reference) <= 120),
  notes text check (char_length(notes) <= 1000),
  recorded_by uuid not null,
  recorded_at timestamptz not null default now(),
  unique (org_id, month)
);
alter table public.ai_invoices enable row level security;
create policy "readers read ai invoices" on public.ai_invoices
  for select to authenticated using ((select private.has_role(org_id, '{admin,comunicacion}')));
create policy "admin writes ai invoices" on public.ai_invoices
  for insert to authenticated
  with check ((select private.has_role(org_id, '{admin}')) and recorded_by = (select auth.uid()));
create policy "admin updates ai invoices" on public.ai_invoices
  for update to authenticated
  using ((select private.has_role(org_id, '{admin}')))
  with check ((select private.has_role(org_id, '{admin}')) and recorded_by = (select auth.uid()));
create policy "admin deletes ai invoices" on public.ai_invoices
  for delete to authenticated using ((select private.has_role(org_id, '{admin}')));
revoke all on public.ai_invoices from anon;

-- ===========================================================================
-- 6. Verified authors catalog
-- ===========================================================================
-- Per-org secret for pseudonyms; private schema: not reachable from the API.
create table private.author_salts (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  salt text not null default (gen_random_uuid()::text || gen_random_uuid()::text)
);

/**
 * Stable pseudonym of an account that is not verified: the same account maps
 * to the same row (aggregate analysis keeps working) but the handle is not
 * stored and cannot be recovered without the org's secret.
 */
create function private.author_pseudonym(p_org_id uuid, p_platform public.source_type, p_handle text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_salt text;
begin
  insert into private.author_salts (org_id) values (p_org_id) on conflict do nothing;
  select salt into v_salt from private.author_salts where org_id = p_org_id;
  return 'nv_' || left(encode(sha256(convert_to(v_salt || ':' || p_platform::text || ':' || btrim(p_handle), 'UTF8')), 'hex'), 24);
end;
$$;
revoke execute on function private.author_pseudonym(uuid, public.source_type, text) from public, anon, authenticated;

create table public.verified_authors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  platform public.source_type not null,
  -- RSS: host of the outlet; Meta: page username or id; YouTube: channel id (UC…); X: account.
  handle text not null check (char_length(btrim(handle)) between 1 and 200),
  kind public.author_kind not null check (kind in ('media', 'public_figure')),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 200),
  -- What shows it is a media outlet or a public figure (official site, register, office…).
  evidence text not null check (char_length(btrim(evidence)) between 10 and 2000),
  evidence_url text check (evidence_url ~ '^https://' and char_length(evidence_url) <= 500),
  verified_by uuid not null,
  verified_by_name text not null,
  verified_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid,
  revoked_by_name text,
  revoked_reason text check (char_length(revoked_reason) <= 500),
  unique (org_id, id),
  check ((revoked_at is null) = (revoked_by is null)),
  check (revoked_at is null or char_length(btrim(coalesce(revoked_reason, ''))) >= 5)
);
create unique index verified_authors_active_key on public.verified_authors (org_id, platform, handle) where revoked_at is null;

alter table public.verified_authors enable row level security;
create policy "readers read verified authors" on public.verified_authors
  for select to authenticated using ((select private.has_role(org_id, '{admin,comunicacion}')));
-- Writes only through verify_author / revoke_author (they also update authors).
revoke all on public.verified_authors from anon;
revoke insert, update, delete, truncate on public.verified_authors from authenticated;

alter table public.authors
  -- catalog: in verified_authors; source: the outlet/page a configured source reads; unverified: pseudonymized.
  add column verification text not null default 'unverified' check (verification in ('catalog', 'source', 'unverified')),
  add column verified_author_id uuid,
  add column vouching_source_id uuid,
  add column pseudonymized_at timestamptz,
  add constraint authors_verified_author_fk foreign key (org_id, verified_author_id)
    references public.verified_authors (org_id, id) on delete set null (verified_author_id),
  add constraint authors_vouching_source_fk foreign key (org_id, vouching_source_id)
    references public.sources (org_id, id) on delete set null (vouching_source_id);

-- Trail of verification changes. Never the handle of an unverified account.
create table public.author_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  author_id uuid,
  action text not null check (action in ('pseudonymized', 'verified', 'vouched', 'revoked', 'merged')),
  from_kind public.author_kind,
  to_kind public.author_kind,
  verified_author_id uuid,
  reason text not null check (char_length(reason) <= 500),
  actor_id uuid,
  actor_name text,
  created_at timestamptz not null default now()
);
create index author_events_org_idx on public.author_events (org_id, created_at desc);
alter table public.author_events enable row level security;
create policy "admin reads author events" on public.author_events
  for select to authenticated using ((select private.has_role(org_id, '{admin}')));
revoke all on public.author_events from anon;
revoke insert, update, delete, truncate on public.author_events from authenticated;

/** Turns an author row into a pseudonymous unverified one (merging if the pseudonym exists). */
create function private.pseudonymize_author(p_author_id uuid, p_reason text, p_actor uuid, p_actor_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.authors;
  v_pseudo text;
  v_existing uuid;
begin
  select * into v_a from public.authors where id = p_author_id for update;
  if not found then return null; end if;
  v_pseudo := case when v_a.verification = 'unverified' and v_a.handle like 'nv\_%' then v_a.handle
                   else private.author_pseudonym(v_a.org_id, v_a.platform, v_a.handle) end;
  select id into v_existing from public.authors
  where org_id = v_a.org_id and platform = v_a.platform and handle = v_pseudo and id <> v_a.id;
  if v_existing is not null then
    update public.mentions set author_id = v_existing where org_id = v_a.org_id and author_id = v_a.id;
    insert into public.author_events (org_id, author_id, action, from_kind, to_kind, reason, actor_id, actor_name)
    values (v_a.org_id, v_existing, 'merged', v_a.kind, 'citizen', p_reason, p_actor, p_actor_name);
    delete from public.authors where id = v_a.id;
    return v_existing;
  end if;
  update public.authors
  set handle = v_pseudo, display_name = null, followers = null, kind = 'citizen',
      verification = 'unverified', verified_author_id = null, vouching_source_id = null,
      pseudonymized_at = coalesce(pseudonymized_at, now())
  where id = v_a.id;
  insert into public.author_events (org_id, author_id, action, from_kind, to_kind, reason, actor_id, actor_name)
  values (v_a.org_id, v_a.id, 'pseudonymized', v_a.kind, 'citizen', p_reason, p_actor, p_actor_name);
  return v_a.id;
end;
$$;
revoke execute on function private.pseudonymize_author(uuid, text, uuid, text) from public, anon, authenticated;

/**
 * Applies a catalog entry to the authors of its account: the pseudonymous row
 * (or the one vouched by a source) becomes the verified author. Mentions keep
 * their author_id; duplicates are merged.
 */
create function private.apply_verified_author(p_entry public.verified_authors)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_real uuid;
  v_pseudo uuid;
  v_target uuid;
  v_from public.author_kind;
begin
  select id, kind into v_real, v_from from public.authors
  where org_id = p_entry.org_id and platform = p_entry.platform and handle = p_entry.handle;
  select id into v_pseudo from public.authors
  where org_id = p_entry.org_id and platform = p_entry.platform
    and handle = private.author_pseudonym(p_entry.org_id, p_entry.platform, p_entry.handle);
  if v_real is not null and v_pseudo is not null then
    update public.mentions set author_id = v_real where org_id = p_entry.org_id and author_id = v_pseudo;
    delete from public.authors where id = v_pseudo;
    insert into public.author_events (org_id, author_id, action, from_kind, to_kind, verified_author_id, reason, actor_id, actor_name)
    values (p_entry.org_id, v_real, 'merged', 'citizen', p_entry.kind, p_entry.id, 'Cuenta verificada: se unió su registro seudónimo.', p_entry.verified_by, p_entry.verified_by_name);
  end if;
  v_target := coalesce(v_real, v_pseudo);
  if v_target is null then return; end if;
  if v_real is null then v_from := 'citizen'; end if;
  update public.authors
  set handle = p_entry.handle, display_name = p_entry.display_name, kind = p_entry.kind,
      verification = 'catalog', verified_author_id = p_entry.id, pseudonymized_at = null
  where id = v_target;
  insert into public.author_events (org_id, author_id, action, from_kind, to_kind, verified_author_id, reason, actor_id, actor_name)
  values (p_entry.org_id, v_target, 'verified', v_from, p_entry.kind, p_entry.id, 'Alta en el catálogo de autores verificados.', p_entry.verified_by, p_entry.verified_by_name);
end;
$$;
revoke execute on function private.apply_verified_author(public.verified_authors) from public, anon, authenticated;

create function private.member_name(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), split_part(u.email, '@', 1))
                   from auth.users u where u.id = p_user_id), '');
$$;
revoke execute on function private.member_name(uuid) from public, anon, authenticated;

/** Adds an account to the catalog (admin or comunicacion of the org; identity from the session). */
create function public.verify_author(
  p_org_id uuid,
  p_platform public.source_type,
  p_handle text,
  p_kind public.author_kind,
  p_display_name text,
  p_evidence text,
  p_evidence_url text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_entry public.verified_authors;
begin
  if v_uid is null or not private.has_role(p_org_id, '{admin,comunicacion}') then
    raise exception 'Sin permiso para verificar autores.' using errcode = '42501';
  end if;
  insert into public.verified_authors (org_id, platform, handle, kind, display_name, evidence, evidence_url, verified_by, verified_by_name)
  values (p_org_id, p_platform, btrim(p_handle), p_kind, btrim(p_display_name), btrim(p_evidence), nullif(btrim(p_evidence_url), ''),
          v_uid, private.member_name(v_uid))
  returning * into v_entry;
  perform private.apply_verified_author(v_entry);
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, changes)
  values (p_org_id, v_uid, 'insert', 'verified_authors', v_entry.id::text,
          jsonb_build_object('platform', p_platform, 'kind', p_kind, 'display_name', v_entry.display_name));
  return v_entry.id;
exception
  when unique_violation then
    raise exception 'Esa cuenta ya está en el catálogo.' using errcode = '23505';
end;
$$;

/** Revokes a catalog entry: its authors go back to pseudonymous and leave rankings. */
create function public.revoke_author(p_entry_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_entry public.verified_authors;
  v_author uuid;
begin
  select * into v_entry from public.verified_authors where id = p_entry_id and revoked_at is null for update;
  if not found then raise exception 'La verificación no existe o ya fue revocada.' using errcode = 'P0002'; end if;
  if v_uid is null or not private.has_role(v_entry.org_id, '{admin,comunicacion}') then
    raise exception 'Sin permiso para revocar verificaciones.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Escribe el motivo de la revocación.' using errcode = '22023';
  end if;
  update public.verified_authors
  set revoked_at = now(), revoked_by = v_uid, revoked_by_name = private.member_name(v_uid), revoked_reason = btrim(p_reason)
  where id = p_entry_id;
  for v_author in select id from public.authors where verified_author_id = p_entry_id loop
    perform private.pseudonymize_author(v_author, 'Verificación revocada: ' || btrim(p_reason), v_uid, private.member_name(v_uid));
  end loop;
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, changes)
  values (v_entry.org_id, v_uid, 'update', 'verified_authors', p_entry_id::text, jsonb_build_object('revoked', true, 'reason', btrim(p_reason)));
end;
$$;

revoke execute on function public.verify_author(uuid, public.source_type, text, public.author_kind, text, text, text) from public, anon;
revoke execute on function public.revoke_author(uuid, text) from public, anon;
grant execute on function public.verify_author(uuid, public.source_type, text, public.author_kind, text, text, text) to authenticated;
grant execute on function public.revoke_author(uuid, text) to authenticated;

/**
 * Ingestion: resolves the authors of a batch. A catalog entry wins; then the
 * outlet/page the configured source reads (vouched); everything else is an
 * unverified account stored only as a pseudonym, without name or followers.
 * p_rows: [{platform, handle, display_name, followers, kind, vouched}].
 * Returns the input handle with the author id to link the mentions.
 */
create function public.upsert_authors(p_org_id uuid, p_source_id uuid, p_rows jsonb)
returns table (platform public.source_type, handle text, author_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
  v_platform public.source_type;
  v_handle text;
  v_entry public.verified_authors;
  v_id uuid;
  v_existing public.authors;
  v_kind public.author_kind;
begin
  for r in select * from jsonb_to_recordset(p_rows) as x(platform text, handle text, display_name text, followers integer, kind text, vouched boolean) loop
    v_platform := r.platform::public.source_type;
    v_handle := left(btrim(r.handle), 200);
    continue when v_handle is null or v_handle = '';
    v_id := null;

    select * into v_entry from public.verified_authors va
    where va.org_id = p_org_id and va.platform = v_platform and va.handle = v_handle and va.revoked_at is null;

    if found then
      insert into public.authors as a (org_id, platform, handle, display_name, followers, kind, verification, verified_author_id)
      values (p_org_id, v_platform, v_handle, v_entry.display_name, r.followers, v_entry.kind, 'catalog', v_entry.id)
      on conflict (org_id, platform, handle) do update
        set display_name = excluded.display_name, followers = coalesce(excluded.followers, a.followers),
            kind = excluded.kind, verification = 'catalog', verified_author_id = excluded.verified_author_id
      returning a.id into v_id;
    elsif coalesce(r.vouched, false) and r.kind in ('media', 'public_figure') then
      v_kind := r.kind::public.author_kind;
      select * into v_existing from public.authors a where a.org_id = p_org_id and a.platform = v_platform and a.handle = v_handle;
      if found then
        update public.authors a
        set display_name = coalesce(left(r.display_name, 200), a.display_name),
            followers = coalesce(r.followers, a.followers)
        where a.id = v_existing.id;
        v_id := v_existing.id;
      else
        insert into public.authors (org_id, platform, handle, display_name, followers, kind, verification, vouching_source_id)
        values (p_org_id, v_platform, v_handle, left(r.display_name, 200), r.followers, v_kind, 'source', p_source_id)
        returning id into v_id;
        insert into public.author_events (org_id, author_id, action, to_kind, reason)
        values (p_org_id, v_id, 'vouched', v_kind, 'Medio o página que lee una fuente configurada.');
      end if;
    else
      -- A verified row with the real handle (e.g. the configured channel seen from a search) is reused.
      select a.id into v_id from public.authors a
      where a.org_id = p_org_id and a.platform = v_platform and a.handle = v_handle and a.verification <> 'unverified';
      if v_id is null then
        insert into public.authors as a (org_id, platform, handle, kind, verification, pseudonymized_at)
        values (p_org_id, v_platform, private.author_pseudonym(p_org_id, v_platform, v_handle), 'citizen', 'unverified', now())
        on conflict (org_id, platform, handle) do update set pseudonymized_at = a.pseudonymized_at
        returning a.id into v_id;
      end if;
    end if;

    platform := v_platform;
    handle := v_handle;
    author_id := v_id;
    return next;
  end loop;
end;
$$;
revoke execute on function public.upsert_authors(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_authors(uuid, uuid, jsonb) to service_role;

-- ===========================================================================
-- 7. Backfill of existing authors (repeatable)
-- ===========================================================================
-- a) Accounts in the catalog (none on a fresh install).
-- b) Outlets and pages that only a configured source can produce: RSS hosts
--    and Meta pages; YouTube channels configured by id.
update public.authors a
set verification = 'source'
where a.verification = 'unverified' and a.pseudonymized_at is null
  and a.kind in ('media', 'public_figure')
  and (a.platform in ('rss', 'meta')
       or (a.platform = 'youtube' and exists (
             select 1 from public.sources s
             where s.org_id = a.org_id and s.type = 'youtube' and s.config ->> 'channelId' = a.handle)));

insert into public.author_events (org_id, author_id, action, from_kind, to_kind, reason)
select a.org_id, a.id, 'vouched', a.kind, a.kind, 'Etapa 10: autor de una fuente configurada (RSS, página de Meta o canal configurado).'
from public.authors a
where a.verification = 'source'
  and not exists (select 1 from public.author_events e where e.author_id = a.id and e.action = 'vouched');

-- c) Everything else (YouTube channels from open searches, accounts without
--    a source, citizens): pseudonymized. Ids and mention links are kept.
do $$
declare
  v_id uuid;
begin
  for v_id in
    select id from public.authors
    where verification = 'unverified' and pseudonymized_at is null
    order by created_at, id
  loop
    perform private.pseudonymize_author(v_id, 'Etapa 10: cuenta no verificada; se conserva sólo un seudónimo.', null, 'migración');
  end loop;
end;
$$;

-- From here on: verified ⇔ media or public figure, and no identity for the rest.
alter table public.authors
  add constraint authors_verified_kind check ((kind = 'citizen') = (verification = 'unverified')),
  add constraint authors_unverified_without_identity check (
    verification <> 'unverified' or (display_name is null and followers is null and handle like 'nv\_%' and pseudonymized_at is not null)
  );
