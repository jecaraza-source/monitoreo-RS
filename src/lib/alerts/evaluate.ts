import "server-only";
import { notify } from "@/lib/notify";
import { siteUrl } from "@/lib/site-url";
import type { createAdminClient } from "@/lib/supabase/admin";
import {
  decideDigest,
  decideMediaNegative,
  decideRiskTerms,
  decideSentimentDrop,
  decideSpike,
  digestDue,
  isRuleKind,
  parseChannels,
  parseCondition,
  RULE_KIND_LABELS,
  type Candidate,
  type Decision,
  type DigestNumbers,
  type RuleKind,
  type Severity,
} from "./rules";

type Admin = ReturnType<typeof createAdminClient>;

type RuleRow = {
  id: string;
  org_id: string;
  name: string;
  kind: string;
  condition: unknown;
  channels: unknown;
  department_id: string | null;
  organizations: { name: string } | null;
};

export type EvaluateSummary = {
  rules: number;
  fired: { ruleId: string; eventId: string; title: string; notifications: Record<string, { status: string }> }[];
  /** Decisions held back by the rule's cooldown. */
  suppressed: number;
  errors: string[];
};

/**
 * Evaluates every active rule and fires what crosses its threshold. Called
 * at the end of each classification run (service role). The database's
 * fire_alert() applies the cooldown, so overlapping runs never duplicate.
 */
export async function evaluateAlerts(admin: Admin, now = new Date()): Promise<EvaluateSummary> {
  const summary: EvaluateSummary = { rules: 0, fired: [], suppressed: 0, errors: [] };
  const { data, error } = await admin
    .from("alert_rules")
    .select("id, org_id, name, kind, condition, channels, department_id, organizations(name)")
    .eq("is_active", true);
  if (error) {
    summary.errors.push(`reglas: ${error.message}`);
    return summary;
  }

  // Risk-term and media rules of the same org/department/window share one query.
  const candidates = new Map<string, Promise<Candidate[]>>();
  const loadCandidates = (orgId: string, departmentId: string | null, minutes: number) => {
    const key = `${orgId}:${departmentId ?? ""}:${minutes}`;
    if (!candidates.has(key)) candidates.set(key, fetchCandidates(admin, orgId, departmentId, new Date(now.getTime() - minutes * 60_000)));
    return candidates.get(key)!;
  };

  for (const rule of (data ?? []) as unknown as RuleRow[]) {
    if (!isRuleKind(rule.kind)) continue;
    summary.rules++;
    try {
      const decisions = await decide(admin, rule, rule.kind, now, loadCandidates);
      for (const d of decisions) {
        const fired = await fire(admin, rule, rule.kind, d);
        if (fired) summary.fired.push(fired);
        else summary.suppressed++;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      summary.errors.push(`${rule.name}: ${message}`);
      console.error("[alerts]", rule.id, message);
    }
  }
  return summary;
}

async function decide(
  admin: Admin,
  rule: RuleRow,
  kind: RuleKind,
  now: Date,
  loadCandidates: (orgId: string, departmentId: string | null, minutes: number) => Promise<Candidate[]>,
): Promise<Decision[]> {
  switch (kind) {
    case "spike": {
      const c = parseCondition("spike", rule.condition);
      if (!c) throw new Error("condición inválida");
      const { data, error } = await admin.rpc("alert_volume_window", {
        p_org_id: rule.org_id,
        p_window_minutes: c.window_minutes,
        p_baseline_days: c.baseline_days,
        p_department_id: rule.department_id ?? undefined,
      });
      if (error) throw new Error(error.message);
      const row = data?.[0];
      if (!row) return [];
      const d = decideSpike({ current: row.current_count, mean: Number(row.baseline_mean), stddev: Number(row.baseline_stddev) }, c);
      return d ? [d] : [];
    }
    case "sentiment_drop": {
      const c = parseCondition("sentiment_drop", rule.condition);
      if (!c) throw new Error("condición inválida");
      const { data, error } = await admin.rpc("alert_sentiment_window", {
        p_org_id: rule.org_id,
        p_window_minutes: c.window_minutes,
        p_baseline_days: c.baseline_days,
        p_department_id: rule.department_id ?? undefined,
      });
      if (error) throw new Error(error.message);
      const row = data?.[0];
      if (!row) return [];
      const d = decideSentimentDrop(
        {
          currentClassified: row.current_classified,
          currentNss: Number(row.current_nss),
          baselineClassified: row.baseline_classified,
          baselineNss: Number(row.baseline_nss),
        },
        c,
      );
      return d ? [d] : [];
    }
    case "risk_term": {
      const c = parseCondition("risk_term", rule.condition);
      if (!c) throw new Error("condición inválida");
      return decideRiskTerms(await loadCandidates(rule.org_id, rule.department_id, c.window_minutes), c);
    }
    case "media_negative": {
      const c = parseCondition("media_negative", rule.condition);
      if (!c) throw new Error("condición inválida");
      return decideMediaNegative(await loadCandidates(rule.org_id, rule.department_id, c.window_minutes));
    }
    case "daily_digest": {
      const c = parseCondition("daily_digest", rule.condition);
      if (!c) throw new Error("condición inválida");
      const { due, day } = digestDue(c, now);
      if (!due) return [];
      const { data, error } = await admin.rpc("alert_digest", {
        p_org_id: rule.org_id,
        p_from: new Date(now.getTime() - 86_400_000).toISOString(),
        p_to: now.toISOString(),
        p_department_id: rule.department_id ?? undefined,
      });
      if (error) throw new Error(error.message);
      return [decideDigest(day, data as unknown as DigestNumbers)];
    }
  }
}

async function fetchCandidates(admin: Admin, orgId: string, departmentId: string | null, since: Date): Promise<Candidate[]> {
  const { data, error } = await admin.rpc("alert_candidates", {
    p_org_id: orgId,
    p_since: since.toISOString(),
    p_department_id: departmentId ?? undefined,
  });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    mentionId: r.mention_id,
    text: r.text,
    sentiment: r.sentiment,
    authorId: r.author_id,
    authorKind: r.author_kind,
    authorName: r.author_name,
    terms: r.terms ?? [],
    maxSeverity: (r.max_severity as Severity | null) ?? null,
  }));
}

async function fire(admin: Admin, rule: RuleRow, kind: RuleKind, d: Decision): Promise<EvaluateSummary["fired"][number] | null> {
  const { data: eventId, error } = await admin.rpc("fire_alert", {
    p_rule_id: rule.id,
    p_fingerprint: d.fingerprint,
    p_kind: kind,
    p_severity: d.severity,
    p_title: d.title,
    p_summary: d.summary,
    p_payload: d.payload as never,
    p_mention_ids: d.mentionIds,
  });
  if (error) throw new Error(error.message);
  if (!eventId) return null;

  const notifications = await notify(
    {
      title: d.title,
      summary: d.summary,
      severity: d.severity,
      ruleName: rule.name || RULE_KIND_LABELS[kind],
      orgName: rule.organizations?.name ?? "",
      url: `${siteUrl()}/alertas?alerta=${eventId}`,
    },
    parseChannels(rule.channels),
  );
  const { error: updateError } = await admin.from("alert_events").update({ notifications: notifications as never }).eq("id", eventId);
  if (updateError) console.error("[alerts] notifications:", updateError.message);
  return { ruleId: rule.id, eventId, title: d.title, notifications };
}
