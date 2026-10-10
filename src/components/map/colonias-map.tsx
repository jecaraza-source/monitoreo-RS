"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { type GeoJSONSource, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useTheme } from "next-themes";

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

function baseStyle(theme: Theme, data: GeoJSON.FeatureCollection, selectedId: string | null): StyleSpecification {
  const variant = theme === "dark" ? "dark_all" : "light_all";
  const hue = HUES[theme];
  const hovered = ["boolean", ["feature-state", "hover"], false] as maplibregl.ExpressionSpecification;
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
      colonias: { type: "geojson", data },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": theme === "dark" ? "#1c1c1c" : "#f4f4f5" } },
      { id: "carto", type: "raster", source: "carto" },
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
}: {
  features: ColoniaFeature[];
  scale: ColorScale;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const { resolvedTheme } = useTheme();
  const theme: Theme = resolvedTheme === "light" ? "light" : "dark";
  const latest = useRef({ features, scale, selectedId, onSelect });
  const [hover, setHover] = useState<Hover>(null);

  useEffect(() => {
    latest.current = { features, scale, selectedId, onSelect };
  });

  useEffect(() => {
    if (!container.current) return;
    const { features: initial, scale: initialScale, selectedId: initialSelected } = latest.current;
    const m = new maplibregl.Map({
      container: container.current,
      style: baseStyle(theme, toCollection(initial, initialScale, theme), initialSelected),
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    // Open on the selected colonia, else on those with data (a municipality's
    // localities can span 60 km; the activity is usually in a few of them).
    const selected = initial.find((f) => f.id === initialSelected);
    const active = initial.filter((f) => f.value !== null && f.value !== 0);
    const box = boundsOf((selected ? [selected] : active.length ? active : initial).map((f) => f.geometry));
    if (box) m.fitBounds(box, { padding: selected ? 80 : 32, maxZoom: 15, animate: false });

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
      const id = e.features?.[0]?.properties?.id as string | undefined;
      if (id) latest.current.onSelect(id);
    });

    return () => {
      m.remove();
      map.current = null;
    };
  }, [theme]);

  // New data, metric or filters: repaint without rebuilding the map.
  useEffect(() => {
    const source = map.current?.getSource("colonias") as GeoJSONSource | undefined;
    source?.setData(toCollection(features, scale, theme));
  }, [features, scale, theme]);

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

  return (
    <>
      <div ref={container} className="size-full" role="img" aria-label="Mapa de colonias coloreado según la métrica elegida" />
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
