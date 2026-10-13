-- Stage 5: operational views. Every counter equals the length of its list
-- with the same filters, the order is urgency, due date, age with a stable
-- tie-break, pages do not repeat or skip, and RLS scopes lists and counters
-- alike (a department never sees what is not its own). Fictitious data.
begin;
select plan(20);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- Full list of a view, paging 7 by 7 through the cursor.
create function pg_temp.paged(p_view text, p_filters jsonb default '{}') returns table (n integer, kind text, id uuid)
language plpgsql as $$
declare
  v_cursor jsonb := null;
  v_row record;
  v_n integer := 0;
  v_got integer;
begin
  loop
    v_got := 0;
    for v_row in select * from public.inbox_queue('00000000-0000-4000-a000-000000000001', p_view, p_filters, v_cursor, 7) loop
      v_n := v_n + 1; v_got := v_got + 1;
      n := v_n; kind := v_row.kind; id := v_row.id;
      return next;
      v_cursor := jsonb_build_object('urgency', v_row.urgency, 'due_at', v_row.due_at, 'item_at', v_row.item_at, 'kind', v_row.kind, 'id', v_row.id);
    end loop;
    exit when v_got < 7;
  end loop;
end;
$$;

-- An emergency, a mere critique and a low-priority question, with no turns.
insert into public.mentions (id, org_id, source_id, external_id, text, published_at, status, triage) values
  ('00000000-0000-4000-9700-000000000001', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e200-000000000002', 'tq1',
   'Se está incendiando una casa en la calle Juárez, hay gente adentro', now() - interval '20 minutes', 'classified', 'new'),
  ('00000000-0000-4000-9700-000000000002', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e200-000000000002', 'tq2',
   'Este gobierno es un desastre, puro choro', now() - interval '30 minutes', 'classified', 'new'),
  ('00000000-0000-4000-9700-000000000003', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e200-000000000002', 'tq3',
   '¿A qué hora abre la ventanilla de predial?', now() - interval '40 minutes', 'classified', 'new');
insert into public.classifications (org_id, mention_id, sentiment, confidence, topic, intent, priority, severity, incident_type, needs_attention, model) values
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9700-000000000001', 'negative', 0.95, 'seguridad pública', 'denuncia', 'high', 'emergency', 'civil_protection', true, 'm'),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9700-000000000002', 'negative', 0.92, 'gestión del gobierno', 'otro', 'low', 'none', 'none', false, 'm'),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9700-000000000003', 'neutral', 0.9, 'trámites y servicios', 'pregunta', 'low', 'none', 'none', true, 'm');

select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;

create temp table counts on commit drop as
  select public.inbox_counts('00000000-0000-4000-a000-000000000001') as c;

select is((select count(*)::int from pg_temp.paged('new')), (select (c ->> 'new')::int from counts), 'Nuevas: counter = list');
select is((select count(*)::int from pg_temp.paged('urgent')), (select (c ->> 'urgent')::int from counts), 'Urgentes: counter = list');
select is((select count(*)::int from pg_temp.paged('unassigned')), (select (c ->> 'unassigned')::int from counts), 'Sin responsable: counter = list');
select is((select count(*)::int from pg_temp.paged('acceptance')), (select (c ->> 'acceptance')::int from counts), 'Por aceptar: counter = list');
select is((select count(*)::int from pg_temp.paged('overdue')), (select (c ->> 'overdue')::int from counts), 'Vencidas: counter = list');
select is((select count(*)::int from pg_temp.paged('validation')), (select (c ->> 'validation')::int from counts), 'Por validar: counter = list');

-- Filters change list and counter together.
select is((select count(*)::int from pg_temp.paged('new', '{"sentiment":"negative","q":"gobierno"}')),
          (public.inbox_counts('00000000-0000-4000-a000-000000000001', '{"sentiment":"negative","q":"gobierno"}') ->> 'new')::int,
          'with filters and search, counter = list');

-- Paging: no repeats, nothing skipped, same order as one big page.
select is((select count(distinct (kind, id))::int from pg_temp.paged('new')), (select count(*)::int from pg_temp.paged('new')), 'pages do not repeat items');
select ok((select array_agg(id order by n) from pg_temp.paged('new'))
          = (select array_agg(q.id) from public.inbox_queue('00000000-0000-4000-a000-000000000001', 'new', '{}', null, 200) q),
          'paging by cursor gives the same sequence as one page');

-- Order: the emergency leads its view; urgency never increases down the list.
select is((select id from public.inbox_queue('00000000-0000-4000-a000-000000000001', 'urgent', '{}', null, 1)),
          '00000000-0000-4000-9700-000000000001'::uuid, 'the emergency is first among the urgent');
select ok(not exists (
  select 1 from (select urgency, lag(urgency) over (order by n) as prev
                 from pg_temp.paged('new') p join public.inbox_queue('00000000-0000-4000-a000-000000000001', 'new', '{}', null, 200) q using (kind, id)) x
  where x.urgency > x.prev), 'urgency only decreases down the list');

-- A negative critique is not an emergency nor urgent; it is not unassigned work either.
select ok(not exists (select 1 from pg_temp.paged('urgent') where id = '00000000-0000-4000-9700-000000000002'), 'a critique is not urgent');
select ok(not exists (select 1 from pg_temp.paged('unassigned') where id = '00000000-0000-4000-9700-000000000002'), 'a critique needs no responsible');
select ok(exists (select 1 from pg_temp.paged('unassigned') where id = '00000000-0000-4000-9700-000000000003'), 'a question needs a responsible');
reset role;

-- Departments: only their own items, counters included.
select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;
select is((public.inbox_counts('00000000-0000-4000-a000-000000000001') ->> 'new')::int, 0, 'a department has no triage queue');
select is((public.inbox_counts('00000000-0000-4000-a000-000000000001') ->> 'review')::int, 0, 'nor the review queue');
select ok(not exists (
  select 1 from public.inbox_queue('00000000-0000-4000-a000-000000000001', 'acceptance', '{}', null, 200) q
  where q.kind = 'mention' and not exists (
    select 1 from public.tickets t where t.mention_id = q.id and t.department_id = '00000000-0000-4000-b000-000000000001')),
  'Obras only gets mentions with its own turn');
select is((public.inbox_counts('00000000-0000-4000-a000-000000000001') ->> 'acceptance')::int,
          (select count(*)::int from public.inbox_queue('00000000-0000-4000-a000-000000000001', 'acceptance', '{}', null, 200)),
          'department counter = department list');
select is((select count(*)::int from public.inbox_queue('00000000-0000-4000-a000-000000000001', 'urgent', '{}', null, 200)
           where id = '00000000-0000-4000-9700-000000000001'), 0, 'nor sees mentions not routed to it');
reset role;

-- Another municipality sees nothing of this one.
select pg_temp.login('00000000-0000-4000-d000-000000000012');
set local role authenticated;
select is(public.inbox_counts('00000000-0000-4000-a000-000000000001') ->> 'urgent', '0', 'another municipality counts nothing here');
reset role;

select * from finish();
rollback;
