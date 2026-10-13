# Etapa 6 — Atención de casos: asignación, avances, evidencia y validación

Base: `main` en `37d6d17` (cierre de la etapa 5).

## 1. Qué ya estaba resuelto y se conserva

| Pieza | Antes (etapa 4) | Ahora |
|---|---|---|
| Estados | `in_review → assigned → accepted → in_progress → resolved → closed`, más devuelto, descartado, fusionado | Los mismos estados y la misma tabla de transiciones (`case_transition_allowed`). `resolved` se muestra como **Pendiente de validación** |
| Pasos de la dependencia | Aceptar, iniciar, marcar atendido y devolver con motivo. Los editores podían hacer cualquier paso | Sólo la dependencia responsable. La coordinación puede registrarlos **en su nombre**, con motivo obligatorio y la marca `on_behalf` en el historial |
| Cierre | `transition_case(…, 'closed')` desde `resolved` | Sólo por `validate_case`: confirmar la evidencia y escribir el resultado. `transition_case` ya no cierra ni rechaza validaciones |
| Reapertura | `closed → in_review` con motivo | `reopen_case`: motivo, evidencia opcional y **nuevo ciclo**. `transition_case` sigue permitiéndolo y también abre ciclo |
| Turnos, WhatsApp, historial, notas, fusión, backfill | — | Sin cambios. Los botones de WhatsApp siguen moviendo el caso (aceptar, en atención, atendido) |
| Fechas en `cases` | `accepted_at`, `resolved_at` y `closed_at` se borraban al reasignar o reabrir | Siguen mostrando el ciclo actual. Todo hito anterior queda en `case_milestones`, que es de sólo agregar |

## 2. Quién ejecuta cada transición

Lo decide `public.case_transition_actor(desde, hacia)`, reflejado en `src/lib/cases/model.ts` y con prueba unitaria.

| Transición | Actor | Notas |
|---|---|---|
| detectado → revisión / asignado / descartado | coordinación | descartar exige motivo |
| revisión → asignado / descartado | coordinación | asignar se hace con `assign_case` (§3) |
| asignado → aceptado | dependencia responsable | coordinación sólo en su nombre, con motivo |
| asignado / aceptado → devuelto | dependencia responsable | motivo obligatorio; vuelve a «Sin responsable» de la coordinación |
| aceptado → en atención | dependencia responsable | |
| en atención → pendiente de validación | dependencia responsable | «Solicitar validación» |
| pendiente de validación → cerrado / en atención | **validación** | sólo `validate_case` (coordinación) |
| devuelto → asignado / revisión, reasignar | coordinación | |
| cerrado / descartado → revisión | coordinación | reapertura con motivo; nuevo ciclo |

**Coordinación** son los roles existentes admin y comunicación, a través de una sola función,
`private.is_case_coordinator(org)`. No se creó un quinto rol. Si un municipio quiere designar
coordinadores específicos, ése es el único punto que hay que cambiar, con su propia migración y diseño.

**Sin saltos por API.**
- Las tablas no se escriben directo: `insert`, `update` y `delete` están revocados para `authenticated`.
- Los turnos de un caso no cambian de estado solos (trigger `tickets_guard_case`).
- `apply_case_transition` revisa, en este orden: actor, transición permitida, bandera de validación, motivo y dependencia.
- Ni el `service_role` cierra sin validar (prueba `case_attention_service`).

## 3. Asignación

`assign_case(caso, dependencia, compromiso, plazo_aceptación, apoyos, persona, qué_se_hará, motivo)`:

- **Dependencia responsable.** Es el responsable principal; los apoyos son opcionales, hasta 4.
- **Persona responsable.** Opcional, pero debe ser un usuario `dependencia` de esa dependencia.
- **Plazo de aceptación.** Futuro y anterior o igual al compromiso.
- **Compromiso de atención.** Fecha futura (`due_at`) y texto de qué se hará (`commitment`).
- **Coordinador.** `coordinator_user_id` guarda quién coordina el caso: la primera persona que lo asigna.

Al reasignar a otra dependencia, la persona responsable se quita si no pertenece a la nueva.

**Bandeja y listados.** Un caso asignado vence por su plazo de aceptación; aceptado o en atención, por su
compromiso. La vista «Vencidas» y el orden lo reflejan (`inbox_items`).

