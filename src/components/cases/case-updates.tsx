"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Image as ImageIcon, Lock, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { EvidenceInput } from "@/components/cases/evidence-input";
import { formatDateTime } from "@/components/inbox/format";
import { OptionSelect } from "@/components/inbox/option-select";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { addCaseUpdate } from "@/lib/cases/attention";
import type { CaseTask, CaseUpdate } from "@/lib/cases/data";

/**
 * Progress of the attention, newest first, with its evidence. Files open
 * through /casos/<id>/evidencias/<file>, which checks permission and answers
 * with a link that expires in a minute.
 */
export function CaseUpdates({
  caseId,
  updates,
  tasks,
  canWrite,
  coordinator,
  departments,
}: {
  caseId: string;
  updates: CaseUpdate[];
  tasks: CaseTask[];
  canWrite: boolean;
  coordinator: boolean;
  departments: Map<string, string>;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<"areas" | "coordination">("areas");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [pending, startTransition] = useTransition();
  const openTasks = tasks.filter((t) => t.status === "pending" || t.status === "in_progress");
  const taskTitle = new Map(tasks.map((t) => [t.id, t.title]));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const form = new FormData();
    form.set("caseId", caseId);
    form.set("body", body.trim());
    form.set("audience", audience);
    if (taskId) form.set("taskId", taskId);
    for (const f of files) form.append("files", f);
    startTransition(async () => {
      const result = await addCaseUpdate(form);
      if (!result.ok) return void toast.error(result.message);
      toast.success(result.message);
      setBody("");
      setFiles([]);
      setTaskId(null);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {canWrite && (
        <form onSubmit={submit} className="flex flex-col gap-3" aria-label="Reportar avance">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={2000}
            rows={2}
            placeholder="Qué se hizo, cuándo y qué falta…"
            aria-label="Avance"
          />
          <EvidenceInput id="case-update-files" files={files} onChange={setFiles} />
          <div className="flex flex-wrap items-center gap-3">
            {openTasks.length > 0 && (
              <OptionSelect
                label="Tarea"
                value={taskId}
                onChange={setTaskId}
                emptyLabel="Sin tarea"
                options={openTasks.map((t) => ({ value: t.id, label: t.title }))}
                className="w-56"
              />
            )}
            <div role="radiogroup" aria-label="Quién lo ve" className="flex flex-wrap gap-3 text-xs">
              <label className="inline-flex items-center gap-1.5">
                <input type="radio" name="audience" checked={audience === "areas"} onChange={() => setAudience("areas")} />
                Todas las áreas del caso
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input type="radio" name="audience" checked={audience === "coordination"} onChange={() => setAudience("coordination")} />
                {coordinator ? "Sólo Comunicación" : "Sólo mi área y Comunicación"}
              </label>
            </div>
            <Button type="submit" size="sm" className="ml-auto" disabled={pending || body.trim().length < 3}>
              {pending ? "Guardando…" : "Reportar avance"}
            </Button>
          </div>
        </form>
      )}
      {updates.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin avances todavía.</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Avances del caso">
          {updates.map((u) => (
            <li key={u.id} className="rounded-lg bg-muted/50 p-3 text-sm">
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{u.author_name || "Usuario"}</span>
                {u.department_id && <span>{departments.get(u.department_id)}</span>}
                <span>{formatDateTime(u.created_at)}</span>
                <span>Ciclo {u.cycle}</span>
                {u.kind === "reopen" && (
                  <span className="inline-flex items-center gap-1 text-negative">
                    <RotateCcw className="size-3" aria-hidden /> El problema persiste
                  </span>
                )}
                {u.audience === "coordination" && (
                  <span className="inline-flex items-center gap-1">
                    <Lock className="size-3" aria-hidden /> Sólo coordinación
                  </span>
                )}
                {u.task_id && taskTitle.has(u.task_id) && <span>Tarea: {taskTitle.get(u.task_id)}</span>}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{u.body}</p>
              {u.evidence.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {u.evidence.map((e, i) => (
                    <li key={e.id}>
                      <a
                        href={`/casos/${caseId}/evidencias/${e.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs hover:bg-muted"
                      >
                        {e.mime === "application/pdf" ? <FileText className="size-3.5" aria-hidden /> : <ImageIcon className="size-3.5" aria-hidden />}
                        Evidencia {i + 1}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
