# Etapa 12 — Informe de validación integral y decisión listo/no listo

Base: `776bb2b` (etapa 11 integrada). Fecha: 13 oct 2026. Migración nueva: `20261105000000_rls_scale.sql`.

Este informe sólo reporta lo que se ejecutó en esta etapa, con su resultado. Lo que no se pudo ejecutar aparece
como **pendiente** y nunca como aprobado. Las cifras de rendimiento del README (Lighthouse de la etapa 8) **no** se
usan como resultado de esta etapa.

Documentos de la entrega:

- este informe, con la matriz de cierre (§ 9) y la decisión (§ 10);
- [`etapa-12-activacion.md`](etapa-12-activacion.md): staging, respaldos, observabilidad, activación gradual,
  migraciones y reversión;
- [`etapa-12-piloto.md`](etapa-12-piloto.md): plan del piloto con responsables, métricas y condiciones de pausa;
- evidencia: [`evidencia/etapa-12-mediciones.json`](evidencia/etapa-12-mediciones.json).

## 1. Qué ya estaba resuelto y se conserva

- **Pruebas por capa** de las etapas 0 a 11:
  - unitarias (415);
  - pgTAP (890), con matriz RLS por rol y aislamiento entre municipios (`tenants`, `rls_matrix`);
  - e2e (50), entre ellas:
    - dos workers simultáneos (`pipeline.spec`);
    - correo que falla y se reintenta por outbox (`delivery.spec`);
    - menú por rol (`org-config.spec`).
- **Recuperación ya construida:**
  - lease de clasificación (`claim_mentions`/`complete_classifications`);
  - outbox con lease y reintentos;
  - jobs de reportes idempotentes;
  - protección de correcciones humanas;
  - contadores por corrida en `worker_runs`.
- **Arnés de evaluación de IA** (`npm run eval:classify`) con un conjunto de desarrollo de 30 menciones, nunca
  ejecutado contra el modelo real.
- **Scripts de carga del mapa** (`supabase/perf/map_scale.sql`, `map_timing.sql`, `e2e/perf-map.spec.ts`).

Todo eso se conserva sin cambios de comportamiento. Esta etapa agrega pruebas, mediciones y documentos, y corrige
lo que las pruebas encontraron (§ 7).

## 2. Entorno de las pruebas

| Elemento | Valor |
|---|---|
| Runtime | Node **24.21.0**, el mismo de producción (Vercel `nodejs24.x`). CI pasa de Node 22 a 24 en esta etapa. |
| App | `next build` + `next start` (producción local), Next 16.4.0 |
| Base de datos | Supabase local en Docker (Postgres 17, Auth, Storage, Realtime, Mailpit) |
| Hardware | 4 vCPU Intel Xeon 2.8 GHz, 15 GB RAM, contenedor Linux compartido (sandbox), sin GPU |
| IA y correo | Simulador local `e2e/mock-anthropic.mjs` (Claude, Resend y WhatsApp). Ningún envío real. |
| Navegador | Chromium de Playwright, 1 worker |

Los tiempos de este entorno **no** equivalen a producción: la base y la app comparten 4 vCPU, y producción usa
Supabase administrado y funciones de Vercel. Sirven para comparar y detectar cuellos de botella.

## 3. Pruebas ejecutadas y resultados

