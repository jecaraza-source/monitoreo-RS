-- Radar Social verification tools: settings and the log of checks follow the
-- Radar Social grant (lectura reads, admin/comunicación write); checks are
-- append-only and stay within the municipality. Fictitious data.
begin;
select plan(16);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- Org A: admin 001, comunicación 002, dependencia 003, lectura 005. Org B admin 011.
update public.memberships set can_view_counterintel = true
where user_id in ('00000000-0000-4000-d000-000000000002', '00000000-0000-4000-d000-000000000005', '00000000-0000-4000-d000-000000000011');

-- Without the grant, even an admin cannot read or write.
select pg_temp.login('00000000-0000-4000-d000-000000000001');
set local role authenticated;
select throws_ok($$ insert into public.ci_settings (org_id, watch_terms) values ('00000000-0000-4000-a000-000000000001', array['valle']) $$,
  '42501', null, 'an admin without the grant cannot change the settings');
reset role;

-- Comunicación with the grant: settings are normalized and validated.
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select lives_ok($$ insert into public.ci_settings (org_id, official_domains, watch_terms)
  values ('00000000-0000-4000-a000-000000000001', array[' Valle.GOB.mx ', 'valle.gob.mx'], array['Valle', 'sanandres']) $$,
  'comunicación saves the settings');
select is((select official_domains from public.ci_settings where org_id = '00000000-0000-4000-a000-000000000001'),
  array['valle.gob.mx'], 'domains are trimmed, lowercased and deduplicated');
select is((select updated_by from public.ci_settings where org_id = '00000000-0000-4000-a000-000000000001'),
  '00000000-0000-4000-d000-000000000002'::uuid, 'and record who changed them');
select throws_ok($$ update public.ci_settings set official_domains = array['no es dominio'] where org_id = '00000000-0000-4000-a000-000000000001' $$,
  '22023', null, 'an invalid domain is refused');
select throws_ok($$ update public.ci_settings set watch_terms = array['ab'] where org_id = '00000000-0000-4000-a000-000000000001' $$,
  '22023', null, 'a term shorter than 4 characters is refused');

-- Checks: comunicación records them; they cannot be edited or deleted.
select lives_ok($$ insert into public.ci_checks (org_id, provider, subject, status, summary, checked_by)
  values ('00000000-0000-4000-a000-000000000001', 'crtsh', 'valle', 'found', 'Prueba', '00000000-0000-4000-d000-000000000002') $$,
  'comunicación records a check');
select throws_ok($$ insert into public.ci_checks (org_id, provider, subject, status, checked_by)
  values ('00000000-0000-4000-a000-000000000001', 'gdelt', 'x', 'found', '00000000-0000-4000-d000-000000000001') $$,
  '42501', null, 'nobody records a check on behalf of someone else');
select throws_ok($$ insert into public.ci_checks (org_id, provider, subject, status, checked_by)
  values ('00000000-0000-4000-a000-000000000001', 'perfil_persona', 'x', 'found', '00000000-0000-4000-d000-000000000002') $$,
  '23514', null, 'only the listed verification services exist');
update public.ci_checks set summary = 'editado' where subject = 'valle';
delete from public.ci_checks where subject = 'valle';
select is((select summary from public.ci_checks where subject = 'valle'), 'Prueba', 'checks are append-only: no edits or deletes');
reset role;

-- A check cannot point to another municipality's report.
with x as (
  insert into public.ci_reports (org_id, kind, title, created_by)
  values ('00000000-0000-4000-a000-00000000000b', 'impersonation', 'Reporte de B', '00000000-0000-4000-d000-000000000011') returning id
) select set_config('test.report_b', (select id::text from x), true);
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select throws_ok(format($$ insert into public.ci_checks (org_id, report_id, provider, subject, status, checked_by)
  values ('00000000-0000-4000-a000-000000000001', %L, 'urlhaus', 'x.mx', 'clear', '00000000-0000-4000-d000-000000000002') $$,
  current_setting('test.report_b')), '22023', null, 'a check cannot cite another municipality''s report');
reset role;

-- lectura reads, does not write; a department and another municipality see nothing.
select pg_temp.login('00000000-0000-4000-d000-000000000005');
set local role authenticated;
select is((select count(*) from public.ci_checks where subject = 'valle'), 1::bigint, 'lectura with the grant reads the checks');
select throws_ok($$ insert into public.ci_checks (org_id, provider, subject, status, checked_by)
  values ('00000000-0000-4000-a000-000000000001', 'gdelt', 'x', 'found', '00000000-0000-4000-d000-000000000005') $$,
  '42501', null, 'but does not run them');
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;
select is((select count(*) from public.ci_checks) + (select count(*) from public.ci_settings), 0::bigint, 'a department sees nothing');
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000011');
set local role authenticated;
select is((select count(*) from public.ci_checks where org_id = '00000000-0000-4000-a000-000000000001')
          + (select count(*) from public.ci_settings where org_id = '00000000-0000-4000-a000-000000000001'), 0::bigint,
  'another municipality sees nothing, even with its own grant');
reset role;
select is((select count(*) from information_schema.role_table_grants where table_name in ('ci_checks', 'ci_settings') and grantee = 'anon'), 0::bigint,
  'anonymous visitors have no grants');

select * from finish();
rollback;
