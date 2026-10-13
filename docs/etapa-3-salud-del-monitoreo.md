# Etapa 3 — Salud del monitoreo

Base: `main` en `1666fd6` (cierre de la etapa 2).

## 1. Qué ya estaba resuelto y se conserva

| Pieza | Estado previo (etapa 2) | Uso en esta etapa |
|---|---|---|
| Estado por fuente | `last_run_at`, `last_success_at`, `last_error`, `consecutive_failures`, `covered_until`, backfill en el cursor | Base del diagnóstico por fuente |
| Corridas | `ingest_runs` con completitud, ventana, topes y huecos; `worker_runs` por municipio | Filtros y detalle de corridas |
| Cola de fallos | `pipeline_failures` + `resolve_pipeline_failure` (rol y municipio verificados) | Se muestra también en Salud |
| Reintento seguro | `claim_sources` con *lease*; `finish_source_run` atómico | "Reintentar ahora" lo reutiliza, con espera mínima |
| Configuración de fuentes | Admin y comunicación (RLS + privilegios por columna); dependencia sin acceso a `sources`; secretos en Vault | Sin cambios |
| Alertas | Reglas por tipo, `fire_alert` con enfriamiento | Nuevo tipo `monitor_health` |

**Faltaba:**
- un registro persistido de cuándo corrió el clasificador cuando no tenía trabajo, y de cuándo se reconstruyó
  el dashboard;
- umbrales;
- una vista que distinguiera pausa, falta de publicaciones, error y cobertura parcial.

## 2. Comportamiento

**Pantalla** `/salud` (sección nueva):
- Admin y comunicación ven el detalle. Lectura ve sólo el resumen, sin textos de error ni topes; lo recorta la
  base en `monitor_health`, no la interfaz.
- Dependencia no entra (navegación y función).

**Estados por fuente** (`src/lib/health/model.ts`, función pura):

| Estado | Cuándo | Tono |
|---|---|---|
| Al día | Lectura completa y reciente, con menciones nuevas dentro de lo normal | verde |
| Sin publicaciones nuevas | Se lee bien, pero no llega nada nuevo en más de `quiet_after_hours` (proveedor sin datos; no es error) | informativo |
| Cobertura parcial | Backfill pendiente, última corrida incompleta o hueco sin recuperar (con motivo y fechas) | aviso |
| Atrasada | `covered_until` más viejo que `stale_after_minutes` (por omisión 3 × frecuencia) | aviso |
| Con errores | 1–2 fallos seguidos (servicio degradado; se reintenta en la siguiente) | aviso |
| Fallando | 3 o más fallos seguidos (con espera creciente) | error |
| Pausada | Desactivada por una persona (pausa voluntaria); cobertura "desconocida", sin próximo intento | gris |
| No disponible | Conector deshabilitado en el servidor | gris |
| Cobertura desconocida | Nunca leída completa | aviso, **nunca verde** |

**Datos por fuente:**
- última tentativa y último éxito;
- atraso y su umbral;
- próximo intento: frecuencia, espera tras fallos y tick del cron, en hora de la Ciudad de México;
- errores consecutivos;
- capturadas, nuevas, duplicadas, sin consulta e interacciones actualizadas de la última corrida, más un
  resumen de 24 h;
- cobertura (completa, parcial o desconocida) con su motivo.

**Clasificación y dashboard:**

| Indicador | Muestra |
|---|---|
| Clasificación | Pendientes, en espera de reintento, en curso, antigüedad de la más antigua, fallidas y por revisar |
| Estados | Al día, Con rezago, Detenido o con errores, Sin registro |
| Dashboard | Hora de la última reconstrucción y si hay clasificaciones posteriores fuera del umbral |

El estado general y la "hora de corte" (`as_of` de la base, en hora de la Ciudad de México) encabezan la
página. El estado general no es verde si alguna fuente activa tiene cobertura desconocida, si no hay fuentes
activas o si un proceso nunca reportó.

**Umbrales configurables** (admin y comunicación):
- **Por fuente:** `expected_every_minutes` (15 min a 7 días, 60 por omisión), `stale_after_minutes` (nulo = 3 ×
  frecuencia) y `quiet_after_hours` (72). La ingesta respeta la frecuencia: `claim_sources` en modo cron omite
  la fuente hasta que toca, con 5 min de holgura.
- **Por municipio** (`monitor_settings`): rezago (30 min), clasificador detenido (20 min) y dashboard (30 min).
  Sus cambios quedan en la bitácora.

**Corridas:**
- Filtros por fuente, resultado, origen y periodo (24 h, 7 o 30 días) en la URL, para compartirlos.
- Paginación con "Ver más".
- Detalle desplegable: conteos, duración, ventana, si se completó, "leído hasta", topes, hueco, error y
  **siguiente paso** (`actionForError`: reconectar el token, revisar la URL, esperar la cuota o reintentar).
- Estados vacíos distintos con y sin filtros, carga con *skeleton* y error con el `error.tsx` de la app.

**Reintento manual autorizado y limitado:**
- "Reintentar ahora" llama a `runSourceNow`, que verifica que el usuario sea admin o comunicación.
- Usa `claim_sources` con *lease*, así que no duplica una corrida en curso.
- `p_min_gap_seconds = 60`: la misma fuente no se vuelve a leer a mano antes de un minuto, aunque el *lease*
  ya se haya liberado.
- La cola de fallos se reintenta o descarta con `resolve_pipeline_failure`.

**Eventos para alertas de salud:**
- Tipo de regla `monitor_health` (enfriamiento por omisión de 6 h). Huellas:
  - por fuente y estado: fallando o atrasada;
  - hueco nuevo, que incluye su fecha;
  - clasificador detenido o con rezago;
  - dashboard desactualizado.
