# Etapa 9 — Indicadores de conversación y de atención, reportes con instantánea y versiones

Base: `f1a8a15` (etapa 8 integrada). Migración `20261102000000_kpi_snapshot.sql`.

## 1. Qué ya estaba resuelto y se conserva

- **Dashboard:**
  - agregado horario `mention_stats_hourly` vía `dashboard_stats()`;
  - gráficas de volumen, temas, dependencias por NSS, mapa de colonias, rankings de alcance y medios;
  - lectura del día y sala de juntas.
- **Reportes:**
  - cifras calculadas en código (`ReportFacts`) y narrativa con Claude, con cada número verificado;
  - borrador editable, aprobación que congela el texto y las cifras;
  - PDF privado con la marca del cliente, envío por el outbox y trabajos programados;
  - aviso de cifras desactualizadas tras correcciones (`facts_stale_at`).

Todo eso sigue igual. Cambia lo siguiente.

## 2. Qué se corrigió

- **Publicaciones contadas como incidentes.** Las tarjetas «Quejas abiertas» y «Tiempo medio de atención» y la
  atención de los reportes contaban turnos: un turno por mención y por dependencia. Ahora la atención se mide en
  casos (`cases`, `case_milestones`); los casos fusionados (duplicados) no cuentan. Las menciones de queja siguen
  en la familia de conversación, como menciones.
- **Agregados incoherentes en un reporte.** Las cifras salían del agregado horario (`dashboard_stats`) y los
  ejemplos de tablas en vivo (`report_extras`), en momentos distintos. Ahora `report_snapshot()` devuelve todo
  en una sola sentencia: una instantánea MVCC de las tablas base. Una corrección se refleja en el siguiente
  cálculo sin esperar al agregado.
- **Periodos por hora y no por día.** «7 días» y «30 días» eran ventanas móviles de horas, mientras la bandeja y
  `/casos` filtran por días de la Ciudad de México. Ahora son días completos de CDMX (hoy hasta el corte). El
  periodo anterior se corta en el mismo punto de su duración (`prev_cut`), así que un día en curso se compara
  con la misma parte del día anterior.
- **Ranking de dependencias con volumen bajo.** «Dependencias por NSS» ordenaba también dependencias con pocas
  menciones. Ahora sólo se ordenan las que tienen al menos 20 menciones; las demás se listan aparte. La
  atención por dependencia es un desglose alfabético, no un ranking.

## 3. Diccionario de KPI

Fuente única: `src/lib/kpi/dictionary.ts`. El dashboard lo muestra en el (i) de cada tarjeta, y el reporte en
su anexo y en el PDF. Cada reporte guarda `kpi_version` con sus cifras: un reporte aprobado conserva las
definiciones con las que se calculó. Para cambiar una definición se sube la versión.

Versión **KPI-2026.11**.

### Conversación y percepción

