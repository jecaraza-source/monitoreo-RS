# Etapa 10 — Cuotas y presupuesto de IA, costos versionados, asistente cancelable y autores verificados

Base: `27137bd` (etapa 9 integrada). Migración `20261103000000_ai_governance.sql`.

## 1. Qué ya estaba resuelto y se conserva

- **Registro de consumo:** `ai_usage` por día, modelo y propósito, escrito sólo por el servidor y leído por
  administración y comunicación.
- **Asistente:**
  - límite de 20 solicitudes por minuto por persona (`rate_limit_hit`);
  - historial recortado a 20 turnos, hasta 6 rondas de herramientas;
  - herramientas de sólo lectura con la sesión de la persona (RLS).
- **Tarifas:** precios de lista de octubre de 2026, contrastados con la documentación oficial.
- **Lectura del día:** caché de una hora en `daily_readings`.
- **Rankings, narrativa, alertas, herramientas del asistente y cola de revisión:** sólo nombran autores con
  `kind in (media, public_figure)`.

Todo eso sigue igual. Cambia lo siguiente.

## 2. Qué se corrigió

| Problema | Antes | Ahora |
|---|---|---|
| Cuotas | Sólo 20/min por persona en el asistente; nada para clasificación, reportes ni la lectura del día | Reserva atómica por organización antes de cada llamada: concurrencia por propósito, solicitudes por persona y día, presupuesto diario/mensual en US$ y tokens por día |
| Concurrencia | Peticiones simultáneas podían rebasar cualquier límite | `reserve_ai` serializa por organización con `pg_advisory_xact_lock`: cada reserva ve las anteriores en curso |
| Costo de modelos sin tarifa | Se guardaba como 0 (`costUsd ?? 0`) | Estado «costo desconocido»: `cost_usd` null en `ai_calls`; contadores `unpriced_requests` y `unpriced_tokens` en `ai_usage`; en pantalla «Costo desconocido» con sus tokens |
| Consumo del asistente | Si una ronda posterior fallaba, se perdía lo consumido en las anteriores | Cada llamada se concilia al terminar, incluida la parcial de un flujo cortado |
| Cancelación | Cerrar el chat no detenía al proveedor | La señal de la petición y un tope de 100 s llegan al stream del SDK; no empiezan más rondas ni herramientas |
| Lectura del día | Se coordinaba con un `Map` en memoria (una instancia) | Lease persistido en `ai_leases` (todas las instancias) más el `Map` local |
| Autores de YouTube | Todo canal de una búsqueda abierta quedaba como «medio» | Sólo el canal configurado por ID es medio; los demás son cuentas no verificadas |
| Identidad de no verificados | Se guardaban usuario, nombre y seguidores | Seudónimo estable (`nv_` + SHA-256 con sal secreta por municipio), sin nombre ni seguidores |

## 3. Cuotas y presupuesto

- **Flujo de cada llamada** (`src/lib/ai/meter.ts`, en `ledger.ts` contra Postgres):
  1. Se estima un techo: todo el prompt como entrada sin caché más `max_tokens`, con la tarifa vigente.
  2. `reserve_ai` comprueba, en este orden, y responde en español:
     - concurrencia del propósito;
     - cuota de la persona;
     - modelo sin tarifa con presupuesto en dólares;
     - presupuesto diario y mensual (consumido + en curso + estimado);
     - tokens del día.
  3. Se llama al proveedor.
  4. `settle_ai` registra el consumo real, el costo o «desconocido» y la versión de tarifa. Si la llamada falló
     sin consumo, `release_ai` libera la reserva.
- **Límites por organización** (`ai_limits`):
  - sin fila valen los predeterminados: concurrencia clasificación 2, reportes 2, asistente 6, lectura 1;
    300 solicitudes por persona al día; sin presupuesto;
  - sólo administración los cambia: la política RLS exige `updated_by = auth.uid()`.
- **Reservas huérfanas:** las de un proceso caído vencen (TTL de 30 a 900 s) y dejan de ocupar capacidad. Una
  llamada que terminó después de vencer su reserva igual se concilia.
- **Llamada sin tarifa:** con presupuesto en dólares y sin límite de tokens, no se autoriza, porque su costo
  no se puede comparar. Con límite de tokens se autoriza y cuenta en tokens.
- **Quién queda sujeto:**
  - clasificación (cron): una organización que llega a su límite libera sus menciones sin gastar intento y
    las demás siguen;
  - reportes: cuota de quien los genera, o ninguna si los genera el cron;
  - asistente: cuota de la persona;
  - lectura del día: límites de la organización, sin cuota de persona.

