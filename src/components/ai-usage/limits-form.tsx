"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveAiLimits } from "@/lib/ai-usage/actions";
import { PURPOSE_LABELS, PURPOSES, type Limits } from "@/lib/ai-usage/model";

const toText = (v: number | null) => (v === null ? "" : String(v));

export function LimitsForm({ limits, canEdit }: { limits: Limits; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState({
    daily_budget_usd: toText(limits.daily_budget_usd),
    monthly_budget_usd: toText(limits.monthly_budget_usd),
    daily_token_budget: toText(limits.daily_token_budget),
    user_daily_requests: String(limits.user_daily_requests),
    max_concurrent: Object.fromEntries(PURPOSES.map((p) => [p, String(limits.max_concurrent[p])])) as Record<(typeof PURPOSES)[number], string>,
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveAiLimits(values);
      if (!result.ok) return void toast.error(result.message);
      toast.success(result.message);
      router.refresh();
    });
  }

  const field = (key: "daily_budget_usd" | "monthly_budget_usd" | "daily_token_budget" | "user_daily_requests", label: string, hint: string, step = "1") => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`lim-${key}`}>{label}</Label>
      <Input
        id={`lim-${key}`}
        type="number"
        min={0}
        step={step}
        className="w-40"
        disabled={!canEdit}
        value={values[key]}
        placeholder="Sin límite"
        onChange={(e) => setValues({ ...values, [key]: e.target.value })}
      />
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  );

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-label="Límites de IA">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {field("daily_budget_usd", "Presupuesto diario (US$)", "Vacío = sin límite. Día de la Ciudad de México.", "0.01")}
        {field("monthly_budget_usd", "Presupuesto mensual (US$)", "Vacío = sin límite.", "0.01")}
        {field("daily_token_budget", "Tokens por día", "Respaldo para modelos sin tarifa.")}
        {field("user_daily_requests", "Solicitudes por persona al día", "Asistente y reportes.")}
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Llamadas simultáneas por uso</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PURPOSES.map((p) => (
            <div key={p} className="flex flex-col gap-1">
              <Label htmlFor={`conc-${p}`}>{PURPOSE_LABELS[p]}</Label>
              <Input
                id={`conc-${p}`}
                type="number"
                min={1}
                max={50}
                className="w-24"
                disabled={!canEdit}
                value={values.max_concurrent[p]}
                onChange={(e) => setValues({ ...values, max_concurrent: { ...values.max_concurrent, [p]: e.target.value } })}
              />
            </div>
          ))}
        </div>
      </fieldset>
      <p className="text-xs text-muted-foreground">
        Antes de cada llamada se reserva su costo máximo estimado; si excede un límite, la llamada no se hace y se explica el motivo. Con presupuesto en
        dólares y un modelo sin tarifa, la llamada sólo se autoriza si hay límite de tokens.
      </p>
      {canEdit && (
        <Button type="submit" className="w-fit" disabled={pending}>
          {pending ? "Guardando…" : "Guardar límites"}
        </Button>
      )}
    </form>
  );
}
