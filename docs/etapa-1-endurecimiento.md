# Etapa 1 — Endurecimiento: SSRF, lectura en streaming, reportes y dependencias

Base: `main` en `9ac734a` (cierre de la etapa 0). Hallazgos de la matriz que cubre: #1 (SSRF), #10 (límites HTTP),
el endurecimiento de `reports` y #12/#13 (avisos del lockfile).

## 1. Qué ya estaba resuelto y se conserva

| Pieza | Antes | Se conserva |
|---|---|---|
| Esquema de la URL del feed | `rssConfigSchema` exige `http(s)://` | Igual; ahora además se valida al conectar |
| Timeout por petición | `AbortSignal.timeout(15 s)` en `fetchText` | Igual, combinado con la señal del llamador |
| Tope de 5 MB | `content-length` y `text.length` (caracteres) | El tope sigue en 5 MB, ahora en **bytes** y en streaming |
| Mensajes sin tokens | `redactUrl` en logs; el error muestra sólo el host | Igual; las pruebas lo verifican |
| Congelar reportes aprobados | `reports_guard` impedía editar contenido aprobado o volver a borrador | Igual, con transiciones explícitas |
| Auditoría de reportes | `audit_reports` (trigger) y `log_event('send')` | Igual; el cambio de destinatarios queda auditado |
| Conectores Meta y YouTube | Hosts fijos (`graph.facebook.com`, `googleapis.com`) | Siguen con `fetch` normal; sí ganan streaming y cancelación |

## 2. Política de destinos RSS (SSRF)

`src/lib/connectors/safe-fetch.ts`, usado por omisión en el conector RSS (`feedFetch()`):

- **Esquema y forma:** sólo `http:`/`https:`, sin usuario ni contraseña en la URL, sólo `GET`.
- **Direcciones bloqueadas** (`net.BlockList`):
  - IPv4: `0/8`, `10/8`, `100.64/10` (incluye metadatos de Alibaba), `127/8`, `169.254/16` (incluye
    `169.254.169.254`), `172.16/12`, `192.0.0/24`, `192.0.2/24`, `192.88.99/24`, `192.168/16`, `198.18/15`,
    `198.51.100/24`, `203.0.113/24`, `224/4`, `240/4`.
  - IPv6: `::`, `::1`, `100::/64`, `2001::/32` (Teredo), ORCHID, `2001:db8::/32`, `fc00::/7` (incluye
    `fd00:ec2::254` de AWS), `fe80::/10`, `fec0::/10`, `ff00::/8`.
  - IPv4 embebida en IPv6 (`::ffff:a.b.c.d`, `::a.b.c.d`, NAT64 `64:ff9b::/96` y `64:ff9b:1::/48`, 6to4 `2002::/16`):
    se extrae y se evalúa como IPv4.
  - Cualquier cosa que no sea una IP válida.
- **DNS sin ventana de rebinding:** la validación corre dentro del `lookup` que usa el propio socket
  (`http.request({ lookup })`). La IP que se valida es la IP a la que se conecta. Si **cualquiera** de las
  direcciones resueltas está bloqueada, se rechaza. Las IP literales (incluso `2130706433` o `0x7f.1`, que el
  parser de URL normaliza) se rechazan antes de abrir el socket.
- **Redirecciones:** manuales, máximo 5; cada salto repite todas las validaciones (esquema, credenciales,
  lista autorizada, IP).
- **Lista autorizada (opcional):** `RSS_ALLOWED_HOSTS="news.google.com,www.bing.com,.sigmainteligencia.com"`.
  Aplica a la URL inicial y a cada redirección. Es una capa adicional, no un reemplazo: la política de IP se
  aplica siempre.
- **Mensaje:** el mismo para todo destino bloqueado ("La URL de la fuente no está permitida…"). No revela cómo
  resolvió el host.
- **Enlaces de los artículos:** el conector descarta los `link` que no son `http(s)` (`javascript:`, `data:`…).

¿Por qué la lista autorizada no es obligatoria? Los editores agregan medios locales con frecuencia, y la
política de IP en el socket ya cierra el SSRF hacia la red interna. La lista sirve para cerrar también el uso
como proxy hacia hosts públicos arbitrarios. Hosts actuales en producción (consulta de sólo lectura,
13 oct 2026): `news.google.com`, `www.bing.com`, `monitoreo.sigmainteligencia.com`. Todos son públicos y ninguna
fuente existente queda bloqueada.

## 3. Lectura en streaming, cancelación y timeout

