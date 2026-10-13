"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { formatDateTime } from "@/components/inbox/format";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { approveSlaVersion } from "@/lib/sla/actions";
import type { SlaVersion } from "@/lib/sla/data";

/** Current version: a reference value until approved as the operational agreement. */
export function SlaVersionCard({ versions }: { versions: SlaVersion[] }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const current = versions[0];
  if (!current) return null;

  function approve(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await approveSlaVersion({ versionId: current.id, note });
      if (!result.ok) return void toast.error(result.message);
      toast.success(result.message);
      setNote("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {current.approved ? (
        <p className="flex items-start gap-2 text-sm">
          <BadgeCheck className="mt-0.5 size-4 shrink-0 text-positive" aria-hidden />
          <span>
            Versión {current.version} aprobada como acuerdo operativo el {formatDateTime(current.approved_at!)}
            {current.approval_note ? ` · ${current.approval_note}` : ""}.
          </span>
        </p>
      ) : (
        <>
          <p className="flex items-start gap-2 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
            <span>
              Versión {current.version}: <strong>valores de referencia, sin acuerdo aprobado</strong>. Los plazos se usan para ordenar y avisar, pero no son
              compromisos oficiales hasta que se aprueben.
            </span>
          </p>
          <form onSubmit={approve} className="flex flex-col gap-2">
            <Textarea
              aria-label="Acuerdo que respalda estos plazos"
              placeholder="Acuerdo que respalda estos plazos (oficio, acta, fecha)…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={500}
            />
            <Button type="submit" size="sm" className="w-fit" disabled={pending || note.trim().length < 3}>
              Aprobar versión {current.version}
            </Button>
          </form>
        </>
      )}
      {versions.length > 1 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Versiones anteriores</summary>
          <ul className="mt-1 flex flex-col gap-0.5">
            {versions.slice(1).map((v) => (
              <li key={v.id}>
                v{v.version} · {formatDateTime(v.created_at)} · {v.approved ? "aprobada" : "referencia"}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
