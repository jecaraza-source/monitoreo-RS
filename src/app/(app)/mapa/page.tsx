import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Map } from "lucide-react";
import { NavigationFrame } from "@/components/dashboard/dashboard-frame";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import { PageHeader } from "@/components/layout/page-header";
import { CasesExplorer } from "@/components/map/cases-explorer";
import { MapExplorer } from "@/components/map/map-explorer";
import { MapFilters } from "@/components/map/map-filters";
import { CasesTable, ConversationTable, UnlocatedCasesList, UnlocatedMentionsList } from "@/components/map/map-tables";
import { NeighborhoodPanel } from "@/components/map/neighborhood-panel";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui-kit";
import { canAccessPath } from "@/lib/auth/roles";
import { requireSection, type Member } from "@/lib/auth/session";
import { parsePeriod, type Period } from "@/lib/dashboard/period";
import { getCaseLayer, getColonias, getConversationLayer, getDepartments, getNeighborhoodDetail, type Colonia } from "@/lib/map/data";
import { mapHref, mapLayers, parseMapFilters, type MapFilters as Filters } from "@/lib/map/model";

export const metadata: Metadata = { title: "Mapa" };

export default function MapaPage({ searchParams }: PageProps<"/mapa">) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Mapa" description="Conversación por colonia y casos operativos, con los mismos filtros que la bandeja y Casos." />
      <Suspense fallback={<MapSkeleton />}>
        <MapContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function MapContent({ searchParams }: { searchParams: PageProps<"/mapa">["searchParams"] }) {
  const member = await requireSection("/mapa");
  const params = await searchParams;
  const period = parsePeriod(params);
  const layers = mapLayers(member.role);
  const parsed = parseMapFilters(params);
  // A department only has its cases; the department filter is its own scope.
  const filters: Filters = layers.includes(parsed.capa)
    ? parsed
    : { ...parsed, capa: layers[0] };
  if (member.role === "dependencia") filters.dependencia = undefined;

  const current = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (typeof value === "string") current.set(key, value);

  const [colonias, departments] = await Promise.all([
    getColonias(member),
    member.role === "dependencia" ? Promise.resolve([]) : getDepartments(member),
  ]);

  if (!colonias.length) {
    return (
      <NavigationFrame className="flex flex-col gap-4">
        <EmptyState
          icon={<Map />}
          title="El catálogo de colonias está vacío"
          description="Sin colonias no hay dónde contar menciones ni casos. Tráelas de OpenStreetMap o sube el GeoJSON oficial del municipio."
          action={
            canAccessPath(member.role, "/configuracion/catalogos") ? (
              <Link href="/configuracion/catalogos" className={buttonVariants({ size: "sm" })}>
                Ir a Catálogos
              </Link>
            ) : undefined
          }
        />
      </NavigationFrame>
    );
  }

  return filters.capa === "casos" ? (
    <CasesLayer member={member} period={period} filters={filters} colonias={colonias} layers={layers} departments={departments} current={current} />
  ) : (
    <ConversationLayerView member={member} period={period} filters={filters} colonias={colonias} layers={layers} departments={departments} current={current} />
  );
}

type LayerProps = {
  member: Member;
  period: Period;
  filters: Filters;
  colonias: Colonia[];
  layers: ReturnType<typeof mapLayers>;
  departments: { id: string; name: string }[];
  current: URLSearchParams;
};

const shapesOf = (colonias: Colonia[]) => colonias.flatMap((c) => (c.geometry ? [{ id: c.id, geometry: c.geometry }] : []));

function GeometryNotice({ colonias }: { colonias: Colonia[] }) {
  const undrawn = colonias.filter((c) => !c.drawable);
  if (!undrawn.length) return null;
  const invalid = undrawn.filter((c) => c.problem !== "Sin polígono").length;
  return (
    <p role="note" className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
      {undrawn.length === colonias.length ? "Ninguna" : `${undrawn.length} de ${colonias.length}`} colonias no se dibujan
      {invalid ? ` (${invalid} con polígono inválido)` : " (sin polígono)"}. Sus cifras están en la tabla.
    </p>
  );
}

