import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { parseKpiSnapshot } from "../kpi/snapshot.ts";
import { reportPeriod } from "../reports/period.ts";
import type { MessagesClient } from "./classifier.ts";
import {
  allowedNumbers,
  buildReportFacts,
  generateDailyReading,
  generateNarrative,
  isStructured,
  MAX_ATTEMPTS,
  NARRATIVE_TOOL,
  NarrativeError,
  numbersIn,
  parseNumber,
  readTargets,
  validateNarrative,
  type LegacyNarrative,
  type Narrative,
  type ReportContext,
} from "./narrative.ts";

// One report_snapshot: kpi + context (as the database returns them).
const snapshot = parseKpiSnapshot({
  snapshot_version: 1,
  as_of: "2026-10-09T12:00:00Z",
  period: { from: "2026-10-02T06:00:00Z", to: "2026-10-09T06:00:00Z", cut: "2026-10-09T06:00:00Z", prev_from: "2026-09-25T06:00:00Z", prev_to: "2026-10-02T06:00:00Z", prev_cut: "2026-10-02T06:00:00Z" },
  conversation: {
    current: { mentions: 200, classified: 180, unclassified: 20, positive: 40, neutral: 50, negative: 90, complaints: 70, without_neighborhood: 36, interactions: 15607 },
    previous: { mentions: 160, classified: 150, unclassified: 10, positive: 45, neutral: 45, negative: 60, complaints: 50, without_neighborhood: 30, interactions: 19170 },
  },
  attention: {
    current: { opened: 14, open_at_cut: 9, overdue_at_cut: 4, first_attention_n: 6, first_attention_median_h: 5.5, first_attention_p90_h: 20, resolution_n: 4, resolution_median_h: 30.2, resolution_p90_h: 70, validated_closures: 4, reopenings: 1 },
    previous: { opened: 10, open_at_cut: 7, overdue_at_cut: 2, first_attention_n: 5, first_attention_median_h: 6, resolution_n: 3, resolution_median_h: 40, validated_closures: 3, reopenings: 0 },
  },
  departments: [
    { id: "d1", name: "Agua Potable", created_at: "2024-01-01T00:00:00Z", opened: 10, open_at_cut: 6, overdue_at_cut: 3, validated_closures: 3, resolution_median_h: 28, mentions: 70, positive_mentions: 5, negative_mentions: 50 },
    { id: "d2", name: "Obras Públicas", created_at: "2024-01-01T00:00:00Z", opened: 2, open_at_cut: 2, overdue_at_cut: 1, validated_closures: 1, mentions: 8, positive_mentions: 2, negative_mentions: 3 },
  ],
  series: [
    { bucket: "2026-10-02T06:00:00Z", positive: 5, neutral: 6, negative: 9, pending: 0 },
    { bucket: "2026-10-03T06:00:00Z", positive: 6, neutral: 5, negative: 10, pending: 0 },
    { bucket: "2026-10-04T06:00:00Z", positive: 8, neutral: 9, negative: 40, pending: 2 },
  ],
  topics: [
    { topic: "agua potable", total: 60, positive: 5, negative: 45, complaints: 40 },
    { topic: "salud", total: 20, positive: 15, negative: 2, complaints: 0 },
  ],
  pending_cases: [{ id: "k1", folio: "C-0012", category: "agua potable", priority: "high", status: "accepted", department: "Agua Potable", overdue_hours: 30 }],
  coverage: { sources_active: 4, sources_partial: [] },
  catalog: { departments_added: [], neighborhoods_added: 0, sources_added: [] },
});

