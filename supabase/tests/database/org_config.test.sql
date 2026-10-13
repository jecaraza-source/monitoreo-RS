-- Stage 11: municipal configuration. Who may edit each element (RLS), every
-- change audited with before/after and actor, SLA changes that never move
-- commitments unless reapplied explicitly, retention that respects cases and
-- conservation holds, audited exports and onboarding checks. Fictitious data.
begin;
select plan(38);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create temp table ids (k text primary key, v uuid) on commit drop;
create temp table free on commit drop as
  select m.id from public.mentions m
  where m.org_id = '00000000-0000-4000-a000-000000000001'
    and not exists (select 1 from public.tickets t where t.mention_id = m.id)
    and not exists (select 1 from public.case_mentions cm where cm.mention_id = m.id)
  order by m.id limit 3;
grant all on ids, free to authenticated;
create function pg_temp.v(p_k text) returns uuid language sql as $$ select v from ids where k = p_k $$;

-- ---------------------------------------------------------------------------
-- Case categories and capabilities: everyone reads, only admin writes, audited
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;
select ok((select count(*) from public.case_categories) >= 4, 'a department reads the category catalog');
select throws_ok($$ insert into public.case_categories (org_id, name) values ('00000000-0000-4000-a000-000000000001', 'Otra') $$, '42501', null,
  'a department cannot add categories');
reset role;

select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select throws_ok($$ insert into public.case_categories (org_id, name) values ('00000000-0000-4000-a000-000000000001', 'Otra') $$, '42501', null,
  'comunicación cannot add categories (admin only)');
reset role;

select pg_temp.login('00000000-0000-4000-d000-000000000001');
set local role authenticated;
with x as (
  insert into public.case_categories (org_id, name, default_department_id) values ('00000000-0000-4000-a000-000000000001', 'Poda de árboles', null) returning id
) insert into ids select 'cat', id from x;
update public.case_categories set name = 'Poda y limpieza' where id = pg_temp.v('cat');
insert into public.department_capabilities (org_id, department_id, category_id)
values ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-b000-000000000003', pg_temp.v('cat'));
select throws_ok($$ insert into public.case_categories (org_id, name) values ('00000000-0000-4000-a000-000000000001', 'poda y LIMPIEZA') $$, '23505', null,
  'category names are unique ignoring case');
select throws_ok($$ insert into public.department_capabilities (org_id, department_id, category_id)
  values ('00000000-0000-4000-a000-000000000001', (select id from public.departments where org_id <> '00000000-0000-4000-a000-000000000001' limit 1), (select v from ids where k = 'cat')) $$,
  null, null, 'a capability cannot point to another municipality''s department');
reset role;
select is(
  (select changes -> 'name' from public.audit_log where entity = 'case_categories' and entity_id = pg_temp.v('cat')::text and action = 'update'),
  '["Poda de árboles", "Poda y limpieza"]'::jsonb, 'a category change is audited with before and after');
select is((select actor_id from public.audit_log where entity = 'case_categories' and entity_id = pg_temp.v('cat')::text and action = 'update'),
  '00000000-0000-4000-d000-000000000001'::uuid, 'and the person who made it');
select is((select count(*) from public.audit_log where entity = 'department_capabilities' and action = 'insert' and actor_id = '00000000-0000-4000-d000-000000000001'),
  1::bigint, 'capabilities are audited too');

-- ---------------------------------------------------------------------------
-- SLA: audited tables; a new version never moves existing commitments
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
insert into ids values ('auto', public.create_case('00000000-0000-4000-a000-000000000001', array[(select id from free order by id limit 1)],
  'Fuga en la calle Hidalgo', '', 'agua potable', null, 'high'));
insert into ids values ('manual', public.create_case('00000000-0000-4000-a000-000000000001', array[(select id from free order by id offset 1 limit 1)],
  'Fuga en la calle Allende', '', 'agua potable', null, 'high'));
select public.assign_case(pg_temp.v('auto'), '00000000-0000-4000-b000-000000000002', null, null);
select public.assign_case(pg_temp.v('manual'), '00000000-0000-4000-b000-000000000002', now() + interval '20 days', now() + interval '1 day');
reset role;
create temp table before_sla on commit drop as select id, due_at, sla_version_id from public.cases where id in (pg_temp.v('auto'), pg_temp.v('manual'));
grant select on before_sla to authenticated;

