# Etapa 2 — Cobertura de la ingesta y clasificación confiable

Base: `main` en `ea3e9e8` (cierre de la etapa 1). Hallazgos de la matriz que cubre: #2 (captura truncada), #3
(clasificación concurrente y correcciones pisadas), parte de #6 (interacciones que no se actualizaban) y parte de
#8 (llamadas a Claude sin timeout).

## 1. Qué ya estaba resuelto y se conserva

| Pieza | Estado previo | Se conserva |
|---|---|---|
| Dedupe | `unique (source_id, external_id)` + `ON CONFLICT DO NOTHING` | Igual llave; ahora con `DO UPDATE` sólo de métricas |
| Versión de consulta | Cada versión de una consulta es una fila (`lineage_id`, `version`); `mentions.query_id` apunta a la versión exacta (migración `20261010…`) | Igual; una mención que reaparece **no** cambia de consulta |
| Traslape de 15 min y 3 días de historial inicial | `sinceFor` | Igual, en `coverage.ts` |
| Espera exponencial de fuentes (1 h…24 h tras 3 fallos) | `inBackoff` en TS | Igual regla, ahora en SQL (`claim_sources`) |
| Correcciones con autor y hora | Trigger `stamp_correction` (`corrected_by`, `corrected_at`) | Igual; es la condición que protege la corrección |
| Validación con un reintento correctivo y paso al modelo "smart" | `classifier.ts` | Igual |
| Cancelación y timeout de la fuente | Etapa 1 (`withDeadline`, `signal`) | Igual; se agrega un tope "suave" por fuente |

## 2. Contrato de conectores

`src/lib/connectors/types.ts`. `fetchSince(source, since, ctx)` recibe la ventana `(since, until]` (`ctx.until`)
y un plazo suave (`ctx.deadline`). Devuelve:

| Campo | Significado |
|---|---|
| `mentions` | Elementos normalizados de la ventana |
| `cursor` | Progreso propio del conector (publicaciones y videos recientes, con el cursor de comentarios de cada uno) |
| `complete` | Se leyó la ventana completa |
| `resumeUntil` | Si no se completó: hasta qué fecha de publicación (inclusive) falta leer |
| `gap` | Rango que el proveedor ya no puede devolver (se reporta, no se reintenta) |
| `limits` | Topes alcanzados: `pages`, `items`, `time`, `tie`, `comments`, `recent`, `feed_window`, `error` |
| `interruptedBy` | Un error después de leer algunas páginas: lo leído se guarda y el resto se reanuda |

`readNewestFirst` (`window.ts`) implementa la lectura paginada para proveedores que listan de lo más nuevo a lo
más viejo, y `coverage.ts` decide la ventana de cada corrida y cuándo avanza `sources.covered_until`:

- Una ventana completa mueve `covered_until` a su fin.
- Una ventana cortada guarda `backfill = {since, until: resumeUntil, coverTo}` en el cursor y **no mueve**
  `covered_until`. La siguiente corrida lee primero ese tramo y, al completarlo, salta a `coverTo`.
- **Empates de hora:** la reanudación usa `until` inclusivo (+1 s en APIs con límite exclusivo), así que los
  elementos con la misma hora se releen y el dedupe los absorbe.
- **Empate atascado:** si en un mismo segundo hay más elementos de los que cabe en una corrida, ese segundo se
  salta, se reporta como hueco y la corrida sigue (no se queda en un bucle).
- `last_success_at` conserva su significado ("última corrida sin error"); la cobertura vive en `covered_until`.
  El backfill de la migración copia `last_success_at` a `covered_until` (repetible).

Por conector:

| Conector | Antes | Después |
|---|---|---|
| RSS | Tope de 200; descartaba lo fechado antes de `since` | Feed completo; acepta notas fechadas hasta 7 días antes de la ventana (indexación tardía); hueco reportado si el feed ya pasó de largo |
| Facebook, publicaciones | 4 páginas de 25 sin reanudación | 10 páginas de 100 con `since`/`until`; reanuda en `resumeUntil` |
| Facebook, comentarios | 3 páginas del más nuevo al más viejo, filtrados por `since`; 20 publicaciones | Orden cronológico con cursor `after` por publicación (5 páginas por corrida, continúa en la siguiente); 50 publicaciones; cursor vencido → relee esa publicación |
| YouTube, búsqueda | 1 página de 25 | 2 páginas de 50 por corrida (cuota: 100 unidades por página); reanuda con `publishedBefore` |
| YouTube, comentarios | 2 páginas de 50, filtrados por `since`; 20 videos | Marca por video (`commentsUntil`), 5 páginas de 100; más de 500 nuevos entre corridas → hueco reportado; 50 videos |
| Todos | `slice(0, 200)` silencioso | Sin tope de elementos en corridas (`limit` sólo para "Probar"); topes reportados |

