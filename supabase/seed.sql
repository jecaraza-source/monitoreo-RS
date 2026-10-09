-- Development seed: one fictitious municipality with 5 departments, 10 neighborhoods,
-- 200 fictitious mentions and one user per role. All names, handles and texts are
-- invented; no real people are referenced.
--
-- Local users (password: password123):
--   admin@monitoreo.test         admin
--   comunicacion@monitoreo.test  comunicacion
--   obras@monitoreo.test         dependencia (Obras Públicas)
--   agua@monitoreo.test          dependencia (Agua Potable y Alcantarillado)
--   lectura@monitoreo.test       lectura

select setseed(0.42);

-- ---------------------------------------------------------------------------
-- Organization, departments, neighborhoods
-- ---------------------------------------------------------------------------

insert into public.organizations (id, name, slug, state) values
  ('00000000-0000-4000-a000-000000000001', 'Municipio de San Andrés del Valle', 'san-andres-del-valle', 'Estado de México');

insert into public.departments (id, org_id, name, short_name) values
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000001', 'Obras Públicas', 'obras'),
  ('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000001', 'Agua Potable y Alcantarillado', 'agua'),
  ('00000000-0000-4000-b000-000000000003', '00000000-0000-4000-a000-000000000001', 'Servicios Públicos', 'servicios'),
  ('00000000-0000-4000-b000-000000000004', '00000000-0000-4000-a000-000000000001', 'Seguridad Pública', 'seguridad'),
  ('00000000-0000-4000-b000-000000000005', '00000000-0000-4000-a000-000000000001', 'Desarrollo Social', 'social');

-- Neighborhoods as small square polygons around a fictitious center (19.40, -99.10).
insert into public.neighborhoods (id, org_id, name, geojson)
select
  ('00000000-0000-4000-c000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-4000-a000-000000000001',
  name,
  jsonb_build_object(
    'type', 'Polygon',
    'coordinates', jsonb_build_array(jsonb_build_array(
      jsonb_build_array(lng, lat),
      jsonb_build_array(lng + 0.01, lat),
      jsonb_build_array(lng + 0.01, lat + 0.01),
      jsonb_build_array(lng, lat + 0.01),
      jsonb_build_array(lng, lat)
    ))
  )
from (
  select
    n,
    name,
    -99.13 + ((n - 1) % 5) * 0.012 as lng,
    19.39 + ((n - 1) / 5) * 0.012 as lat
  from unnest(array[
    'Centro', 'San Miguel', 'Las Flores', 'El Mirador', 'Lomas del Valle',
    'Santa Cruz', 'Jardines del Sur', 'La Esperanza', 'Valle Verde', 'Los Pinos'
  ]) with ordinality as t(name, n)
) as hoods;

-- ---------------------------------------------------------------------------
-- Users and memberships
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
  extensions.crypt('password123', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', full_name), now(), now(),
  '', '', '', ''
from (values
  ('00000000-0000-4000-d000-000000000001'::uuid, 'admin@monitoreo.test', 'Administración'),
  ('00000000-0000-4000-d000-000000000002'::uuid, 'comunicacion@monitoreo.test', 'Comunicación Social'),
  ('00000000-0000-4000-d000-000000000003'::uuid, 'obras@monitoreo.test', 'Enlace Obras Públicas'),
  ('00000000-0000-4000-d000-000000000004'::uuid, 'agua@monitoreo.test', 'Enlace Agua Potable'),
  ('00000000-0000-4000-d000-000000000005'::uuid, 'lectura@monitoreo.test', 'Consulta')
) as u(id, email, full_name);

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, id::text, jsonb_build_object('sub', id::text, 'email', email), 'email', now(), now(), now()
from auth.users
where email like '%@monitoreo.test';

insert into public.memberships (org_id, user_id, role, department_id) values
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-d000-000000000001', 'admin', null),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-d000-000000000002', 'comunicacion', null),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-d000-000000000003', 'dependencia', '00000000-0000-4000-b000-000000000001'),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-d000-000000000004', 'dependencia', '00000000-0000-4000-b000-000000000002'),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-d000-000000000005', 'lectura', null);

