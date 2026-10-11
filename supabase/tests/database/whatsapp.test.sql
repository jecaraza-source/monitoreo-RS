-- WhatsApp phase 1: SLA, responsible per department, officials' numbers and the message log.
begin;
select plan(29);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- SLA -----------------------------------------------------------------------
select is((select count(*)::int from public.sla_policies where org_id = '00000000-0000-4000-a000-000000000001'), 4,
  'every org has an SLA per priority');
insert into public.organizations (id, name, slug) values ('00000000-0000-4000-a000-0000000000ff', 'Otro', 'otro-wa');
select is((select hours from public.sla_policies where org_id = '00000000-0000-4000-a000-0000000000ff' and priority = 'critical'), 12,
  'a new org starts with the default SLA');

select pg_temp.login('00000000-0000-4000-d000-000000000003'); -- obras (dependencia)
set local role authenticated;
select is((select count(*)::int from public.sla_policies), 4, 'members read their SLA');
update public.sla_policies set hours = 1 where priority = 'low';
select is((select hours from public.sla_policies where priority = 'low'), 168, 'non-admins cannot change the SLA');

select pg_temp.login('00000000-0000-4000-d000-000000000001'); -- admin
update public.sla_policies set hours = 6 where priority = 'critical';
select is((select hours from public.sla_policies where priority = 'critical'), 6, 'admins change the SLA');
reset role;
select ok(exists (select 1 from public.audit_log where entity = 'sla_policies' and action = 'update'
  and actor_id = '00000000-0000-4000-d000-000000000001'), 'SLA changes are audited with their author');

-- Responsible per department --------------------------------------------------
update public.departments set responsible_user_id = '00000000-0000-4000-d000-000000000003'
where id = '00000000-0000-4000-b000-000000000001';
select is((select responsible_user_id from public.departments where id = '00000000-0000-4000-b000-000000000001'),
  '00000000-0000-4000-d000-000000000003'::uuid, 'a dependencia user is responsible of its own department');
select throws_ok($$ update public.departments set responsible_user_id = '00000000-0000-4000-d000-000000000003'
  where id = '00000000-0000-4000-b000-000000000002' $$, '23514', null, 'but not of another department');
select throws_ok($$ update public.departments set responsible_user_id = '00000000-0000-4000-d000-000000000005'
  where id = '00000000-0000-4000-b000-000000000002' $$, '23514', null, 'lectura cannot be responsible');
select lives_ok($$ update public.departments set responsible_user_id = '00000000-0000-4000-d000-000000000002'
  where id = '00000000-0000-4000-b000-000000000003' $$, 'comunicacion can be responsible of any department');

update public.memberships set role = 'lectura' where user_id = '00000000-0000-4000-d000-000000000002';
select is((select responsible_user_id from public.departments where id = '00000000-0000-4000-b000-000000000003'), null,
  'a member who no longer qualifies stops being responsible');
update public.memberships set role = 'comunicacion' where user_id = '00000000-0000-4000-d000-000000000002';

-- Officials' numbers ----------------------------------------------------------
select pg_temp.login('00000000-0000-4000-d000-000000000002'); -- comunicacion
set local role authenticated;
select throws_ok($$ select public.invite_whatsapp_contact('00000000-0000-4000-a000-000000000001',
  '00000000-0000-4000-d000-000000000003', '525621339211') $$, '42501', null, 'only admins register numbers');
select throws_ok($$ insert into public.whatsapp_contacts (org_id, user_id, phone, status)
  values ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-d000-000000000003', '525621339211', 'active') $$,
  '42501', null, 'nobody writes a contact (or makes it active) directly');

select pg_temp.login('00000000-0000-4000-d000-000000000001'); -- admin
select isnt(public.invite_whatsapp_contact('00000000-0000-4000-a000-000000000001',
  '00000000-0000-4000-d000-000000000003', '525621339211'), null, 'admins register a number');
