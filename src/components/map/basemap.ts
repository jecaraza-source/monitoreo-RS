"use client";

import type * as maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";

// Street basemap from OpenFreeMap: OpenStreetMap data, free, no API key and
// no usage limits (CARTO's free raster tiles now require a key). The maps
// start with only the colonias over a plain background and lay the streets
// underneath once the style arrives, so a basemap outage never hides data.
const STYLE_URL = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
} as const;

export type Theme = keyof typeof STYLE_URL;

const cache = new Map<Theme, Promise<StyleSpecification | null>>();

async function fetchStyle(url: string): Promise<StyleSpecification | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const style = (await res.json()) as StyleSpecification;
    return style?.version === 8 && Array.isArray(style.layers) ? style : null;
  } catch {
    return null;
  }
}

/** The basemap style for a theme; dark falls back to the light one; null when unreachable. */
export function loadBasemap(theme: Theme): Promise<StyleSpecification | null> {
  let style = cache.get(theme);
  if (!style) {
    style = fetchStyle(STYLE_URL[theme]).then((s) => s ?? (theme === "dark" ? loadBasemap("light") : null));
    cache.set(theme, style);
  }
  return style;
}

/**
 * Our style (background + colonias) on top of the basemap: its sources,
 * glyphs and sprite, then its layers, then ours minus our own background.
 */
export function withBasemap(base: StyleSpecification, own: StyleSpecification): StyleSpecification {
  return {
    ...base,
    sources: { ...base.sources, ...own.sources },
    layers: [...base.layers, ...own.layers.filter((l) => l.type !== "background")],
  };
}

/** Swaps in the street basemap once loaded, keeping the map's current colonias data and filters. */
export function applyBasemap(map: maplibregl.Map, theme: Theme, currentStyle: () => StyleSpecification) {
  let cancelled = false;
  loadBasemap(theme).then((base) => {
    if (cancelled || !base) return;
    map.setStyle(withBasemap(base, currentStyle()));
  });
  return () => {
    cancelled = true;
  };
}

export const PLAIN_BACKGROUND = { light: "#f4f4f5", dark: "#1c1c1c" } as const;
