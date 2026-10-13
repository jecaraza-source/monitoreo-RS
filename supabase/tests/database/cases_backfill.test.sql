-- Stage 4: backfill of existing tickets into cases. Dry run first, then the
-- real run: no ticket duplicated or lost, states, dates and notes kept, one
-- case per routed mention, repeatable. Fictitious seed data.
begin;
select plan(21);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- One routed mention also gets a supporting department (several turns).
create temp table multi on commit drop as
  select t.mention_id, t.department_id from public.tickets t
  where t.org_id = '00000000-0000-4000-a000-000000000001' and t.department_id <> '00000000-0000-4000-b000-000000000005'
  order by t.created_at, t.id limit 1;
insert into public.tickets (org_id, mention_id, department_id, is_primary, status, created_at)
select '00000000-0000-4000-a000-000000000001', mention_id, '00000000-0000-4000-b000-000000000005', false, 'in_progress', now() - interval '1 day' from multi;

-- Another routed mention is put in a case by hand before the backfill.
create temp table manual on commit drop as
  select t.mention_id from public.tickets t
  where t.org_id = '00000000-0000-4000-a000-000000000001' and t.mention_id not in (select mention_id from multi)
  order by t.created_at desc, t.id limit 1;
grant select on multi, manual to authenticated;
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select ok(public.create_case('00000000-0000-4000-a000-000000000001', array[(select mention_id from manual)], 'Caso manual previo') is not null, 'a manual case before the backfill');
reset role;

create temp table before_tickets on commit drop as
  select id, mention_id, department_id, status, due_at, resolved_at, created_at, is_primary from public.tickets where org_id = '00000000-0000-4000-a000-000000000001';
create temp table before_notes on commit drop as select count(*) as n from public.mention_notes where org_id = '00000000-0000-4000-a000-000000000001';
grant select on before_tickets, before_notes to authenticated;

-- ---------------------------------------------------------------------------
-- Who may run it
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select throws_ok($$ select public.simulate_ticket_backfill('00000000-0000-4000-a000-000000000001') $$, '42501', 'not allowed', 'comunicacion cannot run it');
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000011');
set local role authenticated;
select throws_ok($$ select public.apply_ticket_backfill('00000000-0000-4000-a000-000000000001') $$, '42501', 'not allowed', 'nor the admin of another municipality');
reset role;

-- ---------------------------------------------------------------------------
-- Dry run, then the real run (admin)
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-4000-d000-000000000001');
set local role authenticated;
create temp table sim on commit drop as select public.simulate_ticket_backfill('00000000-0000-4000-a000-000000000001') as r;
select is((select (r ->> 'tickets_total')::int from sim), (select count(*)::int from before_tickets), 'the simulation counts every ticket');
select is((select (r ->> 'cases_to_create')::int from sim), (select count(distinct mention_id)::int from before_tickets) - 1,
  'one case per routed mention, except the one already in a case');
select is((select (r ->> 'mentions_with_several_departments')::int from sim), 1, 'the mention with several turns is reported');
select is((select (r ->> 'skipped_mentions_already_in_a_case')::int from sim), 1, 'the mention already in a case is reported, not touched');
select is((select count(*) from public.cases where backfill_key is not null), 0::bigint, 'the simulation writes nothing');

create temp table run on commit drop as select public.apply_ticket_backfill('00000000-0000-4000-a000-000000000001') as r;
select is((select (r ->> 'cases_created')::int from run), (select (r ->> 'cases_to_create')::int from sim), 'it creates what the simulation said');
select is((select (r ->> 'tickets_linked')::int from run), (select (r ->> 'tickets_to_link')::int from sim), 'and links what it said');
select is((select array[(r ->> 'tickets_before')::int, (r ->> 'tickets_after')::int] from run),
  array[(select count(*)::int from before_tickets), (select count(*)::int from before_tickets)], 'no ticket created or lost');
reset role;

-- Reconciliation, as the database sees it.
select is((select count(*) from public.tickets t join before_tickets b using (id)
           where t.status <> b.status or t.due_at is distinct from b.due_at or t.resolved_at is distinct from b.resolved_at
              or t.created_at <> b.created_at or t.department_id <> b.department_id or t.is_primary <> b.is_primary or t.mention_id <> b.mention_id),
  0::bigint, 'every ticket keeps its state, dates, department and role');
select is((select count(*) from public.tickets where org_id = '00000000-0000-4000-a000-000000000001' and case_id is null
           and mention_id <> (select mention_id from manual)), 0::bigint, 'every backfilled ticket now belongs to its case');
select is((select count(*) from public.mention_notes where org_id = '00000000-0000-4000-a000-000000000001'), (select n from before_notes), 'notes are kept');
select is((select count(*) from public.cases c
           join public.tickets t on t.case_id = c.id and t.mention_id = c.primary_mention_id and t.is_primary
           where c.backfill_key is not null
             and (c.department_id <> t.department_id
                  or c.status::text <> case t.status when 'open' then 'assigned' when 'in_progress' then 'in_progress' when 'resolved' then 'resolved' else 'closed' end)),
  0::bigint, 'each case takes its department and state from its lead ticket');
select is((select count(*) from public.tickets t join public.cases c on c.id = t.case_id where t.mention_id = (select mention_id from multi)),
  2::bigint, 'several turns of one mention become the assignments of one case');
select is((select count(*) from public.tickets where mention_id = (select mention_id from manual) and case_id is null),
  (select count(*) from before_tickets where mention_id = (select mention_id from manual)), 'the mention already in a case keeps its tickets untouched');
select is((select count(*) from public.case_events e join public.cases c on c.id = e.case_id where c.backfill_key is not null and e.operation = 'backfill'),
  (select count(*) from public.cases where backfill_key is not null), 'each backfilled case records where it came from');
select is((select count(distinct folio) from public.cases where org_id = '00000000-0000-4000-a000-000000000001'),
  (select count(*) from public.cases where org_id = '00000000-0000-4000-a000-000000000001'), 'folios are unique');

-- Repeatable: a second run changes nothing.
select is((public.apply_ticket_backfill('00000000-0000-4000-a000-000000000001') ->> 'cases_created')::int, 0, 'running it again creates nothing');

-- A department sees exactly the cases of its own turns.
select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;
select is((select count(*) from public.cases), (select count(distinct case_id) from public.tickets t where t.case_id is not null
  and t.department_id = '00000000-0000-4000-b000-000000000001'), 'a department sees the backfilled cases of its turns, no others');
reset role;

select * from finish();
rollback;
