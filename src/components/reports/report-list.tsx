import Link from "next/link";
import { ChevronRight, FileText } from "lucide-react";
import { EmptyState } from "@/components/ui-kit";
import type { ReportRow, ReportStatus } from "@/lib/reports/data";
import { REPORT_KIND_LABELS } from "@/lib/reports/period";
import { cn } from "@/lib/utils";

export const STATUS_LABELS: Record<ReportStatus, string> = { draft: "Borrador", approved: "Aprobado", sent: "Enviado" };
export const STATUS_TONE: Record<ReportStatus, string> = {
  draft: "bg-amber-500/15 text-foreground",
  approved: "bg-primary/15 text-foreground",
  sent: "bg-positive/15 text-foreground",
};

const created = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Mexico_City" });

export function ReportList({ reports }: { reports: ReportRow[] }) {
  if (!reports.length) {
    return (
      <EmptyState
        icon={<FileText />}
        title="Aún no hay reportes"
        description="Genera uno con el botón de arriba o programa los envíos para que se preparen solos."
      />
    );
  }
  return (
    <ul className="flex flex-col gap-3" aria-label="Reportes">
      {reports.map((r) => (
        <li key={r.id}>
          <Link
            href={`/reportes/${r.id}`}
            className="group flex items-center gap-4 rounded-xl border bg-card p-4 transition-colors hover:border-primary/40"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileText className="size-5" aria-hidden />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className={cn("rounded-full px-2 py-0.5 font-medium", STATUS_TONE[r.status])}>{STATUS_LABELS[r.status]}</span>
                <span>{REPORT_KIND_LABELS[r.kind]}</span>
                <span aria-hidden>·</span>
                <span>{r.facts?.period?.label}</span>
              </div>
              <p className="truncate font-medium">{r.narrative?.headline ?? r.title}</p>
              <p className="text-xs text-muted-foreground">Generado el {created.format(new Date(r.createdAt))}</p>
            </div>
            <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}
