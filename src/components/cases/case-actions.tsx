"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EvidenceInput } from "@/components/cases/evidence-input";
import { OptionSelect } from "@/components/inbox/option-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { transitionCase } from "@/lib/cases/actions";
import { assignCase, reopenCase, validateCase } from "@/lib/cases/attention";
import { actionsFor, type CaseAction, type CaseActor, type CaseStatus } from "@/lib/cases/model";
import { defaultDueAt, formatHours, PRIORITY_LABELS, toLocalInput, type Priority, type SlaHours } from "@/lib/inbox/model";

const MAX_SUPPORT = 4;

type Person = { user_id: string; name: string; department_id: string };
/** What the validator needs to see before deciding (current cycle). */
export type ValidationContext = { updates: number; evidence: number; openTasks: number; cycle: number };

/** The buttons for the next steps of the case, by role; reasons, assignment, validation and reopening in a dialog. */
export function CaseActions({
  caseId,
  status,
  actor,
  isResponsibleDepartment,
  departments,
  departmentId,
  supportIds,
  responsibleUserId,
  people,
  priority,
  dueAt,
  acceptDueAt,
  commitment,
  sla,
  validation,
}: {
  caseId: string;
  status: CaseStatus;
  actor: CaseActor;
  isResponsibleDepartment: boolean;
  departments: { id: string; name: string }[];
  departmentId: string | null;
  supportIds: string[];
  responsibleUserId: string | null;
  people: Person[];
  priority: Priority;
  dueAt: string | null;
  acceptDueAt: string | null;
  commitment: string | null;
  sla: SlaHours;
  validation: ValidationContext;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<CaseAction | null>(null);
  const [pending, startTransition] = useTransition();
  const actions = actionsFor(status, actor, isResponsibleDepartment);
  if (!actions.length) return null;

  function run(action: CaseAction) {
    if (action.reason || action.assign || action.validate || action.reopen) return setOpen(action);
    startTransition(async () => {
      const result = await transitionCase({ caseId, to: action.to });
      if (!result.ok) return void toast.error(result.message);
      toast.success(result.message);
      router.refresh();
    });
  }

  const done = () => {
    setOpen(null);
    router.refresh();
  };
  const cancel = () => setOpen(null);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <Button
            key={`${a.to}-${a.onBehalf}`}
            size="sm"
            variant={a.primary ? "default" : a.to === "discarded" || a.to === "returned" || a.onBehalf ? "ghost" : "outline"}
            disabled={pending}
            onClick={() => run(a)}
          >
            {a.label}
          </Button>
        ))}
      </div>
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          {open?.assign && (
            <AssignForm
              caseId={caseId}
              action={open}
              departments={departments}
              departmentId={departmentId}
              supportIds={supportIds}
              responsibleUserId={responsibleUserId}
              people={people}
              priority={priority}
              dueAt={dueAt}
              acceptDueAt={acceptDueAt}
              commitment={commitment}
              sla={sla}
              onDone={done}
              onCancel={cancel}
            />
          )}
          {open?.validate && <ValidateForm caseId={caseId} context={validation} onDone={done} onCancel={cancel} />}
          {open?.reopen && <ReopenForm caseId={caseId} onDone={done} onCancel={cancel} />}
          {open && !open.assign && !open.validate && !open.reopen && (
            <TransitionForm key={`${open.to}-${open.onBehalf}`} caseId={caseId} action={open} onDone={done} onCancel={cancel} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function TransitionForm({ caseId, action, onDone, onCancel }: { caseId: string; action: CaseAction; onDone: () => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await transitionCase({ caseId, to: action.to, reason: reason.trim() });
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
          {action.onBehalf
            ? "Este paso le corresponde a la dependencia. Regístralo en su nombre sólo si lo confirmó por otro medio, y anota cómo."
            : action.to === "returned"
              ? "Explica por qué no le corresponde a tu dependencia; el caso vuelve a Comunicación para reasignarlo."
              : "Queda registrado en el historial del caso."}
        </DialogDescription>
      </DialogHeader>
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
        <Button type="submit" disabled={pending || (action.reason && reason.trim().length < 3)}>
          {pending ? "Guardando…" : action.label}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** A quarter of the time to the commitment, at least one hour, never after it. */
function defaultAcceptance(due: Date, now = new Date()): Date {
  const span = Math.max(due.getTime() - now.getTime(), 0);
  return new Date(Math.min(due.getTime(), now.getTime() + Math.max(span / 4, 3_600_000)));
}

function AssignForm({
  caseId,
  action,
  departments,
  departmentId,
  supportIds: initialSupport,
  responsibleUserId,
  people,
  priority,
  dueAt,
  acceptDueAt,
  commitment: initialCommitment,
  sla,
  onDone,
  onCancel,
}: {
  caseId: string;
  action: CaseAction;
  departments: { id: string; name: string }[];
  departmentId: string | null;
  supportIds: string[];
  responsibleUserId: string | null;
  people: Person[];
  priority: Priority;
  dueAt: string | null;
  acceptDueAt: string | null;
  commitment: string | null;
  sla: SlaHours;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [lead, setLead] = useState<string | null>(departmentId);
  const [support, setSupport] = useState<string[]>(initialSupport);
  const [responsible, setResponsible] = useState<string | null>(responsibleUserId);
  const [initial] = useState(() => {
    const now = new Date();
    const due = dueAt && new Date(dueAt).getTime() > now.getTime() ? new Date(dueAt) : defaultDueAt(priority, now, sla);
    const accept = acceptDueAt && new Date(acceptDueAt).getTime() > now.getTime() && new Date(acceptDueAt) <= due ? new Date(acceptDueAt) : defaultAcceptance(due, now);
    return { due: toLocalInput(due), accept: toLocalInput(accept), min: toLocalInput(now) };
  });
  const [due, setDue] = useState(initial.due);
  const [accept, setAccept] = useState(initial.accept);
  const [commitment, setCommitment] = useState(initialCommitment ?? "");
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const candidates = people.filter((p) => p.department_id === lead);

  function changeLead(next: string | null) {
    setLead(next);
    // The responsible person belongs to the lead department.
    if (!people.some((p) => p.user_id === responsible && p.department_id === next)) setResponsible(null);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!lead) return toast.error("Elige la dependencia responsable.");
    const dueDate = new Date(due);
    const acceptDate = new Date(accept);
    if (Number.isNaN(dueDate.getTime()) || Number.isNaN(acceptDate.getTime())) return toast.error("Revisa las fechas.");
    if (acceptDate > dueDate) return toast.error("El plazo de aceptación debe terminar antes del compromiso de atención.");
    startTransition(async () => {
      const result = await assignCase({
        caseId,
        departmentId: lead,
        supportIds: support.filter((d) => d !== lead),
        responsibleUserId: responsible,
        acceptDueAt: acceptDate.toISOString(),
        dueAt: dueDate.toISOString(),
        commitment: commitment.trim(),
        reason: reason.trim(),
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
          La dependencia responsable lo verá al instante y, si tiene WhatsApp, recibirá aviso. Plazo (SLA) para prioridad{" "}
          {PRIORITY_LABELS[priority].toLowerCase()}: {formatHours(sla[priority])}.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label>Dependencia responsable</Label>
        <OptionSelect
          label="Dependencia responsable"
          size="default"
          value={lead}
          onChange={changeLead}
          options={departments.map((d) => ({ value: d.id, label: d.name }))}
          className="w-full"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Persona responsable (opcional)</Label>
        <OptionSelect
          label="Persona responsable"
          size="default"
          value={responsible}
          onChange={setResponsible}
          emptyLabel={lead && !candidates.length ? "La dependencia no tiene usuarios" : "Sin persona"}
          disabled={!lead || !candidates.length}
          options={candidates.map((p) => ({ value: p.user_id, label: p.name }))}
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
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="case-accept-due">Plazo de aceptación</Label>
          <Input id="case-accept-due" type="datetime-local" value={accept} min={initial.min} max={due} onChange={(e) => setAccept(e.target.value)} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="case-due">Compromiso de atención</Label>
          <Input id="case-due" type="datetime-local" value={due} min={initial.min} onChange={(e) => setDue(e.target.value)} required />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="case-commitment">Qué se compromete a hacer (opcional)</Label>
        <Textarea id="case-commitment" value={commitment} onChange={(e) => setCommitment(e.target.value)} maxLength={1000} rows={2} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="case-transition-reason">Motivo (opcional)</Label>
        <Textarea id="case-transition-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending || !lead}>
          {pending ? "Guardando…" : action.label}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ValidateForm({ caseId, context, onDone, onCancel }: { caseId: string; context: ValidationContext; onDone: () => void; onCancel: () => void }) {
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");
  const [note, setNote] = useState("");
  const [sufficient, setSufficient] = useState(false);
  const [pending, startTransition] = useTransition();
  const blocked = decision === "approved" && (context.updates === 0 || context.openTasks > 0);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await validateCase(
        decision === "approved" ? { caseId, decision, note: note.trim(), evidenceSufficient: sufficient } : { caseId, decision, note: note.trim() },
      );
      if (!result.ok) return void toast.error(result.message);
      toast.success(result.message);
      onDone();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Validar la atención</DialogTitle>
        <DialogDescription>
          Ciclo {context.cycle}: {context.updates} {context.updates === 1 ? "avance" : "avances"} y {context.evidence}{" "}
          {context.evidence === 1 ? "archivo de evidencia" : "archivos de evidencia"}
          {context.openTasks > 0 ? ` · ${context.openTasks} ${context.openTasks === 1 ? "tarea abierta" : "tareas abiertas"}` : ""}. Revisa la evidencia antes de
          decidir.
        </DialogDescription>
      </DialogHeader>
      <div role="radiogroup" aria-label="Decisión" className="flex flex-col gap-2 text-sm">
        <label className="inline-flex items-center gap-2">
          <input type="radio" name="decision" checked={decision === "approved"} onChange={() => setDecision("approved")} />
          Cerrar: el problema quedó atendido
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="radio" name="decision" checked={decision === "rejected"} onChange={() => setDecision("rejected")} />
          Devolver a la dependencia: falta evidencia o trabajo
        </label>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="case-validation-note">{decision === "approved" ? "Resultado de la atención" : "Motivo de la devolución"}</Label>
        <Textarea id="case-validation-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={3} required minLength={3} />
      </div>
      {decision === "approved" && (
        <label className="inline-flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={sufficient} onChange={(e) => setSufficient(e.target.checked)} />
          Revisé la evidencia y es suficiente para cerrar.
        </label>
      )}
      {blocked && (
        <p className="text-sm text-negative">
          {context.updates === 0
            ? "No hay avances en este ciclo: pide evidencia o devuelve el caso."
            : "Hay tareas abiertas: deben terminarse o cancelarse antes de cerrar."}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending || note.trim().length < 3 || (decision === "approved" && (!sufficient || blocked))}>
          {pending ? "Guardando…" : decision === "approved" ? "Validar y cerrar" : "Devolver a atención"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ReopenForm({ caseId, onDone, onCancel }: { caseId: string; onDone: () => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const form = new FormData();
    form.set("caseId", caseId);
    form.set("reason", reason.trim());
    for (const f of files) form.append("files", f);
    startTransition(async () => {
      const result = await reopenCase(form);
      if (!result.ok) return void toast.error(result.message);
      toast.success(result.message);
      onDone();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Reabrir el caso</DialogTitle>
        <DialogDescription>
          Empieza un nuevo ciclo: el historial, las evidencias y las validaciones anteriores se conservan. El caso vuelve a revisión para asignarlo.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="case-reopen-reason">Por qué el problema persiste</Label>
        <Textarea id="case-reopen-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} rows={3} required minLength={3} />
      </div>
      <EvidenceInput id="case-reopen-files" files={files} onChange={setFiles} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending || reason.trim().length < 3}>
          {pending ? "Guardando…" : "Reabrir"}
        </Button>
      </DialogFooter>
    </form>
  );
}
