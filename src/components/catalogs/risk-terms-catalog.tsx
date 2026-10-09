"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { deleteRiskTerm, saveRiskTerm } from "@/lib/catalogs/actions";
import { cn } from "@/lib/utils";
import { useCatalogAction } from "./use-catalog-action";

type Severity = "low" | "medium" | "high" | "critical";
type RiskTerm = { id: string; term: string; severity: Severity };

const SEVERITY: Record<Severity, { label: string; className: string }> = {
  critical: { label: "Crítica", className: "bg-negative/15 text-negative" },
  high: { label: "Alta", className: "bg-negative/8 text-negative" },
  medium: { label: "Media", className: "bg-muted text-foreground" },
  low: { label: "Baja", className: "bg-muted text-muted-foreground" },
};
const ORDER: Severity[] = ["critical", "high", "medium", "low"];

export function RiskTermsCatalog({ terms }: { terms: RiskTerm[] }) {
  const { pending, run } = useCatalogAction();
  const [term, setTerm] = useState("");
  const [severity, setSeverity] = useState<Severity>("high");
  const sorted = [...terms].sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity) || a.term.localeCompare(b.term));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Temas que suben la prioridad de una mención (p. ej. <em>inundación</em>, <em>balacera</em>). No agregues
        nombres de personas: el sistema no perfila ciudadanos, periodistas ni opositores.
      </p>
      <ul className="flex flex-wrap gap-2">
        {sorted.map((t) => (
          <li key={t.id} className={cn("inline-flex items-center gap-1.5 rounded-full py-1 pr-1.5 pl-3 text-sm", SEVERITY[t.severity].className)}>
            {t.term}
            <span className="text-xs opacity-70">{SEVERITY[t.severity].label}</span>
            <button
              type="button"
              aria-label={`Eliminar ${t.term}`}
              disabled={pending}
              className="rounded-full p-0.5 opacity-70 hover:opacity-100"
              onClick={() => run(() => deleteRiskTerm(t.id))}
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveRiskTerm({ term, severity }), () => setTerm(""));
        }}
      >
        <Input
          aria-label="Nuevo término de riesgo"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Nuevo término"
          className="max-w-xs"
        />
        <Select value={severity} onValueChange={(v) => setSeverity(v as Severity)}>
          <SelectTrigger className="w-32" aria-label="Severidad">
            <SelectValue>{(v: Severity) => SEVERITY[v].label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {ORDER.map((s) => (
              <SelectItem key={s} value={s}>
                {SEVERITY[s].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" variant="outline" disabled={pending || term.trim().length < 3}>
          <Plus aria-hidden /> Agregar
        </Button>
      </form>
    </div>
  );
}
