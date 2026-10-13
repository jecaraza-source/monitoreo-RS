# Etapa 8 — Mapa de conversación y casos operativos

Base: `aa94177` (etapa 7 integrada). Migración `20261101000000_map_cases.sql`.

## 1. Qué ya estaba resuelto y se conserva

- `/mapa` con MapLibre en carga diferida, polígonos del catálogo (`neighborhoods.geojson`, importados de
  OpenStreetMap o del GeoJSON oficial) y zonas aproximadas punteadas (`osm_approx`).
- Métricas de conversación (quejas, menciones, % negativo, sentimiento neto y cambio), ranking, CSV y panel
  por colonia con turnos y últimas menciones (`map_stats`, `neighborhood_detail`).
- Todo eso sigue igual en la capa **Conversación**. Dos cambios:
  - el periodo se cuenta en días completos de CDMX, como la bandeja, para que los conteos coincidan;
  - los extractos del panel se enmascaran.

## 2. Capas, filtros y conteos

| Capa | Roles | Unidad | Fuente |
|---|---|---|---|
| Conversación | admin, comunicación, lectura | menciones / quejas por colonia | `map_stats`, `map_unlocated_mentions` |
| Casos | todos; `dependencia` sólo ésta y sólo sus casos | casos (o vencidos) por colonia, abiertos en el periodo | `map_case_rows` (RLS) |

- **Filtros en la URL:** `capa`, periodo, `colonia` (uuid o `sin`), `tema` (categoría), `prioridad`, `estado`
  (`open` por omisión, `all` o un estado), `dependencia` y `sentimiento` (sólo conversación). Cada cambio
  vuelve a consultar al servidor con la sesión del usuario.
- **Rol `dependencia`:** si pide `capa=conversacion` recibe la de casos, y el filtro de dependencia no
  aplica porque su ámbito ya es el suyo. Sus capas incluyen sólo sus casos: la RLS se aplica dentro de
  `map_case_rows`, que es `security invoker`.
- **Conteos iguales a Casos:** `map_case_rows` usa los mismos predicados que `/casos`, que ahora acepta
  `categoria`, `desde`, `hasta` y `colonia=sin`: estados abiertos y apertura entre las 00:00 de `desde` y
  las 00:00 del día siguiente a `hasta`, en CDMX. El panel y el listado enlazan a `/casos` con exactamente
  esos filtros (`casesHref`), y `/casos` muestra el periodo y la categoría con un botón para quitarlos.
  La e2e lo comprueba.
- **Leyenda:** dice la unidad y el denominador. Por ejemplo, «N de M casos tienen colonia (K sin ubicación,
  listados abajo)», con el rango de la escala en `aria-label`.
- **Intensidad:** escala secuencial por casos o vencidos.
- **Puntos:** se agrupan en *clusters* de MapLibre y un clic en un cluster acerca el mapa. Un punto abre
  su caso; la etiqueta lleva sólo folio, prioridad y estado.
- **Cero contra sin geometría:** el panel dice «la colonia está en cero, no le faltan datos». La tabla
  anota «Sin polígono» o «Polígono inválido: …» y un aviso cuenta las colonias que no se dibujan.

## 3. Ubicación de los casos

Columnas nuevas en `cases`: `location_status`, `location_source`, `location_confidence`, `location_lat`,
`location_lng`, `location_updated_at` y `location_updated_by`.

| Estado | Origen | Confianza | ¿Punto? |
|---|---|---|---|
| confirmada | `analista` | 1.00 | opcional, dentro del polígono |
| inferida | `captura` (colonia elegida al crear o editar) | 0.80 | nunca |
| inferida | `clasificacion` (colonia de la mención principal) | mín(confianza, 0.70) | nunca |
| inferida | `clasificacion_revisada` (clasificación corregida por una persona) | 0.80 | nunca |
| no disponible | `sin_dato` | — | — |

- **Restricciones:**
  - lat y lng van juntas;
  - sólo una ubicación confirmada lleva punto;
  - «no disponible» equivale a no tener colonia.
- **El trigger `infer_case_location`:**
  - nunca genera coordenadas;
  - editar la colonia por fuera de la confirmación la baja a inferida y quita el punto;
  - las columnas de ubicación sólo cambian con las RPC.
- **`set_case_location` (coordinación: admin y comunicación):**
  - pide una colonia de la organización;
  - el punto es opcional y debe estar dentro de México y del polígono, salvo en zonas aproximadas o sin
    polígono;
  - pide motivo si corrige una ubicación confirmada o cambia de colonia;
  - registra `location_confirmed` o `location_corrected` en el historial del caso.
