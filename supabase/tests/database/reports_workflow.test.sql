-- Reports workflow against direct API/SQL access (stage 1): what an editor,
-- lectura, dependencia, another municipality and the server may do, with no
-- UI in between. Fictitious data from seed.sql.
begin;
select plan(30);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- Fixtures, written by the server: a draft, an approved and a sent report in
-- municipality A, and a schedule in municipality B.
insert into public.reports (id, org_id, period, period_start, period_end, title, content, status, approved_at, sent_at, pdf_path, facts)
values
  ('00000000-0000-4000-9100-000000000001', '00000000-0000-4000-a000-000000000001', 'weekly', '2026-10-02', '2026-10-08', 'Borrador', '{"headline":"a"}', 'draft', null, null, null, '{"kpis":[]}'),
  ('00000000-0000-4000-9100-000000000002', '00000000-0000-4000-a000-000000000001', 'weekly', '2026-09-25', '2026-10-01', 'Aprobado', '{"headline":"a"}', 'approved', now(), null, 'a/2.pdf', '{"kpis":[]}'),
  ('00000000-0000-4000-9100-000000000003', '00000000-0000-4000-a000-000000000001', 'weekly', '2026-09-18', '2026-09-24', 'Enviado', '{"headline":"a"}', 'sent', now(), now(), 'a/3.pdf', '{"kpis":[]}');
insert into public.report_schedules (id, org_id, period) values
  ('00000000-0000-4000-9200-00000000000b', '00000000-0000-4000-a000-00000000000b', 'weekly');

-- ---------------------------------------------------------------------------
-- comunicacion (municipality A) from the API
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;

-- Inserts: only drafts, without approval or delivery data.
select throws_ok($$ insert into public.reports (org_id, period, period_start, period_end, status)
  values ('00000000-0000-4000-a000-000000000001', 'daily', '2026-10-08', '2026-10-08', 'approved') $$,
  '42501', null, 'cannot insert an approved report');
select throws_ok($$ insert into public.reports (org_id, period, period_start, period_end, status)
  values ('00000000-0000-4000-a000-000000000001', 'daily', '2026-10-08', '2026-10-08', 'sent') $$,
  '42501', null, 'cannot insert a sent report');
select throws_ok($$ insert into public.reports (org_id, period, period_start, period_end, approved_by)
  values ('00000000-0000-4000-a000-000000000001', 'daily', '2026-10-08', '2026-10-08', '00000000-0000-4000-d000-000000000001') $$,
  '42501', null, 'cannot insert a forged approver');
select throws_ok($$ insert into public.reports (org_id, period, period_start, period_end, sent_at, delivery)
  values ('00000000-0000-4000-a000-000000000001', 'daily', '2026-10-08', '2026-10-08', now(), '{"email":{"status":"sent"}}') $$,
  '42501', null, 'cannot insert delivery data');
select throws_ok($$ insert into public.reports (org_id, period, period_start, period_end, created_by)
  values ('00000000-0000-4000-a000-000000000001', 'daily', '2026-10-08', '2026-10-08', '00000000-0000-4000-d000-000000000001') $$,
  '42501', null, 'cannot insert a forged author');
select throws_ok($$ insert into public.reports (org_id, period, period_start, period_end, schedule_id)
  values ('00000000-0000-4000-a000-000000000001', 'daily', '2026-10-08', '2026-10-08', '00000000-0000-4000-9200-00000000000b') $$,
  '42501', null, 'cannot attach a schedule of another municipality');
select throws_ok($$ insert into public.reports (org_id, period, period_start, period_end)
  values ('00000000-0000-4000-a000-00000000000b', 'daily', '2026-10-08', '2026-10-08') $$,
  '42501', null, 'cannot insert into another municipality');
select lives_ok($$ insert into public.reports (id, org_id, period, period_start, period_end, title)
  values ('00000000-0000-4000-9100-000000000004', '00000000-0000-4000-a000-000000000001', 'daily', '2026-10-08', '2026-10-08', 'Nuevo') $$,
  'inserts a draft');
select is((select created_by from public.reports where id = '00000000-0000-4000-9100-000000000004'),
  '00000000-0000-4000-d000-000000000002'::uuid, 'the author is the caller');

-- Updates of a draft: text and approval only.
select throws_ok($$ update public.reports set approved_by = '00000000-0000-4000-d000-000000000001' where id = '00000000-0000-4000-9100-000000000001' $$,
  '42501', null, 'cannot write approved_by');
select throws_ok($$ update public.reports set approved_at = now() - interval '3 days' where id = '00000000-0000-4000-9100-000000000001' $$,
  '42501', null, 'cannot write approved_at');
select throws_ok($$ update public.reports set sent_at = now() where id = '00000000-0000-4000-9100-000000000001' $$,
  '42501', null, 'cannot write sent_at');
select throws_ok($$ update public.reports set delivery = '{"email":{"status":"sent"}}' where id = '00000000-0000-4000-9100-000000000001' $$,
  '42501', null, 'cannot write delivery');
select throws_ok($$ update public.reports set pdf_path = 'otro/municipio.pdf' where id = '00000000-0000-4000-9100-000000000001' $$,
  '42501', null, 'cannot write pdf_path');
