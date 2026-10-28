-- Unofficial sources (RSSHub/RSS-Bridge feeds, Apify tasks): only an admin
-- connects or reconfigures them; comunicación can pause them and still
-- manages official sources; the ingest worker (no user) is not blocked.
begin;
select plan(8);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- Org A: admin 001, comunicación 002.
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select throws_ok($$ insert into public.sources (org_id, name, type, config)
  values ('00000000-0000-4000-a000-000000000001', 'Apify e2e', 'apify', '{"task":"yo~ig","network":"instagram"}') $$,
  '42501', null, 'comunicación cannot connect an unofficial source');
select lives_ok($$ insert into public.sources (org_id, name, type, config)
  values ('00000000-0000-4000-a000-000000000001', 'RSS oficial', 'rss', '{"url":"https://diario.example/feed"}') $$,
  'but still connects official ones');
reset role;

select pg_temp.login('00000000-0000-4000-d000-000000000001');
set local role authenticated;
select lives_ok($$ insert into public.sources (org_id, name, type, config)
  values ('00000000-0000-4000-a000-000000000001', 'Puente Telegram', 'rss_bridge', '{"url":"https://rsshub.example.mx/telegram/channel/a","network":"telegram"}') $$,
  'an admin connects an unofficial source');
reset role;

select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select throws_ok($$ update public.sources set config = '{"url":"https://otro.example/feed","network":"telegram"}' where name = 'Puente Telegram' $$,
  '42501', null, 'comunicación cannot reconfigure it');
select throws_ok($$ update public.sources set name = 'Otro nombre' where name = 'Puente Telegram' $$,
  '42501', null, 'nor rename it');
update public.sources set is_active = false where name = 'Puente Telegram';
select is((select is_active from public.sources where name = 'Puente Telegram'), false, 'but can pause it');
reset role;

-- The ingest worker writes errors and watermarks without a user.
select set_config('request.jwt.claims', '', true);
select lives_ok($$ update public.sources set last_error = 'prueba' where name = 'Puente Telegram' $$, 'the worker is not blocked');

select pg_temp.login('00000000-0000-4000-d000-000000000001');
set local role authenticated;
select lives_ok($$ update public.sources set config = '{"url":"https://otro.example/feed","network":"x"}' where name = 'Puente Telegram' $$,
  'an admin reconfigures it');
reset role;

select * from finish();
rollback;
