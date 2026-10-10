import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { runAssistant, trimHistory, type AssistantEvent, type StreamingClient } from "./assistant.ts";
import { applyFilters, ASSISTANT_TOOLS, dailySeries, inboxLink, resolveInput, runTool, summarize, ToolInputError, type Row } from "./tools.ts";

const catalogs = {
  today: "2026-10-09",
  departments: [{ id: "d-agua", name: "Agua Potable" }],
  neighborhoods: [{ id: "n-centro", name: "Centro" }],
};

const row = (over: Partial<Row>): Row => ({
  id: "m",
  publishedAt: "2026-10-08T18:00:00Z",
  text: "x",
  platform: "x",
  author: null,
  sentiment: "negative",
  topic: "agua potable",
  intent: "queja",
  departmentId: "d-agua",
  neighborhoodId: "n-centro",
  interactions: 3,
  ...over,
});

describe("assistant tools", () => {
  it("exposes only the five read-only tools, with no SQL parameter", () => {
    assert.deepEqual(
      ASSISTANT_TOOLS.map((t) => (t as { name: string }).name),
      ["get_kpis", "top_topics", "search_mentions", "stats_by_neighborhood", "stats_by_department"],
    );
    assert.ok(!JSON.stringify(ASSISTANT_TOOLS).toLowerCase().includes("sql"));
  });

  it("resolves periods and catalog names (accent- and case-insensitive)", () => {
    const r = resolveInput({ dependencia: "agua potable", colonia: "CENTRO" }, catalogs);
    assert.deepEqual([r.from, r.to, r.prevFrom, r.prevTo], ["2026-10-03", "2026-10-09", "2026-09-26", "2026-10-02"]);
    assert.equal(r.department?.id, "d-agua");
    assert.equal(r.neighborhood?.id, "n-centro");
    assert.throws(() => resolveInput({ colonia: "Atlantis" }, catalogs), ToolInputError);
    assert.throws(() => resolveInput({ desde: "2026-01-01", hasta: "2026-10-09" }, catalogs), /92 días/);
  });

  it("filters, summarizes and builds daily series", () => {
    const rows = [row({}), row({ id: "2", sentiment: "positive", intent: "elogio" }), row({ id: "3", topic: "salud", publishedAt: "2026-10-09T03:00:00Z" })];
    const r = resolveInput({ tema: "Agua Potable", desde: "2026-10-07", hasta: "2026-10-08" }, catalogs);
    assert.equal(applyFilters(rows, r).length, 2);
    assert.deepEqual(summarize(rows), {
      menciones: 3,
      clasificadas: 3,
      positivas_pct: 33.3,
      neutrales_pct: 0,
      negativas_pct: 66.7,
      nss: -33.3,
      quejas: 2,
      interacciones: 9,
    });
    // 03:00 UTC on the 9th is still the 8th in Mexico City.
    assert.deepEqual(
      dailySeries(rows, "2026-10-07", "2026-10-08").map((p) => p.value),
      [0, 3],
    );
    assert.equal(inboxLink(r), "/bandeja?from=2026-10-07&to=2026-10-08&topic=Agua+Potable&status=all");
  });

  it("rejects invalid input before touching the database", async () => {
    const untouchable = new Proxy({}, { get: () => assert.fail("the client must not be used") });
    const ctx = { client: untouchable as never, orgId: "o", ...catalogs };
    assert.match((await runTool("drop_table", {}, ctx)).error!, /desconocida/);
    assert.match((await runTool("top_topics", { limite: 500 }, ctx)).error!, /limite/);
    assert.match((await runTool("get_kpis", { desde: "ayer" }, ctx)).error!, /desde/);
    assert.match((await runTool("get_kpis", { colonia: "Atlantis" }, ctx)).error!, /No existe/);
  });
});

function fakeStream(rounds: Anthropic.Beta.Messages.BetaMessage["content"][]): StreamingClient & { requests: unknown[] } {
  const requests: unknown[] = [];
  return {
    requests,
    beta: {
      messages: {
        stream(params) {
          requests.push(params);
          const content = rounds[Math.min(requests.length - 1, rounds.length - 1)];
          const listeners: ((d: string) => void)[] = [];
          return {
            on(_event: "text", listener: (d: string) => void) {
              listeners.push(listener);
            },
            async finalMessage() {
              for (const b of content) if (b.type === "text") listeners.forEach((l) => l(b.text));
              return {
                id: "m",
                type: "message",
                role: "assistant",
                model: "claude-opus-5-5",
                content,
                stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
                usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
              } as unknown as Anthropic.Beta.Messages.BetaMessage;
            },
          };
        },
      },
    },
  };
}

describe("runAssistant", () => {
  const scope = { municipality: "Alvarado", today: "2026-10-09", role: "dependencia" as const, departmentName: "Obras", departments: [], neighborhoods: [], topics: [] };

  it("streams text, runs tools and emits charts and links", async () => {
    const client = fakeStream([
      [{ type: "tool_use", id: "t1", name: "top_topics", input: {}, caller: { type: "direct" } } as never],
      [{ type: "text", text: "El tema principal es **agua**.", citations: null } as never],
    ]);
    const events: AssistantEvent[] = [];
    const calls = await runAssistant({
      client,
      model: "claude-opus-5-5",
      scope,
      history: [{ role: "user", content: "¿Qué temas dominan?" }],
      runTool: async () => ({
        result: { temas: [] },
        chart: { kind: "bars", title: "Temas", unit: "menciones", data: [{ label: "agua", value: 3 }, { label: "salud", value: 1 }] },
        links: [{ label: "Bandeja", href: "/bandeja" }],
      }),
      emit: (e) => events.push(e),
    });
    assert.equal(calls.length, 2);
    assert.deepEqual(events.map((e) => e.type), ["tool", "chart", "links", "text", "text", "done"]);
    assert.match(JSON.stringify((client.requests[0] as { system: unknown }).system), /sólo devuelven lo turnado a su dependencia/);
  });

  it("returns tool errors to Claude and stops after the last round without tools", async () => {
    const client = fakeStream([[{ type: "tool_use", id: "t", name: "get_kpis", input: {}, caller: { type: "direct" } } as never]]);
    const events: AssistantEvent[] = [];
    await runAssistant({
      client,
      model: "claude-opus-5-5",
      scope,
      history: [{ role: "user", content: "hola" }],
      runTool: async () => ({ result: null, error: "Parámetro inválido" }),
      emit: (e) => events.push(e),
    });
    const last = client.requests[client.requests.length - 1] as { tools?: unknown; messages: { content: unknown }[] };
    assert.equal(last.tools, undefined, "the final round withholds tools");
    assert.match(JSON.stringify(last.messages), /"is_error":true/);
    assert.equal(events.at(-1)?.type, "done");
  });

  it("trims history to recent turns starting with the user", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: String(i) }));
    const trimmed = trimHistory(many);
    assert.equal(trimmed[0].role, "user");
    assert.ok(trimmed.length <= 20);
  });
});