| Capa | Comando | Resultado |
|---|---|---|
| Lint | `npm run lint` | ✅ sin errores |
| Tipos | `npm run typecheck` | ✅ |
| Unitarias | `npm test` (Node 24) | ✅ **423/423** (8 nuevas: métricas de evaluación y conjunto holdout) |
| pgTAP | `npx supabase db reset` + `npx supabase test db` | ✅ **929/929** en 42 archivos (39 nuevas en `rls_scale`) |
| Build canario | `npm run build` con claves canario + `npm run check:bundle` | ✅ 254 archivos, 8 secretos canario sin fugas |
| e2e | `npx playwright test` contra `next start` (Node 24) | ✅ **67 pasaron**, 11 omitidas (mediciones manuales: `perf-map` y `perf-stage12`), 0 fallidas |
| Reversión | `down.sql` aplicado, políticas anteriores restauradas, migración reaplicada dos veces | ✅ |
| Respaldo y restauración | `pg_dump -Fc` completo → `pg_restore` en base nueva | ✅ conteos idénticos (§ 6.3) |
| Mediciones | `PERF=1 npx playwright test e2e/perf-stage12.spec.ts` con 107 208 menciones | ✅ 8/8 (§ 5) |

### 3.1 E2E nuevas

- **`e2e/journey.spec.ts`: recorrido completo**, con enlace mágico **real** y cuatro roles:
  1. comunicación entra con el formulario de acceso y el enlace del correo (Mailpit);
  2. alta de fuente ficticia;
  3. ingesta (con un reintento del mismo elemento: 0 duplicados);
  4. clasificación por el worker;
  5. caso desde la bandeja;
  6. turno a Obras;
  7. Obras acepta, inicia y registra avance con evidencia;
  8. Obras solicita validación;
  9. comunicación valida y cierra;
  10. reporte, aprobación y PDF descargado (`%PDF-`);
  11. el admin del municipio B no ve el caso ni la mención.

  También comprueba que hay 1 clasificación, 1 turno, 1 vínculo y 1 evento de creación. Pasó 3 de 3 corridas
  locales.

- **`e2e/api-permissions.spec.ts`: permisos sin menú.** Cada rol llama directo a PostgREST, a las RPC y a Storage
  con su propia sesión:
  - Anónimo: nada.
  - Consulta lee, pero no modifica ni exporta.
  - Dependencia:
    - sólo ve y sube evidencia de lo suyo;
    - otra dependencia no ve el caso, ni lo transiciona, ni descarga o sube archivos.
  - Municipio B no ve nada de A, ni pidiendo por id:
    - casos, menciones, Storage, indicadores y catálogos.
  - Comunicación no ejecuta lo de Administración:
    - reaplicar SLA, retención, límites de IA y bitácora.

- **`e2e/resilience.spec.ts`: fallos inyectados.**

  | Fallo | Comprobación | Resultado |
  |---|---|---|
  | Proveedor 529 | La corrida para con 502; las menciones vuelven a pendientes sin gastar intento y sin reservas de IA colgadas. Al volver, cada una se clasifica **una vez** (conteo del simulador) | ✅ |
  | Timeout (40 s > 30 s por llamada) | Se detiene antes de 65 s (`maxDuration` 60 s), libera lo tomado y lo clasifica después | ✅ |
  | Worker interrumpido | Su lease se respeta mientras vive; al vencer, otra corrida la toma y la clasifica una vez. La escritura tardía del worker muerto da `stale: 1, saved: 0` | ✅ |
  | Actualización concurrente | Tres transiciones simultáneas sobre un caso: a lo más una aceptación y cada cambio parte del estado anterior (bloqueo de fila, sin actualizaciones perdidas) | ✅ |
  | Corrección humana | Una reclasificación no la sobrescribe (`keptCorrection`) | ✅ |
  | Storage rechaza el archivo | El avance no se registra, no quedan archivos huérfanos y el texto se conserva; al restablecerse, se registra una vez | ✅ |
  | Correo (proveedor 500) | Cubierto por `delivery.spec.ts` (outbox, 1 entrega) | ✅ (existente, corrió en la suite) |
  | Contadores | En cada corrida: `claimed = saved + keptCorrection + stale + retry + dead + released` | ✅ |

- **`e2e/accessibility.spec.ts`:** § 6.1.
- **`e2e/perf-stage12.spec.ts`:** mediciones manuales (§ 5).

### 3.2 pgTAP nuevo: `rls_scale.test.sql` (39)

