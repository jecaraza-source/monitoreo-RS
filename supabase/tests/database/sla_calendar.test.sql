-- Stage 7: SLA with a calendar (America/Mexico_City). Wall-clock and
-- business hours, work window, non-working days, targets by category and
-- priority, versions (reference until approved) and the version a case is
-- assigned with. Fictitious data.
begin;
select plan(27);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.dl(p_start text, p_hours numeric) returns timestamptz language sql as $$
  select public.sla_deadline('00000000-0000-4000-a000-000000000001', p_start::timestamptz, p_hours)
$$;
create temp table ids (k text primary key, v uuid) on commit drop;
grant all on ids to authenticated;

-- Starting point: wall-clock hours, version 1 as a reference value.
select is((select mode from public.sla_calendars where org_id = '00000000-0000-4000-a000-000000000001'), 'calendar', 'starts in wall-clock hours');
select is((select array[version::text, approved::text] from public.sla_versions where org_id = '00000000-0000-4000-a000-000000000001'),
  array['1', 'false'], 'version 1 exists and is not an approved agreement');
select is((select count(*)::int from public.sla_targets where org_id = '00000000-0000-4000-a000-000000000001' and category is null), 4,
  'general targets for the four priorities');
select is(pg_temp.dl('2026-10-16 16:00-06', 2), '2026-10-16 18:00-06'::timestamptz, 'wall clock: Friday 16:00 + 2 h = 18:00');

-- Admin switches to business hours (Mon–Fri 9–17), a non-working day and a category target.
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select throws_ok($$ select public.save_sla_config('00000000-0000-4000-a000-000000000001', '{}', '[]', '[]') $$,
  '42501', 'not allowed', 'comunicación does not change the SLA');
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000001');
set local role authenticated;
select throws_ok($$ select public.save_sla_config('00000000-0000-4000-a000-000000000001',
  '{"mode":"business","workdays":[1,2,3,4,5],"day_start":"09:00","day_end":"17:00"}', '[]',
  '[{"priority":"high","accept_hours":4,"attention_hours":24}]') $$,
  '22023', 'Define los plazos generales de las cuatro prioridades.', 'the four general priorities are required');
