import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RunView } from "@/lib/sources/data";

const time = new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short" });

export function RunsTable({ runs }: { runs: RunView[] }) {
  if (runs.length === 0) return <p className="text-sm text-muted-foreground">Todavía no hay corridas.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Cuándo</TableHead>
          <TableHead>Fuente</TableHead>
          <TableHead>Origen</TableHead>
          <TableHead className="text-right">Leídas</TableHead>
          <TableHead className="text-right">Nuevas</TableHead>
          <TableHead className="text-right">Repetidas</TableHead>
          <TableHead className="text-right" title="Ya conocidas cuyas interacciones cambiaron">Actualizadas</TableHead>
          <TableHead className="text-right">Sin consulta</TableHead>
          <TableHead>Resultado</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => (
          <TableRow key={run.id}>
            <TableCell className="whitespace-nowrap text-muted-foreground">{time.format(new Date(run.startedAt))}</TableCell>
            <TableCell>{run.sourceName}</TableCell>
            <TableCell className="text-muted-foreground">{run.trigger === "cron" ? "Programada" : "Manual"}</TableCell>
            <TableCell className="text-right tabular-nums">{run.fetched}</TableCell>
            <TableCell className="text-right font-medium tabular-nums">{run.inserted}</TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">{run.duplicates}</TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">{run.updated}</TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">{run.unmatched}</TableCell>
            <TableCell className="max-w-80 whitespace-normal">
              {run.status === "ok" ? (
                <span className="text-positive">Correcta</span>
              ) : run.status === "partial" ? (
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium">{run.complete === false ? "Parcial: continúa en la siguiente" : "Con avisos"}</span>
                  {[...run.limits.map((l) => l.detail), ...(run.error ? [run.error] : [])].map((d, i) => (
                    <span key={i} className="text-xs text-muted-foreground">
                      {d}
                    </span>
                  ))}
                  {run.gap && (
                    <span className="text-xs text-negative">
                      Sin cobertura del {time.format(new Date(run.gap.from))} al {time.format(new Date(run.gap.to))}
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-negative" title={run.error ?? undefined}>
                  {run.error ?? "Error"}
                </span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