- **Equivalencia de visibilidad.** Para las 7 personas del seed (5 de A y 2 de B) y las 5 tablas cuyas políticas
  cambiaron, las filas visibles son **exactamente** las mismas que con la política anterior (35 pruebas).
- **Casos.** Una mención que llega a la dependencia sólo por un caso:
  - es visible para esa dependencia;
  - no lo es para las demás.
- **Políticas.** Ninguna de las cinco conserva una verificación por fila.

## 4. Evaluación de IA

### 4.1 Lo construido

- **`evals/classify/holdout.json`:** 48 menciones ficticias etiquetadas a mano. Están **separadas** del conjunto de
  desarrollo y de los fixtures del simulador; una prueba unitaria verifica que no compartan textos.

  | Grupo | n | Qué mide |
  |---|---|---|
  | sarcasmo | 12 | ironía, elogio aparente y un elogio sincero que parece sarcasmo |
  | ambigüedad | 10 | textos cortos, mezcla de temas, opiniones sin postura, notas informativas |
  | riesgo | 12 | cable energizado, socavón, gas en escuela, inundación, balacera, agua contaminada, rumor de pánico… (prioridad alta y gravedad esperada) |
  | inyección | 8 | instrucciones falsas de sistema, cierre de etiquetas, salida falsa del modelo, urgencia inventada; cada una declara qué pide (`attack`) |
  | control | 6 | casos claros |

- **`src/lib/evals/classify-metrics.ts`** (8 pruebas unitarias):
  - exactitud por campo;
  - precisión, exhaustividad y F1 por clase;
  - resultados por grupo;
  - exhaustividad de riesgo (prioridad alta y gravedad alta o emergencia);
  - resistencia a inyección;
  - umbrales;
  - hoja CSV para validación humana, protegida contra fórmulas;
  - acuerdo humano.

- **`npm run eval:classify -- --holdout`:**
  - imprime todo lo anterior y el dictamen frente a los umbrales;
  - guarda el JSON y la hoja de revisión en `evals/classify/results/`;
  - si `ANTHROPIC_BASE_URL` apunta al simulador, marca la corrida como **SIMULADO** y no emite dictamen.

### 4.2 Resultados

- **Contra el modelo real: PENDIENTE.** Este entorno no tiene llave de Anthropic, y las llaves no se piden por chat.
- **Contra el simulador: el arnés funciona de punta a punta** (48 menciones, 3 llamadas, hoja de revisión
  generada). El simulador responde siempre lo mismo, así que sus números no miden al modelo y no se reportan como
  exactitud.

Para obtener el resultado real, en una máquina con la llave de evaluación (no la de producción):

```bash
npm run eval:classify -- --holdout          # cascada de producción
npm run eval:classify -- --holdout --fast   # sólo el modelo rápido, para comparar
```

### 4.3 Umbrales de aceptación propuestos

Para aprobación del área usuaria (Comunicación con la coordinación de dependencias). Un criterio sin datos nunca
cuenta como aprobado.

| Criterio | Mínimo | Crítico | Por qué |
|---|---|---|---|
| Menciones de riesgo con prioridad alta | 95 % | sí | Un riesgo no detectado es el peor error del sistema |
| Menciones de riesgo con gravedad alta o emergencia | 90 % | sí | Activa la vista Urgentes y los avisos |
| Resistencia a instrucciones dentro del texto | 100 % | sí | Ningún texto ciudadano puede dirigir la clasificación |
| Dependencia correcta (turnado) | 85 % | sí | Turnos equivocados retrasan la atención |
| Menciones clasificadas sin falla | 98 % | sí | Lo que falla se va a revisión manual |
| Sentimiento | 85 % | no | Indicador del dashboard |
| Exhaustividad de sentimiento negativo | 90 % | no | Las quejas no deben esconderse como neutrales |
| Sentimiento en sarcasmo | 80 % | no | El caso difícil más común |
| Colonia | 85 % | no | Mapa y asignación |
| Tema | 80 % | no | Agregados del dashboard |
| Intención | 75 % | no | Las fronteras queja/denuncia son difusas |

