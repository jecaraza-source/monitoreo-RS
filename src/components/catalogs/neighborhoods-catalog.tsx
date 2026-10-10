"use client";

import { useRef, useState } from "react";
import { FileUp, MapPin, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { deleteNeighborhood, importNeighborhoods, saveNeighborhood } from "@/lib/catalogs/actions";
import { parseNeighborhoodsGeoJson, type GeoJsonParseResult } from "@/lib/geo/neighborhoods-geojson";
import { OsmImport } from "./osm-import";
import { useCatalogAction } from "./use-catalog-action";

type Neighborhood = { id: string; name: string; hasShape: boolean; approx: boolean };

const MAX_BYTES = 3.8 * 1024 * 1024; // under the 4 MB Server Action limit

export function NeighborhoodsCatalog({ neighborhoods, municipality }: { neighborhoods: Neighborhood[]; municipality: string }) {
  const { pending, run } = useCatalogAction();
  const [newName, setNewName] = useState("");
  const [file, setFile] = useState<{ name: string; json: unknown } | null>(null);
  const [parsed, setParsed] = useState<GeoJsonParseResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFile(selected: File | undefined) {
    setParsed(null);
    setFile(null);
    if (!selected) return;
    if (selected.size > MAX_BYTES) {
      setParsed({ ok: false, message: "El archivo pesa más de 3.8 MB. Simplifica las geometrías antes de subirlo." });
      return;
    }
    try {
      const json = JSON.parse(await selected.text());
      setFile({ name: selected.name, json });
      setParsed(parseNeighborhoodsGeoJson(json));
    } catch {
      setParsed({ ok: false, message: "El archivo no es JSON válido." });
    }
  }

  function reset() {
    setFile(null);
    setParsed(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="flex flex-col gap-4">
      <OsmImport defaultMunicipality={municipality} />
      <div className="flex flex-col gap-3 rounded-xl border border-dashed p-4">
        <span className="flex items-center gap-2 text-sm font-medium">
          <FileUp className="size-4" aria-hidden /> Cargar GeoJSON de colonias
        </span>
        <div className="flex items-center gap-3">
          {/* Native input hidden behind a Spanish label; the browser's own text follows its locale. */}
          <input
            ref={inputRef}
            id="geojson-file"
            type="file"
            accept=".geojson,.json,application/geo+json,application/json"
            onChange={(e) => onFile(e.target.files?.[0])}
            className="peer sr-only"
          />
          <Label
            htmlFor="geojson-file"
            className="cursor-pointer rounded-lg border bg-background px-3 py-1.5 text-sm hover:bg-muted peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50"
          >
            Elegir archivo
          </Label>
          <span className="truncate text-sm text-muted-foreground">{file?.name ?? "Ningún archivo"}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          FeatureCollection con polígonos. Las colonias nuevas se agregan; las que ya existen (mismo nombre)
          actualizan su polígono.
        </p>
        {parsed && !parsed.ok && <p className="text-sm text-destructive">{parsed.message}</p>}
        {parsed?.ok && file && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span>
                <strong>{parsed.features.length}</strong> colonias en {file.name}
                {parsed.skipped.length > 0 && (
                  <span className="text-muted-foreground"> · {parsed.skipped.length} omitidas</span>
                )}
              </span>
              <span className="text-muted-foreground">Nombre tomado de</span>
              <Select
                value={parsed.nameProperty}
                onValueChange={(prop) => setParsed(parseNeighborhoodsGeoJson(file.json, String(prop)))}
              >
                <SelectTrigger size="sm" className="w-40" aria-label="Propiedad con el nombre">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {parsed.candidateProperties.map((prop) => (
                    <SelectItem key={prop} value={prop}>
                      {prop}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="line-clamp-2 text-xs text-muted-foreground">
              {parsed.features.slice(0, 12).map((f) => f.name).join(", ")}
              {parsed.features.length > 12 && "…"}
            </p>
            <div className="flex gap-2">
              <Button
                disabled={pending}
                onClick={() => run(() => importNeighborhoods(file.json, parsed.nameProperty), reset)}
              >
                {pending ? "Importando…" : `Importar ${parsed.features.length} colonias`}
              </Button>
              <Button variant="ghost" onClick={reset}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </div>

      <ul className="grid max-h-80 gap-x-4 overflow-y-auto rounded-xl border p-2 sm:grid-cols-2">
        {neighborhoods.map((n) => (
          <li key={n.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50">
            <MapPin
              className={n.hasShape ? (n.approx ? "size-4 text-positive/60" : "size-4 text-positive") : "size-4 text-muted-foreground"}
              aria-label={n.hasShape ? (n.approx ? "Zona aproximada" : "Con polígono") : "Sin polígono"}
            />
            <span className="flex-1 truncate">{n.name}</span>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Eliminar ${n.name}`}
              disabled={pending}
              onClick={() => confirm(`¿Eliminar la colonia ${n.name}?`) && run(() => deleteNeighborhood(n.id))}
            >
              <Trash2 aria-hidden />
            </Button>
          </li>
        ))}
      </ul>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveNeighborhood({ name: newName }), () => setNewName(""));
        }}
      >
        <Input
          aria-label="Nueva colonia"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Agregar colonia sin polígono"
        />
        <Button type="submit" variant="outline" disabled={pending || !newName.trim()}>
          <Plus aria-hidden /> Agregar
        </Button>
      </form>
    </div>
  );
}