-- ---------------------------------------------------------------------------
-- Monitoring configuration
-- ---------------------------------------------------------------------------

insert into public.projects (id, org_id, name, goal, kpis) values
  ('00000000-0000-4000-e000-000000000001', '00000000-0000-4000-a000-000000000001',
   'Escucha ciudadana 2026',
   'Detectar y atender en menos de 72 horas las demandas ciudadanas publicadas en medios y redes.',
   '[{"key":"tiempo_respuesta_horas","target":72},{"key":"sentimiento_positivo_pct","target":45},{"key":"tickets_resueltos_pct","target":80}]');

-- Taxonomy and rules the classifier uses for this project.
update public.projects set
  topics = array[
    'agua potable', 'alumbrado público', 'baches y pavimentación', 'drenaje', 'gestión del gobierno',
    'medio ambiente', 'obra pública', 'programas sociales', 'recolección de basura', 'salud',
    'seguridad pública', 'trámites y servicios', 'tránsito y vialidad'
  ],
  classification_rules = $rules$- Fugas, falta de agua, pipas, tandeo y drenaje: Agua Potable y Alcantarillado.
- Baches, banquetas, obras inconclusas y pavimentación: Obras Públicas.
- Basura, alumbrado, parques y panteones: Servicios Públicos.
- Robos, asaltos, patrullaje y violencia: Seguridad Pública.
- Becas, apoyos, salud comunitaria y DIF: Desarrollo Social.
- Tránsito, semáforos y vialidad: Seguridad Pública.
- Medio ambiente y tiraderos clandestinos: Servicios Públicos.
- Un bloqueo o protesta por falta de agua es prioridad alta.
- Los avisos oficiales de cortes programados son neutrales, intención "otro", prioridad baja.$rules$
where id = '00000000-0000-4000-e000-000000000001';

insert into public.queries (id, org_id, project_id, lineage_id, name, expression, builder, filters) values
  ('00000000-0000-4000-e100-000000000001', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e000-000000000001',
   '00000000-0000-4000-e110-000000000001', 'Municipio',
   '("San Andrés del Valle" OR SanAndresDelValle OR "ayuntamiento de San Andrés") AND NOT ("San Andrés Tuxtla" OR "San Andrés Cholula")',
   '{"groups":[{"mode":"any","terms":["San Andrés del Valle","SanAndresDelValle","ayuntamiento de San Andrés"]},{"mode":"none","terms":["San Andrés Tuxtla","San Andrés Cholula"]}]}',
   '{"lang":"es"}'),
  ('00000000-0000-4000-e100-000000000002', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-e000-000000000001',
   '00000000-0000-4000-e110-000000000002', 'Servicios básicos',
   '(agua OR fuga* OR bache* OR basura OR luminaria* OR drenaje) AND NOT (garrafon* OR "agua mineral")',
   '{"groups":[{"mode":"any","terms":["agua","fuga*","bache*","basura","luminaria*","drenaje"]},{"mode":"none","terms":["garrafon*","agua mineral"]}]}',
   '{"lang":"es"}');

-- Seed sources point at placeholder URLs/ids, so they start inactive: the cron
-- would only log errors for them. Connect real ones in Configuración → Fuentes.
insert into public.sources (id, org_id, name, type, config, is_active) values
  ('00000000-0000-4000-e200-000000000001', '00000000-0000-4000-a000-000000000001', 'Página oficial del Ayuntamiento', 'meta', '{"pageId":"000000000000001","includeComments":true}', false),
  ('00000000-0000-4000-e200-000000000002', '00000000-0000-4000-a000-000000000001', 'Noticias regionales (RSS)', 'rss', '{"url":"https://example.com/feed.xml"}', false),
  ('00000000-0000-4000-e200-000000000003', '00000000-0000-4000-a000-000000000001', 'Canal del Ayuntamiento', 'youtube', '{"channelId":"UC0000000000000000000000","includeComments":true}', false),
  ('00000000-0000-4000-e200-000000000004', '00000000-0000-4000-a000-000000000001', 'Búsqueda en X', 'x', '{}', false);