- **`clear_case_location`:** pide motivo y registra `location_cleared`.
- **Historial:** `case_location_events` es de sólo agregar e incluye el estado anterior. Lo leen quienes
  leen el caso.
- **En la interfaz:** `/casos/[id]` muestra el estado, el origen, la confianza, el punto exacto (sólo ahí)
  y el historial. Los botones aparecen sólo para coordinación.
- **Menciones y casos sin ubicación:** se cuentan y se listan bajo el mapa, sin texto. Las menciones
  enlazan a la bandeja y los casos a su ficha.

## 4. Privacidad y robustez

- **Capas ejecutivas:**
  - sin título, texto, autor ni domicilio;
  - los puntos salen de la base redondeados a 3 decimales (~100 m);
  - las menciones sin colonia se listan sin texto.
- **Extractos del panel:** `redactPersonalData` enmascara correos, teléfonos y números de casa.
- **Dependencias:** se usan las corregidas (`department_id` del caso y de la clasificación revisada).
- **Fallos:**
  - mapa de calles caído o sin conexión: se avisa y se dibujan sólo las colonias;
  - WebGL no disponible: mensaje, y la tabla sigue;
  - catálogo vacío: estado vacío con enlace a Catálogos;
  - polígonos inválidos (`validateGeometry`: tipo, anillos, rango, más de 20 000 vértices): se listan con
    el motivo y no se dibujan.

## 5. Accesibilidad

- **Tablas:** cada capa tiene una tabla real (`<table>`, encabezados `scope="col"`) con los mismos números.
  Está en una región desplazable enfocable y cada colonia es un enlace que abre su detalle.
- **Mapa:** es una `region` con instrucciones de teclado (flechas y +/−). La métrica y la capa son
  `radiogroup`.
- **Catálogos grandes:** con más de 200 colonias, la tabla lista primero las que tienen actividad y ofrece
  «Mostrar también las N colonias en cero» (`ceros=1`).
- **Carga diferida:** MapLibre se carga en su propio chunk sólo cuando la capa está abierta.

## 6. Rendimiento y límites de escala

Conjunto de prueba, local y ficticio (`supabase/perf/map_scale.sql`):
- 1 500 colonias de 65 vértices;
- 20 000 casos (70 % inferidos, 10 % confirmados con punto, 20 % sin ubicación);
- 100 000 menciones clasificadas.

Mediciones con `supabase/perf/map_timing.sql` y `PERF_MAP=1 npx playwright test e2e/perf-map.spec.ts`:

| Medida | Resultado |
|---|---|
| `map_case_rows`, 30 días (17 143 filas abiertas), como comunicación | **2 160 ms → 80 ms** tras reescribir la política de lectura de `cases` |
| `map_stats`, 30 días | 4 ms |
| `map_unlocated_mentions`, 30 días (15 031 sin colonia) | 90–170 ms |
| catálogo con GeoJSON (1 510 colonias) | 20 ms, ~1 MB |
| `/mapa?capa=casos`, servidor | 0.7–0.8 s, 2.6 MB de HTML (~300 kB con gzip) |
| `/mapa` conversación, servidor | ~0.65 s, 1.8 MB (~260 kB con gzip) |
| mapa visible en el navegador (casos / conversación) | 1.9–2.1 s / 1.3–1.7 s |
| `/casos?estado=all` con 20 000 casos | 0.16–0.32 s |

**Hallazgo.** La política de `cases` de la etapa 4 evaluaba `can_read_all(org_id)` y
`case_visible_to_department(org_id, id)` en cada fila: 2.3 s para 20 000 casos, también en `/casos`. Se
reescribió con la misma regla como conjuntos no correlacionados (`read_all_org_ids()`,
`department_case_ids()`), que el planificador calcula una vez. Una prueba pgTAP compara, rol por rol, lo
visible contra la regla anterior.

**Otras reducciones.** Coordenadas redondeadas a 5 decimales (~1 m) al enviarlas y tabla sin las colonias
en cero en catálogos grandes: de 4.1 MB a 2.6 MB / 1.8 MB.

**Límites:**
- Hasta unas 2 000 colonias y unos 25 000 casos en el periodo, la página queda bajo 3 s en local.
- Más allá, el peso lo ponen los polígonos (~0.9 kB por colonia) y las filas de casos (~120 B por caso):
  - convendría servir los polígonos como teselas vectoriales o como un GeoJSON en caché por organización;
  - y agregar los casos en la base en lugar de enviarlos fila por fila.