| KPI | Unidad | Fórmula | Denominador | Periodo | Reabiertos | Sin dato | Consulta base |
|---|---|---|---|---|---|---|---|
| Menciones (`mentions`) | menciones | Número de publicaciones recolectadas. | — | Fecha de publicación dentro del periodo, en días de la Ciudad de México, hasta el corte. | No aplica: es conversación, no casos. | Las que aún no se clasifican cuentan aquí y se informan aparte como «sin clasificar». | `kpi_snapshot → conversation.mentions (mentions.published_at)` |
| Sin clasificar (`unclassified`) | menciones | Menciones del periodo sin clasificación (pendientes o fallidas). | Menciones del periodo (para el %). | Fecha de publicación dentro del periodo, en días de la Ciudad de México, hasta el corte. | No aplica: es conversación, no casos. | Es la cobertura: no entran a sentimiento, temas ni colonias. | `kpi_snapshot → conversation.unclassified` |
| Sentimiento neto (NSS) (`nss`) | puntos | (positivas − negativas) ÷ clasificadas × 100, de −100 a 100. | Menciones clasificadas. | Fecha de publicación dentro del periodo, en días de la Ciudad de México, hasta el corte. | No aplica: es conversación, no casos. | Las sin clasificar no cuentan; si no hay clasificadas no se calcula. | `kpi_snapshot → conversation.positive, negative, classified` |
| Menciones negativas (`negative_pct`) | % | negativas ÷ clasificadas × 100. | Menciones clasificadas. | Fecha de publicación dentro del periodo, en días de la Ciudad de México, hasta el corte. | No aplica: es conversación, no casos. | Las sin clasificar no cuentan. | `kpi_snapshot → conversation.negative, classified` |
| Menciones de queja (`complaints`) | menciones | Menciones clasificadas con intención «queja» o «denuncia». Son publicaciones, no incidentes: un problema puede tener muchas. | — | Fecha de publicación dentro del periodo, en días de la Ciudad de México, hasta el corte. | No aplica: es conversación, no casos. | Las sin clasificar no cuentan. | `kpi_snapshot → conversation.complaints` |
| Interacciones (`interactions`) | interacciones | Suma de reacciones, compartidos y comentarios de las menciones. | — | Fecha de publicación dentro del periodo, en días de la Ciudad de México, hasta el corte. | No aplica: es conversación, no casos. | Fuentes sin métricas (RSS) suman 0. | `kpi_snapshot → conversation.interactions (mentions.metrics)` |
| Clasificadas sin colonia (`without_neighborhood_pct`) | % | clasificadas sin colonia ÷ clasificadas × 100. | Menciones clasificadas. | Fecha de publicación dentro del periodo, en días de la Ciudad de México, hasta el corte. | No aplica: es conversación, no casos. | Es cobertura geográfica: el mapa y los desgloses por colonia no las incluyen. | `kpi_snapshot → conversation.without_neighborhood, classified` |

### Atención y cumplimiento

| KPI | Unidad | Fórmula | Denominador | Periodo | Reabiertos | Sin dato | Consulta base |
|---|---|---|---|---|---|---|---|
| Casos nuevos (`cases_opened`) | casos | Casos abiertos en el periodo. Un caso fusionado es un duplicado y no cuenta. | — | Fecha de apertura dentro del periodo (días de la Ciudad de México), hasta el corte. | Una reapertura no es un caso nuevo; se cuenta en «Reaperturas». | Sin categoría o sin ubicación cuentan igual y se informan aparte. | `kpi_snapshot → attention.opened (cases.opened_at)` |
| Casos abiertos al corte (`open_at_cut`) | casos | Casos cuyo estado al corte (último hito hasta ese momento) es abierto: detectado, en revisión, asignado, aceptado, en atención, pendiente de validación o devuelto. | — | Existencia al corte: el último instante del periodo (o ahora, si el periodo incluye hoy). | Un caso reabierto vuelve a contar como abierto desde su reapertura. | Un caso sin hitos (anterior a la etapa 6) usa su estado actual. | `kpi_snapshot → attention.open_at_cut (case_milestones)` |
| Casos vencidos al corte (`overdue_at_cut`) | casos | Casos abiertos al corte cuyo plazo del paso actual ya pasó: aceptación si está asignado; atención si está aceptado o en atención. | Casos abiertos al corte (para el %). | Existencia al corte. | Un caso reabierto se evalúa con sus plazos vigentes. | Sin plazo no puede vencer: se informan aparte como «sin plazo». Se usa el plazo vigente del caso. | `kpi_snapshot → attention.overdue_at_cut` |
| Tiempo de primera atención (mediana) (`first_attention_h`) | horas | Mediana de horas entre el inicio del ciclo del caso y su primera aceptación por la dependencia. Se muestra también el percentil 90 y n. | Ciclos aceptados en el periodo (n). | Ciclos aceptados dentro del periodo. | Cada ciclo se mide desde su propio inicio (la reapertura). | Los casos aún sin aceptar no entran a la mediana: se cuentan en «Sin primera atención». | `kpi_snapshot → attention.first_attention_median_h (case_cycle_times)` |
| Tiempo de resolución (mediana) (`resolution_h`) | horas | Mediana de horas entre el inicio del ciclo y su cierre validado. Se muestra también el percentil 90 y n. | Ciclos cerrados en el periodo (n). | Ciclos cerrados (validados) dentro del periodo. | Cada ciclo cuenta por separado; el cierre anterior a una reapertura no se borra. | Los casos sin cerrar no entran a la mediana. | `kpi_snapshot → attention.resolution_median_h (case_cycle_times)` |
| Cierres validados (`validated_closures`) | casos | Casos que pasaron a «cerrado» en el periodo; sólo se cierra con validación de coordinación. | — | Fecha del cierre dentro del periodo. | Un caso cerrado, reabierto y cerrado otra vez cuenta dos cierres (uno por ciclo). | No aplica. | `kpi_snapshot → attention.validated_closures (case_milestones)` |
| Reaperturas (`reopenings`) | casos | Casos que salieron de «cerrado» en el periodo porque el problema persistió. | — | Fecha de la reapertura dentro del periodo. | Es el indicador de reaperturas. | No aplica. | `kpi_snapshot → attention.reopenings (case_milestones)` |

