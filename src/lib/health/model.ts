// Health of the monitor: turns the persisted snapshot (public.monitor_health)
// into states, reasons and next steps. Pure, shared by the page, the health
// alerts and unit tests.
//
// Never green on missing evidence: a source never fully read, a job that never
// reported, or a dashboard never refreshed is "unknown", not "ok".

export const TIME_ZONE = "America/Mexico_City";
/** The ingest cron runs at minute 0 of every hour (vercel.json). */
const INGEST_CRON_EVERY_MS = 3_600_000;

export type Tone = "ok" | "info" | "warn" | "error" | "muted";

export type SourceSnapshot = {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
  expected_every_minutes: number;
  stale_after_minutes: number | null;
  quiet_after_hours: number;
  last_run_at: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
  consecutive_failures: number;
  last_error: string | null;
  covered_until: string | null;
  catching_up: boolean;
  running: boolean;
  last_new_item_at: string | null;
  last_run: {
    id: string;
    status: "ok" | "partial" | "error";
    trigger: "cron" | "manual";
    started_at: string;
    complete: boolean | null;
    fetched: number;
    inserted: number;
    duplicates: number;
    unmatched: number;
    updated: number;
    gap_from: string | null;
    gap_to: string | null;
    limits: { kind: string; detail: string }[];
    error: string | null;
  } | null;
  day: { runs: number; errors: number; partial: number; fetched: number; inserted: number; duplicates: number; unmatched: number } | null;
};

export type Heartbeat = { last_started_at: string | null; last_finished_at: string | null; last_ok_at: string | null; failed: boolean; last_error: string | null };

export type HealthSnapshot = {
  as_of: string;
  editor: boolean;
  settings: { classify_backlog_minutes: number; classify_stale_minutes: number; dashboard_stale_minutes: number };
  heartbeats: Partial<Record<"ingest" | "classify" | "dashboard", Heartbeat>>;
  classifier: {
    pending: number;
    waiting_retry: number;
    in_flight: number;
    oldest_pending_at: string | null;
    failed: number;
    open_failures: number;
    latest_classified_at: string | null;
  };
  sources: SourceSnapshot[];
  /** Human corrections not yet reflected in the aggregates (stats_invalidations). */
  corrections?: { pending: number; oldest_pending_at: string | null } | null;
};

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export type SourceState = "healthy" | "no_data" | "partial" | "delayed" | "degraded" | "failing" | "paused" | "unavailable" | "unknown";

export const SOURCE_STATE: Record<SourceState, { label: string; tone: Tone }> = {
  healthy: { label: "Al día", tone: "ok" },
  no_data: { label: "Sin publicaciones nuevas", tone: "info" },
  partial: { label: "Cobertura parcial", tone: "warn" },
  delayed: { label: "Atrasada", tone: "warn" },
  degraded: { label: "Con errores", tone: "warn" },
  failing: { label: "Fallando", tone: "error" },
  paused: { label: "Pausada", tone: "muted" },
  unavailable: { label: "No disponible", tone: "muted" },
  unknown: { label: "Cobertura desconocida", tone: "warn" },
};

export type Coverage = "complete" | "partial" | "unknown";
export const COVERAGE_LABEL: Record<Coverage, string> = { complete: "Completa", partial: "Parcial", unknown: "Desconocida" };

export type SourceHealth = {
  state: SourceState;
  label: string;
  tone: Tone;
  reason: string;
  coverage: Coverage;
  coverageReason: string | null;
  /** Minutes between "now" and the coverage watermark (null when never covered). */
  lagMinutes: number | null;
  nextAttemptAt: string | null;
  action: HealthAction | null;
};

export type HealthAction =
  | { kind: "retry"; label: string }
  | { kind: "edit"; label: string; href: string }
  | { kind: "queue"; label: string; href: string }
  | { kind: "wait"; label: string };

const minutesBetween = (a: string | Date, b: string | Date) => (new Date(b).getTime() - new Date(a).getTime()) / 60_000;

/** Backoff of claim_sources: 1 h, 2 h, 4 h… up to 24 h after the third consecutive failure. */
export function backoffUntil(failures: number, lastErrorAt: string | null): Date | null {
  if (failures < 3 || !lastErrorAt) return null;
  const waitMs = Math.min(2 ** (failures - 3) * 3_600_000, 86_400_000);
  return new Date(Date.parse(lastErrorAt) + waitMs);
}

