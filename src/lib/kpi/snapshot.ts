// kpi_snapshot() → typed figures, KPI values with their change, coverage and
// comparability notes, and the department breakdown. Every derived figure
// (rates, NSS, changes) is computed here, in code, from the snapshot's counts.
// Pure: shared by the dashboard, the reports and unit tests.
import { nss } from "../dashboard/model.ts";
import {
  KPI_BY_KEY,
  KPI_DEFINITIONS,
  MIN_CASES_TO_COMPARE,
  MIN_CYCLES_FOR_MEDIAN,
  MIN_MENTIONS_TO_COMPARE,
  type KpiDefinition,
  type KpiFamily,
} from "./dictionary.ts";

const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : 0);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
const r1 = (v: number) => Math.round(v * 10) / 10;
type Raw = Record<string, unknown>;

export type Conversation = {
  mentions: number;
  classified: number;
  unclassified: number;
  pending: number;
  failed: number;
  positive: number;
  neutral: number;
  negative: number;
  complaints: number;
  reviewed: number;
  withoutNeighborhood: number;
  withoutTopic: number;
  discarded: number;
  interactions: number;
};

export type Attention = {
  opened: number;
  openedWithoutCategory: number;
  openedWithoutLocation: number;
  openAtCut: number;
  overdueAtCut: number;
  openWithoutDue: number;
  awaitingFirstAttention: number;
  firstAttention: { n: number; median: number | null; p90: number | null };
  resolution: { n: number; median: number | null; p90: number | null };
  validatedClosures: number;
  validationRejections: number;
  reopenings: number;
  discarded: number;
};

export type DepartmentRow = {
  id: string | null;
  name: string;
  createdAt: string | null;
  opened: number;
  openAtCut: number;
  overdueAtCut: number;
  validatedClosures: number;
  resolution: { n: number; median: number | null; p90: number | null };
  reopenings: number;
  mentions: number;
  positiveMentions: number;
  negativeMentions: number;
  complaintMentions: number;
};

export type PendingCase = {
  id: string;
  folio: string;
  category: string | null;
  priority: string;
  status: string;
  department: string | null;
  neighborhood: string | null;
  overdueHours: number | null;
};

export type KpiSnapshot = {
  snapshotVersion: number;
  asOf: string;
  period: { from: string; to: string; cut: string; prevFrom: string; prevTo: string; prevCut: string };
  conversation: { current: Conversation; previous: Conversation };
  attention: { current: Attention; previous: Attention };
  departments: DepartmentRow[];
  series: { bucket: string; positive: number; neutral: number; negative: number; pending: number }[];
  attentionSeries: { bucket: string; opened: number; closed: number }[];
  topics: { topic: string; total: number; positive: number; negative: number; complaints: number }[];
  pendingCases: PendingCase[];
  coverage: {
    sourcesActive: number;
    sourcesPartial: { name: string; type: string; coveredUntil: string | null }[];
    lastMentionAt: string | null;
    lastClassifiedAt: string | null;
    rollupRefreshedAt: string | null;
    pendingCorrections: number;
  };
  catalog: { departmentsAdded: string[]; neighborhoodsAdded: number; sourcesAdded: string[] };
};

function conversation(r: Raw | undefined): Conversation {
  const c = r ?? {};
  return {
    mentions: num(c.mentions),
    classified: num(c.classified),
    unclassified: num(c.unclassified),
    pending: num(c.pending),
    failed: num(c.failed),
    positive: num(c.positive),
    neutral: num(c.neutral),
    negative: num(c.negative),
    complaints: num(c.complaints),
    reviewed: num(c.reviewed),
    withoutNeighborhood: num(c.without_neighborhood),
    withoutTopic: num(c.without_topic),
    discarded: num(c.discarded),
    interactions: num(c.interactions),
  };
}

function attention(r: Raw | undefined): Attention {
  const a = r ?? {};
  return {
    opened: num(a.opened),
    openedWithoutCategory: num(a.opened_without_category),
    openedWithoutLocation: num(a.opened_without_location),
    openAtCut: num(a.open_at_cut),
    overdueAtCut: num(a.overdue_at_cut),
    openWithoutDue: num(a.open_without_due),
    awaitingFirstAttention: num(a.awaiting_first_attention),
    firstAttention: { n: num(a.first_attention_n), median: numOrNull(a.first_attention_median_h), p90: numOrNull(a.first_attention_p90_h) },
    resolution: { n: num(a.resolution_n), median: numOrNull(a.resolution_median_h), p90: numOrNull(a.resolution_p90_h) },
    validatedClosures: num(a.validated_closures),
    validationRejections: num(a.validation_rejections),
    reopenings: num(a.reopenings),
    discarded: num(a.discarded),
  };
}