**Reglas comunes**

- **Periodo:** días de la Ciudad de México (UTC−6, sin horario de verano), del inicio del primer día al corte.
  El corte es el fin del periodo o el momento de la consulta si el periodo incluye hoy.
- **Comparación:** contra el periodo anterior de la misma duración, cortado en el mismo punto. Un cambio en %
  se muestra para conteos y horas, y en puntos para porcentajes y NSS. No se compara una mediana con menos de
  3 ciclos.
- **Comparación por dependencia:** con menos de 5 casos y menos de 20 menciones, la dependencia se marca
  «volumen bajo». Una dependencia creada dentro del periodo comparado se marca «nueva en el catálogo».
- **Reabiertos:** cada ciclo de un caso (desde su apertura o reapertura) se mide por separado. Un cierre
  validado no se borra al reabrir, y la reapertura cuenta en «Reaperturas».
- **Sin fecha o sin dato:**
  - un caso sin plazo no puede vencer y se cuenta aparte (`open_without_due`);
  - una mención sin clasificar cuenta en «Menciones» pero no en sentimiento, temas ni colonias;
  - un caso sin categoría o sin ubicación cuenta igual y se informa en cobertura.

## 4. Cobertura y comparabilidad

La barra de cobertura del dashboard y la sección de cobertura del reporte (`comparabilityNotes`) muestran:

- **Corte y frescura:** corte, última mención recolectada, última clasificación y hora de la última
  actualización del agregado de las gráficas.
- **Lo que falta:**
  - menciones sin clasificar y clasificadas sin colonia, en número y en %;
  - casos nuevos sin categoría o sin ubicación;
  - fuentes activas no leídas hasta el corte (`sources.covered_until`), con la advertencia de que las cifras
    pueden crecer.
- **Por qué una comparación puede no ser equivalente:**
  - la cobertura de clasificación cambió 5 puntos o más;
  - se agregaron fuentes, dependencias o colonias desde el inicio del periodo anterior;
  - hay correcciones que aún no llegan a las gráficas (las tarjetas ya las incluyen).

## 5. Reportes

- **Cifras v2** (`facts_version: 2`):
  - ambas familias de KPI, con unidad, n y p90;
  - cobertura y notas de comparabilidad;
  - desglose por dependencia y casos vencidos al corte (folio, categoría y área, sin título);
  - temas, picos con sus ejemplos de la misma instantánea, alertas;
  - lista de **referencias autorizadas** (`kpi:…`, `caso:<folio>`, `mencion:<n>`, `dependencia:…`, `tema:…`,
    `pico:<n>`, `colonia:…`) y de **responsables autorizados** (dependencias del catálogo, «Comunicación
    Social», «Coordinación de atención ciudadana»).
- **Narrativa estructurada.** Además de titular, resumen, riesgos y mensajes, tiene los apartados **Qué
  cambió**, **Qué requiere decisión**, **Quién debe actuar** (responsable, acción, plazo) y **Qué sigue
  pendiente**. Cada afirmación lleva al menos una referencia. En la vista, las referencias enlazan al caso, al
  KPI o a la mención; en el PDF se listan como «Datos: …».
- **Validación** (`validateNarrative`), en el modelo (con reintento), en el editor (en vivo) y al aprobar
  (bloquea):
  - cifras que no están en `ReportFacts`;
  - referencias inexistentes;
  - afirmaciones sin evidencia;
  - responsables fuera del catálogo (se comparan sin acentos ni mayúsculas);
  - resumen de más de 120 palabras.
