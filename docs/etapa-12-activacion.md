# Etapa 12 — Instrucciones de activación

Cómo llevar lo validado en la etapa 12 a preview (staging) y después a producción, con respaldo, observabilidad,
activación gradual y reversión. Nada de esto se ejecutó en esta etapa: aquí no se despliega ni se envía a
destinatarios reales. Las llaves se manejan sólo en los paneles de Vercel, Supabase, Anthropic, Resend y Meta,
nunca por chat ni correo.

Instancias:

| Instancia | Supabase | App | Uso |
|---|---|---|---|
| Local | Docker (`npx supabase start`) | `next start` | pruebas de esta etapa |
| Staging | proyecto de preview | despliegue de preview de Vercel | ensayo con datos ficticios |
| Producción | proyecto de producción | dominio de producción | piloto |

En los despliegues de preview los crons responden «sólo corren en producción» (`cronDisabledHere`), por diseño.
Para ejercitar los workers contra la base de staging se corre la app localmente apuntando al proyecto de preview,
con el simulador para correo y WhatsApp (§ 1, paso 6).

## 1. Checklist de staging

Marcar cada punto con fecha y responsable en la bitácora del piloto.

1. **Migración.**
   - Correr en preview el SQL de `20261105000000_rls_scale.sql` (archivo entregado aparte, con `begin/commit` y
     registro en `schema_migrations`).
   - Verificar, sólo lectura:

     ```sql
     select count(*) from pg_policies
     where tablename = 'mentions' and qual like '%read_all_org_ids%';
     ```

     Debe dar 1.
2. **CI sobre preview.** El job `e2e-preview` del PR debe quedar en verde después de aplicar la migración.
3. **Recorrido con enlace mágico real** en el preview:
   - con una cuenta de prueba del equipo (no de ciudadanos ni funcionarios ajenos al piloto);
   - de la fuente al PDF, igual que `e2e/journey.spec.ts`;
   - anotar el tiempo de cada paso.
4. **Permisos por rol.** Con las cuentas de prueba de los 4 roles:
   - abrir un caso ajeno por URL;
   - intentar una exportación no permitida;
   - descargar evidencia ajena.

   Todo debe negar (404 o 403).
5. **Volumen.** En preview, `explain analyze` de la consulta de la bandeja como Comunicación (sólo lectura), con el
   volumen que tenga. No cargar `map_scale.sql` en preview: es sólo para local.
6. **Workers contra staging.**
   - `next start` local con las variables del proyecto de preview y la llave de **evaluación** de Anthropic;
   - `RESEND_BASE_URL` y `WHATSAPP_API_URL` apuntando al simulador;
   - `curl` a `/api/cron/ingest`, `/classify` y `/notify` con `CRON_SECRET`;
   - revisar Salud: frescura, cola y huecos.
7. **Evaluación de IA.**
   - `npm run eval:classify -- --holdout` con la llave de evaluación;
   - guardar el JSON y la hoja de revisión;
   - entregar la hoja a dos personas de Comunicación.
8. **Restauración.**
   - Descargar el respaldo más reciente del proyecto de preview (Database → Backups) o hacer
     `pg_dump -Fc "$PREVIEW_DB_URL"`;
   - restaurarlo en un proyecto o base desechable;
   - comparar los conteos de `menciones`, `casos`, `audit_log` y `schema_migrations`.
9. **Accesibilidad no automatizada.**
   - lector de pantalla (NVDA o VoiceOver) en acceso, bandeja y detalle de caso;
   - zoom al 200 %;
   - «reducir movimiento» del sistema.
10. **Observabilidad.** Provocar un error controlado (fuente con URL inválida en staging) y confirmar que:
    - aparece en Salud;
    - genera la alerta `monitor_health`;
    - si `ERROR_WEBHOOK_URL` está configurado, llega al canal del equipo.

## 2. Respaldos y restauración

- **Base de datos:**
  - Supabase guarda respaldos diarios del proyecto; con PITR (si el plan lo incluye) se restaura a un minuto exacto.
  - **Antes de cada migración**: `pg_dump -Fc` de producción a un almacenamiento del municipio con acceso
    restringido.
  - Probado en local (informe § 6.3): 13 MB y 2 s con 107 000 menciones, restauración de 6 s con conteos idénticos.
- **Storage** (evidencias, PDF de reportes, logotipo): no viaja en `pg_dump`.
  - Respaldo mensual del bucket `case-evidence` y `reports` con la CLI de Supabase o la API de Storage, a un
    almacenamiento del municipio.
  - Las evidencias son fotos de trabajos, sin datos de terceros visibles por política (manual § 4).