select is((public.save_sla_config('00000000-0000-4000-a000-000000000001',
  '{"mode":"business","workdays":[1,2,3,4,5],"day_start":"09:00","day_end":"17:00"}',
  '[{"day":"2026-11-02","name":"Día de Muertos"}]',
  '[{"priority":"critical","accept_hours":1,"attention_hours":8},
    {"priority":"high","accept_hours":4,"attention_hours":16},
    {"priority":"medium","accept_hours":8,"attention_hours":40},
    {"priority":"low","accept_hours":16,"attention_hours":80},
    {"category":"agua potable","priority":"high","accept_hours":2,"attention_hours":8}]') ->> 'version'), '2',
  'saving makes version 2');
reset role;

select is((select approved from public.sla_versions where org_id = '00000000-0000-4000-a000-000000000001' and version = 2), false,
  'a saved configuration is a reference until approved');
select is((select hours from public.sla_policies where org_id = '00000000-0000-4000-a000-000000000001' and priority = 'high'), 16,
  'the inbox routing default follows the general attention hours');
select ok((select snapshot -> 'holidays' @> '[{"day":"2026-11-02"}]' from public.sla_versions
           where org_id = '00000000-0000-4000-a000-000000000001' and version = 2), 'the version keeps the full configuration');

-- Business hours, Mexico City (UTC−6, no DST).
select is(pg_temp.dl('2026-10-16 16:00-06', 2), '2026-10-19 10:00-06'::timestamptz, 'Friday 16:00 + 2 business h = Monday 10:00');
select is(pg_temp.dl('2026-10-16 09:00-06', 8), '2026-10-16 17:00-06'::timestamptz, 'a full day ends at the close');
select is(pg_temp.dl('2026-10-16 07:00-06', 3), '2026-10-16 12:00-06'::timestamptz, 'before opening: counts from 9:00');
select is(pg_temp.dl('2026-10-16 18:30-06', 1), '2026-10-19 10:00-06'::timestamptz, 'after closing: next work day');
select is(pg_temp.dl('2026-10-17 12:00-06', 1), '2026-10-19 10:00-06'::timestamptz, 'Saturday: Monday');
select is(pg_temp.dl('2026-10-19 09:00-06', 20), '2026-10-21 13:00-06'::timestamptz, 'several days: Mon 8 + Tue 8 + Wed 4');
select is(pg_temp.dl('2026-10-30 16:00-06', 2), '2026-11-03 10:00-06'::timestamptz, 'skips the weekend and the non-working Monday');
select is(pg_temp.dl('2026-10-16 22:00-00', 1), '2026-10-16 17:00-06'::timestamptz, 'the start is read in Mexico City time (22:00 UTC = 16:00)');

-- Targets by category, else general.
select is((public.sla_terms('00000000-0000-4000-a000-000000000001', 'agua potable', 'high', '2026-10-16 09:00-06') ->> 'attention_hours')::numeric,
  8::numeric, 'a category has its own target');
select is((public.sla_terms('00000000-0000-4000-a000-000000000001', 'bacheo', 'high', '2026-10-16 09:00-06') ->> 'attention_hours')::numeric,
  16::numeric, 'other categories use the general target');
select is((public.sla_terms('00000000-0000-4000-a000-000000000001', 'agua potable', 'high', '2026-10-16 16:00-06') ->> 'accept_due_at')::timestamptz,
  '2026-10-19 10:00-06'::timestamptz, 'terms give the deadlines with the calendar');

-- Approval of the agreement.
select pg_temp.login('00000000-0000-4000-d000-000000000001');
set local role authenticated;
select throws_ok($$ select public.approve_sla_version((select id from public.sla_versions where org_id = '00000000-0000-4000-a000-000000000001' and version = 1)) $$,
  '22023', 'Sólo se aprueba la versión vigente.', 'only the current version is approved');
select lives_ok($$ select public.approve_sla_version((select id from public.sla_versions where org_id = '00000000-0000-4000-a000-000000000001' and version = 2),
  'Acuerdo de cabildo (ficticio)') $$, 'the admin approves it as the agreement');
reset role;

-- A case records the version and terms it was assigned with.
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
insert into ids values ('c', public.create_case('00000000-0000-4000-a000-000000000001',
  array[(select m.id from public.mentions m where m.org_id = '00000000-0000-4000-a000-000000000001'
         and not exists (select 1 from public.tickets t where t.mention_id = m.id)
         and not exists (select 1 from public.case_mentions cm where cm.mention_id = m.id) order by m.id limit 1)],
  'Fuga de prueba', '', 'agua potable', null, 'high'));
select lives_ok($$ select public.assign_case((select v from ids where k = 'c'), '00000000-0000-4000-b000-000000000002', null, null) $$,
  'assigned without dates: the SLA sets them');
reset role;
select is((select array[(c.accept_due_at = (c.sla_terms ->> 'computed_accept_due_at')::timestamptz)::text,
                        (c.due_at = public.sla_deadline(c.org_id, now(), 8))::text,
                        c.sla_terms ->> 'overridden', c.sla_terms ->> 'approved', v.version::text]
           from public.cases c join public.sla_versions v on v.id = c.sla_version_id where c.id = (select v from ids where k = 'c')),
  array['true', 'true', 'false', 'true', '2'], 'deadlines from the category target, approved version 2 recorded');
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select lives_ok($$ select public.assign_case((select v from ids where k = 'c'), '00000000-0000-4000-b000-000000000002',
  now() + interval '10 days', now() + interval '1 day') $$, 'reassigned with dates chosen by a person');
reset role;
select is((select sla_terms ->> 'overridden' from public.cases where id = (select v from ids where k = 'c')), 'true',
  'the case records that the dates differ from the SLA');

select * from finish();
rollback;
