# Etapa 7 — SLA con calendario, escalamiento, envíos durables y reportes programados

Base: `main` en `0206063` (cierre de la etapa 6).

## 1. Qué ya estaba resuelto y se conserva

| Pieza | Antes | Ahora |
|---|---|---|
| SLA | `sla_policies`: horas corridas por prioridad. El navegador sumaba horas a la fecha de turnado | Se conserva, y la Bandeja lo sigue usando para proponer el plazo al turnar una mención. Sus horas las mantienen sincronizadas los plazos generales del nuevo SLA |
| Seguimiento de turnos por WhatsApp | Recordatorio al 75 % y aviso al vencer, sólo para turnos de menciones | Igual para menciones sueltas. Los turnos de **casos** ahora los sigue el escalamiento por caso (§3), para no avisar dos veces |
| Alertas | `fire_alert` con cooldown. Envío directo por correo y WhatsApp, sin reintentos ni id del proveedor | `fire_alert` sin cambios. Cada destinatario pasa por el outbox (§4), y el resultado se refleja en la alerta |
| Reportes programados | `last_run_at` se leía y luego se escribía; dos crons podían generar dos reportes. Un error dejaba el día marcado como «ya corrió» | Un trabajo único por municipio, tipo y periodo, con etapas y reintentos (§5) |
| Envío manual de reportes | Directo a Resend | Por el outbox. Si el proveedor falla, queda en cola y se reintenta |

## 2. SLA

**Configuración** (Configuración → SLA y escalamiento, sólo admin):

- **Calendario** (`sla_calendars`):
  - horas corridas u horas hábiles;
  - días hábiles, de lunes a domingo;
  - horario de apertura y cierre;
  - zona fija `America/Mexico_City`.
- **Días inhábiles** (`sla_holidays`).
- **Plazos** (`sla_targets`): aceptación y atención por prioridad, que son obligatorios, y por categoría (tema), opcionales.
  - La categoría usa sus plazos propios y, si no tiene, los generales.
  - Restricciones: aceptación ≤ atención, y una prioridad mayor no puede tener un plazo más largo.

**Versiones** (`sla_versions`):
- Cada guardado es una versión con la configuración completa.
- Una versión es **valor de referencia, sin acuerdo aprobado**, hasta que un admin la aprueba con la nota del acuerdo que la respalda (oficio, acta). Así lo indican la pantalla, el diálogo de asignación y la ficha del caso.
- La versión 1 se sembró con las horas que ya tenía cada municipio: horas corridas, aceptación de 1, 4, 8 o 24 h según la prioridad, sin aprobar.

**Cálculo** (`sla_deadline(org, inicio, horas)`, en la base):
- **Horas corridas:** inicio + horas.
- **Horas hábiles:**
  - sólo cuentan los minutos dentro del horario, en días hábiles que no estén marcados como inhábiles;
  - un inicio fuera de horario empieza a contar en la siguiente apertura.
- Ejemplos con L–V de 9 a 17, todos probados en pgTAP:

  | Inicio | Horas hábiles | Vence |
  |---|---|---|
  | viernes 16:00 | 2 | lunes 10:00 |
  | 07:00 | 3 | 12:00 |
  | sábado | 1 | lunes 10:00 |
  | jueves 30/10 16:00, con lunes 2/11 inhábil | 2 | martes 3/11 10:00 |
  | 22:00 UTC | 1 | 17:00 hora de CDMX |

**Asignación** (`assign_case`, misma firma que en la etapa 6):
- Sin fechas, las calcula el SLA con la categoría y la prioridad del caso.
- El diálogo propone las fechas del SLA y dice qué versión se usa. Si la persona no las cambia, el servidor las recalcula en ese momento.
- Si la persona cambia las fechas, ganan las suyas y el caso registra `overridden`.
- El caso guarda siempre `sla_version_id` y `sla_terms`: las horas, el modo, si la versión estaba aprobada, los plazos calculados y los aplicados.

## 3. Escalamiento

**Niveles por plazo**, valores configurables en `notification_settings`. Cada caso abierto tiene un plazo vigente: el de aceptación mientras está asignado, y el de atención una vez aceptado o en atención.

| Paso | Cuándo | A quién |
|---|---|---|
| Recordatorio | al 75 % de la ventana | enlace |
| Escalamiento al enlace | al vencer (+0 h) | enlace |
| Escalamiento al titular | +4 h del SLA | titular |
| Escalamiento a coordinación | +24 h del SLA | coordinación |

Las horas posteriores al vencimiento también siguen el calendario del SLA.

**Destinatarios.** Salen sólo de la configuración verificada, nunca de texto libre ni del modelo:
- **Enlace:** la persona responsable del caso, si sigue en esa dependencia; si no, el enlace de la dependencia (`departments.responsible_user_id`).
- **Titular:** `departments.head_user_id`, columna nueva, validada como en la etapa 4: un miembro de esa dependencia, o de Administración o Comunicación.
- **Coordinación:** la persona que coordina el caso, si sigue siendo admin o comunicación; si no, el contacto de escalamiento del municipio.