- No alerta por estados transitorios: un solo fallo o una fuente nueva sin leer.
- Las alertas abren `/salud?fuente=…`.

**Latidos persistidos** (`worker_heartbeats`, sólo service role, leídos dentro de `monitor_health`):
- `ingest`: inicio y fin de cada corrida programada;
- `classify`: cada corrida, aunque no haya trabajo, con su error si lo hubo;
- `dashboard`: cada reconstrucción del resumen por hora, registrada dentro de `refresh_mention_stats()`.

## 3. Archivos

- **Migración:** `supabase/migrations/20261026000000_monitor_health.sql`.
- **Reversión:** `docs/rollback/20261026000000_monitor_health.down.sql`.
- **Lógica:**
  - `src/lib/health/model.ts` (puro) y `model.test.ts`;
  - `data.ts` y `actions.ts`;
  - `src/lib/alerts/rules.ts` (`decideHealth`) y `evaluate.ts`;
  - latidos en `src/lib/ingest/run.ts` y `src/lib/ai/classify.ts`;
  - espera manual en `src/lib/sources/actions.ts`.
- **Pantalla:**
  - `src/app/(app)/salud/page.tsx` y `skeleton.tsx`;
  - `src/components/health/*`;
  - la sección en `src/lib/auth/roles.ts` y su ícono;
  - el ícono del tipo de alerta.
- **Pruebas:**
  - `src/lib/health/model.test.ts` (25);
  - `src/lib/alerts/rules.test.ts` (+2);
  - `roles.test.ts` (+1);
  - `supabase/tests/database/health.test.sql` (27);
  - `rls_matrix.test.sql` (excluye `worker_heartbeats`, tabla global);
  - `e2e/health.spec.ts` (4).

## 4. Pruebas

| Prueba | Resultado |
|---|---|
| lint · typecheck | sin errores |
| `npm test` | 307/307 |
| `supabase db reset` (19 migraciones) + pgTAP | 338/338 |
| build con claves canario + `check:bundle` | OK (184 archivos, 8 canarios sin fuga) |
| e2e | 22/22 en la segunda corrida. En la primera falló `map.spec.ts` por una falla previa a esta etapa (ver §6) |
| e2e `health.spec.ts` | 4/4 (ver abajo) |
| Humo de alertas de salud | El cron de clasificación disparó "Fallando: Noticias regionales (RSS)"; la segunda corrida la suprimió por enfriamiento; quedaron latidos de clasificación y dashboard |
| Reversión | `down.sql` aplicado: sólo falla `health.test.sql`; reaplicar la migración funciona |

Casos de `e2e/health.spec.ts`:

- **Comunicación:** fuente sana, atrasada (con su umbral), fallando (error y acción "Revisar la URL del
  feed"), pausada (con el reintento deshabilitado) y con cobertura parcial (con el tope). También el filtro de
  corridas con error y su detalle.
- **Reintentar ahora:**
  - registra exactamente una corrida nueva;
  - el segundo clic inmediato se rechaza ("se leyó hace menos de 60 s");
  - no se crea otra corrida.
- **Lectura:** ve el resumen sin botones ni textos de error.
- **Dependencia:** no entra.

Casos de `health.test.sql`:

- **Qué ve cada rol en `monitor_health`:**
  - comunicación ve errores y topes;
  - lectura ve que una fuente falla, sin el texto;
  - dependencia y otro municipio no tienen acceso;
  - el service role sí.
- **Umbrales:**
  - editores sí los cambian; lectura no;
  - tienen límites.
- **Latidos:** de error y de recuperación, y del dashboard al reconstruirse.
- **Frecuencia y espera:**
  - el cron respeta la frecuencia; la corrida manual no;
  - la espera manual de 60 s se respeta aunque el *lease* esté libre.
- **Alertas:** se pueden crear reglas `monitor_health`.

## 5. Activación y reversión

1. Correr `20261026000000_monitor_health.sql` en preview y en producción **antes** del deploy. La app actual
   sigue funcionando con la migración: `claim_sources` acepta los mismos parámetros con nombre y el nuevo tiene
   valor por omisión.
2. Merge. Los latidos aparecen en la siguiente corrida de cada cron. Antes de eso, Salud muestra "Sin registro"
   y "Desconocida", a propósito.
3. Opcional: crear en Alertas una regla "Salud del monitoreo" con sus destinatarios, y ajustar los umbrales de
   las fuentes de baja frecuencia.

**Reversión:** revertir el commit y correr `docs/rollback/20261026000000_monitor_health.down.sql`. Se pierden
los umbrales, los latidos y las reglas `monitor_health`; los eventos de alerta se conservan.

## 6. Limitaciones y pendientes

- **Próximo intento estimado.** Supone el cron horario en el minuto 0. Si el cron de Vercel se retrasa o una
  corrida no alcanza a una fuente (12 por corrida), el intento real puede ser posterior.
- **Latido global.** El de ingesta y clasificación no distingue municipios, porque los crons son globales. El
  detalle por municipio está en `worker_runs`.
- **Prueba e2e intermitente del mapa** (`map.spec.ts`). Es previa a esta etapa: el panel de colonia muestra a
  lectura el enlace a Bandeja, a la que no tiene acceso, y la prueba sólo pasa si alcanza a ver la URL antes
  de la redirección. Se propuso como tarea aparte.
- **Sin pruebas con proveedores reales.** Como en la etapa 2, no se probó contra Facebook ni YouTube reales.
- **Pendientes de etapas anteriores:**
  - cuotas y costo de IA por municipio;
  - refresco del dashboard tras correcciones;
  - reportes programados;
  - Node 22/24.
