import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { runAssistant } from "./assistant.ts";
import { AiLimitError, estimateRequest, meterClient, type AiClient, type AiLedger, type Estimate, type MessageStreamLike, type Settlement } from "./meter.ts";

type Message = Anthropic.Beta.Messages.BetaMessage;

function msg(model: string, content: Message["content"], usage = { input_tokens: 1000, output_tokens: 100 }): Message {
  return {
    id: "m",
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
    usage: { cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...usage },
  } as unknown as Message;
}

/** In-memory ledger that records the order of events and can refuse reservations. */
function fakeLedger(opts: { refuse?: AiLimitError } = {}) {
  const log: string[] = [];
  const settled: Settlement[] = [];
  const estimates: Estimate[] = [];
  let n = 0;
  const ledger: AiLedger = {
    async reserve(_scope, model, estimate) {
      if (opts.refuse) {
        log.push(`refuse:${model}`);
        throw opts.refuse;
      }
      estimates.push(estimate);
      log.push(`reserve:${model}`);
      return `call-${++n}`;
    },
    async settle(id, s) {
      log.push(`settle:${id}`);
      settled.push(s);
    },
    async release(id, error) {
      log.push(`release:${id}:${error.slice(0, 20)}`);
    },
  };
  return { ledger, log, settled, estimates };
}

const scope = { orgId: "org", userId: "user", purpose: "assistant" as const };
const params = (model: string) => ({ model, max_tokens: 500, messages: [{ role: "user" as const, content: "hola" }] });

function createClient(handler: () => Promise<Message>, log: string[]): AiClient {
  return {
    beta: {
      messages: {
        async create() {
          log.push("provider");
          return handler();
        },
        stream() {
          throw new Error("unused");
        },
      },
    },
  };
}

describe("meterClient · create", () => {
  it("reserves before calling the provider and reconciles real usage with its tariff", async () => {
    const { ledger, log, settled, estimates } = fakeLedger();
    const client = meterClient(createClient(async () => msg("claude-haiku-5-5-20261001", []), log), scope, ledger);
    await client.beta.messages.create(params("claude-haiku-5-5"));
    assert.deepEqual(log, ["reserve:claude-haiku-5-5", "provider", "settle:call-1"]);
    // The reservation is a ceiling: whole prompt + max_tokens, priced.
    assert.equal(estimates[0].tokens > 500, true);
    assert.equal(typeof estimates[0].usd, "number");
    assert.equal(settled[0].model, "claude-haiku-5-5-20261001");
    assert.equal(settled[0].tariff, "2026-10");
    assert.equal(settled[0].costUsd, (1000 * 0.1 + 100 * 0.5) / 1e6);
  });

  it("an unknown model is reconciled with cost unknown (null), never 0", async () => {
    const { ledger, log, settled, estimates } = fakeLedger();
    const client = meterClient(createClient(async () => msg("claude-nuevo-9", []), log), scope, ledger);
    await client.beta.messages.create(params("claude-nuevo-9"));
    assert.equal(estimates[0].usd, null);
    assert.equal(settled[0].costUsd, null);
    assert.equal(settled[0].usage.inputTokens, 1000);
  });

  it("a refused reservation never reaches the provider and carries the Spanish message", async () => {
    const refuse = new AiLimitError("daily_budget", "Se alcanzó el presupuesto diario de IA (US$5.00).");
    const { ledger, log } = fakeLedger({ refuse });
    const client = meterClient(createClient(async () => msg("claude-haiku-5-5", []), log), scope, ledger);
    await assert.rejects(client.beta.messages.create(params("claude-haiku-5-5")), (e: unknown) => e instanceof AiLimitError && /presupuesto diario/.test(e.message));
    assert.deepEqual(log, ["refuse:claude-haiku-5-5"]);
  });

  it("a provider error frees the reservation", async () => {
    const { ledger, log } = fakeLedger();
    const client = meterClient(
      createClient(async () => {
        throw new Error("overloaded");
      }, log),
      scope,
      ledger,
    );
    await assert.rejects(client.beta.messages.create(params("claude-haiku-5-5")));
    assert.deepEqual(log, ["reserve:claude-haiku-5-5", "provider", "release:call-1:Error: overloaded"]);
  });

  it("an aborted signal stops before reserving", async () => {
    const { ledger, log } = fakeLedger();
    const client = meterClient(createClient(async () => msg("claude-haiku-5-5", []), log), scope, ledger);
    const controller = new AbortController();
    controller.abort(new Error("cancelada"));
    await assert.rejects(client.beta.messages.create(params("claude-haiku-5-5"), { signal: controller.signal }));
    assert.deepEqual(log, []);
  });
});

