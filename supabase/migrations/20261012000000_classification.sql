-- AI classification: per-project taxonomy and rules, and a daily usage/cost ledger.

-- ---------------------------------------------------------------------------
-- Projects: what the classifier may answer
-- ---------------------------------------------------------------------------
alter table public.projects
  -- Allowed values for classifications.topic in this project ("otro" is always allowed).
  add column topics text[] not null default '{}',
  -- Free-text rules the classifier must follow for this project (who handles what, local context…).
  add column classification_rules text not null default '';

-- ---------------------------------------------------------------------------
-- AI usage per org, day, model and purpose
-- ---------------------------------------------------------------------------
create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  day date not null,
  model text not null,
  purpose text not null,
  requests integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cache_read_tokens bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  -- Estimated from list prices in src/lib/ai/pricing.ts; the invoice is the source of truth.
  cost_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now(),
  unique (org_id, day, model, purpose)
);

create index ai_usage_org_day_idx on public.ai_usage (org_id, day desc);

alter table public.ai_usage enable row level security;
create policy "readers read ai usage" on public.ai_usage
  for select to authenticated using ((select private.has_role(org_id, '{admin,comunicacion}')));
revoke all on public.ai_usage from anon;
revoke insert, update, delete on public.ai_usage from authenticated;

-- Atomic increment of the day's row. Called by the server (service role) after each request.
create function public.record_ai_usage(
  p_org_id uuid,
  p_model text,
  p_purpose text,
  p_input_tokens bigint,
  p_output_tokens bigint,
  p_cache_read_tokens bigint,
  p_cache_write_tokens bigint,
  p_cost_usd numeric
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.ai_usage as u (org_id, day, model, purpose, requests, input_tokens, output_tokens,
                                    cache_read_tokens, cache_write_tokens, cost_usd)
  values (p_org_id, (now() at time zone 'America/Mexico_City')::date, p_model, p_purpose, 1,
          p_input_tokens, p_output_tokens, p_cache_read_tokens, p_cache_write_tokens, p_cost_usd)
  on conflict (org_id, day, model, purpose) do update set
    requests = u.requests + 1,
    input_tokens = u.input_tokens + excluded.input_tokens,
    output_tokens = u.output_tokens + excluded.output_tokens,
    cache_read_tokens = u.cache_read_tokens + excluded.cache_read_tokens,
    cache_write_tokens = u.cache_write_tokens + excluded.cache_write_tokens,
    cost_usd = u.cost_usd + excluded.cost_usd;
$$;

revoke execute on function public.record_ai_usage(uuid, text, text, bigint, bigint, bigint, bigint, numeric)
  from public, anon, authenticated;
grant execute on function public.record_ai_usage(uuid, text, text, bigint, bigint, bigint, bigint, numeric)
  to service_role;
