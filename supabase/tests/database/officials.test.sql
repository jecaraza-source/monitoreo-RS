-- Perception of officials: restricted access, logged queries, anonymous citizens.
begin;
select plan(16);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- Matching ------------------------------------------------------------------
select ok((select count(*) from public.official_mentions where official_id = '00000000-0000-4000-e500-000000000001') >= 6,
  'mentions that name the mayor or her aliases are linked to her');
insert into public.mentions (id, org_id, source_id, external_id, text, published_at, status)
select '00000000-0000-4000-f100-000000000099', '00000000-0000-4000-a000-000000000001', id, 'test-official', 'Otra vez la ALCALDESA sin dar explicaciones', now(), 'pending'
from public.sources where org_id = '00000000-0000-4000-a000-000000000001' limit 1;
select ok(exists (select 1 from public.official_mentions where mention_id = '00000000-0000-4000-f100-000000000099'
  and official_id = '00000000-0000-4000-e500-000000000001'), 'new mentions are matched as they arrive, ignoring case');
update public.officials set aliases = array['presidenta municipal'] where id = '00000000-0000-4000-e500-000000000001';
select ok(not exists (select 1 from public.official_mentions where mention_id = '00000000-0000-4000-f100-000000000099'),
  'editing the aliases recomputes the matches');
insert into public.officials (org_id, name, position, aliases)
values ('00000000-0000-4000-a000-000000000001', 'Nueva Funcionaria', 'Regidora', array['alcaldesa']);
select ok(exists (select 1 from public.official_mentions om join public.officials o on o.id = om.official_id
  where o.name = 'Nueva Funcionaria' and om.mention_id = '00000000-0000-4000-f100-000000000099'),
  'a new official is matched against past mentions');

-- Access --------------------------------------------------------------------
select pg_temp.login('00000000-0000-4000-d000-000000000005'); -- lectura, not granted
set local role authenticated;
select is((select count(*)::int from public.officials), 0, 'without the grant the catalog is hidden');
select throws_ok($$ select public.officials_stats('00000000-0000-4000-a000-000000000001', now() - interval '30 days', now(), now() - interval '60 days') $$,
  '42501', null, 'and the stats are refused');
select is(public.can_view_officials('00000000-0000-4000-a000-000000000001'), false, 'the menu hides the module');
select throws_ok($$ select count(*) from public.official_mentions $$, '42501', null, 'the match table is never readable directly');

select pg_temp.login('00000000-0000-4000-d000-000000000003'); -- dependencia
select throws_ok($$ select public.officials_stats('00000000-0000-4000-a000-000000000001', now() - interval '30 days', now(), now() - interval '60 days') $$,
  '42501', null, 'a department never sees it');

select pg_temp.login('00000000-0000-4000-d000-000000000002'); -- comunicacion, granted
select is(public.can_view_officials('00000000-0000-4000-a000-000000000001'), true, 'a granted member opens the module');
select is(jsonb_array_length(public.officials_stats('00000000-0000-4000-a000-000000000001', now() - interval '30 days', now(), now() - interval '60 days') -> 'officials'),
  3, 'stats cover every active official');
update public.officials set name = 'Otro nombre' where id = '00000000-0000-4000-e500-000000000002';
select is((select name from public.officials where id = '00000000-0000-4000-e500-000000000002'), 'Raúl Méndez',
  'only admins edit the catalog');
create temporary table listed on commit drop as
  select * from public.official_mentions_list('00000000-0000-4000-a000-000000000001',
    '00000000-0000-4000-e500-000000000001', now() - interval '30 days', now());
reset role;
select is((select count(*)::int from listed l join public.mentions m on m.id = l.mention_id
           join public.authors a on a.id = m.author_id
           where a.kind = 'citizen' and (l.author is not null or l.url is not null)), 0,
  'citizens stay anonymous: no author or link');
select ok(exists (select 1 from public.audit_log where action = 'view' and entity = 'officials'
  and actor_id = '00000000-0000-4000-d000-000000000002'), 'every consultation is logged with who made it');

-- Grants are admin decisions, audited like any membership change.
select pg_temp.login('00000000-0000-4000-d000-000000000001');
set local role authenticated;
update public.memberships set can_view_officials = true where user_id = '00000000-0000-4000-d000-000000000005';
reset role;
select is((select can_view_officials from public.memberships where user_id = '00000000-0000-4000-d000-000000000005'), true,
  'an admin grants access');
select pg_temp.login('00000000-0000-4000-d000-000000000005');
set local role authenticated;
select is(public.can_view_officials('00000000-0000-4000-a000-000000000001'), true, 'and the grant takes effect');
reset role;

select * from finish();
rollback;
