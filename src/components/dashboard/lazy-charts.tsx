"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import type { SeriesPoint } from "@/lib/dashboard/model";
import type { MapFeature } from "./neighborhoods-map-canvas";
import type { NssBar } from "./nss-bars";
import { WhenVisible } from "./when-visible";

// Recharts (~370 kB) and MapLibre (~800 kB) load in their own chunks, only
// when a chart is about to be seen.
const loading = () => <Skeleton className="size-full" />;
const VolumeChart = dynamic(() => import("./volume-chart").then((m) => m.VolumeChart), { ssr: false, loading });
const NssBars = dynamic(() => import("./nss-bars").then((m) => m.NssBars), { ssr: false, loading });
const MapCanvas = dynamic(() => import("./neighborhoods-map-canvas").then((m) => m.NeighborhoodsMapCanvas), { ssr: false, loading });

export function LazyVolumeChart(props: { series: SeriesPoint[]; bucket: "hour" | "day" }) {
  return (
    <WhenVisible>
      <VolumeChart {...props} />
    </WhenVisible>
  );
}

export function LazyNssBars(props: { rows: NssBar[]; label: string }) {
  return (
    <WhenVisible>
      <NssBars {...props} />
    </WhenVisible>
  );
}

export function LazyNeighborhoodsMap(props: { features: MapFeature[]; max: number }) {
  return (
    <WhenVisible>
      <div className="relative size-full overflow-hidden rounded-lg">
        <MapCanvas {...props} />
      </div>
    </WhenVisible>
  );
}
