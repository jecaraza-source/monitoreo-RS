"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveNotificationSettings } from "@/lib/sla/actions";
import type { NotificationSettings } from "@/lib/sla/data";

const FIELDS: { key: keyof NotificationSettings; label: string; hint: string; step?: number }[] = [
  { key: "reminder_percent", label: "Recordatorio al enlace (% del plazo)", hint: "Antes de vencer." },
  { key: "link_after_hours", label: "Escalar al enlace (h después de vencer)", hint: "0 = al vencer.", step: 0.5 },
  { key: "head_after_hours", label: "Escalar al titular (h después)", hint: "Horas del SLA.", step: 0.5 },
  { key: "coordinator_after_hours", label: "Escalar a coordinación (h después)", hint: "La persona que coordina el caso.", step: 0.5 },
  { key: "quiet_start", label: "Silencio desde (hora)", hint: "Avisos normales esperan; emergencias no." },
  { key: "quiet_end", label: "Silencio hasta (hora)", hint: "Igual a «desde» = sin silencio." },
  { key: "max_per_hour", label: "Máximo por persona y hora", hint: "El resto espera 15 min; emergencias no." },
];

export function EscalationForm({ settings }: { settings: NotificationSettings }) {
  const router = useRouter();
  const [values, setValues] = useState(settings);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveNotificationSettings(values);
      if (!result.ok) return void toast.error(result.message);
      toast.success(result.message);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-label="Escalamiento y avisos">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FIELDS.map((f) => (
          <div key={f.key} className="flex flex-col gap-1">
            <Label htmlFor={`esc-${f.key}`}>{f.label}</Label>
            <Input
              id={`esc-${f.key}`}
              type="number"
              step={f.step ?? 1}
              min={0}
              value={Number(values[f.key])}
              onChange={(e) => setValues({ ...values, [f.key]: Number(e.target.value) })}
              className="w-32"
            />
            <span className="text-xs text-muted-foreground">{f.hint}</span>
          </div>
        ))}
      </div>
      <label className="inline-flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={values.whatsapp_enabled} onChange={(e) => setValues({ ...values, whatsapp_enabled: e.target.checked })} />
        <span>
          Avisos de casos también por WhatsApp (requiere la plantilla <code>sigma_caso_aviso</code> aprobada por Meta). El correo se usa siempre que la
          persona no lo haya desactivado.
        </span>
      </label>
      <Button type="submit" className="w-fit" disabled={pending}>
        {pending ? "Guardando…" : "Guardar escalamiento"}
      </Button>
    </form>
  );
}