- **Las cifras las escribe el servidor.** Los editores ya no pueden escribir `facts`: el borrador lo inserta el
  servidor con la service role y `created_by` del editor. Una aprobación sin cifras se rechaza.
- **Versiones:**
  - una versión aprobada congela cifras, texto, `kpi_version` y `snapshot_at`;
  - «Crear revisión» genera un borrador nuevo (versión + 1, `previous_version_id`) con cifras recalculadas y el
    texto aprobado como base;
  - una versión tiene a lo más una revisión, una revisión conserva el periodo, y un borrador se edita, no se
    revisa;
  - la vista enlaza ambas versiones;
  - «Actualizar cifras» recalcula un borrador sin cambiar su texto, que se vuelve a verificar.
- **Reportes anteriores.** Se ven, se aprueban y generan PDF con su formato (hallazgos, recomendaciones,
  atención por turnos).

## 6. Pruebas numéricas y conciliación

- **pgTAP `kpi_snapshot` (45):** un escenario ficticio de enero de 2025 con resultados conocidos.
  - **Conversación:**
    - 6 menciones en tres días de CDMX: las 23:30 del 15 entran y las 00:30 del 16 no;
    - 5 clasificadas y 1 sin clasificar;
    - sentimiento, quejas, sin colonia, sin tema e interacciones;
    - la serie diaria suma el total.
  - **Atención:**
    - 3 casos nuevos (el fusionado no cuenta), 3 abiertos al corte y 2 vencidos (por atención y por
      aceptación);
    - primera atención con n = 1 y 4 h;
    - resolución por ciclo de 29 h y 51 h, que da mediana 40 y p90 48.8;
    - 2 cierres validados (el caso reabierto conserva el suyo), 1 reapertura;
    - el periodo anterior cortado en su propio fin.
  - **Dependencias:** desglose de Agua, Obras y «Sin asignar»; casos vencidos sin título; cambios de catálogo.
  - **Conciliación por periodos:**
    - tres días sueltos suman el periodo para menciones, negativas, casos nuevos y cierres;
    - los abiertos al corte (existencias) del último día igualan los del periodo;
    - el agregado horario y la instantánea coinciden en menciones, clasificadas, negativas y quejas, en el
      escenario y en los últimos 7 días del seed;
    - una reclasificación se refleja de inmediato.
  - **Permisos:** dependencia y otro municipio rechazados; lectura permitida.
  - **Versiones:**
    - los editores no escriben cifras;
    - un reporte aprobado conserva sus cifras aunque cambien los datos, y nadie las reescribe;
    - la revisión es la versión 2;
    - una versión admite una sola revisión, y un borrador no se revisa.
- **Unitarias:**
  - `kpi/snapshot.test.ts`: las unidades no se mezclan, NSS y % calculados en código, medianas con pocos
    casos sin comparar, notas de cobertura, dependencias en orden fijo con marcas y CSV, diccionario completo
    con consulta base;
  - `narrative.test.ts`: cifras v2 por familia, sin ranking con volumen bajo, referencias y responsables,
    validación de cifras, referencias, evidencia y responsables, formato anterior, reintento por referencias;
  - `model.test.ts`: periodos en días completos de CDMX.
- **e2e `kpi.spec.ts`:**
  - dashboard con dos familias y sus unidades: «Menciones» y «Casos nuevos» igualan una consulta directa del
    periodo; cobertura; definición en el (i); CSV por dependencia;
  - reporte aprobado: una reclasificación posterior no cambia sus cifras; «Crear revisión» genera la versión 2
    con NSS recalculado; una afirmación sin evidencia bloquea la aprobación;
  - un reporte del formato anterior se aprueba y genera PDF;
  - una dependencia no entra al dashboard ni a reportes.

## 7. Rendimiento

Medido con el conjunto de carga de la etapa 8 (`supabase/perf/map_scale.sql`: 1 500 colonias, 20 000 casos y
100 000 menciones en 30 días), como comunicación:

| Consulta | Antes de optimizar | Final |
|---|---|---|
| `kpi_snapshot`, 7 días | 2.3 s | 0.9 s |
| `kpi_snapshot`, 30 días | 2.3 s | 2.0 s |
| `report_snapshot`, 30 días (mensual) | 13.8 s | 2.6–3.0 s |
| `kpi_snapshot` con el seed | 0.13 s | — |

Optimizaciones:
- estado de los casos al corte en una pasada (`distinct on`);
- ciclos del periodo calculados desde sus hitos (`cycle_steps`), sin agregar todos los ciclos;
- desglose por dependencia con agregados agrupados;
- ejemplos por día y por colonia con funciones de ventana;
- funciones auxiliares que el planificador puede incrustar.

**Límite:** con más de unas 100 000 menciones o 20 000 casos en el periodo, el dashboard de 30 días pasa de
2 s. Convendría materializar los KPI de atención por día (como el agregado de menciones) o calcularlos en
segundo plano.

## 8. Archivos

- **Migración:** `supabase/migrations/20261102000000_kpi_snapshot.sql`.
- **Reversión:** `docs/rollback/20261102000000_kpi_snapshot.down.sql`.
- **Pruebas pgTAP:**
  - nueva: `supabase/tests/database/kpi_snapshot.test.sql`;
  - ajustadas: `reports*.test.sql` (sus reportes llevan cifras).
- **Lógica de KPI:** `src/lib/kpi/` (`dictionary.ts`, `snapshot.ts`, `data.ts`, `snapshot.test.ts`).
- **Componentes de KPI:** `src/components/kpi/` (sección por familia, definición, barra de cobertura, desglose
  por dependencia, casos vencidos, CSV).
- **Dashboard y componentes base:**
  - `src/lib/dashboard/` (`period.ts`, `data.ts`);
  - `src/components/dashboard/dashboard-content.tsx`;
  - `src/components/ui-kit/kpi-card.tsx` (valor sin dato y nota al pie).
- **Reportes:**
  - `src/lib/ai/narrative.ts`, con sus pruebas;
  - `src/lib/reports/` (`data.ts`, `actions.ts`, `list.ts`, `pdf.tsx`);
  - `src/components/reports/` (`narrative-editor.tsx`, `report-view.tsx`, `report-actions.tsx`);
  - `src/app/(app)/reportes/[id]/page.tsx`.
- **Asistente y alertas:**
  - `src/lib/ai/tools.ts`: nota de unidades, porque «turnos» son menciones;
  - `src/lib/alerts/rules.ts`: «menciones turnadas abiertas».
- **e2e:**
  - nueva: `e2e/kpi.spec.ts`;
  - ajustado: `e2e/mock-anthropic.mjs` (narrativa estructurada).

## 9. Activación y reversión

- **Activar:**
  1. Correr la migración en preview y luego en producción. Es aditiva, sin backfill: sólo funciones, columnas
     de versión con valor por omisión y triggers.
  2. Hacer el deploy.
- **Conteo previo (sólo lectura):**

  | Instancia | Reportes aprobados | Borradores | Casos | Menciones en 30 días |
  |---|---|---|---|---|
  | Producción | 4 | 0 | 1 | 808 |
  | Preview | 59 | 3 | 3 | 254 |

  Los reportes existentes quedan como versión 1, con su formato anterior.
- **Revertir:**
  1. Revertir el commit.
  2. Exportar las versiones (comandos en el `down.sql`).
  3. Correr el `down.sql`.

  Los reportes aprobados conservan sus cifras y su texto, y los editores vuelven a poder escribir `facts`.

## 10. Limitaciones

- **Dependencia de un caso:** es su responsable actual. Un caso reasignado cuenta para la nueva dependencia,
  también en cierres pasados.
- **Vencido al corte:** usa el plazo vigente del caso, no el que tenía en ese momento.
- **Gráficas:** dependen del agregado horario. Las tarjetas reflejan una corrección al instante y las gráficas
  al procesar la invalidación (la barra de cobertura lo avisa).
- **Asistente:** sigue informando turnos (menciones turnadas), ahora con una nota de unidades. Pasarlo a casos
  queda pendiente.
- **24 h:** sigue siendo una ventana móvil de horas, comparada con las 24 h anteriores.