/** Next ingest cron tick at or after `t` (minute 0 of an hour). */
function nextTick(t: number): number {
  return Math.ceil(t / INGEST_CRON_EVERY_MS) * INGEST_CRON_EVERY_MS;
}

/** When the cron will next try this source (claim_sources rules), or null if it will not. */
export function nextAttempt(s: SourceSnapshot, now: Date, connectorEnabled = true): string | null {
  if (!s.is_active || !connectorEnabled) return null;
  let earliest = now.getTime();
  if (s.last_run_at) earliest = Math.max(earliest, Date.parse(s.last_run_at) + (s.expected_every_minutes - 5) * 60_000);
  const backoff = backoffUntil(s.consecutive_failures, s.last_error_at);
  if (backoff) earliest = Math.max(earliest, backoff.getTime());
  return new Date(nextTick(earliest)).toISOString();
}

/** A concrete next step for an error message (no secrets in the text: errors are already redacted). */
export function actionForError(error: string | null, sourceType?: string): HealthAction {
  const e = (error ?? "").toLowerCase();
  if (/token|meta 190|vuelve a conectarla|falta la credencial/.test(e)) {
    return { kind: "edit", label: "Reconectar el token de la página", href: "/configuracion/fuentes" };
  }
  if (/no está permitida|url de la fuente|http 404|http 410|no devuelve un feed|configuración inválida/.test(e)) {
    return { kind: "edit", label: sourceType === "rss" ? "Revisar la URL del feed" : "Revisar la configuración", href: "/configuracion/fuentes" };
  }
  if (/falta configurar (bluesky|reddit)|rechazó la cuenta o la contraseña de aplicación|rechazó reddit_client/.test(e)) {
    return { kind: "wait", label: "Configurar o renovar la llave del servidor en Vercel (Administración)" };
  }
  if (/cuota|limitó las consultas|youtube_api_key/.test(e)) {
    return { kind: "wait", label: "Esperar a que se renueve la cuota (se reintenta solo)" };
  }
  return { kind: "retry", label: "Reintentar ahora" };
}

export function assessSource(s: SourceSnapshot, now: Date, connectorEnabled = true): SourceHealth {
  const staleAfter = s.stale_after_minutes ?? s.expected_every_minutes * 3;
  const lagMinutes = s.covered_until ? Math.max(0, Math.round(minutesBetween(s.covered_until, now))) : null;
  const run = s.last_run;
  const gap = run?.gap_from && run.gap_to ? { from: run.gap_from, to: run.gap_to } : null;
  const limitText = run?.limits?.map((l) => l.detail).join(" ") || null;

  let coverage: Coverage = "unknown";
  let coverageReason: string | null = "Todavía no hay una lectura completa de esta fuente.";
  if (s.covered_until) {
    if (s.catching_up || run?.complete === false) {
      coverage = "partial";
      coverageReason = `Una corrida alcanzó un tope; las siguientes leen lo que faltó.${limitText ? ` ${limitText}` : ""}`;
    } else if (gap) {
      coverage = "partial";
      coverageReason = sentence(`El proveedor ya no devuelve lo publicado entre ${formatCdmx(gap.from)} y ${formatCdmx(gap.to)}`);
    } else {
      coverage = "complete";
      coverageReason = null;
    }
  }

  const base: Pick<SourceHealth, "coverage" | "coverageReason" | "lagMinutes" | "nextAttemptAt"> = {
    coverage,
    coverageReason,
    lagMinutes,
    nextAttemptAt: nextAttempt(s, now, connectorEnabled),
  };
  const make = (state: SourceState, reason: string, action: HealthAction | null = null): SourceHealth => ({
    ...base,
    state,
    label: SOURCE_STATE[state].label,
    tone: SOURCE_STATE[state].tone,
    reason,
    action,
  });

  if (!connectorEnabled || !s.is_active) {
    // Not being read: whatever was covered before says nothing about now.
    base.coverage = "unknown";
    base.coverageReason = connectorEnabled ? "No se lee mientras está pausada." : "El conector no está disponible.";
  }
  if (!connectorEnabled) return make("unavailable", "El conector está deshabilitado en el servidor.");
  if (!s.is_active) return make("paused", "Pausada por una persona: no se lee hasta reactivarla.", { kind: "edit", label: "Reactivar en Fuentes", href: "/configuracion/fuentes" });
  if (s.consecutive_failures >= 3) {
    return make(
      "failing",
      `${s.consecutive_failures} fallos seguidos${s.last_error ? `: ${s.last_error}` : "."} Se reintenta con espera creciente.`,
      actionForError(s.last_error, s.type),
    );
  }
  if (s.consecutive_failures > 0) {
    return make("degraded", `Falló la última corrida${s.last_error ? `: ${s.last_error}` : "."} Se reintenta en la siguiente.`, actionForError(s.last_error, s.type));
  }
  if (!s.covered_until || !s.last_run_at) {
    return make("unknown", s.last_run_at ? "Aún no termina una lectura completa." : "Todavía no se ha leído.", { kind: "retry", label: "Leer ahora" });
  }
  if (coverage === "partial") {
    const behind = lagMinutes !== null && lagMinutes > staleAfter ? ` Lleva ${formatDuration(lagMinutes)} de atraso.` : "";
    return make("partial", `${coverageReason}${behind}`, s.catching_up ? { kind: "wait", label: "Se completa en las siguientes corridas" } : null);
  }
  if (lagMinutes !== null && lagMinutes > staleAfter) {
    return make(
      "delayed",
      `Lo leído llega hasta ${formatCdmx(s.covered_until)} (${formatDuration(lagMinutes)} de atraso; el umbral es ${formatDuration(staleAfter)}).`,
      { kind: "retry", label: "Leer ahora" },
    );
  }
  const quietMinutes = s.quiet_after_hours * 60;
  const sinceNew = s.last_new_item_at ? minutesBetween(s.last_new_item_at, now) : null;
  if (sinceNew === null || sinceNew > quietMinutes) {
    return make(
      "no_data",
      sinceNew === null
        ? "Se lee bien, pero todavía no ha traído menciones nuevas."
        : `Se lee bien, pero no hay menciones nuevas desde hace ${formatDuration(sinceNew)}: el proveedor no ha publicado nada que coincida (no es un error).`,
    );
  }
  return make("healthy", sentence(`Leída hasta ${formatCdmx(s.covered_until)}`));
}

