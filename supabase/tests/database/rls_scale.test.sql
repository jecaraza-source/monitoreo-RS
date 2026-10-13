-- Stage 12: the scalable read policies (20261105000000_rls_scale) show every
-- role exactly what the previous per-row policies showed. For each seeded
-- person, each table's visible rows are compared with the previous predicate
-- (can_read_all or routed to the department), including a mention that reaches
-- a department only through a case. Fictitious data.
begin;
select plan(39);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create temp table free on commit drop as
  select m.id, row_number() over (order by m.id) as n from public.mentions m
  where m.org_id = '00000000-0000-4000-a000-000000000001'
    and not exists (select 1 from public.tickets t where t.mention_id = m.id)
    and not exists (select 1 from public.case_mentions cm where cm.mention_id = m.id)
    and exists (select 1 from public.classifications c where c.mention_id = m.id)
  order by m.id limit 2;
create temp table ids (k text primary key, v uuid) on commit drop;
create temp table seen (who text, tbl text, expected bigint, actual bigint) on commit drop;
grant all on free, ids, seen to authenticated;

-- A case with two mentions assigned to Obras: they reach Obras only through the case.
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
insert into ids values ('case', public.create_case('00000000-0000-4000-a000-000000000001', array(select id from free order by n),
  'Prueba de visibilidad', '', 'baches y pavimentación', null, 'medium'));
select public.assign_case((select v from ids where k = 'case'), '00000000-0000-4000-b000-000000000001', now() + interval '3 days', now() + interval '1 day');
reset role;

do $$
declare
  u record;
  n_expected bigint;
  n_actual bigint;
  t text;
begin
  for u in select * from (values
    ('admin', '00000000-0000-4000-d000-000000000001'::uuid), ('comunicacion', '00000000-0000-4000-d000-000000000002'),
    ('obras', '00000000-0000-4000-d000-000000000003'), ('agua', '00000000-0000-4000-d000-000000000004'),
    ('lectura', '00000000-0000-4000-d000-000000000005'), ('admin B', '00000000-0000-4000-d000-000000000011'),
    ('comunicacion B', '00000000-0000-4000-d000-000000000012')) v(who, id)
  loop
    perform pg_temp.login(u.id);
    foreach t in array array['mentions', 'classifications', 'tickets', 'case_mentions', 'classification_reviews'] loop
      -- The previous policy's predicate, evaluated for this person without RLS.
      execute case t
        when 'mentions' then 'select count(*) from public.mentions x where private.can_read_all(x.org_id) or private.mention_routed_to_user(x.org_id, x.id)'
        when 'classifications' then 'select count(*) from public.classifications x where private.can_read_all(x.org_id) or private.mention_routed_to_user(x.org_id, x.mention_id)'
        when 'tickets' then 'select count(*) from public.tickets x where private.can_read_all(x.org_id) or x.department_id = private.user_department(x.org_id)'
        when 'case_mentions' then 'select count(*) from public.case_mentions x where private.can_read_all(x.org_id) or private.case_visible_to_department(x.org_id, x.case_id)'
        else 'select count(*) from public.classification_reviews x where private.can_read_all(x.org_id)'
      end into n_expected;
      set local role authenticated;
      execute format('select count(*) from public.%I', t) into n_actual;
      reset role;
      insert into seen values (u.who, t, n_expected, n_actual);
    end loop;
  end loop;
end;
$$;

select is(actual, expected, format('%s sees the same %s as before', who, tbl)) from seen order by who, tbl;

-- The case path is exercised: Obras sees the two mentions only through the case; Agua does not.
select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;
select is((select count(*) from public.mentions where id in (select id from free)), 2::bigint, 'a department sees the mentions of a case assigned to it');
select is((select count(*) from public.classifications where mention_id in (select id from free)), 2::bigint, 'and their classifications');
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000004');
set local role authenticated;
select is((select count(*) from public.mentions where id in (select id from free)), 0::bigint, 'another department does not');
reset role;

-- No per-row membership check is left in these policies (they scale with the volume).
select is(
  (select count(*) from pg_policies
   where schemaname = 'public' and cmd = 'SELECT'
     and tablename in ('mentions', 'classifications', 'tickets', 'case_mentions', 'classification_reviews')
     and (qual like '%can_read_all%' or qual like '%mention_routed_to_user%' or qual like '%user_department(%' or qual like '%case_visible_to_department%')),
  0::bigint, 'the read policies use sets computed once per query');
select * from finish();
rollback;
