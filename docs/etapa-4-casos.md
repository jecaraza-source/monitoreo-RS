# Etapa 4 — Casos

Base: `main` en `6e26ba5` (cierre de la etapa 3).

## 1. Qué había y qué se conserva

| Pieza | Antes | Ahora |
|---|---|---|
| Mención | Unidad de todo: bandeja, dashboard, mapa, reportes | Igual. Un caso **agrupa** menciones sin fundirlas: 18 menciones de una fuga siguen contando 18 |
| Turno (`tickets`) | Uno por mención y dependencia (principal + apoyo), con estado propio, plazo y avisos por WhatsApp | Sigue existiendo. Si pertenece a un caso (`tickets.case_id`), es la asignación del caso a esa dependencia y su estado lo dicta el caso |
| Notas de mención | `mention_notes` | Sin cambios; el caso tiene además `case_notes` (internas o para la dependencia) |
| WhatsApp | Botones sobre el turno | Sobre un turno de caso mueven el caso (`case_ticket_status`) |

## 2. Modelo

- **`cases`**
  - Columnas:
    - `id` estable;
    - `number` por municipio (`case_counters`) y `folio` generado `C-00001`, único por municipio;
    - `title`, `description`, `category`, `neighborhood_id` (opcional), `priority` (operativa);
    - `department_id`, `responsible_user_id` (opcional), `due_at`;
    - `status`, `status_reason`, `primary_mention_id`, `merged_into_id`;
    - `opened_by` (autor del caso), fechas de cada etapa, `backfill_key`.
  - Las FK son compuestas con `org_id`, así que no puede haber relaciones entre municipios.
- **`case_mentions`**: `mention_id` es la llave primaria, así que una mención pertenece como máximo a un caso.
  Guarda quién la vinculó, cuándo y el motivo.
- **`case_events`**: historial de sólo agregar.
  - Guarda actor (persona, WhatsApp o sistema), fecha, operación, de/a estado, motivo, cambios en jsonb y si
    es interno.
  - Un trigger impide `update`, y `delete`/`truncate` están revocados incluso para `service_role`.
- **`case_notes`**: visibilidad `internal` (Comunicación, admin; lectura las lee) o `department`. También son
  de sólo agregar.
- El autor de la **publicación** sigue en `mentions.author_id`. El autor del **caso** queda en `opened_by` y
  en el evento `created`.

### Estados y transiciones (una sola máquina)

```
new ─► in_review ─► assigned ─► accepted ─► in_progress ─► resolved ─► closed
 │         │          │  ▲         │            │             │          │
 │         │          ▼  │(reasignar)          (reasignar)    ▼          ▼
 └─► discarded ◄──────┘ returned ◄──────┘               in_progress   in_review (reabrir)
```

- **Tabla completa:** `public.case_transition_allowed`, con espejo en `src/lib/cases/model.ts`. Una prueba
  unitaria lee la migración y compara las dos.
- **Piden motivo:** devolver, descartar, rechazar la validación (`resolved → in_progress`) y reabrir.
- **La dependencia responsable** sólo puede:
  - aceptar;
  - iniciar la atención;
  - marcar atendido;
  - devolver por competencia.
- Validar y cerrar es de Comunicación.
- **`merged`** sólo se alcanza con `merge_cases`.

### Turnos y sincronización

- **Asignar** (`transition_case(…, 'assigned', …)`) crea o reactiva los turnos sobre la mención principal: uno
  de la dependencia responsable y otros de las de apoyo. Al reasignar, se cierra el turno de la responsable
  anterior.
- **Después de cada transición**, `private.sync_case_tickets` copia el estado del caso a sus turnos:
  - asignado o aceptado → abierto;
  - en atención → en atención;
  - atendido → resuelto;
  - cualquier otro → cerrado.
- **Un turno de caso** sólo cambia de estado por esa vía. El trigger `tickets_guard_case` rechaza cambios
  directos. La Bandeja y WhatsApp llaman a `case_ticket_status`, que avanza el caso paso a paso.
- **`route_mentions`** rechaza menciones que ya están en un caso, con el mensaje "asígnalo desde el caso".
  Las menciones sin caso se turnan como antes.

## 3. Operaciones (RPC `security definer`; rol y municipio verificados en la base)

| Operación | Quién | Notas |
|---|---|---|
| `create_case(org, menciones[], …)` | admin, comunicación | Las menciones deben ser del municipio y no estar en otro caso; la principal es la más antigua |
| `case_add_mentions` / `case_remove_mention` | admin, comunicación | Quitar exige motivo; no se quita la última mención, ni la principal si tiene turnos |
| `update_case(caso, campos)` | admin, comunicación | Sólo campos permitidos; colonia y persona deben ser del municipio; cambios `[antes, después]` en el historial |
| `transition_case` | según tabla | Devuelve los turnos creados para el aviso por WhatsApp |
| `case_ticket_status` | dependencia responsable, editores | Desde Bandeja y WhatsApp |
| `add_case_note` | editores; dependencia asignada sólo `department` | La nota interna genera un evento interno |
| `merge_cases(destino, origenes[], motivo)` | admin, comunicación | Mueve menciones, cierra y re-apunta los turnos; los orígenes quedan `merged` con su folio e historial |
| `suggest_case_mentions(caso)` | admin, comunicación | Sólo sugiere; ver abajo |
| `case_people(caso)` | quien pueda leer el caso | Sólo nombres (nunca correos), de la dependencia asignada |
| `simulate_ticket_backfill` / `apply_ticket_backfill` | admin, service role | Ver backfill |

