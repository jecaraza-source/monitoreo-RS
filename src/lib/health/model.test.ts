import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  actionForError,
  assessClassifier,
  assessDashboard,
  assessSource,
  backoffUntil,
  formatCdmx,
  nextAttempt,
  summarize,
  type HealthSnapshot,
  type SourceSnapshot,
} from "./model.ts";

const NOW = new Date("2026-10-13T18:20:00Z"); // 12:20 in Mexico City
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

const okRun = (over: Partial<NonNullable<SourceSnapshot["last_run"]>> = {}): NonNullable<SourceSnapshot["last_run"]> => ({
  id: "r1", status: "ok", trigger: "cron", started_at: ago(20), complete: true,
  fetched: 30, inserted: 4, duplicates: 26, unmatched: 3, updated: 1, gap_from: null, gap_to: null, limits: [], error: null,
  ...over,
});

function source(over: Partial<SourceSnapshot> = {}): SourceSnapshot {
  return {
    id: "s1", name: "Diario del Valle", type: "rss", is_active: true,
    expected_every_minutes: 60, stale_after_minutes: null, quiet_after_hours: 72,
    last_run_at: ago(20), last_success_at: ago(20), last_error_at: null, consecutive_failures: 0, last_error: null,
    covered_until: ago(20), catching_up: false, running: false, last_new_item_at: ago(25),
    last_run: okRun(), day: { runs: 24, errors: 0, partial: 0, fetched: 700, inserted: 80, duplicates: 600, unmatched: 20 },
    ...over,
  };
}

describe("assessSource", () => {
  it("healthy: read recently with complete coverage", () => {
    const h = assessSource(source(), NOW);
    assert.equal(h.state, "healthy");
    assert.equal(h.tone, "ok");
    assert.equal(h.coverage, "complete");
    assert.equal(h.lagMinutes, 20);
  });

  it("delayed: coverage older than the threshold (3 × frequency by default)", () => {
    const h = assessSource(source({ covered_until: ago(200), last_run_at: ago(200), last_success_at: ago(200) }), NOW);
    assert.equal(h.state, "delayed");
    assert.equal(h.tone, "warn");
    assert.match(h.reason, /3 h 20 min de atraso; el umbral es 3 h/);
    assert.equal(h.action?.kind, "retry");
  });

  it("delayed uses the configured threshold", () => {
    assert.equal(assessSource(source({ covered_until: ago(200), stale_after_minutes: 240 }), NOW).state, "healthy");
    assert.equal(assessSource(source({ covered_until: ago(50), stale_after_minutes: 30 }), NOW).state, "delayed");
  });

  it("failing: three or more consecutive failures, with backoff and a concrete action", () => {
    const h = assessSource(
      source({ consecutive_failures: 4, last_error: "El token de la página expiró o no es válido (Meta 190). Vuelve a conectarla.", last_error_at: ago(30), type: "meta" }),
      NOW,
    );
    assert.equal(h.state, "failing");
    assert.equal(h.tone, "error");
    assert.deepEqual(h.action, { kind: "edit", label: "Reconectar el token de la página", href: "/configuracion/fuentes" });
    // 4 failures → 2 h backoff from the last error, then the next cron tick.
    assert.equal(h.nextAttemptAt, "2026-10-13T20:00:00.000Z");
  });

  it("degraded: one failure is an error state, not a failure streak", () => {
    const h = assessSource(source({ consecutive_failures: 1, last_error: "diario.mx no respondió.", last_error_at: ago(10) }), NOW);
    assert.equal(h.state, "degraded");
    assert.equal(h.action?.kind, "retry");
  });

  it("paused: voluntary, muted, no next attempt", () => {
    const h = assessSource(source({ is_active: false }), NOW);
    assert.equal(h.state, "paused");
    assert.equal(h.tone, "muted");
    assert.equal(h.nextAttemptAt, null);
    assert.equal(h.coverage, "unknown", "a paused source is not reported as covered");
  });

  it("partial: catching up after a cap, with the reason", () => {
    const h = assessSource(
      source({ catching_up: true, last_run: okRun({ status: "partial", complete: false, limits: [{ kind: "pages", detail: "Videos: se leyeron 2 páginas." }] }) }),
      NOW,
    );
    assert.equal(h.state, "partial");
    assert.equal(h.coverage, "partial");
    assert.match(h.coverageReason!, /Videos: se leyeron 2 páginas/);
  });

  it("partial: an unrecoverable gap is reported with its dates in Mexico City time", () => {
    const h = assessSource(source({ last_run: okRun({ status: "partial", gap_from: "2026-10-13T14:00:00Z", gap_to: "2026-10-13T16:00:00Z" }) }), NOW);
    assert.equal(h.state, "partial");
    assert.match(h.reason, /8:00/);
  });

  it("no_data: read fine but the provider published nothing (not an error)", () => {
    const h = assessSource(source({ last_new_item_at: ago(80 * 60) }), NOW);
    assert.equal(h.state, "no_data");
    assert.equal(h.tone, "info");
    assert.match(h.reason, /no es un error/);
    assert.equal(assessSource(source({ last_new_item_at: ago(80 * 60), quiet_after_hours: 100 }), NOW).state, "healthy");
  });

  it("unknown: never fully read is not green", () => {
    const h = assessSource(source({ covered_until: null, last_run_at: null, last_success_at: null, last_run: null }), NOW);
    assert.equal(h.state, "unknown");
    assert.equal(h.coverage, "unknown");
    assert.notEqual(h.tone, "ok");
  });

  it("unavailable when the connector is disabled", () => {
    assert.equal(assessSource(source({ type: "x" }), NOW, false).state, "unavailable");
  });
});

