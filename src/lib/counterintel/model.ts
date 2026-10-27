// Radar Social: kinds, labels and parsing of ci_overview().
// Pure, so it is unit-tested without a database.

export const CI_KINDS = ["disinformation", "impersonation", "bot_network", "threat"] as const;
export type CiKind = (typeof CI_KINDS)[number];

export const CI_KIND_LABELS: Record<CiKind, string> = {
  disinformation: "Desinformación o rumor",
  impersonation: "Suplantación de cuenta o página",
  bot_network: "Cuentas falsas o bots coordinados",
  threat: "Amenaza a funcionarios o instalaciones",
};

export const CI_STATUSES = ["open", "monitoring", "closed"] as const;
export type CiStatus = (typeof CI_STATUSES)[number];

export const CI_STATUS_LABELS: Record<CiStatus, string> = {
  open: "Abierto",
  monitoring: "En seguimiento",
  closed: "Cerrado",
};

export const CI_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type CiSeverity = (typeof CI_SEVERITIES)[number];

export const CI_SEVERITY_LABELS: Record<CiSeverity, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
  critical: "Crítica",
};

export type CiThreat = {
  id: string;
  publishedAt: string;
  text: string;
  source: string | null;
  severity: "high" | "emergency";
  incidentType: string | null;
  /** Only media and public figures; citizens are never named. */
  author: string | null;
  url: string | null;
};

/** A mention whose text carries an indicator of an open report. */
export type CiMatch = {
  id: string;
  publishedAt: string;
  text: string;
  source: string | null;
  reportId: string;
  reportTitle: string;
  indicator: string;
  /** Only media and public figures; citizens are never named. */
  author: string | null;
  url: string | null;
};

export type CiOverview = { threats: CiThreat[]; matches: CiMatch[] };

const str = (v: unknown) => (typeof v === "string" ? v : null);
const list = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

export function parseOverview(raw: unknown): CiOverview {
  const data = (raw ?? {}) as { threats?: unknown; matches?: unknown };
  return {
    threats: list(data.threats)
      .filter((t) => str(t.id))
      .map((t) => ({
        id: str(t.id)!,
        publishedAt: str(t.published_at) ?? "",
        text: str(t.text) ?? "",
        source: str(t.source),
        severity: t.severity === "emergency" ? "emergency" : "high",
        incidentType: str(t.incident_type),
        author: str(t.author),
        url: str(t.url),
      })),
    matches: list(data.matches)
      .filter((m) => str(m.id) && str(m.report_id))
      .map((m) => ({
        id: str(m.id)!,
        publishedAt: str(m.published_at) ?? "",
        text: str(m.text) ?? "",
        source: str(m.source),
        reportId: str(m.report_id)!,
        reportTitle: str(m.report_title) ?? "",
        indicator: str(m.indicator) ?? "",
        author: str(m.author),
        url: str(m.url),
      })),
  };
}

/** One indicator per line (accounts, URLs, domains, hashtags); blanks and repeats dropped. */
export function parseIndicators(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const value = line.trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Mention ids pasted as ids or as links to /bandeja/<id>; repeats dropped. */
export function parseMentionRefs(text: string): string[] {
  return [...new Set((text.match(UUID) ?? []).map((id) => id.toLowerCase()))];
}