select is((select status::text from public.whatsapp_contacts where user_id = '00000000-0000-4000-d000-000000000003'), 'pending',
  'a registered number waits for the official to accept');
select throws_ok($$ select public.invite_whatsapp_contact('00000000-0000-4000-a000-000000000001',
  '00000000-0000-4000-d000-000000000004', '525621339211') $$, '23505', null, 'a live number belongs to one official');

select pg_temp.login('00000000-0000-4000-d000-000000000003'); -- obras sees only its own
select is((select count(*)::int from public.whatsapp_contacts), 1, 'an official sees their own number');
select pg_temp.login('00000000-0000-4000-d000-000000000004'); -- agua
select is((select count(*)::int from public.whatsapp_contacts), 0, 'and nobody else''s');

-- Message log ---------------------------------------------------------------
reset role;
insert into public.whatsapp_messages (org_id, direction, wa_message_id, kind, status)
values ('00000000-0000-4000-a000-000000000001', 'out', 'wamid.test', 'template', 'sent');
select pg_temp.login('00000000-0000-4000-d000-000000000002'); -- comunicacion
set local role authenticated;
select is((select count(*)::int from public.whatsapp_messages), 0, 'the message log is admin-only');
select pg_temp.login('00000000-0000-4000-d000-000000000001');
select is((select count(*)::int from public.whatsapp_messages), 1, 'admins read the message log');

-- Turn actions from WhatsApp (phase 2) ---------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
create temporary table obras_ticket as
  select id, mention_id from public.tickets
  where department_id = '00000000-0000-4000-b000-000000000001' and status = 'open' limit 1;
create temporary table agua_ticket as
  select id from public.tickets where department_id = '00000000-0000-4000-b000-000000000002' limit 1;
create temporary table obras_contact as
  select id from public.whatsapp_contacts where user_id = '00000000-0000-4000-d000-000000000003';

select is(public.whatsapp_ticket_action((select id from obras_contact), (select id from obras_ticket), 'resolved') ->> 'reason',
  'inactive', 'a pending number cannot act on tickets');
update public.whatsapp_contacts set status = 'active' where id = (select id from obras_contact);

select is(public.whatsapp_ticket_action((select id from obras_contact), (select id from obras_ticket), 'in_progress') ->> 'ok',
  'true', 'the responsible moves their department''s ticket');
select set_config('request.jwt.claims', '', true);
select is((select status::text from public.tickets where id = (select id from obras_ticket)), 'in_progress', 'the ticket changes');
select ok(exists (select 1 from public.audit_log where entity = 'tickets' and entity_id = (select id::text from obras_ticket)
  and actor_id = '00000000-0000-4000-d000-000000000003'), 'the change is audited as the official');
select is((select channel || '|' || author_name from public.mention_notes where mention_id = (select mention_id from obras_ticket)
  order by created_at desc limit 1), 'whatsapp|Enlace Obras Públicas', 'a WhatsApp note records the change, signed by the official');

select is(public.whatsapp_ticket_action((select id from obras_contact), (select id from obras_ticket), null, 'Cuadrilla en camino') ->> 'ok',
  'true', 'a reply becomes a note');
select set_config('request.jwt.claims', '', true);
select is(public.whatsapp_ticket_action((select id from obras_contact), (select id from agua_ticket), 'resolved') ->> 'reason',
  'forbidden', 'but never on another department''s ticket');
select set_config('request.jwt.claims', '', true);

select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;
select throws_ok($$ select public.whatsapp_ticket_action(gen_random_uuid(), gen_random_uuid()) $$, '42501', null,
  'only the server applies WhatsApp actions');
reset role;
grant select on obras_ticket to authenticated;
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
insert into public.mention_notes (org_id, mention_id, body)
values ('00000000-0000-4000-a000-000000000001', (select mention_id from obras_ticket), 'Nota desde la app');
reset role;
select is((select channel from public.mention_notes where body = 'Nota desde la app'), 'app', 'notes written in the app are marked app');

select * from finish();
rollback;
