import { CheckCircle2, CircleAlert, CircleX, Clock } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoTip } from "@/components/ui-kit";
import { formatCdmx, formatDuration, sentence, SOURCE_STATE, type HealthSnapshot, type HealthSummary, type SourceState, type Tone } from "@/lib/health/model";
import { cn } from "@/lib/utils";
import { StatusBadge, TONE_BORDER, TONE_CLASS } from "./status-badge";

const TONE_ICON: Record<Tone, typeof CheckCircle2> = { ok: CheckCircle2, info: Clock, warn: CircleAlert, error: CircleX, muted: Clock };

const ORDER: SourceState[] = ["failing", "degraded", "delayed", "partial", "unknown", "no_data", "healthy", "paused", "unavailable"];

/** Overall state, cut-off time and the three blocks every role with access sees. Real data only. */
export function HealthSummaryView({ summary, snapshot }: { summary: HealthSummary; snapshot: HealthSnapshot }) {
  const Icon = TONE_ICON[summary.tone];
  const c = snapshot.classifier;
  const now = new Date(snapshot.as_of);
  const oldest = c.oldest_pending_at ? (now.getTime() - Date.parse(c.oldest_pending_at)) / 60_000 : null;
  return (
    <div className="flex flex-col gap-4">
      <div role="status" className={cn("flex items-start gap-3 rounded-xl border p-4", TONE_BORDER[summary.tone])}>
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", TONE_CLASS[summary.tone])}>
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="flex flex-col gap-0.5">
          <p className="font-medium">{summary.headline}</p>
          <p className="text-sm text-muted-foreground">
            Datos al corte: {formatCdmx(snapshot.as_of)} (hora de la Ciudad de México).{" "}
            {summary.coveredUntil
              ? sentence(`Las fuentes activas están leídas al menos hasta ${formatCdmx(summary.coveredUntil)}`)
              : summary.active
                ? "La cobertura de alguna fuente activa todavía es desconocida."
                : ""}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="flex items-center gap-1.5 text-base">
              Fuentes
              <InfoTip label="el estado de las fuentes">
                Cada fuente se evalúa con sus propios umbrales (frecuencia, atraso y tiempo sin publicaciones). Pausadas y no
                disponibles no cuentan para el estado general.
              </InfoTip>
            </CardTitle>
            <CardDescription>{summary.active} activas de {snapshot.sources.length}</CardDescription>
          </CardHeader>
          <CardContent>
            {snapshot.sources.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay fuentes conectadas.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {ORDER.filter((s) => summary.counts[s] > 0).map((s) => (
                  <li key={s}>
                    <StatusBadge tone={SOURCE_STATE[s].tone}>
                      {summary.counts[s]} {SOURCE_STATE[s].label.toLowerCase()}
                    </StatusBadge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2" className="flex items-center gap-1.5 text-base">
              Clasificación
              <InfoTip label="la clasificación">
                Menciones que esperan ser clasificadas por la IA, la más antigua y las que fallaron. Corre cada 5 minutos.
              </InfoTip>
            </CardTitle>
            <CardDescription>
              <StatusBadge tone={summary.classifier.tone}>{summary.classifier.label}</StatusBadge>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            <p>
              <span className="font-medium tabular-nums">{c.pending}</span> pendientes
              {c.waiting_retry ? ` (${c.waiting_retry} en espera de reintento)` : ""}
              {oldest !== null ? ` · la más antigua hace ${formatDuration(oldest)}` : ""}
            </p>
            <p>
              <span className="font-medium tabular-nums">{c.failed}</span> fallidas
              {snapshot.editor && c.open_failures ? ` · ${c.open_failures} por revisar` : ""}
            </p>
            <p className="text-muted-foreground">{summary.classifier.reason}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2" className="flex items-center gap-1.5 text-base">
              Frescura del dashboard
              <InfoTip label="la frescura del dashboard">
                El dashboard, el mapa y los reportes leen un resumen por hora que se reconstruye cuando entran o se clasifican
                menciones.
              </InfoTip>
            </CardTitle>
            <CardDescription>
              <StatusBadge tone={summary.dashboard.tone}>{summary.dashboard.label}</StatusBadge>
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{summary.dashboard.reason}</CardContent>
        </Card>
      </div>
    </div>
  );
}
