"use client";

import { X } from "lucide-react";
import { useDashboardFrame } from "@/components/dashboard/dashboard-frame";
import { OptionSelect } from "@/components/inbox/option-select";
import { Button } from "@/components/ui/button";
import { CASE_STATUS_FILTER_LABELS } from "@/lib/map/cases";
import { PRIORITIES, PRIORITY_LABELS, SENTIMENTS } from "@/lib/inbox/model";
import { CASE_STATUS_FILTERS, mapHref, SENTIMENT_FILTER_LABELS, type Layer, type MapFilters as Filters } from "@/lib/map/model";
import { cn } from "@/lib/utils";

const LAYER_LABELS: Record<Layer, string> = { conversacion: "Conversación", casos: "Casos" };

/**
 * Layer and filters. Category and department apply to both layers;
 * sentiment only to the conversation; priority and state only to cases.
 * Each change asks the server again (authorized queries, RLS).
 */
export function MapFilters({
  filters,
  layers,
  topics,
  departments,
}: {
  filters: Filters;
  /** The layers this role may open (a department: only its cases). */
  layers: readonly Layer[];
  topics: string[];
  /** Empty when the department filter does not apply (a department's own scope). */
  departments: { id: string; name: string }[];
}) {
  const { navigate } = useDashboardFrame();
  const go = (changes: Parameters<typeof mapHref>[1]) => navigate(mapHref(new URLSearchParams(window.location.search), changes));
  const set = (key: "tema" | "dependencia" | "sentimiento" | "prioridad" | "estado") => (value: string | null) => go({ [key]: value });
  const cases = filters.capa === "casos";
  const active = Boolean(filters.tema || filters.dependencia || filters.sentimiento || filters.prioridad || filters.estado !== "open");
  // A category picked earlier stays selectable even if this period has none.
  const topicOptions = [...new Set([...(filters.tema ? [filters.tema] : []), ...topics])].sort((a, b) => a.localeCompare(b, "es"));

  return (
    <div className="flex flex-wrap items-center gap-2">
      {layers.length > 1 && (
        <div role="radiogroup" aria-label="Capa" className="flex rounded-lg border bg-card p-0.5">
          {layers.map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={filters.capa === l}
              // Each layer has its own metrics and selection.
              onClick={() => go({ capa: l, metrica: null, colonia: null, sentimiento: null, prioridad: null, estado: null })}
              className={cn(
                "rounded-md px-2.5 py-1 text-sm transition-colors",
                filters.capa === l ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {LAYER_LABELS[l]}
            </button>
          ))}
        </div>
      )}
      <OptionSelect
        label="Categoría"
        value={filters.tema}
        onChange={set("tema")}
        emptyLabel="Todas las categorías"
        options={topicOptions.map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))}
        className="w-44"
      />
      {departments.length > 0 && (
        <OptionSelect
          label="Dependencia"
          value={filters.dependencia}
          onChange={set("dependencia")}
          emptyLabel="Todas las dependencias"
          options={departments.map((d) => ({ value: d.id, label: d.name }))}
          className="w-48"
        />
      )}
      {cases ? (
        <>
          <OptionSelect
            label="Prioridad"
            value={filters.prioridad}
            onChange={set("prioridad")}
            emptyLabel="Toda prioridad"
            options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))}
            className="w-36"
          />
          <OptionSelect
            label="Estado"
            value={filters.estado}
            onChange={(v) => go({ estado: v ?? "open" })}
            options={CASE_STATUS_FILTERS.map((s) => ({ value: s, label: CASE_STATUS_FILTER_LABELS[s] }))}
            className="w-44"
          />
        </>
      ) : (
        <OptionSelect
          label="Sentimiento"
          value={filters.sentimiento}
          onChange={set("sentimiento")}
          emptyLabel="Todo sentimiento"
          options={SENTIMENTS.map((s) => ({ value: s, label: SENTIMENT_FILTER_LABELS[s] }))}
          className="w-40"
        />
      )}
      {active && (
        <Button variant="ghost" size="sm" onClick={() => go({ tema: null, dependencia: null, sentimiento: null, prioridad: null, estado: null })}>
          <X aria-hidden /> Limpiar
        </Button>
      )}
    </div>
  );
}
