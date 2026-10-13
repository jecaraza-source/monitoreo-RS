# Etapa 0 — Línea base, matriz de hallazgos y plan

Commit base auditado: `918838d` (main, 13 oct 2026). Esta etapa **no cambia el comportamiento de la app**: sólo
agrega fixtures de prueba, un modo de fallas al simulador y documentación.

## 1. Línea base reproducible

Entorno local: Node 22.22.0, npm 10.9.4, Supabase CLI 2.120.0, Docker 29.8, PostgreSQL 17.11 (igual a
`supabase/config.toml`, `major_version = 17`).

| Paso | Comando | Resultado |
|---|---|---|
| Dependencias | `npm ci` | OK (desde `package-lock.json`) |
| Lint | `npm run lint` | OK, sin avisos |
| Tipos | `npm run typecheck` | OK |
| Unitarias | `npm test` | **199/199** |
| Build (config. de CI, claves canario) | `npm run build` con las variables de `.github/workflows/ci.yml` | OK |
| Secretos en el bundle | `npm run check:bundle` | OK, 8 secretos canario sin fugas en 177 archivos |
| Migraciones desde cero | `npx supabase db reset` | OK, las 16 migraciones + seed |
| pgTAP | `npx supabase test db` | **228/228** (18 archivos; antes de esta etapa 215/215 en 17) |
| e2e (con simulador) | `node e2e/mock-anthropic.mjs` + `next start` + `npx playwright test` | **17/17** |
| Rutas × rol | recorrido de 14 rutas con admin, comunicación, dependencia, lectura y admin del municipio B | sin errores; las redirecciones coinciden con `src/lib/auth/roles.ts` |
| Auditoría npm | `npm audit` | **1 crítica** (`maplibre-gl`, dependencia directa), 9 altas (sólo herramientas de desarrollo) |

Variables del e2e local: las mismas que `ci.yml` (job `e2e`) — Supabase local, `ANTHROPIC_BASE_URL`,
`RESEND_BASE_URL` y `WHATSAPP_API_URL` apuntando a `http://127.0.0.1:4010`, `CRON_SECRET=e2e-cron-secret`,
`WHATSAPP_QUIET_HOURS=off`. Nada sale a servicios reales.

**Versiones de Node:** local y CI usan **22** (`ci.yml`, `node-version: 22`); producción en Vercel usa **24.x**
(configuración del proyecto). `package.json` no fija `engines`. Ninguna prueba detecta hoy una diferencia, pero la
línea base de CI no es la de producción. Propuesta: fijar `engines.node` y alinear CI con producción (etapa 1).

**Fallas previas que no son regresiones:** ninguna prueba falla en `main`. Las dos pruebas pgTAP que cambié en esta
etapa (ver §5) asumían un solo municipio en el seed; con el fixture de dos municipios fallaban por esa suposición,
no por un defecto de la app.

## 2. Matriz de los 13 hallazgos

Estados: **corregido**, **reproducible** (el problema existe hoy), **pendiente de validación** (el código lo mitiga
pero falta una prueba en ejecución), **no aplicable**. Las rutas son del commit `918838d`.

