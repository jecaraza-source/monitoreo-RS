-- Stage 10: AI quotas, budgets and the ledger of calls. Reservations hold
-- capacity until reconciled; unknown cost is never 0; permissions by role.
-- (Real concurrency — many sessions at once — is in e2e/ai-governance.spec.ts:
-- reserve_ai serializes per org with an advisory lock.)
begin;
select plan(41);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.reserve(p_purpose text, p_usd numeric, p_tokens bigint, p_user uuid default null, p_model text default 'claude-haiku-5-5')
returns record language sql as $$
  select r from public.reserve_ai('00000000-0000-4000-a000-000000000001', p_user, p_purpose, p_model, p_usd, p_tokens, 180) r;
$$;

-- ---------------------------------------------------------------------------
-- Concurrency per purpose (default: daily_reading 1, report 2)
-- ---------------------------------------------------------------------------
set local role service_role;
create temp table r1 as select * from public.reserve_ai('00000000-0000-4000-a000-000000000001', null, 'daily_reading', 'claude-haiku-5-5', 0.01, 1000, 180);
create temp table r2 as select * from public.reserve_ai('00000000-0000-4000-a000-000000000001', null, 'daily_reading', 'claude-haiku-5-5', 0.01, 1000, 180);
reset role;
select ok((select allowed from r1), 'the first reservation of a purpose is allowed');
select ok(not (select allowed from r2), 'a second simultaneous daily reading exceeds its concurrency (1)');
select is((select reason from r2), 'concurrency', 'reason: concurrency');
select matches((select message from r2), '^Hay 1 solicitudes de lectura del día en curso \(máximo 1 a la vez\)', 'the message is in Spanish and says the limit');
select is((select count(*) from public.ai_calls where status = 'reserved' and purpose = 'daily_reading'), 1::bigint, 'only the allowed call holds a reservation');

-- Settling frees the slot.
set local role service_role;
select ok(public.settle_ai((select call_id from r1), 'claude-haiku-5-5-20261001', 1000, 200, 0, 0, 0.0002, '2026-10'), 'settle reconciles the call');
select ok(not public.settle_ai((select call_id from r1), 'claude-haiku-5-5', 1000, 200, 0, 0, 0.0002, '2026-10'), 'a call is settled only once (idempotent)');
create temp table r3 as select * from public.reserve_ai('00000000-0000-4000-a000-000000000001', null, 'daily_reading', 'claude-haiku-5-5', 0.01, 1000, 180);
reset role;
select ok((select allowed from r3), 'after settling, the slot is free again');
select is(
  (select row(requests, input_tokens, output_tokens, cost_usd, unpriced_requests, tariff_version)::text from public.ai_usage
   where org_id = '00000000-0000-4000-a000-000000000001' and purpose = 'daily_reading' and model = 'claude-haiku-5-5-20261001'),
  '(1,1000,200,0.000200,0,2026-10)', 'settle writes the real usage and tariff to ai_usage once');

-- A reservation of a crashed worker expires and stops holding capacity.
update public.ai_calls set expires_at = now() - interval '1 second' where id = (select call_id from r3);
set local role service_role;
create temp table r4 as select * from public.reserve_ai('00000000-0000-4000-a000-000000000001', null, 'daily_reading', 'claude-haiku-5-5', 0.01, 1000, 180);
reset role;
select ok((select allowed from r4), 'an expired reservation does not block');
select is((select status from public.ai_calls where id = (select call_id from r3)), 'expired', 'it is marked expired');
-- A late settle of an expired call still counts (the call happened).
set local role service_role;
select ok(public.settle_ai((select call_id from r3), 'claude-haiku-5-5', 10, 1, 0, 0, 0.000002, '2026-10'), 'an expired call can still be reconciled');
-- Release frees a reservation without usage.
select ok(public.release_ai((select call_id from r4), 'cancelada'), 'release frees the reservation');
reset role;
select is((select status || ':' || error from public.ai_calls where id = (select call_id from r4)), 'released:cancelada', 'released with its reason');