**Sugerencias:**
- **Candidatas:** menciones en ningún caso, a ±72 h de las del caso.
- **Puntaje:** misma colonia × 2 + mismo tema × 1 + proporción de palabras en común × 3.
- **Se sugiere sólo si:**
  - coincide la colonia; o
  - comparte la mitad de las palabras sin contradecir la colonia.
- Compartir sólo sentimiento o sólo tema **no** basta.
- Nada se agrega sin que una persona confirme.

## 4. Aislamiento (RLS)

- **admin, comunicación, lectura** (`can_read_all`): todo su municipio. Lectura no tiene ninguna política ni
  privilegio de escritura, y las RPC la rechazan.
- **dependencia** (`case_visible_to_department`): sólo los casos en los que su área tiene un turno.
  - No ve notas internas ni eventos internos.
  - Las menciones de esos casos se vuelven visibles para ella (`mention_routed_to_user` se amplió).
  - Una mención de otro caso no la ve.
- **Otro municipio:** nada, porque las FK son compuestas y las políticas filtran por `org_id`.
- **Escrituras:** sólo por RPC. `insert`, `update` y `delete` están revocados para `authenticated` en las cuatro
  tablas.

## 5. Backfill de turnos existentes

- **Política:**
  - Cada mención con turnos sin caso se convierte en **un** caso (`backfill_key = 'mention:<id>'`, único por
    municipio). Por eso es repetible.
  - La dependencia responsable sale del turno principal (`is_primary`, o el más antiguo).
  - Los demás turnos quedan como apoyo del mismo caso.
- **Estado del caso**, según el turno principal:
  - abierto → asignado;
  - en atención → en atención;
  - resuelto → atendido;
  - cerrado → cerrado.
- **Fechas:** salen de los turnos.
- **Se conservan:** los turnos (estado, fechas, dependencia, rol) y las notas, sin cambios. Sólo se llena
  `case_id`.
- **Menciones que ya estaban en un caso:** se respetan y se reportan.
- **Primero simula:** `simulate_ticket_backfill` cuenta:
  - turnos totales, en casos y por vincular;
  - casos por crear y ya migrados;
  - menciones con varias dependencias;
  - menciones omitidas;
  - casos por estado.
- **Al aplicar:** `apply_ticket_backfill` toma un candado consultivo y devuelve la conciliación: turnos antes y
  después, vinculados y casos creados.
- **En la app:** `/casos` → «Migrar turnos existentes» (sólo admin).

**Conteo de solo lectura previo a la migración** (13 oct 2026):

| Entorno | Turnos | Casos a crear | Menciones con varias dependencias |
|---|---|---|---|
| Producción | 189 | 187 | 1 |
| Preview | 110 | 110 | 0 |

## 6. Interfaz

- **`/casos`**:
  - lista con filtros en la URL (estado, abiertos por omisión; dependencia; colonia; prioridad; folio o título);
  - paginación de 50;
  - estado vacío por rol y *skeleton*.
- **`/casos/[id]`**:
  - acciones por rol, con diálogo de motivo y de asignación (responsable, apoyo, plazo con SLA);
  - edición y fusión;
  - menciones con el autor de cada publicación;
  - quitar mención con motivo y sugerencias con «Agregar» confirmado;
  - notas internas o para la dependencia;
  - datos del caso y turnos;
  - historial.
- **Bandeja**:
  - acción masiva y atajo `c` «Caso» para crear un caso o agregar a uno abierto;
  - folio en la tarjeta y enlace en el detalle;
  - un turno de caso sólo ofrece «En atención» o «Atendido» a la responsable.

## 7. Archivos

- `supabase/migrations/20261027000000_cases.sql`, `docs/rollback/20261027000000_cases.down.sql`.
- `src/lib/cases/{model,data,actions}.ts`, `src/components/cases/*`, `src/app/(app)/casos/**`.
- Bandeja: `src/lib/inbox/{actions,query}.ts`, `src/components/inbox/{inbox-view,detail-panel,mention-card}.tsx`.
- Navegación: `src/lib/auth/roles.ts`, `src/components/layout/nav-icons.ts`.
- Pruebas:
  - `src/lib/cases/model.test.ts`, `roles.test.ts`;
  - pgTAP `cases`, `cases_backfill`, `cases_suggest`, `cases_people` y `rls_matrix`;
  - `e2e/cases.spec.ts`.

## 8. Activación y reversión

**Activar:**
1. Correr la migración (SQL Editor, con la línea de `schema_migrations`) **antes** del deploy.
2. Desplegar.
3. Como admin, en `/casos` → «Migrar turnos existentes»: **Simular**, revisar y luego **Aplicar**.

**Revertir:**
1. Revertir el commit.
2. Correr `docs/rollback/20261027000000_cases.down.sql`. Restaura `route_mentions`, `whatsapp_ticket_action` y la
   visibilidad previas.
3. Qué se conserva y qué se pierde:
   - se conservan los turnos y su estado actual;
   - se pierden casos, vínculos, historial y notas de caso.

Para conservarlos, exportarlos antes:

```sql
copy (select * from public.cases) to stdout with csv header;
copy (select * from public.case_events) to stdout with csv header;
```

La reversión y la reaplicación se probaron en local (pgTAP completo después).

## 9. Limitaciones

- **Sugerencias:** son léxicas (palabras de `search`), no semánticas, con ventana fija de 72 h y máximo 10.
- **Responsable de la dependencia:** queda como «Sin persona asignada» hasta que alguien elige; no se toma
  automáticamente.
- **Turnos de un caso:** viven en la mención principal. Una mención agregada después no recibe turno propio.
  Es intencional: el trabajo se sigue en el caso.
- **Persona responsable:** sólo se elige entre miembros con rol dependencia del área asignada.
