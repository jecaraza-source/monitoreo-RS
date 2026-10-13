-- Stage 10: verified authors. Only the catalog or the outlet a configured
-- source reads are media/public figures; any other account is a pseudonym
-- without identity and never enters identifiable rankings. Fictitious data.
begin;
select plan(32);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create temp table ids (k text primary key, v uuid) on commit drop;
grant all on ids to authenticated, service_role;
create function pg_temp.v(p_k text) returns uuid language sql as $$ select v from ids where k = p_k $$;
-- Top media of the last day as comunicacion sees it on the dashboard.
create function pg_temp.top_media() returns text language sql as $$
  select coalesce(string_agg(x ->> 'name', ', ' order by x ->> 'name'), '')
  from jsonb_array_elements(public.dashboard_stats('00000000-0000-4000-a000-000000000001', now() - interval '1 day', now() + interval '1 minute', 'day', true) -> 'top_media') x
$$;

-- Seed state.
select is((select count(*) from public.authors where kind <> 'citizen' and verification = 'unverified'), 0::bigint, 'no unverified media or public figure');
select is((select count(*) from public.authors where verification = 'unverified' and (display_name is not null or followers is not null or handle not like 'nv\_%')), 0::bigint,
  'unverified accounts keep no name, followers or handle');

-- ---------------------------------------------------------------------------
-- Ingestion
-- ---------------------------------------------------------------------------
set local role service_role;
-- A channel found by an open YouTube search (not vouched), twice.
insert into ids select 'search', author_id from public.upsert_authors('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e200-000000000003',
  '[{"platform":"youtube","handle":"UCciudadano000000000000a","display_name":"Juan Ciudadano","followers":120,"kind":null,"vouched":false}]');
insert into ids select 'search2', author_id from public.upsert_authors('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e200-000000000003',
  '[{"platform":"youtube","handle":"UCciudadano000000000000a","display_name":null,"followers":null,"kind":null,"vouched":false}]');
-- The outlet of a configured RSS source (vouched).
insert into ids select 'rss', author_id from public.upsert_authors('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e200-000000000002',
  '[{"platform":"rss","handle":"noticias.example","display_name":"Noticias Ejemplo","followers":null,"kind":"media","vouched":true}]');
-- A cataloged account seen in any source.
insert into ids select 'catalog', author_id from public.upsert_authors('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e200-000000000004',
  '[{"platform":"x","handle":"noticiasvalle","display_name":"otro nombre","followers":43000,"kind":null,"vouched":false}]');
reset role;

select is(
  (select row(kind, verification, display_name, followers, handle like 'nv\_%')::text from public.authors where id = pg_temp.v('search')),
  '(citizen,unverified,,,t)', 'an open-search channel is not media: pseudonym, no name or followers');
select is(pg_temp.v('search2'), pg_temp.v('search'), 'the same account maps to the same pseudonym (aggregate analysis)');
select is((select count(*) from public.authors where handle = 'UCciudadano000000000000a'), 0::bigint, 'its real handle is not stored');
select is((select row(kind, verification, vouching_source_id)::text from public.authors where id = pg_temp.v('rss')),
  '(media,source,00000000-0000-4000-e200-000000000002)', 'the outlet a configured source reads is media, vouched by that source');
select is((select row(kind, verification, display_name)::text from public.authors where id = pg_temp.v('catalog')),
  '(media,catalog,"Noticias del Valle")', 'a catalog entry wins: kind and name from the catalog');
select is((select count(*) from public.author_events e where e.author_id = pg_temp.v('rss') and e.action = 'vouched'), 1::bigint, 'vouching is in the trail');