const list = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);

export function parseKpiSnapshot(raw: unknown): KpiSnapshot {
  const s = (raw ?? {}) as Raw;
  const p = (s.period ?? {}) as Raw;
  const conv = (s.conversation ?? {}) as Raw;
  const att = (s.attention ?? {}) as Raw;
  const cov = (s.coverage ?? {}) as Raw;
  const cat = (s.catalog ?? {}) as Raw;
  return {
    snapshotVersion: num(s.snapshot_version),
    asOf: String(s.as_of ?? ""),
    period: {
      from: String(p.from ?? ""),
      to: String(p.to ?? ""),
      cut: String(p.cut ?? ""),
      prevFrom: String(p.prev_from ?? ""),
      prevTo: String(p.prev_to ?? ""),
      prevCut: String(p.prev_cut ?? ""),
    },
    conversation: { current: conversation(conv.current as Raw), previous: conversation(conv.previous as Raw) },
    attention: { current: attention(att.current as Raw), previous: attention(att.previous as Raw) },
    departments: list(s.departments).map((d) => ({
      id: (d.id as string | null) ?? null,
      name: String(d.name ?? "Sin asignar"),
      createdAt: (d.created_at as string | null) ?? null,
      opened: num(d.opened),
      openAtCut: num(d.open_at_cut),
      overdueAtCut: num(d.overdue_at_cut),
      validatedClosures: num(d.validated_closures),
      resolution: { n: num(d.validated_closures), median: numOrNull(d.resolution_median_h), p90: numOrNull(d.resolution_p90_h) },
      reopenings: num(d.reopenings),
      mentions: num(d.mentions),
      positiveMentions: num(d.positive_mentions),
      negativeMentions: num(d.negative_mentions),
      complaintMentions: num(d.complaint_mentions),
    })),
    series: list(s.series).map((x) => ({
      bucket: String(x.bucket),
      positive: num(x.positive),
      neutral: num(x.neutral),
      negative: num(x.negative),
      pending: num(x.pending),
    })),
    attentionSeries: list(s.attention_series).map((x) => ({ bucket: String(x.bucket), opened: num(x.opened), closed: num(x.closed) })),
    topics: list(s.topics).map((t) => ({
      topic: String(t.topic),
      total: num(t.total),
      positive: num(t.positive),
      negative: num(t.negative),
      complaints: num(t.complaints),
    })),
    pendingCases: list(s.pending_cases).map((c) => ({
      id: String(c.id),
      folio: String(c.folio ?? ""),
      category: (c.category as string | null) ?? null,
      priority: String(c.priority ?? ""),
      status: String(c.status ?? ""),
      department: (c.department as string | null) ?? null,
      neighborhood: (c.neighborhood as string | null) ?? null,
      overdueHours: numOrNull(c.overdue_hours),
    })),
    coverage: {
      sourcesActive: num(cov.sources_active),
      sourcesPartial: list(cov.sources_partial).map((x) => ({
        name: String(x.name),
        type: String(x.type),
        coveredUntil: (x.covered_until as string | null) ?? null,
      })),
      lastMentionAt: (cov.last_mention_at as string | null) ?? null,
      lastClassifiedAt: (cov.last_classified_at as string | null) ?? null,
      rollupRefreshedAt: (cov.rollup_refreshed_at as string | null) ?? null,
      pendingCorrections: num(cov.pending_corrections),
    },
    catalog: {
      departmentsAdded: (Array.isArray(cat.departments_added) ? cat.departments_added : []).map(String),
      neighborhoodsAdded: num(cat.neighborhoods_added),
      sourcesAdded: (Array.isArray(cat.sources_added) ? cat.sources_added : []).map(String),
    },
  };
}

// ---------------------------------------------------------------------------
// KPI values
// ---------------------------------------------------------------------------

export type KpiValue = {
  def: KpiDefinition;
  value: number | null;
  previous: number | null;
  /** % for counts and hours, points for %, NSS. Null when it cannot be compared. */
  change: number | null;
  changeUnit: "%" | "puntos";
  /** Size of the population behind the value (classified mentions, cycles…). */
  n: number | null;
  /** Secondary figure (p90 for times, % for shares). */
  detail: string | null;
};

