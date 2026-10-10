import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import type { DashboardData } from "../dashboard/model.ts";
import { reportPeriod } from "../reports/period.ts";
import type { MessagesClient } from "./classifier.ts";
import {
  allowedNumbers,
  buildReportFacts,
  generateDailyReading,
  generateNarrative,
  MAX_ATTEMPTS,
  NARRATIVE_TOOL,
  NarrativeError,
  numbersIn,
  parseNumber,
  readTargets,
  validateNarrative,
  type Narrative,
  type ReportExtras,
} from "./narrative.ts";

const totals = (over: Partial<DashboardData["totals"]> = {}): DashboardData["totals"] => ({
  mentions: 200,
  classified: 180,
  positive: 40,
  neutral: 50,
  negative: 90,
  interactions: 15607,
  openTickets: 30,
  resolvedTickets: 24,
  attentionHours: 27.24,
  ...over,
});

const dashboard: DashboardData = {
  totals: totals(),
  previous: totals({ mentions: 160, classified: 150, positive: 45, negative: 60, resolvedTickets: 17, attentionHours: 29.2, interactions: 19170 }),
  series: [
    { bucket: "2026-10-02T06:00:00Z", positive: 5, neutral: 6, negative: 9, pending: 0 },
    { bucket: "2026-10-03T06:00:00Z", positive: 6, neutral: 5, negative: 10, pending: 0 },
    { bucket: "2026-10-04T06:00:00Z", positive: 8, neutral: 9, negative: 40, pending: 2 },
  ],
  topics: [
    { topic: "agua potable", total: 60, positive: 5, negative: 45, nss: -66.7 },
    { topic: "salud", total: 20, positive: 15, negative: 2, nss: 65 },
  ],
  departments: [{ id: "d1", name: "Agua Potable", total: 70, positive: 5, negative: 50, nss: -64.3 }],
  neighborhoods: [],
  topMentions: [],
  topMedia: [],
};

const extras: ReportExtras = {
  peaks: [
    {
      start: "2026-10-04T06:00:00Z",
      total: 59,
      topics: [{ topic: "agua potable", total: 30 }],
      mentions: [
        { id: "m1", text: "Bloqueo por falta de agua", sentiment: "negative", topic: "agua potable", author: "Radio Laguna", author_kind: "media", platform: "rss", interactions: 400, published_at: "2026-10-04T15:00:00Z" },
      ],
    },
  ],
  representative: [
    { id: "m2", text: "Sin agua en Centro", sentiment: "negative", topic: "agua potable", author: "vecino_123", author_kind: "citizen", platform: "x", interactions: 30, published_at: "2026-10-03T15:00:00Z" },
    { id: "m3", text: "Gracias por la jornada de salud", sentiment: "positive", topic: "salud", author: "Diario del Puerto", author_kind: "media", platform: "rss", interactions: 90, published_at: "2026-10-03T16:00:00Z" },
  ],
  attention: [{ department: "Agua Potable", opened: 14, resolved: 4, overdue: 4, attention_hours: 20.44 }],
  alerts: { total: 2, by_severity: { high: 1, medium: 1 }, useful: 1, false_alarms: 0, latest: [] },
  neighborhood_complaints: [{ neighborhood: "Centro", complaints: 6, top_topic: "agua potable" }],
};

const facts = buildReportFacts({
  municipality: "Alvarado",
  state: "Veracruz",
  period: reportPeriod("weekly", "2026-10-08"),
  dashboard,
  extras,
  targets: [{ label: "Meta de tiempo de atención (horas)", value: 72 }],
});

const good: Narrative = {
  headline: "200 menciones; el agua potable concentra la conversación",
  executive_summary: "Hubo 200 menciones, 25% más que la semana previa, con NSS de -27.8. Agua potable sumó 60 menciones.",
  findings: [{ title: "Agua", evidence: "60 menciones, 75% negativas; 6 quejas en Centro.", impact: "Atender pipas." }],
  risks: ["Nuevos bloqueos."],
  opportunities: ["Difundir reparaciones."],
  recommendations: [{ action: "Reforzar pipas en Centro.", owner: "Agua Potable", deadline: "48 horas" }],
  messaging: ["El Ayuntamiento atiende los reportes de agua."],
};

