-- Demo data for the "Percepción de funcionarios" dashboard (/funcionarios).
-- Fictitious officials and ~70 classified mentions about their management,
-- spread over the last 60 days (current period and the previous one).
--
-- For a preview/demo project only, never production. Run it in the SQL
-- Editor after the seed (it reuses the org's sources and authors). Set the
-- org below. Idempotent: running it again adds nothing; dates are relative
-- to the day it runs.

do $$
declare
  v_org uuid := '00000000-0000-4000-a000-000000000001'; -- municipality to fill
  v_now timestamptz := date_trunc('hour', now());
begin
  if not exists (select 1 from public.organizations where id = v_org) then
    raise exception 'org % does not exist', v_org;
  end if;

  -- Officials. One that already exists keeps its data and gains the aliases.
  insert into public.officials (org_id, name, position, aliases)
  values
    (v_org, 'Juan Lopez', 'Presidente Municipal', '{presidente municipal,alcalde,edil}'),
    (v_org, 'Ana Gonzalez', 'Tesorera Municipal', '{tesorera,tesorería municipal}'),
    (v_org, 'Carlos Ramírez', 'Director de Obras Públicas', '{director de obras}'),
    (v_org, 'Laura Méndez', 'Directora de Seguridad Pública', '{directora de seguridad}')
  on conflict (org_id, name) do update
    set aliases = array(select distinct unnest(public.officials.aliases || excluded.aliases))
    where not excluded.aliases <@ public.officials.aliases;

  -- Mentions: each phrase is published 1–3 times on different days. The
  -- author is taken from the org by kind (citizens stay anonymous in the
  -- dashboard; media and public figures are named).
  with phrases (n, text, sentiment, emotion, topic, intent, priority, kind) as (
    values
      -- Presidente municipal
      (1, 'El alcalde Juan López no ha dado la cara por las inundaciones en la cabecera. Queremos respuestas, no fotos.', 'negative', 'enojo', 'gestión del gobierno', 'queja', 'high', 'citizen'),
      (2, 'Muy bien el presidente municipal recorriendo las colonias afectadas por la lluvia, así se gobierna.', 'positive', 'gratitud', 'gestión del gobierno', 'elogio', 'low', 'citizen'),
      (3, 'El presidente municipal prometió en campaña arreglar el drenaje del centro y seguimos igual.', 'negative', 'frustración', 'drenaje', 'queja', 'medium', 'citizen'),
      (4, 'Juan López presentó su informe de actividades: 42 calles pavimentadas y nuevo alumbrado en el malecón.', 'neutral', 'neutral', 'rendición de cuentas', 'otro', 'low', 'media'),
      (5, '¿Cuándo va a recibir el alcalde a los pescadores? Llevamos tres semanas esperando audiencia.', 'negative', 'frustración', 'atención ciudadana', 'pregunta', 'medium', 'citizen'),
      (6, 'Hay que reconocerle al edil que sí cumplió con el apoyo a las familias de Antón Lizardo.', 'positive', 'gratitud', 'programas sociales', 'elogio', 'low', 'citizen'),
      (7, 'El presidente municipal anunció la rehabilitación del mercado; comerciantes piden conocer el proyecto.', 'neutral', 'neutral', 'obra pública', 'otro', 'low', 'media'),
      (8, 'Mucha publicidad del alcalde en redes y las calles de mi colonia siguen sin luz.', 'negative', 'enojo', 'gestión del gobierno', 'queja', 'medium', 'citizen'),
      (9, 'Solicitamos al presidente municipal transparentar el gasto de la feria. El cabildo no ha recibido el informe.', 'negative', 'preocupación', 'transparencia', 'denuncia', 'medium', 'public_figure'),
      (10, 'Gracias al alcalde Juan López por la jornada de salud gratuita, atendieron a mi papá muy bien.', 'positive', 'gratitud', 'salud', 'elogio', 'low', 'citizen'),
      (11, 'El alcalde dijo que el agua regresaría en dos días y ya va una semana. Que deje de prometer.', 'negative', 'enojo', 'agua potable', 'queja', 'high', 'citizen'),
      (12, 'Buena la decisión del presidente municipal de abrir las sesiones de cabildo en transmisión en vivo.', 'positive', 'alegría', 'transparencia', 'elogio', 'low', 'citizen'),
      -- Tesorera
      (13, 'La tesorera Ana González explicó que el descuento del predial se amplía hasta fin de mes.', 'neutral', 'neutral', 'finanzas municipales', 'otro', 'low', 'media'),
      (14, 'Fui a pagar el predial y la tesorería municipal tenía una sola ventanilla abierta, tres horas de fila.', 'negative', 'frustración', 'atención ciudadana', 'queja', 'medium', 'citizen'),
      (15, 'Ana González no ha respondido cuánto se pagó por las luminarias. Exigimos la factura pública.', 'negative', 'preocupación', 'transparencia', 'denuncia', 'medium', 'public_figure'),
      (16, 'Excelente que la tesorería municipal ya acepte pago en línea, ahorré toda la mañana.', 'positive', 'alegría', 'finanzas municipales', 'elogio', 'low', 'citizen'),
      (17, 'La tesorera presentó la cuenta pública trimestral ante el cabildo; la deuda bajó 8%.', 'positive', 'neutral', 'rendición de cuentas', 'otro', 'low', 'media'),
      (18, 'Me cobraron recargos que no debía en la tesorería municipal y nadie me da solución.', 'negative', 'enojo', 'finanzas municipales', 'queja', 'medium', 'citizen'),
      -- Director de obras
      (19, 'El director de obras Carlos Ramírez dijo que el puente quedaría en septiembre y sigue a medias.', 'negative', 'frustración', 'obra pública', 'queja', 'high', 'citizen'),
      (20, 'Gracias al director de obras por atender rápido el socavón de la calle Independencia.', 'positive', 'gratitud', 'baches y pavimentación', 'elogio', 'low', 'citizen'),
      (21, 'Carlos Ramírez informó que la pavimentación del camino a Salinas avanza al 70%.', 'neutral', 'neutral', 'obra pública', 'otro', 'low', 'media'),
      (22, 'El director de obras debería explicar por qué la misma constructora gana todas las licitaciones.', 'negative', 'preocupación', 'transparencia', 'denuncia', 'medium', 'public_figure'),
      (23, 'Quedó muy bien la cancha de Buenavista, buen trabajo del director de obras y su equipo.', 'positive', 'alegría', 'obra pública', 'elogio', 'low', 'citizen'),
      (24, 'Dejaron la calle abierta un mes y el director de obras ni contesta. Ya hubo dos accidentes.', 'negative', 'enojo', 'baches y pavimentación', 'queja', 'high', 'citizen'),
      -- Directora de seguridad
      (25, 'La directora de seguridad Laura Méndez anunció más patrullajes nocturnos en la zona centro.', 'neutral', 'neutral', 'seguridad pública', 'otro', 'low', 'media'),
      (26, 'Desde que llegó Laura Méndez se siente más tranquilo el malecón en la noche. Bien por ella.', 'positive', 'gratitud', 'seguridad pública', 'elogio', 'low', 'citizen'),
      (27, 'Asaltaron otra tienda en Arbolillo y la directora de seguridad sigue sin dar declaraciones.', 'negative', 'miedo', 'seguridad pública', 'queja', 'high', 'citizen'),
      (28, 'Reconocimiento a la directora de seguridad por la detención de la banda de robo a casas.', 'positive', 'gratitud', 'seguridad pública', 'elogio', 'low', 'public_figure'),
      (29, 'Llamé al 911 y la patrulla llegó una hora después. ¿Qué dice Laura Méndez de eso?', 'negative', 'enojo', 'seguridad pública', 'queja', 'medium', 'citizen'),
      -- Several officials at once
      (30, 'El alcalde y el director de obras inauguraron el colector pluvial de Chocotán; vecinos piden que funcione en esta temporada.', 'neutral', 'neutral', 'obra pública', 'otro', 'low', 'media'),
      (31, 'El presidente municipal y la tesorera deben explicar el aumento del agua. Nadie avisó nada.', 'negative', 'enojo', 'finanzas municipales', 'queja', 'medium', 'citizen'),
      (32, 'Buena coordinación del alcalde con la directora de seguridad en las fiestas patronales, todo en orden.', 'positive', 'alegría', 'seguridad pública', 'elogio', 'low', 'citizen')
  ),
  -- Copies: 0 and 1 in the last 30 days, 2 in the previous 30 (fewer
  -- negatives back then, so the change shows).
  copies as (
    select p.*, k,
      case when k < 2 then ((p.n * 7 + k * 13) % 29) + 0.2
           else 30 + ((p.n * 5) % 28) + 0.5 end as days_ago
    from phrases p
    cross join generate_series(0, 2) k
    where k = 0
       or (k = 1 and p.n % 3 <> 0)
       or (k = 2 and (p.sentiment <> 'negative' or p.n % 4 = 0))
  ),
  pool as (
    select a.id, a.kind, a.platform,
      row_number() over (partition by a.kind order by a.handle) - 1 as i,
      count(*) over (partition by a.kind) as total
    from public.authors a
    where a.org_id = v_org
  ),
  picked as (
    select c.*,
      md5('demo-funcionarios-' || c.n || '-' || c.k)::uuid as mention_id,
      a.id as author_id,
      s.id as source_id
    from copies c
    join pool a on a.kind::text = c.kind and a.i = (c.n + c.k) % a.total
    join lateral (
      select s.id from public.sources s
      where s.org_id = v_org and s.type::text = a.platform::text
      order by s.id limit 1
    ) s on true
  ),
  inserted as (
    insert into public.mentions (id, org_id, source_id, external_id, url, text, published_at, author_id, metrics, status, triage)
    select r.mention_id, v_org, r.source_id, 'demo-funcionarios-' || r.n || '-' || r.k,
      'https://example.com/demo/funcionarios/' || r.n || '-' || r.k,
      r.text,
      v_now - make_interval(hours => (r.days_ago * 24)::int + (r.n * 3) % 11),
      r.author_id,
      jsonb_build_object(
        'likes', 15 + (r.n * 37 + r.k * 11) % 240,
        'shares', 2 + (r.n * 13 + r.k * 7) % 60,
        'comments', 3 + (r.n * 19 + r.k * 5) % 90),
      'classified', 'reviewed'
    from picked r
    on conflict do nothing
    returning id
  )
  insert into public.classifications (org_id, mention_id, sentiment, confidence, emotion, topic, intent, priority, model)
  select v_org, r.mention_id, r.sentiment::public.sentiment, 0.82 + (r.n % 15) / 100.0,
    r.emotion, r.topic, r.intent, r.priority::public.priority, 'demo'
  from picked r
  join inserted i on i.id = r.mention_id;
end;
$$;

-- Who appears with how many mentions (last 30 days).
select o.name, o.position, count(om.mention_id) as mentions_30d
from public.officials o
left join public.official_mentions om on om.official_id = o.id and om.published_at >= now() - interval '30 days'
where o.org_id = '00000000-0000-4000-a000-000000000001'
group by o.name, o.position
order by mentions_30d desc;