- `readCapped(response, maxBytes, signal)` en `http.ts` lee el cuerpo con `getReader()` y cuenta **bytes**.
  Al pasar el tope cancela el stream (el servidor ve el cierre de la conexión) y lanza "La respuesta pesa más
  de N MB". No depende de `Content-Length` (si lo declara mayor al tope, corta sin leer) ni de `text.length`.
- `fetchText` combina el timeout de 15 s con la señal externa (`AbortSignal.any`). Los errores se clasifican así:
  - "host tardó demasiado en responder": el timeout propio;
  - el motivo del llamador, o "se canceló": cancelación desde fuera;
  - los `ConnectorError` se conservan (destino bloqueado, tamaño, redirecciones);
  - cualquier otro error queda como "host no respondió".

  Ningún mensaje incluye la URL completa.
- `ConnectorContext.signal`: nuevo. RSS, Meta y YouTube lo pasan a cada petición.
- `withDeadline(work, ms)` reemplaza a `withTimeout` (que sólo hacía `Promise.race` y dejaba la petición
  viva). Ahora el timeout de 25 s **aborta** el trabajo del conector. Lo usan la ingesta (`runSource`) y
  "Probar fuente" (`testSource`, que antes no tenía tope total).
- Overpass (importador de colonias OSM) lee con `readCapped` y un tope de 30 MB, en vez de `res.json()` sin límite.

## 4. Reportes: flujo explícito desde la API

Migración `supabase/migrations/20261024000000_reports_hardening.sql`. Es aditiva: no recrea la tabla ni toca filas.

| Operación (admin/comunicacion vía API) | Antes | Después |
|---|---|---|
| INSERT | Cualquier estado y campo | Sólo `draft`; sin `approved_*`, `sent_at`, `pdf_path`, `delivery`; `created_by` lo pone el trigger; `schedule_id` sólo del mismo municipio |
| UPDATE | Cualquier columna en cualquier estado (sólo se congelaba el texto) | Sólo borradores; columnas `title`, `content`, `status`; `draft → approved` sella `approved_by = auth.uid()` y `approved_at = now()` |
| DELETE | Cualquier reporte | Sólo borradores |
| Destinatarios | `update` directo, en cualquier estado | Sólo con `set_report_recipients(id, text[])`: editores del municipio; normaliza; valida correos; máx. 30; queda en `audit_log` con autor, lista anterior y nueva |
| Servidor (service role) | Sin reglas propias | `draft → approved` (auto-aprobación, sin persona), `approved → sent`, `sent → sent` (reenvío); nunca vuelve atrás; `approved_by`/`approved_at` inmutables una vez sellados; `org_id`, `created_by`, `schedule_id` inmutables |

Piezas:

- Políticas separadas por operación: `editors insert draft reports`, `editors update draft reports`,
  `editors delete draft reports`. Se mantiene `readers read reports`.
- Privilegios por columna: INSERT y UPDATE de `authenticated` limitados a las columnas listadas. Se revoca todo a
  `anon` (antes tenía privilegios sin política que los usara).
- Triggers `reports_insert_guard` y `reports_guard` (reescrito). Distinguen entre:
  - la API (`current_user` `authenticated`/`anon`);
  - el servidor (`service_role`);
  - las funciones `security definer` propias.

  No llaman a funciones de `private`, porque `service_role` no tiene USAGE sobre ese esquema (ver §7).
- `reports_recipients_max` (`cardinality ≤ 30`) se creó `not valid`: no revisa filas existentes. En producción no
  hay ninguna que lo exceda.
- La app: `saveReport` guarda el texto con `update` (RLS) y los destinatarios con la RPC. Los demás flujos
  (aprobar, PDF, envío, auto-aprobación del cron, borrar borrador) no cambian.

## 5. Dependencias

`npm audit` antes y después (lockfile completo):

| | Crítico | Alto | Total | Sólo producción (`--omit=dev`) |
|---|---|---|---|---|
| Antes (`9ac734a`) | 1 | 9 | 10 | 1 crítico (maplibre-gl) |
| Después | 0 | 9 | 9 | **0** |

**Resuelto:** `maplibre-gl` 5.24.0 → **6.14.0** (GHSA-jrc7-96c5-q579, XSS en `DOM.sanitize`). La app no usa
`Popup`/`setHTML`, pero el aviso aplica a la versión instalada. Cambios en el lockfile:

| Paquete | Antes | Después |
|---|---|---|
| maplibre-gl | 5.24.0 | 6.14.0 |
| @maplibre/maplibre-gl-style-spec | 24.10.0 | 26.4.4 |
| @mapbox/vector-tile | 2.0.5 | 3.0.0 |
| @mapbox/unitbezier | 0.0.1 | 1.0.0 |
| pbf | 4.0.2 | 5.1.2 |
| @mapbox/whoots-js | 3.1.0 | (eliminado) |

Compatibilidad comprobada:

- **Imports.** v6 sólo se publica como ESM y quitó el `default export`. Ahora se usa
  `import * as maplibregl` desde `src/components/map/maplibre.ts`.
- **Worker.** v6 busca el worker junto a su propio módulo, que deja de existir al empaquetar
  (`/_next/static/chunks/maplibre-gl-worker.mjs` → 404, "Worker failed to load" y el mapa sin colonias).
  `maplibre.ts` llama a `setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url))`
  para que Turbopack lo emita en `/_next/static/media/`.
- **Prueba nueva.** `e2e/map.spec.ts` ahora exige que el worker se pida desde `/_next/static/` y que no haya
  errores de worker en consola. La prueba anterior pasaba con el mapa vacío.
- **Sin cambios necesarios.** `setData` se usaba con un solo argumento; las expresiones no son legadas;
  no se usan `transform`, `styleimagemissing` ni `Hash`; no hay CSP.
- **Verificado.** Capturas de `/mapa` y del dashboard con los polígonos de colonias y el zoom. El fondo de
  calles de OpenFreeMap no carga en el sandbox por el proxy; es igual que antes y ajeno al cambio.
  `next build` y `check:bundle` pasan.

**Sin resolver (9 altos, todos de desarrollo):** una sola cadena, `braces` (stack exhaustion con patrones muy
anidados), vía `micromatch` → `fast-glob`, en:

| Paquete directo | Ruta | Uso |
|---|---|---|
| `eslint-config-next@16.4.0` | `@next/eslint-plugin-next` → `fast-glob@3.3.1` | `npm run lint` (local y CI) |
| `shadcn@4.21.4` (última) | `@shadcn/registry`, `ts-morph@26` → `@ts-morph/common@0.27` → `fast-glob@3.3.3` | CLI para agregar componentes; la app sólo importa su CSS (`shadcn/tailwind.css`) |

- **Exposición:** ninguna en producción. No entran al bundle ni al servidor (`npm audit --omit=dev` = 0). Sólo
  procesan globs escritos por el equipo (configuración de ESLint y del CLI), no entradas de usuarios.
- **Por qué no se corrige:** el rango vulnerable de `braces` es `*` (no hay versión corregida). El "arreglo"
  de npm es bajar a `eslint-config-next@14.2.35` (Next 14) y `shadcn@1.0.0`, lo que rompe lint y el CLI.
  Forzar `overrides` de `fast-glob`/`micromatch` no quita `braces`. Se revisará cuando cualquiera publique
  una versión sin `fast-glob`.

## 6. Pruebas

| Prueba | Resultado |
|---|---|
| `npm run lint` | sin errores |
| `npm run typecheck` | sin errores |
| `npm test` (unitarias) | 268/268; incluye **69 nuevas** en `src/lib/connectors/safe-fetch.test.ts` |
| `npm run build` con claves canario + `npm run check:bundle` | OK, 178 archivos, 8 canarios sin fuga; `safe-fetch`/`node:dns` no aparecen en `.next/static` |
| `supabase db reset` (17 migraciones) + `supabase test db` (pgTAP) | 264/264 en 20 archivos; nuevos: `reports_workflow.test.sql` (30), `reports_server.test.sql` (6); `reports.test.sql` actualizado |
| `npx playwright test` (e2e) | 17/17 (dos corridas completas); `map.spec.ts` 10/10 con `--repeat-each=5` |
| Reversión | Con `docs/rollback/…down.sql` aplicado, `reports_workflow` falla 15 de 19 (el comportamiento anterior queda detectado); al reaplicar la migración, todo pasa |

Pruebas nuevas de SSRF y streaming (servidor HTTP local y DNS falso inyectado; la política real se usa
siempre, salvo que `127.0.0.1` hace de "IP pública" para alcanzar el servidor de prueba):

- **Tabla de direcciones:** 38 bloqueadas y 7 permitidas.
- **IP literales:** `127.0.0.1`, `[::1]`, `[::ffff:127.0.0.1]`, decimal, hex, `169.254.169.254`,
  `[fd00:ec2::254]` y `10.0.0.1` se rechazan sin que el servidor reciba la petición.
- **Nombres que resuelven a IP interna:** `localhost` con el resolver real; también nombres con DNS privado,
  mixto o `::1`.
