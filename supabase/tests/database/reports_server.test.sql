-- Reports workflow as the server runs it (service role), in its own session:
-- the guards must work for a role without USAGE on schema private, and a
-- plan cached by an earlier caller in the same session would hide that.
begin;
select plan(6);

insert into public.reports (id, org_id, period, period_start, period_end, title, content, status, approved_at, sent_at, pdf_path, facts)
values
  ('00000000-0000-4000-9100-000000000001', '00000000-0000-4000-a000-000000000001', 'weekly', '2026-10-02', '2026-10-08', 'Borrador', '{"headline":"a"}', 'draft', null, null, null, '{"kpis":[]}'),
  ('00000000-0000-4000-9100-000000000002', '00000000-0000-4000-a000-000000000001', 'weekly', '2026-09-25', '2026-10-01', 'Aprobado', '{"headline":"a"}', 'approved', now(), null, 'a/2.pdf', '{"kpis":[]}');

-- ---------------------------------------------------------------------------
-- The server (service role): render, send, resend; never back, never re-approve
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
-- Approves as the cron does for auto_approve schedules, then renders and sends.
update public.reports set status = 'approved' where id = '00000000-0000-4000-9100-000000000001';
update public.reports set pdf_path = 'a/1.pdf' where id = '00000000-0000-4000-9100-000000000001';
update public.reports set status = 'sent', delivery = '{"email":{"status":"sent"}}' where id = '00000000-0000-4000-9100-000000000001';
select is((select array[status::text, (sent_at is not null)::text, pdf_path] from public.reports where id = '00000000-0000-4000-9100-000000000001'),
  array['sent', 'true', 'a/1.pdf'], 'the server stores the PDF and marks it sent');
select lives_ok($$ update public.reports set delivery = '{"email":{"status":"sent","again":true}}', sent_at = now() where id = '00000000-0000-4000-9100-000000000001' $$,
  'the server records a resend');
select throws_ok($$ update public.reports set status = 'approved' where id = '00000000-0000-4000-9100-000000000001' $$,
  '42501', 'Un reporte enviado no cambia de estado.', 'a sent report does not go back to approved');
select throws_ok($$ update public.reports set approved_by = '00000000-0000-4000-d000-000000000001' where id = '00000000-0000-4000-9100-000000000001' $$,
  '42501', 'La aprobación de un reporte no se puede cambiar.', 'nobody rewrites the approver');
select throws_ok($$ update public.reports set org_id = '00000000-0000-4000-a000-00000000000b' where id = '00000000-0000-4000-9100-000000000002' $$,
  '42501', 'Estos datos del reporte no se pueden cambiar.', 'a report never moves to another municipality');

-- Scheduled auto-approval: approved by the system, no person stamped.
insert into public.reports (id, org_id, period, period_start, period_end, facts)
values ('00000000-0000-4000-9100-000000000005', '00000000-0000-4000-a000-000000000001', 'daily', '2026-10-09', '2026-10-09', '{"kpis":[]}');
update public.reports set status = 'approved' where id = '00000000-0000-4000-9100-000000000005';
select is((select array[(approved_by is null)::text, (approved_at is not null)::text] from public.reports where id = '00000000-0000-4000-9100-000000000005'),
  array['true', 'true'], 'auto-approval is stamped as the system');
reset role;

select * from finish();
rollback;
