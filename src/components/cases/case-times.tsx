import { CheckCircle2, Undo2 } from "lucide-react";
import { formatDateTime } from "@/components/inbox/format";
import type { CaseCycle, CaseValidation } from "@/lib/cases/data";
import { formatDuration } from "@/lib/cases/model";

/**
 * Milestones of each cycle (a reopening starts a new one): when it was
 * assigned, accepted, attended, sent to validation and closed, with the
 * elapsed times. Earlier cycles are never overwritten.
 */
export function CaseTimes({ cycles, validations }: { cycles: CaseCycle[]; validations: CaseValidation[] }) {
  if (!cycles.length) return <p className="text-sm text-muted-foreground">Sin hitos registrados.</p>;
  return (
    <ol className="flex flex-col gap-4" aria-label="Tiempos por ciclo">
      {cycles.map((c) => {
        const own = validations.filter((v) => v.cycle === c.cycle);
        return (
          <li key={c.cycle} className="flex flex-col gap-2 text-sm">
            {cycles.length > 1 && <p className="text-xs font-medium text-muted-foreground uppercase">Ciclo {c.cycle}</p>}
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <Milestone label="Asignado" at={c.first_assigned_at} />
              <Milestone label="Aceptado" at={c.accepted_at} since={c.first_assigned_at} />
              <Milestone label="Atención iniciada" at={c.attention_started_at} since={c.accepted_at} />
              <Milestone label="Validación solicitada" at={c.validation_requested_at} since={c.attention_started_at ?? c.accepted_at} />
              <Milestone label="Cerrado" at={c.closed_at} since={c.started_at} total />
            </dl>
            {((c.returns ?? 0) > 0 || (c.validation_rejections ?? 0) > 0) && (
              <p className="text-xs text-muted-foreground">
                {(c.returns ?? 0) > 0 && `${c.returns} ${c.returns === 1 ? "devolución" : "devoluciones"} por competencia. `}
                {(c.validation_rejections ?? 0) > 0 &&
                  `${c.validation_rejections} ${c.validation_rejections === 1 ? "validación rechazada" : "validaciones rechazadas"}.`}
              </p>
            )}
            {own.length > 0 && (
              <ul className="flex flex-col gap-1.5" aria-label={`Validaciones del ciclo ${c.cycle}`}>
                {own.map((v) => (
                  <li key={v.id} className="rounded-lg bg-muted/50 p-2 text-xs">
                    <p className="flex items-center gap-1.5 font-medium">
                      {v.decision === "approved" ? (
                        <CheckCircle2 className="size-3.5 text-positive" aria-hidden />
                      ) : (
                        <Undo2 className="size-3.5 text-negative" aria-hidden />
                      )}
                      {v.decision === "approved" ? "Validado y cerrado" : "Devuelto a atención"} · {v.validator_name || "Usuario"}
                    </p>
                    <p className="text-muted-foreground">
                      {formatDateTime(v.at)} · {v.updates_count} {v.updates_count === 1 ? "avance" : "avances"}, {v.evidence_count}{" "}
                      {v.evidence_count === 1 ? "archivo" : "archivos"}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap">{v.note}</p>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Milestone({ label, at, since, total }: { label: string; at: string | null; since?: string | null; total?: boolean }) {
  if (!at) return null;
  const elapsed = since ? formatDuration(new Date(at).getTime() - new Date(since).getTime()) : null;
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>
        {formatDateTime(at)}
        {elapsed && <span className="text-xs text-muted-foreground"> · {total ? `ciclo de ${elapsed}` : `en ${elapsed}`}</span>}
      </dd>
    </>
  );
}