Compatibilidad: las publicaciones y videos que ya estaban en el cursor antes de esta etapa (sin cursor ni marca
propia) conservan el filtro por `since`, para no releer todo su historial en el primer despliegue.

## 3. Almacenamiento: dedupe, versión de consulta y métricas

`ingest_mentions(org, source, rows)` (service role, una sentencia):

- **Nueva:** se inserta `pending`, con la consulta (versión) que la capturó.
- **Conocida con métricas distintas:** se actualizan `metrics` y `metrics_updated_at`.
- **Conocida igual:** no se toca.

**Política:** las interacciones toman el último valor observado (pueden bajar si el proveedor las baja). El
texto, la consulta que la capturó, el autor y el estado nunca cambian al reaparecer. El dashboard se refresca si
hubo nuevas o actualizadas.

## 4. Clasificación: reserva con lease, transacción y correcciones

| Pieza | Comportamiento |
|---|---|
| `claim_mentions(claim, limit, lease, max)` | `FOR UPDATE SKIP LOCKED`: cada mención pendiente la toma una sola corrida. Cuenta un intento por reserva. Lease de 180 s, mayor que la vida máxima de la función (60 s) |
| Workers vencidos | Una reserva vencida vuelve a estar disponible. Si ya agotó los intentos, pasa a `failed` y a la cola en lugar de reservarse otra vez |
| `release_mentions(claim, ids, count)` | Devuelve lo que la corrida no alcanzó (tiempo, API caída) sin gastar el intento |
| `complete_classifications(claim, results, failures, max)` | Una transacción: bloquea las filas que la corrida aún tiene reservadas. Escribe clasificación y estado, o reintento/cola. Una corrida que ya no es dueña no escribe nada (`stale`). Si una fila falla, falla todo y el estado queda como estaba (reservado; vuelve al vencer o al liberarse) |
| Correcciones humanas | `ON CONFLICT … DO UPDATE … WHERE corrected_at IS NULL`: una corrección sobrevive a un worker atrasado (`kept_correction`). El upsert anterior escribía `corrected_by = null` |
| Doble llamada a la IA | Imposible por la reserva: la prueba e2e lo mide en el simulador (cada texto llega una vez) |

## 5. Presupuesto, corridas, reintentos y cola de fallos

- **Ingesta:**
  - 45 s por corrida;
  - por fuente, 18 s para empezar peticiones (luego devuelve lo que tiene) y corte duro a 25 s;
  - lease de 120 s por fuente;
  - una fuente que no alcanzó a empezar se libera al momento.
- **Clasificación:**
  - 45 s por corrida;
  - no se empieza un lote con menos de 20 s;
  - 30 s y un reintento del SDK por llamada;
  - una señal cancela las llamadas en curso al terminar el presupuesto.
- **Registro de corridas:**
  - `ingest_runs` (por fuente) agrega `run_id`, `updated`, ventana, `complete`, `covered_until`, `limits` y
    hueco, y el estado `partial`;
  - `worker_runs` (nueva, una fila por corrida y municipio) guarda contadores devueltos por la base
    (`complete_classifications`, `ingest_mentions`), no estimados.
- **Reintentos:**
  - **mención:** hasta 5 intentos con espera de 2, 4, 8 y 16 min (tope 6 h); al 5º, `failed` + cola;
  - **fuente:** espera exponencial (1 h…24 h) tras 3 fallos; al 5º seguido, a la cola (sigue reintentando una
    vez al día); se resuelve sola al volver a funcionar.
- **Cola** `pipeline_failures`:
  - la leen admin y comunicación de su municipio;
  - `resolve_pipeline_failure(id, 'retry'|'dismiss')` comprueba el rol y el municipio del fallo;
  - "Reintentar" devuelve la mención a `pending` con 0 intentos;
  - se muestra en Configuración → Fuentes, con la corrida parcial y "Leído hasta" de cada fuente;
  - las menciones `failed` previas a esta etapa entran a la cola en el backfill (repetible).

## 6. Pruebas

| Prueba | Resultado |
|---|---|
| `npm run lint` · `npm run typecheck` | sin errores |
| `npm test` | 279/279. Nuevo: `src/lib/ingest/coverage.test.ts` (13). Se quitaron 2 pruebas de `sinceFor`/`inBackoff` (la regla pasó a SQL y se prueba en pgTAP) |
| `supabase db reset` (18 migraciones) + pgTAP | 311/311. Nuevo: `pipeline.test.sql` (47) |
| `next build` con claves canario + `check:bundle` | OK (179 archivos, 8 canarios sin fuga) |
| e2e (Playwright + simulador) | 18/18. Nuevo: `e2e/pipeline.spec.ts` |
| e2e nuevo contra el código anterior | **Falla**: cada mención llegó 2 veces al modelo (`Received: 2`); con el nuevo, 1 |
| Reversión | `docs/rollback/…down.sql` aplicado: sólo falla `pipeline.test.sql`; reaplicar la migración (con su backfill) funciona |
| Humo de ingesta (cron local) | Ruta de error: corrida registrada, lease liberado, contadores por municipio. `ingest_mentions` vía supabase-js: inserta 1 y luego actualiza métricas 1 |

