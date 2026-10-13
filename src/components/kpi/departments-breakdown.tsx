import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MIN_CASES_TO_COMPARE, MIN_CYCLES_FOR_MEDIAN } from "@/lib/kpi/dictionary";
import { departmentsCsv, type DepartmentComparison } from "@/lib/kpi/snapshot";
import { DownloadCsv } from "./download-csv";

const integer = new Intl.NumberFormat("es-MX");
const hours = (v: number | null) => (v == null ? "—" : `${v} h`);

/**
 * Cases per department as a breakdown (alphabetical, not a ranking): counts,
 * overdue share and resolution median with its n and p90. Low volumes and
 * catalog changes are marked instead of compared.
 */
export function DepartmentsBreakdown({ rows, period }: { rows: DepartmentComparison[]; period: { fromDay: string; toDay: string } }) {
  const casesHref = (id: string, extra: Record<string, string>) => `/casos?${new URLSearchParams({ dependencia: id, ...extra })}`;
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle as="h3">Casos por dependencia</CardTitle>
          <CardDescription>
            Desglose en orden alfabético, no un ranking. Con menos de {MIN_CASES_TO_COMPARE} casos se marca «volumen bajo», y una mediana con menos de{" "}
            {MIN_CYCLES_FOR_MEDIAN} ciclos cerrados se muestra con su n pero no se compara. La dependencia de un caso es su responsable actual.
          </CardDescription>
        </div>
        {rows.length > 0 && <DownloadCsv csv={departmentsCsv(rows)} fileName={`casos-por-dependencia-${period.fromDay}-a-${period.toDay}.csv`} />}
      </CardHeader>
      <CardContent>
        {rows.length ? (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Casos por dependencia, desplazable">
            <Table aria-label="Casos por dependencia">
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Dependencia</TableHead>
                  <TableHead scope="col" className="text-right">Nuevos</TableHead>
                  <TableHead scope="col" className="text-right">Abiertos al corte</TableHead>
                  <TableHead scope="col" className="text-right">Vencidos</TableHead>
                  <TableHead scope="col" className="text-right">Cierres validados</TableHead>
                  <TableHead scope="col" className="text-right">Resolución (mediana · p90 · n)</TableHead>
                  <TableHead scope="col" className="text-right">Reaperturas</TableHead>
                  <TableHead scope="col" className="text-right">Menciones (neg. · quejas)</TableHead>
                  <TableHead scope="col">Nota</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id ?? "none"}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.id ? <Link className="underline-offset-2 hover:underline" href={casesHref(r.id, { estado: "all", desde: period.fromDay, hasta: period.toDay })}>{integer.format(r.opened)}</Link> : integer.format(r.opened)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.id ? <Link className="underline-offset-2 hover:underline" href={casesHref(r.id, { estado: "open" })}>{integer.format(r.openAtCut)}</Link> : integer.format(r.openAtCut)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {integer.format(r.overdueAtCut)}
                      {r.overduePct != null && !r.lowVolume && <span className="text-muted-foreground"> ({r.overduePct} %)</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{integer.format(r.validatedClosures)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.resolution.n ? `${hours(r.resolution.median)} · ${hours(r.resolution.p90)} · ${r.resolution.n}` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{integer.format(r.reopenings)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {integer.format(r.mentions)} <span className="text-muted-foreground">({integer.format(r.negativeMentions)} · {integer.format(r.complaintMentions)})</span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {[r.lowVolume && "Volumen bajo", r.thinMedian && r.resolution.n > 0 && "Mediana con pocos casos", r.newInCatalog && "Nueva en el catálogo"]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Sin casos ni menciones por dependencia en el periodo.</p>
        )}
      </CardContent>
    </Card>
  );
}