-- Admin saves a new SLA with longer attention for high priority.
select pg_temp.login('00000000-0000-4000-d000-000000000001');
set local role authenticated;
select lives_ok($$
  select public.save_sla_config('00000000-0000-4000-a000-000000000001',
    (select jsonb_build_object('mode', mode, 'workdays', workdays, 'day_start', day_start, 'day_end', day_end) from public.sla_calendars where org_id = '00000000-0000-4000-a000-000000000001'),
    '[]'::jsonb,
    (select jsonb_agg(jsonb_build_object('category', category, 'priority', priority, 'accept_hours', accept_hours,
                                         'attention_hours', case when priority = 'high' then attention_hours + 24 else attention_hours end))
     from public.sla_targets where org_id = '00000000-0000-4000-a000-000000000001'))
$$, 'admin saves a new SLA version');
reset role;
select ok(exists (select 1 from public.audit_log where entity = 'sla_targets' and actor_id = '00000000-0000-4000-d000-000000000001'),
  'changes to SLA targets are audited with the actor');
select is((select count(*) from public.cases c join before_sla b using (id) where c.due_at is distinct from b.due_at or c.sla_version_id is distinct from b.sla_version_id),
  0::bigint, 'saving a new SLA does not change any existing commitment');

-- Preview and explicit reapplication.
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select throws_ok($$ select * from public.sla_reapply_preview('00000000-0000-4000-a000-000000000001') $$, '42501', null, 'comunicación cannot preview a reapplication');
select throws_ok($$ select public.reapply_sla('00000000-0000-4000-a000-000000000001', array[(select v from ids where k = 'auto')], 'Acuerdo de cabildo 12') $$,
  '42501', null, 'nor reapply the SLA');
reset role;

select pg_temp.login('00000000-0000-4000-d000-000000000001');
set local role authenticated;
select is((select applies from public.sla_reapply_preview('00000000-0000-4000-a000-000000000001') where case_id = pg_temp.v('auto')), true,
  'the preview lists the case with its new commitment');
select is((select row(applies, overridden)::text from public.sla_reapply_preview('00000000-0000-4000-a000-000000000001') where case_id = pg_temp.v('manual')),
  '(f,t)', 'a manual deadline is listed but not applied by default');
select throws_ok($$ select public.reapply_sla('00000000-0000-4000-a000-000000000001', array[(select v from ids where k = 'auto')], 'porque') $$,
  '22023', null, 'a reason is required');
select is(public.reapply_sla('00000000-0000-4000-a000-000000000001', array[pg_temp.v('auto'), pg_temp.v('manual')], 'Acuerdo de cabildo 12: plazos nuevos para fugas'),
  1, 'only the case without manual deadline changes');
reset role;
select is((select c.due_at - b.due_at from public.cases c join before_sla b using (id) where c.id = pg_temp.v('auto')), interval '24 hours',
  'its commitment moves by the new hours from the same assignment');
select is((select c.due_at from public.cases c where c.id = pg_temp.v('manual')), (select due_at from before_sla where id = pg_temp.v('manual')),
  'the manual deadline is untouched');
select is((select reason from public.case_events where case_id = pg_temp.v('auto') and operation = 'sla_reapplied'),
  'Acuerdo de cabildo 12: plazos nuevos para fugas', 'the case history keeps the reason');
select ok((select changes ? 'due_at' and changes ? 'sla_version' from public.case_events where case_id = pg_temp.v('auto') and operation = 'sla_reapplied'),
  'with before/after of deadline and version');
select is((select actor_id from public.audit_log where entity = 'cases' and entity_id = pg_temp.v('auto')::text and changes ->> 'operation' = 'reapply_sla'),
  '00000000-0000-4000-d000-000000000001'::uuid, 'and the audit log the actor');

