import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CASE_STATUS_LABELS, type CaseStatus } from "@/lib/cases/model";
import { PRIORITY_LABELS, type Priority } from "@/lib/inbox/model";
import type { PendingCase } from "@/lib/kpi/snapshot";

/** Overdue open cases at the cut: folio, category and area (no title or text). */
export function PendingCases({ cases }: { cases: PendingCase[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h3">Vencidos al corte</CardTitle>
        <CardDescription>Los casos abiertos con el plazo de su paso vencido, del más atrasado al menos.</CardDescription>
      </CardHeader>
      <CardContent>
        {cases.length ? (
          <ul className="flex flex-col divide-y text-sm" aria-label="Casos vencidos al corte">
            {cases.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5">
                <Link href={`/casos/${c.id}`} className="font-mono text-xs underline">
                  {c.folio}
                </Link>
                <span>{c.category ?? "Sin categoría"}</span>
                <span className="text-xs text-muted-foreground">
                  {c.department ?? "Sin asignar"} · {PRIORITY_LABELS[c.priority as Priority] ?? c.priority} · {CASE_STATUS_LABELS[c.status as CaseStatus] ?? c.status}
                </span>
                {c.overdueHours != null && <span className="ml-auto text-xs font-medium text-negative tabular-nums">{c.overdueHours} h de atraso</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Ningún caso abierto tiene el plazo vencido al corte.</p>
        )}
      </CardContent>
    </Card>
  );
}
