import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { AiLimitError, meterClient, type AiClient, type AiLedger, type AiLimitReason, type MeterScope } from "./meter";

// PostgREST needs explicit nulls for nullable arguments without a default.
const nullable = <T>(value: T | null | undefined): T => (value ?? null) as T;

/** The Postgres ledger (reserve_ai / settle_ai / release_ai, service role). */
export const dbLedger: AiLedger = {
  async reserve(scope, model, estimate) {
    const { data, error } = await createAdminClient().rpc("reserve_ai", {
      p_org_id: scope.orgId,
      p_user_id: nullable(scope.userId),
      p_purpose: scope.purpose,
      p_model: model,
      p_estimated_usd: nullable(estimate.usd),
      p_estimated_tokens: estimate.tokens,
      p_ttl_seconds: scope.ttlSeconds ?? 180,
    });
    // Budgets fail closed: without the ledger no call is authorized.
    if (error) {
      console.error("[ai-meter] reserve:", error.message);
      throw new AiLimitError("unavailable", "No se pudo verificar el presupuesto de IA. Intenta de nuevo en unos minutos.");
    }
    const row = data?.[0];
    if (!row?.allowed || !row.call_id) throw new AiLimitError((row?.reason ?? "unavailable") as AiLimitReason, row?.message ?? "Límite de IA alcanzado.");
    return row.call_id;
  },
  async settle(callId, s) {
    const { error } = await createAdminClient().rpc("settle_ai", {
      p_call_id: callId,
      p_model: s.model,
      p_input_tokens: s.usage.inputTokens,
      p_output_tokens: s.usage.outputTokens,
      p_cache_read_tokens: s.usage.cacheReadTokens,
      p_cache_write_tokens: s.usage.cacheWriteTokens,
      p_cost_usd: nullable(s.costUsd),
      p_tariff_version: nullable(s.tariff),
    });
    if (error) throw new Error(error.message);
  },
  async release(callId, message) {
    const { error } = await createAdminClient().rpc("release_ai", { p_call_id: callId, p_error: message });
    if (error) throw new Error(error.message);
  },
};

/** An SDK client whose every call goes through the org's quotas and budgets. */
export function meteredAnthropic(scope: MeterScope, client: AiClient | Anthropic = new Anthropic()): AiClient {
  return meterClient(client as unknown as AiClient, scope, dbLedger);
}
