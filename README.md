# Monitoreo Municipal

Plataforma de escucha social para un gobierno municipal de México. Ver `CLAUDE.md`
para contexto, stack, convenciones y límites éticos.

## Setup local

```bash
npm install
cp .env.example .env.local   # llena los valores
npm run dev
```

## Comandos

- `npm run dev` — servidor de desarrollo
- `npm run build` — build de producción
- `npm run lint` — ESLint
- `npm run typecheck` — TypeScript
- `npm test` — pruebas unitarias (`node --test`, archivos `*.test.ts`)
- `npm run db:reset` — recrea la base local con migraciones + `supabase/seed.sql`
- `npm run db:types` — regenera `src/lib/supabase/database.types.ts`
- `npm run test:db` — pruebas de RLS (pgTAP) en `supabase/tests`
- `npm run eval:classify` — mide la precisión del clasificador con 30 menciones etiquetadas (usa la API de Claude)
- `supabase db push` — aplica migraciones de `supabase/migrations` al proyecto remoto

## Base de datos local

Requiere Docker. `npx supabase start` levanta el stack; `npm run db:reset` carga
un municipio ficticio con 5 dependencias, 10 colonias y 200 menciones.
Usuarios de prueba (contraseña `password123`): `admin@`, `comunicacion@`,
`obras@`, `agua@` y `lectura@monitoreo.test`.

## Acceso y roles

- Entrada con **magic link** de Supabase (`/login`). El acceso es sólo por invitación:
  el formulario nunca crea cuentas y responde igual exista o no el correo.
- Un **admin** invita desde **Configuración** (correo, rol y, para `dependencia`, su área).
- Cada rol ve sólo su menú y no puede abrir otras secciones (`src/lib/auth/roles.ts`):

  | Rol | Secciones |
  |---|---|
  | admin | Dashboard, Bandeja, Mapa, Alertas, Reportes, Asistente, Configuración (Proyectos, Catálogos, Usuarios) |
  | comunicacion | Dashboard, Bandeja, Mapa, Alertas, Reportes, Asistente, Configuración (sólo Proyectos) |
  | dependencia | Bandeja, Alertas |
  | lectura | Dashboard, Mapa, Alertas, Reportes |

  Esto controla la navegación; la visibilidad de los datos la impone RLS.

En local, los correos llegan a Mailpit: http://127.0.0.1:54324.

### Configurar el proyecto de Supabase (producción)

1. **Auth > URL Configuration:** Site URL = dominio de la app; Redirect URLs = `https://<dominio>/**`
   (y la URL de previews de Vercel si se usan).
2. **Auth > Providers > Email:** desactivar *Allow new users to sign up*.
3. **Auth > Email Templates:** copiar `supabase/templates/magic_link.html` e `invite.html`. Usan
   `token_hash`, así el enlace funciona aunque se abra en otro dispositivo, y lo arman con la
   Site URL (`{{ .SiteURL }}/auth/confirm?…`), por lo que la Site URL debe ser el dominio con
   `https://` y sin `/` al final.
4. **Auth > SMTP Settings:** SMTP propio (Resend: `smtp.resend.com`, puerto 465, usuario `resend`);
   el correo integrado de Supabase sólo permite unos cuantos envíos por hora.
5. En Vercel: `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` y `SUPABASE_SERVICE_ROLE_KEY` (sólo servidor).

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

**Catálogos** (sólo admin): dependencias, colonias (alta manual o carga de GeoJSON con polígonos, hasta
~4 MB) y términos de riesgo. Los nombres no se repiten aunque cambien acentos o mayúsculas.

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

**Cron:** `vercel.json` programa `/api/cron/ingest` cada hora (requiere plan Pro de Vercel; en Hobby
sólo se permiten crons diarios). La ruta exige `Authorization: Bearer $CRON_SECRET`. En cada corrida:

1. Toma hasta 12 fuentes activas, empezando por las que llevan más tiempo sin correr, y procesa 3 a la vez
   (deja de iniciar fuentes nuevas a los ~45 s).
2. Lee desde el último éxito, con 15 minutos de traslape (3 días de historial la primera vez).
3. Asigna `query_id` con `match.ts`: gana la primera consulta activa que coincida. Si la fuente exige
   coincidencia (RSS y YouTube, por defecto), lo que no coincide se descarta.
