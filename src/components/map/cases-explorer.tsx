"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MapPin, X } from "lucide-react";
import { useDashboardFrame } from "@/components/dashboard/dashboard-frame";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Reveal } from "@/components/ui-kit";
import { CASE_STATUS_LABELS } from "@/lib/cases/model";
import { inboxHref } from "@/lib/dashboard/model";
import { PRIORITIES, PRIORITY_LABELS } from "@/lib/inbox/model";
import { CASE_METRICS, CASE_STATUS_FILTER_LABELS, casesHref, type CaseColoniaRow, type CasePoint } from "@/lib/map/cases";
import { CASE_METRIC_KEYS, mapHref, type CaseMetricKey, type MapFilters } from "@/lib/map/model";
import { cn } from "@/lib/utils";
import type { ColoniaFeature, ColorScale, MapPoint } from "./colonias-map";

// MapLibre loads in its own chunk, only when this layer is open.
const ColoniasMap = dynamic(() => import("./colonias-map").then((m) => m.ColoniasMap), {
  ssr: false,
  loading: () => <Skeleton className="size-full" />,
});

const integer = new Intl.NumberFormat("es-MX");

export function CasesExplorer({
  shapes,
  rows,
  points,
  selectedId,
  filters,
  period,
  totals,
}: {
  shapes: { id: string; geometry: ColoniaFeature["geometry"] }[];
  rows: CaseColoniaRow[];
  points: CasePoint[];
  selectedId: string | null;
  filters: MapFilters;
  period: { fromDay: string; toDay: string };
  totals: { total: number; located: number; unlocated: number; undrawn: number };
}) {
  const router = useRouter();
  const { navigate } = useDashboardFrame();
  const [metric, setMetric] = useState<CaseMetricKey>(() => (CASE_METRIC_KEYS.includes(filters.metrica as CaseMetricKey) ? (filters.metrica as CaseMetricKey) : "casos"));
  const def = CASE_METRICS[metric];
  const max = Math.max(1, ...rows.map(def.value));
  const scale: ColorScale = useMemo(() => ({ kind: "sequential", max }), [max]);
  const features: ColoniaFeature[] = useMemo(() => {
    const byId = new Map(rows.map((r) => [r.id, r]));
    return shapes.flatMap((s) => {
      const r = byId.get(s.id);
      return r ? [{ id: r.id, name: r.name, approx: r.approx, geometry: s.geometry, value: def.value(r), label: def.unit(def.value(r)) }] : [];
    });
  }, [shapes, rows, def]);
  // The folio and the state only: no title, text or address on the map.
  const mapPoints: MapPoint[] = useMemo(
    () => points.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, label: `${p.folio} · ${PRIORITY_LABELS[p.priority]} · ${CASE_STATUS_LABELS[p.status]}` })),
    [points],
  );
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  function chooseMetric(next: CaseMetricKey) {
    setMetric(next);
    window.history.replaceState(null, "", mapHref(new URLSearchParams(window.location.search), { metrica: next === "casos" ? null : next }));
  }
  const select = (id: string | null) => navigate(mapHref(new URLSearchParams(window.location.search), { colonia: id }));
  const status = CASE_STATUS_FILTER_LABELS[filters.estado].toLowerCase();

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <Reveal className="lg:sticky lg:top-4 lg:col-span-8 lg:self-start">
        <Card>
          <CardHeader className="gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div role="radiogroup" aria-label="Colorear por" className="flex rounded-lg border bg-card p-0.5">
                {CASE_METRIC_KEYS.map((key) => (
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
                    {CASE_METRICS[key].label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-label={`Escala de 0 a ${max} ${metric === "casos" ? "casos" : "casos vencidos"} por colonia`}>
                <span>0</span>
                <span
                  aria-hidden
                  className="h-2 w-24 rounded-full"
                  style={{ background: "linear-gradient(to right, color-mix(in oklch, var(--negative) 8%, transparent), color-mix(in oklch, var(--negative) 72%, transparent))" }}
                />
                <span>{integer.format(max)}</span>
              </div>
            </div>
            <CardDescription>
              Unidad: {metric === "casos" ? `casos ${status}` : `casos ${status} con el plazo vencido`} por colonia, abiertos entre {period.fromDay} y {period.toDay}.
              Denominador: {integer.format(totals.located)} de {integer.format(totals.total)} casos tienen colonia
              {totals.unlocated > 0 && ` (${integer.format(totals.unlocated)} sin ubicación, listados abajo)`}. Los puntos son ubicaciones confirmadas por un
              analista, redondeadas a ~100 m; las inferidas cuentan en su colonia sin punto.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative h-[min(68vh,640px)] min-h-80 overflow-hidden rounded-lg">
              {shapes.length ? (
                <ColoniasMap
                  features={features}
                  scale={scale}
                  selectedId={selectedId}
                  onSelect={(id) => select(id)}
                  points={mapPoints}
                  onSelectPoint={(id) => router.push(`/casos/${id}`)}
                  label="Mapa de casos por colonia"
                />
              ) : (
                <p className="flex size-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                  Ninguna colonia tiene un polígono válido para dibujarla. La tabla de abajo tiene los casos por colonia.
                </p>
              )}
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin aria-hidden className="size-3.5" /> {integer.format(points.length)} ubicaciones confirmadas con punto
              {totals.undrawn > 0 && ` · ${integer.format(totals.undrawn)} casos en colonias sin polígono (en la tabla, no en el mapa)`}
            </p>
          </CardContent>
        </Card>
      </Reveal>

      <div className="flex flex-col gap-4 lg:col-span-4">
        {selected ? (
          <Card aria-labelledby="case-colonia-title">
            <CardHeader className="flex flex-row items-start justify-between gap-2">
              <div className="flex flex-col gap-1">
                <CardTitle as="h2" id="case-colonia-title">
                  {selected.name}
                </CardTitle>
                <CardDescription>
                  {selected.problem ?? (selected.approx ? "Zona aproximada" : "Colonia trazada")} · casos {status}
                </CardDescription>
              </div>
              <button type="button" onClick={() => select(null)} className="rounded p-1 text-muted-foreground hover:text-foreground" aria-label="Cerrar detalle">
                <X className="size-4" aria-hidden />
              </button>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {selected.total === 0 ? (
                <p className="text-muted-foreground">Sin casos con estos filtros en el periodo: la colonia está en cero, no le faltan datos.</p>
              ) : (
                <>
                  <dl className="grid grid-cols-3 gap-2 text-center">
                    <Stat label="Casos" value={selected.total} />
                    <Stat label="Vencidos" value={selected.overdue} />
                    <Stat label="Confirmados" value={selected.confirmed} />
                  </dl>
                  <p className="text-xs text-muted-foreground">
                    {selected.inferred} con ubicación inferida (no exacta). Prioridad:{" "}
                    {PRIORITIES.filter((p) => selected.byPriority[p]).map((p) => `${PRIORITY_LABELS[p].toLowerCase()} ${selected.byPriority[p]}`).join(", ")}.
                  </p>
                </>
              )}
              <div className="flex flex-wrap gap-2">
                <Link href={casesHref(filters, period, selected.id)} className={buttonVariants({ size: "sm" })}>
                  Ver {selected.total === 1 ? "el caso" : `los ${integer.format(selected.total)} casos`}
                </Link>
                <Link href={inboxHref(period, { neighborhood: selected.id })} className={buttonVariants({ size: "sm", variant: "outline" })}>
                  Menciones en la bandeja
                </Link>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle as="h2">Detalle por colonia</CardTitle>
              <CardDescription>Elige una colonia en el mapa o en la tabla para ver sus casos y abrirlos en Casos con los mismos filtros.</CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-muted/50 p-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{integer.format(value)}</dd>
    </div>
  );
}
