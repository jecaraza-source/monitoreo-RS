"use client";

import { X } from "lucide-react";
import { useDashboardFrame } from "@/components/dashboard/dashboard-frame";
import { OptionSelect } from "@/components/inbox/option-select";
import { Button } from "@/components/ui/button";
import { SENTIMENTS } from "@/lib/inbox/model";
import { mapHref, SENTIMENT_FILTER_LABELS, type MapFilters as Filters } from "@/lib/map/model";

/** Topic, department and sentiment filters; each change asks the server for new stats. */
export function MapFilters({
  filters,
  topics,
  departments,
}: {
  filters: Filters;
  topics: string[];
  departments: { id: string; name: string }[];
}) {
  const { navigate } = useDashboardFrame();
  const set = (key: "tema" | "dependencia" | "sentimiento") => (value: string | null) =>
    navigate(mapHref(new URLSearchParams(window.location.search), { [key]: value }));
  const active = Boolean(filters.tema || filters.dependencia || filters.sentimiento);
  // A topic picked earlier stays selectable even if this period has none.
  const topicOptions = [...new Set([...(filters.tema ? [filters.tema] : []), ...topics])].sort((a, b) => a.localeCompare(b, "es"));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <OptionSelect
        label="Tema"
        value={filters.tema}
        onChange={set("tema")}
        emptyLabel="Todos los temas"
        options={topicOptions.map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))}
        className="w-44"
      />
      <OptionSelect
        label="Dependencia"
        value={filters.dependencia}
        onChange={set("dependencia")}
        emptyLabel="Todas las dependencias"
        options={departments.map((d) => ({ value: d.id, label: d.name }))}
        className="w-48"
      />
      <OptionSelect
        label="Sentimiento"
        value={filters.sentimiento}
        onChange={set("sentimiento")}
        emptyLabel="Todo sentimiento"
        options={SENTIMENTS.map((s) => ({ value: s, label: SENTIMENT_FILTER_LABELS[s] }))}
        className="w-40"
      />
      {active && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(mapHref(new URLSearchParams(window.location.search), { tema: null, dependencia: null, sentimiento: null }))}
        >
          <X aria-hidden /> Limpiar
        </Button>
      )}
    </div>
  );
}
