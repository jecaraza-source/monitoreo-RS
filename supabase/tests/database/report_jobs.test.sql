-- Stage 7: report jobs (service role). One job per org, kind and period
-- even with concurrent crons; one worker at a time; a failed stage is
-- retried with backoff from that stage; one report per job. Fictitious data.
begin;
select plan(16);

create function pg_temp.service() returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
$$;
create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create temp table ids (k text primary key, v uuid) on commit drop;
grant all on ids to service_role, authenticated;
create function pg_temp.at(p_minutes integer default 0) returns timestamptz language sql as $$
  select '2026-12-01 07:00-06'::timestamptz + make_interval(mins => p_minutes)
$$;

select pg_temp.service();
set local role service_role;
insert into ids values ('job', (public.enqueue_report_job('00000000-0000-4000-a000-000000000001', null, 'daily', '2026-11-30', '2026-11-30', false,
  array['cabildo@monitoreo.test']) ->> 'id')::uuid);
select is(public.enqueue_report_job('00000000-0000-4000-a000-000000000001', null, 'daily', '2026-11-30', '2026-11-30', true, '{}') ->> 'created', 'false',
  'a second cron for the same period gets the same job');
reset role;
select is((select count(*)::int from public.report_jobs where org_id = '00000000-0000-4000-a000-000000000001' and period_start = '2026-11-30'), 1, 'one job per period');
select is((select auto_approve from public.report_jobs where id = (select v from ids where k = 'job')), false,
  'the first enqueue''s settings stay (human approval by default)');

select pg_temp.service();
set local role service_role;
select is((select count(*)::int from public.claim_report_jobs('cron-a', 3, 300, pg_temp.at()) where id = (select v from ids where k = 'job')), 1, 'cron A takes it');
select is((select count(*)::int from public.claim_report_jobs('cron-b', 3, 300, pg_temp.at()) where id = (select v from ids where k = 'job')), 0, 'cron B does not');
select is(public.advance_report_job((select v from ids where k = 'job'), 'cron-b', 'drafted'), 'stale', 'nor can it advance it');
-- The AI fails: the stage stays, retried later.
select is(public.advance_report_job((select v from ids where k = 'job'), 'cron-a', 'drafted', null, 'Claude 529', false, pg_temp.at()), 'queued',
  'a failure keeps the stage');
reset role;
select is((select array[stage, attempts::text, (next_attempt_at = pg_temp.at(5))::text, coalesce(lease_owner, '-')] from public.report_jobs where id = (select v from ids where k = 'job')),
  array['queued', '1', 'true', '-'], 'retried in 5 minutes, lease released');

-- Retry: draft saved, then the process dies before the next stage.
insert into public.reports (id, org_id, period, status, title, period_start, period_end, job_id)
values ('00000000-0000-4000-9600-000000000001', '00000000-0000-4000-a000-000000000001', 'daily', 'draft', 'Reporte de prueba', '2026-11-30', '2026-11-30',
        (select v from ids where k = 'job'));
select throws_ok($$ insert into public.reports (org_id, period, status, title, period_start, period_end, job_id)
  values ('00000000-0000-4000-a000-000000000001', 'daily', 'draft', 'Duplicado', '2026-11-30', '2026-11-30', (select v from ids where k = 'job')) $$,
  '23505', null, 'a job never has two reports');

select pg_temp.service();
set local role service_role;
select is((select count(*)::int from public.claim_report_jobs('cron-a', 3, 300, pg_temp.at(1)) where id = (select v from ids where k = 'job')), 0, 'not before its retry time');
select is((select count(*)::int from public.claim_report_jobs('cron-c', 3, 300, pg_temp.at(6)) where id = (select v from ids where k = 'job')), 1, 'then taken again');
select is(public.advance_report_job((select v from ids where k = 'job'), 'cron-c', 'drafted', '00000000-0000-4000-9600-000000000001', null, false, pg_temp.at(6)),
  'drafted', 'draft recorded');
-- cron-c vanishes holding the lease; after it expires another cron resumes from "drafted".
select is((select stage from public.claim_report_jobs('cron-d', 3, 300, pg_temp.at(12)) where id = (select v from ids where k = 'job')), 'drafted',
  'after the lease expires it resumes at the saved stage');
select is(public.advance_report_job((select v from ids where k = 'job'), 'cron-d', 'awaiting_approval', null, null, false, pg_temp.at(12)), 'awaiting_approval',
  'without auto-approval the job ends waiting for a person');
reset role;
select is((select array_agg(from_stage || '>' || to_stage || ':' || ok order by id) from public.report_job_events where job_id = (select v from ids where k = 'job')),
  array['queued>queued:false', 'queued>drafted:true', 'drafted>awaiting_approval:true'], 'every step is logged');

select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select throws_ok($$ select public.enqueue_report_job('00000000-0000-4000-a000-000000000001', null, 'weekly', '2026-11-23', '2026-11-29', true, '{}') $$,
  '42501', null, 'people do not enqueue jobs');
reset role;

select * from finish();
rollback;