- **Restauración** (incidente o error de datos):
  1. Pausar los crons: en Vercel, desplegar con `vercel.json` sin crons, o pausar las fuentes y la depuración desde
     Configuración.
  2. Restaurar en un proyecto **nuevo**.
  3. Verificar los conteos.
  4. Cambiar las variables de la app al proyecto restaurado y redesplegar.
  5. Reanudar los crons.
  6. Registrar el incidente (manual § 7.2).
- **Retención:** la depuración diaria nunca borra menciones de casos ni conservadas. Antes del piloto, registrar
  la política con el acuerdo del municipio.

## 3. Observabilidad

| Señal | Dónde | Umbral de atención |
|---|---|---|
| Fuentes atrasadas, fallando o con hueco | Salud; alerta `monitor_health` | 3 errores seguidos o sin éxito en `stale_after_minutes` |
| Cola de clasificación y menciones fallidas | Salud; `worker_runs`; `pipeline_failures` | pendientes > 1 h o fallidas > 0 |
| Envíos (correo y WhatsApp) | Configuración → Envíos (`outbox`) | `dead` o `uncertain` > 0 |
| Consumo y límites de IA | Configuración → Consumo de IA | 80 % del presupuesto; costo desconocido > 0 |
| Errores de la app | `ERROR_WEBHOOK_URL` (canal del equipo); logs de Vercel | cualquiera nuevo |
| Métricas del piloto | `supabase/pilot/pilot_metrics.sql` (sólo lectura) | ver piloto § 4 |
| Bitácora | Configuración → Bitácora | cambios de configuración no anunciados |

Línea base de producción (13 oct 2026, sólo lectura, 7 días):

- 7/7 fuentes activas leyeron;
- 23 errores de ingesta, 19 de ellos de Reddit (HTTP 429), y 1 fuente sin éxito reciente;
- 0 menciones pendientes o fallidas;
- 1 aviso enviado y 0 fallidos;
- 4 llamadas de IA por US$0.07;
- 8 revisiones pendientes.

## 4. Activación gradual

Cada paso dura lo indicado y sólo avanza si las métricas del piloto (§ 4 del plan) están en verde.

| Paso | Qué se activa | Quién | Duración mínima |
|---|---|---|---|
| 0 | Migración `rls_scale` en preview y luego en producción; despliegue del código de la etapa 12 | Administración técnica | — |
| 1 | Sólo lectura: Comunicación y Consulta usan bandeja, dashboard y mapa; sin turnar | Comunicación | 3 días hábiles |
| 2 | Casos y turnos a **dos** dependencias del piloto, sólo por la app (sin WhatsApp) | Comunicación + 2 enlaces | 1 semana |
| 3 | Avisos por correo a esas dependencias; WhatsApp sólo a sus enlaces | Administración | 1 semana |
| 4 | Reportes semanales a destinatarios internos aprobados | Comunicación | 2 ciclos |
| 5 | Resto de dependencias, una por semana | Coordinación | según avance |

Interruptores que existen hoy (sin código nuevo):

- **Fuentes:** activar o pausar cada una.
- **IA:** límites y presupuesto por municipio.
- **Escalamiento y silencio:** `notification_settings`.
- **WhatsApp:** por dependencia y responsable.
- **Reportes:** programación y destinatarios de `report_schedules`; `auto_approve` apagado en el piloto.
- **Retención:** pausa de la depuración.

## 5. Migraciones y backfill

| Migración | Tipo | Backfill | Verificación |
|---|---|---|---|
| `20261105000000_rls_scale.sql` | 2 funciones privadas y 5 políticas de lectura reemplazadas | ninguno | pgTAP `rls_scale` (39); consulta del § 1.1 |

Orden:

1. Respaldo (§ 2).
2. Preview.
3. CI verde.
4. Producción en horario de baja actividad.
5. Verificación de sólo lectura.
6. Despliegue de la app.

La migración es aditiva y repetible (`create or replace`, `drop policy if exists`). No bloquea tablas más de lo
que tarda reemplazar una política (milisegundos).

## 6. Reversión

| Qué revertir | Cómo | Efecto |
|---|---|---|
| Código de la etapa 12 | Redesplegar el despliegue anterior en Vercel | Vuelve la 404 en inglés y los tonos anteriores; las pruebas no afectan producción |
| Migración `rls_scale` | `docs/rollback/20261105000000_rls_scale.down.sql` | Vuelven las políticas por fila: misma visibilidad, lentas con volumen alto |
| Un paso de la activación gradual | Apagar el interruptor del § 4 | Inmediato; lo pendiente queda en cola, no se pierde |
| Datos | Restauración del § 2 | Proyecto nuevo y cambio de variables |

El orden de reversión es el inverso al de activación: primero la app, después el SQL.