**Devolución por competencia.** La dependencia la hace con motivo. El caso queda «Devuelto» en la vista
«Sin responsable» de la coordinación hasta que lo reasignen: nunca se queda sin seguimiento (lo prueba pgTAP).

## 4. Tareas entre áreas

`case_tasks` registra área, persona, plazo y estado (pendiente, en proceso, hecha, cancelada).

| Acción | Quién |
|---|---|
| Crear | coordinación o el área líder, para el área líder o una de apoyo con turno activo |
| Iniciar o marcar hecha | el área de la tarea, el área líder o la coordinación |
| Cancelar o reabrir una hecha | área líder o coordinación, con motivo |

**Visibilidad (RLS):**
- cada área ve sólo sus tareas;
- el área líder ve todas las de su caso;
- coordinación y lectura ven todo.

Los eventos de tareas en el historial son internos, para que un área no vea en el historial el trabajo de
otra. El área líder conoce las áreas del caso por `case_areas`, que sólo devuelve ids.

Cerrar el caso exige que no haya tareas abiertas.

## 5. Avances y evidencia

**Avances.** `case_updates` guarda la fecha, el autor (nombre y área), la nota, la tarea opcional y el ciclo.
Cada avance tiene una audiencia:
- **Todas las áreas del caso**;
- **Sólo coordinación**: la ven el área autora y la coordinación (lectura también).

**Evidencia (`case_evidence` y bucket privado `case-evidence`):**

1. **Rutas.** `<org_id>/<case_id>/<uuid>.<jpg|png|pdf>`. La ruta se valida en la política de Storage, en
   un `check` de la tabla y al registrarla. El nombre original del archivo no se guarda.
2. **Subida.**
   - Se hace con la sesión de la persona, no con el service role.
   - La política de inserción (`can_upload_case_evidence`) exige que el caso sea de esa organización.
   - Coordinación puede subir a cualquier caso no fusionado. Una dependencia sólo a casos en los que trabaja, de asignado a pendiente de validación.
3. **Registro.** `add_case_update` toma el tipo y el tamaño de los metadatos de Storage, no del cliente, y
   exige que la persona haya subido el archivo. Si el registro falla, el servidor borra lo que subió.
4. **Descarga.** `GET /casos/<id>/evidencias/<archivo>`:
   - lee la fila con la RLS de la persona;
   - firma con su sesión (la política de lectura de Storage vuelve a revisar la fila);
   - redirige a un enlace que **vence en 60 s**, con `Cache-Control: no-store` y `Referrer-Policy: no-referrer`.
   - Sin permiso responde 404, y sin sesión no hay enlace.
   - No hay URLs permanentes ni públicas.
5. **Inmutable.** La evidencia registrada no se edita ni se borra: ni la persona ni el service role por SQL.
   Devolver y reabrir la conservan.

**Restricciones de archivos:**
- formatos: JPG, PNG y PDF, detectados por sus primeros bytes;
- tamaño: hasta 3 MB por archivo (también es el límite del bucket), 4 archivos y 3.5 MB por avance (las Server Actions admiten 4 MB).

**Minimización de datos personales:**
- A las fotos se les quitan EXIF y XMP (GPS, cámara, fechas), IPTC y comentarios (JPG), y los bloques de texto, EXIF y hora (PNG).
- Los PDF se guardan tal cual: es una limitación, ver §9.
- El formulario lo recuerda: mostrar el lugar y el trabajo, sin rostros, placas, identificaciones, teléfonos ni domicilios.
- La evidencia trata del trabajo, no de ciudadanos. No se perfila a nadie.

## 6. Validación y reapertura

**Validar** (`validate_case`, sólo coordinación, sólo un caso pendiente de validación):

- **Cerrar** exige:
  - al menos un avance en el ciclo;
  - ninguna tarea abierta;
  - la casilla «la evidencia es suficiente»;
  - escribir el resultado.

  El resultado queda en `cases.result`.
- **Devolver a atención** exige motivo.
- Cada decisión queda en `case_validations`, de sólo agregar, con el número de avances y archivos que había.

**Reabrir** (`reopen_case`, sólo un caso cerrado):
- exige motivo y admite evidencia de que el problema persiste;
- `cycle` sube en uno y `result` se limpia (el anterior queda en `case_validations`);
- el motivo y su evidencia son el primer avance del nuevo ciclo (`kind = 'reopen'`).

