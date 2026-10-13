import type { Metadata } from "next";
import Link from "next/link";
import { formatDateTime } from "@/components/inbox/format";
import { OutboxTable } from "@/components/sla/outbox-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSection } from "@/lib/auth/session";
import { getDeliveryMonitor } from "@/lib/sla/data";
import { JOB_STAGE_LABELS, OUTBOX_KIND_LABELS, OUTBOX_STATUS_LABELS } from "@/lib/sla/model";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Envíos" };

const RESULT_LABELS: Record<string, string> = { queued: "en cola", no_recipient: "sin destinatario configurado", no_channel: "sin canal activo" };
const LEVEL_LABELS: Record<string, string> = { link: "enlace", head: "titular", coordinator: "coordinación" };

export default async function DeliveriesPage() {
  const member = await requireSection("/configuracion/envios");
  const d = await getDeliveryMonitor(member);

  return (
    <div className="flex flex-col gap-5 pt-4">
      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">
            Envíos (últimos 7 días)
          </CardTitle>
          <CardDescription>
            Alertas, reportes, recordatorios y escalamientos salen de una cola durable: cada uno tiene una clave única, reintentos con espera creciente y un
            registro por intento. Los que fallan o quedan inciertos no se pierden: aparecen aquí.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul className="flex flex-wrap gap-2 text-sm" aria-label="Envíos por estado">
            {Object.entries(OUTBOX_STATUS_LABELS).map(([status, label]) => (
              <li key={status} className={cn("rounded-lg border px-3 py-1.5", (status === "dead" || status === "uncertain") && d.byStatus[status] && "border-negative/50 text-negative")}>
                {label}: <span className="font-semibold tabular-nums">{d.byStatus[status] ?? 0}</span>
              </li>
            ))}
          </ul>
          <OutboxTable items={d.outbox} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">
            Reportes programados
          </CardTitle>
          <CardDescription>Un trabajo por municipio, tipo y periodo. Avanza por etapas y se retoma donde se quedó si algo falla.</CardDescription>
        </CardHeader>
        <CardContent>
          {d.jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin trabajos todavía.</p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-sm" aria-label="Trabajos de reportes">
              {d.jobs.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  <span className="font-medium">
                    {j.kind === "daily" ? "Diario" : j.kind === "weekly" ? "Semanal" : "Mensual"} {j.period_start}
                    {j.period_end !== j.period_start ? ` a ${j.period_end}` : ""}
                  </span>
                  <span className={cn(j.stage === "failed" && "font-medium text-negative")}>{JOB_STAGE_LABELS[j.stage] ?? j.stage}</span>
                  {j.attempts > 0 && <span className="text-xs text-muted-foreground">{j.attempts} reintentos</span>}
                  {j.last_error && <span className="text-xs text-muted-foreground">{j.last_error}</span>}
                  {j.report_id && (
                    <Link href={`/reportes/${j.report_id}`} className="text-xs underline">
                      Ver reporte
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">
            Recordatorios y escalamientos
          </CardTitle>
        </CardHeader>
        <CardContent>
          {d.events.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin avisos todavía.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm" aria-label="Avisos de casos">
              {d.events.map((e) => (
                <li key={e.id} className="flex flex-col">
                  <span>
                    <span className={cn("font-medium", e.kind === "emergency" && "text-negative")}>{OUTBOX_KIND_LABELS[e.kind] ?? e.kind}</span>
                    {e.level ? ` · ${LEVEL_LABELS[e.level]}` : ""} · {RESULT_LABELS[e.result] ?? e.result}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(e.created_at)} · {e.reason}
                    {e.case_id && (
                      <>
                        {" "}
                        ·{" "}
                        <Link href={`/casos/${e.case_id}`} className="underline">
                          caso
                        </Link>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
