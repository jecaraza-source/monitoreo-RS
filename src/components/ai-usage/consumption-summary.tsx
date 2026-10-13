import { AlertTriangle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AiConsumption } from "@/lib/ai-usage/data";
import { budgetShare, knownCost, PURPOSE_LABELS, type Totals } from "@/lib/ai-usage/model";
import { formatUsd, TARIFFS } from "@/lib/ai/pricing";

const integer = new Intl.NumberFormat("es-MX");

/** "US$1.20 + 3 solicitudes de costo desconocido": unknown cost is never added as 0. */
export function CostText({ totals }: { totals: Totals }) {
  const known = knownCost(totals);
  return (
    <span>
      <span className="font-medium">{formatUsd(known)}</span>
      {known !== null && totals.unpricedRequests > 0 && (
        <span className="text-amber-600 dark:text-amber-400">
          {" "}
          + {integer.format(totals.unpricedRequests)} {totals.unpricedRequests === 1 ? "solicitud" : "solicitudes"} de costo desconocido
        </span>
      )}
    </span>
  );
}

function Tile({ title, totals, budget, budgetLabel }: { title: string; totals: Totals; budget: number | null; budgetLabel: string }) {
  const share = budgetShare(totals.pricedUsd, budget);
  return (
    <section aria-label={title} className="flex flex-col gap-1 rounded-lg border p-3">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      <p className="text-xl">
        <CostText totals={totals} />
      </p>
      <p className="text-xs text-muted-foreground">
        {integer.format(totals.requests)} solicitudes · {integer.format(totals.tokens)} tokens
        {totals.unpricedTokens > 0 && <> · {integer.format(totals.unpricedTokens)} tokens sin tarifa</>}
      </p>
      <p className="text-xs">
        {budget ? (
          <>
            {budgetLabel}: {formatUsd(budget)} ({share}% usado)
          </>
        ) : (
          <span className="text-muted-foreground">{budgetLabel}: sin límite</span>
        )}
      </p>
    </section>
  );
}

export function ConsumptionSummary({ data }: { data: AiConsumption }) {
  const tariff = TARIFFS.at(-1);
  return (
    <div className="flex flex-col gap-4">
      {data.untariffed.length > 0 && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Tarifa no configurada para {data.untariffed.join(", ")}: sus tokens se cuentan, pero su costo es desconocido y no se suma como cero. Agrega la
            tarifa publicada en <code>src/lib/ai/pricing.ts</code> o cambia el modelo.
          </span>
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Tile title={`Hoy (${data.todayDay})`} totals={data.today} budget={data.limits.daily_budget_usd} budgetLabel="Presupuesto diario" />
        <Tile title="Este mes" totals={data.month} budget={data.limits.monthly_budget_usd} budgetLabel="Presupuesto mensual" />
      </div>
      <p className="text-xs text-muted-foreground">
        En curso: {data.inFlight.length ? data.inFlight.map((f) => `${PURPOSE_LABELS[f.purpose] ?? f.purpose} ${f.count}`).join(" · ") : "ninguna"}.
        {data.unreconciled.expired + data.unreconciled.released > 0 && (
          <>
            {" "}
            Últimas 24 h: {data.unreconciled.expired} reservas vencidas sin conciliar y {data.unreconciled.released} llamadas canceladas o fallidas sin consumo
            registrado.
          </>
        )}{" "}
        Tarifa vigente {tariff?.version} ({tariff?.source}) Estimado con precios de lista; la factura del proveedor es la fuente de verdad.
      </p>

      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Consumo del mes por uso y modelo, desplazable">
        <Table aria-label="Consumo del mes por uso y modelo">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Uso</TableHead>
              <TableHead scope="col">Modelo</TableHead>
              <TableHead scope="col" className="text-right">Solicitudes</TableHead>
              <TableHead scope="col" className="text-right">Tokens</TableHead>
              <TableHead scope="col" className="text-right">Costo estimado</TableHead>
              <TableHead scope="col">Tarifa</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.breakdown.length ? (
              data.breakdown.map((b) => (
                <TableRow key={`${b.purpose}|${b.model}`}>
                  <TableCell>{PURPOSE_LABELS[b.purpose] ?? b.purpose}</TableCell>
                  <TableCell className="font-mono text-xs">{b.model}</TableCell>
                  <TableCell className="text-right">{integer.format(b.requests)}</TableCell>
                  <TableCell className="text-right">{integer.format(b.tokens)}</TableCell>
                  <TableCell className="text-right">
                    <CostText totals={b} />
                  </TableCell>
                  <TableCell>{b.hasTariff ? (b.tariffVersion ?? "—") : <span className="text-amber-600 dark:text-amber-400">No configurada</span>}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  Sin consumo este mes.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