## 7. Tiempos sin sobrescribir

- **`case_milestones`.** Cada estado alcanzado, con ciclo, estado previo, dependencia, actor y hora. Lo escribe un trigger en `cases`, así que vale para cualquier vía: RPC, WhatsApp, sistema o backfill. Es de sólo agregar.
- **`case_cycle_times`.** Vista invoker con, por ciclo:
  - primera y última asignación;
  - aceptación;
  - inicio de atención;
  - solicitud de validación;
  - cierre;
  - número de devoluciones y de validaciones rechazadas.
- **Pantalla.** La tarjeta «Tiempos» del caso muestra cada ciclo con lo transcurrido entre hitos y las validaciones.
- **Backfill repetible.** Sólo toca casos sin hitos:
  - los hitos salen de `case_events` (el ciclo se deriva de las reaperturas);
  - en los casos del backfill de la etapa 4, salen de sus fechas originales;
  - `cases.cycle` se recalcula sólo donde difiere.
- **Conteo previo (sólo lectura).** Producción: 1 caso («detectado», 1 evento de estado, sin reaperturas). Preview: 0 casos. Ninguno de los dos tiene el bucket.

## 8. Archivos

- `supabase/migrations/20261030000000_case_attention.sql`
- `docs/rollback/20261030000000_case_attention.down.sql`
- **Lógica:**
  - `src/lib/cases/attention.ts` (acciones);
  - `src/lib/cases/evidence.ts` (formatos, límites, quitar metadatos);
  - `model.ts` (actor, plazos, tareas, duraciones);
  - `data.ts`.
- **UI:**
  - `src/components/cases/{case-actions,case-updates,case-tasks,case-times,evidence-input,case-history}.tsx`;
  - `src/app/(app)/casos/[id]/page.tsx`, `casos/page.tsx`;
  - ruta `casos/[id]/evidencias/[evidenceId]/route.ts`;
  - `components/inbox/case-card.tsx`, `lib/inbox/query.ts`.
- **Pruebas:**
  - pgTAP `case_attention.test.sql` (86), `case_attention_service.test.sql` (4) y ajuste de `cases.test.sql`;
  - unitarias `evidence.test.ts` y `model.test.ts`;
  - e2e `e2e/attention.spec.ts` y ajuste de `e2e/cases.spec.ts`; `e2e/fixtures-png.ts` agrega `withTextChunk`.

## 9. Limitaciones

- **PDF.** No se limpian sus metadatos (autor, software). Se recomienda exportarlos sin datos personales.
- **Rostros y placas.** No se detectan; depende de la persona que sube y de quien valida.
- **Enlace firmado.** Mientras vive (60 s), quien lo tenga puede abrir el archivo.
- **Archivos huérfanos.** Si el servidor cae entre la subida y el registro, el archivo queda en la carpeta del caso sin fila y sólo su autor lo ve. No hay limpieza automática todavía.
- **Avisos.** No hay aviso por WhatsApp o correo al devolver por competencia, al validar ni al reabrir: se ven en la Bandeja y en el caso.
- **WhatsApp de coordinación.** Si alguien de coordinación usa los botones de WhatsApp para un paso de la dependencia, ahora se rechaza: hace falta motivo y WhatsApp no lo pide.
- **Hitos del backfill.** No tienen dependencia ni actor cuando el historial no los registró.
- **Retención.** La evidencia se borra sólo con el caso; no hay política de retención propia.

## 10. Activación y reversión

**Activar:**
1. Correr la migración (SQL Editor, con la línea de `schema_migrations`) en preview y producción **antes** del deploy.
2. Desplegar.

No hay variables nuevas. El bucket lo crea la migración.

**Revertir:**
1. Revertir el commit.
2. Correr el `down.sql`. Restaura `apply_case_transition`, `transition_case` e `inbox_items`, y borra tablas, funciones y columnas nuevas.

Antes, exportar avances, evidencia, validaciones, tareas e hitos (los `copy` están al inicio del archivo).
Los archivos del bucket no se borran solos.

La reversión, la reaplicación y la repetición del backfill se probaron en local, con pgTAP completo después.