insert into public.authors (org_id, platform, handle, display_name, followers, kind) values
  ('00000000-0000-4000-a000-000000000001', 'rss', 'diario-del-valle', 'Diario del Valle', 85000, 'media'),
  ('00000000-0000-4000-a000-000000000001', 'x', 'noticiasvalle', 'Noticias del Valle', 42000, 'media'),
  ('00000000-0000-4000-a000-000000000001', 'meta', 'radiovalle', 'Radio Valle 98.5', 31000, 'media'),
  ('00000000-0000-4000-a000-000000000001', 'youtube', 'tvregional', 'TV Regional', 120000, 'media'),
  ('00000000-0000-4000-a000-000000000001', 'x', 'regidora_ejemplo', 'Regidora (cuenta ficticia)', 9800, 'public_figure'),
  ('00000000-0000-4000-a000-000000000001', 'meta', 'diputado_ejemplo', 'Diputado local (cuenta ficticia)', 15400, 'public_figure');

-- Pseudonymous citizen accounts (only to attribute mentions).
insert into public.authors (org_id, platform, handle, display_name, followers, kind)
select
  '00000000-0000-4000-a000-000000000001',
  (array['meta', 'x', 'youtube']::public.source_type[])[1 + (n % 3)],
  'vecino_' || lpad(n::text, 3, '0'),
  null,
  (random() * 900)::integer,
  'citizen'
from generate_series(1, 30) as n;

-- Topics that raise priority. Never names of people (see CLAUDE.md).
insert into public.risk_terms (org_id, term, normalized, severity) values
  ('00000000-0000-4000-a000-000000000001', 'Balacera', 'balacera', 'critical'),
  ('00000000-0000-4000-a000-000000000001', 'Inundación', 'inundacion', 'high'),
  ('00000000-0000-4000-a000-000000000001', 'Socavón', 'socavon', 'high'),
  ('00000000-0000-4000-a000-000000000001', 'Bloqueo', 'bloqueo', 'high'),
  ('00000000-0000-4000-a000-000000000001', 'Derrumbe', 'derrumbe', 'high'),
  ('00000000-0000-4000-a000-000000000001', 'Manifestación', 'manifestacion', 'medium');

-- ---------------------------------------------------------------------------
-- Mentions, classifications and tickets
-- ---------------------------------------------------------------------------

create temporary table seed_templates (
  idx integer primary key,
  department text not null,
  sentiment public.sentiment not null,
  topic text not null,
  intent text not null,
  emotion text not null,
  is_media boolean not null,
  body text not null
) on commit drop;

