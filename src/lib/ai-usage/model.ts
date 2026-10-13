// Consumption panel model (pure): AI usage by day/month, unknown cost kept
// apart from priced cost, limits and the monthly reconciliation with invoices.

import { hasTariff } from "../ai/pricing.ts";

export const PURPOSE_LABELS: Record<string, string> = {
  classify: "Clasificación",
  report: "Reportes",
  assistant: "Asistente",
  daily_reading: "Lectura del día",
};
export const PURPOSES = ["classify", "report", "assistant", "daily_reading"] as const;
export type Purpose = (typeof PURPOSES)[number];

export const DEFAULT_CONCURRENCY: Record<Purpose, number> = { classify: 2, report: 2, assistant: 6, daily_reading: 1 };
export const DEFAULT_USER_DAILY_REQUESTS = 300;

/** Invoice and estimate within this share of each other count as reconciled. */
export const RECONCILE_TOLERANCE = 0.05;

export type UsageRow = {
  day: string;
  model: string;
  purpose: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number;
  unpriced_requests: number;
  unpriced_tokens: number;
  tariff_version: string | null;
};

export type Invoice = { id: string; month: string; amount_usd: number; reference: string | null; notes: string | null };

export type Totals = {
  requests: number;
  tokens: number;
  /** Sum of priced calls only. */
  pricedUsd: number;
  /** Calls with cost unknown (no tariff): never part of pricedUsd, never 0. */
  unpricedRequests: number;
  unpricedTokens: number;
};

export type BreakdownRow = Totals & { purpose: string; model: string; hasTariff: boolean; tariffVersion: string | null };

export type MonthRow = {
  month: string;
  estimate: Totals;
  invoice: Invoice | null;
  /** invoice − priced estimate; null without invoice. */
  difference: number | null;
  status: "sin_factura" | "conciliado" | "diferencia" | "incompleto";
};

const empty = (): Totals => ({ requests: 0, tokens: 0, pricedUsd: 0, unpricedRequests: 0, unpricedTokens: 0 });

function add(t: Totals, r: UsageRow): Totals {
  return {
    requests: t.requests + Number(r.requests),
    tokens: t.tokens + Number(r.input_tokens) + Number(r.output_tokens) + Number(r.cache_read_tokens) + Number(r.cache_write_tokens),
    pricedUsd: t.pricedUsd + Number(r.cost_usd),
    unpricedRequests: t.unpricedRequests + Number(r.unpriced_requests),
    unpricedTokens: t.unpricedTokens + Number(r.unpriced_tokens),
  };
}

export const monthOf = (day: string) => `${day.slice(0, 7)}-01`;

/** Cost shown to people: null (unknown) when every call of the set lacks a tariff, otherwise the priced part. */
export function knownCost(t: Totals): number | null {
  return t.requests > 0 && t.unpricedRequests === t.requests ? null : t.pricedUsd;
}

export function summarize(rows: UsageRow[], invoices: Invoice[], today: string, months = 6) {
  const month = monthOf(today);
  let todayTotals = empty();
  let monthTotals = empty();
  const breakdown = new Map<string, BreakdownRow>();
  const byMonth = new Map<string, Totals>();
  for (const r of rows) {
    if (r.day === today) todayTotals = add(todayTotals, r);
    const m = monthOf(r.day);
    byMonth.set(m, add(byMonth.get(m) ?? empty(), r));
    if (m !== month) continue;
    monthTotals = add(monthTotals, r);
    const key = `${r.purpose}|${r.model}`;
    const prev = breakdown.get(key) ?? { ...empty(), purpose: r.purpose, model: r.model, hasTariff: hasTariff(r.model), tariffVersion: null };
    breakdown.set(key, { ...prev, ...add(prev, r), tariffVersion: r.tariff_version ?? prev.tariffVersion });
  }

  const invoiceByMonth = new Map(invoices.map((i) => [i.month, i]));
  const monthKeys: string[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(`${month}T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - i);
    monthKeys.push(`${d.toISOString().slice(0, 7)}-01`);
  }
  const reconciliation: MonthRow[] = monthKeys.map((m) => {
    const estimate = byMonth.get(m) ?? empty();
    const invoice = invoiceByMonth.get(m) ?? null;
    if (!invoice) return { month: m, estimate, invoice: null, difference: null, status: "sin_factura" };
    const difference = Number(invoice.amount_usd) - estimate.pricedUsd;
    // With calls of unknown cost the estimate is incomplete: the gap is expected, not an error.
    if (estimate.unpricedRequests > 0) return { month: m, estimate, invoice, difference, status: "incompleto" };
    const base = Math.max(Number(invoice.amount_usd), estimate.pricedUsd);
    return { month: m, estimate, invoice, difference, status: base === 0 || Math.abs(difference) <= base * RECONCILE_TOLERANCE ? "conciliado" : "diferencia" };
  });

  const untariffed = [...new Set([...breakdown.values()].filter((b) => !b.hasTariff).map((b) => b.model))];
  return {
    today: todayTotals,
    month: monthTotals,
    breakdown: [...breakdown.values()].sort((a, b) => b.pricedUsd - a.pricedUsd || b.tokens - a.tokens),
    reconciliation,
    untariffed,
  };
}

export type Limits = {
  daily_budget_usd: number | null;
  monthly_budget_usd: number | null;
  daily_token_budget: number | null;
  user_daily_requests: number;
  max_concurrent: Record<Purpose, number>;
};

export function limitsOrDefault(row: Partial<Limits> | null): Limits {
  const concurrency = (row?.max_concurrent ?? {}) as Partial<Record<Purpose, number>>;
  return {
    daily_budget_usd: row?.daily_budget_usd ?? null,
    monthly_budget_usd: row?.monthly_budget_usd ?? null,
    daily_token_budget: row?.daily_token_budget ?? null,
    user_daily_requests: row?.user_daily_requests ?? DEFAULT_USER_DAILY_REQUESTS,
    max_concurrent: Object.fromEntries(PURPOSES.map((p) => [p, concurrency[p] ?? DEFAULT_CONCURRENCY[p]])) as Record<Purpose, number>,
  };
}

/** Share of a budget used (priced + reserved); null without budget. */
export function budgetShare(used: number, budget: number | null): number | null {
  return budget ? Math.min(999, Math.round((used / budget) * 100)) : null;
}