async function ConversationLayerView({ member, period, filters, colonias, layers, departments, current }: LayerProps) {
  const data = await getConversationLayer(member, period, filters, colonias);
  const shapes = shapesOf(colonias);
  const selected = filters.colonia && data.rows.some((r) => r.id === filters.colonia) ? filters.colonia : null;
  const notes = new globalThis.Map(colonias.map((c) => [c.id, { drawable: c.drawable, problem: c.problem, approx: c.approx }]));
  const currentText = current.toString();

  return (
    <NavigationFrame className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MapFilters filters={filters} layers={layers} topics={data.topics} departments={departments} />
        <PeriodSelector basePath="/mapa" />
      </div>
      <GeometryNotice colonias={colonias} />
      {shapes.length ? (
        <MapExplorer
          shapes={shapes}
          rows={data.rows}
          selectedId={selected}
          unassigned={data.unassigned}
          total={data.total}
          fileName={`colonias-${period.fromDay}-a-${period.toDay}.csv`}
          panel={
            selected ? (
              <Suspense key={`${selected}:${period.fromDay}:${period.toDay}`} fallback={<PanelSkeleton />}>
                <Panel member={member} id={selected} period={period} closeHref={mapHref(current, { colonia: null })} />
              </Suspense>
            ) : null
          }
        />
      ) : (
        selected && (
          <Suspense key={`${selected}:${period.fromDay}:${period.toDay}`} fallback={<PanelSkeleton />}>
            <Panel member={member} id={selected} period={period} closeHref={mapHref(current, { colonia: null })} />
          </Suspense>
        )
      )}
      <ConversationTable rows={data.rows} notes={notes} current={currentText} selectedId={selected} />
      <UnlocatedMentionsList data={data.unlocatedMentions} period={period} />
    </NavigationFrame>
  );
}

async function CasesLayer({ member, period, filters, colonias, layers, departments, current }: LayerProps) {
  const layer = await getCaseLayer(member, period, filters, colonias);
  const selected = filters.colonia && layer.rows.some((r) => r.id === filters.colonia) ? filters.colonia : null;

  return (
    <NavigationFrame className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MapFilters filters={filters} layers={layers} topics={layer.categories} departments={departments} />
        <PeriodSelector basePath="/mapa" />
      </div>
      {member.role === "dependencia" && (
        <p className="text-xs text-muted-foreground">Sólo los casos turnados a {member.departmentName ?? "tu dependencia"}.</p>
      )}
      <GeometryNotice colonias={colonias} />
      <CasesExplorer
        shapes={shapesOf(colonias)}
        rows={layer.rows}
        points={layer.points}
        selectedId={selected}
        filters={filters}
        period={period}
        totals={{ total: layer.total, located: layer.located, unlocated: layer.unlocated.length, undrawn: layer.undrawn }}
      />
      <CasesTable rows={layer.rows} current={current.toString()} selectedId={selected} />
      <UnlocatedCasesList cases={layer.unlocated} filters={filters} period={period} />
    </NavigationFrame>
  );
}

async function Panel({ member, id, period, closeHref }: { member: Member; id: string; period: Period; closeHref: string }) {
  const detail = await getNeighborhoodDetail(member, id, period);
  return detail ? <NeighborhoodPanel detail={detail} period={period} closeHref={closeHref} /> : null;
}

function PanelSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
      </CardContent>
    </Card>
  );
}

function MapSkeleton() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Cargando mapa">
      <div className="flex flex-wrap justify-between gap-3">
        <Skeleton className="h-8 w-[28rem] max-w-full" />
        <Skeleton className="h-8 w-56" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Skeleton className="h-[min(68vh,640px)] min-h-80 lg:col-span-8" />
        <Skeleton className="h-96 lg:col-span-4" />
      </div>
    </div>
  );
}
