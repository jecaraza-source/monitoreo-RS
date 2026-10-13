# Etapa 5 — Bandeja operativa y revisión humana

Base: `main` en `d79a161` (cierre de la etapa 4).

## 1. Qué ya estaba resuelto y se conserva

| Pieza | Antes | Ahora |
|---|---|---|
| `/bandeja` | Lista cronológica virtualizada, cursor `(published_at, id)`, filtros en la URL, Realtime, atajos | Igual en «Todas». Se suman seis vistas operativas que reutilizan tarjetas, detalle, filtros, lista virtual y diálogos |
| Correcciones | Edición directa de `classifications`; la base sellaba quién y cuándo; bitácora general | Pasan por `correct_classification` (RPC). Se guarda la versión previa, el motivo, y se resuelve la revisión pendiente |
| Prioridad del modelo | Mezclaba gravedad y urgencia | `priority` queda como urgencia operativa. Gravedad, tipo de incidente y necesidad de atención son campos aparte |
| Dashboard | Se reconstruía sólo tras ingesta o clasificación; una corrección esperaba a la siguiente | Cola durable de invalidación, que se procesa tras la corrección y en cada cron de 5 min |

## 2. Vistas operativas

**Una sola consulta.**
- `public.inbox_items(org, filtros)` es `security invoker`, así que la RLS decide qué ve cada rol.
- De ella salen dos funciones:
  - `inbox_queue(org, vista, filtros, cursor, límite)`: la lista;
  - `inbox_counts(org, filtros)`: los contadores.
- Por eso un contador es exactamente el tamaño de su lista con los mismos filtros. Una prueba pgTAP lo verifica vista por vista, con filtros y paginando.

**Elementos de la lista.**
- Menciones que no están en un caso. Excluye las descartadas.
- Casos abiertos: no fusionados, descartados ni cerrados.
- Se distinguen en pantalla: el caso lleva tarjeta propia con folio, borde de acento y estado.

**Definición de cada vista:**

| Vista | Mención | Caso | Roles |
|---|---|---|---|
| Nuevas | `triage = new` | `status = new` | admin, comunicación |
| Urgentes | Prioridad crítica o alta, o gravedad alta o emergencia, y sin resolver | Prioridad crítica o alta, y no atendido | todos los que trabajan |
| Sin responsable | Sin turno, sin revisar o revisada, clasificada y que requiere atención | Nuevo, en revisión o devuelto | admin, comunicación |
| Por aceptar | Turno principal abierto | Asignado | todos |
| Vencidas | Turno abierto o en atención, con el plazo pasado | Asignado, aceptado o en atención, con el plazo pasado | todos |
| Por validar | Turno resuelto | Atendido | todos |

**Orden.**
- Criterios, en este orden:
  1. urgencia, de mayor a menor (prioridad más un extra por gravedad alta o de emergencia);
  2. plazo, primero el más próximo; sin plazo al final;
  3. antigüedad, primero lo más antiguo;
  4. tipo e id, como desempate estable.
- Cursor por fila completa: las páginas no repiten ni saltan elementos.
- La selección se guarda por clave `tipo:id` y no duplica entre páginas.

**Dependencia.**
- Ve Urgentes, Por aceptar, Vencidas y Por validar, sólo con lo suyo.
- No ve la cola de revisión, ni lista ni contador.

**Acciones masivas.**
- Responden con el número real de registros actualizados y la lista de los que fallaron, con su motivo: «no encontrada o sin permiso», «pertenece a C-00002: se asigna desde el caso».
- Si hay fallas, el aviso es de advertencia, no de éxito.

## 3. Sentimiento, gravedad y atención

**Campos nuevos en `classifications`:**
- `severity`: none, low, moderate, high, emergency;
- `incident_type`: public_service, infrastructure, public_safety, violence, health, civil_protection, environment, corruption, other, none;
- `needs_attention`.

**Clasificador.** El modelo los produce con reglas explícitas: «una crítica, insulto o burla al gobierno es negativa pero su gravedad es "ninguna" si no describe un hecho que atender». Una emergencia siempre pasa por el modelo grande.

**Confirmación humana.** «Confirmar tipo y urgencia» registra quién y cuándo (`confirmed_by` y `confirmed_at`) sin tocar el sentimiento ni marcar la clasificación como corregida.

**Políticas de emergencia** (`incident_policies`):
- Configuración → Emergencias, sólo admin.
- Se siembran por omisión para seguridad, violencia, protección civil y salud.
- Antes de turnar una mención con gravedad de emergencia, el diálogo muestra el canal institucional y exige confirmar que se derivó. El servidor rechaza el turno sin esa confirmación.

**Backfill.** Para clasificaciones anteriores, `needs_attention` se calcula de la intención (queja, denuncia, pregunta) y es repetible: sólo filas con valor nulo. Gravedad y tipo quedan «Sin evaluar».

## 4. Revisión humana (`/bandeja/revision`, admin y comunicación)

**Motivos de entrada**, calculados por la base al escribir el modelo:

| Motivo | Cuándo |
|---|---|
| Baja confianza | Confianza menor al umbral, `monitor_settings.review_confidence_below`, por omisión 0.60 |
| Posible emergencia | El modelo la marcó con gravedad de emergencia |
| Riesgo alto | Gravedad alta, o prioridad alta sin gravedad evaluada |
| Término de riesgo | El texto contiene un término de riesgo alto o crítico del catálogo |
| Señales contradictorias | Positivo con queja o denuncia; negativo con elogio; gravedad alta sin necesidad de atención; sin incidente pero con prioridad alta |