const context: ReportContext = {
  buckets: [
    {
      start: "2026-10-04T06:00:00Z",
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
  alerts: { total: 2, by_severity: { high: 1, medium: 1 }, useful: 1, false_alarms: 0, latest: [] },
  neighborhood_complaints: [{ neighborhood: "Centro", complaints: 6, top_topic: "agua potable" }],
};

const facts = buildReportFacts({
  municipality: "Alvarado",
  state: "Veracruz",
  period: reportPeriod("weekly", "2026-10-08"),
  snapshot,
  context,
  departments: ["Agua Potable", "Obras Públicas"],
  targets: [{ label: "Meta de tiempo de atención (horas)", value: 72 }],
});

const good: Narrative = {
  headline: "200 menciones; el agua potable concentra la conversación",
  executive_summary: "Hubo 200 menciones, 25% más que la semana previa, con NSS de -27.8. Hay 4 casos vencidos al corte.",
  what_changed: [{ text: "Las menciones de queja subieron a 70; agua potable sumó 60 menciones.", refs: ["kpi:complaints", "tema:agua potable"] }],
  decisions: [{ text: "Definir refuerzo de pipas en Centro.", refs: ["colonia:Centro"] }],
  actions: [{ owner: "Agua Potable", action: "Atender el caso C-0012, con 30 h de atraso.", deadline: "48 horas", refs: ["caso:C-0012"] }],
  pending: [{ text: "4 casos siguen vencidos al corte.", refs: ["kpi:overdue_at_cut"] }],
  risks: ["Nuevos bloqueos."],
  messaging: ["El Ayuntamiento atiende los reportes de agua."],
};

describe("buildReportFacts", () => {
  it("keeps mentions and cases in separate families, with changes computed in code", () => {
    const mentions = facts.kpis.find((k) => k.key === "mentions")!;
    assert.deepEqual([mentions.value, mentions.previous, mentions.change, mentions.family, mentions.unit], [200, 160, 25, "conversacion", "menciones"]);
    const nss = facts.kpis.find((k) => k.key === "nss")!;
    assert.equal(nss.value, -27.8);
    assert.equal(nss.change_unit, "puntos");
    const overdue = facts.kpis.find((k) => k.key === "overdue_at_cut")!;
    assert.deepEqual([overdue.value, overdue.family, overdue.unit], [4, "atencion", "casos"]);
    const resolution = facts.kpis.find((k) => k.key === "resolution_h")!;
    assert.deepEqual([resolution.value, resolution.n, resolution.change], [30.2, 4, -24.5]);
    assert.equal(facts.attention, undefined, "no more routed mentions counted as attention");
    assert.equal(facts.sentiment.negative_pct, 50);
    assert.equal(facts.top_topics[0].negative_pct, 75);
    assert.equal(facts.period.label, "Del 2 de octubre al 8 de octubre de 2026");
    assert.equal(facts.facts_version, 2);
    assert.match(facts.kpi_version!, /^KPI-/);
  });

  it("does not rank departments on thin volume, and lists the breakdown instead", () => {
    assert.deepEqual(facts.departments_by_nss.map((d) => d.department), ["Agua Potable"], "Obras Públicas has too few mentions to compare its NSS");
    assert.deepEqual(facts.departments?.map((d) => [d.department, d.low_volume]), [["Agua Potable", false], ["Obras Públicas", true]]);
  });

  it("reports coverage and the authorized references and owners", () => {
    assert.deepEqual([facts.coverage?.unclassified, facts.coverage?.unclassified_pct, facts.coverage?.without_neighborhood_pct], [20, 10, 20]);
    const ids = facts.references!.map((r) => r.id);
    for (const id of ["kpi:overdue_at_cut", "caso:C-0012", "mencion:1", "dependencia:Agua Potable", "tema:agua potable", "pico:1", "colonia:Centro"]) assert.ok(ids.includes(id), id);
    assert.equal(facts.references!.find((r) => r.id === "caso:C-0012")?.target, "k1");
    assert.deepEqual(facts.allowed_owners, ["Agua Potable", "Obras Públicas", "Comunicación Social", "Coordinación de atención ciudadana"]);
  });

  it("names media and public figures but never citizens", () => {
    const [citizen, media] = facts.representative_mentions;
    assert.equal(citizen.author, null);
    assert.equal(citizen.source, "X · ciudadano");
    assert.equal(media.author, "Diario del Puerto");
    assert.ok(!JSON.stringify(facts).includes("vecino_123"));
  });

  it("measures peaks against the typical bucket, with their examples from the same snapshot", () => {
    assert.equal(facts.peaks[0].mentions, 59);
    assert.equal(facts.peaks[0].times_typical, 2.8);
    assert.equal(facts.peaks[0].top_topics[0].topic, "agua potable");
    assert.equal(facts.peaks[0].main_mentions[0].source, "Medio (RSS) · Radio Laguna");
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
    const bad: Narrative = {
      ...good,
      executive_summary: `${good.executive_summary} ${"palabra ".repeat(130)}`,
      what_changed: [{ ...good.what_changed[0], text: "Subió 333% y hubo 412 quejas." }],
      actions: [{ ...good.actions[0], deadline: "15 días" }],
    };
    const check = validateNarrative(bad, facts);
    assert.equal(check.ok, false);
    if (!check.ok) {
      assert.deepEqual(check.unknownNumbers, ["333", "412"]);
      assert.match(check.problems[0], /palabras/);
    }
  });

  it("requires evidence, authorized references and owners from the catalog", () => {
    const bad: Narrative = {
      ...good,
      what_changed: [{ text: "Algo cambió.", refs: [] }],
      decisions: [{ text: "Decidir.", refs: ["caso:C-9999"] }],
      actions: [{ ...good.actions[0], owner: "Juan Pérez" }],
    };
    const check = validateNarrative(bad, facts);
    assert.equal(check.ok, false);
    if (!check.ok) {
      assert.deepEqual(check.unknownRefs, ["caso:C-9999"]);
      assert.deepEqual(check.badOwners, ["Juan Pérez"]);
      assert.match(check.problems.join(" "), /Qué cambió 1: falta la evidencia/);
    }
    // Owners match without accents or case.
    assert.deepEqual(validateNarrative({ ...good, actions: [{ ...good.actions[0], owner: "obras publicas" }] }, facts), { ok: true });
  });

  it("still validates the figures of a narrative written before stage 9", () => {
    const legacy: LegacyNarrative = {
      headline: "200 menciones",
      executive_summary: "Hubo 200 menciones.",
      findings: [{ title: "Agua", evidence: "60 menciones y 777 quejas.", impact: "Atender." }],
      risks: [],
      opportunities: [],
      recommendations: [{ action: "Reforzar pipas.", owner: "Agua Potable", deadline: "48 horas" }],
      messaging: ["Mensaje."],
    };
    assert.equal(isStructured(legacy), false);
    const check = validateNarrative(legacy, facts);
    assert.equal(check.ok, false);
    if (!check.ok) assert.deepEqual(check.unknownNumbers, ["777"]);
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
  it("retries with the offending references until the narrative checks out", async () => {
    const client = fakeClient([{ ...good, pending: [{ text: "Pendiente.", refs: ["caso:C-0000"] }] }, good]);
    const result = await generateNarrative(client, "claude-opus-5-5", facts);
    assert.equal(result.attempts, 2);
    assert.match(client.prompts[1], /C-0000/);
  });

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
