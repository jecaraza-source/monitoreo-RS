"use client";

import { useState, useTransition } from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { routeMentions } from "@/lib/inbox/actions";
import { defaultDueAt, formatHours, PRIORITY_LABELS, toLocalInput, type Priority, type SlaHours } from "@/lib/inbox/model";
import { OptionSelect } from "./option-select";

/** Same limit as the server action. */
const MAX_SUPPORT = 4;

export type RouteRequest = {
  ids: string[];
  /** Department suggested by the classifier when every mention agrees (or the current leader). */
  departmentId: string | null;
  /** Departments a single mention is already routed to: they keep their tickets. */
  routed: string[];
  /** Highest priority among the mentions, for the default due date. */
  priority: Priority | null;
};

export function RouteDialog({
  request,
  departments,
  sla,
  onClose,
  onRouted,
}: {
  request: RouteRequest | null;
  departments: { id: string; name: string }[];
  sla: SlaHours;
  onClose: () => void;
  onRouted: (ids: string[]) => void;
}) {
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {/* Keyed so each request starts from its own defaults. */}
        {request && (
          <RouteForm key={request.ids.join()} request={request} departments={departments} sla={sla} onClose={onClose} onRouted={onRouted} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RouteForm({
  request,
  departments,
  sla,
  onClose,
  onRouted,
}: {
  request: RouteRequest;
  departments: { id: string; name: string }[];
  sla: SlaHours;
  onClose: () => void;
  onRouted: (ids: string[]) => void;
}) {
  const priority = request.priority ?? "medium";
  const [departmentId, setDepartmentId] = useState<string | null>(request.departmentId);
  const [supportIds, setSupportIds] = useState<string[]>([]);
  const [due, setDue] = useState(() => toLocalInput(defaultDueAt(priority, new Date(), sla)));
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const n = request.ids.length;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!departmentId) return toast.error("Elige la dependencia.");
    const dueAt = new Date(due);
    if (Number.isNaN(dueAt.getTime())) return toast.error("Fecha límite inválida.");
    startTransition(async () => {
      const result = await routeMentions({
        ids: request.ids,
        departmentId,
        supportIds: supportIds.filter((d) => d !== departmentId),
        dueAt: dueAt.toISOString(),
        note: note.trim() || undefined,
      });
      if (!result.ok) return void toast.error(result.message);
      toast.success(result.message);
      onRouted(request.ids);
      onClose();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{n === 1 ? "Turnar mención" : `Turnar ${n} menciones`}</DialogTitle>
        <DialogDescription>
          Cada dependencia la verá al instante en su bandeja y lleva su propio estado. Plazo (SLA) para prioridad {PRIORITY_LABELS[priority].toLowerCase()}:{" "}
          {formatHours(sla[priority])}.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label>Dependencia principal</Label>
        <OptionSelect
          label="Dependencia principal"
          size="default"
          value={departmentId}
          onChange={setDepartmentId}
          options={departments.map((d) => ({ value: d.id, label: d.name }))}
          className="w-full"
        />
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-sm font-medium">Dependencias de apoyo (opcional)</legend>
        <ul className="grid gap-1 sm:grid-cols-2">
          {departments
            .filter((d) => d.id !== departmentId)
            .map((d) => (
              <li key={d.id}>
                {request.routed.includes(d.id) ? (
                  <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                    <input type="checkbox" checked disabled aria-label={`${d.name} ya participa`} />
                    {d.name} (ya participa)
                  </span>
                ) : (
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={supportIds.includes(d.id)}
                      disabled={!supportIds.includes(d.id) && supportIds.filter((x) => x !== departmentId).length >= MAX_SUPPORT}
                      onChange={(e) => setSupportIds(e.target.checked ? [...supportIds, d.id] : supportIds.filter((x) => x !== d.id))}
                    />
                    {d.name}
                  </label>
                )}
              </li>
            ))}
        </ul>
        <span className="text-xs text-muted-foreground">
          Participan en la atención, por ejemplo Obras Públicas en una fuga de agua. La principal la encabeza.
        </span>
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="route-due">Fecha límite</Label>
        <Input
          id="route-due"
          type="datetime-local"
          value={due}
          min={toLocalInput(new Date())}
          onChange={(e) => setDue(e.target.value)}
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="route-note">Nota para la dependencia (opcional)</Label>
        <Textarea
          id="route-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={2000}
          rows={3}
          placeholder="Contexto, contacto del vecino si lo publicó, antecedentes…"
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending || !departmentId}>
          <Send aria-hidden /> {pending ? "Turnando…" : "Turnar"}
        </Button>
      </DialogFooter>
    </form>
  );
}