select throws_ok($$ update public.reports set recipients = '{fuera@ejemplo.test}' where id = '00000000-0000-4000-9100-000000000001' $$,
  '42501', null, 'cannot write recipients directly');
select throws_ok($$ update public.reports set status = 'sent' where id = '00000000-0000-4000-9100-000000000001' $$,
  '42501', 'Un reporte se aprueba antes de enviarse.', 'cannot mark a draft as sent');

update public.reports set status = 'approved' where id = '00000000-0000-4000-9100-000000000001';
select is((select array[approved_by::text, (approved_at > now() - interval '1 minute')::text] from public.reports
  where id = '00000000-0000-4000-9100-000000000001'),
  array['00000000-0000-4000-d000-000000000002', 'true'], 'approving stamps the caller and the time');

-- Approved and sent reports: no update, no delete, no status change.
update public.reports set status = 'sent' where id = '00000000-0000-4000-9100-000000000002';
update public.reports set title = 'Cambiado' where id = '00000000-0000-4000-9100-000000000002';
delete from public.reports where id in ('00000000-0000-4000-9100-000000000002', '00000000-0000-4000-9100-000000000003');
select is((select array_agg(status::text || ':' || title order by id) from public.reports
  where id in ('00000000-0000-4000-9100-000000000002', '00000000-0000-4000-9100-000000000003')),
  array['approved:Aprobado', 'sent:Enviado'], 'approved and sent reports stay as they were (no update, no delete)');
delete from public.reports where id = '00000000-0000-4000-9100-000000000004';
select is((select count(*) from public.reports where id = '00000000-0000-4000-9100-000000000004'), 0::bigint, 'deletes a draft');

-- Recipients: through the RPC, in any status, normalized and audited.
select is(public.set_report_recipients('00000000-0000-4000-9100-000000000003', array[' Prensa@Municipio.gob.mx ', 'prensa@municipio.gob.mx', '', 'cabildo@municipio.gob.mx']),
  array['prensa@municipio.gob.mx', 'cabildo@municipio.gob.mx'], 'recipients of a sent report change through the RPC');
select throws_ok($$ select public.set_report_recipients('00000000-0000-4000-9100-000000000003', '{no-es-correo}') $$,
  '22023', 'Correo inválido: no-es-correo', 'the RPC validates emails');
select throws_ok($$ select public.set_report_recipients('00000000-0000-4000-9100-000000000003',
  (select array_agg('p' || n || '@municipio.gob.mx') from generate_series(1, 31) n)) $$,
  '22023', 'Máximo 30 destinatarios.', 'the RPC caps recipients');
reset role;

select is((select changes -> 'recipients' from public.audit_log
  where entity = 'reports' and entity_id = '00000000-0000-4000-9100-000000000003' and action = 'update'
    and actor_id = '00000000-0000-4000-d000-000000000002'),
  '[[], ["prensa@municipio.gob.mx", "cabildo@municipio.gob.mx"]]'::jsonb, 'the recipients change is audited with its author');

-- ---------------------------------------------------------------------------
-- lectura, dependencia and another municipality
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-4000-d000-000000000005');
set local role authenticated;
select throws_ok($$ select public.set_report_recipients('00000000-0000-4000-9100-000000000002', '{x@municipio.gob.mx}') $$,
  '42501', 'not allowed', 'lectura cannot change recipients');
update public.reports set title = 'Lectura' where id = '00000000-0000-4000-9100-000000000001';
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;
select throws_ok($$ select public.set_report_recipients('00000000-0000-4000-9100-000000000002', '{x@municipio.gob.mx}') $$,
  '42501', 'not allowed', 'dependencia cannot change recipients');
reset role;

-- Municipality B's comunicacion against municipality A's reports.
select pg_temp.login('00000000-0000-4000-d000-000000000012');
set local role authenticated;
select is((select count(*) from public.reports where org_id = '00000000-0000-4000-a000-000000000001'), 0::bigint,
  'another municipality sees none of them');
update public.reports set title = 'Hackeado' where org_id = '00000000-0000-4000-a000-000000000001';
delete from public.reports where org_id = '00000000-0000-4000-a000-000000000001';
select throws_ok($$ select public.set_report_recipients('00000000-0000-4000-9100-000000000002', '{x@municipio-b.test}') $$,
  '42501', 'not allowed', 'another municipality cannot change recipients');
select lives_ok($$ insert into public.reports (org_id, period, period_start, period_end, schedule_id)
  values ('00000000-0000-4000-a000-00000000000b', 'weekly', '2026-10-02', '2026-10-08', '00000000-0000-4000-9200-00000000000b') $$,
  'B drafts its own report with its own schedule');
reset role;
select is((select count(*) from public.reports where org_id = '00000000-0000-4000-a000-000000000001'
  and id::text like '00000000-0000-4000-9100-%' and title not in ('Hackeado', 'Lectura')), 3::bigint,
  'neither lectura nor another municipality changed or deleted anything');

select pg_temp.login('00000000-0000-4000-d000-000000000014');
set local role anon;
select throws_ok($$ select count(*) from public.reports $$, '42501', null, 'anon has no access');
reset role;

select * from finish();
rollback;