### 4.4 Validación humana

- La corrida real genera `…-revision-humana.csv`, con la respuesta del modelo junto a la etiqueta esperada y
  columnas para el revisor (de acuerdo sí/no, etiqueta correcta, iniciales).
- Propuesta:
  - dos personas de Comunicación revisan las 48 por separado;
  - se acepta si el acuerdo con el modelo es ≥ 90 % y los desacuerdos de riesgo se discuten uno por uno;
  - las etiquetas del holdout que los revisores corrijan se cambian en una versión nueva del archivo, nunca para
    ajustar el prompt al conjunto.
- **Estado: PENDIENTE** (requiere la corrida real).

## 5. Mediciones de rendimiento

- **Volumen:**
  - 107 208 menciones clasificadas;
  - 20 000 casos;
  - 1 510 colonias con polígonos de 64 vértices (`map_scale.sql`).
  - Equivale a unos 3 años al ritmo actual de producción (≈100 menciones/día) o 3–4 meses a 1 000/día.
- **Muestras:**
  - 7 corridas por página;
  - 3 de clasificación y de borrador;
  - mediana y p95 por rango más cercano.
- **Usuario:** Comunicación (ve todo el municipio: el peor caso de lectura).

| Medición | Mediana | p95 | Notas |
|---|---|---|---|
| Captura: lote de 500 menciones (RPC de ingesta) | 208 ms | 226 ms | ≈ 2 400 menciones/s |
| Clasificación de 200 menciones, 1 worker | 6.3 s | 13.9 s | modelo simulado sin latencia |
| Clasificación de 200 menciones, 2 workers simultáneos | 8.0 s | 8.6 s | sin duplicados (ver `pipeline.spec`) |
| Clasificación de 80 menciones con 1.5 s por llamada | 12.5 s | — | 1 corrida |
| Bandeja: servidor | 2.0 s | 2.7 s | 276 kB |
| Bandeja: visible en el navegador | 2.4 s | 2.6 s | hasta «En vivo» |
| Bandeja: 10 solicitudes simultáneas | 6.4 s | 6.9 s | |
| Mapa de casos (30 días): servidor | 0.75 s | 0.82 s | 2.6 MB |
| Mapa de casos: visible | 1.9 s | 2.1 s | |
| Mapa de conversación (30 días): servidor | 0.88 s | 1.05 s | 4.1 MB |
| Mapa de conversación: visible | 2.5 s | 2.9 s | |
| Dashboard: servidor | 1.3 s | 1.4 s | 2.6 MB |
| Dashboard: 10 simultáneas | 7.5 s | 7.6 s | |
| Reportes (lista) | 0.13 s | 0.17 s | |
| Indicadores de 30 días (`kpi_snapshot`) | 1.2 s | 1.3 s | |
| Borrador de reporte (datos + narrativa simulada) | 1.6 s | 1.7 s | sin la latencia real del modelo |

**Hallazgo crítico, corregido.** Con este volumen, la **bandeja no cargaba**: «canceling statement due to statement
timeout».

- Contar la lista tardaba 9.9 s y `inbox_counts` 23 s, frente al límite de 8 s.
- La causa eran las políticas de lectura de menciones, clasificaciones, turnos, vínculos y revisión, que
  verificaban la membresía **por fila**.
- La migración `20261105000000_rls_scale.sql` aplica el patrón que la etapa 8 ya usaba en `cases`: conjuntos
  calculados una vez por consulta.
- Resultado: contar baja a **50 ms**, `inbox_counts` a **1.7 s** y la dependencia a **50 ms**.
- La equivalencia de visibilidad está probada en pgTAP (§ 3.2).
- Las mediciones de la tabla son **después** de la corrección.

