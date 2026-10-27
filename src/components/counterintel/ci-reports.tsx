"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatDateTime } from "@/components/inbox/format";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { updateCiReportStatus } from "@/lib/counterintel/actions";
import type { CiReport } from "@/lib/counterintel/data";
import { CI_KIND_LABELS, CI_SEVERITY_LABELS, CI_STATUS_LABELS, type CiStatus } from "@/lib/counterintel/model";

export function CiReports({ reports, canEdit }: { reports: CiReport[]; canEdit: boolean }) {
  if (reports.length === 0) return <p className="text-sm text-muted-foreground">Sin reportes registrados.</p>;
  return (
    <ul className="flex flex-col gap-2" aria-label="Reportes de Radar Social">
      {reports.map((r) => (
        <ReportItem key={r.id} report={r} canEdit={canEdit} />
      ))}
    </ul>
  );
}

function ReportItem({ report, canEdit }: { report: CiReport; canEdit: boolean }) {
  const router = useRouter();
  const [closing, setClosing] = useState(false);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  function change(status: CiStatus, closedNote = "") {
    startTransition(async () => {
      const result = await updateCiReportStatus({ id: report.id, status, closedNote });
      if (!result.ok) return void toast.error(result.message);
      toast.success(result.message);
      setClosing(false);
      setNote("");
      router.refresh();
    });
  }

  return (
    <li className="rounded-lg bg-muted/50 p-3 text-sm">
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{CI_KIND_LABELS[report.kind]}</span>
        <span>Gravedad {CI_SEVERITY_LABELS[report.severity].toLowerCase()}</span>
        <span>{CI_STATUS_LABELS[report.status]}</span>
        <span>Actualizado {formatDateTime(report.updatedAt)}</span>
      </p>
      <p className="mt-1 font-medium">{report.title}</p>
      {report.summary && <p className="mt-1 whitespace-pre-line text-muted-foreground">{report.summary}</p>}
      {report.indicators.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Indicadores">
          {report.indicators.map((i) => (
            <li key={i} className="rounded bg-background px-2 py-0.5 font-mono text-xs">
              {i}
            </li>
          ))}
        </ul>
      )}
      {report.mentionIds.length > 0 && (
        <p className="mt-2 flex flex-wrap gap-2 text-xs">
          {report.mentionIds.map((id, n) => (
            <a key={id} className="underline" href={`/bandeja/${id}`}>
              Evidencia {n + 1}
            </a>
          ))}
        </p>
      )}
      {report.status === "closed" && report.closedNote && <p className="mt-2 text-xs">Cierre: {report.closedNote}</p>}
      {canEdit && report.status !== "closed" && (
        <div className="mt-2 flex flex-col gap-2">
          {closing ? (
            <>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} aria-label="Nota de cierre" placeholder="Cómo se resolvió" />
              <div className="flex gap-2">
                <Button size="sm" disabled={pending || note.trim().length < 3} onClick={() => change("closed", note)}>
                  Cerrar reporte
                </Button>
                <Button size="sm" variant="outline" disabled={pending} onClick={() => setClosing(false)}>
                  Cancelar
                </Button>
              </div>
            </>
          ) : (
            <div className="flex gap-2">
              {report.status === "open" && (
                <Button size="sm" variant="outline" disabled={pending} onClick={() => change("monitoring")}>
                  Pasar a seguimiento
                </Button>
              )}
              <Button size="sm" variant="outline" disabled={pending} onClick={() => setClosing(true)}>
                Cerrar…
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
