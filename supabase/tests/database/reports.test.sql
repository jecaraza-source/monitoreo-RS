-- Reports: who reads and writes, the approval freeze, schedules, the daily
-- reading cache, report RPCs and the private PDF bucket.
begin;
select plan(16);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- comunicacion drafts and edits a report.
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
insert into public.reports (id, org_id, period, period_start, period_end, title, content)
values ('00000000-0000-4000-9000-000000000001', '00000000-0000-4000-a000-000000000001', 'weekly', '2026-10-02', '2026-10-08', 'Semanal', '{"headline":"a"}');
update public.reports set content = '{"headline":"b"}' where id = '00000000-0000-4000-9000-000000000001';
select is((select content ->> 'headline' from public.reports where id = '00000000-0000-4000-9000-000000000001'), 'b',
  'editors edit a draft');
select is((select created_by from public.reports where id = '00000000-0000-4000-9000-000000000001'),
  '00000000-0000-4000-d000-000000000002'::uuid, 'created_by is stamped');

-- Approving stamps who and when, then the narrative is frozen.
update public.reports set status = 'approved' where id = '00000000-0000-4000-9000-000000000001';
select is((select approved_by from public.reports where id = '00000000-0000-4000-9000-000000000001'),
  '00000000-0000-4000-d000-000000000002'::uuid, 'approval stamps the approver');
select throws_ok($$ update public.reports set content = '{"headline":"c"}' where id = '00000000-0000-4000-9000-000000000001' $$,
  '42501', 'El reporte ya fue aprobado y no se puede editar.', 'an approved report cannot be edited');
select throws_ok($$ update public.reports set status = 'draft' where id = '00000000-0000-4000-9000-000000000001' $$,
  '42501', 'Un reporte aprobado no vuelve a borrador.', 'an approved report cannot go back to draft');
update public.reports set recipients = '{prensa@municipio.gob.mx}' where id = '00000000-0000-4000-9000-000000000001';
select is((select recipients from public.reports where id = '00000000-0000-4000-9000-000000000001'), '{prensa@municipio.gob.mx}'::text[],
  'delivery fields still change after approval');

insert into public.report_schedules (org_id, period, recipients) values ('00000000-0000-4000-a000-000000000001', 'weekly', '{cabildo@municipio.gob.mx}');
select is((select count(*) from public.report_schedules), 1::bigint, 'editors create schedules');
select isnt(public.report_extras('00000000-0000-4000-a000-000000000001', now() - interval '7 days', now()) -> 'representative', null,
  'editors call report_extras');
reset role;

-- lectura reads but cannot write.
select pg_temp.login('00000000-0000-4000-d000-000000000005');
set local role authenticated;
select is((select count(*) from public.reports where id = '00000000-0000-4000-9000-000000000001'), 1::bigint, 'lectura reads reports');
select throws_ok($$ insert into public.reports (org_id, period, period_start, period_end) values ('00000000-0000-4000-a000-000000000001', 'daily', '2026-10-08', '2026-10-08') $$,
  '42501', null, 'lectura cannot create reports');
select throws_ok($$ insert into public.daily_readings (org_id, sentences) values ('00000000-0000-4000-a000-000000000001', '{x}') $$,
  '42501', null, 'nobody but the server writes the daily reading');
reset role;

-- dependencia sees no reports, schedules or org-wide figures.
select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;
select is((select count(*) from public.reports) + (select count(*) from public.report_schedules), 0::bigint,
  'dependencia sees no reports or schedules');
select throws_ok($$ select public.report_extras('00000000-0000-4000-a000-000000000001', now() - interval '7 days', now()) $$,
  '42501', 'not allowed', 'dependencia cannot call report_extras');
select throws_ok($$ select public.dashboard_stats('00000000-0000-4000-a000-000000000001', now() - interval '7 days', now()) $$,
  '42501', 'not allowed', 'dependencia cannot call dashboard_stats');
reset role;

-- The cron runs the report RPCs with the service role.
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select isnt(public.dashboard_stats('00000000-0000-4000-a000-000000000001', now() - interval '7 days', now()) -> 'totals', null,
  'the service role computes report figures');
reset role;

-- Only admins change cover colors.
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
update public.organizations set brand_primary = '#111111' where id = '00000000-0000-4000-a000-000000000001';
reset role;
select is((select brand_primary from public.organizations where id = '00000000-0000-4000-a000-000000000001'), '#032a50',
  'comunicacion cannot change cover colors');

select * from finish();
rollback;
