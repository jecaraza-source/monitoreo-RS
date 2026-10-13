-- Deleting a project: only Administración, never the last one, mentions kept
-- (detached from the deleted queries), audited. Comunicación still creates and
-- edits projects. Fictitious data.
begin;
select plan(15);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create temp table ids (k text primary key, v uuid) on commit drop;
grant all on ids to authenticated;
create function pg_temp.v(p_k text) returns uuid language sql as $$ select v from ids where k = p_k $$;

-- A second project with one query that captured one mention.
with x as (
  insert into public.projects (org_id, name) values ('00000000-0000-4000-a000-000000000001', 'Proyecto para borrar') returning id
) insert into ids select 'proj', id from x;
with x as (
  insert into public.queries (org_id, project_id, name, expression)
  values ('00000000-0000-4000-a000-000000000001', (select v from ids where k = 'proj'), 'Consulta temporal', 'bache') returning id
) insert into ids select 'query', id from x;
insert into ids select 'mention', id from (
  select id from public.mentions where org_id = '00000000-0000-4000-a000-000000000001' order by id limit 1) x;
update public.mentions set query_id = pg_temp.v('query') where id = pg_temp.v('mention');

-- Nobody but Administración of the same municipality can delete it.
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select throws_ok($$ select public.delete_project((select v from ids where k = 'proj')) $$, '42501', null, 'comunicación cannot delete a project');
delete from public.projects where id = pg_temp.v('proj');
select is((select count(*) from public.projects where id = pg_temp.v('proj')), 1::bigint, 'nor delete it directly through the API (RLS)');
update public.projects set goal = 'Objetivo editado por comunicación' where id = pg_temp.v('proj');
select is((select goal from public.projects where id = pg_temp.v('proj')), 'Objetivo editado por comunicación', 'comunicación still edits projects');
select lives_ok($$ insert into public.projects (org_id, name) values ('00000000-0000-4000-a000-000000000001', 'Creado por comunicación') $$,
  'and still creates them');
reset role;
delete from public.projects where name = 'Creado por comunicación';

select pg_temp.login('00000000-0000-4000-d000-000000000005');
set local role authenticated;
select throws_ok($$ select public.delete_project((select v from ids where k = 'proj')) $$, '42501', null, 'lectura cannot delete a project');
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;
select throws_ok($$ select public.delete_project((select v from ids where k = 'proj')) $$, '42501', null, 'a department cannot delete a project');
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000011');
set local role authenticated;
select throws_ok($$ select public.delete_project((select v from ids where k = 'proj')) $$, '42501', null, 'another municipality''s admin cannot delete it');
reset role;
select is((select count(*) from public.projects where id = pg_temp.v('proj')), 1::bigint, 'after all those attempts the project is still there');

-- Administración deletes it: the mention stays, detached from the deleted query.
select pg_temp.login('00000000-0000-4000-d000-000000000001');
set local role authenticated;
select is(public.delete_project(pg_temp.v('proj')), '{"mentions_kept": 1, "queries_removed": 1}'::jsonb, 'admin deletes it and is told what was kept');
reset role;
select is((select count(*) from public.projects where id = pg_temp.v('proj')), 0::bigint, 'the project is gone');
select is((select count(*) from public.queries where project_id = pg_temp.v('proj')), 0::bigint, 'with its queries');
select is((select query_id from public.mentions where id = pg_temp.v('mention')), null::uuid, 'the mention is kept, without the deleted query');
select is(
  (select actor_id from public.audit_log where entity = 'projects' and entity_id = pg_temp.v('proj')::text and action = 'delete'),
  '00000000-0000-4000-d000-000000000001'::uuid, 'the deletion is in the audit log with who did it');

-- The last project cannot be deleted.
select pg_temp.login('00000000-0000-4000-d000-000000000001');
set local role authenticated;
select throws_ok(
  $$ select public.delete_project((select id from public.projects where org_id = '00000000-0000-4000-a000-000000000001' limit 1)) $$,
  'P0001', 'Es el único proyecto del municipio; crea otro antes de borrarlo.', 'the municipality''s last project cannot be deleted');
reset role;

select ok(not has_function_privilege('anon', 'public.delete_project(uuid)', 'execute'), 'anonymous callers cannot run it');
select * from finish();
rollback;