-- Mentions of the citizen channel and of a cataloged outlet, published now.
insert into public.mentions (id, org_id, source_id, external_id, text, published_at, author_id, metrics, status) values
  ('00000000-0000-4000-9a00-000000000001', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e200-000000000003', 'va-1', 'Video sobre el agua', now() - interval '1 hour', pg_temp.v('search'), '{"likes":9000}', 'classified'),
  ('00000000-0000-4000-9a00-000000000002', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e200-000000000003', 'va-2', 'Otro video', now() - interval '2 hours', pg_temp.v('search'), '{"likes":9000}', 'classified');

select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
create temp table before_rank on commit drop as select pg_temp.top_media() as names;
reset role;
select ok((select names from before_rank) not like '%Ciudadano%' and (select names from before_rank) not like '%nv\_%',
  'a citizen channel does not enter the identifiable media ranking, even with the most reach');

-- ---------------------------------------------------------------------------
-- Catalog: who can verify, evidence and responsible person
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-4000-d000-000000000005');
set local role authenticated;
select throws_ok($$ select public.verify_author('00000000-0000-4000-a000-000000000001', 'youtube', 'UCciudadano000000000000a', 'media', 'Canal', 'Evidencia suficiente aquí', null) $$,
  '42501', null, 'lectura cannot verify');
select throws_ok($$ insert into public.verified_authors (org_id, platform, handle, kind, display_name, evidence, verified_by, verified_by_name)
  values ('00000000-0000-4000-a000-000000000001', 'x', 'y', 'media', 'Y', 'Evidencia suficiente aquí', '00000000-0000-4000-d000-000000000005', 'x') $$,
  '42501', null, 'nor write the catalog directly');
reset role;

select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;
select throws_ok($$ select public.verify_author('00000000-0000-4000-a000-000000000001', 'youtube', 'UCciudadano000000000000a', 'media', 'Canal', 'Evidencia suficiente aquí', null) $$,
  '42501', null, 'dependencia cannot verify');
reset role;

select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select throws_ok($$ select public.verify_author('00000000-0000-4000-a000-000000000001', 'youtube', 'UCciudadano000000000000a', 'citizen', 'Canal', 'Evidencia suficiente aquí', null) $$,
  '23514', null, 'the catalog only holds media or public figures');
select throws_ok($$ select public.verify_author('00000000-0000-4000-a000-000000000001', 'youtube', 'UCciudadano000000000000a', 'media', 'Canal', 'corta', null) $$,
  '23514', null, 'evidence is required');
select throws_ok($$ select public.verify_author('00000000-0000-4000-a000-000000000001', 'youtube', 'UCciudadano000000000000a', 'media', 'Canal', 'Evidencia suficiente aquí', 'http://inseguro') $$,
  '23514', null, 'the evidence link must be https');
insert into ids values ('entry', public.verify_author('00000000-0000-4000-a000-000000000001', 'youtube', 'UCciudadano000000000000a', 'media', 'Canal Regional Verificado',
  'Televisora con concesión pública (ficticio).', 'https://example.org/concesion'));
select throws_ok($$ select public.verify_author('00000000-0000-4000-a000-000000000001', 'youtube', 'UCciudadano000000000000a', 'media', 'Otra', 'Evidencia suficiente aquí', null) $$,
  '23505', 'Esa cuenta ya está en el catálogo.', 'an active entry is unique per account');
create temp table after_rank on commit drop as select pg_temp.top_media() as names;
reset role;

select is((select verified_by || ':' || verified_by_name from public.verified_authors where id = pg_temp.v('entry')),
  '00000000-0000-4000-d000-000000000002:' || private.member_name('00000000-0000-4000-d000-000000000002'), 'the responsible person comes from the session');
select is((select row(id, kind, verification, display_name, handle)::text from public.authors where verified_author_id = pg_temp.v('entry')),
  row(pg_temp.v('search'), 'media', 'catalog', 'Canal Regional Verificado', 'UCciudadano000000000000a')::text,
  'verifying turns the pseudonymous row into the verified author (same id)');
select is((select count(*) from public.mentions where author_id = pg_temp.v('search')), 2::bigint, 'its mentions keep their link (traceability)');
select ok((select names from after_rank) like '%Canal Regional Verificado%', 'once verified, it can appear in the media ranking');
select is((select string_agg(action, ',' order by id) from public.author_events where author_id = pg_temp.v('search')), 'verified', 'the trail records the verification');
select is((select count(*) from public.audit_log where entity = 'verified_authors' and entity_id = pg_temp.v('entry')::text), 1::bigint, 'and the audit log too');

-- ---------------------------------------------------------------------------
-- Revocation
-- ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select throws_ok($$ select public.revoke_author((select v from ids where k = 'entry'), 'no') $$, '22023', null, 'revoking needs a reason');
select lives_ok($$ select public.revoke_author((select v from ids where k = 'entry'), 'No es un medio: cuenta personal.') $$, 'comunicacion revokes');
create temp table revoked_rank on commit drop as select pg_temp.top_media() as names;
reset role;
select is((select row(kind, verification, display_name, handle like 'nv\_%')::text from public.authors where id = pg_temp.v('search')),
  '(citizen,unverified,,t)', 'a revoked account goes back to a pseudonym');
select ok((select names from revoked_rank) not like '%Canal Regional%', 'and leaves the ranking');
select is((select revoked_reason from public.verified_authors where id = pg_temp.v('entry')), 'No es un medio: cuenta personal.', 'the entry keeps who, when and why');
select ok(not exists (select 1 from public.author_events e where e.reason like '%UCciudadano%'), 'the trail never stores the handle of the account');

-- ---------------------------------------------------------------------------
-- Constraints
-- ---------------------------------------------------------------------------
select throws_ok($$ update public.authors set kind = 'media' where id = (select v from ids where k = 'search') $$, '23514', null,
  'an unverified account cannot be labeled media');
select throws_ok($$ update public.authors set display_name = 'Nombre' where id = (select v from ids where k = 'search') $$, '23514', null,
  'nor keep a name');

select pg_temp.login('00000000-0000-4000-d000-000000000001');
set local role authenticated;
select ok((select count(*) from public.author_events) > 0, 'admin reads the trail');
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
select is((select count(*) from public.author_events), 0::bigint, 'comunicacion does not read the trail');
reset role;

select * from finish();
rollback;
