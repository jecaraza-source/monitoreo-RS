// KPI dictionary: every indicator of the dashboard and the reports, with its
// formula, unit, source, period, denominator and how reopened cases and
// missing data count. Versioned: a report stores KPI_VERSION with its figures,
// so an approved report keeps the definitions it was computed with.
//
// Two families with different units, never mixed: conversation counts
// mentions (publications); attention counts cases (incidents) and hours.
// Pure: shared by the server, the client and unit tests.

export const KPI_VERSION = "KPI-2026.11";
/** kpi_snapshot() output version the definitions read (supabase/migrations/20261102000000_kpi_snapshot.sql). */
export const SNAPSHOT_VERSION = 1;

export type KpiFamily = "conversacion" | "atencion";
export type KpiUnit = "menciones" | "interacciones" | "puntos" | "%" | "casos" | "horas";

export type KpiDefinition = {
  key: string;
  family: KpiFamily;
  label: string;
  unit: KpiUnit;
  formula: string;
  /** Function and field the figure comes from: the consulta base. */
  source: string;
  period: string;
  denominator: string;
  /** How reopened cases count (attention) or "No aplica". */
  reopened: string;
  /** How rows without the data the KPI needs are treated. */
  missing: string;
  /** Higher is better (green), worse (red) or neither. */
  direction: "up" | "down" | "none";
};

const MENTION_PERIOD = "Fecha de publicación dentro del periodo, en días de la Ciudad de México, hasta el corte.";
const NO_REOPEN = "No aplica: es conversación, no casos.";

