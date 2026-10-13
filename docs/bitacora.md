# Bitácora técnica de implementación

Una entrada por etapa del prompt maestro, de la más reciente a la más antigua. El detalle de cada etapa vive en
su propio documento de `docs/`.

## Etapa 2 — Cobertura y clasificación confiable (13 oct 2026, base `ea3e9e8`)

- **Antes:**
  - **Ingesta:** los conectores truncaban en silencio (200 elementos, 1–4 páginas) y la siguiente corrida
    empezaba en el último éxito, así que lo omitido se perdía; las interacciones no se actualizaban.
  - **Clasificación:** dos workers clasificaban y mandaban a la IA las mismas menciones; el upsert pisaba
    correcciones humanas; guardar y cambiar estado eran dos escrituras sin transacción.
  - **Fallos:** las menciones `failed` quedaban así para siempre.
- **Después:**
  - **Contrato de conectores:** con ventana, completitud, `resumeUntil`, huecos y topes. `covered_until` sólo
    avanza sobre ventanas completas, con backfill de lo cortado.
  - **Paginación:** Facebook pagina y reanuda (comentarios por cursor); YouTube pagina la búsqueda; RSS sin tope
    y con tolerancia de 7 días.
  - **Almacenamiento:** `ingest_mentions` deduplica y actualiza métricas.
  - **Clasificación:** reserva con lease (`claim_mentions`) y guardado transaccional que respeta correcciones
    (`complete_classifications`).
  - **Corridas y fallos:** reintentos con espera y cola revisable (`pipeline_failures`); contadores por
    municipio (`worker_runs`).
- **Archivos:**
  - **Nuevos:**
    - `supabase/migrations/20261025000000_pipeline_reliability.sql`;
    - `docs/rollback/20261025000000_pipeline_reliability.down.sql`;
    - `src/lib/connectors/window.ts`;
    - `src/lib/ingest/coverage.ts` y `coverage.test.ts`;
    - `src/components/sources/failures-queue.tsx`;
    - `supabase/tests/database/pipeline.test.sql`;
    - `e2e/pipeline.spec.ts`;
    - `docs/etapa-2-cobertura-y-clasificacion.md`.
  - **Modificados:**
    - `connectors/types.ts`, `meta.ts`, `youtube.ts`, `rss.ts`, `recent.ts` y las pruebas de conectores;
    - `ingest/run.ts` y `assign.ts`, `ai/classify.ts` y `classifier.ts`;
    - `sources/actions.ts` y `data.ts`, la página de fuentes y `runs-table.tsx`, `sources-manager.tsx`;
    - `e2e/mock-anthropic.mjs` (registra qué menciones se envían), `database.types.ts` y el README.
- **Pruebas:**
  - lint, typecheck y 279 unitarias;
  - `db reset` de 18 migraciones y 311 pgTAP;
  - build canario + `check:bundle`;
  - 18 e2e;
  - el e2e de concurrencia falla con el código anterior (2 envíos por mención) y pasa con el nuevo;
  - reversión y reaplicación probadas.
- **Hallazgo:** la estructura de `queries` ya versionaba cada consulta (una fila por versión); se conserva y se
  documenta en lugar de agregar otra columna.
- **Limitaciones:**
  - paginación real de Facebook y YouTube sin probar contra los proveedores;
  - ingesta exitosa de punta a punta sin probar en el sandbox (sin internet);
  - comentarios de YouTube por encima de 500 entre corridas y feeds que se adelantan quedan como huecos
    reportados.
- **Activación / reversión:**
  - activar: migración en preview y producción antes del deploy;
  - revertir: commit y `down.sql`.
- **Pendiente:** orden de etapas y Node 22/24 (etapa 0); cuotas y costos (etapa 3).

## Etapa 1 — Endurecimiento (13 oct 2026, base `9ac734a`)

- **Antes:**
  - El feed RSS aceptaba cualquier `http(s)` (loopback, red privada, metadatos) y seguía redirecciones sin
    revisarlas.
  - El tope de 5 MB se medía después de leer todo, en caracteres.
  - El timeout de la fuente no cancelaba la petición.
  - Un editor podía, por la API, insertar reportes aprobados o enviados, borrar aprobados, escribir
    aprobador, envío o PDF y cambiar destinatarios sin rastro.
  - maplibre-gl 5.24 tenía un aviso crítico.
