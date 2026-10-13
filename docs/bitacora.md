# Bitácora técnica de implementación

Una entrada por etapa del prompt maestro, de la más reciente a la más antigua. El detalle de cada etapa vive en
su propio documento de `docs/`.

## Etapa 4 — Casos (13 oct 2026, base `6e26ba5`)

- **Antes:**
  - La mención era la unidad de trabajo: cada publicación de la misma fuga se turnaba por separado.
  - No había historial de quién hizo qué, ni forma de agrupar, devolver por competencia o validar el cierre.
- **Después:**
  - `cases` (folio `C-00001` por municipio) y `case_mentions` (una mención en a lo más un caso); las menciones
    siguen contando una por una.
  - Una sola máquina de estados en la base, con motivo obligatorio para devolver, descartar, rechazar la
    validación y reabrir.
  - Los turnos son las asignaciones del caso y siguen su estado; Bandeja y WhatsApp mueven el caso.
  - Historial de sólo agregar (persona, WhatsApp o sistema) y notas internas o para la dependencia.
  - Fusión que conserva folios e historial; sugerencias de agrupación siempre confirmadas por una persona.
  - Backfill repetible de turnos a casos, con simulación y conciliación (admin, en `/casos`).
  - Interfaz `/casos` y `/casos/[id]`; en Bandeja, «Caso» (atajo `c`) y folio en tarjetas.
- **Archivos:** ver `docs/etapa-4-casos.md` § 7. Migración `20261027000000_cases.sql` y su `down.sql`.
- **Pruebas:**
  - lint, typecheck y unitarias (incluye espejo SQL↔TS de transiciones);
  - `db reset` y pgTAP 436/436 (casos, backfill, sugerencias, personas, matriz RLS);
  - reversión y reaplicación en local, con pgTAP completo después;
  - build canario + `check:bundle`;
  - e2e 24 (casos 2/2; volvió a fallar una vez la prueba intermitente del mapa y pasó al repetir).
- **Conteo previo (sólo lectura):** producción 189 turnos → 187 casos; preview 110 → 110.
- **Limitaciones:** sugerencias léxicas a 72 h; turnos sólo sobre la mención principal; persona responsable
  sólo de la dependencia asignada.
- **Activación / reversión:**
  - activar: migración, deploy, y en `/casos` Simular y Aplicar;
  - revertir: commit y `down.sql` (se pierden casos e historial; los turnos se conservan).
- **Pendiente:** Node 22/24, prueba intermitente del mapa.

### Adicional: logotipo del cliente en los reportes (pedido durante la etapa 4, commit aparte)

- **Antes:**
  - El PDF sólo llevaba los colores del municipio.
  - Su pie de página no se dibujaba: react-pdf descartaba el número de página al heredar el interlineado de la
    página.
- **Después:**
  - Configuración → Identidad (admin) sube o quita el logotipo y ajusta los colores.
  - El logo va en la portada, sobre blanco, y en el pie de cada página; el pie vuelve a salir con la
    numeración.
  - Bucket privado `branding`; formato validado por bytes; la ruta queda atada a la carpeta del municipio.
- **Archivos:**
  - `supabase/migrations/20261028000000_org_logo.sql` y su `down.sql`;
  - `src/lib/branding/*`, `src/components/settings/logo-form.tsx`, `src/app/(app)/configuracion/identidad`;
  - `src/lib/reports/{pdf.tsx,deliver.ts,list.ts}`.
- **Pruebas:**
  - `branding/image.test.ts` y `branding.test.sql` (8);
  - e2e de reportes: sube el logo y verifica la imagen en el PDF;
  - revisión visual del PDF.
- **Activación / reversión:**
  - activar: migración y deploy;
  - revertir: commit y `down.sql`, vaciando antes el bucket.

## Etapa 3 — Salud del monitoreo (13 oct 2026, base `1666fd6`)

- **Antes:**
  - El estado de las fuentes sólo se veía en Configuración → Fuentes y no distinguía pausa, falta de
    publicaciones, error y cobertura parcial.
  - No había umbrales, ni registro persistido de cuándo corrió el clasificador sin trabajo o se reconstruyó el
    dashboard.
  - Lectura no tenía un resumen.
- **Después:**
  - Sección `/salud`: detalle para admin y comunicación, resumen para lectura (recortado en la base); dependencia
    sin acceso.
  - Nueve estados por fuente, con motivo, próximo intento y siguiente paso.
  - Clasificador y dashboard con umbrales por municipio; frecuencia y umbrales por fuente (la ingesta respeta
    la frecuencia).
  - Hora de corte de la Ciudad de México; nunca verde con cobertura desconocida.
  - Corridas filtrables con detalle.
  - Reintento manual con *lease* y espera de 60 s.
  - Latidos persistidos y regla de alerta `monitor_health`.
- **Archivos:**
  - `supabase/migrations/20261026000000_monitor_health.sql` y `docs/rollback/…down.sql`;
  - `src/lib/health/*`, `src/components/health/*`, `src/app/(app)/salud/*`;
  - alertas (`rules.ts`, `evaluate.ts`, ícono y formulario), `roles.ts`/`nav-icons.ts`;
  - latidos en ingesta y clasificación, espera manual en `sources/actions.ts`;
  - pruebas: `health/model.test.ts`, `health.test.sql`, `e2e/health.spec.ts`, ajustes en `rules.test.ts`,
    `roles.test.ts` y `rls_matrix.test.sql`;
  - README y `docs/etapa-3-salud-del-monitoreo.md`.
- **Pruebas:**
  - lint, typecheck y 307 unitarias;
  - `db reset` de 19 migraciones y 338 pgTAP;
  - build canario + `check:bundle`;
  - e2e 22/22 (en la primera corrida falló la prueba previa del mapa; ver limitaciones);
  - humo de la alerta de salud con enfriamiento;
  - reversión y reaplicación probadas.
- **Hallazgo:** `e2e/map.spec.ts` es intermitente porque el panel de colonia ofrece a lectura un enlace a
  Bandeja, que redirige. Se propuso corregirlo en una tarea aparte.
- **Limitaciones:**
  - el próximo intento es una estimación sobre el cron horario;
  - los latidos de los crons son globales, no por municipio.
- **Activación / reversión:**
  - activar: migración antes del deploy y, opcionalmente, la regla "Salud del monitoreo";
  - revertir: commit y `down.sql`.
- **Pendiente:** cuotas y costo de IA, frescura tras correcciones, reportes programados, Node 22/24.

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
