"use client";

import { useEffect, useRef, useState } from "react";
import { maplibregl } from "@/components/map/maplibre";
import type { GeoJSONSource, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useTheme } from "next-themes";
import { Expand, WifiOff } from "lucide-react";
import { focusShapes } from "@/lib/map/focus";
import { applyBasemap, PLAIN_BACKGROUND } from "./basemap";

export type ColoniaFeature = {
  id: string;
  name: string;
  /** Metric value; null when there is not enough data (drawn gray). */
  value: number | null;
  /** Tooltip second line ("12 quejas"). */
  label: string;
  approx: boolean;
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
};

/** A confirmed case location (already rounded to ~100 m by the database). */
export type MapPoint = { id: string; lat: number; lng: number; label: string };

export type ColorScale = { kind: "sequential" | "diverging"; max: number; positiveIsGood?: boolean };

// Validated hexes of the semantic tokens per theme (MapLibre needs concrete
// colors, not CSS variables). Sequential metrics use the negative hue.
const HUES = {
  light: { negative: "#df2225", positive: "#25984d", empty: "#a1a1aa", outline: "#777a80", selected: "#111827" },
  dark: { negative: "#e9504d", positive: "#33ac5a", empty: "#71717a", outline: "#83868c", selected: "#f4f4f5" },
} as const;

type Theme = keyof typeof HUES;

/** Fill color and opacity of one colonia, from its value and the scale. */
function paint(value: number | null, scale: ColorScale, theme: Theme): { color: string; opacity: number } {
  const hue = HUES[theme];
  if (value === null) return { color: hue.empty, opacity: 0.12 };
  const t = Math.min(Math.abs(value) / Math.max(scale.max, 1), 1);
  if (scale.kind === "sequential") return { color: hue.negative, opacity: value <= 0 ? 0.04 : 0.1 + 0.62 * t };
  if (value === 0) return { color: hue.empty, opacity: 0.12 };
  const good = scale.positiveIsGood ? value > 0 : value < 0;
  return { color: good ? hue.positive : hue.negative, opacity: 0.12 + 0.6 * t };
}

function toCollection(features: ColoniaFeature[], scale: ColorScale, theme: Theme): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: features.map((f, i) => {
      const { color, opacity } = paint(f.value, scale, theme);
      return {
        type: "Feature",
        id: i,
        geometry: f.geometry as GeoJSON.Geometry,
        properties: { id: f.id, name: f.name, label: f.label, approx: f.approx, color, opacity },
      };
    }),
  };
}

function pointCollection(points: MapPoint[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: points.map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: [p.lng, p.lat] }, properties: { id: p.id, label: p.label } })),
  };
}

/** Our layers: the colonias over a plain background. applyBasemap() later puts the streets underneath. */
function baseStyle(theme: Theme, data: GeoJSON.FeatureCollection, selectedId: string | null, points: MapPoint[] | undefined): StyleSpecification {
  const hue = HUES[theme];
  const hovered = ["boolean", ["feature-state", "hover"], false] as maplibregl.ExpressionSpecification;
  // Confirmed case locations, grouped when close (no text labels: they would need the basemap's fonts).
  const pointLayers: StyleSpecification["layers"] = points
    ? [
        {
          id: "case-clusters",
          type: "circle",
          source: "cases",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": hue.selected,
            "circle-opacity": 0.75,
            "circle-stroke-color": PLAIN_BACKGROUND[theme],
            "circle-stroke-width": 2,
            "circle-radius": ["step", ["get", "point_count"], 10, 5, 14, 20, 18, 100, 24],
          },
        },
        {
          id: "case-points",
          type: "circle",
          source: "cases",
          filter: ["!", ["has", "point_count"]],
          paint: { "circle-color": hue.selected, "circle-radius": 5, "circle-stroke-color": PLAIN_BACKGROUND[theme], "circle-stroke-width": 1.5 },
        },
      ]
    : [];
  return {
    version: 8,
    sources: {
      colonias: { type: "geojson", data },
      ...(points ? { cases: { type: "geojson" as const, data: pointCollection(points), cluster: true, clusterRadius: 40, clusterMaxZoom: 15 } } : {}),
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": PLAIN_BACKGROUND[theme] } },
      {
        id: "colonias-fill",
        type: "fill",
        source: "colonias",
        paint: { "fill-color": ["get", "color"], "fill-opacity": ["case", hovered, ["min", ["+", ["get", "opacity"], 0.12], 0.9], ["get", "opacity"]] },
      },
      // Drawn outlines solid; zones approximated from an OSM point dashed.
      {
        id: "colonias-line",
        type: "line",
        source: "colonias",
        filter: ["!", ["get", "approx"]],
        paint: { "line-color": hue.outline, "line-width": ["case", hovered, 2, 0.8] },
      },
      {
        id: "colonias-line-approx",
        type: "line",
        source: "colonias",
        filter: ["get", "approx"],
        paint: { "line-color": hue.outline, "line-width": ["case", hovered, 2, 0.8], "line-dasharray": [2, 2] },
      },
      {
        id: "colonias-selected",
        type: "line",
        source: "colonias",
        filter: ["==", ["get", "id"], selectedId ?? ""],
        paint: { "line-color": hue.selected, "line-width": 3 },
      },
      ...pointLayers,
    ],
  };
}

