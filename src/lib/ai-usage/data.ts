import "server-only";
import type { Member } from "@/lib/auth/session";
import { toMxDay } from "@/lib/dashboard/period";
import { createClient } from "@/lib/supabase/server";
import { limitsOrDefault, summarize, type Invoice, type Limits, type UsageRow } from "./model";

export type InFlight = { purpose: string; count: number; reservedUsd: number | null; reservedTokens: number };

export type AiConsumption = ReturnType<typeof summarize> & {
  todayDay: string;
  limits: Limits;
  limitsUpdatedAt: string | null;
  invoices: Invoice[];
  inFlight: InFlight[];
  /** Calls of the last 24 h that never reconciled (expired) or failed before usage (released). */
  unreconciled: { expired: number; released: number };
};

/** Consumption panel: read with the member's session (RLS: admin and comunicacion). */
export async function getAiConsumption(member: Member): Promise<AiConsumption> {
  const supabase = await createClient();
  const today = toMxDay(new Date());
  const since = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
  since.setUTCMonth(since.getUTCMonth() - 5);
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const [usage, limits, invoices, reserved, recent] = await Promise.all([
    supabase
      .from("ai_usage")
      .select("day, model, purpose, requests, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, unpriced_requests, unpriced_tokens, tariff_version")
      .eq("org_id", member.orgId)
      .gte("day", `${since.toISOString().slice(0, 7)}-01`),
    supabase
      .from("ai_limits")
      .select("daily_budget_usd, monthly_budget_usd, daily_token_budget, user_daily_requests, max_concurrent, updated_at")
      .eq("org_id", member.orgId)
      .maybeSingle(),
    supabase.from("ai_invoices").select("id, month, amount_usd, reference, notes").eq("org_id", member.orgId).order("month", { ascending: false }).limit(24),
    supabase.from("ai_calls").select("purpose, reserved_usd, reserved_tokens, expires_at").eq("org_id", member.orgId).eq("status", "reserved"),
    supabase.from("ai_calls").select("status").eq("org_id", member.orgId).in("status", ["expired", "released"]).gte("created_at", dayAgo),
  ]);
  for (const r of [usage, limits, invoices, reserved, recent]) if (r.error) throw new Error(`No se pudo leer el consumo de IA: ${r.error.message}`);

  const inFlight = new Map<string, InFlight>();
  const now = Date.now();
  for (const c of reserved.data ?? []) {
    if (Date.parse(c.expires_at) < now) continue;
    const f = inFlight.get(c.purpose) ?? { purpose: c.purpose, count: 0, reservedUsd: 0, reservedTokens: 0 };
    f.count++;
    f.reservedTokens += Number(c.reserved_tokens);
    f.reservedUsd = f.reservedUsd === null || c.reserved_usd === null ? null : f.reservedUsd + Number(c.reserved_usd);
    inFlight.set(c.purpose, f);
  }
  const rows = (usage.data ?? []) as UsageRow[];
  const list = (invoices.data ?? []).map((i) => ({ ...i, amount_usd: Number(i.amount_usd) }));
  return {
    ...summarize(rows, list, today),
    todayDay: today,
    limits: limitsOrDefault(limits.data as Partial<Limits> | null),
    limitsUpdatedAt: limits.data?.updated_at ?? null,
    invoices: list,
    inFlight: [...inFlight.values()],
    unreconciled: {
      expired: (recent.data ?? []).filter((r) => r.status === "expired").length,
      released: (recent.data ?? []).filter((r) => r.status === "released").length,
    },
  };
}