describe("next attempt", () => {
  it("follows the frequency and the hourly cron", () => {
    assert.equal(nextAttempt(source({ last_run_at: ago(20) }), NOW), "2026-10-13T19:00:00.000Z");
    assert.equal(nextAttempt(source({ last_run_at: ago(20), expected_every_minutes: 360 }), NOW), "2026-10-14T00:00:00.000Z");
  });

  it("backoff matches claim_sources", () => {
    assert.equal(backoffUntil(2, ago(1)), null);
    assert.equal(backoffUntil(3, "2026-10-13T10:00:00Z")?.toISOString(), "2026-10-13T11:00:00.000Z");
    assert.equal(backoffUntil(12, "2026-10-13T10:00:00Z")?.toISOString(), "2026-10-14T10:00:00.000Z");
  });
});

describe("actionForError", () => {
  it("maps errors to concrete steps", () => {
    assert.equal(actionForError("La URL de la fuente no está permitida: …", "rss").label, "Revisar la URL del feed");
    assert.equal(actionForError("Se agotó la cuota diaria de la API de YouTube").kind, "wait");
    assert.equal(actionForError("feed.example tardó demasiado en responder.").kind, "retry");
  });
});

const snapshot = (over: Partial<HealthSnapshot> = {}): HealthSnapshot => ({
  as_of: NOW.toISOString(),
  editor: true,
  settings: { classify_backlog_minutes: 30, classify_stale_minutes: 20, dashboard_stale_minutes: 30 },
  heartbeats: {
    classify: { last_started_at: ago(3), last_finished_at: ago(2), last_ok_at: ago(2), failed: false, last_error: null },
    dashboard: { last_started_at: ago(2), last_finished_at: ago(2), last_ok_at: ago(2), failed: false, last_error: null },
  },
  classifier: { pending: 0, waiting_retry: 0, in_flight: 0, oldest_pending_at: null, failed: 0, open_failures: 0, latest_classified_at: ago(2) },
  sources: [source()],
  ...over,
});

describe("classifier and dashboard", () => {
  it("idle and fresh", () => {
    assert.equal(assessClassifier(snapshot(), NOW).state, "idle");
    assert.equal(assessDashboard(snapshot(), NOW).state, "ok");
  });

  it("backlog when the oldest pending waits too long", () => {
    const h = snapshot({ classifier: { ...snapshot().classifier, pending: 40, oldest_pending_at: ago(45) } });
    assert.equal(assessClassifier(h, NOW).state, "backlog");
  });

  it("stalled when mentions wait and the classifier has not run", () => {
    const base = snapshot();
    const h = snapshot({
      heartbeats: { ...base.heartbeats, classify: { ...base.heartbeats.classify!, last_finished_at: ago(60) } },
      classifier: { ...base.classifier, pending: 5, oldest_pending_at: ago(10) },
    });
    assert.equal(assessClassifier(h, NOW).tone, "error");
  });

  it("mentions waiting their retry backoff do not count as stalled", () => {
    const base = snapshot();
    const h = snapshot({
      heartbeats: { ...base.heartbeats, classify: { ...base.heartbeats.classify!, last_finished_at: ago(60) } },
      classifier: { ...base.classifier, pending: 2, waiting_retry: 2, oldest_pending_at: ago(90) },
    });
    assert.equal(assessClassifier(h, NOW).tone, "ok");
  });

  it("unknown without heartbeats", () => {
    const h = snapshot({ heartbeats: {} });
    assert.equal(assessClassifier(h, NOW).state, "unknown");
    assert.equal(assessDashboard(h, NOW).state, "unknown");
  });

  it("a correction must reach the dashboard within the freshness threshold", () => {
    const within = snapshot({ corrections: { pending: 2, oldest_pending_at: ago(5) } });
    assert.equal(assessDashboard(within, NOW).state, "ok");
    assert.match(assessDashboard(within, NOW).reason, /2 correcciones por reflejar/);
    const late = snapshot({ corrections: { pending: 1, oldest_pending_at: ago(45) } });
    assert.equal(assessDashboard(late, NOW).state, "stale");
    assert.match(assessDashboard(late, NOW).reason, /1 corrección sin reflejar/);
  });

  it("dashboard stale when newer classifications exist past the threshold", () => {
    const base = snapshot();
    const h = snapshot({
      heartbeats: { ...base.heartbeats, dashboard: { ...base.heartbeats.dashboard!, last_finished_at: ago(90) } },
      classifier: { ...base.classifier, latest_classified_at: ago(5) },
    });
    assert.equal(assessDashboard(h, NOW).state, "stale");
  });
});

describe("summarize", () => {
  it("green only when everything is known and fine", () => {
    assert.equal(summarize(snapshot(), NOW).tone, "ok");
  });

  it("never green with unknown coverage", () => {
    const h = snapshot({ sources: [source(), source({ id: "s2", covered_until: null, last_run_at: null, last_run: null })] });
    const s = summarize(h, NOW);
    assert.equal(s.tone, "warn");
    assert.equal(s.coveredUntil, null, "no overall watermark while a source is unknown");
  });

  it("counts states and ignores paused sources for the overall tone", () => {
    const h = snapshot({ sources: [source(), source({ id: "p", is_active: false }), source({ id: "f", consecutive_failures: 3, last_error_at: ago(5) })] });
    const s = summarize(h, NOW);
    assert.equal(s.counts.healthy, 1);
    assert.equal(s.counts.paused, 1);
    assert.equal(s.counts.failing, 1);
    assert.equal(s.tone, "error");
    assert.equal(s.active, 2);
  });

  it("no active sources is not healthy", () => {
    assert.equal(summarize(snapshot({ sources: [source({ is_active: false })] }), NOW).tone, "warn");
  });

  it("formats in Mexico City time", () => {
    assert.match(formatCdmx(NOW), /12:20/);
  });
});
