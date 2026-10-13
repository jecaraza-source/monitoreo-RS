// Metered access to the Claude API: every provider call first reserves its
// estimated capacity (concurrency per purpose, user quota, daily/monthly
// budgets — checked atomically in Postgres by reserve_ai) and, when it ends,
// reconciles the real consumption (settle_ai) or frees the reservation
// (release_ai). Framework-free: the ledger is injected (src/lib/ai/ledger.ts
// in the app, a fake in tests).

import type Anthropic from "@anthropic-ai/sdk";
import type { MessagesClient } from "./classifier.ts";
import { callCost, type TokenUsage } from "./pricing.ts";

export type AiPurpose = "classify" | "report" | "assistant" | "daily_reading";

export type MeterScope = {
  orgId: string;
  /** The person who caused the call; null for cron work (no per-user quota). */
  userId: string | null;
  purpose: AiPurpose;
  /** How long the reservation holds capacity if the process dies before reconciling. */
  ttlSeconds?: number;
};

export type Estimate = { tokens: number; usd: number | null };

export type Settlement = { model: string; usage: TokenUsage; costUsd: number | null; tariff: string | null };

export interface AiLedger {
  /** Returns the reservation id, or throws AiLimitError with a message in Spanish. */
  reserve(scope: MeterScope, model: string, estimate: Estimate): Promise<string>;
  settle(callId: string, settlement: Settlement): Promise<void>;
  release(callId: string, error: string): Promise<void>;
}

export type AiLimitReason = "concurrency" | "user_quota" | "daily_budget" | "monthly_budget" | "daily_tokens" | "unpriced" | "unavailable";

/** A limit stopped the call before it reached the provider. `message` is for people. */
export class AiLimitError extends Error {
  readonly reason: AiLimitReason;
  constructor(reason: AiLimitReason, message: string) {
    super(message);
    this.name = "AiLimitError";
    this.reason = reason;
  }
}

type StreamParams = Anthropic.Beta.Messages.MessageCreateParamsStreaming | Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type RequestOptions = { signal?: AbortSignal; timeout?: number };

/** What the assistant uses from the SDK stream. `currentMessage` holds the usage reached when a stream is cut. */
export type MessageStreamLike = {
  on(event: "text", listener: (delta: string) => void): unknown;
  finalMessage(): Promise<Anthropic.Beta.Messages.BetaMessage>;
  readonly currentMessage?: Anthropic.Beta.Messages.BetaMessage | undefined;
};

export type StreamingClient = {
  beta: { messages: { stream(params: StreamParams, options?: RequestOptions): MessageStreamLike } };
};

export type AiClient = MessagesClient & StreamingClient;

/** About 3 characters per token for Spanish JSON-heavy prompts: deliberately high, the reservation is a ceiling. */
const CHARS_PER_TOKEN = 3;

/** Ceiling of a request: its whole prompt as uncached input plus max_tokens of output. */
export function estimateRequest(params: StreamParams): Estimate {
  const promptChars = JSON.stringify([params.system ?? "", params.messages, params.tools ?? []]).length;
  const usage = { inputTokens: Math.ceil(promptChars / CHARS_PER_TOKEN), outputTokens: params.max_tokens, cacheReadTokens: 0, cacheWriteTokens: 0 };
  return { tokens: usage.inputTokens + usage.outputTokens, usd: callCost(params.model, usage).costUsd };
}

export function usageOf(message: Pick<Anthropic.Beta.Messages.BetaMessage, "usage">): TokenUsage {
  const u = message.usage;
  return {
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    cacheReadTokens: u?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u?.cache_creation_input_tokens ?? 0,
  };
}

function settlementOf(message: Pick<Anthropic.Beta.Messages.BetaMessage, "usage" | "model">, model: string): Settlement {
  const usage = usageOf(message);
  const id = message.model || model;
  return { model: id, usage, ...callCost(id, usage) };
}

const errorText = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 500);

async function quietly(work: Promise<void>, what: string) {
  try {
    await work;
  } catch (error) {
    // The call already happened: a failed write is logged, never turned into a user error.
    console.error(`[ai-meter] ${what}:`, error instanceof Error ? error.message : error);
  }
}

/**
 * Wraps an SDK client so that each messages.create / messages.stream call is
 * reserved before and reconciled after. A call cut by cancellation or timeout
 * reconciles the usage the stream had reached (input is billed from the
 * start); one that never produced usage frees its reservation.
 */
export function meterClient(client: AiClient | MessagesClient, scope: MeterScope, ledger: AiLedger): AiClient {
  const inner = client as AiClient;
  return {
    beta: {
      messages: {
        async create(params, options) {
          options?.signal?.throwIfAborted();
          const callId = await ledger.reserve(scope, params.model, estimateRequest(params));
          let message: Anthropic.Beta.Messages.BetaMessage;
          try {
            message = await inner.beta.messages.create(params, options);
          } catch (error) {
            await quietly(ledger.release(callId, errorText(error)), "release");
            throw error;
          }
          await quietly(ledger.settle(callId, settlementOf(message, params.model)), "settle");
          return message;
        },
        stream(params, options) {
          const listeners: ((delta: string) => void)[] = [];
          let current: MessageStreamLike | undefined;
          const run = (async () => {
            options?.signal?.throwIfAborted();
            const callId = await ledger.reserve(scope, params.model, estimateRequest(params));
            try {
              current = inner.beta.messages.stream(params, options);
              for (const listener of listeners) current.on("text", listener);
              const message = await current.finalMessage();
              await quietly(ledger.settle(callId, settlementOf(message, params.model)), "settle");
              return message;
            } catch (error) {
              const partial = current?.currentMessage;
              if (partial?.usage && (partial.usage.input_tokens ?? 0) > 0) {
                await quietly(ledger.settle(callId, settlementOf(partial, params.model)), "settle partial");
              } else {
                await quietly(ledger.release(callId, errorText(error)), "release");
              }
              throw error;
            }
          })();
          // finalMessage() is how callers observe errors; avoid an unhandled rejection meanwhile.
          run.catch(() => {});
          return {
            on(event: "text", listener: (delta: string) => void) {
              listeners.push(listener);
              current?.on(event, listener);
              return this;
            },
            finalMessage: () => run,
          };
        },
      },
    },
  };
}
