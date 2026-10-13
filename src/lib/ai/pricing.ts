// Versioned list prices (USD per million tokens) used to estimate cost in
// ai_calls/ai_usage. The invoice is the source of truth (Configuración →
// Consumo de IA reconciles both). A model missing from the tariff in force has
// cost UNKNOWN: its tokens are counted but its cost is never shown as 0.
//
// To change prices add a new tariff with its effective date (do not edit an old
// one): each call stores the version that priced it. Never invent a price: a
// model or tier without a published price stays unknown.

export type Price = { input: number; output: number; cacheRead: number; cacheWrite: number };

type ModelPrice = Price & {
  /**
   * Higher rate when the prompt (input + cache read + cache write) exceeds
   * `above` tokens. Cache rates of that tier are not published, so a call in
   * it that used the cache has cost unknown.
   */
  longContext?: { above: number; input: number; output: number };
};

export type Tariff = { version: string; effectiveFrom: string; source: string; models: Record<string, ModelPrice> };

export const TARIFFS: readonly Tariff[] = [
  {
    version: "2026-10",
    effectiveFrom: "2026-10-01",
    source: "Precios de lista de Anthropic vigentes en octubre de 2026 (escritura de caché a 5 minutos).",
    models: {
      "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, longContext: { above: 100_000, input: 0.5, output: 2.5 } },
      "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
      "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
      "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
    },
  },
];

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export const emptyUsage = (): TokenUsage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

export const totalTokens = (u: TokenUsage) => u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens;

/**
 * The tariff key of a model identifier: lower case, without a date snapshot
 * ("-20261001"), "-latest", a context-window suffix ("[1m]") or a provider
 * prefix ("anthropic.", "anthropic/"). Unknown families come back as they are.
 */
export function normalizeModelId(id: string): string {
  return id
    .trim()
    .toLowerCase()
    .replace(/^anthropic[./]/, "")
    .replace(/\[[^\]]*\]$/, "")
    .replace(/[-@](\d{8}|latest)$/, "")
    .replace(/-v\d+(:\d+)?$/, "");
}

/** The tariff in force on a date (the latest whose effectiveFrom is not after it). */
export function tariffAt(at: Date = new Date()): Tariff | null {
  const day = at.toISOString().slice(0, 10);
  const valid = TARIFFS.filter((t) => t.effectiveFrom <= day).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return valid[0] ?? null;
}

export type CostEstimate =
  | { status: "priced"; usd: number; tariff: string }
  | { status: "unknown"; reason: "no_tariff" | "tier_without_price"; tariff: string | null };

/** Prices one call. Never returns 0 for something it cannot price. */
export function priceUsage(model: string, usage: TokenUsage, at: Date = new Date()): CostEstimate {
  const tariff = tariffAt(at);
  const price = tariff?.models[normalizeModelId(model)];
  if (!tariff || !price) return { status: "unknown", reason: "no_tariff", tariff: tariff?.version ?? null };
  const prompt = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  let { input, output } = price;
  if (price.longContext && prompt > price.longContext.above) {
    if (usage.cacheReadTokens > 0 || usage.cacheWriteTokens > 0) return { status: "unknown", reason: "tier_without_price", tariff: tariff.version };
    ({ input, output } = price.longContext);
  }
  const usd =
    (usage.inputTokens * input + usage.outputTokens * output + usage.cacheReadTokens * price.cacheRead + usage.cacheWriteTokens * price.cacheWrite) /
    1_000_000;
  return { status: "priced", usd, tariff: tariff.version };
}

/** Estimated USD for one call; null when the cost is unknown (never 0 for that case). */
export function estimateCost(model: string, usage: TokenUsage): number | null {
  const cost = priceUsage(model, usage);
  return cost.status === "priced" ? cost.usd : null;
}

/** Whether the tariff in force has a price for the model (warning in the consumption panel). */
export function hasTariff(model: string, at: Date = new Date()): boolean {
  return Boolean(tariffAt(at)?.models[normalizeModelId(model)]);
}

/** Money for people: "US$1.23"; small amounts keep 4 decimals; null is "Costo desconocido". */
export function formatUsd(value: number | null): string {
  if (value === null) return "Costo desconocido";
  const digits = value !== 0 && Math.abs(value) < 0.01 ? 4 : 2;
  return `US$${value.toLocaleString("es-MX", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** Cost fields of a call record: costUsd null when unknown, with the tariff version that priced it. */
export function callCost(model: string, usage: TokenUsage, at: Date = new Date()): { costUsd: number | null; tariff: string | null } {
  const cost = priceUsage(model, usage, at);
  return { costUsd: cost.status === "priced" ? cost.usd : null, tariff: cost.tariff };
}
