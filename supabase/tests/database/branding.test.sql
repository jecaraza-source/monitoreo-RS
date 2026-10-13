-- Client logo: only an org's admin sets it, always inside the org's folder of
-- the private "branding" bucket, and only that org's members can read it.
-- Fictitious data.
begin;
select plan(8);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

insert into storage.objects (bucket_id, name) values
  ('branding', '00000000-0000-4000-a000-000000000001/logo-1.png'),
  ('branding', '00000000-0000-4000-a000-00000000000b/logo-1.png');

select is((select public from storage.buckets where id = 'branding'), false, 'the bucket is private');

select pg_temp.login('00000000-0000-4000-d000-000000000001');
set local role authenticated;
select lives_ok($$ update public.organizations set logo_path = '00000000-0000-4000-a000-000000000001/logo-1.png', logo_updated_at = now()
                   where id = '00000000-0000-4000-a000-000000000001' $$, 'the admin sets the logo');
select throws_ok($$ update public.organizations set logo_path = '00000000-0000-4000-a000-00000000000b/logo-1.png'
                    where id = '00000000-0000-4000-a000-000000000001' $$, '23514', null, 'never a file of another municipality');
select throws_ok($$ update public.organizations set logo_path = '00000000-0000-4000-a000-000000000001/../x.svg'
                    where id = '00000000-0000-4000-a000-000000000001' $$, '23514', null, 'only logo-<n>.png|jpg paths');
select is((select count(*) from storage.objects where bucket_id = 'branding'), 1::bigint, 'members read only their own logo');
reset role;

select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
update public.organizations set logo_path = null where id = '00000000-0000-4000-a000-000000000001';
reset role;
select isnt((select logo_path from public.organizations where id = '00000000-0000-4000-a000-000000000001'), null, 'comunicación cannot change it');

select pg_temp.login('00000000-0000-4000-d000-000000000011');
set local role authenticated;
update public.organizations set logo_path = null where id = '00000000-0000-4000-a000-000000000001';
select is((select name from storage.objects where bucket_id = 'branding'), '00000000-0000-4000-a000-00000000000b/logo-1.png', 'the other municipality sees only its own');
reset role;
select isnt((select logo_path from public.organizations where id = '00000000-0000-4000-a000-000000000001'), null, 'nor another municipality');

select * from finish();
rollback;