4. Inserta con `ON CONFLICT (source_id, external_id) DO NOTHING` y `status = pending`.
5. Guarda `last_run_at`, `last_success_at` y el error de la fuente, y registra la corrida en `ingest_runs`.
   Tras 3 fallos seguidos la fuente espera 1 h, 2 h, 4 h… (hasta 24 h) antes de reintentarse.

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
- La respuesta se valida con zod; si falla se reintenta una vez indicando el error y, si vuelve a fallar,
  las menciones quedan `failed`.
- Las menciones con confianza < 0.6 o prioridad alta se reprocesan con `CLAUDE_MODEL_SMART`.
- Si la API no responde, la corrida se detiene y las menciones siguen `pending` para la próxima.
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

Reporta precisión por campo, precisión/exhaustividad por clase, tokens y costo, y guarda el detalle en
`evals/classify/results/` (ignorado por git).

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
- Acciones masivas: turnar, marcar revisadas y descartar (con deshacer).
- Atajos: `j`/`k` navegar, `Enter` abrir, `x` seleccionar, `t` turnar, `d` descartar, `r` revisada,
  `/` buscar, `?` ayuda.
- Tiempo real con Supabase Realtime (`mentions`, `classifications`, `tickets`, `mention_notes` en la
  publicación `supabase_realtime`): cada cambio llega filtrado por RLS, la tarjeta entra animada y a la
  dependencia le aparece el ticket recién turnado con un aviso.

Turnar usa `route_mentions()` (crea los tickets y marca las menciones como turnadas en una transacción,
con los permisos de quien llama). En Supabase hospedado, la publicación `supabase_realtime` ya existe; la
migración le agrega las tablas.

## Dashboard

`/dashboard` es la vista ejecutiva (admin, comunicación y lectura):

- Selector de periodo (24 h, 7 días, 30 días o fechas personalizadas, días de la Ciudad de México) y
  comparación contra el periodo inmediato anterior de la misma duración.
- KPIs: menciones, Net Sentiment Score ((positivas − negativas) / clasificadas × 100), % negativo
  (variación en puntos), quejas abiertas (tickets del periodo aún abiertos) y tiempo medio de atención
  (de turnado a resuelto).
- "Lectura del día" con texto de ejemplo (se conectará a Claude).
- Volumen por sentimiento con picos anotados, temas y dependencias ordenados por NSS, mapa de colonias
  (MapLibre, intensidad por quejas) y rankings de mayor alcance y de medios/figuras públicas.
- Cada gráfica abre la bandeja ya filtrada (periodo + tema, dependencia, colonia, día, mención o medio).
- Cada gráfica tiene su tabla de datos ("Ver datos").
- Modo **Sala de juntas**: pantalla completa con actualización cada 60 s.

Datos: la vista materializada `mention_stats_hourly` (hora × sentimiento × dependencia × colonia × tema
× queja) y la función `dashboard_stats()`, que devuelve todo el dashboard en una llamada. La ingesta y
la clasificación la refrescan (`refresh_mention_stats()`, sólo service role) cuando escriben.

Rendimiento: las gráficas (Recharts) y el mapa (MapLibre) se cargan sólo cuando están por entrar en
pantalla; las animaciones de entrada son CSS. Con el seed, el dashboard carga en ~0.5 s y Lighthouse
móvil da 86–90 de rendimiento y 100 de accesibilidad.

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

- Se evalúan al final de cada corrida de `/api/cron/classify` (cada 5 min) con `src/lib/alerts/evaluate.ts`.
- `fire_alert()` aplica el enfriamiento por regla y huella con un candado, así que corridas simultáneas no
  duplican alertas.
- Notificación: en la app (campana con contador y aviso en tiempo real) y por correo con Resend
  (`RESEND_API_KEY`, `ALERTS_FROM_EMAIL`). WhatsApp está detrás del adaptador `src/lib/notify` y se activa con
  `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` y `WHATSAPP_TEMPLATE` (plantilla aprobada por Meta con dos
  parámetros: título y enlace). El resultado de cada canal queda en `alert_events.notifications`.
- Cada alerta tiene **Útil / Falsa alarma**; la lista de reglas muestra el conteo para afinar umbrales.

**Sala de crisis** (`/alertas/crisis`, admin, comunicación y lectura): volumen por minuto por sentimiento,
NSS en vivo, principales difusores (sólo medios y figuras públicas; los ciudadanos se cuentan en agregado),
alertas de las últimas 24 h y bitácora de acciones (`crisis_log`). Se actualiza cada 15 s y al instante
con Realtime.
