"use client";

import { useState, useTransition } from "react";
import { DatabaseZap, FlaskConical } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { applyTicketBackfill, simulateTicketBackfill, type BackfillReport } from "@/lib/cases/actions";
import { TICKET_LABELS, type TicketStatus } from "@/lib/inbox/model";

const nf = new Intl.NumberFormat("es-MX");
const num = (r: BackfillReport, k: string) => nf.format(Number(r[k] ?? 0));

/**
 * Admin: turns the existing tickets into cases. Always a dry run first; the
 * real run is repeatable (it skips what it already did).
 */
export function BackfillPanel() {
  const [simulation, setSimulation] = useState<BackfillReport | null>(null);
  const [result, setResult] = useState<BackfillReport | null>(null);
  const [pending, startTransition] = useTransition();

  const simulate = () =>
    startTransition(async () => {
      const r = await simulateTicketBackfill();
      if (!r.ok) return void toast.error(r.message);
      setSimulation(r.data ?? null);
      setResult(null);
    });
  const apply = () =>
    startTransition(async () => {
      const r = await applyTicketBackfill();
      if (!r.ok) return void toast.error(r.message);
      toast.success(r.message);
      setResult(r.data ?? null);
      setSimulation(null);
    });

  const pendingCases = simulation ? Number(simulation.cases_to_create ?? 0) : 0;
  const byStatus = (simulation?.by_status ?? {}) as Partial<Record<TicketStatus, number>>;

  return (
    <details className="rounded-xl border bg-card p-3 text-sm">
      <summary className="cursor-pointer font-medium">Migrar turnos existentes a casos (administración)</summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className="text-muted-foreground">
          Cada mención turnada se vuelve un caso con su dependencia principal, apoyos, estado, fechas y notas. Primero simula: no cambia nada.
          Se puede repetir sin duplicar.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={simulate} disabled={pending}>
            <FlaskConical aria-hidden /> {pending && !simulation ? "Simulando…" : "Simular"}
          </Button>
          {simulation && (
            <Button size="sm" onClick={apply} disabled={pending || pendingCases === 0}>
              <DatabaseZap aria-hidden /> {pending ? "Migrando…" : `Aplicar (${nf.format(pendingCases)} casos)`}
            </Button>
          )}
        </div>
        {simulation && (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3" aria-label="Simulación">
            <Item label="Turnos en total" value={num(simulation, "tickets_total")} />
            <Item label="Ya en casos" value={num(simulation, "tickets_in_cases")} />
            <Item label="Turnos por vincular" value={num(simulation, "tickets_to_link")} />
            <Item label="Casos por crear" value={num(simulation, "cases_to_create")} />
            <Item label="Ya migrados antes" value={num(simulation, "cases_already_backfilled")} />
            <Item label="Menciones con varias dependencias" value={num(simulation, "mentions_with_several_departments")} />
            <Item label="Menciones ya en un caso (se respetan)" value={num(simulation, "skipped_mentions_already_in_a_case")} />
            <Item label="Turnos que se quedan igual" value={num(simulation, "skipped_tickets")} />
            {Object.entries(byStatus).map(([status, n]) => (
              <Item key={status} label={`Casos de turnos «${TICKET_LABELS[status as TicketStatus] ?? status}»`} value={nf.format(Number(n))} />
            ))}
          </dl>
        )}
        {result && (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3" aria-label="Conciliación">
            <Item label="Casos creados" value={num(result, "cases_created")} />
            <Item label="Turnos vinculados" value={num(result, "tickets_linked")} />
            <Item label="Turnos antes / después" value={`${num(result, "tickets_before")} / ${num(result, "tickets_after")}`} />
            <Item label="Turnos en casos ahora" value={num(result, "tickets_in_cases_after")} />
          </dl>
        )}
      </div>
    </details>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
