-- Source credentials live in Vault: editors can set them, nobody but the
-- service role can read them back.
begin;
select plan(9);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- comunicacion stores a page token.
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select lives_ok($$ select public.set_source_secret('00000000-0000-4000-e200-000000000001', ' token-123 ') $$,
  'comunicacion can store a source credential');
select is((select has_secret from public.sources where id = '00000000-0000-4000-e200-000000000001'), true,
  'the source reports a stored credential');
select throws_ok($$ select public.get_source_secret('00000000-0000-4000-e200-000000000001') $$, '42501', null,
  'users cannot read credentials back');
select throws_ok($$ update public.sources set has_secret = false where id = '00000000-0000-4000-e200-000000000001' $$,
  '42501', null, 'has_secret is not writable through the API');
select throws_ok($$ insert into public.ingest_runs (org_id, source_id, trigger, status, started_at)
  values ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e200-000000000001', 'manual', 'ok', now()) $$,
  '42501', null, 'run log is written only by the worker');

-- lectura and dependencia cannot set credentials.
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000005');
set local role authenticated;
select throws_ok($$ select public.set_source_secret('00000000-0000-4000-e200-000000000001', 'x') $$, '42501', null,
  'lectura cannot store credentials');

-- The worker reads it, trimmed.
reset role;
set local role service_role;
select is(public.get_source_secret('00000000-0000-4000-e200-000000000001'), 'token-123',
  'service role reads the decrypted credential');

-- Clearing removes it from Vault.
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000001');
set local role authenticated;
select public.clear_source_secret('00000000-0000-4000-e200-000000000001');
reset role;
select is((select count(*) from vault.secrets where name = 'source:00000000-0000-4000-e200-000000000001'), 0::bigint,
  'clearing deletes the Vault secret');
select is((select has_secret from public.sources where id = '00000000-0000-4000-e200-000000000001'), false,
  'the source no longer reports a credential');

select * from finish();
rollback;
