"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteOfficial, saveOfficial } from "@/lib/catalogs/actions";
import { cn } from "@/lib/utils";
import { useCatalogAction } from "./use-catalog-action";

type Official = { id: string; name: string; position: string; aliases: string[]; isActive: boolean };
const EMPTY = { name: "", position: "", aliases: "", isActive: true };

export function OfficialsCatalog({ officials }: { officials: Official[] }) {
  const { pending, run } = useCatalogAction();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState(EMPTY);

  const edit = (o: Official) => {
    setEditing(o.id);
    setDraft({ name: o.name, position: o.position, aliases: o.aliases.join(", "), isActive: o.isActive });
  };
  const reset = () => {
    setEditing(null);
    setDraft(EMPTY);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Presidente municipal y funcionarios cuya gestión se evalúa en <strong>Funcionarios</strong>. Los alias son las
        formas en que la gente los menciona (<em>la alcaldesa</em>, <em>el director de obras</em>, su usuario en redes).
        Sólo servidores públicos: nunca ciudadanos, periodistas ni opositores.
      </p>
      {officials.length > 0 && (
        <ul className="flex flex-col divide-y rounded-xl border">
          {officials.map((o) => (
            <li key={o.id} className={cn("flex items-start gap-2 px-3 py-2 text-sm", !o.isActive && "opacity-60")}>
              <div className="flex-1">
                <p className="font-medium">
                  {o.name} <span className="font-normal text-muted-foreground">· {o.position}</span>
                  {!o.isActive && <span className="ml-1 text-xs text-muted-foreground">(inactivo)</span>}
                </p>
                {o.aliases.length > 0 && <p className="text-xs text-muted-foreground">Alias: {o.aliases.join(", ")}</p>}
              </div>
              <Button size="icon-sm" variant="ghost" aria-label={`Editar ${o.name}`} onClick={() => edit(o)}>
                <Pencil aria-hidden />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Eliminar ${o.name}`}
                disabled={pending}
                onClick={() => confirm(`¿Eliminar a ${o.name} del catálogo?`) && run(() => deleteOfficial(o.id), reset)}
              >
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveOfficial({ id: editing ?? undefined, ...draft }), reset);
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="official-name">Nombre</Label>
          <Input id="official-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="official-position">Cargo</Label>
          <Input id="official-position" value={draft.position} onChange={(e) => setDraft({ ...draft, position: e.target.value })} placeholder="Presidente municipal" required />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="official-aliases">Alias (separados por coma)</Label>
          <Input
            id="official-aliases"
            value={draft.aliases}
            onChange={(e) => setDraft({ ...draft, aliases: e.target.value })}
            placeholder="presidente municipal, alcalde, @usuario"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          {editing && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />
              Activo
            </label>
          )}
          <Button type="submit" variant="outline" disabled={pending || !draft.name.trim() || !draft.position.trim()}>
            <Plus aria-hidden /> {editing ? "Guardar cambios" : "Agregar funcionario"}
          </Button>
          {editing && (
            <Button type="button" variant="ghost" onClick={reset}>
              Cancelar
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
