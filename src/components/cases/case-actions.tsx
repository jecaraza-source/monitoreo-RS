"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { OptionSelect } from "@/components/inbox/option-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { transitionCase } from "@/lib/cases/actions";
import { actionsFor, type CaseAction, type CaseActor, type CaseStatus } from "@/lib/cases/model";
import { defaultDueAt, formatHours, PRIORITY_LABELS, toLocalInput, type Priority, type SlaHours } from "@/lib/inbox/model";

const MAX_SUPPORT = 4;

/** The buttons for the next steps of the case, by role; reasons and assignment in a dialog. */
export function CaseActions({
  caseId,
  status,
  actor,
  isResponsibleDepartment,
  departments,
  departmentId,
  supportIds,
  priority,
  dueAt,
  sla,
}: {
  caseId: string;
  status: CaseStatus;
  actor: CaseActor;
  isResponsibleDepartment: boolean;
  departments: { id: string; name: string }[];
  departmentId: string | null;
  supportIds: string[];
  priority: Priority;
  dueAt: string | null;
  sla: SlaHours;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<CaseAction | null>(null);
  const [pending, startTransition] = useTransition();
  const actions = actionsFor(status, actor, isResponsibleDepartment);
  if (!actions.length) return null;

  function run(action: CaseAction) {
    if (action.reason || action.assign) return setOpen(action);
    startTransition(async () => {
      const result = await transitionCase({ caseId, to: action.to });
      if (!result.ok) return void toast.error(result.message);
      toast.success(result.message);
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <Button key={a.to} size="sm" variant={a.primary ? "default" : a.to === "discarded" || a.to === "returned" ? "ghost" : "outline"} disabled={pending} onClick={() => run(a)}>
            {a.label}
          </Button>
        ))}
      </div>
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent>
          {open && (
            <TransitionForm
              key={open.to}
              caseId={caseId}
              action={open}
              departments={departments}
              departmentId={departmentId}
              supportIds={supportIds}
              priority={priority}
              dueAt={dueAt}
              sla={sla}
              onDone={() => {
                setOpen(null);
                router.refresh();
              }}
              onCancel={() => setOpen(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function TransitionForm({
  caseId,
  action,
  departments,
  departmentId,
  supportIds: initialSupport,
  priority,
  dueAt,
  sla,
  onDone,
  onCancel,
}: {
  caseId: string;
  action: CaseAction;
  departments: { id: string; name: string }[];
  departmentId: string | null;
  supportIds: string[];
  priority: Priority;
  dueAt: string | null;
  sla: SlaHours;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [lead, setLead] = useState<string | null>(departmentId);
  const [support, setSupport] = useState<string[]>(initialSupport);
  const [due, setDue] = useState(() =>
    toLocalInput(dueAt && new Date(dueAt).getTime() > Date.now() ? new Date(dueAt) : defaultDueAt(priority, new Date(), sla)),
  );
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (action.assign && !lead) return toast.error("Elige la dependencia responsable.");
    const dueDate = new Date(due);
    if (action.assign && Number.isNaN(dueDate.getTime())) return toast.error("Plazo inválido.");
    startTransition(async () => {
      const result = await transitionCase({
        caseId,
        to: action.to,
        reason: reason.trim(),
        ...(action.assign ? { departmentId: lead, supportIds: support.filter((d) => d !== lead), dueAt: dueDate.toISOString() } : {}),
      });
      if (!result.ok) return void toast.error(result.message);
      toast.success(result.message);
      onDone();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{action.label}</DialogTitle>
        <DialogDescription>
          {action.assign
            ? `La dependencia responsable lo verá al instante y, si tiene WhatsApp, recibirá aviso. Plazo (SLA) para prioridad ${PRIORITY_LABELS[priority].toLowerCase()}: ${formatHours(sla[priority])}.`
            : action.to === "returned"
              ? "Explica por qué no le corresponde a tu dependencia; Comunicación lo reasignará."
              : "Queda registrado en el historial del caso."}
        </DialogDescription>
      </DialogHeader>
      {action.assign && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label>Dependencia responsable</Label>
            <OptionSelect
              label="Dependencia responsable"
              size="default"
              value={lead}
              onChange={setLead}
              options={departments.map((d) => ({ value: d.id, label: d.name }))}
              className="w-full"
            />
          </div>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-sm font-medium">Dependencias de apoyo (opcional)</legend>
            <ul className="grid gap-1 sm:grid-cols-2">
              {departments
                .filter((d) => d.id !== lead)
                .map((d) => (
                  <li key={d.id}>
                    <label className="inline-flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={support.includes(d.id)}
                        disabled={!support.includes(d.id) && support.filter((x) => x !== lead).length >= MAX_SUPPORT}
                        onChange={(e) => setSupport(e.target.checked ? [...support, d.id] : support.filter((x) => x !== d.id))}
                      />
                      {d.name}
                    </label>
                  </li>
                ))}
            </ul>
          </fieldset>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="case-due">Plazo</Label>
            <Input id="case-due" type="datetime-local" value={due} min={toLocalInput(new Date())} onChange={(e) => setDue(e.target.value)} required />
          </div>
        </>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="case-transition-reason">{action.reason ? "Motivo" : "Motivo (opcional)"}</Label>
        <Textarea
          id="case-transition-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          rows={3}
          required={action.reason}
          minLength={action.reason ? 3 : undefined}
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending || (action.assign && !lead) || (action.reason && reason.trim().length < 3)}>
          {pending ? "Guardando…" : action.label}
        </Button>
      </DialogFooter>
    </form>
  );
}
