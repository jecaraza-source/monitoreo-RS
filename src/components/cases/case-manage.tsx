"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Merge, Pencil } from "lucide-react";
import { toast } from "sonner";
import { OptionSelect } from "@/components/inbox/option-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { mergeCases, updateCase } from "@/lib/cases/actions";
import { PRIORITIES, PRIORITY_LABELS, toLocalInput, type Priority } from "@/lib/inbox/model";

export type EditableCase = {
  id: string;
  title: string;
  description: string;
  category: string | null;
  neighborhood_id: string | null;
  priority: Priority;
  due_at: string | null;
  responsible_user_id: string | null;
};

/** Edit and merge (Comunicación and admin). */
export function CaseManage({
  current,
  neighborhoods,
  people,
  mergeCandidates,
  open,
}: {
  current: EditableCase;
  neighborhoods: { id: string; name: string }[];
  people: { user_id: string; name: string }[];
  mergeCandidates: { id: string; folio: string; title: string }[];
  /** Merged, closed or discarded cases are not edited. */
  open: boolean;
}) {
  const [dialog, setDialog] = useState<"edit" | "merge" | null>(null);
  return (
    <>
      <div className="flex gap-2">
        {open && (
          <Button size="sm" variant="outline" onClick={() => setDialog("edit")}>
            <Pencil aria-hidden /> Editar
          </Button>
        )}
        {open && mergeCandidates.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setDialog("merge")}>
            <Merge aria-hidden /> Fusionar
          </Button>
        )}
      </div>
      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          {dialog === "edit" && <EditForm current={current} neighborhoods={neighborhoods} people={people} onClose={() => setDialog(null)} />}
          {dialog === "merge" && <MergeForm targetId={current.id} candidates={mergeCandidates} onClose={() => setDialog(null)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function EditForm({
  current,
  neighborhoods,
  people,
  onClose,
}: {
  current: EditableCase;
  neighborhoods: { id: string; name: string }[];
  people: { user_id: string; name: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(current.title);
  const [description, setDescription] = useState(current.description);
  const [category, setCategory] = useState(current.category ?? "");
  const [neighborhoodId, setNeighborhoodId] = useState(current.neighborhood_id);
  const [priority, setPriority] = useState<Priority>(current.priority);
  const [due, setDue] = useState(current.due_at ? toLocalInput(new Date(current.due_at)) : "");
  const [responsible, setResponsible] = useState(current.responsible_user_id);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const dueAt = due ? new Date(due) : null;
    if (dueAt && Number.isNaN(dueAt.getTime())) return toast.error("Plazo inválido.");
    // Only what changed, so the history shows exactly that.
    const next = {
      title: title.trim(),
      description: description.trim(),
      category: category.trim() || null,
      neighborhood_id: neighborhoodId,
      priority,
      due_at: dueAt?.toISOString() ?? null,
      responsible_user_id: responsible,
    };
    const before: Record<string, unknown> = { ...current, due_at: current.due_at ? new Date(current.due_at).toISOString() : null };
    const fields = Object.fromEntries(Object.entries(next).filter(([k, v]) => v !== before[k]));
    if (!Object.keys(fields).length) return onClose();
    startTransition(async () => {
      const result = await updateCase({ caseId: current.id, fields });
      if (!result.ok) return void toast.error(result.message);
      toast.success(result.message);
      onClose();
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Editar caso</DialogTitle>
        <DialogDescription>Los cambios quedan en el historial.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="edit-title">Título</Label>
        <Input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} minLength={3} maxLength={200} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="edit-description">Descripción</Label>
        <Textarea id="edit-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} rows={3} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-category">Categoría</Label>
          <Input id="edit-category" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={80} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Colonia</Label>
          <OptionSelect
            label="Colonia"
            size="default"
            value={neighborhoodId}
            onChange={setNeighborhoodId}
            emptyLabel="Sin colonia"
            options={neighborhoods.map((n) => ({ value: n.id, label: n.name }))}
            className="w-full"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Prioridad operativa</Label>
          <OptionSelect
            label="Prioridad operativa"
            size="default"
            value={priority}
            onChange={(v) => v && setPriority(v as Priority)}
            options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))}
            className="w-full"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-due">Plazo</Label>
          <Input id="edit-due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
        </div>
      </div>
      {people.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label>Persona responsable (opcional)</Label>
          <OptionSelect
            label="Persona responsable"
            size="default"
            value={responsible}
            onChange={setResponsible}
            emptyLabel="Sin persona asignada"
            options={people.map((p) => ({ value: p.user_id, label: p.name }))}
            className="w-full"
          />
        </div>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending || title.trim().length < 3}>
          {pending ? "Guardando…" : "Guardar"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function MergeForm({ targetId, candidates, onClose }: { targetId: string; candidates: { id: string; folio: string; title: string }[]; onClose: () => void }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [filter, setFilter] = useState("");
  const [pending, startTransition] = useTransition();
  const shown = candidates.filter((c) => !filter || `${c.folio} ${c.title}`.toLowerCase().includes(filter.toLowerCase())).slice(0, 50);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await mergeCases({ targetId, sourceIds: selected, reason: reason.trim() });
      if (!result.ok) return void toast.error(result.message);
      toast.success(result.message);
      onClose();
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Fusionar casos en éste</DialogTitle>
        <DialogDescription>
          Sus menciones pasan a este caso y sus turnos se cierran. Conservan su folio y su historial, marcados como fusionados.
        </DialogDescription>
      </DialogHeader>
      <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Buscar folio o título" aria-label="Buscar caso" />
      <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto">
        {shown.map((c) => (
          <li key={c.id}>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(c.id)}
                onChange={(e) => setSelected(e.target.checked ? [...selected, c.id] : selected.filter((x) => x !== c.id))}
              />
              <span className="font-mono text-xs text-muted-foreground">{c.folio}</span>
              <span className="truncate">{c.title}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="merge-reason">Motivo</Label>
        <Textarea id="merge-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} required placeholder="Es la misma fuga reportada dos veces" />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending || !selected.length || reason.trim().length < 3}>
          {pending ? "Fusionando…" : selected.length > 1 ? `Fusionar ${selected.length} casos` : "Fusionar"}
        </Button>
      </DialogFooter>
    </form>
  );
}
