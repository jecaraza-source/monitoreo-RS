"use client";

import { useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteDepartment, saveDepartment } from "@/lib/catalogs/actions";
import { useCatalogAction } from "./use-catalog-action";

type Department = { id: string; name: string; shortName: string | null };

export function DepartmentsCatalog({ departments }: { departments: Department[] }) {
  const { pending, run } = useCatalogAction();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", shortName: "" });
  const [newName, setNewName] = useState("");

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y rounded-xl border">
        {departments.map((d) => (
          <li key={d.id} className="flex items-center gap-2 px-3 py-2 text-sm">
            {editing === d.id ? (
              <>
                <Input
                  aria-label="Nombre de la dependencia"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className="h-8"
                />
                <Input
                  aria-label="Nombre corto"
                  value={draft.shortName}
                  onChange={(e) => setDraft({ ...draft, shortName: e.target.value })}
                  placeholder="Corto"
                  className="h-8 w-28"
                />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Guardar"
                  disabled={pending}
                  onClick={() => run(() => saveDepartment({ id: d.id, ...draft }), () => setEditing(null))}
                >
                  <Check aria-hidden />
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label="Cancelar" onClick={() => setEditing(null)}>
                  <X aria-hidden />
                </Button>
              </>
            ) : (
              <>
                <span className="flex-1">{d.name}</span>
                {d.shortName && <code className="text-xs text-muted-foreground">{d.shortName}</code>}
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Editar ${d.name}`}
                  onClick={() => {
                    setEditing(d.id);
                    setDraft({ name: d.name, shortName: d.shortName ?? "" });
                  }}
                >
                  <Pencil aria-hidden />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Eliminar ${d.name}`}
                  disabled={pending}
                  onClick={() => confirm(`¿Eliminar ${d.name}?`) && run(() => deleteDepartment(d.id))}
                >
                  <Trash2 aria-hidden />
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveDepartment({ name: newName }), () => setNewName(""));
        }}
      >
        <Input
          aria-label="Nueva dependencia"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Nueva dependencia"
        />
        <Button type="submit" variant="outline" disabled={pending || !newName.trim()}>
          <Plus aria-hidden /> Agregar
        </Button>
      </form>
    </div>
  );
}