- El periodo máximo es el del selector (hasta 92 días).

## 7. Pruebas

- **pgTAP `map_cases` (43):**
  - inferencia al crear y al editar, sin coordenadas;
  - backfill;
  - permisos de `set_case_location` y `clear_case_location` (lectura, otra organización);
  - punto dentro o fuera de la colonia, de México y con coordenadas incompletas;
  - motivo obligatorio y `operation` de la corrección;
  - historial de sólo agregar;
  - filtros y conteos de `map_case_rows`;
  - aislamiento de dependencia y de otra organización;
  - menciones sin colonia, que coinciden con `map_stats` y no llevan texto;
  - `point_in_geojson` con huecos;
  - política equivalente para comunicación, Obras, Agua y otro municipio.
- **Suite completa:** pgTAP 734/734 tras `db reset`.
- **Unitarias (363):**
  - `geometry`: validación, punto en polígono y redondeo;
  - `redact`;
  - `cases`: capa, puntos sólo confirmados, enlaces a `/casos`;
  - `model`: filtros y `mapLayers`;
  - `roles`: dependencia entra al mapa.
- **e2e (`e2e/map.spec.ts`):**
  - conversación: métrica, panel y bandeja;
  - mapa de calles bloqueado, tabla equivalente con las 10 colonias y teclado;
  - casos con conteos iguales en `/casos`, por colonia y «sin colonia»;
  - inferida sin punto, punto fuera de la colonia rechazado, confirmar y corregir con motivo e historial;
  - lectura sin botones;
  - dependencia sin capa de conversación y sin casos ajenos.
- **Suite e2e completa:** 34 pasan; las 3 de carga se omiten si no hay `PERF_MAP`.
- **Reversión y reaplicación:** la migración corrida sentencia por sentencia (como en el editor SQL) y en
  una sola transacción, con casos previos; el backfill repetido no cambia nada.

## 8. Archivos

- **Migración:** `supabase/migrations/20261101000000_map_cases.sql`.
- **Reversión:** `docs/rollback/20261101000000_map_cases.down.sql`.
- **Pruebas:**
  - pgTAP: `supabase/tests/database/map_cases.test.sql`;
  - e2e: `e2e/map.spec.ts` y `e2e/perf-map.spec.ts`.
- **Carga:** `supabase/perf/map_scale.sql` y `supabase/perf/map_timing.sql` (sólo local).
- **Lógica:**
  - `src/lib/map/`: `cases.ts`, `geometry.ts`, `data.ts` y `model.ts`, con sus pruebas;
  - `src/lib/text/redact.ts`.
- **Componentes:**
  - `src/components/map/`: `cases-explorer.tsx`, `map-tables.tsx`, `colonias-map.tsx`, `map-filters.tsx`
    y `basemap.ts`;
  - `src/components/cases/`: `case-location.tsx` y `case-filters.tsx`.
- **Páginas:** `src/app/(app)/mapa/page.tsx`, `src/app/(app)/casos/page.tsx` y
  `src/app/(app)/casos/[id]/page.tsx`.
- **Casos y roles:**
  - `src/lib/cases/`: `actions.ts`, `data.ts` y `model.ts`;
  - `src/lib/auth/roles.ts`.

## 9. Activación y reversión

- **Activar:**
  1. Correr la migración en preview y en producción. Es aditiva. El backfill marca los casos con colonia
     como inferidos (captura, 0.80) y el resto como sin ubicación; es repetible.
  2. Hacer el deploy.
- **Conteo previo (sólo lectura):**
  - producción: 1 caso, con colonia, que quedará inferido;
  - preview: 3 casos sin colonia;
  - ambas: 61 colonias, todas con polígono.
- **Revertir:**
  1. Revertir el commit.
  2. Exportar las ubicaciones confirmadas y su historial (comandos en el `down.sql`).
  3. Correr el `down.sql`. La colonia de cada caso se conserva, y la política de lectura vuelve a su forma
     anterior con la misma regla.

## 10. Limitaciones

- **Puntos:** se capturan como coordenadas, sin selector en el mapa ni geocodificación (no se usan
  servicios externos con domicilios).
- **Menciones:** no tienen ubicación propia; el mapa de conversación sigue siendo por colonia.
- **Escala:** más de unas 2 000 colonias requiere teselas o caché de geometrías (§ 6).
- **Página de carga:** las mediciones son locales; en Vercel influyen la latencia a Supabase y el arranque
  en frío.
