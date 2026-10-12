-- WhatsApp phase 3: reminders at 75% of the deadline, escalation of expired
-- turns, the escalation contact and the alert recipients.
begin;
select plan(16);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- A clean slate: three open tickets of Obras at known points of their deadline.
update public.tickets set status = 'closed' where status in ('open', 'in_progress');
create temporary table t as
  select (array_agg(id order by id))[1] as fresh, (array_agg(id order by id))[2] as late, (array_agg(id order by id))[3] as expired,
         (array_agg(id order by id))[4] as stale
  from public.tickets where department_id = '00000000-0000-4000-b000-000000000001';
update public.tickets set status = 'open', assigned_at = now() - interval '1 hour', due_at = now() + interval '9 hours',
  whatsapp_reminded_at = null, whatsapp_escalated_at = null where id = (select fresh from t);
update public.tickets set status = 'in_progress', assigned_at = now() - interval '8 hours', due_at = now() + interval '2 hours',
  whatsapp_reminded_at = null, whatsapp_escalated_at = null where id = (select late from t);
update public.tickets set status = 'open', assigned_at = now() - interval '12 hours', due_at = now() - interval '1 hour',
  whatsapp_reminded_at = null, whatsapp_escalated_at = null where id = (select expired from t);
update public.tickets set status = 'open', assigned_at = now() - interval '10 days', due_at = now() - interval '5 days',
  whatsapp_reminded_at = null, whatsapp_escalated_at = null where id = (select stale from t);

-- Claiming -------------------------------------------------------------------
create temporary table claimed as select * from public.claim_whatsapp_followups(now(), 50);
select is((select kind from claimed where ticket_id = (select late from t)), 'reminder', 'past 75% of the deadline: reminder');
select is((select kind from claimed where ticket_id = (select expired from t)), 'overdue', 'past the deadline: escalation');
select ok(not exists (select 1 from claimed where ticket_id = (select fresh from t)), 'before 75%: nothing yet');
select ok(not exists (select 1 from claimed where ticket_id = (select stale from t)), 'turns expired days ago are not escalated');
select is((select count(*)::int from public.claim_whatsapp_followups(now(), 50)), 0, 'a second run claims nothing (no duplicates)');
select ok((select whatsapp_reminded_at is not null and whatsapp_escalated_at is not null from public.tickets where id = (select expired from t)),
  'an escalated turn also counts as reminded');

-- Later, the reminded one expires: it is escalated once.
select is((select kind from public.claim_whatsapp_followups(now() + interval '3 hours', 50) where ticket_id = (select late from t)), 'overdue',
  'a reminded turn is escalated when it expires');

-- Routing again restarts the assignment and its follow-ups.
grant select on t to authenticated;
select pg_temp.login('00000000-0000-4000-d000-000000000002'); -- comunicacion
set local role authenticated;
select public.route_mentions(array[(select mention_id from public.tickets where id = (select expired from t))],
  '00000000-0000-4000-b000-000000000001', now() + interval '1 day');
reset role;
select ok((select whatsapp_reminded_at is null and whatsapp_escalated_at is null and assigned_at > now() - interval '1 minute'
  from public.tickets where id = (select expired from t)), 'routing again restarts the follow-ups');

select pg_temp.login('00000000-0000-4000-d000-000000000001'); -- admin
set local role authenticated;
select throws_ok($$ select * from public.claim_whatsapp_followups(now(), 10) $$, '42501', null, 'only the server claims follow-ups');

-- Escalation contact -----------------------------------------------------------
select throws_ok($$ insert into public.whatsapp_settings (org_id, escalation_user_id)
  values ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-d000-000000000003') $$, '23514', null,
  'a dependencia user cannot be the escalation contact');
select lives_ok($$ insert into public.whatsapp_settings (org_id, escalation_user_id)
  values ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-d000-000000000002') $$,
  'admins choose a comunicacion user');

select pg_temp.login('00000000-0000-4000-d000-000000000002'); -- comunicacion
select is((select escalation_user_id from public.whatsapp_settings), '00000000-0000-4000-d000-000000000002'::uuid,
  'comunicacion reads who receives escalations');
update public.whatsapp_settings set escalation_user_id = null;
reset role;
select is((select escalation_user_id from public.whatsapp_settings where org_id = '00000000-0000-4000-a000-000000000001'),
  '00000000-0000-4000-d000-000000000002'::uuid, 'but only admins change it');

update public.memberships set role = 'lectura' where user_id = '00000000-0000-4000-d000-000000000002';
select is((select escalation_user_id from public.whatsapp_settings where org_id = '00000000-0000-4000-a000-000000000001'), null,
  'a member who no longer qualifies stops receiving escalations');
update public.memberships set role = 'comunicacion' where user_id = '00000000-0000-4000-d000-000000000002';

-- Alert recipients ---------------------------------------------------------------
select pg_temp.login('00000000-0000-4000-d000-000000000001');
select public.invite_whatsapp_contact('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-d000-000000000003', '525621339211');
select pg_temp.login('00000000-0000-4000-d000-000000000002'); -- comunicacion
set local role authenticated;
select is((select email || '|' || status from public.whatsapp_recipients('00000000-0000-4000-a000-000000000001')),
  'obras@monitoreo.test|pending', 'comunicacion sees who has WhatsApp, without the number');
select pg_temp.login('00000000-0000-4000-d000-000000000003'); -- dependencia
select throws_ok($$ select * from public.whatsapp_recipients('00000000-0000-4000-a000-000000000001') $$, '42501', null,
  'dependencias do not');
reset role;

select * from finish();
rollback;
