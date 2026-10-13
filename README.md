# Sigma Pulso · Monitoreo Municipal

Plataforma de escucha social para un gobierno municipal de México: recolecta menciones públicas, las
clasifica con Claude, las turna a las dependencias, genera alertas, dashboards, reportes y un asistente.
Ver `CLAUDE.md` para el stack, las convenciones y los límites éticos.

- [Instalación local](#instalación-local)
- [Variables de entorno](#variables-de-entorno)
- [Despliegue](#despliegue)
- [Costo mensual estimado de IA](#costo-mensual-estimado-de-ia)
- [Seguridad](#seguridad)

## Instalación local

Requisitos: Node 24 (el runtime de producción y de CI), Docker y Git.

```bash
npm ci
npx supabase start            # Postgres, Auth, Storage, Realtime y Mailpit en Docker
npm run db:reset              # migraciones + municipio ficticio (supabase/seed.sql)
cp .env.example .env.local    # llena los valores (ver la tabla de abajo)
npx supabase status -o env    # muestra API_URL, PUBLISHABLE_KEY y SECRET_KEY locales
npm run dev                   # http://localhost:3000
```

- Usuarios del seed: `admin@`, `comunicacion@`, `obras@`, `agua@` y `lectura@monitoreo.test`. Se entra con
  enlace de acceso; los correos llegan a Mailpit (http://127.0.0.1:54324). Un segundo municipio ficticio
  (*Municipio de Prueba B*) con `admin@`, `comunicacion@`, `servicios@` (dependencia) y `lectura@municipio-b.test`
  sirve para probar el aislamiento entre municipios.
- Sin llaves de Claude ni Resend: `node e2e/mock-anthropic.mjs` y arranca la app con
  `ANTHROPIC_API_KEY=mock ANTHROPIC_BASE_URL=http://127.0.0.1:4010 RESEND_API_KEY=re_mock RESEND_BASE_URL=http://127.0.0.1:4010`.
  El simulador puede inyectar fallas para probar reintentos y costos: `POST /__mock/faults` (ver su encabezado).
- Línea base, matriz de hallazgos y plan por etapas: `docs/etapa-0-linea-base.md`; bitácora: `docs/bitacora.md`.

### Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` / `build` / `start` | Desarrollo, build y servidor de producción |
| `npm run lint` · `npm run typecheck` | ESLint y TypeScript |
| `npm test` | Pruebas unitarias y de seguridad estática (`node --test`, `src/**/*.test.ts`) |
| `npm run test:db` | Pruebas pgTAP: RLS por rol, bitácora, retención, reportes (`supabase/tests`) |
| `npm run test:e2e` | Playwright: login, bandeja, turnado y reporte (`e2e/`) |
| `npm run check:bundle` | Verifica que ningún secreto llegue al bundle del navegador (después de `build`) |
| `npm run ai:cost` | Costo de IA de los últimos 7 días y proyección a 30 (lee `ai_usage`) |
| `npm run eval:classify` | Precisión del clasificador: 30 menciones de desarrollo, o `-- --holdout` para las 48 de validación (usa la API de Claude) |
| `npm run db:reset` · `npm run db:types` | Recrea la base local · regenera los tipos de Supabase |
| `supabase db push` | Aplica `supabase/migrations` al proyecto remoto enlazado |

Para correr el e2e en local: con la app y `e2e/mock-anthropic.mjs` arriba,
`E2E_SUPABASE_SERVICE_ROLE_KEY=<SECRET_KEY local> npm run test:e2e` (con Chromium ya instalado:
`PW_CHROMIUM_PATH=/ruta/a/chrome`).

## Variables de entorno

Se documentan en `.env.example`. Las marcadas como **secreto** sólo existen en el servidor (en Vercel,
tipo *Sensitive*); el build de CI comprueba que ninguna aparezca en el bundle del navegador.

| Variable | Tipo | Para qué |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | pública | URL del proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | pública | Llave publicable (respeta RLS) |
| `NEXT_PUBLIC_SITE_URL` | pública | Dominio de la app (enlaces de correo y alertas) |
| `SUPABASE_SERVICE_ROLE_KEY` | **secreto** | Cron, ingesta, clasificación, PDF y límite de solicitudes |
| `ANTHROPIC_API_KEY` | **secreto** | API de Claude |
| `CLAUDE_MODEL_FAST` | config | Clasificación y Lectura del día (p. ej. `claude-haiku-5-5`) |
| `CLAUDE_MODEL_SMART` | config | Escalamiento, reportes y asistente (p. ej. `claude-opus-5-5`) |
| `CRON_SECRET` | **secreto** | Vercel lo manda como `Authorization: Bearer` a los crons |
| `RESEND_API_KEY` | **secreto** | Correo de alertas y reportes |
| `ALERTS_FROM_EMAIL` · `REPORTS_FROM_EMAIL` | config | Remitentes (dominio verificado en Resend) |
| `META_APP_SECRET` · `META_GRAPH_VERSION` | **secreto** · config | Conector de Facebook/Instagram |
| `YOUTUBE_API_KEY` | **secreto** | Conector de YouTube |
| `RSS_ALLOWED_HOSTS` | config | Opcional: hosts de feeds permitidos (`diario.mx`, `.diario.mx` para subdominios) |
| `WHATSAPP_TOKEN` · `WHATSAPP_PHONE_NUMBER_ID` · `WHATSAPP_TEMPLATE_LANG` | **secreto** · config | Canal de WhatsApp con funcionarios (ver [WhatsApp](#whatsapp)) |
| `WHATSAPP_APP_SECRET` · `WHATSAPP_VERIFY_TOKEN` | **secreto** | Firma y verificación del webhook de WhatsApp (por omisión la firma usa `META_APP_SECRET`) |
| `WHATSAPP_DISPLAY_PHONE` · `WHATSAPP_QUIET_HOURS` | config | Número que se muestra (por omisión +52 56 2133 9211) · horario sin recordatorios ni escalamientos (por omisión `22-7`, hora de CDMX; `off` los envía a cualquier hora) |
| `RETENTION_MONTHS` | config | Meses por omisión para municipios sin política propia (24; valor operativo, no plazo legal) |
| `ERROR_WEBHOOK_URL` | **secreto** | Webhook tipo Slack para avisar errores (opcional) |

Sólo para pruebas: `ANTHROPIC_BASE_URL`, `RESEND_BASE_URL`, `WHATSAPP_API_URL`, `E2E_BASE_URL`, `E2E_SUPABASE_URL`,
`E2E_SUPABASE_SERVICE_ROLE_KEY`, `E2E_WHATSAPP_APP_SECRET`, `E2E_WHATSAPP_PHONE_NUMBER_ID`,
`VERCEL_AUTOMATION_BYPASS_SECRET`, `PW_CHROMIUM_PATH`.

## Despliegue

Vercel (hosting y cron) + Supabase (Postgres, Auth, Storage, Realtime). Dos entornos con **proyectos de
Supabase separados**, para que un preview nunca toque datos reales:

| Entorno | Rama | Supabase | Datos | Crons |
|---|---|---|---|---|
| Production | `main` | proyecto de producción | reales | sí |
| Preview | ramas y PRs | proyecto de preview | `supabase/seed.sql` (ficticio) | no |

Proyectos actuales: producción `monitoreo-municipal` (`dayduaiginbfpohchujl`) y preview `monitoreo-preview`
(`llxskobppithldckfrnj`). En el SQL Editor de Supabase un script largo no respeta `begin/commit`: para
preparar un proyecto nuevo es más seguro `supabase db push` y luego el seed.

1. **Supabase.** Crea los dos proyectos. En cada uno: `supabase link --project-ref <ref>` y
   `supabase db push`; en el de preview carga además `supabase/seed.sql` (SQL Editor). Configura Auth:
   - **URL Configuration:** Site URL = dominio con `https://` y sin `/` final; Redirect URLs =
     `https://<dominio>/**` (en preview, `https://*-<equipo>.vercel.app/**`).
   - **Providers → Email:** desactiva *Allow new users to sign up*.
   - **Email Templates:** copia `supabase/templates/magic_link.html` e `invite.html` (usan
     `{{ .SiteURL }}/auth/confirm?token_hash=…`, así funcionan en cualquier dispositivo).
   - **SMTP:** Resend (`smtp.resend.com`, puerto 465, usuario `resend`); el correo integrado sólo permite
     unos cuantos envíos por hora.
2. **Vercel → Settings → Environment Variables.** Captura cada variable de la tabla para *Production* con
   los valores del proyecto de producción, y otra vez para *Preview* con los del proyecto de preview
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `NEXT_PUBLIC_SITE_URL` cambian; las de Claude y Resend pueden repetirse). Las `NEXT_PUBLIC_*` se fijan
   en el build: tras cambiarlas, *Redeploy*.
3. **Crons** (`vercel.json`): ingesta cada hora, clasificación y alertas cada 5 min, reportes programados
   a las 7:00 (CDMX) y retención a las 3:30 (CDMX). Vercel sólo los ejecuta en *Production*; además cada
   ruta responde `skipped` si `VERCEL_ENV` no es `production`.
4. **e2e en preview** (job `e2e-preview` de CI, al terminar cada despliegue de preview): en GitHub →
   Settings → Secrets and variables → Actions crea `PREVIEW_SUPABASE_URL`,
   `PREVIEW_SUPABASE_SERVICE_ROLE_KEY` (del proyecto de preview) y `VERCEL_AUTOMATION_BYPASS_SECRET`
   (Vercel → Settings → Deployment Protection → Protection Bypass for Automation).
5. **Migraciones:** cada PR que agrega una en `supabase/migrations` se aplica primero en preview y, al
   mergear, en producción (`supabase db push` con el proyecto de producción enlazado).

## Costo mensual estimado de IA

Todo uso queda en `ai_usage` (tokens y costo estimado con precios de lista de `src/lib/ai/pricing.ts`);
`npm run ai:cost` lo resume y proyecta a 30 días con datos reales. Medición en producción con la demo
de Alvarado (octubre de 2026): 97 menciones clasificadas por USD 0.108, es decir, **USD 0.0011 por
mención**. El 94 % lo aporta el escalamiento a `CLAUDE_MODEL_SMART` del 27 % de menciones con prioridad
alta o baja confianza; con Haiku solo serían USD 0.00007 por mención.

| Concepto | Supuesto | USD al mes |
|---|---|---|
| Clasificación | 100 menciones al día | ~3.4 |
| Clasificación | 300 menciones al día | ~10 |
| Clasificación | 1,000 menciones al día | ~34 |
| Reportes | diario + semanal + mensual (~35 al mes, ~USD 0.10 c/u con Opus) | ~3.5 |
| Lectura del día | 1 por hora con Haiku (~USD 0.001 c/u) | ~0.7 |
| Asistente | 20 preguntas al día (~USD 0.10 c/u con Opus, 2–3 rondas) | ~60 |

Ejemplo típico (300 menciones/día, reportes programados y 10 preguntas diarias al asistente):
**~USD 45 al mes**. Las cifras de reportes, lectura y asistente son estimaciones con precios de lista
y tamaños típicos de prompt; se reemplazan por las reales con `npm run ai:cost` tras unas semanas de uso.
Palancas: subir el umbral de escalamiento (`ESCALATE_BELOW_CONFIDENCE`), usar Sonnet como modelo
"smart" o limitar preguntas por usuario.

### Cuotas, presupuesto y tarifas (etapa 10)

- **Antes de cada llamada** a Claude se reserva su costo máximo estimado (`reserve_ai`, atómico por
  municipio), contra:
  - llamadas simultáneas por uso;
  - solicitudes por persona al día;
  - presupuesto diario y mensual en US$;
  - tokens por día.
- **Al terminar** se concilia el consumo real (`settle_ai`). Si un límite se alcanza, la llamada no se hace y
  se explica el motivo en español.
- **Configuración → Consumo de IA** (administración edita; comunicación consulta):
  - consumo de hoy y del mes por uso y modelo;
  - límites;
  - conciliación mensual con la factura del proveedor.
- **Tarifas** versionadas en `src/lib/ai/pricing.ts`, con normalización de identificadores de modelo. Un modelo
  sin tarifa muestra **«Costo desconocido»** con sus tokens: nunca se cuenta como 0. Nunca se inventan precios:
  para un modelo nuevo se agrega una versión de tarifa.
- Detalle: `docs/etapa-10-ia-autores.md`.

## Configuración del municipio, ayuda y operación (etapa 11)

- **Configuración → Resumen:** cada elemento configurable, quién puede cambiarlo y su último cambio (persona y
  fecha). Todo cambio sensible queda en la Bitácora con antes/después.
- **Categorías de caso con capacidades por dependencia** (Catálogos).
- **«Reaplicar SLA»:** la única forma de mover compromisos ya asignados. Es explícita, con motivo, y queda
  registrada por caso.
- **Retención y conciliación:**
  - política por municipio respaldada por un acuerdo (la app no supone plazos legales);
  - conservaciones que bloquean la eliminación;
  - vista previa;
  - exportación CSV auditada de casos, consumo de IA y bitácora.
  - La depuración nunca borra menciones que pertenecen a un caso.
- **Ayuda** (`/ayuda` y botón en Casos): guía por rol, diccionario de estados, matriz de responsabilidades y
  procedimientos.
- **Manuales:**
  - `docs/manual-operativo.md`;
  - `docs/onboarding.md` (lista de puesta en operación, también en Resumen);
  - `docs/ejercicio-operativo.md`.
- Detalle: `docs/etapa-11-configuracion.md`.

## Validación, activación y piloto (etapa 12)

- **Pruebas de punta a punta** (`e2e/journey.spec.ts`): enlace mágico real, cuatro roles, dos municipios, de la
  fuente al PDF.
- **Permisos sin menú** (`e2e/api-permissions.spec.ts`).
- **Fallas inyectadas** (`e2e/resilience.spec.ts`): proveedor, timeout, worker interrumpido, concurrencia,
  corrección humana y Storage.
- **Accesibilidad** (`e2e/accessibility.spec.ts`): contraste AA en ambos temas, móvil, teclado y errores.
- **Mediciones con volumen:** sólo en local, con `supabase/perf/map_scale.sql` cargado:

  ```bash
  PERF=1 npx playwright test e2e/perf-stage12.spec.ts
  ```

  Resultado en `test-results/perf-stage12.json`. Los de la etapa están en
  `docs/evidencia/etapa-12-mediciones.json`.
- **Métricas del piloto** (sólo lectura):

  ```bash
  psql "$DB_URL" -v org=<uuid> -v days=7 -f supabase/pilot/pilot_metrics.sql
  ```
- **Documentos:**
  - `docs/etapa-12-validacion.md` (informe, matriz de cierre y decisión);
  - `docs/etapa-12-activacion.md`;
  - `docs/etapa-12-piloto.md`.

## Seguridad

### Checklist

- [x] **RLS en todas las tablas** de `public`, con pruebas pgTAP por rol (`supabase/tests/database/rls_matrix.test.sql`
      y `rls.test.sql`): anon sin privilegios; comunicación y lectura leen su municipio (lectura sin costos);
      dependencia sólo lo turnado a su dependencia; nadie de otro municipio lee ni modifica filas.
- [x] **Ninguna llave llega al cliente:** variables secretas sólo en servidor, cliente de service role tras
      `server-only`, prueba estática (`src/lib/security.test.ts`) y escaneo del bundle con valores canario en CI
      (`npm run check:bundle`).
- [x] **Rate limit en `/api/*`** desde el proxy, compartido por todas las instancias (`rate_limit_hit` en
      Postgres): asistente 20/min por usuario, errores 30/min, cron 30/min, webhook de WhatsApp 600/min y demás
      60/min por IP; responde 429 con `Retry-After`. El login además tiene el límite de Supabase Auth.
- [x] **Webhook de WhatsApp:** sólo acepta cuerpos firmados por Meta (`X-Hub-Signature-256`, comparación en tiempo
      constante), procesa cada mensaje una sola vez (id único) y a números que no son de funcionarios sólo les
      responde un aviso fijo, sin guardar su número ni su texto.
- [x] **Validación zod en todas las Server Actions** y rutas que reciben datos; una prueba estática falla si
      una Server Action con parámetros no valida su entrada.
- [x] **Bitácora de auditoría** (`audit_log`, Configuración → Bitácora, sólo admin): triggers registran quién
      creó, modificó o eliminó usuarios, catálogos, proyectos, consultas, fuentes, reglas, reportes y turnos
      (con valores anterior y nuevo), y la app registra descargas y envíos de PDF.
- [x] **Retención:** `/api/cron/retention` aplica a diario la política de cada municipio (Configuración →
      Retención, con el acuerdo que la respalda; sin política, `RETENTION_MONTHS`). Nunca borra menciones que
      pertenecen a un caso ni las cubiertas por una conservación, y deja constancia en la bitácora.
- [x] **Monitoreo de errores:** `instrumentation.ts` (`onRequestError`) y los error boundaries guardan los
      errores en `app_errors` sin cabeceras ni secretos y avisan a `ERROR_WEBHOOK_URL`.
- [x] **Pruebas e2e** con Playwright (login, bandeja, turnado, reporte, mapa y WhatsApp) en cada PR contra el
      stack local.
- [x] **e2e en cada preview** de Vercel contra su propio Supabase (`monitoreo-preview`): el job `e2e-preview`
      corre al terminar cada despliegue de preview (9 de 9 en verde).
- [x] **Crons sólo en producción** (Vercel + guardia `VERCEL_ENV` en cada ruta).
- [x] **Entornos separados:** producción usa `monitoreo-municipal` y los previews `monitoreo-preview`, cada uno
      con sus propias llaves en Vercel (*Production* / *Preview*).
- [x] **Datos personales:** sólo contenido público por APIs oficiales o RSS; no se perfila a ciudadanos (los
      análisis de autores se limitan a medios y figuras públicas, y la IA nunca recibe nombres de ciudadanos).
- [x] **Sesiones y acceso:** sólo por invitación, enlaces de un solo uso, RLS como fuente de verdad y cada página
      verifica el rol (`requireSection`).

## Acceso y roles

- Entrada con **magic link** de Supabase (`/login`). El acceso es sólo por invitación:
  el formulario nunca crea cuentas y responde igual exista o no el correo.
- Un **admin** invita desde **Configuración** (correo, rol y, para `dependencia`, su área).
- Cada rol ve sólo su menú y no puede abrir otras secciones (`src/lib/auth/roles.ts`):

  | Rol | Secciones |
  |---|---|
  | admin | Dashboard, Bandeja (con Revisión), Casos, Mapa, Alertas, Reportes, Asistente, Salud, Configuración (Proyectos, Catálogos, Usuarios, Identidad, Emergencias) |
  | comunicacion | Dashboard, Bandeja (con Revisión), Casos, Mapa, Alertas, Reportes, Asistente, Salud, Configuración (sólo Proyectos) |
  | dependencia | Bandeja, Casos, Mapa (sólo la capa de sus casos), Alertas, Asistente (sólo con lo turnado o asignado a su dependencia) |
  | lectura | Dashboard, Casos (sólo consulta), Mapa, Alertas, Reportes, Asistente, Salud (sólo el resumen) |

  Esto controla la navegación; la visibilidad de los datos la impone RLS.

## UI kit

Primitivas en `src/components/ui-kit` (KpiCard, SentimentBadge, ChartCard, EmptyState,
PageTransition), con ejemplos en **`/dev/ui`** (oculto en producción).

Los colores viven en variables CSS en `src/app/globals.css`. Para aplicar la identidad del
municipio basta con cambiar las `--brand-*` (claro y oscuro); los colores de sentimiento
(`--positive`, `--neutral`, `--negative`) son independientes de la marca.

## Proyectos y consultas

En **Configuración → Proyectos** (`/configuracion/proyectos`, alias `/config/proyectos`) se da de alta
cada proyecto con su ficha (objetivo, KPIs, territorio) y sus consultas. El constructor visual arma
grupos que se combinan con AND:

| Grupo | Genera |
|---|---|
| Incluir cualquiera de | `(a OR b OR c)` |
| Incluir todas | `(a AND b)` |
| Excluir | `NOT (a OR b)` |

La expresión resultante usa el lenguaje de `src/lib/query/match.ts`:

- `AND`, `OR`, `NOT` en mayúsculas y paréntesis; términos seguidos equivalen a `AND`.
- `"frase exacta"`: palabras juntas y en orden.
- `educa*`: el comodín completa letras dentro de una palabra.
- No distingue acentos ni mayúsculas, y compara palabras completas (`agua` no coincide con `aguacate`).

Para homónimos se excluye el contexto ajeno, por ejemplo:
`"san andres" AND NOT ("san andres tuxtla" OR "san andres cholula")`.

Cada guardado crea una **versión nueva**. Las anteriores se conservan y pueden volver a cargarse, y cada
mención guarda la versión que la capturó. La vista previa evalúa la consulta contra las 2,000 menciones
más recientes.

**Catálogos** (sólo admin): dependencias, colonias (alta manual, carga de GeoJSON con polígonos hasta
~4 MB, o **traer de OpenStreetMap**) y términos de riesgo. Los nombres no se repiten aunque cambien
acentos o mayúsculas.

*Colonias desde OpenStreetMap*: con el municipio y el estado, el servidor consulta Overpass
(`src/lib/geo/osm.ts`) y muestra la cabecera, colonias, fraccionamientos, pueblos y rancherías con
nombre. En muchos municipios OSM sólo tiene un punto por lugar; para esos se dibuja una **zona
aproximada** (celda de Voronoi entre los lugares, con un radio máximo según el tipo) que se marca
`shape_source = 'osm_approx'` y se ve punteada en el mapa. Al subir después el GeoJSON oficial, las
colonias con el mismo nombre toman su polígono real. Datos © OpenStreetMap (ODbL).

## Ingesta de menciones

Conectores en `src/lib/connectors`, todos con la interfaz `fetchSince(source, since)`, que devuelve
menciones normalizadas sin tocar la base:

| Tipo | Qué lee | Credencial |
|---|---|---|
| `rss` | Feeds RSS 2.0, RSS 1.0 y Atom de medios | — |
| `meta` | Publicaciones y comentarios de páginas oficiales de Facebook (Graph API) | Token de página, guardado en **Supabase Vault**; `META_APP_SECRET` para `appsecret_proof` |
| `youtube` | Videos por búsqueda o canal, y sus comentarios | `YOUTUBE_API_KEY` (cada corrida cuesta unas 101 unidades de 10,000 diarias) |
| `x` | Deshabilitado: requiere plan de pago de la API de X | — |

Los autores de comentarios (ciudadanos) no se guardan; sólo medios y páginas oficiales.

**Autores verificados (etapa 10):**

- Sólo es medio o figura pública:
  - quien está en el catálogo de Configuración → Autores verificados (con evidencia y responsable);
  - o el medio, página o canal que lee una fuente configurada (host RSS, página de Meta, canal de YouTube
    por ID).
- Un canal encontrado por una búsqueda abierta de YouTube **no** es medio.
- Cualquier otra cuenta se guarda como seudónimo (`nv_…`, con sal secreta por municipio), sin nombre ni
  seguidores, y se muestra como «Cuenta no verificada». Cuenta en análisis agregados, nunca en rankings,
  reportes, prompts ni exportaciones con nombre.

Las URL de feeds las escriben los usuarios, así que el conector RSS usa `safe-fetch.ts`: sólo `http(s)`,
sin credenciales en la URL, a direcciones públicas (bloquea loopback, redes privadas, link-local, metadatos
de nube y rangos reservados en IPv4 e IPv6, también dentro de IPv6 mapeado, NAT64 y 6to4). La IP se valida
en la resolución DNS que usa el propio socket (sin ventana para *DNS rebinding*) y en cada redirección (máx. 5).
Toda respuesta se lee en streaming con tope de bytes (5 MB) y se cancela con el timeout de la fuente (25 s).
Por eso el demo `/api/demo/rss` sólo funciona como fuente desde la URL pública de la app, no desde `localhost`.

**Cron:** `vercel.json` programa `/api/cron/ingest` cada hora (requiere plan Pro de Vercel; en Hobby
sólo se permiten crons diarios). La ruta exige `Authorization: Bearer $CRON_SECRET`. En cada corrida:

1. Reserva hasta 12 fuentes activas (`claim_sources`, con *lease* de 2 min: dos corridas no leen la misma
   fuente), empezando por las que llevan más tiempo sin correr, y procesa 3 a la vez (deja de iniciar
   fuentes nuevas a los ~45 s; cada fuente tiene 18 s para pedir páginas y se corta a los 25 s).
2. Lee la **ventana** de la fuente (`src/lib/ingest/coverage.ts`): desde `covered_until` con 15 minutos de
   traslape (3 días la primera vez) hasta ahora. El conector dice si la leyó completa. Si un tope la cortó
   (páginas, tiempo o un error a mitad), lo que faltó queda en el cursor como *backfill* y la siguiente
   corrida lo lee antes de lo nuevo; `covered_until` sólo avanza sobre ventanas completas.
3. Asigna `query_id` con `match.ts`: gana la primera consulta activa que coincida (cada versión de una
   consulta es una fila, así que la mención apunta a la versión exacta). Si la fuente exige coincidencia
   (RSS y YouTube, por defecto), lo que no coincide se descarta.
4. Guarda con `ingest_mentions`: deduplica por `(source_id, external_id)`; una mención conocida que reaparece
   sólo actualiza sus interacciones (último valor observado, `metrics_updated_at`), nunca su texto, consulta
   ni estado.
5. Registra en una transacción (`finish_source_run`) el estado de la fuente y la corrida en `ingest_runs`
   (completa o no, ventana, topes alcanzados, huecos sin recuperar), y los contadores por municipio en
   `worker_runs`. Tras 3 fallos seguidos la fuente espera 1 h, 2 h, 4 h… (hasta 24 h); al 5º pasa a la cola
   **Fallos por revisar**.

| Conector | Paginación y reanudación | Lo que no se puede recuperar (se reporta como hueco) |
|---|---|---|
| RSS | Un feed es sólo sus últimas notas: se lee completo, sin tope de 200. Toma notas fechadas hasta 7 días antes de la ventana (indexación tardía) | Si hasta la nota más vieja del feed es posterior al inicio de la ventana, lo intermedio ya no lo publica |
| Facebook | Publicaciones: hasta 10 páginas de 100 por ventana `since`/`until`, reanuda con `until`. Comentarios: en orden cronológico con el cursor `after` de cada publicación (hasta 5 páginas por corrida, sigue en la siguiente) | Publicaciones fuera de las 50 más recientes dejan de revisarse por comentarios |
| YouTube | Búsqueda: 2 páginas de 50 por corrida (100 unidades de cuota cada una), reanuda con `publishedBefore` | Comentarios de un video con más de 500 nuevos entre corridas (YouTube sólo los lista del más nuevo al más viejo) |

Corrida manual:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<dominio>/api/cron/ingest
```

En **Configuración → Fuentes** (`/config/fuentes`) se conectan las fuentes, se prueban (últimos 7 días,
sin guardar), se ejecutan al momento y se ve la bitácora de corridas.

## Clasificación con Claude

`/api/cron/classify` (cada 5 minutos, protegido con `CRON_SECRET`) toma las menciones `pending` en lotes
de hasta 20 por proyecto y las clasifica en una sola llamada a `CLAUDE_MODEL_FAST` con una herramienta
de esquema estricto (`src/lib/ai/classifier.ts`): sentimiento, confianza, emoción, tema (taxonomía del
proyecto u `otro`), intención, prioridad, dependencia y colonia (de los catálogos, o `null`).

- El prompt de sistema incluye el contexto del municipio, modismos mexicanos, sarcasmo y las reglas del
  proyecto (columnas `projects.topics` y `projects.classification_rules`; aún sin editor en la UI).
  Ese bloque fijo va con `cache_control`, así que los lotes siguientes leen de caché.
- Cada corrida **reserva** sus menciones (`claim_mentions`, `FOR UPDATE SKIP LOCKED`, *lease* de 3 min): dos
  corridas simultáneas nunca mandan la misma mención a Claude. Lo que no alcanza a procesar lo devuelve
  (`release_mentions`); si el proceso muere, la reserva vence y otra corrida la toma.
- Resultados y estado se guardan en **una transacción** (`complete_classifications`), sólo para menciones que
  la corrida aún tiene reservadas, y **nunca sobre una corrección humana** (`corrected_at`).
- La respuesta se valida con zod; si falla se reintenta una vez indicando el error. Si vuelve a fallar, la
  mención se reintenta después con espera (2, 4, 8… min, hasta 6 h); al 5º intento pasa a `failed` y a la cola
  **Fallos por revisar** (Configuración → Fuentes), donde se reintenta o descarta.
- Las menciones con confianza < 0.6 o prioridad alta se reprocesan con `CLAUDE_MODEL_SMART`.
- Cada llamada tiene 30 s y un reintento del SDK; no se empieza un lote con menos de 20 s del presupuesto de
  45 s. Si la API no responde, la corrida se detiene y devuelve sus reservas sin gastar intentos.
- Contadores por municipio de cada corrida (reservadas, guardadas, correcciones respetadas, reintentos, a
  revisión, llamadas y costo) en `worker_runs`.
- Tokens y costo estimado se acumulan por día, modelo y propósito en `ai_usage` (zona America/Mexico_City),
  visible para admin y comunicación.

Corrida manual:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<dominio>/api/cron/classify
```

### Evaluación

`evals/classify/dataset.json` tiene 30 menciones ficticias con la etiqueta esperada (mismos catálogos y
reglas que el seed: sarcasmo, modismos, rumores, denuncias, avisos, un intento de inyección…).

```bash
ANTHROPIC_API_KEY=... CLAUDE_MODEL_FAST=claude-haiku-5-5 CLAUDE_MODEL_SMART=claude-opus-5-5 npm run eval:classify
npm run eval:classify -- --fast   # sólo el modelo rápido, sin escalar
```

Reporta precisión por campo, precisión/exhaustividad/F1 por clase, tokens y costo, y guarda el detalle en
`evals/classify/results/` (ignorado por git).

`evals/classify/holdout.json` (etapa 12) tiene 48 menciones de **validación**, separadas del conjunto de desarrollo:
sarcasmo, ambigüedad, riesgo, inyección y control. No se usa para ajustar el prompt.

`npm run eval:classify -- --holdout` agrega:

- resultados por grupo;
- exhaustividad de riesgo y resistencia a inyección;
- los umbrales de aceptación propuestos y el dictamen;
- una hoja CSV para validación humana.

Contra el simulador local la corrida se marca SIMULADO y no emite dictamen. Ver `docs/etapa-12-validacion.md` § 4.

## Bandeja

`/bandeja` es la mesa de trabajo diaria:

- **Comunicación y admin** ven todas las menciones. Estado de triage (`mentions.triage`): nueva, revisada,
  turnada, descartada; por omisión se ocultan las descartadas.
- **Dependencia** ve sólo las menciones con un ticket de su área (RLS) y un contador de tickets vencidos
  (clic para filtrarlos). Puede cambiar el estado de sus tickets y agregar notas.

Funciones:

- Lista virtualizada (sólo se montan las tarjetas visibles) con paginación por cursor de 50 en 50.
- Filtros por fecha (días de la Ciudad de México), fuente, sentimiento, tema, dependencia, colonia,
  prioridad y estado, guardados en la URL. Búsqueda de texto completo en español sin acentos
  (`websearch`: `fuga "sin agua" -simulacro`).
- Panel de detalle: corrección de la clasificación (la base registra `corrected_by` y `corrected_at`),
  turnar con fecha límite sugerida por prioridad (crítica 12 h, alta 24 h, media 72 h, baja 7 días),
  estado del ticket y notas compartidas entre Comunicación y la dependencia.
- **Varias dependencias:** al turnar se elige la **principal** y, opcionalmente, hasta 4 de **apoyo** (por ejemplo,
  una fuga de agua: Agua Potable encabeza y Obras Públicas repara el pavimento). Cada una tiene su propio
  ticket, estado y avisos por WhatsApp (a la de apoyo le dice a quién apoya); una mención tiene una sola
  principal (`tickets.is_primary`, índice único) y sólo Comunicación o admin la cambian. Turnar de nuevo con
  otra principal deja a la anterior como apoyo.
- **Vistas operativas** (`?view=`):
  - Nuevas, Urgentes, Sin responsable, Por aceptar, Vencidas y Por validar.
  - Mezclan menciones y casos, en orden de urgencia, plazo y antigüedad.
  - Cada contador sale de la misma función SQL que su lista (`inbox_counts` / `inbox_queue`, con RLS).
  - Detalle en [docs/etapa-5-bandeja-operativa.md](docs/etapa-5-bandeja-operativa.md).
- **Revisión** (`/bandeja/revision`, admin y comunicación):
  - Cola de clasificaciones de baja confianza, posible emergencia, riesgo alto o con señales contradictorias.
  - Se confirman, corrigen o descartan con motivo; la versión previa se conserva.
- **Gravedad y atención:**
  - Gravedad, tipo de incidente y necesidad de atención van aparte del sentimiento: una crítica negativa no es una emergencia.
  - Antes de turnar una emergencia se muestra la política de Configuración → Emergencias (canal institucional).
- Acciones masivas: turnar, crear caso o agregar a uno, marcar revisadas y descartar (con deshacer). Informan cuántas se actualizaron y cuáles no, con su motivo.
- Atajos: `j`/`k` navegar, `Enter` abrir, `x` seleccionar, `t` turnar, `c` caso, `d` descartar, `r` revisada, `u` actualizar la vista,
  `/` buscar, `?` ayuda.
- Tiempo real con Supabase Realtime (`mentions`, `classifications`, `tickets`, `mention_notes` en la
  publicación `supabase_realtime`): cada cambio llega filtrado por RLS, la tarjeta entra animada y a la
  dependencia le aparece el ticket recién turnado con un aviso.

Turnar usa `route_mentions(menciones, principal, fecha, apoyo[])` (crea los tickets y marca las menciones como turnadas en una transacción,
con los permisos de quien llama). En Supabase hospedado, la publicación `supabase_realtime` ya existe; la
migración le agrega las tablas.

## Casos

Un **caso** es la unidad operativa: agrupa las menciones sobre un mismo problema (por ejemplo, 18 publicaciones
de la misma fuga) y sigue su atención. Las menciones no se pierden ni se funden: dashboard, mapa y reportes las
siguen contando una por una. Detalle en [docs/etapa-4-casos.md](docs/etapa-4-casos.md).

- **Folio** por municipio (`C-00001`), título, descripción, categoría, colonia opcional, prioridad operativa,
  dependencia y persona responsables, plazo y estado. Quien abrió el caso (su autor) es distinto del autor de
  cada publicación.
- **Estados:** detectado → en revisión → asignado → aceptado → en atención → pendiente de validación →
  cerrado. También devuelto por competencia (con motivo), descartado (con motivo), reabierto (con motivo y,
  si hay, evidencia) y fusionado. La base valida cada transición y quién la ejecuta
  (`case_transition_allowed`, `case_transition_actor`). Detalle de la atención en
  [docs/etapa-6-atencion-de-casos.md](docs/etapa-6-atencion-de-casos.md).
- **Asignación** (`assign_case`): dependencia responsable, persona responsable de esa dependencia, apoyos,
  plazo de aceptación y compromiso de atención (fecha y qué se hará).
- **Turnos:** asignar un caso crea o actualiza los tickets de la dependencia responsable y de las de apoyo
  sobre la mención principal, con aviso por WhatsApp. El estado del ticket sigue al del caso (una sola máquina
  de estados); cambiarlo desde la Bandeja o desde WhatsApp mueve el caso por `case_ticket_status`.
- **Historial** de sólo agregar (`case_events`): quién, cuándo, qué operación, cambio y motivo, incluidas las
  acciones por WhatsApp y del sistema. Los hitos de cada ciclo (`case_milestones`) tampoco se sobrescriben.
- **Por rol:**
  - Comunicación y admin (la coordinación) crean, asignan, editan, fusionan, validan y reabren. Pueden
    registrar un paso de la dependencia en su nombre, siempre con motivo.
  - La dependencia responsable acepta, inicia la atención, reporta avances con evidencia, pide validación o
    devuelve por competencia. No puede cerrar.
  - Las dependencias de apoyo ven el caso, sus propias tareas y lo que se comparte con todas las áreas.
  - Lectura consulta.
- **Avances y evidencia:** fotos JPG/PNG y PDF de hasta 3 MB en el bucket privado `case-evidence`. Se suben
  con la sesión de la persona (Storage con RLS) y a las fotos se les quitan EXIF y GPS. Se abren con un enlace
  que vence en 60 s.
- **Validación** (`validate_case`): cerrar exige al menos un avance en el ciclo, tareas cerradas, confirmar que
  la evidencia es suficiente y escribir el resultado; devolver exige motivo.
- **Sugerencias:** en el caso, Comunicación ve menciones posiblemente del mismo problema (misma colonia o
  palabras en común, en ±72 h). Nunca se agregan solas, y compartir sólo sentimiento o tema no basta.
- **Turnos anteriores:** admin, en `/casos` → «Migrar turnos existentes», primero simula y luego aplica.
  Se crea un caso por mención turnada; se puede repetir sin duplicar.

## SLA, escalamiento y envíos

Detalle en [docs/etapa-7-sla-escalamiento-envios.md](docs/etapa-7-sla-escalamiento-envios.md).

- **SLA** (Configuración → SLA y escalamiento, admin):
  - plazos de aceptación y atención por prioridad y, si se quiere, por categoría;
  - horas corridas u hábiles, con días hábiles, horario y días inhábiles, en hora de la Ciudad de México.
  - Cada guardado es una versión; es valor de referencia hasta que un admin la aprueba con el acuerdo que la respalda.
  - Al asignar, el caso guarda la versión y los plazos aplicados.
- **Escalamiento:** recordatorio al enlace antes de vencer; después, enlace, titular y coordinación. Cada paso se envía una sola vez y queda en `notification_events`. Los casos críticos son emergencias y no esperan.
- **Envíos:**
  - alertas, reportes y avisos salen de un outbox durable, con clave idempotente, reintentos con backoff y registro por intento;
  - Configuración → Envíos muestra el estado y permite reintentar;
  - cada persona elige sus canales y su horario de silencio en «Mis avisos».
- **Reportes programados:** un trabajo por municipio, tipo y periodo, que se retoma por etapas. Requieren aprobación humana salvo que la programación diga lo contrario.
- **Cron** `/api/cron/notify` cada 5 min.

## Dashboard

`/dashboard` es la vista ejecutiva (admin, comunicación y lectura):

- Selector de periodo: 24 h móviles, o 7 y 30 días completos de la Ciudad de México (hoy incluido hasta
  el corte), o fechas personalizadas. Se compara contra el periodo anterior de la misma duración, cortado
  en el mismo punto.
- Dos familias de indicadores con unidades distintas (diccionario versionado en `src/lib/kpi/dictionary.ts`
  y `docs/etapa-9-kpi.md`; cada (i) muestra fórmula, unidad, denominador, periodo y tratamiento de
  reabiertos y datos faltantes):
  - **Conversación y percepción** (menciones): menciones, NSS, % negativo, menciones de queja e
    interacciones.
  - **Atención y cumplimiento** (casos y horas): casos nuevos, abiertos y vencidos al corte, tiempo de
    primera atención y de resolución (mediana, p90 y n), cierres validados y reaperturas. Incluye el
    desglose por dependencia (alfabético, sin ranking con volumen bajo; CSV) y los casos vencidos.
- Barra de cobertura: corte, última mención y última clasificación, sin clasificar, sin colonia, fuentes
  con lectura parcial, cuándo se actualizaron las gráficas y por qué una comparación puede no ser
  equivalente (cambios de catálogo o de cobertura).
- "Lectura del día" con texto de ejemplo (se conectará a Claude).
- Volumen por sentimiento con picos anotados, temas y dependencias ordenados por NSS, mapa de colonias
  (MapLibre, intensidad por quejas) y rankings de mayor alcance y de medios/figuras públicas.
- Cada gráfica abre la bandeja ya filtrada (periodo + tema, dependencia, colonia, día, mención o medio).
- Cada gráfica tiene su tabla de datos ("Ver datos").
- Modo **Sala de juntas**: pantalla completa con actualización cada 60 s.

Datos: las tarjetas, la cobertura y la atención salen de `kpi_snapshot()` (tablas base, una sola
instantánea, reflejan una corrección de inmediato). Las gráficas usan la vista materializada
`mention_stats_hourly` vía `dashboard_stats()`, que la ingesta, la clasificación y las correcciones refrescan
(`refresh_mention_stats()`); la barra de cobertura avisa si hay correcciones aún no reflejadas, y una prueba
pgTAP concilia ambas fuentes.

Rendimiento: las gráficas (Recharts) y el mapa (MapLibre) se cargan sólo cuando están por entrar en
pantalla; las animaciones de entrada son CSS. Con el seed, el dashboard carga en ~0.5 s y Lighthouse
móvil da 86–90 de rendimiento y 100 de accesibilidad.

## Mapa

`/mapa` tiene dos capas (detalle en `docs/etapa-8-mapa.md`):

- **Conversación** (admin, comunicación y lectura): colonias coloreadas por quejas, menciones, % negativo,
  sentimiento neto o cambio contra el periodo anterior. Datos: `map_stats()`, `neighborhood_detail()` y
  `map_unlocated_mentions()` (menciones sin colonia, contadas y listadas sin texto).
- **Casos** (todos los roles; `dependencia` sólo ve esta capa y sólo sus casos, por RLS): casos por colonia
  o vencidos, con puntos agrupados sólo para ubicaciones **confirmadas** por un analista (redondeadas a ~100 m).
  Una colonia inferida cuenta en su colonia, nunca como punto. Datos: `map_case_rows()`.

Filtros en la URL (periodo en días de CDMX, colonia o «sin», categoría, prioridad, estado y dependencia).
Son los mismos predicados de `/casos` y de la bandeja, así que los conteos coinciden y cada panel enlaza a la
lista con los mismos filtros. Cada capa tiene una tabla equivalente (navegable con teclado) y el listado de
lo que no tiene ubicación. Si el mapa de calles no carga, se muestran sólo las colonias; las colonias sin
polígono o con polígono inválido se explican y siguen en la tabla. Las capas no llevan títulos, textos ni
domicilios; los extractos del panel se enmascaran (correos, teléfonos y números).

La ubicación de cada caso es confirmada, inferida o no disponible, con origen y confianza. Admin y
comunicación la confirman, corrigen o quitan en `/casos/[id]` con motivo (`set_case_location`,
`clear_case_location`); cada cambio queda en `case_location_events`. Carga medida y límites de escala:
`docs/etapa-8-mapa.md` § 6 (`supabase/perf/`).

## Percepción de funcionarios

`/funcionarios`: lo que la ciudadanía dice de la gestión del presidente municipal y los funcionarios (no sólo de
los servicios). **Acceso restringido:** admin siempre; Comunicación y Consulta sólo si un admin lo autoriza en
Configuración → Usuarios (`memberships.can_view_officials`); dependencias nunca.

- **Catálogo** (Configuración → Catálogos → Funcionarios): nombre, cargo y alias (cómo los mencionan: *la
  alcaldesa*, *el director de obras*, su usuario). Sólo servidores públicos.
- **Detección:** una mención se asocia a un funcionario si su nombre o un alias aparece como frase en el texto
  (sin distinguir acentos ni mayúsculas). Se calcula con triggers al llegar cada mención y al editar el catálogo,
  también sobre el histórico (`official_mentions`).
- **Tablero:** menciones, sentimiento neto, % negativo e interacciones contra el periodo anterior; NSS por
  funcionario; por funcionario, menciones por día, temas, emociones y lo que se dice, con filtro por sentimiento.
- **Salvaguardas:** los ciudadanos aparecen como «Ciudadano», sin nombre, usuario ni enlace (sólo se nombra a
  medios y figuras públicas); no hay rankings de autores ni exportación; cada consulta queda en la bitácora
  (`audit_log`, acción `view`). Datos sólo por `officials_stats()` y `official_mentions_list()`.
- **Datos demo:** `supabase/demo/funcionarios.sql` (SQL Editor del proyecto de preview, nunca producción) crea
  cuatro funcionarios ficticios y ~70 menciones clasificadas sobre su gestión en los últimos 60 días. Se puede
  correr varias veces sin duplicar.

## WhatsApp

Canal directo con los funcionarios de las dependencias (nunca con ciudadanos), con el número de SIGMA
**+52 56 2133 9211**, compartido por todos los municipios. Configuración → **WhatsApp y SLA** (sólo admin):

- **SLA por prioridad** (`sla_policies`): plazo común en horas para crítica, alta, media y baja. Define la fecha
  límite sugerida al turnar (una prioridad mayor nunca tiene un plazo mayor).
- **Responsable por dependencia** (`departments.responsible_user_id`): un usuario de esa dependencia, o de
  Comunicación o administración. Si cambia de rol o deja el municipio, deja de ser responsable.
- **Número y consentimiento** (`whatsapp_contacts`): el admin registra el número y se envía la plantilla de
  invitación; queda *activo* sólo cuando el funcionario toca **Acepto**. **BAJA** lo da de baja en cualquier
  momento y **ALTA** lo reactiva. Un número vivo pertenece a un solo funcionario.
- **Bitácora de mensajes** (`whatsapp_messages`, sólo admin): cada envío y respuesta con su estado (enviado,
  entregado, leído, falló), depurada con `RETENTION_MONTHS`. Altas, bajas y cambios de SLA quedan en la bitácora
  de auditoría.

- **Turnos por WhatsApp:** al turnar, el responsable activo de la dependencia recibe la plantilla `sigma_turno`
  (folio, extracto, prioridad y fecha límite; hasta 10 avisos por turnado, el resto queda en la bandeja) con
  los botones **En proceso**, **Resuelto** y **Ver detalle**. Los botones cambian el estado del turno como si lo
  hiciera el funcionario en la app (mismos permisos, bitácora a su nombre, `whatsapp_ticket_action()`), y
  **responder** al aviso agrega una nota. En la bandeja, el turno muestra *Avisado por WhatsApp* y las notas
  llevan la marca *por WhatsApp* (`mention_notes.channel`, la pone la base de datos). Un turno cerrado por
  Comunicación ya no se cambia desde WhatsApp.
- **Seguimiento de turnos de menciones sueltas** (`/api/cron/whatsapp`, cada 15 min; los turnos de casos los sigue
  el escalamiento por caso, ver «SLA, escalamiento y envíos»): al **75 % del plazo** el responsable recibe
  `sigma_recordatorio`; al **vencer**, el mismo aviso como turno vencido y `sigma_escalamiento` a la persona de
  **escalamiento** (`whatsapp_settings.escalation_user_id`: Comunicación o admin, con su WhatsApp aceptado).
  `claim_whatsapp_followups()` marca cada turno antes de enviar (`tickets.whatsapp_reminded_at` /
  `whatsapp_escalated_at`), así que nada se envía dos veces; turnar de nuevo reinicia el plazo
  (`tickets.assigned_at`). No se envía de noche (`WHATSAPP_QUIET_HOURS`); los turnos vencidos hace más de 3 días
  ya no se escalan, y los que ya iban tarde al instalar esta fase tampoco.
- **Comandos:** **PENDIENTES** responde con los turnos abiertos del funcionario (los de sus dependencias y, si
  es la persona de escalamiento, todos los vencidos), del más urgente al menos; escribir un **folio**
  (`A1B2C3`) responde con su detalle y botones **En proceso** / **Resuelto** (mensaje interactivo, válido dentro
  de las 24 h de su último mensaje).
- **Alertas por WhatsApp:** en cada regla de `/alertas` se eligen funcionarios con WhatsApp registrado; reciben
  `sigma_alerta` sólo si aceptaron. Comunicación ve quién tiene WhatsApp, nunca el número
  (`whatsapp_recipients()`).

Webhook: `GET/POST /api/whatsapp/webhook` (verificación con `WHATSAPP_VERIFY_TOKEN`, firma con
`WHATSAPP_APP_SECRET`). En pruebas, `e2e/mock-anthropic.mjs` simula la Cloud API (`WHATSAPP_API_URL`).

### Alta en Meta (una vez, cuenta de SIGMA)

1. Business Manager de SIGMA verificado → crear la cuenta de WhatsApp Business y agregar el número
   +52 56 2133 9211 (no debe estar en la app normal de WhatsApp). Nombre visible: *Sigma Pulso*.
2. App de Meta (tipo Business) con el producto WhatsApp. Usuario del sistema con permisos
   `whatsapp_business_messaging` y `whatsapp_business_management` → token permanente.
3. En Vercel (*Production*): `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` (el id del número, no el número),
   `WHATSAPP_APP_SECRET` (secreto de la app) y `WHATSAPP_VERIFY_TOKEN` (cadena aleatoria que tú eliges).
   En *Preview* lo mismo con el número de prueba de Meta.
4. Webhook en la app de Meta: URL `https://monitoreo.sigmainteligencia.com/api/whatsapp/webhook`, el mismo
   verify token, y suscribirse al campo **messages**.
5. Plantillas (categoría *Utilidad*, idioma `es_MX`):

   **`sigma_vinculacion`** — cuerpo:
   > Hola {{1}}. {{2}} te registró como responsable de {{3}} en Sigma Pulso para recibir y atender por este
   > medio las menciones ciudadanas turnadas a tu área. ¿Aceptas recibir estos mensajes?

   Pie: *Escribe BAJA en cualquier momento para dejar de recibirlos.* Botones de respuesta rápida:
   **Acepto** · **No acepto**. Ejemplos: `Ana López`, `Ayuntamiento de Alvarado`, `Obras Públicas`.

   **`sigma_turno`** — cuerpo:
   > Nuevo turno para {{1}} (folio {{2}}):
   >
   > «{{3}}»
   >
   > Prioridad: {{4}}. Fecha límite: {{5}}.
   >
   > Responde a este mensaje para agregar una nota.

   Botones de respuesta rápida: **En proceso** · **Resuelto** · **Ver detalle**. Ejemplos: `Obras Públicas`,
   `A1B2C3`, `Hay un socavón en la calle Juárez frente a la escuela`, `Alta`, `lun 12 de oct, 02:00 p.m.`

   **`sigma_recordatorio`** — cuerpo:
   > Recordatorio del turno {{1}} de {{2}}: {{3}}. Fecha límite: {{4}}.
   >
   > «{{5}}»
   >
   > Usa los botones para actualizarlo o responde a este mensaje para agregar una nota.

   Botones de respuesta rápida: **En proceso** · **Resuelto** · **Ver detalle**. Ejemplos: `A1B2C3`,
   `Obras Públicas`, `sigue abierto y está por vencer`, `lun 12 de oct, 02:00 p.m.`,
   `Hay un socavón en la calle Juárez frente a la escuela`.

   **`sigma_escalamiento`** — cuerpo:
   > Turno vencido: {{1}} no ha resuelto el turno {{2}} (prioridad {{3}}), que venció el {{4}}.
   >
   > «{{5}}»
   >
   > Toca Ver detalle o responde a este mensaje para agregar una nota.

   Botón de respuesta rápida: **Ver detalle**. Ejemplos: `Obras Públicas`, `A1B2C3`, `alta`,
   `lun 12 de oct, 02:00 p.m.`, `Hay un socavón en la calle Juárez frente a la escuela`.

   **`sigma_alerta`** — cuerpo:
   > Se activó una alerta de monitoreo en tu cuenta de {{1}}: {{2}}.
   >
   > Detalle: {{3}}
   >
   > Prioridad {{4}}. Puedes revisarla en {{5}} y darle seguimiento desde la plataforma.

   Sin botones (Meta no acepta una variable al inicio o al final del cuerpo). Ejemplos: `Ayuntamiento de Alvarado`, `Pico de menciones: 50 en 1 hora`,
   `Lo normal son 5 menciones por hora`, `alta`, `https://monitoreo.sigmainteligencia.com/alertas`.

## Salud del monitoreo

`/salud` (admin y comunicación; lectura ve sólo el resumen) muestra, con datos guardados en la base
(`monitor_health()`, nada de ejemplos), si el monitoreo está escuchando:

- **Resumen:** estado general, hora de corte en hora de la Ciudad de México, hasta cuándo están leídas las
  fuentes activas, pendientes de clasificar (la más antigua y las fallidas) y frescura del dashboard. Nunca se
  muestra en verde con cobertura desconocida, sin fuentes activas o sin registro de los procesos.
- **Por fuente** (`src/lib/health/model.ts`):
  - **Estados:** Al día · Sin publicaciones nuevas (el proveedor no publicó; no es error) · Cobertura
    parcial (tope o hueco, con el motivo) · Atrasada · Con errores (1–2 fallos) · Fallando (3+, con espera) ·
    Pausada (voluntaria) · No disponible · Cobertura desconocida.
  - **Datos de cada fuente:** último intento y éxito, atraso, próximo intento, errores seguidos y lo que
    trajo la última corrida (capturadas, nuevas, duplicadas, sin consulta, interacciones actualizadas).
  - **Siguiente paso** según el error: reconectar el token, revisar la URL, esperar la cuota o reintentar.
- **Umbrales:**
  - por fuente: frecuencia de lectura, atraso y horas sin publicaciones;
  - por municipio (`monitor_settings`): rezago y detención del clasificador, y antigüedad del dashboard.
  
  La ingesta respeta la frecuencia de cada fuente.
- **Reintentar ahora:** usa la reserva con *lease* de la etapa 2. No duplica una corrida en curso y una
  misma fuente se lee a mano como mucho una vez por minuto (`claim_sources(…, p_min_gap_seconds)`). Lo pueden
  usar sólo admin y comunicación.
- **Corridas:** se filtran por fuente, resultado, origen y periodo. El detalle de cada una muestra su
  ventana, cobertura, topes, huecos, error y el siguiente paso.
- **Fallos por revisar:** la misma cola de Configuración → Fuentes.
- **Latidos persistidos** (`worker_heartbeats`): ingesta, clasificación (aunque no haya trabajo) y
  reconstrucción del dashboard.
- **Alertas:** el tipo de regla `monitor_health` en Alertas avisa por los canales de la regla.

## Alertas

`/alertas` lista las alertas de los últimos 30 días y las reglas (admin y comunicación las editan; las
dependencias ven sólo las alertas de su área). Tipos de regla (`alert_rules.kind`, parámetros en
`condition`, validados en `src/lib/alerts/rules.ts`):

| Tipo | Dispara cuando | Huella (enfriamiento) |
|---|---|---|
| `spike` | menciones de la ventana > media + k·σ de las mismas ventanas en N días, y ≥ mínimo | una por regla |
| `sentiment_drop` | el NSS de la ventana cae X puntos frente a los N días previos | una por regla |
| `risk_term` | una mención recién clasificada contiene un término del catálogo (inicio de palabra, sin acentos) | una por término |
| `media_negative` | un medio o figura pública publica una mención negativa | una por medio |
| `daily_digest` | todos los días desde la hora indicada (Ciudad de México) | una por día |
| `monitor_health` | una fuente falla (3+ errores seguidos), se atrasa o tiene un hueco nuevo; el clasificador se detiene o se rezaga; el dashboard se desactualiza (umbrales en [Salud](#salud-del-monitoreo)) | una por fuente y estado |

- Se evalúan al final de cada corrida de `/api/cron/classify` (cada 5 min) con `src/lib/alerts/evaluate.ts`.
- `fire_alert()` aplica el enfriamiento por regla y huella con un candado, así que corridas simultáneas no
  duplican alertas.
- Notificación: en la app (campana con contador y aviso en tiempo real), por correo con Resend
  (`RESEND_API_KEY`, `ALERTS_FROM_EMAIL`) y por WhatsApp (plantilla `sigma_alerta`) a los funcionarios elegidos
  en la regla que aceptaron el canal (ver [WhatsApp](#whatsapp)). El resultado de cada canal queda en
  `alert_events.notifications`.
- Cada alerta tiene **Útil / Falsa alarma**; la lista de reglas muestra el conteo para afinar umbrales.

**Sala de crisis** (`/alertas/crisis`, admin, comunicación y lectura): volumen por minuto por sentimiento,
NSS en vivo, principales difusores (sólo medios y figuras públicas; los ciudadanos se cuentan en agregado),
alertas de las últimas 24 h y bitácora de acciones (`crisis_log`). Se actualiza cada 15 s y al instante
con Realtime.

## Reportes

`/reportes` (admin y comunicación generan y aprueban; lectura consulta y descarga): reporte diario, semanal o
mensual de un periodo que termina en el día elegido (semanal = 7 días; mensual = mes calendario a la fecha),
comparado contra el periodo anterior de la misma duración.

1. **Cifras en código, de una sola instantánea.** `src/lib/reports/data.ts` arma `ReportFacts`
   (`src/lib/ai/narrative.ts`) con una llamada a `report_snapshot()` (KPIs de conversación y de atención,
   cobertura, dependencias, casos vencidos, temas, picos con sus menciones, alertas) más las metas del
   proyecto. Las cifras las escribe sólo el servidor (los editores no pueden escribir `facts`). Sólo se
   nombran medios y figuras públicas. Detalle: `docs/etapa-9-kpi.md`.
2. **Narrativa con Claude** (`CLAUDE_MODEL_SMART`, tool use estricto): titular, resumen (≤ 120 palabras) y los
   apartados **Qué cambió**, **Qué requiere decisión**, **Quién debe actuar** (responsable del catálogo, acción,
   plazo) y **Qué sigue pendiente**, cada afirmación con referencias a los datos (KPI, caso, mención,
   dependencia…); más riesgos y mensajes clave. Cada número debe existir en `ReportFacts`, cada referencia en su
   lista autorizada y cada responsable en el catálogo; si no, se reintenta (hasta 3 intentos). El costo queda
   en `ai_usage` (`purpose = 'report'`).
3. **Borrador editable.** El editor elige referencias de la lista autorizada y responsables del catálogo, y
   verifica en vivo cifras, evidencia y responsables. «Actualizar cifras» recalcula los datos de un borrador
   (por ejemplo, tras correcciones) y vuelve a verificar el texto.
4. **Aprobación.** Sólo con la verificación en verde. Congela cifras, texto y versión de definiciones
   (triggers `reports_guard` y `reports_version_freeze`); una corrección posterior se hace con **Crear revisión**:
   un borrador nuevo (versión + 1, ligado al aprobado) con cifras al día. Genera el PDF con `@react-pdf/renderer`
   (portada con `organizations.brand_primary/brand_accent` y el **logotipo del cliente**, editables por admin en
   Configuración → Identidad; el logo también va al pie de cada página), lo guarda en el bucket privado
   `reports/<org>/<id>.pdf` y lo envía por Resend como adjunto a los destinatarios. La descarga usa un enlace
   firmado de 5 minutos.
5. **Envío programado.** `report_schedules` por tipo; `/api/cron/reports` (13:00 UTC = 7:00 CDMX) encola un
   trabajo único (`report_jobs`) para el diario cada día, el semanal los lunes y el mensual el día 1, y lo avanza
   por etapas (borrador, aprobación, PDF, envío por el outbox). Con *aprobar sin revisión* se envía; si no, espera
   la aprobación en `/reportes`. Un fallo se reintenta desde la etapa en que quedó.

**Logotipo del cliente.**
- Se sube en Configuración → Identidad (sólo admin): PNG o JPG de hasta 1 MB, entre 64 × 32 y 4000 px.
- El servidor revisa el formato real del archivo por sus primeros bytes, no por el nombre ni el tipo declarado.
- Se guarda en el bucket privado `branding/<org>/logo-<n>.png|jpg`, que sólo leen los miembros del municipio.
  `organizations.logo_path` sólo admite rutas dentro de la carpeta del propio municipio.
- Los PDF que se generen después lo usan. Los ya generados no cambian.

**Lectura del día** (dashboard): 2 o 3 oraciones sobre las últimas 24 h, redactadas con `CLAUDE_MODEL_FAST` y
las mismas validaciones, guardadas en `daily_readings` y regeneradas cuando tienen más de 1 h.

**Pruebas locales sin llaves:** `node e2e/mock-anthropic.mjs` y arrancar la app con
`ANTHROPIC_API_KEY=mock ANTHROPIC_BASE_URL=http://127.0.0.1:4010 RESEND_API_KEY=re_mock RESEND_BASE_URL=http://127.0.0.1:4010`;
los correos enviados se listan en `http://127.0.0.1:4010/emails`.

## Asistente

`/asistente` (todos los roles): chat en lenguaje natural ("¿qué colonias se quejaron más del agua esta
semana?"). Usa `CLAUDE_MODEL_SMART` con cinco herramientas de **sólo lectura** definidas en
`src/lib/ai/tools.ts`: `get_kpis`, `top_topics`, `search_mentions`, `stats_by_neighborhood` y
`stats_by_department`.

- Cada herramienta es una consulta fija y parametrizada; su entrada se valida con zod (periodo máximo de 92
  días, nombres de catálogo exactos). **No hay SQL libre.**
- Las consultas usan la sesión del usuario, así que RLS decide qué ve cada quien: un enlace de dependencia
  sólo obtiene lo turnado a su dependencia, y el prompt se lo aclara al modelo.
- `/api/asistente` responde en streaming (NDJSON): texto, avisos de herramienta, mini-gráficas cuando hay
  series o rankings y enlaces a la bandeja filtrada con el mismo periodo y filtros.
- Los ciudadanos nunca se identifican en los resultados; sólo se nombran medios y figuras públicas.
- El costo queda en `ai_usage` (`purpose = 'assistant'`). Cada ronda reserva cuota (persona, concurrencia,
  presupuesto) y se concilia al terminar, aunque una ronda posterior falle.
- Cerrar el chat o pasar de 100 s cancela la llamada en curso (la señal llega al SDK) y no empieza otra ronda
  ni herramienta. Historial de 20 turnos y 6 rondas como máximo.