- **Después:**
  - `safe-fetch.ts` valida la IP en el `lookup` del socket (sin rebinding) y en cada redirección (máx. 5), con
    `RSS_ALLOWED_HOSTS` opcional.
  - Lectura en streaming con tope en bytes y cancelación.
  - `signal` en los conectores; `withDeadline` aborta la ingesta y "Probar fuente".
  - Migración `20261024000000_reports_hardening.sql`: políticas por operación, columnas, transiciones
    explícitas y RPC auditada `set_report_recipients`.
  - maplibre-gl 6.14 con `setWorkerUrl`.
- **Archivos:**
  - nuevos: `src/lib/connectors/safe-fetch.ts` y `safe-fetch.test.ts`, `src/components/map/maplibre.ts`,
    la migración, `docs/rollback/20261024000000_reports_hardening.down.sql`,
    `supabase/tests/database/reports_workflow.test.sql` y `reports_server.test.sql`,
    `docs/etapa-1-endurecimiento.md`;
  - modificados: `http.ts`, `types.ts`, `rss.ts`, `meta.ts`, `youtube.ts`, `ingest/run.ts`,
    `sources/actions.ts`, `catalogs/actions.ts`, `reports/actions.ts`, los dos mapas, `e2e/map.spec.ts`,
    `reports.test.sql`, `database.types.ts`, `package.json`/lock, README y `.env.example`.
- **Pruebas:** lint, typecheck, 268 unitarias, build canario + `check:bundle`, `db reset` de 17 migraciones,
  264 pgTAP, 17 e2e. Además, la reversión aplicada hace fallar 15 de 19 pruebas nuevas.
- **Hallazgo:** los triggers no pueden llamar a `private.*` porque `service_role` no tiene USAGE. pgTAP lo ocultó
  por un plan en caché; ahora las pruebas del servidor corren en sesión propia.
- **Limitaciones:**
  - 9 avisos altos sólo de desarrollo (`braces` vía `fast-glob`, sin versión corregida);
  - el demo RSS no funciona contra `localhost`;
  - el fondo de calles del mapa no se pudo ver en el sandbox.
- **Activación / reversión:**
  - activar: migración primero (preview y producción), luego deploy y, si se desea, `RSS_ALLOWED_HOSTS`;
  - revertir: commit y `down.sql`.
- **Pendiente:** orden de etapas y Node 22/24 (de la etapa 0).

## Etapa 0 — Línea base (13 oct 2026, base `918838d`)

- **Antes:** sin matriz de los 13 hallazgos; el seed tenía un solo municipio y `rls_matrix.test.sql` contaba tablas
  completas; el simulador no podía simular fallas y se caía con una petición mal formada.
- **Después:** matriz con evidencia (`docs/etapa-0-linea-base.md`); dos hallazgos reproducidos en local (#3
  clasificación concurrente, #8 costo desconocido); seed con un segundo municipio y sus cuatro roles; prueba
  `tenants.test.sql`; inyección de fallas en `e2e/mock-anthropic.mjs`. Sin cambios en la app ni en migraciones.
- **Archivos:** `docs/etapa-0-linea-base.md`, `docs/bitacora.md`, `supabase/seed.sql` (bloque al final),
  `supabase/tests/database/tenants.test.sql` (nuevo), `supabase/tests/database/rls_matrix.test.sql` (cuenta sólo el
  municipio A), `e2e/mock-anthropic.mjs`.
- **Pruebas:** lint, typecheck, 199 unitarias, build con claves canario + `check:bundle`, `db reset` de las 16
  migraciones, 228 pgTAP, 17 e2e, recorrido de 14 rutas × 5 usuarios. Todo en verde.
- **Limitaciones:** las reproducciones de #3 y #8 se hicieron a mano contra la app local, sin prueba automatizada
  (se agregará en sus etapas). El fixture del municipio B no se cargó en el proyecto de preview (sólo local y CI).
- **Activación / reversión:** nada que activar. Revertir = revertir el commit; para la base local,
  `npx supabase db reset`.
- **Pendiente:** decidir el orden de etapas propuesto; alinear Node 22 (CI) con 24 (producción).
