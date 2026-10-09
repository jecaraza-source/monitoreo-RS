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
import { DUE_HOURS, PRIORITY_LABELS, toLocalInput, type Priority } from "@/lib/inbox/model";
import { OptionSelect } from "./option-select";

export type RouteRequest = {
  ids: string[];
  /** Department suggested by the classifier when every mention agrees. */
  departmentId: string | null;
  /** Highest priority among the mentions, for the default due date. */
  priority: Priority | null;
};

export function RouteDialog({
  request,
  departments,
  onClose,
  onRouted,
}: {
  request: RouteRequest | null;
  departments: { id: string; name: string }[];
  onClose: () => void;
  onRouted: (ids: string[]) => void;
}) {
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {/* Keyed so each request starts from its own defaults. */}
        {request && (
          <RouteForm key={request.ids.join()} request={request} departments={departments} onClose={onClose} onRouted={onRouted} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RouteForm({
  request,
  departments,
  onClose,
  onRouted,
}: {
  request: RouteRequest;
  departments: { id: string; name: string }[];
  onClose: () => void;
  onRouted: (ids: string[]) => void;
}) {
  const priority = request.priority ?? "medium";
  const [departmentId, setDepartmentId] = useState<string | null>(request.departmentId);
  const [due, setDue] = useState(() => toLocalInput(new Date(Date.now() + DUE_HOURS[priority] * 3_600_000)));
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
          La dependencia la verá al instante en su bandeja. Plazo sugerido para prioridad {PRIORITY_LABELS[priority].toLowerCase()}:{" "}
          {DUE_HOURS[priority] < 48 ? `${DUE_HOURS[priority]} h` : `${DUE_HOURS[priority] / 24} días`}.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label>Dependencia</Label>
        <OptionSelect
          label="Dependencia"
          size="default"
          value={departmentId}
          onChange={setDepartmentId}
          options={departments.map((d) => ({ value: d.id, label: d.name }))}
          className="w-full"
        />
      </div>
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
