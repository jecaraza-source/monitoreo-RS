"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveCaseCategory } from "@/lib/catalogs/categories";
import { useCatalogAction } from "./use-catalog-action";

export type CaseCategory = {
  id: string;
  name: string;
  description: string;
  defaultDepartmentId: string | null;
  active: boolean;
  departmentIds: string[];
};
type Department = { id: string; name: string };

const EMPTY: Omit<CaseCategory, "id"> & { id?: string } = { name: "", description: "", defaultDepartmentId: null, active: true, departmentIds: [] };

function CategoryForm({ initial, departments, onDone }: { initial: typeof EMPTY; departments: Department[]; onDone: () => void }) {
  const { pending, run } = useCatalogAction();
  const router = useRouter();
  const [v, setV] = useState(initial);
  const prefix = initial.id ?? "nueva";
  const toggle = (id: string) =>
    setV((s) => {
      const has = s.departmentIds.includes(id);
      const departmentIds = has ? s.departmentIds.filter((d) => d !== id) : [...s.departmentIds, id];
      return { ...s, departmentIds, defaultDepartmentId: has && s.defaultDepartmentId === id ? null : s.defaultDepartmentId };
    });
  return (
    <form
      aria-label={initial.id ? `Editar categoría ${initial.name}` : "Nueva categoría"}
      className="flex flex-col gap-3 rounded-lg border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => saveCaseCategory(v),
          () => {
            onDone();
            router.refresh();
          },
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`cat-name-${prefix}`}>Nombre de la categoría</Label>
          <Input id={`cat-name-${prefix}`} required minLength={2} maxLength={80} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`cat-desc-${prefix}`}>Descripción (opcional)</Label>
          <Input id={`cat-desc-${prefix}`} maxLength={300} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
        </div>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Dependencias que pueden atenderla</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {departments.map((d) => (
            <label key={d.id} className="inline-flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={v.departmentIds.includes(d.id)} onChange={() => toggle(d.id)} />
              {d.name}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`cat-default-${prefix}`}>Dependencia sugerida</Label>
          <select
            id={`cat-default-${prefix}`}
            className="h-8 rounded-lg border bg-transparent px-2 text-sm"
            value={v.defaultDepartmentId ?? ""}
            onChange={(e) => setV({ ...v, defaultDepartmentId: e.target.value || null })}
          >
            <option value="">Ninguna</option>
            {departments
              .filter((d) => v.departmentIds.includes(d.id))
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </select>
        </div>
        <label className="inline-flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />
          Activa
        </label>
        <Button type="submit" size="sm" disabled={pending}>
          {initial.id ? "Guardar" : "Agregar categoría"}
        </Button>
        {initial.id && (
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );
}

/** Case categories with their capable departments. Deactivated, never deleted (cases keep their category). */
export function CategoriesCatalog({ categories, departments }: { categories: CaseCategory[]; departments: Department[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const names = new Map(departments.map((d) => [d.id, d.name]));
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col divide-y rounded-lg border" aria-label="Categorías de caso">
        {categories.length === 0 && <li className="p-3 text-sm text-muted-foreground">Sin categorías.</li>}
        {categories.map((c) =>
          editing === c.id ? (
            <li key={c.id} className="p-2">
              <CategoryForm initial={c} departments={departments} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <li key={c.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">
                  {c.name}
                  {!c.active && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">Inactiva</span>}
                </span>
                <span className="text-xs text-muted-foreground">
                  {c.departmentIds.length ? c.departmentIds.map((d) => names.get(d) ?? "—").join(", ") : "Sin dependencia que la atienda"}
                  {c.defaultDepartmentId && ` · sugerida: ${names.get(c.defaultDepartmentId) ?? "—"}`}
                </span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setEditing(c.id)} aria-label={`Editar ${c.name}`}>
                Editar
              </Button>
            </li>
          ),
        )}
      </ul>
      <CategoryForm key={formKey} initial={EMPTY} departments={departments} onDone={() => setFormKey((k) => k + 1)} />
    </div>
  );
}
