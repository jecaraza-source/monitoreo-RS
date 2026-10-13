"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
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
        options={neighborhoods.map((n) => ({ value: n.id, label: n.name }))}
      />
      <OptionSelect
        label="Prioridad"
        value={params.get("prioridad")}
        onChange={(v) => set("prioridad", v)}
        emptyLabel="Toda prioridad"
        options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))}
      />
    </div>
  );
}