const pct = (part: number, total: number): number | null => (total > 0 ? r1((part / total) * 100) : null);
const relChange = (now: number | null, before: number | null) => (now == null || before == null || before === 0 ? null : r1(((now - before) / before) * 100));
const pointChange = (now: number | null, before: number | null) => (now == null || before == null ? null : r1(now - before));

function conversationValue(key: string, c: Conversation): { value: number | null; n: number | null } {
  switch (key) {
    case "mentions":
      return { value: c.mentions, n: null };
    case "unclassified":
      return { value: c.unclassified, n: c.mentions };
    case "nss":
      return { value: c.classified ? r1(nss(c.positive, c.negative, c.classified)) : null, n: c.classified };
    case "negative_pct":
      return { value: pct(c.negative, c.classified), n: c.classified };
    case "complaints":
      return { value: c.complaints, n: null };
    case "interactions":
      return { value: c.interactions, n: null };
    case "without_neighborhood_pct":
      return { value: pct(c.withoutNeighborhood, c.classified), n: c.classified };
    default:
      return { value: null, n: null };
  }
}

function attentionValue(key: string, a: Attention): { value: number | null; n: number | null; detail: string | null } {
  switch (key) {
    case "cases_opened":
      return { value: a.opened, n: null, detail: null };
    case "open_at_cut":
      return { value: a.openAtCut, n: null, detail: null };
    case "overdue_at_cut":
      return { value: a.overdueAtCut, n: a.openAtCut, detail: a.openAtCut ? `${pct(a.overdueAtCut, a.openAtCut)} % de los abiertos` : null };
    case "first_attention_h":
      return { value: a.firstAttention.median, n: a.firstAttention.n, detail: a.firstAttention.p90 == null ? null : `p90 ${a.firstAttention.p90} h` };
    case "resolution_h":
      return { value: a.resolution.median, n: a.resolution.n, detail: a.resolution.p90 == null ? null : `p90 ${a.resolution.p90} h` };
    case "validated_closures":
      return { value: a.validatedClosures, n: null, detail: a.validationRejections ? `${a.validationRejections} devueltos en validación` : null };
    case "reopenings":
      return { value: a.reopenings, n: null, detail: null };
    default:
      return { value: null, n: null, detail: null };
  }
}

/** Every KPI of a family with its value, previous value and change (computed here). */
export function kpiValues(snapshot: KpiSnapshot, family: KpiFamily): KpiValue[] {
  return KPI_DEFINITIONS.filter((d) => d.family === family).map((def) => {
    const pointsUnit = def.unit === "%" || def.unit === "puntos";
    if (family === "conversacion") {
      const now = conversationValue(def.key, snapshot.conversation.current);
      const before = conversationValue(def.key, snapshot.conversation.previous);
      const share = def.key === "unclassified" && now.n ? `${pct(snapshot.conversation.current.unclassified, now.n)} % de las menciones` : null;
      return {
        def,
        value: now.value,
        previous: before.value,
        change: pointsUnit ? pointChange(now.value, before.value) : relChange(now.value, before.value),
        changeUnit: pointsUnit ? "puntos" : "%",
        n: now.n,
        detail: share,
      };
    }
    const now = attentionValue(def.key, snapshot.attention.current);
    const before = attentionValue(def.key, snapshot.attention.previous);
    // A median over fewer cycles than the minimum is shown, but not compared.
    const thin = (def.key === "first_attention_h" || def.key === "resolution_h") && ((now.n ?? 0) < MIN_CYCLES_FOR_MEDIAN || (before.n ?? 0) < MIN_CYCLES_FOR_MEDIAN);
    return {
      def,
      value: now.value,
      previous: before.value,
      change: thin ? null : relChange(now.value, before.value),
      changeUnit: "%",
      n: now.n,
      detail: now.detail,
    };
  });
}

export const kpi = (values: KpiValue[], key: string) => values.find((v) => v.def.key === key) ?? null;

// ---------------------------------------------------------------------------
// Coverage and comparability
// ---------------------------------------------------------------------------

/**
 * Why a comparison with the previous period may not be like for like:
 * classification coverage moved, sources or catalogs changed, partial reads.
 */