insert into seed_templates values
  (1,  'obras',     'negative', 'baches y pavimentación', 'queja',    'enojo',        false, 'Llevamos tres semanas con un bache enorme en la calle principal de {c} y nadie viene a taparlo. Hoy se ponchó otra llanta.'),
  (2,  'obras',     'positive', 'baches y pavimentación', 'elogio',   'gratitud',     false, 'Por fin terminaron la repavimentación en {c}, quedó muy bien. Gracias a Obras Públicas.'),
  (3,  'obras',     'neutral',  'obra pública',           'pregunta', 'neutral',      false, '¿Alguien sabe hasta cuándo va a estar cerrada la avenida en {c} por la obra del colector?'),
  (4,  'obras',     'negative', 'obra pública',           'queja',    'frustración',  false, 'La obra de la banqueta en {c} lleva dos meses abandonada, con varillas expuestas. Es un peligro para los niños.'),
  (5,  'agua',      'negative', 'agua potable',           'queja',    'enojo',        false, 'Otra vez sin agua en {c}, ya van cuatro días. ¿Dónde está la pipa que nos prometieron?'),
  (6,  'agua',      'negative', 'agua potable',           'denuncia', 'preocupación', false, 'Hay una fuga de agua potable en {c} desde el lunes, se están desperdiciando miles de litros y nadie atiende el reporte.'),
  (7,  'agua',      'positive', 'agua potable',           'elogio',   'gratitud',     false, 'Muy rápida la respuesta del organismo de agua: repararon la fuga en {c} en menos de 24 horas.'),
  (8,  'agua',      'neutral',  'agua potable',           'otro',     'neutral',      false, 'Aviso para vecinos de {c}: mañana habrá corte de agua de 8 a 16 h por mantenimiento al pozo.'),
  (9,  'agua',      'negative', 'drenaje',                'queja',    'enojo',        false, 'El drenaje en {c} se desborda cada vez que llueve, el agua negra entra a las casas.'),
  (10, 'servicios', 'negative', 'recolección de basura',  'queja',    'frustración',  false, 'El camión de la basura no ha pasado en toda la semana por {c}, ya huele horrible.'),
  (11, 'servicios', 'negative', 'alumbrado público',      'queja',    'preocupación', false, 'Mi calle en {c} está totalmente a oscuras, llevan un mes las luminarias fundidas. Da miedo caminar de noche.'),
  (12, 'servicios', 'positive', 'alumbrado público',      'elogio',   'alegría',      false, 'Gracias por cambiar las lámparas del parque de {c}, ahora los niños pueden jugar en la tarde.'),
  (13, 'servicios', 'neutral',  'recolección de basura',  'pregunta', 'neutral',      false, '¿Cuál es el horario del camión de la basura en {c}? Nunca sé qué días pasa.'),
  (14, 'seguridad', 'negative', 'seguridad pública',      'denuncia', 'miedo',        false, 'Asaltaron a una señora en la parada del camión en {c}. Necesitamos más rondines, por favor.'),
  (15, 'seguridad', 'negative', 'seguridad pública',      'queja',    'miedo',        false, 'Muchos robos a casa habitación en {c} últimamente y la patrulla casi nunca pasa.'),
  (16, 'seguridad', 'positive', 'seguridad pública',      'elogio',   'gratitud',     false, 'Bien por la policía municipal, detuvieron a los que robaban autopartes en {c}.'),
  (17, 'seguridad', 'neutral',  'seguridad pública',      'otro',     'neutral',      false, 'Este jueves hay reunión vecinal de seguridad en {c} con la policía municipal, a las 7 pm en la cancha.'),
  (18, 'social',    'positive', 'programas sociales',     'elogio',   'gratitud',     false, 'Mi mamá ya recibió su apoyo del programa municipal para adultos mayores. Muy agradecidos.'),
  (19, 'social',    'positive', 'salud',                  'elogio',   'alegría',      false, 'Excelente la jornada de salud en {c}, atendieron a muchísimas familias y fue gratis.'),
  (20, 'social',    'negative', 'programas sociales',     'queja',    'frustración',  false, 'Fui a registrarme al programa de becas y me dijeron que ya no había lugares. Muy mal organizado.'),
  (21, 'social',    'neutral',  'programas sociales',     'pregunta', 'neutral',      false, '¿Dónde puedo inscribir a mi hijo al programa de becas municipales? Vivo en {c}.'),
  (22, 'obras',     'neutral',  'obra pública',           'otro',     'neutral',      true,  'Ayuntamiento de San Andrés del Valle anuncia inversión de 12 millones de pesos para pavimentación en {c}.'),
  (23, 'agua',      'negative', 'agua potable',           'otro',     'preocupación', true,  'Vecinos de {c} bloquean la avenida principal por falta de agua; exigen la presencia de autoridades municipales.'),
  (24, 'social',    'positive', 'obra pública',           'otro',     'alegría',      true,  'El presidente municipal inaugura el nuevo centro comunitario en {c}, con talleres y consultorio médico.'),
  (25, 'seguridad', 'negative', 'seguridad pública',      'otro',     'preocupación', true,  'Aumentan los reportes de robo en {c}, según vecinos consultados por este medio.');

create temporary table seed_mentions on commit drop as
select
  n,
  t.*,
  ('00000000-0000-4000-c000-0000000000' || lpad((1 + floor(random() * 10))::text, 2, '0'))::uuid as neighborhood_id,
  now() - (random() * interval '14 days') as published_at,
  random() as r
