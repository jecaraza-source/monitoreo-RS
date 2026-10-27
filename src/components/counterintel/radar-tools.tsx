"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { checkReportIndicators, findLookalikeDomains, saveRadarSettings, searchRadar, type RadarResult } from "@/lib/counterintel/radar-actions";

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<RadarResult>, after?: () => void) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) return void toast.error(result.message);
      toast.success(result.message);
      after?.();
      router.refresh();
    });
  return { pending, run };
}

export function RadarSettingsForm({ officialDomains, watchTerms }: { officialDomains: string[]; watchTerms: string[] }) {
  const { pending, run } = useRun();
  const [domains, setDomains] = useState(officialDomains.join("\n"));
  const [terms, setTerms] = useState(watchTerms.join("\n"));
  return (
    <form
      className="grid gap-3 md:grid-cols-2"
      aria-label="Ajustes del radar"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveRadarSettings({ officialDomains: domains, watchTerms: terms }));
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="radar-domains">Dominios oficiales (uno por línea)</Label>
        <Textarea id="radar-domains" rows={3} value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="alvarado.gob.mx" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="radar-terms">Términos a vigilar (uno por línea)</Label>
        <Textarea id="radar-terms" rows={3} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="alvarado" />
        <p className="text-xs text-muted-foreground">Palabras que usaría un dominio falso: el nombre del municipio, de un programa, etc.</p>
      </div>
      <div className="md:col-span-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Guardando…" : "Guardar ajustes"}
        </Button>
      </div>
    </form>
  );
}

export function CheckIndicatorsButton({ reportId }: { reportId: string }) {
  const { pending, run } = useRun();
  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => checkReportIndicators(reportId))}>
      {pending ? "Revisando…" : "Revisar indicadores"}
    </Button>
  );
}

export function LookalikeButton({ disabled }: { disabled: boolean }) {
  const { pending, run } = useRun();
  return (
    <Button size="sm" variant="outline" disabled={pending || disabled} onClick={() => run(() => findLookalikeDomains())}>
      {pending ? "Buscando…" : "Buscar dominios parecidos"}
    </Button>
  );
}

export function RadarSearchForm({ factCheckReady }: { factCheckReady: boolean }) {
  const { pending, run } = useRun();
  const [query, setQuery] = useState("");
  const search = (provider: "factcheck" | "gdelt") => run(() => searchRadar({ provider, query }));
  return (
    <form className="flex flex-col gap-2 sm:flex-row sm:items-end" aria-label="Buscar verificaciones y medios" onSubmit={(e) => e.preventDefault()}>
      <div className="flex flex-1 flex-col gap-1.5">
        <Label htmlFor="radar-query">Afirmación o tema</Label>
        <Input id="radar-query" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={200} placeholder="suspensión de agua Alvarado" />
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending || query.trim().length < 3 || !factCheckReady}
        title={factCheckReady ? undefined : "Falta GOOGLE_FACTCHECK_API_KEY en el servidor"}
        onClick={() => search("factcheck")}
      >
        Buscar verificaciones
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={pending || query.trim().length < 3} onClick={() => search("gdelt")}>
        Buscar en medios
      </Button>
    </form>
  );
}