**Qué muestra cada tarjeta.**
- El contenido original, la fuente, la fecha y el enlace.
- El autor, sólo si es un medio o una figura pública.
- La salida del modelo completa, con el modelo, la confianza y los motivos.

**Decisiones** (`decide_review`):
- *Confirmar*.
- *Corregir*: requiere motivo y guarda los cambios como `[antes, después]`.
- *Descartar*: requiere motivo y saca la mención de la bandeja, pero conserva su clasificación.
- Se decide una sola vez.

**Versiones.**
- Todo cambio a una clasificación guarda antes el estado previo en `classification_versions`: la instantánea completa, su origen (modelo o persona), quién la reemplazó y el motivo.
- Esta tabla es de sólo agregar y sirve para auditoría y para medir el clasificador.

## 5. Invalidación de agregados

1. **Encolar.** Una corrección de campos que cuentan (sentimiento, tema, intención, dependencia, colonia) inserta en `stats_invalidations`. Lo hace un trigger, así que vale para cualquier vía de corrección.
2. **Procesar.** `process_stats_invalidations()`, sólo con service role y con candado consultivo:
   - reconstruye `mention_stats_hourly`;
   - borra la «Lectura del día» del municipio, para que se regenere;
   - marca los borradores de reporte cuyo periodo contiene una mención corregida (`reports.facts_stale_at`), que muestran un aviso para generar uno nuevo;
   - marca la cola como procesada.
3. **Cuándo corre.** Inmediatamente después de la corrección, con `after()`, y como respaldo en cada corrida del cron de clasificación (cada 5 min). Si una llamada falla, la cola persiste.
4. **Monitoreo.**
   - SLA: el umbral de frescura del dashboard, `dashboard_stale_minutes`, por omisión 30 min.
   - Salud marca el dashboard como «Desactualizado» si hay una corrección pendiente más antigua que ese umbral.
5. **Reportes aprobados.** No cambian: quedan congelados por diseño y por auditoría.

## 6. Accesibilidad y móvil

- Las pestañas desplazan horizontalmente en el celular y centran la vista activa.
- El detalle se abre en una hoja lateral en pantallas chicas.
- Atajos: `j` / `k`, `Enter`, `x`, `t`, `c`, `r`, `d`, `u` (actualizar), `/`, `?`. Los botones llevan `aria-keyshortcuts`.
- Los contadores usan `aria-live`.
- Cada vista y la cola de revisión tienen su propio mensaje cuando no hay datos.
- Realtime actualiza los contadores; la lista espera a que la persona pulse «Hay cambios: actualizar», para no moverse bajo el cursor.

## 7. Archivos

- `supabase/migrations/20261029000000_triage.sql` y `docs/rollback/20261029000000_triage.down.sql`.
- Clasificador: `src/lib/ai/{classifier,classify}.ts` y `e2e/mock-anthropic.mjs`.
- Bandeja:
  - `src/lib/inbox/{model,query,actions,data}.ts`;
  - `src/components/inbox/{queue-view,view-tabs,case-card,requests,route-dialog,detail-panel,mention-card,filter-bar,inbox-view}.tsx`;
  - `src/app/(app)/bandeja/page.tsx`.
- Revisión: `src/lib/review/*`, `src/components/review/review-card.tsx`, `src/app/(app)/bandeja/revision`.
- Emergencias: `src/lib/emergencies/actions.ts`, `src/components/settings/incident-policy-form.tsx`, `src/app/(app)/configuracion/emergencias`.
- Invalidación: `src/lib/dashboard/refresh.ts`, `src/app/api/cron/classify/route.ts`, `src/lib/health/{data,model}.ts`, `src/lib/reports/data.ts`, `src/components/reports/report-view.tsx`.
- Pruebas:
  - pgTAP `triage_queues`, `triage_review`, `triage_service` (y ajuste a `rls_matrix`);
  - unitarias de `inbox/model`, `review/model`, `health/model`, `ai/classifier` y `auth/roles`;
  - `e2e/triage.spec.ts`.

## 8. Activación y reversión

**Activar:**
1. Correr la migración (SQL Editor, con la línea de `schema_migrations`) **antes** del deploy.
2. Desplegar.
3. Revisar Configuración → Emergencias y ajustar canales e instrucciones del municipio.

La migración no encola revisiones para las clasificaciones existentes: la cola empieza con lo que clasifique el modelo después.

**Revertir:**
1. Revertir el commit.
2. Correr el `down.sql`. Restaura `complete_classifications` y el sello de corrección previos.

Para conservar decisiones y versiones, exportarlas antes:

```sql
copy (select * from public.classification_reviews) to stdout with csv header;
copy (select * from public.classification_versions) to stdout with csv header;
```

La reversión y la reaplicación se probaron en local sobre una base limpia, con pgTAP completo después.

## 9. Limitaciones

- **Vistas operativas:** se ordenan por la base y no se reordenan solas en vivo; los contadores sí se actualizan.
- **Casos en las vistas:** usan la clasificación de su mención principal para los filtros de sentimiento, tema y fuente.
- **Evaluación del clasificador:** `evals/classify` aún no mide gravedad ni tipo de incidente. `classification_versions` es la fuente para agregarlos.
- **Revisión de casos:** la revisión es por clasificación de mención, no por caso.