-- ---------------------------------------------------------------------------
-- Retention: per municipality, never cases or held data
-- ---------------------------------------------------------------------------
insert into public.mentions (id, org_id, source_id, external_id, text, published_at, status) values
  ('00000000-0000-4000-9b00-000000000001', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e200-000000000002', 'ret-free', 'Antigua sin caso', now() - interval '40 months', 'classified'),
  ('00000000-0000-4000-9b00-000000000002', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e200-000000000002', 'ret-case', 'Antigua en un caso', now() - interval '40 months', 'classified'),
  ('00000000-0000-4000-9b00-000000000003', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e200-000000000002', 'ret-held', 'Antigua conservada', '2023-01-15 12:00-06', 'classified');
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select public.case_add_mentions(pg_temp.v('auto'), array['00000000-0000-4000-9b00-000000000002'::uuid]);
reset role;

select pg_temp.login('00000000-0000-4000-d000-000000000005');
set local role authenticated;
select is((select count(*) from public.retention_policies), 0::bigint, 'lectura does not see the retention policy');
reset role;

select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select throws_ok($$ insert into public.retention_policies (org_id, mention_months, updated_by) values ('00000000-0000-4000-a000-000000000001', null, '00000000-0000-4000-d000-000000000002') $$,
  '42501', null, 'comunicación cannot set the retention policy');
reset role;

select pg_temp.login('00000000-0000-4000-d000-000000000001');
set local role authenticated;
select throws_ok($$ insert into public.retention_policies (org_id, mention_months, updated_by) values ('00000000-0000-4000-a000-000000000001', 24, '00000000-0000-4000-d000-000000000001') $$,
  '23514', null, 'a deletion term needs the municipal agreement (no legal term is assumed)');
select lives_ok($$ insert into public.retention_policies (org_id, mention_months, agreement_reference, agreement_date, updated_by)
  values ('00000000-0000-4000-a000-000000000001', 24, 'Acta de cabildo 7 (ficticia)', '2026-09-01', '00000000-0000-4000-d000-000000000001') $$,
  'with its agreement it is accepted');
with x as (
  insert into public.retention_holds (org_id, covers_from, covers_to, reason, created_by)
  values ('00000000-0000-4000-a000-000000000001', '2023-01-01', '2023-01-31', 'Solicitud de información en trámite (ficticia).', '00000000-0000-4000-d000-000000000001')
  returning id
) insert into ids select 'hold', id from x;
select throws_ok($$ update public.retention_holds set covers_to = '2023-12-31' where id = (select v from ids where k = 'hold') $$, '42501', null,
  'a hold is never edited (release it and create another)');
select throws_ok($$ delete from public.retention_holds where id = (select v from ids where k = 'hold') $$, '42501', null, 'nor deleted');
select is((public.retention_preview('00000000-0000-4000-a000-000000000001', 24) - 'cutoff' - 'older'),
  jsonb_build_object('kept_in_case', 1, 'kept_by_hold', 1, 'deletable', (public.retention_preview('00000000-0000-4000-a000-000000000001', 24) ->> 'deletable')::integer),
  'the preview separates what is kept by a case and by a hold');
reset role;

set local role service_role;
select ok(public.purge_org_mentions('00000000-0000-4000-a000-000000000001', 24, 5000, 'acuerdo: prueba') >= 1, 'the purge deletes what is not protected');
reset role;
select is((select array_agg(external_id order by external_id) from public.mentions where id::text like '00000000-0000-4000-9b00-%'),
  array['ret-case', 'ret-held'], 'the mention in a case and the held one remain');
select is((select changes ->> 'basis' from public.audit_log where action = 'purge' order by id desc limit 1), 'acuerdo: prueba', 'the purge is logged with its basis');

-- ---------------------------------------------------------------------------
-- Exports and onboarding
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;
select throws_ok($$ select public.log_export('00000000-0000-4000-a000-000000000001', 'cases', '{}', 1) $$, '42501', null, 'a department cannot export');
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select lives_ok($$ select public.log_export('00000000-0000-4000-a000-000000000001', 'cases', '{"desde":"2026-09-01"}', 12) $$, 'comunicación exports cases');
select throws_ok($$ insert into public.onboarding_checks (org_id, key, done_by, note) values ('00000000-0000-4000-a000-000000000001', 'prueba_enlace', '00000000-0000-4000-d000-000000000002', 'Probado') $$,
  '42501', null, 'only admin records onboarding checks');
reset role;
select is((select changes -> 'rows' from public.audit_log where action = 'export' and actor_id = '00000000-0000-4000-d000-000000000002' order by id desc limit 1),
  '12'::jsonb, 'the export is in the audit log with who and how many rows');

select pg_temp.login('00000000-0000-4000-d000-000000000001');
set local role authenticated;
select throws_ok($$ insert into public.onboarding_checks (org_id, key, done_by, note) values ('00000000-0000-4000-a000-000000000001', 'prueba_enlace', '00000000-0000-4000-d000-000000000003', 'Probado') $$,
  '42501', null, 'with their own identity only');
select lives_ok($$ insert into public.onboarding_checks (org_id, key, done_by, note) values ('00000000-0000-4000-a000-000000000001', 'prueba_enlace', '00000000-0000-4000-d000-000000000001', 'El enlace atendió el caso de práctica') $$,
  'admin records a per-role test');
reset role;

select * from finish();
rollback;
