"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { type GeoJSONSource, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useTheme } from "next-themes";
import { formatNumber } from "./chart-theme";
import { useDashboardFrame } from "./dashboard-frame";

export type MapFeature = {
  id: string;
  name: string;
  complaints: number;
  total: number;
  href: string;
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
};

// Sequential scale: one hue (the negative token's validated hex per theme),
// light → dark by complaints. MapLibre needs concrete colors, not CSS vars.
const COMPLAINT_HUE = { light: "#df2225", dark: "#e9504d" } as const;
const OUTLINE = { light: "#777a80", dark: "#83868c" } as const;

function toCollection(features: MapFeature[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: features.map((f, i) => ({
      type: "Feature",
      id: i,
      geometry: f.geometry as GeoJSON.Geometry,
      properties: { name: f.name, complaints: f.complaints, total: f.total, href: f.href },
    })),
  };
}

const opacityByComplaints = (max: number) =>
  ["interpolate", ["linear"], ["get", "complaints"], 0, 0.06, Math.max(max, 1), 0.72] as maplibregl.ExpressionSpecification;

function baseStyle(theme: "light" | "dark", features: MapFeature[], max: number): StyleSpecification {
  const variant = theme === "dark" ? "dark_all" : "light_all";
  return {
    version: 8,
    sources: {
      carto: {
        type: "raster",
        tiles: ["a", "b", "c", "d"].map((s) => `https://${s}.basemaps.cartocdn.com/${variant}/{z}/{x}/{y}.png`),
        tileSize: 256,
        attribution: "© OpenStreetMap · © CARTO",
      },
      // Part of the initial style: the colonias render even if basemap tiles fail.
      colonias: { type: "geojson", data: toCollection(features) },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": theme === "dark" ? "#1c1c1c" : "#f4f4f5" } },
      { id: "carto", type: "raster", source: "carto" },
      {
        id: "colonias-fill",
        type: "fill",
        source: "colonias",
        paint: { "fill-color": COMPLAINT_HUE[theme], "fill-opacity": opacityByComplaints(max) },
      },
      {
        id: "colonias-line",
        type: "line",
        source: "colonias",
        paint: {
          "line-color": ["case", ["boolean", ["feature-state", "hover"], false], COMPLAINT_HUE[theme], OUTLINE[theme]],
          "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 2.5, 1],
        },
      },
    ],
  };
}

function bounds(features: MapFeature[]): maplibregl.LngLatBounds | null {
  const b = new maplibregl.LngLatBounds();
  let any = false;
  const walk = (c: unknown) => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      b.extend([c[0], c[1] as number]);
      any = true;
    } else if (Array.isArray(c)) c.forEach(walk);
  };
  features.forEach((f) => walk(f.geometry.coordinates));
  return any ? b : null;
}

type Hover = { x: number; y: number; width: number; name: string; complaints: number; total: number } | null;

export function NeighborhoodsMapCanvas({ features, max }: { features: MapFeature[]; max: number }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "light" ? "light" : "dark";
  const { navigate } = useDashboardFrame();
  const navigateRef = useRef(navigate);
  const dataRef = useRef({ features, max });
  const [hover, setHover] = useState<Hover>(null);

  useEffect(() => {
    navigateRef.current = navigate;
    dataRef.current = { features, max };
  });

  useEffect(() => {
    if (!container.current) return;
    const { features: initial, max: initialMax } = dataRef.current;
    const m = new maplibregl.Map({
      container: container.current,
      style: baseStyle(theme, initial, initialMax),
      attributionControl: { compact: true },
      cooperativeGestures: true,
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    const box = bounds(initial);
    if (box) m.fitBounds(box, { padding: 24, animate: false });

    let hovered: number | string | undefined;
    m.on("mousemove", "colonias-fill", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      if (hovered !== undefined) m.setFeatureState({ source: "colonias", id: hovered }, { hover: false });
      hovered = f.id;
      m.setFeatureState({ source: "colonias", id: hovered! }, { hover: true });
      m.getCanvas().style.cursor = "pointer";
      const p = f.properties as { name: string; complaints: number; total: number };
      setHover({ x: e.point.x, y: e.point.y, width: m.getCanvas().clientWidth, name: p.name, complaints: p.complaints, total: p.total });
    });
    m.on("mouseleave", "colonias-fill", () => {
      if (hovered !== undefined) m.setFeatureState({ source: "colonias", id: hovered }, { hover: false });
      hovered = undefined;
      m.getCanvas().style.cursor = "";
      setHover(null);
    });
    m.on("click", "colonias-fill", (e) => {
      const href = e.features?.[0]?.properties?.href as string | undefined;
      if (href) navigateRef.current(href);
    });

    return () => {
      m.remove();
      map.current = null;
    };
  }, [theme]);

  // New data (auto-refresh, period change) without rebuilding the map.
  useEffect(() => {
    const m = map.current;
    const source = m?.getSource("colonias") as GeoJSONSource | undefined;
    if (!m || !source) return;
    source.setData(toCollection(features));
    m.setPaintProperty("colonias-fill", "fill-opacity", opacityByComplaints(max));
  }, [features, max]);

  return (
    <>
      <div ref={container} className="size-full" role="img" aria-label="Mapa de colonias coloreado por número de quejas" />
      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
          style={{ left: Math.max(4, Math.min(hover.x + 12, hover.width - 184)), top: Math.max(hover.y - 56, 4) }}
        >
          <p className="font-medium">{hover.name}</p>
          <p className="text-muted-foreground">
            {formatNumber(hover.complaints)} {hover.complaints === 1 ? "queja" : "quejas"} · {formatNumber(hover.total)} menciones
          </p>
        </div>
      )}
    </>
  );
}
