-- Stage 4: grouping suggestions need location or wording close in time;
-- a shared sentiment or topic alone suggests nothing, and nothing is added
-- without a person. Fictitious data.
begin;
select plan(6);

create function pg_temp.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

insert into public.mentions (id, org_id, source_id, external_id, text, published_at, status) values
  ('00000000-0000-4000-9600-000000000001', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e200-000000000002', 'sg1',
   'Fuga de agua potable en la calle Hidalgo, colonia Centro, desde ayer', now() - interval '3 hours', 'classified'),
  ('00000000-0000-4000-9600-000000000002', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e200-000000000002', 'sg2',
   'Sigue la fuga de agua potable en Hidalgo, ya inundó la banqueta', now() - interval '1 hour', 'classified'),
  ('00000000-0000-4000-9600-000000000003', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e200-000000000002', 'sg3',
   'Pésimo el festival del parque, mucha basura y ruido', now() - interval '2 hours', 'classified'),
  ('00000000-0000-4000-9600-000000000004', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e200-000000000002', 'sg4',
   'Fuga de agua potable en la calle Hidalgo otra vez', now() - interval '10 days', 'classified'),
  ('00000000-0000-4000-9600-000000000005', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e200-000000000002', 'sg5',
   'Reportan escasez de agua potable en Las Flores', now() - interval '2 hours', 'classified');
insert into public.classifications (org_id, mention_id, sentiment, topic, priority, neighborhood_id, model) values
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9600-000000000001', 'negative', 'agua potable', 'high', '00000000-0000-4000-c000-000000000001', 'm'),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9600-000000000002', 'negative', 'agua potable', 'high', '00000000-0000-4000-c000-000000000001', 'm'),
  -- Same (negative) sentiment, other topic and place: nothing in common but the mood.
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9600-000000000003', 'negative', 'medio ambiente', 'low', '00000000-0000-4000-c000-000000000003', 'm'),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9600-000000000004', 'negative', 'agua potable', 'high', '00000000-0000-4000-c000-000000000001', 'm'),
  -- Same topic only, another colonia.
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9600-000000000005', 'negative', 'agua potable', 'medium', '00000000-0000-4000-c000-000000000003', 'm');

select pg_temp.login('00000000-0000-4000-d000-000000000002');
set local role authenticated;
create temp table c on commit drop as select public.create_case('00000000-0000-4000-a000-000000000001',
  array['00000000-0000-4000-9600-000000000001'::uuid], 'Fuga en Hidalgo', '', 'agua potable', '00000000-0000-4000-c000-000000000001', 'high') as id;
create temp table s on commit drop as select * from public.suggest_case_mentions((select id from c), 50);

select ok(exists (select 1 from s where mention_id = '00000000-0000-4000-9600-000000000002' and same_neighborhood), 'same place, same words, close in time: suggested');
select ok(not exists (select 1 from s where mention_id = '00000000-0000-4000-9600-000000000003'), 'sharing only the sentiment suggests nothing');
select ok(not exists (select 1 from s where mention_id = '00000000-0000-4000-9600-000000000005'), 'sharing only the topic suggests nothing');
select ok(not exists (select 1 from s where mention_id = '00000000-0000-4000-9600-000000000004'), 'too far in time is not suggested');
select is((select count(*) from public.case_mentions where case_id = (select id from c)), 1::bigint, 'suggestions add nothing by themselves');
reset role;

select pg_temp.login('00000000-0000-4000-d000-000000000003');
set local role authenticated;
select throws_ok($$ select * from public.suggest_case_mentions((select id from c)) $$, '42501', 'not allowed', 'departments do not get suggestions');
reset role;

select * from finish();
rollback;
