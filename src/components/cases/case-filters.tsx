"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { OptionSelect } from "@/components/inbox/option-select";
import { Input } from "@/components/ui/input";
import { CASE_STATUSES, CASE_STATUS_LABELS } from "@/lib/cases/model";
import { PRIORITIES, PRIORITY_LABELS } from "@/lib/inbox/model";

/** Filters live in the URL: shareable and rendered on the server. */
export function CaseFilters({
  departments,
  neighborhoods,
  showDepartment,
}: {
  departments: { id: string; name: string }[];
  neighborhoods: { id: string; name: string }[];
  showDepartment: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [loading, startTransition] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");

  const from = params.get("desde");
  const to = params.get("hasta");
  const category = params.get("categoria");

  function clearMapFilters() {
    const next = new URLSearchParams(params);
    for (const key of ["desde", "hasta", "categoria", "pagina"]) next.delete(key);
    startTransition(() => router.replace(`${pathname}?${next}`, { scroll: false }));
  }

  function set(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("pagina");
    startTransition(() => router.replace(`${pathname}?${next}`, { scroll: false }));
  }

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={loading}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          set("q", q.trim() || null);
        }}
        className="relative"
      >
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Folio o título"
          aria-label="Buscar por folio o título"
          className="h-8 w-52 pl-8"
          maxLength={100}
        />
      </form>
      <OptionSelect
        label="Estado"
        value={params.get("estado") ?? "open"}
        onChange={(v) => set("estado", v === "open" ? null : v)}
        options={[
          { value: "open", label: "Abiertos" },
          { value: "all", label: "Todos" },
          ...CASE_STATUSES.map((s) => ({ value: s, label: CASE_STATUS_LABELS[s] })),
        ]}
      />
      {showDepartment && (
        <OptionSelect
          label="Dependencia"
          value={params.get("dependencia")}
          onChange={(v) => set("dependencia", v)}
          emptyLabel="Todas las dependencias"
          options={departments.map((d) => ({ value: d.id, label: d.name }))}
        />
      )}
      <OptionSelect
        label="Colonia"
        value={params.get("colonia")}
        onChange={(v) => set("colonia", v)}
        emptyLabel="Todas las colonias"
        options={[{ value: "sin", label: "Sin colonia" }, ...neighborhoods.map((n) => ({ value: n.id, label: n.name }))]}
      />
      <OptionSelect
        label="Prioridad"
        value={params.get("prioridad")}
        onChange={(v) => set("prioridad", v)}
        emptyLabel="Toda prioridad"
        options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))}
      />
      {(from || to || category) && (
        // Filters that come from the map (period of opening and category): shown so the count is explainable.
        <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground">
          {[from || to ? `Abiertos ${from ? `del ${from}` : ""} ${to ? `al ${to}` : ""}`.replace(/\s+/g, " ").trim() : null, category ? `Categoría: ${category}` : null]
            .filter(Boolean)
            .join(" · ")}
          <button type="button" onClick={clearMapFilters} className="rounded-full p-0.5 hover:text-foreground" aria-label="Quitar periodo y categoría">
            <X className="size-3" aria-hidden />
          </button>
        </span>
      )}
    </div>
  );
}
