"use client";

// MapLibre for the browser. Since v6 the library is ESM only and looks for its
// web worker next to its own module, which no longer exists once the app is
// bundled; the bundler emits the worker as an asset from this reference.
import * as maplibregl from "maplibre-gl";

if (typeof window !== "undefined") {
  maplibregl.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);
}

export { maplibregl };
