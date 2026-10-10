"use client";

import { useState, useTransition } from "react";
import { Globe2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { importNeighborhoods, previewOsmNeighborhoods, type OsmPreview } from "@/lib/catalogs/actions";
import { PLACE_KIND_LABELS, URBAN_KINDS, zonesToGeoJson, type OsmZone, type PlaceKind } from "@/lib/geo/osm";
import { useCatalogAction } from "./use-catalog-action";

const GROUPS = [
  { key: "urban", label: "Cabecera, colonias y fraccionamientos", kinds: ["town", ...URBAN_KINDS] as PlaceKind[] },
  { key: "rural", label: "Pueblos y rancherías", kinds: ["village", "hamlet"] as PlaceKind[] },
] as const;

/**
 * Looks up the municipality in OpenStreetMap and imports its colonias and
 * localities. OSM usually has only a point per place, so most polygons are
 * approximate zones; an official GeoJSON uploaded later replaces them by name.
 */
export function OsmImport({ defaultMunicipality }: { defaultMunicipality: string }) {
  const { pending: importing, run } = useCatalogAction();
  const [searching, startSearch] = useTransition();
  const [municipality, setMunicipality] = useState(defaultMunicipality);
  const [state, setState] = useState("");
  const [preview, setPreview] = useState<OsmPreview | null>(null);
  const [groups, setGroups] = useState<Record<string, boolean>>({ urban: true, rural: true });

  const zones: OsmZone[] = preview?.ok
    ? preview.zones.filter((z) => GROUPS.some((g) => groups[g.key] && g.kinds.includes(z.kind)))
    : [];
  const approx = zones.filter((z) => z.approx).length;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-dashed p-4">
      <span className="flex items-center gap-2 text-sm font-medium">
        <Globe2 className="size-4" aria-hidden /> Traer colonias de OpenStreetMap
      </span>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPreview(null);
          startSearch(async () => setPreview(await previewOsmNeighborhoods({ municipality, state })));
        }}
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor="osm-municipality" className="text-xs text-muted-foreground">
            Municipio
          </Label>
          <Input id="osm-municipality" value={municipality} onChange={(e) => setMunicipality(e.target.value)} placeholder="Alvarado" className="h-8 w-44" required />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="osm-state" className="text-xs text-muted-foreground">
            Estado
          </Label>
          <Input id="osm-state" value={state} onChange={(e) => setState(e.target.value)} placeholder="Veracruz" className="h-8 w-44" required />
        </div>
        <Button type="submit" size="sm" variant="outline" disabled={searching || importing}>
          {searching ? "Buscando… (hasta 1 min)" : "Buscar"}
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">
        Escribe los nombres como en el mapa, con acentos. Donde OpenStreetMap sólo tiene el punto de un lugar, se dibuja una
        zona aproximada (la más cercana a ese punto); se ve punteada en el mapa y se reemplaza al subir el GeoJSON oficial.
      </p>

      {preview && !preview.ok && <p className="text-sm text-destructive">{preview.message}</p>}
      {preview?.ok && (
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            <strong>{preview.zones.length}</strong> lugares en {preview.municipality}
          </p>
          <div className="flex flex-col gap-1.5">
            {GROUPS.map((g) => {
              const inGroup = preview.zones.filter((z) => g.kinds.includes(z.kind));
              if (!inGroup.length) return null;
              return (
                <label key={g.key} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-primary"
                    checked={groups[g.key]}
                    onChange={(e) => setGroups((prev) => ({ ...prev, [g.key]: e.target.checked }))}
                  />
                  <span>
                    {g.label} ({inGroup.length})
                    <span className="block line-clamp-2 text-xs text-muted-foreground">
                      {inGroup.slice(0, 14).map((z) => z.name).join(", ")}
                      {inGroup.length > 14 && "…"}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            {Object.entries(countKinds(zones))
              .map(([kind, n]) => `${n} ${PLACE_KIND_LABELS[kind as PlaceKind].toLowerCase()}`)
              .join(" · ")}
            {approx > 0 && ` · ${approx} con zona aproximada`}
          </p>
          <div className="flex gap-2">
            <Button
              disabled={importing || !zones.length}
              onClick={() => run(() => importNeighborhoods(zonesToGeoJson(zones), "name", "osm"), () => setPreview(null))}
            >
              {importing ? "Importando…" : `Importar ${zones.length} lugares`}
            </Button>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function countKinds(zones: OsmZone[]): Partial<Record<PlaceKind, number>> {
  const counts: Partial<Record<PlaceKind, number>> = {};
  for (const z of zones) counts[z.kind] = (counts[z.kind] ?? 0) + 1;
  return counts;
}
