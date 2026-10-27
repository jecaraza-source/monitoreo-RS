-- Oficina de Contrainteligencia: only members with the explicit grant (admins
-- too) see it; lectura reads, admin and comunicación register; no deletes;
-- leads come from content (indicators of open reports, threats) and never
-- name a citizen. Fictitious data.
begin;
select plan(27);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create temp table ids (k text primary key, v uuid) on commit drop;
grant all on ids to authenticated;
create function pg_temp.v(p_k text) returns uuid language sql as $$ select v from ids where k = p_k $$;

-- Org A: admin 001, comunicación 002, dependencia 003, lectura 005. Org B admin 011.
-- Without the grant nobody sees the office, not even the admin.
select pg_temp.login('00000000-0000-4000-d000-000000000001');
set local role authenticated;
select is(public.can_view_counterintel('00000000-0000-4000-a000-000000000001'), false, 'an admin without the grant does not see the office');
select throws_ok($$ select public.ci_overview('00000000-0000-4000-a000-000000000001', now() - interval '30 days') $$, '42501', null,
  'nor its leads');
select throws_ok($$ insert into public.ci_reports (org_id, kind, title, created_by)
  values ('00000000-0000-4000-a000-000000000001', 'threat', 'Sin permiso', '00000000-0000-4000-d000-000000000001') $$,
  '42501', null, 'nor can register');
reset role;

update public.memberships set can_view_counterintel = true
where org_id = '00000000-0000-4000-a000-000000000001'
  and user_id in ('00000000-0000-4000-d000-000000000001', '00000000-0000-4000-d000-000000000002',
                  '00000000-0000-4000-d000-000000000003', '00000000-0000-4000-d000-000000000005');

-- Content: a post that spreads a fake page, an unrelated post, and a threat.
with x as (
  insert into public.mentions (org_id, source_id, external_id, text, published_at, status)
  values ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e200-000000000001', 'ci-fake-1',
          'Regístrate en apoyos-valle-gob.mx para recibir tu apoyo', now() - interval '1 day', 'classified')
  returning id
) insert into ids select 'm_fake', id from x;
with x as (
  insert into public.mentions (org_id, source_id, external_id, text, published_at, status)
  values ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e200-000000000001', 'ci-other-1',
          'El ayuntamiento no arregla los baches de mi calle', now() - interval '2 days', 'classified')
  returning id
) insert into ids select 'm_other', id from x;
with x as (
  insert into public.mentions (org_id, source_id, external_id, text, published_at, status)
  values ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e200-000000000001', 'ci-threat-1',
          'Amenazan con quemar la caseta de policía del centro', now() - interval '3 hours', 'classified')
  returning id
) insert into ids select 'm_threat', id from x;
insert into public.classifications (org_id, mention_id, sentiment, topic, priority, severity, incident_type, model)
values ('00000000-0000-4000-a000-000000000001', pg_temp.v('m_threat'), 'negative', 'seguridad', 'high', 'emergency', 'violence', 'test');

-- Comunicación registers a report with an indicator and evidence.
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
with x as (
  insert into public.ci_reports (org_id, kind, title, summary, severity, indicators, mention_ids, created_by)
  values ('00000000-0000-4000-a000-000000000001', 'impersonation', 'Página falsa pide datos para apoyos', 'Prueba', 'high',
          array['apoyos-valle-gob.mx'], array[(select v from ids where k = 'm_fake')], '00000000-0000-4000-d000-000000000002')
  returning id
) insert into ids select 'report', id from x;
select is((select status from public.ci_reports where id = pg_temp.v('report')), 'open', 'comunicación registers a report');
select throws_ok($$ insert into public.ci_reports (org_id, kind, title, mention_ids, created_by)
  values ('00000000-0000-4000-a000-000000000001', 'threat', 'Evidencia ajena',
          array[(select id from public.mentions where org_id = '00000000-0000-4000-a000-00000000000b' limit 1)],
          '00000000-0000-4000-d000-000000000002') $$,
  '22023', null, 'evidence from another municipality is refused');
select throws_ok($$ insert into public.ci_reports (org_id, kind, title, created_by)
  values ('00000000-0000-4000-a000-000000000001', 'threat', 'A nombre de otro', '00000000-0000-4000-d000-000000000001') $$,
  '42501', null, 'nobody registers on behalf of someone else');
select throws_ok($$ insert into public.ci_reports (org_id, kind, title, created_by)
  values ('00000000-0000-4000-a000-000000000001', 'profiling', 'Tipo inventado', '00000000-0000-4000-d000-000000000002') $$,
  '23514', null, 'only the four kinds of the office exist');
reset role;