describe("buildReportFacts", () => {
  it("computes KPI changes, shares and attention in code", () => {
    const mentions = facts.kpis.find((k) => k.key === "mentions")!;
    assert.deepEqual([mentions.value, mentions.previous, mentions.change], [200, 160, 25]);
    const nss = facts.kpis.find((k) => k.key === "nss")!;
    assert.equal(nss.value, -27.8);
    assert.equal(nss.change_unit, "puntos");
    assert.equal(facts.sentiment.negative_pct, 50);
    assert.equal(facts.top_topics[0].negative_pct, 75);
    assert.deepEqual(facts.attention, {
      routed: 14,
      resolved: 4,
      resolution_pct: 28.6,
      avg_hours: 27.2,
      overdue: 4,
      by_department: [{ department: "Agua Potable", routed: 14, resolved: 4, overdue: 4, avg_hours: 20.4 }],
    });
    assert.equal(facts.period.label, "Del 2 de octubre al 8 de octubre de 2026");
  });

  it("names media and public figures but never citizens", () => {
    const [citizen, media] = facts.representative_mentions;
    assert.equal(citizen.author, null);
    assert.equal(citizen.source, "X · ciudadano");
    assert.equal(media.author, "Diario del Puerto");
    assert.ok(!JSON.stringify(facts).includes("vecino_123"));
  });

  it("measures peaks against the typical bucket", () => {
    assert.equal(facts.peaks[0].mentions, 59);
    assert.equal(facts.peaks[0].times_typical, 2.8);
  });
});

describe("figures", () => {
  it("parses Mexican Spanish number formats", () => {
    assert.equal(parseNumber("15,607"), 15607);
    assert.equal(parseNumber("12,5"), 12.5);
    assert.equal(parseNumber("−3.2"), -3.2);
    assert.equal(parseNumber("1 234"), 1234);
    assert.deepEqual(
      numbersIn("NSS de -27.8 y 15,607 interacciones (25 %)").map((n) => n.value),
      [-27.8, 15607, 25],
    );
  });

  it("accepts figures from ReportFacts, rounded or not", () => {
    assert.deepEqual(validateNarrative(good, facts), { ok: true });
    const allowed = allowedNumbers(facts);
    assert.ok(allowed.includes(72), "targets count as facts");
  });

  it("rejects invented figures and long summaries, but ignores deadlines", () => {
    const bad = {
      ...good,
      executive_summary: `${good.executive_summary} ${"palabra ".repeat(130)}`,
      findings: [{ ...good.findings[0], evidence: "Subió 333% y hubo 412 quejas." }],
      recommendations: [{ ...good.recommendations[0], deadline: "15 días" }],
    };
    const check = validateNarrative(bad, facts);
    assert.equal(check.ok, false);
    if (!check.ok) {
      assert.deepEqual(check.unknownNumbers, ["333", "412"]);
      assert.match(check.problems[0], /palabras/);
    }
  });

  it("reads KPI targets in both stored formats", () => {
    assert.deepEqual(readTargets([{ name: "Respuesta", target: 72, unit: "h" }, { key: "tickets_resueltos_pct", target: 80 }, { name: "x", target: null }]), [
      { label: "Respuesta (h)", value: 72 },
      { label: "Meta de turnos resueltos (%)", value: 80 },
    ]);
  });
});

function fakeClient(inputs: unknown[]): MessagesClient & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    beta: {
      messages: {
        async create(params) {
          const content = params.messages[0].content;
          prompts.push(typeof content === "string" ? content : "");
          const input = inputs[Math.min(prompts.length - 1, inputs.length - 1)];
          return {
            id: "msg",
            type: "message",
            role: "assistant",
            model: params.model,
            content: [{ type: "tool_use", id: "t", name: (params.tools![0] as { name: string }).name, input }],
            stop_reason: "tool_use",
            usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          } as unknown as Anthropic.Beta.Messages.BetaMessage;
        },
      },
    },
  };
}

describe("generateNarrative", () => {
  it("retries with the offending figures until the narrative checks out", async () => {
    const invented = { ...good, headline: "Las menciones crecieron 999%" };
    const client = fakeClient([invented, good]);
    const result = await generateNarrative(client, "claude-opus-5-5", facts);
    assert.equal(result.attempts, 2);
    assert.equal(result.narrative.headline, good.headline);
    assert.equal(result.calls.length, 2);
    assert.match(client.prompts[1], /999/);
    assert.match(client.prompts[0], new RegExp(NARRATIVE_TOOL));
  });

  it("gives up after MAX_ATTEMPTS and reports the calls for billing", async () => {
    const client = fakeClient([{ ...good, headline: "123456 menciones" }]);
    await assert.rejects(generateNarrative(client, "claude-opus-5-5", facts), (e: unknown) => {
      assert.ok(e instanceof NarrativeError);
      assert.equal(e.calls.length, MAX_ATTEMPTS);
      return true;
    });
  });

  it("writes the daily reading with the same checks", async () => {
    const client = fakeClient([{ sentences: ["Hubo 200 menciones.", "Agua potable dominó con 60."] }]);
    const { sentences } = await generateDailyReading(client, "claude-haiku-5-5", facts);
    assert.equal(sentences.length, 2);
  });
});
