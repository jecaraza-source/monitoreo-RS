"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatHours, PRIORITIES, PRIORITY_LABELS, type SlaHours } from "@/lib/inbox/model";
import { saveSla } from "@/lib/whatsapp/actions";
import { useWhatsAppAction } from "./use-whatsapp-action";

export function SlaForm({ sla }: { sla: SlaHours }) {
  const { pending, run } = useWhatsAppAction();
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(PRIORITIES.map((p) => [p, String(sla[p])])),
  );
  const changed = PRIORITIES.some((p) => draft[p] !== String(sla[p]));

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveSla(draft));
      }}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {PRIORITIES.map((p) => {
          const hours = Number(draft[p]);
          return (
            <div key={p} className="flex flex-col gap-1.5">
              <Label htmlFor={`sla-${p}`}>Prioridad {PRIORITY_LABELS[p].toLowerCase()}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id={`sla-${p}`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={2160}
                  value={draft[p]}
                  onChange={(e) => setDraft({ ...draft, [p]: e.target.value })}
                  className="w-24"
                  required
                />
                <span className="text-sm text-muted-foreground">horas</span>
              </div>
              <p className="text-xs text-muted-foreground">{Number.isInteger(hours) && hours > 0 ? formatHours(hours) : "—"}</p>
            </div>
          );
        })}
      </div>
      <div>
        <Button type="submit" variant="outline" disabled={pending || !changed}>
          <Save aria-hidden /> {pending ? "Guardando…" : "Guardar SLA"}
        </Button>
      </div>
    </form>
  );
}
