// Where the map opens. A municipality's localities can span 60 km and, at
// that zoom, colonias are dots and the basemap shows no streets; so the map
// opens on the colonia with the most of the metric and its neighbors. Pure.

type Shape = { id: string; value: number | null; geometry: { coordinates: unknown } };

/** Center of a polygon's bounding box, [lon, lat]. */
export function centerOf(geometry: Shape["geometry"]): [number, number] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const walk = (c: unknown) => {
    if (Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number") {
      minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0]);
      minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1]);
    } else if (Array.isArray(c)) c.forEach(walk);
  };
  walk(geometry.coordinates);
  return Number.isFinite(minX) ? [(minX + maxX) / 2, (minY + maxY) / 2] : null;
}

/** Great-circle distance in km. */
export function distanceKm([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]): number {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

/**
 * The colonias to open on: the one with the largest absolute value and every
 * other within `radiusKm` of it. All of them when none has data.
 */
export function focusShapes<T extends Shape>(shapes: T[], radiusKm = 5): T[] {
  const withData = shapes.filter((s) => s.value !== null && s.value !== 0);
  if (!withData.length) return shapes;
  const top = withData.reduce((best, s) => (Math.abs(s.value!) > Math.abs(best.value!) ? s : best));
  const origin = centerOf(top.geometry);
  if (!origin) return shapes;
  return shapes.filter((s) => {
    const c = centerOf(s.geometry);
    return c !== null && distanceKm(origin, c) <= radiusKm;
  });
}
