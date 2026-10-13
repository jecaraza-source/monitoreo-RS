"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatDateTime, fromNow } from "@/components/inbox/format";
import { OptionSelect } from "@/components/inbox/option-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addCaseTask, updateCaseTask } from "@/lib/cases/attention";
import type { CaseTask } from "@/lib/cases/data";
import { TASK_STATUS_LABELS, taskActions, taskOverdue, type TaskStatus } from "@/lib/cases/model";
import { toLocalInput } from "@/lib/inbox/model";
import { cn } from "@/lib/utils";

type Person = { user_id: string; name: string; department_id: string };

/**
 * Work of each area in the case. The lead area (primary responsible) and
 * coordination create, cancel and reopen tasks; each area works its own and
 * sees only its own (RLS).
 */
export function CaseTasks({
  caseId,
  tasks,
  areas,
  people,
  names,
  departments,
  manager,
  userDepartment,
  canAdd,
  active,
}: {
  caseId: string;
  tasks: CaseTask[];
  /** Departments that may get a task: the lead and the supporting ones. */
  areas: { id: string; name: string }[];
  people: Person[];
  names: Record<string, string>;
  departments: Map<string, string>;
  manager: boolean;
  userDepartment: string | null;
  canAdd: boolean;
  /** Tasks move only while the case is with the areas (assigned to pending validation). */
  active: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [noteFor, setNoteFor] = useState<{ task: CaseTask; to: TaskStatus; label: string } | null>(null);
  const [note, setNote] = useState("");

  function move(task: CaseTask, to: TaskStatus, withNote = "") {
    startTransition(async () => {
      const result = await updateCaseTask({ caseId, taskId: task.id, status: to, note: withNote });
      if (!result.ok) return void toast.error(result.message);
      toast.success(result.message);
      setNoteFor(null);
      setNote("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin tareas.</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Tareas del caso">
          {tasks.map((t) => {
            const worker = active && (manager || t.department_id === userDepartment);
            const overdue = taskOverdue(t);
            return (
              <li key={t.id} className={cn("rounded-lg border p-2.5 text-sm", t.status === "cancelled" && "opacity-60")}>
                <p className="flex items-start justify-between gap-2">
                  <span className="font-medium">{t.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{TASK_STATUS_LABELS[t.status]}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {departments.get(t.department_id)}
                  {t.responsible_user_id && names[t.responsible_user_id] ? ` · ${names[t.responsible_user_id]}` : ""}
                  {t.due_at && (
                    <span className={cn(overdue && "text-negative")} suppressHydrationWarning>
                      {" "}
                      · plazo {formatDateTime(t.due_at)} ({fromNow(t.due_at)})
                    </span>
                  )}
                </p>
                {t.detail && <p className="mt-1 text-xs whitespace-pre-wrap">{t.detail}</p>}
                {t.status_note && <p className="mt-1 text-xs text-muted-foreground">Nota: {t.status_note}</p>}
                {worker && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {taskActions(t.status, manager).map((a) => (
                      <Button
                        key={a.to}
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => (a.note ? setNoteFor({ task: t, to: a.to, label: a.label }) : move(t, a.to))}
                      >
                        {a.label}
                      </Button>
                    ))}
                  </div>
                )}
                {noteFor?.task.id === t.id && (
                  <form
                    className="mt-2 flex flex-col gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      move(t, noteFor.to, note.trim());
                    }}
                  >
                    <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} aria-label="Motivo" placeholder="Motivo…" />
                    <div className="flex justify-end gap-2">
                      <Button type="button" size="sm" variant="ghost" onClick={() => setNoteFor(null)}>
                        Cancelar
                      </Button>
                      <Button type="submit" size="sm" disabled={pending || note.trim().length < 3}>
                        {noteFor.label}
                      </Button>
                    </div>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canAdd && areas.length > 0 && <AddTask caseId={caseId} areas={areas} people={people} />}
    </div>
  );
}

function AddTask({ caseId, areas, people }: { caseId: string; areas: { id: string; name: string }[]; people: Person[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [department, setDepartment] = useState<string | null>(areas.length === 1 ? areas[0].id : null);
  const [responsible, setResponsible] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [due, setDue] = useState("");
  const [min] = useState(() => toLocalInput(new Date()));
  const [pending, startTransition] = useTransition();
  const candidates = people.filter((p) => p.department_id === department);

  if (!open) {
    return (
      <Button size="sm" variant="outline" className="w-fit" onClick={() => setOpen(true)}>
        Agregar tarea
      </Button>
    );
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!department) return toast.error("Elige el área.");
    startTransition(async () => {
      const result = await addCaseTask({
        caseId,
        departmentId: department,
        title: title.trim(),
        detail: detail.trim(),
        dueAt: due ? new Date(due).toISOString() : null,
        responsibleUserId: responsible,
      });
      if (!result.ok) return void toast.error(result.message);
      toast.success(result.message);
      setOpen(false);
      setTitle("");
      setDetail("");
      setDue("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-lg border p-3" aria-label="Nueva tarea">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="task-title">Tarea</Label>
        <Input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required minLength={3} />
      </div>
      <OptionSelect
        label="Área de la tarea"
        size="default"
        value={department}
        onChange={(d) => {
          setDepartment(d);
          setResponsible(null);
        }}
        options={areas.map((a) => ({ value: a.id, label: a.name }))}
        className="w-full"
      />
      <OptionSelect
        label="Responsable de la tarea"
        size="default"
        value={responsible}
        onChange={setResponsible}
        emptyLabel="Sin persona"
        disabled={!candidates.length}
        options={candidates.map((p) => ({ value: p.user_id, label: p.name }))}
        className="w-full"
      />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="task-due">Plazo (opcional)</Label>
        <Input id="task-due" type="datetime-local" value={due} min={min} onChange={(e) => setDue(e.target.value)} />
      </div>
      <Textarea value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={2000} rows={2} placeholder="Detalle (opcional)" aria-label="Detalle" />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" disabled={pending || title.trim().length < 3 || !department}>
          {pending ? "Guardando…" : "Agregar"}
        </Button>
      </div>
    </form>
  );
}