from (
  -- Pick the template once per row; random() in a join condition would be
  -- re-evaluated per candidate and could match several templates.
  select n, 1 + ((n * 7 + floor(random() * 3)::integer) % 25) as pick
  from generate_series(1, 200) as n
) as picks
join seed_templates t on t.idx = picks.pick;

insert into public.mentions (id, org_id, source_id, external_id, url, text, published_at, author_id, metrics, query_id, status)
select
  ('00000000-0000-4000-f000-' || lpad(n::text, 12, '0'))::uuid,
  '00000000-0000-4000-a000-000000000001',
  src.id,
  'seed-' || n,
  'https://example.com/m/' || n,
  replace(sm.body, '{c}', h.name),
  sm.published_at,
  a.id,
  jsonb_build_object(
    'likes', (random() * case when sm.is_media then 900 else 120 end)::integer,
    'shares', (random() * case when sm.is_media then 300 else 40 end)::integer,
    'comments', (random() * case when sm.is_media then 200 else 30 end)::integer
  ),
  case when sm.department in ('agua', 'obras', 'servicios')
    then '00000000-0000-4000-e100-000000000002'::uuid
    else '00000000-0000-4000-e100-000000000001'::uuid end,
  -- ~10 % stay pending so the AI classifier (/api/cron/classify) has real work on a fresh seed.
  (case when sm.r < 0.9 then 'classified' else 'pending' end)::public.mention_status
from seed_mentions sm
join public.neighborhoods h on h.id = sm.neighborhood_id
cross join lateral (
  select au.id, au.platform
  from public.authors au
  where au.kind = case when sm.is_media then 'media'::public.author_kind else 'citizen'::public.author_kind end
  order by md5(au.handle || sm.n)
  limit 1
) a
join public.sources src on src.type = a.platform;

insert into public.classifications (org_id, mention_id, sentiment, confidence, emotion, topic, intent, priority, department_id, neighborhood_id, model)
select
  m.org_id,
  m.id,
  sm.sentiment,
  round((0.7 + random() * 0.29)::numeric, 3),
  sm.emotion,
  sm.topic,
  sm.intent,
  (case
    when sm.sentiment = 'negative' and sm.department = 'seguridad' then 'critical'
    when sm.sentiment = 'negative' and sm.is_media then 'high'
    when sm.sentiment = 'negative' then (array['medium', 'high'])[1 + (sm.n % 2)]
    when sm.intent = 'pregunta' then 'medium'
    else 'low'
  end)::public.priority,
  d.id,
  sm.neighborhood_id,
  'seed'
from seed_mentions sm
join public.mentions m on m.external_id = 'seed-' || sm.n
join public.departments d on d.short_name = sm.department
where m.status = 'classified';

-- Route complaints, reports and questions to the responsible department.
insert into public.tickets (org_id, mention_id, department_id, assignee_id, status, due_at, resolved_at, created_at)
select
  c.org_id,
  c.mention_id,
  c.department_id,
  case c.department_id
    when '00000000-0000-4000-b000-000000000001' then '00000000-0000-4000-d000-000000000003'::uuid
    when '00000000-0000-4000-b000-000000000002' then '00000000-0000-4000-d000-000000000004'::uuid
  end,
  st.status,
  m.published_at + interval '72 hours',
  case when st.status in ('resolved', 'closed') then m.published_at + (random() * interval '60 hours') end,
  m.published_at + interval '30 minutes'
from public.classifications c
join public.mentions m on m.id = c.mention_id
cross join lateral (
  select (array['open', 'open', 'in_progress', 'resolved', 'closed'])[1 + (abs(hashtext(c.mention_id::text)) % 5)]::public.ticket_status as status
) st
where c.intent in ('queja', 'denuncia', 'pregunta')
   or (c.sentiment = 'negative');

-- Triage state in the inbox: routed when it has a ticket, some praise already reviewed.
update public.mentions m set triage = 'routed'
where exists (select 1 from public.tickets t where t.mention_id = m.id);
update public.mentions m set triage = 'reviewed'
from public.classifications c
where c.mention_id = m.id and m.triage = 'new' and c.sentiment = 'positive' and abs(hashtext(m.id::text)) % 2 = 0;