Escenarios de `coverage.test.ts`, con los conectores reales y proveedores simulados:

- 260 publicaciones en páginas de 10: tres corridas, ninguna perdida, y la marca sólo avanza al final.
- Más publicaciones nuevas al terminar el backfill.
- 35 publicaciones con la misma hora cortadas por página: ninguna perdida y ningún hueco.
- Empate de 120 en un segundo: se reporta y no se atasca.
- Falla de la página 4: se guardan 30 y la siguiente corrida completa las 60.
- 650 comentarios: 500 y luego 150 por cursor, sin releer.
- YouTube con 230 videos: 5 páginas de búsqueda en 3 corridas.
- RSS de 250 notas: sin tope.
- Nota indexada tarde: se toma.
- Feed que pasó de largo: hueco reportado.

Escenarios de `pipeline.test.sql`:

- **Dedupe:** también repetidos en un mismo lote; las métricas se actualizan y el texto, la consulta y el
  estado se conservan.
- **Fuentes:** lease exclusivo; un worker sin lease no escribe; una corrida parcial conserva la marca y guarda
  el backfill; el 5º fallo va a la cola, se respeta la espera y una corrida manual la ignora; el éxito
  resuelve el fallo.
- **Reservas:** disjuntas; otra corrida no guarda lo ajeno; una fila mala revierte todo el guardado; el dueño
  guarda clasificación y estado juntos.
- **Correcciones y vencimientos:** una corrección sobrevive al worker atrasado; un lease vencido lo recupera
  otro worker.
- **Fallos:** espera antes de reintentar; al último intento va a la cola; un worker que muere siempre no
  reintenta sin fin.
- **Cola:** lectura y otro municipio no ven la cola ni reintentan; usuarios no pueden reservar; comunicación
  reintenta.

## 7. Activación

1. Correr `20261025000000_pipeline_reliability.sql` en preview y luego en producción, **antes** del deploy. La
   app actual sigue funcionando con la migración aplicada; la nueva requiere sus funciones.
2. Merge a `main` (deploy). La primera corrida de cada fuente lee desde `covered_until` (= su último éxito).
3. Revisar en Configuración → Fuentes:
   - "Leído hasta" y "Poniéndose al día" de cada fuente;
   - corridas parciales con sus topes;
   - la cola **Fallos por revisar**: incluye las menciones que ya estaban `failed`.

## 8. Reversión

- **App:** revertir el commit. La app anterior lee `last_success_at` (que sigue actualizado) e ignora las
  columnas nuevas.
- **Base:** `docs/rollback/20261025000000_pipeline_reliability.down.sql`. Quita funciones, tablas
  `worker_runs`/`pipeline_failures` y columnas nuevas, y pasa las corridas `partial` a `ok`. Conserva menciones,
  clasificaciones y corridas. Se pierde la cola y la marca de cobertura. Correrlo sólo junto con la reversión de
  la app.

## 9. Limitaciones y pendientes

- **Proveedores reales:** paginación, cursores y cuotas reales de Facebook y YouTube no se probaron contra los
  proveedores, sólo contra simuladores fieles a la documentación (`since`/`until`, `after`, `publishedBefore`).
  Queda pendiente verificarlo con una página y un canal reales en preview.
- **Ingesta exitosa de punta a punta:** no se probó en el sandbox (sin internet directo). Se cubre por partes:
  conectores con proveedores simulados, `ingest_mentions` vía supabase-js, `finish_source_run` en pgTAP y la
  ruta de error por el cron.
- **Comentarios de YouTube:** con más de 500 nuevos entre corridas en un video, el resto se reporta como hueco
  (la API no permite reanudar desde lo más viejo).
- **Huecos sin recuperación:** un feed RSS que publica más notas entre corridas de las que conserva pierde las
  intermedias. Se reporta; la única mitigación es correrlo más seguido.
- **Cuotas por municipio y costo desconocido (#7, #8):** etapa 3.
- **Dashboard tras corregir (#6):** el refresco del rollup después de correcciones sigue pendiente (etapa 5);
  aquí sólo se refresca cuando cambian interacciones.
- **Reportes programados (#4, #11):** etapa 4.
- **Decisiones abiertas de la etapa 0:** orden de etapas y Node 22/24.