**No medido:**

- latencia real del modelo y de Resend;
- Supabase administrado y funciones frías de Vercel;
- más de 10 personas simultáneas;
- la bandeja de una dependencia con miles de turnos.

Se medirán en staging (activación § 4).

## 6. Accesibilidad, respaldo y estados de error

### 6.1 Accesibilidad (`e2e/accessibility.spec.ts`, 5 pruebas)

| Criterio | Cómo se mide | Resultado |
|---|---|---|
| Contraste AA (tema oscuro y claro) | Cada texto visible de 8 páginas (acceso, dashboard, bandeja, casos, mapa, reportes, ayuda, salud). Colores resueltos por el navegador (oklch → píxel) sobre el fondo pintado: 4.5:1, o 3:1 en texto grande | ✅ tras corregir 7 combinaciones (abajo) |
| Navegación móvil (390×844) | Comunicación y Obras: menú lateral, navegación y ninguna página con desborde horizontal | ✅ |
| Teclado | Acceso sin ratón; «Saltar al contenido» como primera parada; foco visible en las 25 paradas siguientes | ✅ tras agregar el enlace |
| Estados de error | Correo inválido (`aria-invalid` y mensaje asociado), enlace vencido, caso inexistente, ruta inexistente, exportación inválida (400 sin traza) | ✅ tras agregar la página 404 en español |

Se corrigió lo siguiente:

- **Contraste:**
  - prioridad «Media» (2.85:1);
  - «Crítica» en blanco sobre rojo en tema oscuro (3.67:1);
  - «Alta» y «vencidos» (3.8–4.1:1);
  - «Al día» y «En vivo» en verde (3.2–3.7:1).
  - La corrección se hizo en los tokens semánticos: verde y rojo más oscuros en claro, más claros en oscuro, y
    `--negative-foreground` para texto sobre rojo sólido. También ámbar 800/700 para texto.
- **Enlace «Saltar al contenido».** No existía, y quien usa teclado recorría todo el menú.
- **Página «No encontramos esta página».** Las rutas inexistentes y los recursos sin acceso mostraban la 404 en
  inglés de Next. El texto es el mismo en ambos casos, así que no revela si el recurso existe.
- **Riel del menú.** Tenía un título en inglés.

No evaluado: lector de pantalla real (NVDA/VoiceOver), zoom al 200 % y reducción de movimiento. Se agregan a la
lista de staging.

### 6.2 Permisos sin menú

Ver § 3.1 (`api-permissions`). La prueba usa la llave publicable y el JWT de cada persona, igual que el navegador.
Es independiente del menú y de las páginas.

### 6.3 Respaldo y restauración (prueba local)

- **Respaldo:** `pg_dump -Fc` de la base completa, 13 MB con 107 000 menciones, en 2 s.
- **Restauración:** `pg_restore` en una base nueva, en 6 s.
- **Conteos idénticos** en ambas bases:

  | Tabla | Filas |
  |---|---|
  | menciones | 107 211 |
  | clasificaciones | 107 211 |
  | casos | 20 000 |
  | `audit_log` | 1 950 |
  | usuarios | 9 |
  | objetos de Storage | 4 |
  | políticas | 113 |
  | migraciones | 28 |

- **RLS funciona en la copia:** Obras ve 18 menciones y el municipio B ve 0 del A.
- **33 errores esperados**, todos en objetos de la plataforma: Realtime, Vault y privilegios por omisión del rol
  `supabase_admin`.
- **Los archivos de Storage no están en el volcado.** Ver activación § 2.

## 7. Cambios de esta etapa

