"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveProject } from "@/lib/projects/actions";
import type { Kpi, Territory } from "@/lib/projects/schema";

type KpiRow = { name: string; target: string; unit: string };

export type ProjectFormValues = { name: string; goal: string; kpis: Kpi[]; territory: Territory };

export function ProjectForm({
  projectId,
  initial,
  neighborhoods,
}: {
  projectId: string | null;
  initial: ProjectFormValues;
  neighborhoods: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(initial.name);
  const [goal, setGoal] = useState(initial.goal);
  const [kpis, setKpis] = useState<KpiRow[]>(
    initial.kpis.map((k) => ({ name: k.name, target: k.target == null ? "" : String(k.target), unit: k.unit })),
  );
  const [scope, setScope] = useState<Territory["scope"]>(initial.territory.scope);
  const [selected, setSelected] = useState<string[]>(
    initial.territory.scope === "neighborhoods" ? initial.territory.neighborhoodIds : [],
  );
  const [notes, setNotes] = useState(initial.territory.notes);

  const updateKpi = (index: number, patch: Partial<KpiRow>) =>
    setKpis((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const territory: Territory =
      scope === "municipality" ? { scope, notes } : { scope, neighborhoodIds: selected, notes };
    const payload = {
      name,
      goal,
      kpis: kpis
        .filter((k) => k.name.trim())
        .map((k) => ({ name: k.name, target: k.target.trim() === "" ? null : Number(k.target), unit: k.unit })),
      territory,
    };
    if (payload.kpis.some((k) => k.target != null && !Number.isFinite(k.target))) {
      toast.error("La meta de cada KPI debe ser un número.");
      return;
    }
    startTransition(async () => {
      const result = await saveProject(projectId, payload);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(projectId ? "Proyecto actualizado." : "Proyecto creado. Ahora arma su consulta.");
      if (!projectId) router.push(`/configuracion/proyectos/${result.data.id}`);
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="project-name">Nombre</Label>
          <Input
            id="project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Escucha ciudadana 2026"
            required
          />
        </div>
        <div className="flex flex-col gap-2 md:row-span-2">
          <Label htmlFor="project-goal">Objetivo</Label>
          <Textarea
            id="project-goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="¿Qué se quiere saber o mejorar con este monitoreo?"
            className="min-h-24"
          />
        </div>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">KPIs</legend>
        {kpis.length === 0 && <p className="text-sm text-muted-foreground">Sin indicadores todavía.</p>}
        {kpis.map((kpi, index) => (
          <div key={index} className="grid grid-cols-[1fr_7rem_6rem_auto] items-center gap-2">
            <Input
              aria-label={`Nombre del KPI ${index + 1}`}
              value={kpi.name}
              onChange={(e) => updateKpi(index, { name: e.target.value })}
              placeholder="Tiempo de respuesta"
            />
            <Input
              aria-label={`Meta del KPI ${index + 1}`}
              inputMode="decimal"
              value={kpi.target}
              onChange={(e) => updateKpi(index, { target: e.target.value })}
              placeholder="Meta"
            />
            <Input
              aria-label={`Unidad del KPI ${index + 1}`}
              value={kpi.unit}
              onChange={(e) => updateKpi(index, { unit: e.target.value })}
              placeholder="horas"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Quitar KPI ${index + 1}`}
              onClick={() => setKpis((rows) => rows.filter((_, i) => i !== index))}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setKpis((rows) => [...rows, { name: "", target: "", unit: "" }])}
            disabled={kpis.length >= 12}
          >
            <Plus aria-hidden /> Agregar KPI
          </Button>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">Territorio</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="scope"
              checked={scope === "municipality"}
              onChange={() => setScope("municipality")}
              className="accent-primary"
            />
            Todo el municipio
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="scope"
              checked={scope === "neighborhoods"}
              onChange={() => setScope("neighborhoods")}
              className="accent-primary"
            />
            Colonias específicas
          </label>
        </div>
        {scope === "neighborhoods" &&
          (neighborhoods.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay colonias en el catálogo. Un administrador puede cargarlas en Catálogos.
            </p>
          ) : (
            <div className="grid max-h-56 gap-2 overflow-y-auto rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-3">
              {neighborhoods.map((n) => (
                <label key={n.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={selected.includes(n.id)}
                    onCheckedChange={(checked) =>
                      setSelected((ids) => (checked ? [...ids, n.id] : ids.filter((id) => id !== n.id)))
                    }
                  />
                  {n.name}
                </label>
              ))}
            </div>
          ))}
        <div className="flex flex-col gap-2">
          <Label htmlFor="territory-notes">Notas del territorio</Label>
          <Input
            id="territory-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ej. incluye la zona industrial y los accesos carreteros"
          />
        </div>
      </fieldset>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : projectId ? "Guardar ficha" : "Crear proyecto"}
        </Button>
      </div>
    </form>
  );
}
