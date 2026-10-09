-- RLS checks against the dev seed. Run with: npm run test:db
begin;
select plan(26);

-- Second tenant to prove org isolation (rolled back at the end).
insert into public.organizations (id, name, slug) values
  ('00000000-0000-4000-a000-000000000002', 'Municipio Vecino', 'municipio-vecino');
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-d000-000000000099', 'authenticated', 'authenticated',
        'admin@vecino.test', '', '{}', '{}', now(), now());
insert into public.memberships (org_id, user_id, role) values
  ('00000000-0000-4000-a000-000000000002', '00000000-0000-4000-d000-000000000099', 'admin');
insert into public.sources (id, org_id, name, type) values
  ('00000000-0000-4000-e200-000000000099', '00000000-0000-4000-a000-000000000002', 'RSS vecino', 'rss');
insert into public.mentions (org_id, source_id, external_id, text, published_at) values
  ('00000000-0000-4000-a000-000000000002', '00000000-0000-4000-e200-000000000099', 'vecino-1', 'Mención del otro municipio', now());

-- Expected counts, computed as superuser before switching roles.
create temporary table expected as
select
  (select count(distinct mention_id) from public.tickets where department_id = '00000000-0000-4000-b000-000000000001') as obras_mentions,
  (select count(*) from public.tickets where department_id = '00000000-0000-4000-b000-000000000001') as obras_tickets,
  (select count(distinct mention_id) from public.tickets where department_id = '00000000-0000-4000-b000-000000000002') as agua_mentions,
  (select id from public.tickets where department_id = '00000000-0000-4000-b000-000000000002' limit 1) as agua_ticket,
  (select id from public.tickets where department_id = '00000000-0000-4000-b000-000000000001' limit 1) as obras_ticket;
grant select on expected to authenticated;

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- ---------------------------------------------------------------------------
-- dependencia: Obras Públicas
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;

select is((select count(*) from public.mentions), (select obras_mentions from expected),
  'obras sees only mentions routed to Obras');
select is((select count(*) from public.tickets), (select obras_tickets from expected),
  'obras sees only its tickets');
select is((select count(*) from public.tickets where department_id <> '00000000-0000-4000-b000-000000000001'), 0::bigint,
  'obras sees no tickets of other departments');
select is(
  (select count(*) from public.mentions m
   where exists (select 1 from public.classifications c where c.mention_id = m.id and c.department_id = '00000000-0000-4000-b000-000000000002')),
  0::bigint, 'obras sees no mentions classified for Agua');
select is((select count(*) from public.classifications where department_id <> '00000000-0000-4000-b000-000000000001'), 0::bigint,
  'obras sees no classifications of other departments');
select is((select count(*) from public.alert_rules), 0::bigint, 'obras does not see the Agua alert rule');
select is((select count(*) from public.alert_events), 0::bigint, 'obras does not see Agua alert events');
select is((select count(*) from public.projects), 0::bigint, 'obras does not see projects');
select is((select count(*) from public.sources), 0::bigint, 'obras does not see sources');
select is((select count(*) from public.reports), 0::bigint, 'obras does not see reports');
select is((select count(*) from public.memberships), 1::bigint, 'obras sees only its own membership');
select is((select count(*) from public.mention_stats(
  '00000000-0000-4000-a000-000000000001', now() - interval '30 days', now() + interval '1 day')), 0::bigint,
  'obras gets no org-wide stats');
select is((select count(*) from public.departments), 5::bigint, 'obras reads the department catalog');

-- Writes
update public.tickets set status = 'resolved' where id = (select agua_ticket from expected);
select is((select count(*) from public.tickets where status = 'resolved' and id = (select agua_ticket from expected)), 0::bigint,
  'obras cannot update an Agua ticket (row is invisible)');
select throws_ok(
  $$ update public.tickets set department_id = '00000000-0000-4000-b000-000000000002' where id = (select obras_ticket from expected) $$,
  '42501', null, 'obras cannot re-route its ticket to another department');
select throws_ok(
  $$ update public.tickets set mention_id = gen_random_uuid() where id = (select obras_ticket from expected) $$,
  '42501', null, 'mention_id is not updatable through the API');
select lives_ok(
  $$ update public.tickets set status = 'in_progress' where id = (select obras_ticket from expected) $$,
  'obras can update its own ticket');
select throws_ok(
  $$ insert into public.tickets (org_id, mention_id, department_id)
     select org_id, id, '00000000-0000-4000-b000-000000000001' from public.mentions limit 1 $$,
  '42501', null, 'obras cannot create tickets');

-- ---------------------------------------------------------------------------
-- dependencia: Agua
-- ---------------------------------------------------------------------------
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000004');
set local role authenticated;

select is((select count(*) from public.mentions), (select agua_mentions from expected),
  'agua sees only mentions routed to Agua');
select is((select count(*) from public.alert_rules), 1::bigint, 'agua sees its department alert rule');

-- ---------------------------------------------------------------------------
-- comunicacion and lectura
-- ---------------------------------------------------------------------------
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;

select is((select count(*) from public.mentions), 200::bigint, 'comunicacion sees every mention of its org');
select ok((select count(*) from public.mention_stats(
  '00000000-0000-4000-a000-000000000001', now() - interval '30 days', now() + interval '1 day')) > 0,
  'comunicacion gets org-wide stats');

reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000005');
set local role authenticated;

select is((select count(*) from public.mentions), 200::bigint, 'lectura sees every mention of its org');
select throws_ok(
  $$ insert into public.projects (org_id, name) values ('00000000-0000-4000-a000-000000000001', 'x') $$,
  '42501', null, 'lectura cannot write');

-- ---------------------------------------------------------------------------
-- Org isolation and anonymous access
-- ---------------------------------------------------------------------------
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000099');
set local role authenticated;

select is((select count(*) from public.mentions), 1::bigint, 'admin of another org sees only its own mentions');

reset role;
set local role anon;
select throws_ok($$ select count(*) from public.mentions $$, '42501', null, 'anon cannot read mentions');

reset role;
select * from finish();
rollback;
