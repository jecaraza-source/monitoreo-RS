"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { formatDateTime } from "@/components/inbox/format";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { addCaseNote } from "@/lib/cases/actions";
import type { CaseNote } from "@/lib/cases/data";

/** Notes: internal ones only for Comunicación (and read by Consulta); department ones shared with the assigned area. */
export function CaseNotes({ caseId, notes, canWrite, editor }: { caseId: string; notes: CaseNote[]; canWrite: boolean; editor: boolean }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<"internal" | "department">(editor ? "internal" : "department");
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await addCaseNote({ caseId, body, visibility });
      if (!result.ok) return void toast.error(result.message);
      setBody("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {canWrite && (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} rows={2} placeholder="Escribe una nota…" aria-label="Nota" />
          <div className="flex flex-wrap items-center gap-3">
            {editor && (
              <div role="radiogroup" aria-label="Quién la ve" className="flex gap-3 text-xs">
                <label className="inline-flex items-center gap-1.5">
                  <input type="radio" name="visibility" checked={visibility === "internal"} onChange={() => setVisibility("internal")} />
                  Interna (sólo Comunicación)
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input type="radio" name="visibility" checked={visibility === "department"} onChange={() => setVisibility("department")} />
                  Visible para la dependencia
                </label>
              </div>
            )}
            <Button type="submit" size="sm" className="ml-auto" disabled={pending || !body.trim()}>
              {pending ? "Guardando…" : "Agregar nota"}
            </Button>
          </div>
        </form>
      )}
      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin notas.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg bg-muted/50 p-3 text-sm">
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{n.author_name || "Usuario"}</span>
                <span>{formatDateTime(n.created_at)}</span>
                {n.visibility === "internal" && (
                  <span className="inline-flex items-center gap-1">
                    <Lock className="size-3" aria-hidden /> Interna
                  </span>
                )}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
