// Outbox worker: leases due messages, renders and sends each one, and
// records the outcome. Pure (store, renderer, env and fetch injected) so the
// interruption cases can be tested without a database.
import type { Fetch, NotifyEnv } from "../notify/types.ts";
import type { OutgoingMessage } from "../whatsapp/client.ts";
import { sendEmail, sendWhatsAppMessage, type Attachment, type SendOutcome } from "./providers.ts";
import type { Email, OutboxChannel, OutboxKind } from "./render.ts";

export type OutboxRow = {
  id: string;
  org_id: string;
  idempotency_key: string;
  kind: OutboxKind;
  channel: OutboxChannel;
  address: string;
  payload: Record<string, unknown>;
  attempts: number;
  report_id: string | null;
};

export type Rendered =
  | { channel: "email"; email: Email & { attachments?: Attachment[]; from?: string } }
  | { channel: "whatsapp"; message: OutgoingMessage };

export interface OutboxStore {
  claim(worker: string, limit: number, leaseSeconds: number): Promise<OutboxRow[]>;
  /** "sent" | "pending" | "dead" | "stale". */
  complete(row: OutboxRow, worker: string, outcome: SendOutcome): Promise<string>;
}

export type DispatchSummary = { claimed: number; sent: number; retry: number; dead: number; stale: number; unrecorded: number };

export async function dispatchOutbox(opts: {
  store: OutboxStore;
  render: (row: OutboxRow) => Promise<Rendered>;
  worker: string;
  env: NotifyEnv;
  fetch: Fetch;
  /** Messages per claim and at most this many in total. */
  limit?: number;
  max?: number;
  /** Stop claiming after this long (the cron's time budget). */
  budgetMs?: number;
  leaseSeconds?: number;
  clock?: () => number;
}): Promise<DispatchSummary> {
  const clock = opts.clock ?? Date.now;
  const started = clock();
  const limit = opts.limit ?? 20;
  const max = opts.max ?? 200;
  const summary: DispatchSummary = { claimed: 0, sent: 0, retry: 0, dead: 0, stale: 0, unrecorded: 0 };
  while (summary.claimed < max && clock() - started < (opts.budgetMs ?? 60_000)) {
    const rows = await opts.store.claim(opts.worker, Math.min(limit, max - summary.claimed), opts.leaseSeconds ?? 120);
    if (!rows.length) break;
    summary.claimed += rows.length;
    for (const row of rows) {
      let outcome: SendOutcome;
      try {
        const rendered = await opts.render(row);
        outcome =
          rendered.channel === "email"
            ? await sendEmail(row.address, rendered.email, row.idempotency_key, { env: opts.env, fetch: opts.fetch })
            : await sendWhatsAppMessage(row.address, rendered.message, { env: opts.env, fetch: opts.fetch });
      } catch (error) {
        // Could not build the message (e.g. the PDF is not readable yet): try again later.
        outcome = { ok: false, error: error instanceof Error ? error.message : String(error), retryable: true };
      }
      try {
        const status = await opts.store.complete(row, opts.worker, outcome);
        if (status === "sent") summary.sent++;
        else if (status === "pending") summary.retry++;
        else if (status === "dead") summary.dead++;
        else summary.stale++;
      } catch {
        // Sent (maybe) but not recorded: the lease expires and the message is
        // claimed again; email repeats its idempotency key, WhatsApp is left
        // "uncertain" by the database. Never a silent second delivery.
        summary.unrecorded++;
      }
    }
  }
  return summary;
}