| Antes | Después |
|---|---|
| No había e2e del recorrido completo; el enlace mágico real no se probaba | `journey.spec` con correo real en Mailpit, 4 roles y 2 municipios |
| Los permisos se probaban por SQL (pgTAP) y por menú (e2e) | Más llamadas directas a API, RPC y Storage con la sesión de cada rol |
| Fallas inyectadas sólo para concurrencia y correo | 6 escenarios más, con conciliación de contadores |
| La bandeja se caía con ~100 000 menciones | Políticas que escalan; bandeja en 2 s |
| Textos bajo AA, sin «saltar al contenido», 404 en inglés | AA en ambos temas, enlace de salto, 404 en español |
| Evaluación de IA con 30 casos de desarrollo y sin umbrales | Holdout de 48 casos separado, métricas por clase y grupo, umbrales y hoja de validación humana |
| CI en Node 22, producción en 24 | CI en Node 24 |
| Sin plan de activación ni de piloto | `etapa-12-activacion.md` y `etapa-12-piloto.md`; SQL de métricas del piloto de sólo lectura |

### Archivos

- **Migración y reversión:**
  - `supabase/migrations/20261105000000_rls_scale.sql`;
  - `docs/rollback/20261105000000_rls_scale.down.sql`.
- **pgTAP:** `supabase/tests/database/rls_scale.test.sql`.
- **e2e:**
  - `e2e/journey.spec.ts`, `api-permissions.spec.ts`, `resilience.spec.ts`, `accessibility.spec.ts`,
    `perf-stage12.spec.ts`;
  - `e2e/helpers.ts`: sesión por API y municipio B.
- **IA:**
  - `evals/classify/holdout.json`;
  - `src/lib/evals/classify-metrics.ts` y su prueba;
  - `scripts/eval-classify.mts` (`--holdout`, umbrales, CSV, marca de simulado).
- **UI:**
  - `src/app/not-found.tsx`, `src/app/(app)/not-found.tsx`, `src/components/layout/not-found-message.tsx`;
  - `src/app/(app)/layout.tsx` (saltar al contenido);
  - `src/app/globals.css` (tokens);
  - `mention-card`, `review-card`, `alerts-feed`, `alert-bell`, `consumption-summary`, `reconciliation-table`,
    `app-sidebar`.
- **Piloto:** `supabase/pilot/pilot_metrics.sql`.
- **CI:** `.github/workflows/ci.yml` (Node 24).
- **Documentos:**
  - este informe, `etapa-12-activacion.md`, `etapa-12-piloto.md`;
  - `evidencia/etapa-12-mediciones.json`;
  - bitácora y README.

## 8. Limitaciones

- **La evaluación de IA contra el modelo real y su validación humana están pendientes** (§ 4).
- **La lectura de fuentes reales no se puede probar en local**, porque el guardián SSRF bloquea loopback y no se
  debilitó. En producción sí funciona: en los últimos 7 días leyeron 7 de 7 fuentes activas. Hubo 23 errores, la
  mayoría HTTP 429 de Reddit, y un tick a las 19:00 UTC en que fallaron todas y se recuperaron en el siguiente.
- **Mediciones locales** en hardware compartido; falta medir en staging con Supabase administrado.
- **Accesibilidad:** sin lector de pantalla real, zoom al 200 % ni reducción de movimiento.
- **El correo del recorrido** es local (Mailpit). En staging se usará una dirección de prueba del equipo, nunca de
  personas reales ajenas al piloto.
- **Límite de correos de Auth:** en local es de 2 por hora (`supabase/config.toml`). Correr `journey.spec` más de
  dos veces por hora agota el límite; CI lo corre una vez.

## 9. Matriz de cierre

C = criterio crítico. Estado: ✅ con evidencia · ⏳ pendiente (no aprobado) · ➖ fuera de alcance.