/** A streaming client whose rounds are scripted; a round can fail or hang until aborted. */
function streamingClient(rounds: (Message | "fail" | "hang")[], log: string[]): AiClient {
  let i = 0;
  return {
    beta: {
      messages: {
        async create() {
          throw new Error("unused");
        },
        stream(_params, options): MessageStreamLike {
          const round = rounds[Math.min(i++, rounds.length - 1)];
          log.push(`provider:${i}`);
          const listeners: ((d: string) => void)[] = [];
          // What the SDK holds after message_start: input already billed.
          const partial = msg("claude-opus-5-5", [], { input_tokens: 800, output_tokens: 3 });
          let started = false;
          return {
            on(_e: "text", l: (d: string) => void) {
              listeners.push(l);
            },
            get currentMessage() {
              return started ? partial : undefined;
            },
            async finalMessage() {
              started = true;
              if (round === "fail") throw new Error("connection reset");
              if (round === "hang") {
                return new Promise<Message>((_, reject) => {
                  options?.signal?.addEventListener("abort", () => reject(options.signal!.reason), { once: true });
                });
              }
              for (const b of round.content) if (b.type === "text") listeners.forEach((l) => l(b.text));
              return round;
            },
          };
        },
      },
    },
  };
}

const assistantScope = { municipality: "Alvarado", today: "2026-10-13", role: "admin" as const, departmentName: null, departments: [], neighborhoods: [], topics: [] };
const toolRound = msg("claude-opus-5-5", [{ type: "tool_use", id: "t1", name: "get_kpis", input: {}, caller: { type: "direct" } } as never]);

describe("assistant with the metered client", () => {
  it("keeps the consumption of completed rounds when a later round fails", async () => {
    const { ledger, log, settled } = fakeLedger();
    const client = meterClient(streamingClient([toolRound, "fail"], log), scope, ledger);
    await assert.rejects(
      runAssistant({
        client,
        model: "claude-opus-5-5",
        scope: assistantScope,
        history: [{ role: "user", content: "¿Cómo vamos?" }],
        runTool: async () => ({ result: { ok: true } }),
        emit: () => {},
      }),
      /connection reset/,
    );
    // Round 1 was reconciled when it ended; round 2 failed after the provider
    // started it, so the usage it had reached (input) is reconciled too.
    assert.deepEqual(log.filter((l) => l.startsWith("settle")), ["settle:call-1", "settle:call-2"]);
    assert.equal(settled[0].usage.inputTokens, 1000);
    assert.equal(settled[1].usage.inputTokens, 800);
  });

  it("cancellation stops the stream in flight and starts no more rounds or tools", async () => {
    const { ledger, log } = fakeLedger();
    const tools: string[] = [];
    const controller = new AbortController();
    const client = meterClient(streamingClient([toolRound, "hang"], log), scope, ledger);
    const run = runAssistant({
      client,
      model: "claude-opus-5-5",
      scope: assistantScope,
      history: [{ role: "user", content: "¿Cómo vamos?" }],
      runTool: async (name) => {
        tools.push(name);
        return { result: {} };
      },
      emit: () => {},
      signal: controller.signal,
    });
    // Let round 1 and its tool finish, then cancel while round 2 streams.
    await new Promise((r) => setTimeout(r, 20));
    controller.abort(new Error("El usuario cerró el chat."));
    await assert.rejects(run, /cerró el chat/);
    assert.deepEqual(tools, ["get_kpis"]);
    assert.equal(log.filter((l) => l.startsWith("provider")).length, 2, "no third round");
    // The cut stream reconciles the input it had consumed.
    assert.deepEqual(log.filter((l) => l.startsWith("settle") || l.startsWith("release")), ["settle:call-1", "settle:call-2"]);
  });

  it("an abort before a round prevents the provider call and the reservation", async () => {
    const { ledger, log } = fakeLedger();
    const controller = new AbortController();
    controller.abort(new Error("timeout"));
    const client = meterClient(streamingClient([toolRound], log), scope, ledger);
    await assert.rejects(
      runAssistant({
        client,
        model: "claude-opus-5-5",
        scope: assistantScope,
        history: [{ role: "user", content: "hola" }],
        runTool: async () => ({ result: {} }),
        emit: () => {},
        signal: controller.signal,
      }),
      /timeout/,
    );
    assert.deepEqual(log, []);
  });

  it("estimates a ceiling from the prompt and max_tokens", () => {
    const e = estimateRequest({ model: "claude-opus-5-5", max_tokens: 1000, messages: [{ role: "user", content: "x".repeat(3000) }] });
    assert.ok(e.tokens >= 2000);
    assert.ok(e.usd !== null && e.usd > 1000 * 20 / 1e6);
  });
});