-- ---------------------------------------------------------------------------
-- Alerts and reports
-- ---------------------------------------------------------------------------

insert into public.alert_rules (id, org_id, name, kind, condition, channels, department_id, cooldown_minutes) values
  ('00000000-0000-4000-e300-000000000001', '00000000-0000-4000-a000-000000000001', 'Pico de volumen', 'spike',
   '{"window_minutes":60,"baseline_days":14,"k":3,"min_mentions":10}', '{"email":["comunicacion@monitoreo.test"]}', null, 120),
  ('00000000-0000-4000-e300-000000000002', '00000000-0000-4000-a000-000000000001', 'Agua: caída de sentimiento', 'sentiment_drop',
   '{"window_minutes":180,"baseline_days":14,"drop_points":25,"min_mentions":5}', '{"email":["agua@monitoreo.test"]}',
   '00000000-0000-4000-b000-000000000002', 360),
  ('00000000-0000-4000-e300-000000000003', '00000000-0000-4000-a000-000000000001', 'Términos de riesgo', 'risk_term',
   '{"window_minutes":60,"min_severity":"high"}', '{"email":["comunicacion@monitoreo.test"]}', null, 360),
  ('00000000-0000-4000-e300-000000000004', '00000000-0000-4000-a000-000000000001', 'Medios en contra', 'media_negative',
   '{"window_minutes":60}', '{"email":["comunicacion@monitoreo.test"]}', null, 720),
  ('00000000-0000-4000-e300-000000000005', '00000000-0000-4000-a000-000000000001', 'Resumen diario', 'daily_digest',
   '{"hour":8}', '{"email":["comunicacion@monitoreo.test"]}', null, 1380);

-- Past alerts: one for Agua (visible to that department) and one org-wide already rated.
insert into public.alert_events (org_id, rule_id, mention_id, mention_ids, department_id, kind, severity, title, summary,
                                 fingerprint, payload, notifications, created_at, acknowledged_at, feedback, feedback_at)
select
  m.org_id, '00000000-0000-4000-e300-000000000002', m.id, array[m.id], '00000000-0000-4000-b000-000000000002',
  'sentiment_drop', 'high', 'El sentimiento cayó 32 puntos',
  'NSS de -71 en las últimas 3 horas (7 menciones) contra -39 en los 14 días previos.',
  'sentiment', '{"drop":32}', '{"in_app":{"status":"sent"},"email":{"status":"not_configured"}}',
  now() - interval '2 days', null, null, null
from public.mentions m
join public.classifications c on c.mention_id = m.id
where c.topic = 'agua potable' and c.sentiment = 'negative'
order by m.published_at desc
limit 1;

insert into public.alert_events (org_id, rule_id, mention_id, mention_ids, kind, severity, title, summary,
                                 fingerprint, payload, notifications, created_at, acknowledged_at, feedback, feedback_by, feedback_at)
select
  m.org_id, '00000000-0000-4000-e300-000000000004', m.id, array[m.id], 'media_negative', 'medium',
  coalesce(a.display_name, a.handle) || ' (medio) publicó una mención negativa', left(m.text, 140),
  'author:' || a.id, jsonb_build_object('author_id', a.id), '{"in_app":{"status":"sent"},"email":{"status":"not_configured"}}',
  now() - interval '1 day', now() - interval '20 hours', 'useful', '00000000-0000-4000-d000-000000000002', now() - interval '20 hours'
from public.mentions m
join public.classifications c on c.mention_id = m.id
join public.authors a on a.id = m.author_id
where a.kind = 'media' and c.sentiment = 'negative'
order by m.published_at desc
limit 1;

insert into public.reports (org_id, period, period_start, period_end, content) values
  ('00000000-0000-4000-a000-000000000001', 'weekly', current_date - 7, current_date - 1,
   '{"title":"Reporte semanal de escucha ciudadana","summary":"Reporte de ejemplo generado por el seed.","highlights":[]}');

refresh materialized view public.mention_stats_hourly;