export function comparabilityNotes(s: KpiSnapshot): string[] {
  const notes: string[] = [];
  const now = s.conversation.current;
  const before = s.conversation.previous;
  const share = (c: Conversation) => (c.mentions ? (c.unclassified / c.mentions) * 100 : 0);
  if (Math.abs(share(now) - share(before)) >= 5) {
    notes.push(
      `La cobertura de clasificación cambió: ${r1(share(now))} % sin clasificar ahora contra ${r1(share(before))} % en el periodo anterior; sentimiento y temas no son del todo comparables.`,
    );
  }
  if (s.catalog.sourcesAdded.length) notes.push(`Fuentes agregadas desde el periodo anterior: ${s.catalog.sourcesAdded.join(", ")}. El volumen puede crecer por cobertura, no por conversación.`);
  if (s.catalog.departmentsAdded.length) notes.push(`Dependencias nuevas en el catálogo: ${s.catalog.departmentsAdded.join(", ")}. Sus cifras no tienen periodo anterior comparable.`);
  if (s.catalog.neighborhoodsAdded) notes.push(`${s.catalog.neighborhoodsAdded} colonias agregadas al catálogo: cambia la asignación por colonia.`);
  if (s.coverage.sourcesPartial.length) {
    notes.push(`${s.coverage.sourcesPartial.length} de ${s.coverage.sourcesActive} fuentes activas no están leídas hasta el corte: las cifras del periodo pueden crecer.`);
  }
  if (s.coverage.pendingCorrections) notes.push(`${s.coverage.pendingCorrections} correcciones recientes aún no se reflejan en las gráficas (las tarjetas ya las incluyen).`);
  return notes;
}

// ---------------------------------------------------------------------------
// Departments: breakdowns, never a ranking on thin volume
// ---------------------------------------------------------------------------

export type DepartmentComparison = DepartmentRow & {
  /** Too few cases to compare rates or times between departments. */
  lowVolume: boolean;
  /** Median over too few closed cycles: shown with n, not compared. */
  thinMedian: boolean;
  /** Added to the catalog during the compared periods. */
  newInCatalog: boolean;
  overduePct: number | null;
};

/** Alphabetical (a fixed order, not a ranking), with the flags that limit comparisons. */
export function compareDepartments(s: KpiSnapshot): DepartmentComparison[] {
  const since = Date.parse(s.period.prevFrom);
  return s.departments
    .map((d) => ({
      ...d,
      lowVolume: d.opened + d.openAtCut < MIN_CASES_TO_COMPARE && d.mentions < MIN_MENTIONS_TO_COMPARE,
      thinMedian: d.resolution.n < MIN_CYCLES_FOR_MEDIAN,
      newInCatalog: d.createdAt != null && Number.isFinite(since) && Date.parse(d.createdAt) >= since,
      overduePct: d.openAtCut ? r1((d.overdueAtCut / d.openAtCut) * 100) : null,
    }))
    .sort((a, b) => (a.id === null ? 1 : b.id === null ? -1 : a.name.localeCompare(b.name, "es")));
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** CSV of the department breakdown (the reader already sees these rows). */
export function departmentsCsv(rows: DepartmentComparison[]): string {
  const header = [
    "Dependencia",
    "Casos nuevos",
    "Abiertos al corte",
    "Vencidos al corte",
    "% vencidos",
    "Cierres validados",
    "Resolución mediana (h)",
    "Resolución p90 (h)",
    "Ciclos cerrados (n)",
    "Reaperturas",
    "Menciones",
    "Menciones negativas",
    "Menciones de queja",
    "Nota",
  ];
  const lines = rows.map((r) =>
    [
      r.name,
      r.opened,
      r.openAtCut,
      r.overdueAtCut,
      r.overduePct,
      r.validatedClosures,
      r.resolution.median,
      r.resolution.p90,
      r.resolution.n,
      r.reopenings,
      r.mentions,
      r.negativeMentions,
      r.complaintMentions,
      [r.lowVolume ? "volumen bajo" : "", r.thinMedian && r.resolution.n ? "mediana con pocos casos" : "", r.newInCatalog ? "nueva en el catálogo" : ""]
        .filter(Boolean)
        .join("; "),
    ]
      .map(csvCell)
      .join(","),
  );
  return `﻿${[header.join(","), ...lines].join("\n")}\n`;
}

export function definition(key: string): KpiDefinition | null {
  return KPI_BY_KEY[key] ?? null;
}