-- ---------------------------------------------------------------------------
-- Unknown cost: counted apart, never 0
-- ---------------------------------------------------------------------------
set local role service_role;
create temp table u1 as select * from public.reserve_ai('00000000-0000-4000-a000-000000000001', null, 'report', 'claude-futuro', null, 5000, 180);
select ok(public.settle_ai((select call_id from u1), 'claude-futuro', 4000, 500, 0, 0, null, '2026-10'), 'a call without tariff is reconciled');
reset role;
select is((select cost_status || ':' || coalesce(cost_usd::text, 'null') from public.ai_calls where id = (select call_id from u1)), 'unknown:null', 'its cost is unknown (null), not 0');
select is(
  (select row(requests, cost_usd, unpriced_requests, unpriced_tokens)::text from public.ai_usage
   where org_id = '00000000-0000-4000-a000-000000000001' and model = 'claude-futuro'),
  '(1,0.000000,1,4500)', 'ai_usage keeps it in unpriced_requests/unpriced_tokens with its tokens');
select throws_ok($$ update public.ai_calls set cost_status = 'unknown', cost_usd = 0 where id = (select call_id from u1) $$, '23514', null,
  'an unknown cost can never be stored as 0');

-- ---------------------------------------------------------------------------
-- Budgets and quotas
-- ---------------------------------------------------------------------------
insert into public.ai_limits (org_id, daily_budget_usd, monthly_budget_usd, user_daily_requests, max_concurrent)
values ('00000000-0000-4000-a000-000000000001', 1.00, 50.00, 2, '{"assistant": 10, "report": 10}');
-- Today already spent 0.90 (priced) in the org.
insert into public.ai_usage (org_id, day, model, purpose, requests, cost_usd)
values ('00000000-0000-4000-a000-000000000001', (now() at time zone 'America/Mexico_City')::date, 'claude-opus-5-5', 'report', 1, 0.90);

set local role service_role;
create temp table b1 as select * from public.reserve_ai('00000000-0000-4000-a000-000000000001', null, 'report', 'claude-opus-5-5', 0.05, 100, 180);
create temp table b2 as select * from public.reserve_ai('00000000-0000-4000-a000-000000000001', null, 'report', 'claude-opus-5-5', 0.08, 100, 180);
reset role;
select ok((select allowed from b1), '0.90 + 0.05 fits the 1.00 daily budget');
select ok(not (select allowed from b2), 'a second call that would exceed it, counting the one in flight, is refused');
select is((select reason from b2), 'daily_budget', 'reason: daily budget');
select matches((select message from b2), 'presupuesto diario de IA \(US\$1\.00\)', 'the message says the budget');

-- Unknown cost with a dollar budget and no token budget: not authorized.
set local role service_role;
create temp table b3 as select * from public.reserve_ai('00000000-0000-4000-a000-000000000001', null, 'report', 'claude-futuro', null, 100, 180);
reset role;
select is((select reason from b3), 'unpriced', 'an unpriced call cannot be checked against a dollar budget');
-- With a token budget as backstop it is allowed and counted in tokens.
update public.ai_limits set daily_token_budget = 20000 where org_id = '00000000-0000-4000-a000-000000000001';
set local role service_role;
create temp table b4 as select * from public.reserve_ai('00000000-0000-4000-a000-000000000001', null, 'report', 'claude-futuro', null, 8000, 180);
create temp table b5 as select * from public.reserve_ai('00000000-0000-4000-a000-000000000001', null, 'report', 'claude-futuro', null, 8000, 180);
reset role;
select ok((select allowed from b4), 'with a token budget an unpriced call is allowed');
select is((select reason from b5), 'daily_tokens', 'and the token budget stops the next one (usage today + in flight)');

-- Monthly budget.
update public.ai_limits set daily_budget_usd = null, daily_token_budget = null, monthly_budget_usd = 1.20 where org_id = '00000000-0000-4000-a000-000000000001';
set local role service_role;
create temp table b6 as select * from public.reserve_ai('00000000-0000-4000-a000-000000000001', null, 'report', 'claude-opus-5-5', 0.50, 100, 180);
reset role;
select is((select reason from b6), 'monthly_budget', 'the monthly budget counts the month and what is in flight');