## 4. Tarifas versionadas y conciliación

- **`src/lib/ai/pricing.ts`:**
  - `TARIFFS` lleva versión, vigencia y fuente. Para cambiar precios se agrega una versión nueva; nunca se
    edita una anterior.
  - `normalizeModelId` reconoce sufijos de fecha (`-20261001`, `@20261001`), `-latest`, ventana de contexto
    (`[1m]`) y prefijos de proveedor.
  - Haiku 5.5 con más de 100 000 tokens de prompt usa la tarifa larga publicada. Si además usó caché, el costo
    es desconocido, porque esa tarifa de caché no está publicada y no se inventa.
- **Backfill:** las filas de `ai_usage` con costo 0 y tokens pasan a `unpriced_*`, porque toda tarifa es mayor
  que 0. Se puede repetir.
- **Panel Configuración → Consumo de IA** (administración y comunicación leen; sólo administración edita):
  - hoy y el mes, con su presupuesto y % usado;
  - desglose por uso y modelo con tokens y versión de tarifa;
  - aviso «Tarifa no configurada»;
  - llamadas en curso y reservas vencidas;
  - límites;
  - conciliación con la factura de cada mes: conciliado ±5 %, diferencia, sin factura, o estimado incompleto
    si el mes tuvo costo desconocido.

## 5. Asistente

- **Cancelación:**
  - `AbortSignal.any([request.signal, timeout de 100 s])` se pasa a `client.beta.messages.stream(params, { signal })`;
  - `runAssistant` revisa la señal antes de cada ronda y de cada herramienta;
  - si la persona cerró el chat no se escribe nada más; si se agotó el tiempo, se avisa.
- **Contabilidad:** cada ronda se concilia al terminar. Un flujo cortado concilia lo que ya había consumido
  (la entrada se cobra desde el inicio); una llamada que no produjo consumo libera la reserva.
- **Sin cambios:** historial de 20 turnos, 6 rondas y herramientas de sólo lectura.

## 6. Catálogo de autores verificados y privacidad

- **`verified_authors`:**
  - plataforma, cuenta, tipo (medio o figura pública), nombre público;
  - evidencia obligatoria (10 caracteres o más) con enlace https opcional;
  - responsable y fecha tomados de la sesión;
  - revocación con motivo, persona y fecha.
- **Permisos:**
  - alta y revocación sólo con `verify_author` y `revoke_author` (administración y comunicación);
  - lectura y dependencia no pueden.
- **Cómo se decide en la ingesta** (`upsert_authors`):
  1. si está en el catálogo, es verificado;
  2. si no, el medio, página o canal que lee una fuente configurada (host RSS, página de Meta, canal de YouTube
     por ID) queda verificado por esa fuente (`vouching_source_id`);
  3. todo lo demás queda como seudónimo, sin nombre ni seguidores.
- **Restricciones en base de datos:**
  - verificado ⇔ medio o figura pública;
  - no verificado ⇒ sin nombre, sin seguidores y con cuenta `nv_…`.
- **Alta y revocación aplicadas a los registros:**
  - al verificar una cuenta, su fila seudónima se convierte en la del autor verificado (mismo `id`) y sus
    menciones conservan el vínculo;
  - al revocar, vuelve a seudónimo.
  - Todo queda en `author_events` (que nunca guarda la cuenta) y en `audit_log`.
- **Dónde se aplica la política:**
  - rankings (`dashboard_stats`, `report_context`);
  - narrativa y lectura del día (sólo nombres de medios o figuras);
  - clasificador: una cuenta no verificada se describe como «publicación ciudadana», sin seudónimo;
  - herramientas del asistente;
  - bandeja, casos y «menciones con más alcance»: «Cuenta no verificada»;
  - filtro por autor de la bandeja: sólo cuentas verificadas;
  - exportaciones: el CSV por dependencia no lleva autores y el PDF sale de los hechos del reporte.
- **Sin cruces:**
  - la página del catálogo sólo muestra conteos agregados de cuentas no verificadas, sin lista ni búsqueda;
  - la sal está en `private.author_salts`, que la API no alcanza.

## 7. Backfill de autores existentes (repetible)

1. Autores RSS o Meta con tipo medio o figura, y canales de YouTube configurados por ID: quedan verificados por
   fuente. Se registra un evento `vouched`.
2. El resto de las cuentas no verificadas se convierten en seudónimo con `private.pseudonymize_author`: se
   conservan `id` y menciones, se borran nombre y seguidores y se registra un evento `pseudonymized`.

