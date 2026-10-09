-- ai_usage ledger: daily upsert by service role, read only by admin/comunicacion.
begin;
select plan(6);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

set local role service_role;
select public.record_ai_usage('00000000-0000-4000-a000-000000000001', 'claude-haiku-5-5', 'classify', 1000, 200, 3000, 0, 0.0004);
select public.record_ai_usage('00000000-0000-4000-a000-000000000001', 'claude-haiku-5-5', 'classify', 500, 100, 3000, 0, 0.0002);
reset role;

select is((select requests from public.ai_usage where model = 'claude-haiku-5-5'), 2, 'same day/model/purpose accumulates in one row');
select is((select input_tokens from public.ai_usage where model = 'claude-haiku-5-5'), 1500::bigint, 'input tokens are summed');
select is((select cost_usd from public.ai_usage where model = 'claude-haiku-5-5'), 0.000600::numeric, 'cost is summed');

select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select is((select count(*) from public.ai_usage), 1::bigint, 'comunicacion reads the ledger');
select throws_ok(
  $$ select public.record_ai_usage('00000000-0000-4000-a000-000000000001', 'x', 'classify', 1, 1, 0, 0, 1) $$,
  '42501', null, 'authenticated users cannot write usage');
reset role;

select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;
select is((select count(*) from public.ai_usage), 0::bigint, 'dependencia does not see the ledger');
reset role;

select * from finish();
rollback;
