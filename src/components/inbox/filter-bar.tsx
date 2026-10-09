"use client";

import { useEffect, useState, type RefObject } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { InboxCatalogs } from "@/lib/inbox/data";
import {
  DEPARTMENT_STATUS_OPTIONS,
  EDITOR_STATUS_OPTIONS,
  PRIORITIES,
  PRIORITY_LABELS,
  SENTIMENTS,
  SENTIMENT_LABELS,
  SOURCE_LABELS,
  STATUS_OPTION_LABELS,
  type InboxFilters,
  type InboxScope,
} from "@/lib/inbox/model";
import { OptionSelect } from "./option-select";

export function FilterBar({
  scope,
  catalogs,
  filters,
  onChange,
  searchRef,
}: {
  scope: InboxScope;
  catalogs: InboxCatalogs;
  filters: InboxFilters;
  onChange: (filters: InboxFilters) => void;
  searchRef: RefObject<HTMLInputElement | null>;
}) {
  const [q, setQ] = useState(filters.q ?? "");

  // Search as you type, debounced.
  useEffect(() => {
    const value = q.trim();
    if (value === (filters.q ?? "")) return;
    const timer = setTimeout(() => onChange({ ...filters, q: value || undefined }), 350);
    return () => clearTimeout(timer);
  }, [q, filters, onChange]);

  const set = <K extends keyof InboxFilters>(key: K) => (value: string | null) =>
    onChange({ ...filters, [key]: value || undefined });

  const statusOptions = (scope === "editor" ? EDITOR_STATUS_OPTIONS : DEPARTMENT_STATUS_OPTIONS).map((value) => ({
    value,
    label: STATUS_OPTION_LABELS[value],
  }));
  const active = Object.values(filters).some(Boolean);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            ref={searchRef}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && e.currentTarget.blur()}
            placeholder='Buscar en el texto: fuga, "sin agua", -simulacro  ( / )'
            aria-label="Buscar menciones"
            className="pl-8"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Desde
          <Input
            type="date"
            value={filters.from ?? ""}
            max={filters.to}
            onChange={(e) => set("from")(e.target.value)}
            className="h-8 w-36"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Hasta
          <Input
            type="date"
            value={filters.to ?? ""}
            min={filters.from}
            onChange={(e) => set("to")(e.target.value)}
            className="h-8 w-36"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <OptionSelect
          label="Estado"
          value={filters.status}
          onChange={set("status")}
          emptyLabel={scope === "editor" ? "Por atender" : "Pendientes"}
          options={statusOptions}
          className="w-36"
        />
        <OptionSelect
          label="Fuente"
          value={filters.source}
          onChange={set("source")}
          emptyLabel="Todas las fuentes"
          options={catalogs.sources.map((s) => ({ value: s.id, label: `${SOURCE_LABELS[s.type]} · ${s.name}` }))}
          className="w-44"
        />
        <OptionSelect
          label="Sentimiento"
          value={filters.sentiment}
          onChange={set("sentiment")}
          emptyLabel="Todo sentimiento"
          options={SENTIMENTS.map((s) => ({ value: s, label: SENTIMENT_LABELS[s] }))}
          className="w-40"
        />
        <OptionSelect
          label="Prioridad"
          value={filters.priority}
          onChange={set("priority")}
          emptyLabel="Toda prioridad"
          options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))}
          className="w-36"
        />
        <OptionSelect
          label="Tema"
          value={filters.topic}
          onChange={set("topic")}
          emptyLabel="Todos los temas"
          options={catalogs.topics.map((t) => ({ value: t, label: t }))}
          className="w-44"
        />
        {scope === "editor" && (
          <OptionSelect
            label="Dependencia"
            value={filters.department}
            onChange={set("department")}
            emptyLabel="Toda dependencia"
            options={catalogs.departments.map((d) => ({ value: d.id, label: d.name }))}
            className="w-48"
          />
        )}
        <OptionSelect
          label="Colonia"
          value={filters.neighborhood}
          onChange={set("neighborhood")}
          emptyLabel="Todas las colonias"
          options={catalogs.neighborhoods.map((n) => ({ value: n.id, label: n.name }))}
          className="w-40"
        />
        {active && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ("");
              onChange({});
            }}
          >
            <X aria-hidden /> Limpiar
          </Button>
        )}
      </div>
    </div>
  );
}
