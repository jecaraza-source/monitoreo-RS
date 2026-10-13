import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { MonthRow } from "@/lib/ai-usage/model";
import { formatUsd } from "@/lib/ai/pricing";
import { CostText } from "./consumption-summary";
import { DeleteInvoiceButton } from "./invoice-form";

const STATUS: Record<MonthRow["status"], { label: string; className: string }> = {
  sin_factura: { label: "Sin factura", className: "text-muted-foreground" },
  conciliado: { label: "Conciliado (±5 %)", className: "text-emerald-600 dark:text-emerald-400" },
  diferencia: { label: "Diferencia por revisar", className: "text-red-600 dark:text-red-400" },
  incompleto: { label: "Estimado incompleto (costo desconocido)", className: "text-amber-700 dark:text-amber-400" },
};

const monthLabel = (m: string) => new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}T12:00:00Z`));

export function ReconciliationTable({ rows, canEdit }: { rows: MonthRow[]; canEdit: boolean }) {
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Conciliación con facturación, desplazable">
      <Table aria-label="Conciliación con facturación">
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Mes</TableHead>
            <TableHead scope="col" className="text-right">Estimado</TableHead>
            <TableHead scope="col" className="text-right">Factura</TableHead>
            <TableHead scope="col" className="text-right">Diferencia</TableHead>
            <TableHead scope="col">Estado</TableHead>
            {canEdit && <TableHead scope="col"><span className="sr-only">Acciones</span></TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.month}>
              <TableCell className="capitalize">{monthLabel(r.month)}</TableCell>
              <TableCell className="text-right">
                <CostText totals={r.estimate} />
              </TableCell>
              <TableCell className="text-right">
                {r.invoice ? formatUsd(r.invoice.amount_usd) : "—"}
                {r.invoice?.reference && <span className="block text-xs text-muted-foreground">{r.invoice.reference}</span>}
              </TableCell>
              <TableCell className="text-right">{r.difference === null ? "—" : `${r.difference >= 0 ? "+" : "−"}${formatUsd(Math.abs(r.difference))}`}</TableCell>
              <TableCell className={STATUS[r.status].className}>{STATUS[r.status].label}</TableCell>
              {canEdit && <TableCell>{r.invoice && <DeleteInvoiceButton id={r.invoice.id} />}</TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
