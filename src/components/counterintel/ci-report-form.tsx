"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { OptionSelect } from "@/components/inbox/option-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createCiReport } from "@/lib/counterintel/actions";
import { CI_KINDS, CI_KIND_LABELS, CI_SEVERITIES, CI_SEVERITY_LABELS, type CiKind, type CiSeverity } from "@/lib/counterintel/model";

export function CiReportForm() {
  const router = useRouter();
  const [kind, setKind] = useState<CiKind | null>(null);
  const [severity, setSeverity] = useState<CiSeverity>("medium");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [indicators, setIndicators] = useState("");
  const [mentions, setMentions] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const form = new FormData();
    form.set("kind", kind ?? "");
    form.set("severity", severity);
    form.set("title", title);
    form.set("summary", summary);
    form.set("indicators", indicators);
    form.set("mentions", mentions);
    startTransition(async () => {
      const result = await createCiReport(form);
      if (!result.ok) return void toast.error(result.message);
      toast.success(result.message);
      setKind(null);
      setSeverity("medium");
      setTitle("");
      setSummary("");
      setIndicators("");
      setMentions("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-lg border border-border p-3 md:grid-cols-2" aria-label="Nuevo reporte">
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Tipo de reporte</span>
        <OptionSelect
          label="Tipo de reporte"
          value={kind}
          onChange={(v) => setKind((v as CiKind | null) ?? null)}
          emptyLabel="Elige el tipo"
          options={CI_KINDS.map((k) => ({ value: k, label: CI_KIND_LABELS[k] }))}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Gravedad</span>
        <OptionSelect
          label="Gravedad"
          value={severity}
          onChange={(v) => setSeverity((v as CiSeverity | null) ?? "medium")}
          options={CI_SEVERITIES.map((s) => ({ value: s, label: CI_SEVERITY_LABELS[s] }))}
        />
      </div>
      <div className="flex flex-col gap-1.5 md:col-span-2">
        <Label htmlFor="ci-title">Título</Label>
        <Input id="ci-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="Página falsa del ayuntamiento pide datos para un apoyo" />
      </div>
      <div className="flex flex-col gap-1.5 md:col-span-2">
        <Label htmlFor="ci-summary">Resumen</Label>
        <Textarea id="ci-summary" value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={4000} rows={3} placeholder="Qué se detectó, desde cuándo y qué se ha hecho." />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ci-indicators">Indicadores (uno por línea)</Label>
        <Textarea
          id="ci-indicators"
          value={indicators}
          onChange={(e) => setIndicators(e.target.value)}
          rows={3}
          placeholder={"@cuenta_que_suplanta\nhttps://dominio-falso.mx\n#etiqueta"}
        />
        <p className="text-xs text-muted-foreground">Cuentas que se hacen pasar por oficiales, dominios, enlaces o etiquetas. Nunca ciudadanos.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ci-mentions">Menciones de evidencia (opcional)</Label>
        <Textarea id="ci-mentions" value={mentions} onChange={(e) => setMentions(e.target.value)} rows={3} placeholder="Pega enlaces de la bandeja, uno por línea." />
      </div>
      <div className="md:col-span-2">
        <Button type="submit" size="sm" disabled={pending || !kind || title.trim().length < 3}>
          {pending ? "Guardando…" : "Registrar reporte"}
        </Button>
      </div>
    </form>
  );
}
