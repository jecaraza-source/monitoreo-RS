import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dispatchOutbox, type OutboxRow, type OutboxStore } from "./dispatch.ts";
import type { SendOutcome } from "./providers.ts";

const env = { RESEND_API_KEY: "re_test", ALERTS_FROM_EMAIL: "alertas@monitoreo.test", RESEND_BASE_URL: "http://resend.mock" };

/** A Resend double that honors Idempotency-Key like the real API: same key, same message, one delivery. */
function fakeResend(opts: { failFirst?: number } = {}) {
  const byKey = new Map<string, string>();
  const delivered: { to: string; key: string }[] = [];
  let calls = 0;
  const fetch: typeof globalThis.fetch = (async (_url: string, init: RequestInit) => {
    calls++;
    if (opts.failFirst && calls <= opts.failFirst) return new Response(JSON.stringify({ message: "busy" }), { status: 503 });
    const key = (init.headers as Record<string, string>)["Idempotency-Key"];
    const body = JSON.parse(String(init.body)) as { to: string[] };
    let id = byKey.get(key);
    if (!id) {
      id = `email_${byKey.size + 1}`;
      byKey.set(key, id);
      delivered.push({ to: body.to[0], key });
    }
    return new Response(JSON.stringify({ id }), { status: 200 });
  }) as typeof globalThis.fetch;
  return { fetch, delivered, calls: () => calls };
}

/** In-memory store with leases, like claim_outbox / complete_outbox. */
function memoryStore(rows: OutboxRow[], opts: { failCompleteOnce?: boolean } = {}) {
  const state = new Map(rows.map((r) => [r.id, { row: r, status: "pending", lease: null as string | null, provider: null as string | null }]));
  let failNext = opts.failCompleteOnce ?? false;
  const store: OutboxStore & { expireLeases(): void; state: typeof state } = {
    state,
    async claim(worker, limit) {
      const out: OutboxRow[] = [];
      for (const s of state.values()) {
        if (out.length >= limit) break;
        if (s.status === "pending" && !s.lease) {
          s.lease = worker;
          s.row = { ...s.row, attempts: s.row.attempts + 1 };
          out.push(s.row);
        }
      }
      return out;
    },
    async complete(row, worker, outcome: SendOutcome) {
      if (failNext) {
        failNext = false;
        throw new Error("database unreachable");
      }
      const s = state.get(row.id)!;
      if (s.lease !== worker) return "stale";
      s.lease = null;
      if (outcome.ok) {
        s.status = "sent";
        s.provider = outcome.providerId;
        return "sent";
      }
      s.status = outcome.retryable && s.row.attempts < 3 ? "pending" : "dead";
      return s.status;
    },
    expireLeases() {
      for (const s of state.values()) if (s.status === "pending" && s.lease) s.lease = null;
    },
  };
  return store;
}

const row = (id: string, address: string): OutboxRow => ({
  id,
  org_id: "org",
  idempotency_key: `test:${id}`,
  kind: "alert",
  channel: "email",
  address,
  payload: {},
  attempts: 0,
  report_id: null,
});
const render = async () => ({ channel: "email" as const, email: { subject: "Prueba", html: "<p>x</p>", text: "x" } });

describe("outbox dispatch", () => {
  it("sends, keeps the provider id and stops when nothing is due", async () => {
    const resend = fakeResend();
    const store = memoryStore([row("1", "a@monitoreo.test"), row("2", "b@monitoreo.test")]);
    const summary = await dispatchOutbox({ store, render, worker: "w", env, fetch: resend.fetch });
    assert.deepEqual([summary.claimed, summary.sent], [2, 2]);
    assert.equal(store.state.get("1")!.provider, "email_1");
  });

  it("accepted by the provider but not recorded: the retry does not deliver twice", async () => {
    const resend = fakeResend();
    const store = memoryStore([row("1", "a@monitoreo.test")], { failCompleteOnce: true });
    const first = await dispatchOutbox({ store, render, worker: "w1", env, fetch: resend.fetch });
    assert.equal(first.unrecorded, 1, "sent, but the database did not hear about it");
    store.expireLeases(); // the lease of the vanished worker runs out
    const second = await dispatchOutbox({ store, render, worker: "w2", env, fetch: resend.fetch });
    assert.equal(second.sent, 1);
    assert.equal(resend.calls(), 2, "the provider was called again…");
    assert.equal(resend.delivered.length, 1, "…but delivered once (same Idempotency-Key)");
    assert.equal(store.state.get("1")!.provider, "email_1", "with the same provider id");
  });

  it("provider failures are retried, then dead", async () => {
    const resend = fakeResend({ failFirst: 1 });
    const store = memoryStore([row("1", "a@monitoreo.test")]);
    const first = await dispatchOutbox({ store, render, worker: "w", env, fetch: resend.fetch, max: 1 });
    assert.equal(first.retry, 1);
    const second = await dispatchOutbox({ store, render, worker: "w", env, fetch: resend.fetch });
    assert.equal(second.sent, 1);
  });

  it("a message that cannot be built is retried, not lost", async () => {
    const store = memoryStore([row("1", "a@monitoreo.test")]);
    const failing = async () => {
      throw new Error("PDF no disponible");
    };
    const summary = await dispatchOutbox({ store, render: failing, worker: "w", env, fetch: fakeResend().fetch, max: 1 });
    assert.equal(summary.retry, 1);
    assert.equal(store.state.get("1")!.status, "pending");
  });

  it("respects the per-run limit and the time budget", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(String(i), `p${i}@monitoreo.test`));
    const limited = await dispatchOutbox({ store: memoryStore(rows), render, worker: "w", env, fetch: fakeResend().fetch, limit: 3, max: 5 });
    assert.equal(limited.claimed, 5);
    let t = 0;
    const budget = await dispatchOutbox({ store: memoryStore(rows), render, worker: "w", env, fetch: fakeResend().fetch, limit: 2, budgetMs: 10, clock: () => (t += 6) });
    assert.equal(budget.claimed, 2, "stops claiming once the budget is spent");
  });

  it("a bad address is not retried", async () => {
    const fetch = (async () => new Response(JSON.stringify({ message: "invalid to" }), { status: 422 })) as typeof globalThis.fetch;
    const store = memoryStore([row("1", "no-es-correo")]);
    const summary = await dispatchOutbox({ store, render, worker: "w", env, fetch });
    assert.equal(summary.dead, 1);
  });
});