| # | Hallazgo | Estado | Evidencia | Pruebas que existen |
|---|---|---|---|---|
| 1 | **SSRF** | **reproducible** | La URL de una fuente RSS (la configura un editor) sólo se valida con `^https?://` (`src/lib/connectors/rss.ts:9`); no se resuelve el host ni se bloquean IP privadas, loopback, link-local o `169.254.169.254`. `fetchText` sigue redirecciones sin revalidar el destino (`src/lib/connectors/http.ts:13-17`). Entradas: `saveSource`, `testSource` ("Probar" consulta al momento), `runSourceNow` (`src/lib/sources/actions.ts`) y el cron (`src/lib/ingest/run.ts`). Los mensajes de error distinguen "no respondió" / "HTTP n" / "no es un feed": sirven de oráculo para escanear puertos. Meta, YouTube, Overpass y los mapas usan hosts fijos (no aplica). | Ninguna de SSRF |
| 2 | **Captura truncada** | **reproducible** (con volumen alto) | Tras cada corrida exitosa la siguiente lee desde `last_success_at` − 15 min (`src/lib/ingest/run.ts:170-176`, `assign.ts:51-56`); lo que un conector descarta por un tope ya no se vuelve a leer. Topes: 200 por conector (`connectors/types.ts:88`), una sola página de búsqueda de YouTube de 25 (`youtube.ts:81-94`), 2×50 comentarios por video, 4×25 publicaciones y 3×100 comentarios en Meta, comentarios sólo de las 20 publicaciones más recientes (`connectors/recent.ts:6-7`). `ingest_runs` no registra que se llegó a un tope. | Conectores sin prueba de topes |
| 3 | **Clasificación concurrente** | **reproducible** — *reproducido en esta etapa* | `classifyPending` lee `status='pending' limit 100` sin reclamarlas (`src/lib/ai/classify.ts:129-134`); el estado cambia hasta después de llamar a Claude. **Prueba local:** con el simulador demorando 2.5 s, dos llamadas simultáneas a `/api/cron/classify` clasificaron **las mismas 10 menciones** (10 + 10) y `ai_usage` registró 2 solicitudes. Además el upsert escribe `corrected_by = null` y puede pisar una corrección humana hecha entre ambas. | `classifier.test.ts` no cubre concurrencia |
| 4 | **Reportes sin reintento** | **reproducible** | `runReportSchedules` marca `last_run_at` antes de generar (`src/lib/reports/schedule.ts:33`); si Claude o el insert fallan, el `catch` sólo hace `console.error` (`:51-55`) y la regla "una vez por día" impide el reintento. Un reporte semanal o mensual fallido se pierde. Si Resend falla, queda registrado en `reports.delivery` pero no se reintenta solo (sólo con "Reenviar" manual). No se escribe en `app_errors`. | `e2e/report.spec.ts` (camino feliz); nada de fallas |
| 5 | **Aprobación SQL** | **corregido** (SQL) / **reproducible por diseño** (envío sin revisión) | (a) Ningún texto del modelo llega a SQL: el asistente sólo tiene 5 herramientas fijas con entradas validadas y corre con la sesión del usuario (`src/lib/ai/tools.ts`, prueba `tools.test.ts:29`). (b) Con `report_schedules.auto_approve = true`, el cron aprueba y envía la narrativa de IA sin que una persona la lea (`schedule.ts:47-49`); el README lo documenta. Las cifras sí se validan contra los datos (`narrative.ts`). | `tools.test.ts`, `narrative.test.ts`, `reports.test.sql` |
| 6 | **Agregados desactualizados** | **reproducible** (correcciones y métricas) | El rollup `mention_stats_hourly` se refresca sólo cuando la ingesta inserta, la clasificación clasifica o la retención borra. `correctClassification` (`src/lib/inbox/actions.ts:204-230`) no refresca: el dashboard, el mapa, los reportes y las alertas siguen con el sentimiento viejo hasta la siguiente corrida con datos nuevos, mientras el panel de colonia (`neighborhood_detail`, datos en vivo) ya muestra el nuevo. Las interacciones (likes, compartidos) no se actualizan después de la primera captura (`run.ts:247`, `ignoreDuplicates`). | `dashboard.test.sql` (rollup = datos en el seed) |
| 7 | **Cuotas IA** | **reproducible** (no hay cuotas) | `ai_usage` sólo registra (`record_ai_usage`); nada lo consulta para limitar. Clasificación: sólo 45 s y 100 por corrida, FIFO global sin reparto por municipio. Asistente: 20 solicitudes/min por usuario, y el limitador deja pasar si falla la base (`src/lib/rate-limit.ts`). Sin tope diario por municipio. | `ai_usage.test.sql` (registro y RLS) |
| 8 | **Costo desconocido** | **reproducible** — *reproducido en esta etapa* | `estimateCost` devuelve `null` para un modelo fuera de la tabla (`src/lib/ai/pricing.ts:33-36`) y los llamadores guardan `costUsd ?? 0` sin aviso (`classify.ts:189,198`, `reports/data.ts:151`). **Prueba local:** con el simulador respondiendo `model: "claude-desconocido"`, 3 solicitudes (3,000 tokens de entrada, 1,200 de salida) quedaron con **costo $0.00**. Agrava: ningún cliente de Anthropic fija timeout; si la función expira antes de `record_ai_usage`, el consumo no se registra. | `classifier.test.ts:190-202` (sólo que devuelve `null`) |
| 9 | **Autores YouTube** | **reproducible** (canales) | Todo canal que sube un video se guarda como `kind: "media"` (`src/lib/connectors/youtube.ts:119-121`), incluso los que aparecen por una búsqueda abierta (pueden ser ciudadanos). Así aparecen con nombre en rankings de medios y reportes, y quedan fuera de la depuración de autores ciudadanos; contradice CLAUDE.md. El upsert de autores reescribe `kind` en cada corrida (`run.ts:211-224`). Los comentaristas sí se guardan sin autor (correcto). | `youtube.test.ts:69-70` |
| 10 | **Límites HTTP** | **pendiente de validación** (mitigado con huecos) | Hay timeouts en conectores (15 s), Resend (8/20 s), WhatsApp (8 s) y webhook de errores (3 s); tope de 5 MB en conectores. Huecos: el tope se mide en caracteres después de leer todo el cuerpo (sin corte en streaming), redirecciones sin límite propio ni revalidación, sin timeout en el SDK de Anthropic, `res.json()` de Overpass sin tope, y los webhooks leen el cuerpo completo (sólo aplica el límite de plataforma). El limitador de `/api/*` deja pasar si falla la base. | `rate-limit-policy.test.ts`, `rss.test.ts:130` |
| 11 | **Idempotencia de envío** | **corregido** (alertas, WhatsApp) / **reproducible** (reportes programados) | Alertas: `fire_alert` con candado y enfriamiento antes de insertar (prueba `alerts.test.sql`). WhatsApp: `claim_whatsapp_followups … for update skip locked` y `wa_message_id` único (pruebas `whatsapp_followups.test.sql`). Reportes: lectura y escritura de `last_run_at` no atómicas (`schedule.ts:29-33`) y sin llave de idempotencia en Resend: dos invocaciones simultáneas pueden generar y enviar dos veces. Ojo: el resumen diario con enfriamiento < 24 h se reenvía cada enfriamiento. | `alerts.test.sql`, `whatsapp_followups.test.sql` |
| 12 | **Mapa** | **reproducible** (dependencia vulnerable) / **pendiente de validación** (resto) | `maplibre-gl@5.24.0` tiene una vulnerabilidad **crítica** (XSS en `DOM.sanitize`, se corrige en 6.14.0, cambio mayor). La app no usa `Popup`/`setHTML` (su tooltip es React), así que la explotación parece baja, pero la alerta está abierta. Resto: procedencia de polígonos (`shape_source`), zonas aproximadas punteadas y colonias sin polígono están resueltas; `map_stats` hereda el rollup viejo (#6); se cargan todos los GeoJSON sin simplificar (falta medir con un catálogo grande); no hay confianza propia de la geolocalización (una sola `confidence` por clasificación). | `map.test.sql`, `model.test.ts`, `focus.test.ts`, `e2e/map.spec.ts` |
| 13 | **Dependencias** | **reproducible** (npm) | Interpretado como dependencias npm (los hallazgos vecinos son técnicos). `npm audit`: 1 crítica en producción (`maplibre-gl`, ver #12) y 9 altas en herramientas de desarrollo (`eslint-config-next`, `shadcn` → `fast-glob`/`micromatch`/`braces`). CI no corre `npm audit`, no hay Dependabot/Renovate y las Actions se fijan por etiqueta, no por SHA. (Si se refería a las dependencias municipales: su aislamiento por RLS está **corregido** y probado en `rls_matrix.test.sql`, `ticket_support.test.sql` y el nuevo `tenants.test.sql`.) | ninguna de dependencias npm |

## 3. Roles y operaciones existentes

| Rol | Lee | Escribe |
|---|---|---|
| admin | todo su municipio | todo; único que configura catálogos, usuarios, WhatsApp |
| comunicacion | todo su municipio (Funcionarios sólo con permiso explícito) | triage, turnar, corregir clasificación, notas, reglas de alerta, reportes, fuentes |
| dependencia | sólo menciones con un turno de su dependencia (`private.mention_routed_to_user`) | estado de sus turnos, notas en esas menciones |
| lectura | todo su municipio salvo costos de IA y miembros | nada (sólo "visto" de alertas, que la base ignora) |

Desacuerdos entre la acción del servidor y RLS (no se corrigen en esta etapa; van al plan):
1. Un usuario de dependencia puede escribir por PostgREST `due_at`, `assignee_id`, `resolved_at`, `assigned_at` y las
   marcas de WhatsApp de sus turnos (permisos por columna + política "departments update own tickets"); la app
   sólo expone `status`.
2. `setTicketStatus` permite reabrir un turno cerrado; `whatsapp_ticket_action` no.
3. `setTriage` acepta `routed` sin crear turnos, y una mención turnada puede descartarse con turnos abiertos.
4. Una dependencia de apoyo ve las notas de la principal, pero no su turno.

Operaciones que crean o cambian menciones y turnos: ingesta (`storeMentions`), clasificación (`classifyPending`),
triage, corrección, `route_mentions` (principal + apoyo), cambio de estado (app y WhatsApp), notas, marcas de
WhatsApp (`notifyRoutedTickets`, `claim_whatsapp_followups`) y la retención (`purge_old_mentions`, en cascada a
clasificaciones, turnos y notas).

## 4. Mapa de dependencias

```
Ingesta (cron cada hora)      → sources, queries, authors, mentions, ingest_runs, refresh_mention_stats → Meta Graph, YouTube Data, RSS
Clasificación (cada 5 min)    → mentions, classifications, record_ai_usage, refresh_mention_stats       → Anthropic (FAST)
  └─ Alertas (misma corrida)  → alert_rules, fire_alert, alert_events                                 → Resend, WhatsApp (sigma_alerta)
Reportes (13:00 UTC)          → dashboard_stats, report_extras, reports, Storage "reports"             → Anthropic (SMART), Resend
Retención (09:30 UTC)         → purge_old_mentions, purge_old_whatsapp_messages, refresh_mention_stats
WhatsApp seguimiento (15 min) → claim_whatsapp_followups, tickets, whatsapp_*                          → WhatsApp Cloud API
WhatsApp webhook (Meta)       → whatsapp_messages, whatsapp_contacts, whatsapp_ticket_action
Bandeja (usuario)             → route_mentions, tickets, mention_notes, classifications               → WhatsApp (aviso de turno, after())
Dashboard / mapa / crisis / funcionarios → dashboard_stats, map_stats, neighborhood_detail, crisis_snapshot, officials_stats
Lectura del día / asistente   → Anthropic (FAST / SMART), RLS del usuario
```

Lo que cuenta turnos (no menciones): KPIs del dashboard, `report_extras`, `neighborhood_detail`, el resumen
diario de alertas y el asistente.

## 5. Fixtures y simuladores

- **Dos municipios × cuatro roles** en `supabase/seed.sql` (al final, sin tocar el municipio A):
  *Municipio de Prueba B* (`…a000-00000000000b`) con `admin@`, `comunicacion@`, `servicios@` (dependencia) y
  `lectura@municipio-b.test`, una dependencia, una fuente RSS inactiva, 3 menciones ficticias y 1 turno.
  Prueba: `supabase/tests/database/tenants.test.sql` (13 aserciones de aislamiento por rol y entre municipios).
  `rls_matrix.test.sql` ahora compara contra las filas del municipio A (antes contaba la tabla entera, lo que
  suponía un solo municipio).
- **Simulador** `e2e/mock-anthropic.mjs` (Anthropic, Resend, WhatsApp): se agregó inyección de fallas para las
  siguientes etapas — `POST /__mock/faults` con `{ "<anthropic|resend|whatsapp>": { "status", "times", "delayMs" },
  "model": "<id>" }`, `DELETE /__mock/faults` y `GET /__mock/calls`. También dejó de caerse ante una petición mal
  formada (responde 500).

## 6. Modelo de casos — decisiones (sin cambiar el modelo todavía)

Hoy la unidad de trabajo es el **turno** `(mention_id, department_id)`; la visibilidad de dependencia, los KPIs, los
folios de WhatsApp y los enlaces `/bandeja?mention=` dependen de él. Decisiones para el diseño de "casos":

1. **Aditivo:** `cases` (municipio, título, estado, prioridad, colonia) y `case_mentions` (una mención pertenece a lo
   más a un caso). Ninguna tabla existente se recrea; los turnos siguen existiendo.
2. **Turnos sin romper:** se agrega `tickets.case_id` opcional. Una mención sin caso funciona igual que hoy; agrupar
   menciones no cambia sus turnos hasta una etapa de migración de datos separada y repetible.
3. **Visibilidad:** una dependencia ve un caso si tiene un turno en alguna de sus menciones (nueva función
   `private.case_routed_to_user` con la misma regla que `mention_routed_to_user`).
4. **Métricas:** los KPIs actuales siguen contando turnos; los de casos serán indicadores **nuevos**, nunca un
   reemplazo silencioso.
5. **Retención:** borrar menciones antiguas quita su vínculo (`case_mentions` en cascada) pero no el caso ni su
   historial.
6. **WhatsApp:** los folios de turno se conservan; un folio de caso, si se necesita, será distinto.

## 7. Plan por etapa (propuesta)

| Etapa | Alcance | Hallazgos |
|---|---|---|
| 1 | Entrada segura: guardia SSRF (resolver DNS, bloquear rangos privados, redirecciones manuales revalidadas, corte por bytes en streaming), esquema `http(s)` en enlaces mostrados, `maplibre-gl` 6.x con prueba visual del mapa, `npm audit` en CI, `engines.node` y CI en Node 24 | 1, 10, 12, 13 |
| 2 | Clasificación segura: reclamar filas (`processing` + `for update skip locked`), no pisar correcciones humanas, timeout del SDK, reintento de `failed` | 3 |
| 3 | Costos y cuotas de IA: modelo desconocido registrado como tal y alertado, precios por familia, tope diario por municipio, reparto justo entre municipios | 7, 8 |
| 4 | Reportes confiables: reclamo atómico del horario, reintentos con espera y registro en `app_errors`, llave de idempotencia en Resend, política para `auto_approve` | 4, 5b, 11 |
| 5 | Agregados frescos: refrescar tras correcciones (con espera), actualizar interacciones, indicador de frescura | 6 |
| 6 | Captura completa: registrar topes alcanzados, paginación con cursor por conector, `kind` de canales de YouTube = ciudadano por omisión y no sobrescribir correcciones manuales | 2, 9 |
| 7 | Permisos de turnos: acotar columnas que escribe dependencia, reglas de cerrado y coherencia triage–turnos | §3 |
| 8 | Casos (modelo aditivo, §6) | — |

**Requieren entorno provisionado** (no se pueden validar sólo con local + simulador): paginación real de Meta y
YouTube con cuotas reales; entregas duplicadas reales de Vercel Cron; llaves de idempotencia contra la API real de
Resend; pruebas de SSRF con DNS que cambia (rebinding) en una red aislada; la actualización de `maplibre-gl`
revisada en navegador real; despliegue en Node 24 (preview de Vercel).

## 8. Formato de cierre (prompt maestro)

Cada etapa se entrega con: **resumen de comportamiento antes/después**; **archivos y migraciones**; **pruebas
ejecutadas y resultados** (las no ejecutadas se dicen como pendientes, con el comando para correrlas);
**limitaciones**; **pasos de activación y reversión**; **criterios pendientes**. Cada cierre se anota en
`docs/bitacora.md`.
