import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Map } from "lucide-react";
import { NavigationFrame } from "@/components/dashboard/dashboard-frame";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import { PageHeader } from "@/components/layout/page-header";
import { MapExplorer } from "@/components/map/map-explorer";
import { MapFilters } from "@/components/map/map-filters";
import { NeighborhoodPanel } from "@/components/map/neighborhood-panel";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui-kit";
import { canAccessPath } from "@/lib/auth/roles";
import { requireSection, type Member } from "@/lib/auth/session";
import { parsePeriod, type Period } from "@/lib/dashboard/period";
import { getMapPage, getNeighborhoodDetail } from "@/lib/map/data";
import { mapHref, parseMapFilters } from "@/lib/map/model";

export const metadata: Metadata = { title: "Mapa" };

export default function MapaPage({ searchParams }: PageProps<"/mapa">) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Mapa" description="Menciones, quejas y sentimiento por colonia, comparados con el periodo anterior." />
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
  const filters = parseMapFilters(params);
  const data = await getMapPage(member, period, filters);

  const current = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (typeof value === "string") current.set(key, value);
  const selected = filters.colonia && data.rows.some((r) => r.id === filters.colonia) ? filters.colonia : null;

  return (
    <NavigationFrame className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MapFilters filters={filters} topics={data.topics} departments={data.departments} />
        <PeriodSelector basePath="/mapa" />
      </div>
      {data.shapes.length ? (
        <MapExplorer
          shapes={data.shapes}
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
        <EmptyState
          icon={<Map />}
          title="Faltan los polígonos de las colonias"
          description={
            data.withoutShape
              ? `Hay ${data.withoutShape} colonias en el catálogo, pero ninguna tiene polígono. Tráelas de OpenStreetMap o sube el GeoJSON oficial.`
              : "Tráelas de OpenStreetMap o sube el GeoJSON oficial del municipio."
          }
          action={
            canAccessPath(member.role, "/configuracion/catalogos") ? (
              <Link href="/configuracion/catalogos" className={buttonVariants({ size: "sm" })}>
                Ir a Catálogos
              </Link>
            ) : undefined
          }
        />
      )}
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
