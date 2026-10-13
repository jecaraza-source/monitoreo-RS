"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Download, GitBranch, Loader2, RefreshCw, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { approveReport, deleteDraft, refreshReportFacts, resendReport, reviseReport, type ReportActionResult } from "@/lib/reports/actions";
import type { ReportStatus } from "@/lib/reports/data";

export function ReportActions({
  report,
  canEdit,
}: {
  report: { id: string; status: ReportStatus; pdfPath: string | null; recipients: string[]; hasRevision: boolean };
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<ReportActionResult>, after?: () => void) =>
    startTransition(async () => {
      const r = await action();
      if (!r.ok) return void toast.error(r.message);
      toast.success(r.message);
      after?.();
      router.refresh();
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {report.pdfPath && (
        <a href={`/reportes/${report.id}/pdf`} className={buttonVariants({ variant: "outline" })}>
          <Download aria-hidden /> Descargar PDF
        </a>
      )}
      {canEdit && report.status === "draft" && (
        <>
          <Button variant="outline" disabled={pending} onClick={() => run(() => refreshReportFacts({ reportId: report.id }))}>
            <RefreshCw aria-hidden /> Actualizar cifras
          </Button>
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => confirm("¿Borrar este borrador?") && run(() => deleteDraft({ reportId: report.id }), () => router.push("/reportes"))}
          >
            <Trash2 aria-hidden /> Borrar
          </Button>
          <Button
            disabled={pending}
            onClick={() => {
              const send = report.recipients.length > 0;
              const ask = send
                ? `Se congelará la narrativa y se enviará el PDF a ${report.recipients.length} destinatario(s). ¿Aprobar?`
                : "Se congelará la narrativa y se generará el PDF. ¿Aprobar?";
              if (confirm(ask)) run(() => approveReport({ reportId: report.id, send }));
            }}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <CheckCircle2 aria-hidden />} Aprobar
          </Button>
        </>
      )}
      {canEdit && report.status !== "draft" && !report.hasRevision && (
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            confirm("Se creará un borrador nuevo (siguiente versión) con las cifras de hoy y este texto como base. La versión aprobada no cambia. ¿Continuar?") &&
            startTransition(async () => {
              const r = await reviseReport({ reportId: report.id });
              if (!r.ok) return void toast.error(r.message);
              toast.success(r.message);
              if (r.id) router.push(`/reportes/${r.id}`);
            })
          }
        >
          <GitBranch aria-hidden /> Crear revisión
        </Button>
      )}
      {canEdit && report.status !== "draft" && report.recipients.length > 0 && (
        <Button variant="outline" disabled={pending} onClick={() => run(() => resendReport({ reportId: report.id }))}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />} {report.status === "sent" ? "Reenviar" : "Enviar"}
        </Button>
      )}
    </div>
  );
}