-- Per-user daily quota (2): released calls do not count.
update public.ai_limits set monthly_budget_usd = null where org_id = '00000000-0000-4000-a000-000000000001';
set local role service_role;
create temp table q1 as select * from public.reserve_ai('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-d000-000000000002', 'assistant', 'claude-opus-5-5', 0.01, 100, 180);
create temp table q2 as select * from public.reserve_ai('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-d000-000000000002', 'assistant', 'claude-opus-5-5', 0.01, 100, 180);
create temp table q3 as select * from public.reserve_ai('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-d000-000000000002', 'assistant', 'claude-opus-5-5', 0.01, 100, 180);
create temp table q4 as select * from public.reserve_ai('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-d000-000000000001', 'assistant', 'claude-opus-5-5', 0.01, 100, 180);
reset role;
select ok((select allowed from q2) and not (select allowed from q3), 'the third call of the day of the same person is refused');
select matches((select message from q3), 'límite de 2 solicitudes a la IA por día', 'with the quota in the message');
select ok((select allowed from q4), 'another person keeps their own quota');

select throws_ok($$ select public.reserve_ai('00000000-0000-4000-a000-000000000001', null, 'otro', 'm', 0, 0, 60) $$, '22023', null, 'unknown purposes are rejected');

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select throws_ok($$ select public.reserve_ai('00000000-0000-4000-a000-000000000001', null, 'report', 'm', 0, 0, 60) $$, '42501', null,
  'authenticated users cannot reserve (server only)');
select throws_ok($$ select public.settle_ai(gen_random_uuid(), 'm', 1, 1, 0, 0, 0, null) $$, '42501', null, 'nor settle');
select ok((select count(*) from public.ai_calls) > 0, 'comunicacion reads the ledger');
update public.ai_limits set user_daily_requests = 9999;
reset role;
select is((select user_daily_requests from public.ai_limits where org_id = '00000000-0000-4000-a000-000000000001'), 2, 'comunicacion cannot change limits (RLS)');

select pg_temp.login('00000000-0000-4000-d000-000000000005');
set local role authenticated;
select is((select count(*) from public.ai_calls), 0::bigint, 'lectura does not see the ledger');
select throws_ok(
  $$ insert into public.ai_invoices (org_id, month, amount_usd, recorded_by) values ('00000000-0000-4000-a000-000000000001', '2026-09-01', 10, '00000000-0000-4000-d000-000000000005') $$,
  '42501', null, 'lectura cannot record invoices');
reset role;

select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;
select is((select count(*) from public.ai_limits), 0::bigint, 'dependencia does not see limits');
reset role;

select pg_temp.login('00000000-0000-4000-d000-000000000001');
set local role authenticated;
select lives_ok($$ update public.ai_limits set user_daily_requests = 50, updated_by = '00000000-0000-4000-d000-000000000001' $$, 'admin changes limits');
select throws_ok($$ update public.ai_limits set updated_by = '00000000-0000-4000-d000-000000000002' $$, '42501', null, 'with their own identity only');
select throws_ok($$ update public.ai_limits set max_concurrent = '{"assistant": 0}', updated_by = '00000000-0000-4000-d000-000000000001' $$, '23514', null,
  'concurrency must be between 1 and 50 per known purpose');
reset role;

-- Leases: one holder at a time; an expired one can be taken.
set local role service_role;
select is(
  array[public.acquire_ai_lease('00000000-0000-4000-a000-000000000001', 'daily_reading', '00000000-0000-0000-0000-0000000000a1', 60),
        public.acquire_ai_lease('00000000-0000-4000-a000-000000000001', 'daily_reading', '00000000-0000-0000-0000-0000000000a2', 60)],
  array[true, false], 'a persisted lease admits one holder');
reset role;

select * from finish();
rollback;