function boundsOf(geometries: ColoniaFeature["geometry"][]): maplibregl.LngLatBounds | null {
  const b = new maplibregl.LngLatBounds();
  let any = false;
  const walk = (c: unknown) => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      b.extend([c[0], c[1] as number]);
      any = true;
    } else if (Array.isArray(c)) c.forEach(walk);
  };
  geometries.forEach((g) => walk(g.coordinates));
  return any ? b : null;
}

type Hover = { x: number; y: number; width: number; name: string; label: string; approx: boolean } | null;

export function ColoniasMap({
  features,
  scale,
  selectedId,
  onSelect,
  points,
  onSelectPoint,
  label = "Mapa de colonias coloreado según la métrica elegida",
}: {
  features: ColoniaFeature[];
  scale: ColorScale;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Confirmed locations (cases layer); undefined on the conversation layer. */
  points?: MapPoint[];
  onSelectPoint?: (id: string) => void;
  label?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const { resolvedTheme } = useTheme();
  const theme: Theme = resolvedTheme === "light" ? "light" : "dark";
  const latest = useRef({ features, scale, selectedId, onSelect, points, onSelectPoint });
  const [hover, setHover] = useState<Hover>(null);
  // Without the street basemap (offline, blocked or failing style) the colonias still show.
  const [basemap, setBasemap] = useState<"loading" | "ok" | "failed">("loading");
  // MapLibre needs WebGL; without it the table below is the map.
  const [broken, setBroken] = useState(false);
  const withPoints = points !== undefined;

  useEffect(() => {
    latest.current = { features, scale, selectedId, onSelect, points, onSelectPoint };
  });

  useEffect(() => {
    if (!container.current) return;
    const { features: initial, scale: initialScale, selectedId: initialSelected, points: initialPoints } = latest.current;
    let m: maplibregl.Map;
    try {
      m = new maplibregl.Map({
        container: container.current,
        style: baseStyle(theme, toCollection(initial, initialScale, theme), initialSelected, initialPoints),
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
      });
    } catch {
      // No WebGL (old browser, disabled acceleration): the table stays usable.
      queueMicrotask(() => setBroken(true));
      return;
    }
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    const stopBasemap = applyBasemap(
      m,
      theme,
      () => {
        const now = latest.current;
        return baseStyle(theme, toCollection(now.features, now.scale, theme), now.selectedId, now.points);
      },
      (loaded) => setBasemap(loaded ? "ok" : "failed"),
    );
    // Open on the selected colonia, else on the one with most of the metric and
    // its neighbors ("Ver todo" shows the whole municipality).
    const selected = initial.find((f) => f.id === initialSelected);
    const box = boundsOf((selected ? [selected] : focusShapes(initial)).map((f) => f.geometry));
    if (box) m.fitBounds(box, { padding: selected ? 80 : 48, maxZoom: 15, animate: false });

    let hovered: number | string | undefined;
    m.on("mousemove", "colonias-fill", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      if (hovered !== undefined) m.setFeatureState({ source: "colonias", id: hovered }, { hover: false });
      hovered = f.id;
      m.setFeatureState({ source: "colonias", id: hovered! }, { hover: true });
      m.getCanvas().style.cursor = "pointer";
      const p = f.properties as { name: string; label: string; approx: boolean };
      setHover({ x: e.point.x, y: e.point.y, width: m.getCanvas().clientWidth, name: p.name, label: p.label, approx: p.approx });
    });
    m.on("mouseleave", "colonias-fill", () => {
      if (hovered !== undefined) m.setFeatureState({ source: "colonias", id: hovered }, { hover: false });
      hovered = undefined;
      m.getCanvas().style.cursor = "";
      setHover(null);
    });
    m.on("click", "colonias-fill", (e) => {
      // A click on a case point is not a click on its colonia.
      if (withPoints && m.queryRenderedFeatures(e.point, { layers: ["case-points", "case-clusters"] }).length) return;
      const id = e.features?.[0]?.properties?.id as string | undefined;
      if (id) latest.current.onSelect(id);
    });
    if (withPoints) {
      m.on("click", "case-clusters", async (e) => {
        const f = e.features?.[0];
        const source = m.getSource("cases") as GeoJSONSource | undefined;
        if (!f || !source) return;
        const zoom = await source.getClusterExpansionZoom(f.properties?.cluster_id as number);
        m.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom });
      });
      m.on("click", "case-points", (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) latest.current.onSelectPoint?.(id);
      });
      for (const layer of ["case-points", "case-clusters"]) {
        m.on("mousemove", layer, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          m.getCanvas().style.cursor = "pointer";
          const p = f.properties as { label?: string; point_count?: number };
          const name = p.point_count ? `${p.point_count} casos con ubicación confirmada` : (p.label ?? "");
          setHover({ x: e.point.x, y: e.point.y, width: m.getCanvas().clientWidth, name, label: p.point_count ? "Clic para acercar" : "Clic para abrir el caso", approx: false });
        });
        m.on("mouseleave", layer, () => {
          m.getCanvas().style.cursor = "";
          setHover(null);
        });
      }
    }

    return () => {
      stopBasemap();
      m.remove();
      map.current = null;
    };
  }, [theme, withPoints]);

  // New data, metric or filters: repaint without rebuilding the map.
  useEffect(() => {
    const source = map.current?.getSource("colonias") as GeoJSONSource | undefined;
    source?.setData(toCollection(features, scale, theme));
    if (points) (map.current?.getSource("cases") as GeoJSONSource | undefined)?.setData(pointCollection(points));
  }, [features, scale, theme, points]);

  // Selection from the ranking or the URL: outline it and bring it into view.
  const previous = useRef(selectedId);
  useEffect(() => {
    const m = map.current;
    if (!m || !m.getLayer("colonias-selected")) return;
    m.setFilter("colonias-selected", ["==", ["get", "id"], selectedId ?? ""]);
    if (selectedId && selectedId !== previous.current) {
      const f = latest.current.features.find((x) => x.id === selectedId);
      const box = f && boundsOf([f.geometry]);
      if (box) m.fitBounds(box, { padding: 80, maxZoom: 15, duration: 600 });
    }
    previous.current = selectedId;
  }, [selectedId]);

  function showAll() {
    const box = boundsOf(latest.current.features.map((f) => f.geometry));
    if (box) map.current?.fitBounds(box, { padding: 32, maxZoom: 15, duration: 600 });
  }

  if (broken) {
    return (
      <div className="flex size-full items-center justify-center p-6 text-center text-sm text-muted-foreground" role="status">
        Este navegador no pudo dibujar el mapa (necesita WebGL). La tabla de abajo tiene la misma información.
      </div>
    );
  }

  return (
    <>
      {/* Keyboard: Tab enters the map; arrows pan, + and − zoom. The table below lists the same data. */}
      <div ref={container} className="size-full" role="region" aria-label={`${label}. Con el teclado: flechas para mover, + y − para acercar; la tabla de abajo tiene los mismos datos.`} />
      {basemap === "failed" && (
        <p role="status" className="absolute bottom-2 left-2.5 z-10 flex items-center gap-1.5 rounded-md border bg-background/90 px-2.5 py-1 text-xs text-muted-foreground shadow-sm">
          <WifiOff aria-hidden className="size-3.5" /> Sin mapa de calles (sin conexión o servicio no disponible): se muestran sólo las colonias.
        </p>
      )}
      <button
        type="button"
        onClick={showAll}
        className="absolute top-2.5 left-2.5 z-10 flex items-center gap-1.5 rounded-md border bg-background/90 px-2.5 py-1.5 text-xs font-medium shadow-sm backdrop-blur hover:bg-muted"
      >
        <Expand aria-hidden className="size-3.5" /> Ver todo
      </button>
      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
          style={{ left: Math.max(4, Math.min(hover.x + 12, hover.width - 200)), top: Math.max(hover.y - 64, 4) }}
        >
          <p className="font-medium">{hover.name}</p>
          <p className="text-muted-foreground">{hover.label}</p>
          {hover.approx && <p className="text-muted-foreground">Zona aproximada</p>}
        </div>
      )}
    </>
  );
}
