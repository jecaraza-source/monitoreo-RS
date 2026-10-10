-- Security audit matrix: every table in public has RLS, anon gets nothing,
-- each role reads exactly its share, lectura and dependencia cannot write
-- outside their grants, and a second tenant sees nothing of the first.
begin;
select plan(13);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.visible(p_table text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from public.%I', p_table) into n;
  return n;
exception when insufficient_privilege then
  return -1;
end $$;

-- Rows changed by an UPDATE/DELETE of the whole table (rolled back), or -1 when not even allowed.
create function pg_temp.writable(p_table text, p_op text) returns bigint language plpgsql as $$
declare
  n bigint;
  -- A column the current role may update, so column grants do not hide RLS.
  col text := (select a.attname from pg_attribute a
               where a.attrelid = format('public.%I', p_table)::regclass and a.attnum > 0 and not a.attisdropped
                 and has_column_privilege(a.attrelid, a.attnum, 'UPDATE')
               order by a.attnum limit 1);
begin
  if p_op = 'update' and col is null then
    return -1;
  end if;
  begin
    if p_op = 'update' then
      execute format('update public.%I set %I = %I', p_table, col, col);
    else
      execute format('delete from public.%I', p_table);
    end if;
    get diagnostics n = row_count;
    raise exception 'rollback' using errcode = 'P0001';
  exception
    when insufficient_privilege then return -1;
    when raise_exception then return n;
    -- FK or trigger errors mean the write got past RLS.
    when others then return 999;
  end;
end $$;

-- Rows of one org visible to the current role (tables without org_id count every row).
create function pg_temp.visible_in(p_table text, p_org uuid) returns bigint language plpgsql as $$
declare n bigint;
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = p_table and column_name = 'org_id') then
    execute format('select count(*) from public.%I where org_id = $1', p_table) into n using p_org;
  else
    execute format('select count(*) from public.%I', p_table) into n;
  end if;
  return n;
exception when insufficient_privilege then
  return -1;
end $$;

create temporary table tabs on commit drop as
select c.relname::text as t from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r';
grant select on tabs to authenticated;

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------
select is((select string_agg(t, ', ') from tabs join pg_class c on c.relname = t and c.relnamespace = 'public'::regnamespace
           where not c.relrowsecurity), null, 'every table in public has RLS enabled');
select is((select string_agg(t, ', ') from tabs
           where has_table_privilege('anon', format('public.%I', t), 'select,insert,update,delete')), null,
  'anon has no privileges on any table');
select ok(not has_table_privilege('authenticated', 'public.mention_stats_hourly', 'select')
          and not has_table_privilege('anon', 'public.mention_stats_hourly', 'select'),
  'the stats rollup (no RLS) is only reachable through dashboard_stats()');
select is((select string_agg(p.proname, ', ') from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.prosecdef
             and has_function_privilege('anon', p.oid, 'execute')), null,
  'anon cannot execute any SECURITY DEFINER function');

-- ---------------------------------------------------------------------------
-- Reads per role (counts as superuser first)
-- ---------------------------------------------------------------------------
create temporary table everything on commit drop as select t, pg_temp.visible(t) as n from tabs;
grant select on everything to authenticated;
create temporary table seen (role text, t text, n bigint) on commit drop;
grant all on seen to authenticated;

select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
insert into seen select 'comunicacion', t, pg_temp.visible(t) from tabs;
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000005');
set local role authenticated;
insert into seen select 'lectura', t, pg_temp.visible(t) from tabs;
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;
insert into seen select 'obras', t, pg_temp.visible(t) from tabs;
reset role;

select is((select string_agg(s.t, ', ' order by s.t) from seen s join everything e using (t)
           where s.role = 'comunicacion' and s.n <> e.n and s.t not in ('memberships', 'audit_log', 'app_errors')), null,
  'comunicacion reads every row of its org (not other memberships, the audit log or errors: admin only)');
select is((select string_agg(s.t, ', ' order by s.t) from seen s join everything e using (t)
           where s.role = 'lectura' and s.n <> e.n and s.t not in ('memberships', 'ai_usage', 'audit_log', 'app_errors')), null,
  'lectura reads everything except AI costs and other memberships');
select is((select string_agg(s.t, ', ' order by s.t) from seen s
           where s.role = 'obras' and s.n > 0
             and s.t not in ('mentions', 'classifications', 'tickets', 'authors', 'departments', 'neighborhoods',
                             'organizations', 'memberships', 'mention_notes')), null,
  'dependencia sees no reports, rules, sources, projects, costs or other org-wide tables');
select ok((select n from seen where role = 'obras' and t = 'mentions')
          = (select count(distinct mention_id) from public.tickets where department_id = '00000000-0000-4000-b000-000000000001'),
  'dependencia sees exactly the mentions routed to its department');

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------
create temporary table writes (role text, t text, op text, n bigint) on commit drop;
grant all on writes to authenticated;
select pg_temp.login('00000000-0000-4000-d000-000000000005');
set local role authenticated;
insert into writes select 'lectura', t, op, pg_temp.writable(t, op) from tabs, unnest(array['update', 'delete']) op;
reset role;
select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;
insert into writes select 'obras', t, op, pg_temp.writable(t, op) from tabs, unnest(array['update', 'delete']) op;
reset role;

select is((select string_agg(t || ':' || op, ', ') from writes where role = 'lectura' and n > 0), null,
  'lectura cannot update or delete anything');
select is((select string_agg(t || ':' || op, ', ') from writes
           where role = 'obras' and n > 0 and not (t = 'tickets' and op = 'update')), null,
  'dependencia only updates its own tickets');
select ok((select n from writes where role = 'obras' and t = 'tickets' and op = 'update')
          = (select count(*) from public.tickets where department_id = '00000000-0000-4000-b000-000000000001'),
  'dependencia updates exactly its department''s tickets');

-- ---------------------------------------------------------------------------
-- Tenant isolation: an admin of another org sees and changes nothing here.
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, slug) values ('00000000-0000-4000-a000-000000000002', 'Municipio Vecino', 'vecino');
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-d000-000000000098', 'authenticated', 'authenticated',
        'admin@vecino2.test', '', '{}', '{}', now(), now());
insert into public.memberships (org_id, user_id, role) values ('00000000-0000-4000-a000-000000000002', '00000000-0000-4000-d000-000000000098', 'admin');

select pg_temp.login('00000000-0000-4000-d000-000000000098');
set local role authenticated;
select is((select string_agg(t, ', ') from tabs
           where t not in ('organizations', 'memberships') and pg_temp.visible_in(t, '00000000-0000-4000-a000-000000000001') > 0), null,
  'another org''s admin sees no rows of this org');
select is((select string_agg(t || ':' || op, ', ') from tabs, unnest(array['update', 'delete']) op
           where t not in ('organizations', 'memberships') and pg_temp.writable(t, op) > 0), null,
  'another org''s admin cannot change rows of this org');
reset role;

select * from finish();
rollback;
