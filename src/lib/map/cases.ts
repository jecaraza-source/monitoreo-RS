// The cases layer of the map: rows from map_case_rows (already scoped by RLS)
// aggregated per colonia, the points of confirmed locations and the links
// to /casos with the same filters. Pure.
import type { CaseStatus } from "../cases/model.ts";
import type { Priority } from "../inbox/model.ts";
import type { MapFilters } from "./model.ts";

export type CaseMapRow = {
  id: string;
  folio: string;
  status: CaseStatus;
  priority: Priority;
  category: string | null;
  neighborhood_id: string | null;
  department_id: string | null;
  location_status: "confirmed" | "inferred" | "unavailable";
  location_confidence: number | null;
  lat: number | null;
  lng: number | null;
  overdue: boolean;
  opened_at: string;
};

export type CaseColoniaRow = {
  id: string;
  name: string;
  approx: boolean;
  /** Drawn on the map (has a valid polygon). */
  drawable: boolean;
  /** Why it is not drawn ("Sin polígono", "Polígono inválido: …"). */
  problem: string | null;
  total: number;
  overdue: number;
  confirmed: number;
  inferred: number;
  byPriority: Record<Priority, number>;
};

export type CasePoint = { id: string; folio: string; status: CaseStatus; priority: Priority; lat: number; lng: number };

export type CaseLayer = {
  rows: CaseColoniaRow[];
  /** Cases with a colonia (the denominator of the legend). */
  located: number;
  /** Cases of the filters without location. */
  unlocated: CaseMapRow[];
  total: number;
  points: CasePoint[];
  /** Cases whose colonia has no drawable polygon (counted, not drawn). */
  undrawn: number;
  /** Categories of these cases, for the filter. */
  categories: string[];
};

const ZERO: Record<Priority, number> = { critical: 0, high: 0, medium: 0, low: 0 };

export function buildCaseLayer(
  cases: CaseMapRow[],
  colonias: { id: string; name: string; approx: boolean; drawable: boolean; problem: string | null }[],
): CaseLayer {
  const rows = new Map<string, CaseColoniaRow>(
    colonias.map((c) => [c.id, { ...c, total: 0, overdue: 0, confirmed: 0, inferred: 0, byPriority: { ...ZERO } }]),
  );
  const unlocated: CaseMapRow[] = [];
  const points: CasePoint[] = [];
  let located = 0;
  let undrawn = 0;
  for (const c of cases) {
    const row = c.neighborhood_id ? rows.get(c.neighborhood_id) : undefined;
    if (!row) {
      unlocated.push(c);
      continue;
    }
    located++;
    row.total++;
    if (c.overdue) row.overdue++;
    if (c.location_status === "confirmed") row.confirmed++;
    else row.inferred++;
    row.byPriority[c.priority]++;
    if (!row.drawable) undrawn++;
    // Only an analyst's confirmation carries a point; an inferred colonia never does.
    if (c.location_status === "confirmed" && c.lat !== null && c.lng !== null) {
      points.push({ id: c.id, folio: c.folio, status: c.status, priority: c.priority, lat: Number(c.lat), lng: Number(c.lng) });
    }
  }
  const categories = [...new Set(cases.flatMap((c) => (c.category ? [c.category] : [])))].sort((a, b) => a.localeCompare(b, "es"));
  return { rows: [...rows.values()], located, unlocated, total: cases.length, points, undrawn, categories };
}

export const CASE_METRICS = {
  casos: { label: "Casos", unit: (v: number) => `${v} ${v === 1 ? "caso" : "casos"}`, value: (r: CaseColoniaRow) => r.total },
  vencidos: { label: "Vencidos", unit: (v: number) => `${v} ${v === 1 ? "caso vencido" : "casos vencidos"}`, value: (r: CaseColoniaRow) => r.overdue },
} as const;

export const CASE_STATUS_FILTER_LABELS: Record<string, string> = {
  open: "Abiertos",
  all: "Todos",
  new: "Detectados",
  in_review: "En revisión",
  assigned: "Asignados",
  accepted: "Aceptados",
  in_progress: "En atención",
  resolved: "Pendientes de validación",
  closed: "Cerrados",
  returned: "Devueltos",
  discarded: "Descartados",
};

/** The filters of map_case_rows for the map filters and period (Mexico City days). */
export function caseRowFilters(filters: MapFilters, period: { fromDay: string; toDay: string }) {
  return {
    from: period.fromDay,
    to: period.toDay,
    neighborhood: filters.colonia === "sin" ? "none" : filters.colonia,
    category: filters.tema,
    priority: filters.prioridad,
    status: filters.estado,
    department: filters.dependencia,
  };
}

/** /casos with exactly the map's filters (and a colonia, or "sin"), so both show the same cases. */
export function casesHref(filters: MapFilters, period: { fromDay: string; toDay: string }, colonia?: string | null): string {
  const p = new URLSearchParams();
  p.set("estado", filters.estado);
  p.set("desde", period.fromDay);
  p.set("hasta", period.toDay);
  const c = colonia === undefined ? filters.colonia : colonia;
  if (c) p.set("colonia", c);
  if (filters.tema) p.set("categoria", filters.tema);
  if (filters.prioridad) p.set("prioridad", filters.prioridad);
  if (filters.dependencia) p.set("dependencia", filters.dependencia);
  return `/casos?${p.toString()}`;
}

export const LOCATION_LABELS = {
  confirmed: "Confirmada",
  inferred: "Inferida",
  unavailable: "No disponible",
} as const;

export const LOCATION_SOURCE_LABELS: Record<string, string> = {
  analista: "confirmada por un analista",
  clasificacion: "leída del texto por el clasificador",
  clasificacion_revisada: "de la clasificación revisada por una persona",
  captura: "capturada al abrir o editar el caso, sin confirmar",
  sin_dato: "sin datos para inferirla",
};
