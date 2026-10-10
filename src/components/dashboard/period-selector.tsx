"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PERIOD_KEYS, PERIOD_LABELS, periodSearch, type PeriodKey } from "@/lib/dashboard/period";
import { cn } from "@/lib/utils";
import { useDashboardFrame } from "./dashboard-frame";

/** basePath: the page whose URL changes (other params, like map filters, are kept). */
export function PeriodSelector({ basePath = "/dashboard" }: { basePath?: string }) {
  const params = useSearchParams();
  const { navigate } = useDashboardFrame();
  const raw = params.get("periodo");
  const current: PeriodKey = PERIOD_KEYS.includes(raw as PeriodKey) ? (raw as PeriodKey) : "7d";
  const [custom, setCustom] = useState(current === "custom");
  const [desde, setDesde] = useState(params.get("desde") ?? "");
  const [hasta, setHasta] = useState(params.get("hasta") ?? "");

  const go = (key: PeriodKey, from?: string, to?: string) => {
    const next = new URLSearchParams(periodSearch(key, from, to));
    params.forEach((value, name) => {
      if (!["periodo", "desde", "hasta"].includes(name)) next.set(name, value);
    });
    navigate(`${basePath}?${next}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="radiogroup" aria-label="Periodo" className="flex rounded-lg border bg-card p-0.5">
        {PERIOD_KEYS.map((key) => {
          const selected = key === "custom" ? custom : !custom && current === key;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                if (key === "custom") return setCustom(true);
                setCustom(false);
                go(key);
              }}
              className={cn(
                "rounded-md px-2.5 py-1 text-sm transition-colors",
                selected ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {key === "custom" ? <CalendarRange aria-label={PERIOD_LABELS.custom} className="size-4" /> : PERIOD_LABELS[key]}
            </button>
          );
        })}
      </div>
      {custom && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (desde && hasta) go("custom", desde, hasta);
          }}
        >
          <Input type="date" aria-label="Desde" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} className="h-8 w-36" required />
          <Input type="date" aria-label="Hasta" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} className="h-8 w-36" required />
          <Button type="submit" size="sm">
            Aplicar
          </Button>
        </form>
      )}
    </div>
  );
}