-- lectura reads the office; the leads are logged.
select pg_temp.login('00000000-0000-4000-d000-000000000005');
set local role authenticated;
select is(public.can_view_counterintel('00000000-0000-4000-a000-000000000001'), true, 'lectura with the grant sees the office');
select is((select count(*) from public.ci_reports where id = pg_temp.v('report')), 1::bigint, 'and its register');
create temp table overview on commit drop as
  select public.ci_overview('00000000-0000-4000-a000-000000000001', now() - interval '30 days') as o;
select throws_ok($$ insert into public.ci_reports (org_id, kind, title, created_by)
  values ('00000000-0000-4000-a000-000000000001', 'threat', 'Lectura no registra', '00000000-0000-4000-d000-000000000005') $$,
  '42501', null, 'lectura reads but does not register');
reset role;
select is((select count(*) from public.audit_log where entity = 'counterintel' and action = 'view'
           and actor_id = '00000000-0000-4000-d000-000000000005'), 1::bigint, 'the consultation is logged');
select is((select x ->> 'indicator' from overview, jsonb_array_elements(o -> 'matches') x where (x ->> 'id')::uuid = pg_temp.v('m_fake')),
  'apoyos-valle-gob.mx', 'a mention carrying the indicator of an open report is a lead');
select ok(not exists (select 1 from overview, jsonb_array_elements(o -> 'matches') x where (x ->> 'id')::uuid = pg_temp.v('m_other')),
  'a complaint about the city hall is not');
select ok(exists (select 1 from overview, jsonb_array_elements(o -> 'threats') x where (x ->> 'id')::uuid = pg_temp.v('m_threat')),
  'an emergency about violence is a possible threat');
select ok(not exists (select 1 from overview, jsonb_array_elements(o -> 'threats') x where (x ->> 'id')::uuid = pg_temp.v('m_other')),
  'a complaint is not a threat');
select is((select x ->> 'author' from overview, jsonb_array_elements(o -> 'threats') x where (x ->> 'id')::uuid = pg_temp.v('m_threat')),
  null, 'the threat is listed without naming anyone');

-- A department never sees the office, even if the column were set.
select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;
select is(public.can_view_counterintel('00000000-0000-4000-a000-000000000001'), false, 'a department never sees the office');
select is((select count(*) from public.ci_reports), 0::bigint, 'nor its register');
reset role;

-- The admin follows it up and closes it; closed reports stop producing leads.
select pg_temp.login('00000000-0000-4000-d000-000000000001');
set local role authenticated;
update public.ci_reports set status = 'monitoring' where id = pg_temp.v('report');
select is((select status from public.ci_reports where id = pg_temp.v('report')), 'monitoring', 'the admin follows it up');
update public.ci_reports set status = 'closed', closed_note = 'Meta dio de baja la página.' where id = pg_temp.v('report');
select isnt((select closed_at from public.ci_reports where id = pg_temp.v('report')), null, 'closing stamps the date');
select is(jsonb_array_length(public.ci_overview('00000000-0000-4000-a000-000000000001', now() - interval '30 days') -> 'matches'), 0,
  'a closed report no longer produces leads');
delete from public.ci_reports where id = pg_temp.v('report');
select is((select count(*) from public.ci_reports where id = pg_temp.v('report')), 1::bigint, 'reports are never deleted');
update public.ci_reports set status = 'open' where id = pg_temp.v('report');
select is((select closed_note from public.ci_reports where id = pg_temp.v('report')), null, 'reopening clears the closing note');
reset role;
select is((select count(*) from public.audit_log where entity = 'ci_reports' and entity_id = pg_temp.v('report')::text), 4::bigint,
  'every change is in the audit log');

-- Another municipality sees nothing, even with its own grant.
update public.memberships set can_view_counterintel = true where user_id = '00000000-0000-4000-d000-000000000011';
select pg_temp.login('00000000-0000-4000-d000-000000000011');
set local role authenticated;
select is((select count(*) from public.ci_reports where org_id = '00000000-0000-4000-a000-000000000001'), 0::bigint,
  'another municipality does not see the register');
select throws_ok($$ select public.ci_overview('00000000-0000-4000-a000-000000000001', now() - interval '30 days') $$, '42501', null,
  'nor the leads');
reset role;

-- Revoking the grant closes the office at once.
update public.memberships set can_view_counterintel = false where user_id = '00000000-0000-4000-d000-000000000005';
select pg_temp.login('00000000-0000-4000-d000-000000000005');
set local role authenticated;
select is((select count(*) from public.ci_reports), 0::bigint, 'without the grant lectura no longer sees the register');
reset role;

select * from finish();
rollback;