- **DNS rebinding:** el mismo nombre resuelve primero a la IP "pública" y después a loopback; la segunda
  conexión se rechaza.
- **Redirecciones:** a metadatos, a un host privado, a `[::1]`, a `file:` y a una URL con credenciales; tope de
  5 saltos; lista autorizada en la URL inicial y en la redirección.
- **Streaming:** cuerpo infinito sin `Content-Length` (se cancela y el servidor ve el cierre); `Content-Length`
  declarado mayor al tope; bytes contra caracteres (`ñ`); stream que no termina (se llama a `cancel`); cuerpo
  que gotea (timeout); cancelación del llamador; `withDeadline` aborta un feed en curso y libera la conexión;
  errores sin tokens.

Pruebas de acceso directo (pgTAP, sin interfaz):

- **Editor:** no inserta reportes aprobados o enviados, ni con aprobador, autor, envío o programación ajena;
  no escribe `approved_by`/`approved_at`/`sent_at`/`delivery`/`pdf_path`/`recipients`; no marca enviado.
- **Aprobados y enviados:** el editor no los modifica ni los borra.
- **Destinatarios:** la RPC normaliza, valida y audita.
- **Otros roles:** lectura, dependencia y el municipio B no cambian ni borran nada del municipio A, ni llaman a
  la RPC; `anon` no tiene acceso.
- **Servidor:** guarda el PDF, envía y reenvía; no regresa estados ni reescribe al aprobador; un reporte no cambia
  de municipio; la auto-aprobación queda sellada como del sistema.

## 7. Hallazgo durante la etapa

La primera versión de los triggers llamaba a `private.is_api_user()`. pgTAP pasó, pero el e2e de reportes falló
con "permission denied for schema private": `service_role` no tiene USAGE sobre `private`. pgTAP no lo detectó
porque la misma sesión ya había preparado el plan como `authenticated`. Se corrigió:

- los triggers comparan `current_user` directamente;
- las pruebas del servidor viven en su propio archivo (`reports_server.test.sql`), que abre sesión nueva.

## 8. Activación

1. Preview (`llxskobppithldckfrnj`) y después producción (`dayduaiginbfpohchujl`): correr en el SQL Editor el
   archivo de migración entregado (incluye su registro en `supabase_migrations.schema_migrations`).
2. Desplegar la app (merge a `main`). Orden: **primero la migración**. La app nueva usa `set_report_recipients`;
   la app vieja seguiría funcionando con la migración aplicada, salvo "Guardar" en un borrador con cambio de
   destinatarios (recibiría "No tienes permiso").
3. Opcional: definir `RSS_ALLOWED_HOSTS` en Vercel (por ejemplo
   `news.google.com,www.bing.com,monitoreo.sigmainteligencia.com`) y redeplegar. Sin ella, se permite cualquier host público.
4. Verificar:
   - "Probar fuente" en una fuente RSS existente responde igual que antes;
   - una fuente con `http://169.254.169.254/` da "La URL de la fuente no está permitida";
   - editar destinatarios de un borrador y aprobar funciona;
   - en `audit_log` aparece el cambio de `recipients`.

## 9. Reversión

- **App:** revertir el commit de la etapa (o redeplegar el anterior en Vercel). Con eso vuelve maplibre 5.
- **Base:** `docs/rollback/20261024000000_reports_hardening.down.sql` restaura la política única y el guard
  anterior, y borra el registro de la migración. No toca filas; `anon` queda sin privilegios sobre `reports`.
  Correrlo sólo junto con la reversión de la app.
- **RSS:** si un medio legítimo quedara bloqueado, primero revisar si resuelve a una IP privada (error de DNS del
  medio). `RSS_ALLOWED_HOSTS` no sirve para desbloquear IP internas, a propósito.

## 10. Limitaciones y pendientes

- El demo `/api/demo/rss` ya no funciona como fuente apuntando a `localhost` en desarrollo. Desde la URL
  pública de la app sí funciona.
- `safe-fetch` sólo cubre RSS. Meta y YouTube usan hosts fijos en código; Overpass también es fijo.
- Los 9 avisos altos de desarrollo siguen (ver §5).
- Las pruebas SSRF usan DNS simulado; no se probó contra un servidor DNS real que cambie de respuesta (el
  mecanismo es el mismo `lookup`).
- El fondo de calles del mapa no se pudo ver en el sandbox (proxy); los polígonos, el zoom y la interacción sí.
- Pendiente de decisión (etapa 0): orden de etapas y alinear Node 22 (CI) con 24 (producción).