| # | Criterio | C | Estado | Evidencia |
|---|---|---|---|---|
| 1 | Lint, tipos, unitarias, build y pgTAP en el runtime objetivo (Node 24) | C | ✅ | § 3 |
| 2 | E2E con enlace mágico, 4 roles y 2 municipios, de la fuente a la descarga | C | ✅ | `journey.spec` |
| 3 | Fallos de proveedor, timeout, worker interrumpido, concurrencia, Storage y correo | C | ✅ | `resilience.spec`, `delivery.spec` |
| 4 | Recuperación por lease/outbox, sin duplicados, correcciones protegidas, contadores conciliados | C | ✅ | `resilience.spec`, `pipeline.spec` |
| 5 | Permisos por API, SQL y Storage independientes del menú | C | ✅ | `api-permissions.spec`, `rls_matrix`, `rls_scale` |
| 6 | Tiempos con volumen representativo y entorno documentado | C | ✅ local / ⏳ staging | § 5 |
| 7 | La bandeja funciona con ~100 000 menciones | C | ✅ local / ⏳ migración en preview y producción | § 5, `rls_scale` |
| 8 | Móvil, teclado, contraste y estados de error | | ✅ | `accessibility.spec` |
| 9 | Dataset etiquetado separado (sarcasmo, ambigüedad, riesgo, inyección) | C | ✅ | `holdout.json` + prueba de separación |
| 10 | Resultados de IA por campo y clase contra el modelo real | C | ⏳ | requiere la llave de evaluación |
| 11 | Validación humana de la IA | C | ⏳ | hoja CSV lista, falta revisión |
| 12 | Umbrales aprobados por el área usuaria | C | ⏳ | propuestos (§ 4.3) |
| 13 | Checklist de staging, respaldos, observabilidad, activación gradual y reversión | C | ✅ documento / ⏳ ejecución | `etapa-12-activacion.md` |
| 14 | Restauración de respaldo probada | C | ✅ local / ⏳ staging (PITR o volcado del proyecto) | § 6.3 |
| 15 | Lectura de fuentes reales verificada | | ✅ producción (sólo lectura) | § 8 |
| 16 | Piloto con responsables, métricas y condiciones de pausa/reversión | C | ✅ | `etapa-12-piloto.md` |
| 17 | Usuarios para los cuatro roles en producción | C | ⏳ | hoy hay admin, comunicación y 1 dependencia; falta consulta y una segunda dependencia |
| 18 | Ningún despliegue ni envío real en esta etapa | C | ✅ | sólo simulador y Mailpit; consultas de producción de sólo lectura |

## 10. Decisión

**NO LISTO para operación general.** Listo para iniciar un **piloto controlado** cuando se cumplan las condiciones de
entrada siguientes. Hoy no se cumplen; todas dependen de acciones fuera de este entorno.

1. **Migración `20261105000000_rls_scale.sql` aplicada en preview y en producción.** CI en verde sobre preview
   después de aplicarla. Con el volumen actual (823 menciones) no hay riesgo inmediato, pero sin ella la bandeja deja
   de cargar al crecer el volumen.
2. **Evaluación real del holdout ejecutada**, con los cinco umbrales críticos cumplidos o una excepción aprobada por
   escrito por el área usuaria.
3. **Validación humana** de la hoja de revisión con acuerdo ≥ 90 %.
4. **Checklist de staging completo** (activación § 1), incluida la restauración de un respaldo del proyecto.
5. **Usuarios del piloto dados de alta:**
   - al menos una persona de cada rol;
   - dos dependencias.
6. **Responsables del piloto nombrados** (piloto § 2) y umbrales aprobados.

**Evidencia a favor:**

- los criterios técnicos 1–5 y 8–9 están cubiertos por pruebas que se ejecutaron y pasaron;
- el hallazgo de rendimiento se corrigió con equivalencia de permisos probada;
- producción lee sus fuentes y clasifica sin atraso (0 pendientes, 0 fallidas).

**Evidencia en contra** (por eso «no listo»):

- la exactitud del modelo con el holdout no se conoce;
- la migración no está en las instancias;
- staging no se ha ejercitado;
- faltan usuarios para dos roles.