// ---------------------------------------------------------------------------
// Classifier and dashboard
// ---------------------------------------------------------------------------

export type JobState = "ok" | "idle" | "backlog" | "stalled" | "stale" | "unknown";
export type JobHealth = { state: JobState; tone: Tone; label: string; reason: string };

export function assessClassifier(h: HealthSnapshot, now: Date): JobHealth {
  const c = h.classifier;
  const beat = h.heartbeats.classify;
  const last = beat?.last_finished_at ?? null;
  const sinceRun = last ? minutesBetween(last, now) : null;
  const oldest = c.oldest_pending_at ? minutesBetween(c.oldest_pending_at, now) : null;
  const ready = c.pending - c.waiting_retry;

  if (!last) {
    return c.pending
      ? { state: "unknown", tone: "warn", label: "Sin registro", reason: `${c.pending} menciones esperan y todavía no hay registro de una corrida del clasificador.` }
      : { state: "unknown", tone: "warn", label: "Sin registro", reason: "Todavía no hay registro de una corrida del clasificador." };
  }
  if (ready > 0 && sinceRun !== null && sinceRun > h.settings.classify_stale_minutes) {
    return { state: "stalled", tone: "error", label: "Detenido", reason: `${ready} menciones esperan y el clasificador no corre desde hace ${formatDuration(sinceRun)}.` };
  }
  if (beat?.failed) {
    return { state: "stalled", tone: "error", label: "Con errores", reason: `La última corrida terminó con error${beat.last_error ? `: ${beat.last_error}` : "."}` };
  }
  if (oldest !== null && oldest > h.settings.classify_backlog_minutes && ready > 0) {
    return {
      state: "backlog",
      tone: "warn",
      label: "Con rezago",
      reason: `${c.pending} pendientes; la más antigua espera desde hace ${formatDuration(oldest)} (umbral ${formatDuration(h.settings.classify_backlog_minutes)}).`,
    };
  }
  if (c.pending === 0) return { state: "idle", tone: "ok", label: "Al día", reason: "No hay menciones pendientes de clasificar." };
  return { state: "ok", tone: "ok", label: "Al día", reason: `${c.pending} pendientes, dentro del umbral.` };
}

