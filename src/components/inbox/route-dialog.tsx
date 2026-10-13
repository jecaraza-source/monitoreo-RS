"use client";

import { useState, useTransition } from "react";
import { Send, Siren } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { routeMentions } from "@/lib/inbox/actions";
import { defaultDueAt, formatHours, INCIDENT_LABELS, PRIORITY_LABELS, toLocalInput, type Priority, type SlaHours } from "@/lib/inbox/model";
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
  /** Incident types of the mentions confirmed or classified as emergencies. */
  emergencies: string[];
};

export function RouteDialog({
  request,
  departments,
  sla,
  policies,
  onClose,
  onRouted,
}: {
  request: RouteRequest | null;
  departments: { id: string; name: string }[];
  sla: SlaHours;
  policies: { incident_type: string; channel: string; instructions: string }[];
  onClose: () => void;
  onRouted: (ids: string[]) => void;
}) {
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {/* Keyed so each request starts from its own defaults. */}
        {request && (
          <RouteForm
            key={request.ids.join()}
            request={request}
            departments={departments}
            sla={sla}
            policies={policies}
            onClose={onClose}
            onRouted={onRouted}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RouteForm({
  request,
  departments,
  sla,
  policies,
  onClose,
  onRouted,
}: {
  request: RouteRequest;
  departments: { id: string; name: string }[];
  sla: SlaHours;
  policies: { incident_type: string; channel: string; instructions: string }[];
  onClose: () => void;
  onRouted: (ids: string[]) => void;
}) {
  const priority = request.priority ?? "medium";
  const [departmentId, setDepartmentId] = useState<string | null>(request.departmentId);
  const [supportIds, setSupportIds] = useState<string[]>([]);
  const [due, setDue] = useState(() => toLocalInput(defaultDueAt(priority, new Date(), sla)));
  const [note, setNote] = useState("");
  const [ack, setAck] = useState(false);
  const emergency = request.emergencies.length > 0;
  const applicable = policies.filter((p) => request.emergencies.includes(p.incident_type));
  const [pending, startTransition] = useTransition();
  const n = request.ids.length;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!departmentId) return toast.error("Elige la dependencia.");
    if (emergency && !ack) return toast.error("Confirma que la emergencia se derivó al canal institucional.");
    const dueAt = new Date(due);
    if (Number.isNaN(dueAt.getTime())) return toast.error("Fecha límite inválida.");
    startTransition(async () => {
      const result = await routeMentions({
        ids: request.ids,
        departmentId,
        supportIds: supportIds.filter((d) => d !== departmentId),
        dueAt: dueAt.toISOString(),
        note: note.trim() || undefined,
        emergencyAck: ack,
      });
      if (!result.ok) return void toast.error(result.message);
      (result.failed?.length ? toast.warning : toast.success)(result.message);
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
      {emergency && (
        <section role="alert" aria-labelledby="emergency-title" className="flex flex-col gap-2 rounded-lg border border-negative/50 bg-negative/5 p-3 text-sm">
          <h3 id="emergency-title" className="flex items-center gap-1.5 font-semibold text-negative">
            <Siren className="size-4" aria-hidden /> Emergencia: primero el canal institucional
          </h3>
          {applicable.length ? (
            <ul className="flex flex-col gap-2">
              {applicable.map((p) => (
                <li key={p.incident_type}>
                  <p className="font-medium">
                    {INCIDENT_LABELS[p.incident_type] ?? p.incident_type} → {p.channel}
                  </p>
                  <p className="text-muted-foreground">{p.instructions}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">
              No hay una política definida para este tipo de incidente. Si hay riesgo para personas, repórtalo al 911. Un administrador puede definirla en
              Configuración → Emergencias.
            </p>
          )}
          <label className="inline-flex items-start gap-2">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1" />
            <span>Se derivó (o se derivará ahora) al canal indicado. El turno a la dependencia es seguimiento, no sustituye ese aviso.</span>
          </label>
        </section>
      )}
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
        <Button type="submit" disabled={pending || !departmentId || (emergency && !ack)}>
          <Send aria-hidden /> {pending ? "Turnando…" : "Turnar"}
        </Button>
      </DialogFooter>
    </form>
  );
}