Sin persona configurada, el paso queda como `no_recipient` y no se envía a nadie más.

**Eventos** (`notification_events`, de sólo agregar):
- Cada paso registra tipo, nivel, caso, fase, ciclo, plazo, motivo («C-00007: el plazo de aceptación venció el … se escala al titular»), destinatario y resultado (`queued`, `no_recipient`, `no_channel`).
- Una clave única por caso, ciclo, fase, plazo y nivel evita duplicados, aunque dos crons corran a la vez.
- Al reasignar con otro plazo, o al reabrir (nuevo ciclo), los pasos empiezan de nuevo.
- Plazos vencidos hace más de 7 días no se escalan, para evitar ráfagas tras una caída.

**Tipos:**
- **Recordatorio:** antes de vencer.
- **Escalamiento:** después de vencer.
- **Emergencia:** caso de prioridad crítica o con mención de gravedad de emergencia. Sale como **crítico**, ignora el horario de silencio, el límite por hora y los canales que la persona haya desactivado.

**Canales:**
- Correo verificado de la persona.
- WhatsApp sólo si el contacto está activo **y** el admin lo habilitó (requiere aprobar en Meta la plantilla `sigma_caso_aviso`).

## 4. Outbox durable

**`outbox`**: un mensaje lógico por `idempotency_key` (`alert:<evento>:email:<correo>`, `event:<id>:whatsapp`, `report:<id>:job-<id>:<correo>`…).
- Estados: `pending`, `sending`, `sent`, `dead`, `uncertain`, `cancelled`.
- Campos de control: intentos y máximo (6), siguiente intento, lease (dueño y vencimiento), motivo de espera, `provider_message_id` y último error.

**`outbox_attempts`**: una fila por intento, con trabajador, inicio, fin, resultado (`sent`, `retry`, `dead`, `uncertain`, `lost`), id del proveedor y error. Un intento terminado ya no se modifica.

**Funciones:**
- **`claim_outbox(trabajador, límite, lease)`**:
  - toma primero los críticos, con `skip locked`;
  - si el lease de otro trabajador ya venció, ese trabajador desapareció a medio envío:
    - **correo:** se reintenta. Resend recibe la misma clave en `Idempotency-Key` y devuelve el mismo mensaje sin volver a entregarlo;
    - **WhatsApp:** no tiene clave de idempotencia, así que queda **incierto** para que una persona decida. Nunca hay un segundo envío silencioso.
- **`complete_outbox(id, trabajador, intento, …)`**:
  - está vallado por trabajador e intento: un trabajador que perdió el lease no puede pisar un intento más nuevo;
  - backoff de 1, 2, 4… minutos, con tope de 6 h;
  - los errores 4xx que no son 409/429 no se reintentan (dirección inválida).
- **`retry_outbox(id)`**: sólo admin, para un envío fallido, incierto o cancelado. Queda en la bitácora.

**Saturación** (sólo mensajes normales; los críticos y los reportes nunca esperan):
- Horario de silencio del municipio (22 a 7) o el de la persona: el mensaje espera al final, no se pierde.
- Límite por persona, canal y hora (6): el resto espera 15 minutos.
- Canal desactivado por la persona: se cancela con ese motivo y se ve en Envíos.

**Quién envía:**
- El cron de clasificación, cada 5 min, envía las alertas recién disparadas.
- El cron nuevo `/api/cron/notify`, cada 5 min, evalúa los escalamientos, retoma reportes y envía la cola dentro de su presupuesto de tiempo.
- `settleAlerts` refleja el resultado en `alert_events.notifications`, que /alertas muestra como «en cola», «enviado» o «falló».

**Configuración → Envíos (admin):**
- conteos por estado;
- últimos envíos con dirección enmascarada, intentos, id del proveedor, motivo de espera y error, más el botón «Reintentar»;
- trabajos de reportes;
- avisos de casos.

## 5. Reportes programados como trabajos

**`report_jobs`**:
- `unique (org, tipo, inicio, fin)`;
- copia de destinatarios y autoaprobación al encolar;
- etapa, reporte, intentos, lease y último error.
- `report_job_events` registra cada paso.
- Además, `reports.job_id` es único: un trabajo nunca tiene dos reportes. Si un proceso guardó el borrador y murió antes de registrarlo, el reintento lo encuentra en vez de generar otro.

**Etapas:**
1. `queued` → `drafted` (IA).
2. Sin autoaprobación, el trabajo termina en `awaiting_approval` y una persona aprueba en /reportes.
3. Con autoaprobación configurada expresamente: `approved` → `rendered` (PDF en Storage) → `sending` (correos encolados en el outbox).
4. `done` sólo cuando el proveedor aceptó **todos** los correos. Si alguno no se entregará, el trabajo pasa a `failed`.

Un fallo de la IA, de Storage o del correo conserva la etapa y se reintenta con backoff (5, 10, 20… min) hasta 5 veces; después el trabajo queda `failed` y visible.