export function assessDashboard(h: HealthSnapshot, now: Date): JobHealth {
  const refreshed = h.heartbeats.dashboard?.last_finished_at ?? null;
  if (!refreshed) return { state: "unknown", tone: "warn", label: "Desconocida", reason: "Todavía no hay registro de una actualización del dashboard." };
  const latest = h.classifier.latest_classified_at;
  const age = minutesBetween(refreshed, now);
  // Corrections must reach the dashboard within the same freshness SLA.
  const corrections = h.corrections;
  if (corrections?.pending && corrections.oldest_pending_at) {
    const waiting = minutesBetween(corrections.oldest_pending_at, now);
    const n = `${corrections.pending} ${corrections.pending === 1 ? "corrección" : "correcciones"}`;
    if (waiting > h.settings.dashboard_stale_minutes) {
      return {
        state: "stale",
        tone: "warn",
        label: "Desactualizado",
        reason: `${n} sin reflejar desde ${formatCdmx(corrections.oldest_pending_at)} (umbral ${formatDuration(h.settings.dashboard_stale_minutes)}).`,
      };
    }
    return { state: "ok", tone: "ok", label: "Al día", reason: `Actualizado ${formatCdmx(refreshed)}; ${n} por reflejar en los próximos minutos.` };
  }
  if (latest && Date.parse(latest) > Date.parse(refreshed) && age > h.settings.dashboard_stale_minutes) {
    return {
      state: "stale",
      tone: "warn",
      label: "Desactualizado",
      reason: `Actualizado ${formatCdmx(refreshed)}; hay clasificaciones posteriores (umbral ${formatDuration(h.settings.dashboard_stale_minutes)}).`,
    };
  }
  return { state: "ok", tone: "ok", label: "Al día", reason: sentence(`Actualizado ${formatCdmx(refreshed)}`) };
}

// ---------------------------------------------------------------------------
// Summary (what lectura sees)
// ---------------------------------------------------------------------------

export type HealthSummary = {
  tone: Tone;
  headline: string;
  counts: Record<SourceState, number>;
  active: number;
  /** Oldest coverage watermark among active, readable sources: "the data is complete up to here". */
  coveredUntil: string | null;
  classifier: JobHealth;
  dashboard: JobHealth;
};

export function summarize(h: HealthSnapshot, now: Date, enabled: (type: string) => boolean = () => true): HealthSummary {
  const states = h.sources.map((s) => ({ s, health: assessSource(s, now, enabled(s.type)) }));
  const counts = Object.fromEntries(Object.keys(SOURCE_STATE).map((k) => [k, 0])) as Record<SourceState, number>;
  for (const { health } of states) counts[health.state]++;
  const active = states.filter(({ health }) => health.state !== "paused" && health.state !== "unavailable");
  const covered = active.map(({ s }) => s.covered_until);
  const coveredUntil = covered.length && covered.every(Boolean) ? covered.sort()[0] : null;
  const classifier = assessClassifier(h, now);
  const dashboard = assessDashboard(h, now);

  const tones = [...active.map(({ health }) => health.tone), classifier.tone, dashboard.tone];
  let tone: Tone = tones.includes("error") ? "error" : tones.includes("warn") ? "warn" : "ok";
  // Nothing to read is not "healthy".
  if (active.length === 0 && tone === "ok") tone = "warn";

  const headline =
    active.length === 0
      ? "No hay fuentes activas: no se está escuchando nada."
      : tone === "error"
        ? "Hay fuentes o procesos fallando: puede faltar información."
        : tone === "warn"
          ? "El monitoreo funciona con avisos: revisa las fuentes marcadas."
          : "Todo al día.";
  return { tone, headline, counts, active: active.length, coveredUntil, classifier, dashboard };
}

// ---------------------------------------------------------------------------
// Formatting (Mexico City time)
// ---------------------------------------------------------------------------

const cdmx = new Intl.DateTimeFormat("es-MX", { timeZone: TIME_ZONE, dateStyle: "medium", timeStyle: "short" });

export function formatCdmx(iso: string | Date): string {
  return cdmx.format(new Date(iso));
}

/** Ends with one period even when the text already ends in "a.m." or "p.m.". */
export function sentence(text: string): string {
  return text.endsWith(".") ? text : `${text}.`;
}

export function formatDuration(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 && h < 6 ? `${h} h ${m % 60} min` : `${h} h`;
  return `${Math.round(h / 24)} días`;
}
