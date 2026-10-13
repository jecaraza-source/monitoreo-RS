"use client";

import { useState, useTransition } from "react";
import { RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { resolveFailure } from "@/lib/sources/actions";
import type { FailureView } from "@/lib/sources/data";

const time = new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short" });

/** Mentions the classifier gave up on and sources that keep failing: retry or dismiss. */
export function FailuresQueue({ failures }: { failures: FailureView[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (failures.length === 0) return <p className="text-sm text-muted-foreground">Sin fallos pendientes de revisar.</p>;

  function act(id: string, action: "retry" | "dismiss") {
    setBusy(id);
    startTransition(async () => {
      const result = await resolveFailure({ failureId: id, action });
      setBusy(null);
      (result.ok ? toast.success : toast.error)(result.message);
    });
  }

  return (
    <ul className="flex flex-col divide-y">
      {failures.map((f) => (
        <li key={f.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">
              {f.kind === "classify" ? "Clasificación" : "Fuente"} · {f.attempts} {f.attempts === 1 ? "intento" : "intentos"} ·{" "}
              {time.format(new Date(f.lastFailedAt))}
            </span>
            <span className="line-clamp-2 text-sm">{f.what}</span>
            {f.error && <span className="text-xs text-negative">{f.error}</span>}
          </div>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => act(f.id, "retry")}>
              <RotateCcw aria-hidden /> Reintentar
            </Button>
            <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => act(f.id, "dismiss")}>
              <X aria-hidden /> Descartar
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