**Límites por corrida:** 3 trabajos y 200 s en el cron diario; 2 trabajos y 50 s en el de notify. Al acabarse el tiempo, el trabajo se libera en la etapa guardada y la siguiente corrida lo retoma.

**Aprobación humana por defecto.** `auto_approve` sigue siendo falso por omisión, y el trabajo copia el valor de la programación al encolarse.

## 6. Pruebas

Todas con simuladores (Anthropic, Resend y WhatsApp en `e2e/mock-anthropic.mjs`) y datos ficticios.

**pgTAP:**
- `sla_calendar` (27): calendario, inhábiles, zona, categorías, versiones y asignación.
- `outbox` (33): idempotencia, lease entre dos trabajadores, vallado, backoff, registro por intento, trabajador caído (correo y WhatsApp), silencio, límite, preferencias, críticos y permisos.
- `escalations` (21): niveles en tiempo fijo, no duplicar, ejecuciones repetidas, destinatarios de configuración, emergencia, permisos.
- `report_jobs` (16): dos crons, un trabajo, un reporte; fallo de IA; lease vencido; reanudación.
- Ajuste a `rls_matrix`.

**Unitarias:**
- `outbox/dispatch`: aceptado por el proveedor pero no registrado, y el reintento no duplica la entrega (doble de Resend con `Idempotency-Key`); presupuesto y límites.
- `reports/jobs`: etapas, fallos de IA y Storage, correo fallido, sin tiempo.
- `sla/model`.

**e2e `delivery.spec.ts`:**
- Configurar horas hábiles con un día inhábil, aprobar la versión y asignar con el SLA.
- **Dos crons de reportes a la vez** generan un solo reporte; con Resend caído una vez, el correo se reintenta y llega **una sola vez** con el PDF.
- Un caso vencido escala una sola vez aunque el cron corra en paralelo; en horario de silencio el normal espera y la **emergencia sale**.
- Preferencias por persona.

## 7. Archivos

- **Migración:** `supabase/migrations/20261031000000_sla_outbox.sql` y `docs/rollback/20261031000000_sla_outbox.down.sql`.
- **Envíos:** `src/lib/outbox/{render,providers,dispatch,server}.ts` y `src/app/api/cron/notify/route.ts`.
- **Reportes:** `src/lib/reports/{jobs,schedule,deliver,actions,data}.ts` y `src/app/api/cron/reports/route.ts`.
- **Alertas:** `src/lib/alerts/evaluate.ts` (encola) y `src/app/api/cron/classify/route.ts`. Se retiró `src/lib/whatsapp/alerts.ts`.
- **SLA:**
  - `src/lib/sla/{model,actions,data}.ts`;
  - `src/components/sla/*`;
  - páginas `configuracion/sla`, `configuracion/envios` y `preferencias` (menú de usuario → «Mis avisos»).
- **Casos:** `assign_case`, el diálogo de asignación y la ficha muestran la versión del SLA.
- **Configuración:**
  - la pestaña «WhatsApp y SLA» pasa a ser «WhatsApp» (el SLA tiene su página);
  - se retiró `SlaForm`;
  - `vercel.json` agrega `/api/cron/notify` cada 5 min.

## 8. Activación y reversión

**Activar:**
1. Correr la migración en preview y producción **antes** del deploy.
2. Desplegar.
3. En Configuración → SLA y escalamiento, revisar el calendario y los plazos, nombrar enlaces y titulares y, cuando haya acuerdo, aprobar la versión.
4. Para avisos de casos por WhatsApp, pedir a Meta la plantilla `sigma_caso_aviso` (5 parámetros: tipo, folio, título, motivo, enlace) y luego activarla.

No hay variables nuevas: el correo usa `RESEND_API_KEY` y `ALERTS_FROM_EMAIL` / `REPORTS_FROM_EMAIL`.

**Revertir:**
1. Revertir el commit.
2. Correr el `down.sql` (los `copy` para exportar están al inicio del archivo). Restaura `assign_case` de la etapa 6 y el seguimiento de turnos por WhatsApp.

Los mensajes que sigan en cola no se envían después de revertir.

La reversión, la reaplicación y la repetición de la siembra se probaron en local, con pgTAP completo después.

## 9. Limitaciones

- **WhatsApp sin idempotencia del proveedor:** un envío con resultado desconocido queda «incierto» y requiere que una persona lo reintente; se prefiere eso a duplicar.
- **Plantilla de casos:** WhatsApp para avisos de casos queda apagado hasta tener `sigma_caso_aviso` aprobada; mientras tanto se usa correo.
- **Zona horaria:** fija en `America/Mexico_City`; no hay soporte multizona.
- **Inhábiles:** se capturan a mano; no hay calendario oficial importado.
- **Límite por hora:** se cuenta por dirección y canal; no hay un tope global por municipio.
- **Reportes semanales y mensuales:** siguen generándose sólo el día en que vencen (lunes o día 1). Si ese día el cron no corre, el periodo no se encola después.
- **Avisos de turnos:** los turnos de menciones sueltas siguen con el seguimiento por WhatsApp anterior (sin outbox).