export const KPI_DEFINITIONS: readonly KpiDefinition[] = [
  // ------------------------------------------------------------------ conversation
  {
    key: "mentions",
    family: "conversacion",
    label: "Menciones",
    unit: "menciones",
    formula: "Número de publicaciones recolectadas.",
    source: "kpi_snapshot → conversation.mentions (mentions.published_at)",
    period: MENTION_PERIOD,
    denominator: "—",
    reopened: NO_REOPEN,
    missing: "Las que aún no se clasifican cuentan aquí y se informan aparte como «sin clasificar».",
    direction: "none",
  },
  {
    key: "unclassified",
    family: "conversacion",
    label: "Sin clasificar",
    unit: "menciones",
    formula: "Menciones del periodo sin clasificación (pendientes o fallidas).",
    source: "kpi_snapshot → conversation.unclassified",
    period: MENTION_PERIOD,
    denominator: "Menciones del periodo (para el %).",
    reopened: NO_REOPEN,
    missing: "Es la cobertura: no entran a sentimiento, temas ni colonias.",
    direction: "down",
  },
  {
    key: "nss",
    family: "conversacion",
    label: "Sentimiento neto (NSS)",
    unit: "puntos",
    formula: "(positivas − negativas) ÷ clasificadas × 100, de −100 a 100.",
    source: "kpi_snapshot → conversation.positive, negative, classified",
    period: MENTION_PERIOD,
    denominator: "Menciones clasificadas.",
    reopened: NO_REOPEN,
    missing: "Las sin clasificar no cuentan; si no hay clasificadas no se calcula.",
    direction: "up",
  },
  {
    key: "negative_pct",
    family: "conversacion",
    label: "Menciones negativas",
    unit: "%",
    formula: "negativas ÷ clasificadas × 100.",
    source: "kpi_snapshot → conversation.negative, classified",
    period: MENTION_PERIOD,
    denominator: "Menciones clasificadas.",
    reopened: NO_REOPEN,
    missing: "Las sin clasificar no cuentan.",
    direction: "down",
  },
  {
    key: "complaints",
    family: "conversacion",
    label: "Menciones de queja",
    unit: "menciones",
    formula: "Menciones clasificadas con intención «queja» o «denuncia». Son publicaciones, no incidentes: un problema puede tener muchas.",
    source: "kpi_snapshot → conversation.complaints",
    period: MENTION_PERIOD,
    denominator: "—",
    reopened: NO_REOPEN,
    missing: "Las sin clasificar no cuentan.",
    direction: "down",
  },
  {
    key: "interactions",
    family: "conversacion",
    label: "Interacciones",
    unit: "interacciones",
    formula: "Suma de reacciones, compartidos y comentarios de las menciones.",
    source: "kpi_snapshot → conversation.interactions (mentions.metrics)",
    period: MENTION_PERIOD,
    denominator: "—",
    reopened: NO_REOPEN,
    missing: "Fuentes sin métricas (RSS) suman 0.",
    direction: "none",
  },
  {
    key: "without_neighborhood_pct",
    family: "conversacion",
    label: "Clasificadas sin colonia",
    unit: "%",
    formula: "clasificadas sin colonia ÷ clasificadas × 100.",
    source: "kpi_snapshot → conversation.without_neighborhood, classified",
    period: MENTION_PERIOD,
    denominator: "Menciones clasificadas.",
    reopened: NO_REOPEN,
    missing: "Es cobertura geográfica: el mapa y los desgloses por colonia no las incluyen.",
    direction: "down",
  },
  // ------------------------------------------------------------------ attention
  {
    key: "cases_opened",
    family: "atencion",
    label: "Casos nuevos",
    unit: "casos",
    formula: "Casos abiertos en el periodo. Un caso fusionado es un duplicado y no cuenta.",
    source: "kpi_snapshot → attention.opened (cases.opened_at)",
    period: "Fecha de apertura dentro del periodo (días de la Ciudad de México), hasta el corte.",
    denominator: "—",
    reopened: "Una reapertura no es un caso nuevo; se cuenta en «Reaperturas».",
    missing: "Sin categoría o sin ubicación cuentan igual y se informan aparte.",
    direction: "none",
  },
  {
    key: "open_at_cut",
    family: "atencion",
    label: "Casos abiertos al corte",
    unit: "casos",
    formula: "Casos cuyo estado al corte (último hito hasta ese momento) es abierto: detectado, en revisión, asignado, aceptado, en atención, pendiente de validación o devuelto.",
    source: "kpi_snapshot → attention.open_at_cut (case_milestones)",
    period: "Existencia al corte: el último instante del periodo (o ahora, si el periodo incluye hoy).",
    denominator: "—",
    reopened: "Un caso reabierto vuelve a contar como abierto desde su reapertura.",
    missing: "Un caso sin hitos (anterior a la etapa 6) usa su estado actual.",
    direction: "down",
  },
  {
    key: "overdue_at_cut",
    family: "atencion",
    label: "Casos vencidos al corte",
    unit: "casos",
    formula: "Casos abiertos al corte cuyo plazo del paso actual ya pasó: aceptación si está asignado; atención si está aceptado o en atención.",
    source: "kpi_snapshot → attention.overdue_at_cut",
    period: "Existencia al corte.",
    denominator: "Casos abiertos al corte (para el %).",
    reopened: "Un caso reabierto se evalúa con sus plazos vigentes.",
    missing: "Sin plazo no puede vencer: se informan aparte como «sin plazo». Se usa el plazo vigente del caso.",
    direction: "down",
  },
  {
    key: "first_attention_h",
    family: "atencion",
    label: "Tiempo de primera atención (mediana)",
    unit: "horas",
    formula: "Mediana de horas entre el inicio del ciclo del caso y su primera aceptación por la dependencia. Se muestra también el percentil 90 y n.",
    source: "kpi_snapshot → attention.first_attention_median_h (case_cycle_times)",
    period: "Ciclos aceptados dentro del periodo.",
    denominator: "Ciclos aceptados en el periodo (n).",
    reopened: "Cada ciclo se mide desde su propio inicio (la reapertura).",
    missing: "Los casos aún sin aceptar no entran a la mediana: se cuentan en «Sin primera atención».",
    direction: "down",
  },
  {
    key: "resolution_h",
    family: "atencion",
    label: "Tiempo de resolución (mediana)",
    unit: "horas",
    formula: "Mediana de horas entre el inicio del ciclo y su cierre validado. Se muestra también el percentil 90 y n.",
    source: "kpi_snapshot → attention.resolution_median_h (case_cycle_times)",
    period: "Ciclos cerrados (validados) dentro del periodo.",
    denominator: "Ciclos cerrados en el periodo (n).",
    reopened: "Cada ciclo cuenta por separado; el cierre anterior a una reapertura no se borra.",
    missing: "Los casos sin cerrar no entran a la mediana.",
    direction: "down",
  },
  {
    key: "validated_closures",
    family: "atencion",
    label: "Cierres validados",
    unit: "casos",
    formula: "Casos que pasaron a «cerrado» en el periodo; sólo se cierra con validación de coordinación.",
    source: "kpi_snapshot → attention.validated_closures (case_milestones)",
    period: "Fecha del cierre dentro del periodo.",
    denominator: "—",
    reopened: "Un caso cerrado, reabierto y cerrado otra vez cuenta dos cierres (uno por ciclo).",
    missing: "No aplica.",
    direction: "up",
  },
  {
    key: "reopenings",
    family: "atencion",
    label: "Reaperturas",
    unit: "casos",
    formula: "Casos que salieron de «cerrado» en el periodo porque el problema persistió.",
    source: "kpi_snapshot → attention.reopenings (case_milestones)",
    period: "Fecha de la reapertura dentro del periodo.",
    denominator: "—",
    reopened: "Es el indicador de reaperturas.",
    missing: "No aplica.",
    direction: "down",
  },
] as const;

export const KPI_BY_KEY: Record<string, KpiDefinition> = Object.fromEntries(KPI_DEFINITIONS.map((d) => [d.key, d]));

export const FAMILY_LABELS: Record<KpiFamily, string> = {
  conversacion: "Conversación y percepción",
  atencion: "Atención y cumplimiento",
};

/** Department comparisons: below these volumes a figure is shown with its n but never ranked. */
export const MIN_CASES_TO_COMPARE = 5;
export const MIN_CYCLES_FOR_MEDIAN = 3;
export const MIN_MENTIONS_TO_COMPARE = 20;