Consulta previa, sólo de lectura (13 oct 2026):

- **Producción:**
  - 40 cuentas ciudadanas;
  - medios: 3 RSS, 1 Meta, 1 X, 1 YouTube (`tvregional`, no configurado: el canal configurado es otro);
  - figuras públicas: 1 Meta, 1 X.
- **Preview:** la misma forma, con 30 cuentas ciudadanas.

Efecto: el medio de X, la figura pública de X y el canal de YouTube no configurado pasan a «Cuenta no
verificada» y salen de los rankings. Para devolverlos, se dan de alta en el catálogo con su misma cuenta
(`noticiasvalle`, `regidora_ejemplo`, `tvregional`): el seudónimo se recalcula con esa cuenta y la fila se
recupera con sus menciones.

## 8. Archivos

- **Migración y reversión:**
  - `supabase/migrations/20261103000000_ai_governance.sql`;
  - `docs/rollback/20261103000000_ai_governance.down.sql`.
- **IA:**
  - nuevos: `src/lib/ai/meter.ts`, `src/lib/ai/ledger.ts`;
  - modificados: `src/lib/ai/{pricing, classifier, classify, narrative, assistant}.ts`,
    `src/app/api/asistente/route.ts`, `src/lib/reports/{data, daily-reading}.ts`.
- **Panel de consumo:**
  - `src/lib/ai-usage/{model, data, actions}.ts`;
  - `src/components/ai-usage/*`;
  - `src/app/(app)/configuracion/consumo/page.tsx`.
- **Autores:**
  - `src/lib/authors/{label, data, actions}.ts`;
  - `src/components/authors/*`;
  - `src/app/(app)/configuracion/autores/page.tsx`.
- **Conectores e ingesta:** `src/lib/connectors/{types, rss, meta, youtube}.ts` y `src/lib/ingest/run.ts`.
- **Interfaz:**
  - `src/components/inbox/{mention-card, detail-panel}.tsx`, `src/components/cases/case-mentions.tsx`;
  - `src/lib/cases/data.ts`, `src/lib/inbox/query.ts`, `src/lib/dashboard/model.ts`;
  - `src/lib/auth/roles.ts`.
- **Seed:** `supabase/seed.sql`, con catálogo ficticio y ciudadanos en seudónimo.
- **Pruebas:**
  - unitarias: `src/lib/ai/{pricing, meter}.test.ts`, `src/lib/ai-usage/model.test.ts`,
    `src/lib/authors/label.test.ts`; ajustes en `classifier`, `youtube`, `rss`, `dashboard/model` y
    `auth/roles`;
  - pgTAP: `ai_governance.test.sql` (41) y `verified_authors.test.sql` (32); ajustes en `rls_matrix` y
    `map_cases` (este último tomaba al azar una mención pendiente del seed);
  - e2e: `e2e/ai-governance.spec.ts` (5); `e2e/whatsapp.spec.ts` dejó de depender del orden aleatorio de turnos
    del seed.

## 9. Limitaciones

- **Llamadas canceladas:** si se cancela antes de que el proveedor confirme el inicio, no hay consumo que
  conciliar y la reserva se libera. El proveedor podría cobrar algo de entrada; la conciliación mensual con la
  factura lo absorbe.
- **Estimación:** el techo (3 caracteres por token) es deliberadamente alto. Con un presupuesto muy justo, una
  llamada puede negarse aunque su costo real cupiera.
- **Tarifas:** viven en código. Agregar un modelo nuevo requiere un commit; mientras tanto, el panel lo avisa y
  su costo es desconocido.
- **Autores:**
  - las identidades seudonimizadas por el backfill no se pueden recuperar sin conocer la cuenta, por diseño;
  - la verificación es manual (evidencia documentada); no hay detección automática de medios.
- **Cola de revisión:** sigue mostrando los nombres que ya se guardaban; a partir de esta etapa sólo los de
  autores verificados.

## 10. Activación y reversión

- **Activación:**
  1. Aplicar la migración en preview y en producción (SQL entregado aparte).
  2. Desplegar.
  3. Opcional: definir límites en Configuración → Consumo de IA y volver a verificar en el catálogo los medios
     que interesen.
- **Reversión:**
  1. Desplegar la versión anterior.
  2. Correr `docs/rollback/20261103000000_ai_governance.down.sql`.
  3. Lo que no regresa: las identidades seudonimizadas, que no se guardaron por diseño.
