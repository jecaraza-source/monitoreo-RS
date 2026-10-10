"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Download } from "lucide-react";
import { useDashboardFrame } from "@/components/dashboard/dashboard-frame";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Reveal } from "@/components/ui-kit";
import { mapCsv, mapHref, METRIC_KEYS, METRICS, rankRows, scaleMax, type MapRow, type MetricKey } from "@/lib/map/model";
import { cn } from "@/lib/utils";
import type { ColoniaFeature, ColorScale } from "./colonias-map";

// MapLibre (~800 kB) loads in its own chunk.
const ColoniasMap = dynamic(() => import("./colonias-map").then((m) => m.ColoniasMap), {
  ssr: false,
  loading: () => <Skeleton className="size-full" />,
});

export type ColoniaShape = { id: string; geometry: ColoniaFeature["geometry"] };

const integer = new Intl.NumberFormat("es-MX");

export function MapExplorer({
  shapes,
  rows,
  selectedId,
  panel,
  unassigned,
  total,
  fileName,
}: {
  shapes: ColoniaShape[];
  rows: MapRow[];
  selectedId: string | null;
  /** Server-rendered panel of the selected colonia. */
  panel: React.ReactNode;
  unassigned: number;
  total: number;
  fileName: string;
}) {
  const params = useSearchParams();
  const { navigate } = useDashboardFrame();
  const [metric, setMetric] = useState<MetricKey>(() => {
    const raw = params.get("metrica");
    return METRIC_KEYS.includes(raw as MetricKey) ? (raw as MetricKey) : "quejas";
  });
  const def = METRICS[metric];

  const scale: ColorScale = useMemo(
    () => ({ kind: def.scale, max: scaleMax(rows, metric), positiveIsGood: def.positiveIsGood }),
    [rows, metric, def],
  );
  const features: ColoniaFeature[] = useMemo(() => {
    const byId = new Map(rows.map((r) => [r.id, r]));
    return shapes.flatMap((s) => {
      const r = byId.get(s.id);
      if (!r) return [];
      const value = def.value(r);
      return [{ id: r.id, name: r.name, approx: r.approx, geometry: s.geometry, value, label: value === null ? "Pocas menciones para calcularlo" : def.describe(value) }];
    });
  }, [shapes, rows, def]);
  const ranking = useMemo(() => rankRows(rows, metric), [rows, metric]);

  // The metric is a view choice: it changes the URL (shareable) without asking the server again.
  function chooseMetric(next: MetricKey) {
    setMetric(next);
    window.history.replaceState(null, "", mapHref(new URLSearchParams(window.location.search), { metrica: next }));
  }
  const select = (id: string | null) =>
    navigate(mapHref(new URLSearchParams(window.location.search), { colonia: id, metrica: metric }));

  function downloadCsv() {
    const url = URL.createObjectURL(new Blob([mapCsv(rows)], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: fileName });
    a.click();
    URL.revokeObjectURL(url);
  }

  const approxCount = rows.filter((r) => r.approx).length;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <Reveal className="lg:sticky lg:top-4 lg:col-span-8 lg:self-start">
        <Card>
          <CardHeader className="gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div role="radiogroup" aria-label="Colorear por" className="flex flex-wrap rounded-lg border bg-card p-0.5">
                {METRIC_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={metric === key}
                    onClick={() => chooseMetric(key)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-sm transition-colors",
                      metric === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {METRICS[key].label}
                  </button>
                ))}
              </div>
              <Legend scale={scale} metric={metric} />
            </div>
            <CardDescription>
              {def.help} Clic en una colonia para ver su detalle.
              {approxCount > 0 && " Las líneas punteadas son zonas aproximadas."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative h-[min(68vh,640px)] min-h-80 overflow-hidden rounded-lg">
              <ColoniasMap features={features} scale={scale} selectedId={selectedId} onSelect={(id) => select(id)} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {integer.format(total)} menciones en el periodo
              {unassigned > 0 && ` · ${integer.format(unassigned)} sin colonia identificada (no aparecen en el mapa)`}
            </p>
          </CardContent>
        </Card>
      </Reveal>

      <div className="flex flex-col gap-4 lg:col-span-4">
        {panel}
        <Reveal delay={0.06}>
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-2">
              <div className="flex flex-col gap-1">
                <CardTitle as="h2">Ranking por {def.label.toLowerCase()}</CardTitle>
                <CardDescription>{metric === "nss" ? "Peor sentimiento primero." : "Mayor primero."}</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={downloadCsv} disabled={!rows.length}>
                <Download aria-hidden /> CSV
              </Button>
            </CardHeader>
            <CardContent>
              {ranking.length ? (
                <ol className="flex max-h-[28rem] flex-col gap-0.5 overflow-y-auto">
                  {ranking.map((r, i) => {
                    const value = def.value(r)!;
                    const width = Math.min(Math.abs(value) / scale.max, 1) * 100;
                    return (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => select(r.id === selectedId ? null : r.id)}
                          aria-current={r.id === selectedId || undefined}
                          className="group flex w-full flex-col gap-1 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60 aria-[current]:bg-muted"
                        >
                          <span className="flex items-baseline gap-2">
                            <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                            <span className="flex-1 truncate">{r.name}</span>
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{def.describe(value)}</span>
                          </span>
                          <span aria-hidden className="ml-7 h-1 rounded-full bg-muted">
                            <span
                              className={cn("block h-1 rounded-full", barTone(metric, value))}
                              style={{ width: `${Math.max(width, 2)}%` }}
                            />
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">Sin menciones con colonia en este periodo.</p>
              )}
            </CardContent>
          </Card>
        </Reveal>
      </div>
    </div>
  );
}

function barTone(metric: MetricKey, value: number): string {
  if (metric === "nss") return value >= 0 ? "bg-positive" : "bg-negative";
  if (metric === "cambio") return value > 0 ? "bg-negative" : "bg-positive";
  return "bg-negative/80";
}

function Legend({ scale, metric }: { scale: ColorScale; metric: MetricKey }) {
  const max = integer.format(Math.round(scale.max));
  if (scale.kind === "sequential") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-label={`Escala de 0 a ${max}`}>
        <span>0</span>
        <span
          aria-hidden
          className="h-2 w-24 rounded-full"
          style={{ background: "linear-gradient(to right, color-mix(in oklch, var(--negative) 8%, transparent), color-mix(in oklch, var(--negative) 72%, transparent))" }}
        />
        <span>{metric === "negativo" ? "100 %" : max}</span>
      </div>
    );
  }
  const [left, right] = scale.positiveIsGood ? ["var(--negative)", "var(--positive)"] : ["var(--positive)", "var(--negative)"];
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-label={`Escala de −${max} a +${max}`}>
      <span>−{max}</span>
      <span
        aria-hidden
        className="h-2 w-24 rounded-full"
        style={{
          background: `linear-gradient(to right, color-mix(in oklch, ${left} 72%, transparent), color-mix(in oklch, var(--neutral) 15%, transparent), color-mix(in oklch, ${right} 72%, transparent))`,
        }}
      />
      <span>+{max}</span>
    </div>
  );
}
