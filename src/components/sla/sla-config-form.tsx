"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PRIORITIES, PRIORITY_LABELS, type Priority } from "@/lib/inbox/model";
import { saveSlaConfig } from "@/lib/sla/actions";
import { SLA_MODE_LABELS, slaProblem, WEEKDAYS, type SlaCalendar, type SlaHoliday, type SlaMode, type SlaTarget } from "@/lib/sla/model";

/**
 * Calendar, non-working days and acceptance/attention targets (general per
 * priority, optional per category). Saving makes a new version that stays a
 * reference value until an admin approves it.
 */
export function SlaConfigForm({
  calendar: initialCalendar,
  holidays: initialHolidays,
  targets: initialTargets,
  topics,
}: {
  calendar: SlaCalendar;
  holidays: SlaHoliday[];
  targets: SlaTarget[];
  topics: string[];
}) {
  const router = useRouter();
  const [calendar, setCalendar] = useState(initialCalendar);
  const [holidays, setHolidays] = useState(initialHolidays);
  const [targets, setTargets] = useState(() =>
    [...initialTargets].sort((a, b) => (a.category ?? "").localeCompare(b.category ?? "") || PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority)),
  );
  const [newDay, setNewDay] = useState({ day: "", name: "" });
  const [newCategory, setNewCategory] = useState("");
  const [pending, startTransition] = useTransition();
  const problem = slaProblem(calendar, targets);

  const setTarget = (i: number, patch: Partial<SlaTarget>) => setTargets(targets.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  function addCategory() {
    const category = newCategory.trim();
    if (!category || targets.some((t) => t.category === category)) return;
    const general = (p: Priority) => targets.find((t) => t.category === null && t.priority === p)!;
    setTargets([...targets, ...PRIORITIES.map((p) => ({ ...general(p), category }))]);
    setNewCategory("");
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (problem) return toast.error(problem);
    startTransition(async () => {
      const result = await saveSlaConfig({ calendar, holidays, targets });
      if (!result.ok) return void toast.error(result.message);
      toast.success(result.message);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" aria-label="Configuración del SLA">
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 font-medium">Cómo se cuentan las horas</legend>
        <div role="radiogroup" aria-label="Tipo de horas" className="flex flex-wrap gap-4 text-sm">
          {(Object.keys(SLA_MODE_LABELS) as SlaMode[]).map((m) => (
            <label key={m} className="inline-flex items-center gap-2">
              <input type="radio" name="sla-mode" checked={calendar.mode === m} onChange={() => setCalendar({ ...calendar, mode: m })} />
              {SLA_MODE_LABELS[m]}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Zona horaria: Ciudad de México. Con horas hábiles sólo cuenta el horario de días hábiles que no estén marcados como inhábiles.
        </p>
        {calendar.mode === "business" && (
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm">Días hábiles</span>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((d) => (
                  <label key={d.value} className="inline-flex items-center gap-1 text-sm">
                    <input
                      type="checkbox"
                      checked={calendar.workdays.includes(d.value)}
                      onChange={(e) =>
                        setCalendar({
                          ...calendar,
                          workdays: e.target.checked ? [...calendar.workdays, d.value].sort() : calendar.workdays.filter((x) => x !== d.value),
                        })
                      }
                    />
                    {d.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sla-start">Abre</Label>
              <Input id="sla-start" type="time" value={calendar.day_start} onChange={(e) => setCalendar({ ...calendar, day_start: e.target.value })} className="w-32" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sla-end">Cierra</Label>
              <Input id="sla-end" type="time" value={calendar.day_end} onChange={(e) => setCalendar({ ...calendar, day_end: e.target.value })} className="w-32" />
            </div>
          </div>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">Días inhábiles</legend>
        {holidays.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm" aria-label="Días inhábiles">
            {holidays.map((h) => (
              <li key={h.day} className="flex items-center gap-2">
                <span className="font-mono text-xs">{h.day}</span> {h.name}
                <button type="button" className="text-muted-foreground hover:text-foreground" aria-label={`Quitar ${h.name}`} onClick={() => setHolidays(holidays.filter((x) => x.day !== h.day))}>
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <Input type="date" aria-label="Fecha inhábil" value={newDay.day} onChange={(e) => setNewDay({ ...newDay, day: e.target.value })} className="w-44" />
          <Input aria-label="Nombre del día inhábil" placeholder="Día de Muertos" value={newDay.name} onChange={(e) => setNewDay({ ...newDay, name: e.target.value })} className="w-56" maxLength={80} />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!newDay.day || newDay.name.trim().length < 2}
            onClick={() => {
              setHolidays([...holidays.filter((h) => h.day !== newDay.day), { day: newDay.day, name: newDay.name.trim() }].sort((a, b) => a.day.localeCompare(b.day)));
              setNewDay({ day: "", name: "" });
            }}
          >
            <Plus className="size-4" aria-hidden /> Agregar
          </Button>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">Plazos (horas {calendar.mode === "business" ? "hábiles" : "corridas"})</legend>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm" aria-label="Plazos por categoría y prioridad">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1 pr-2 font-normal">Categoría</th>
                <th className="py-1 pr-2 font-normal">Prioridad</th>
                <th className="py-1 pr-2 font-normal">Aceptación</th>
                <th className="py-1 pr-2 font-normal">Atención</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {targets.map((t, i) => (
                <tr key={`${t.category ?? ""}-${t.priority}`} className="border-t">
                  <td className="py-1 pr-2">{t.category ?? "General"}</td>
                  <td className="py-1 pr-2">{PRIORITY_LABELS[t.priority]}</td>
                  <td className="py-1 pr-2">
                    <Input
                      type="number"
                      min={0.25}
                      step={0.25}
                      aria-label={`Aceptación ${t.category ?? "general"} ${PRIORITY_LABELS[t.priority]}`}
                      value={t.accept_hours}
                      onChange={(e) => setTarget(i, { accept_hours: Number(e.target.value) })}
                      className="w-24"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      type="number"
                      min={0.25}
                      step={0.25}
                      aria-label={`Atención ${t.category ?? "general"} ${PRIORITY_LABELS[t.priority]}`}
                      value={t.attention_hours}
                      onChange={(e) => setTarget(i, { attention_hours: Number(e.target.value) })}
                      className="w-24"
                    />
                  </td>
                  <td>
                    {t.category && (
                      <button type="button" className="text-muted-foreground hover:text-foreground" aria-label={`Quitar ${t.category} ${PRIORITY_LABELS[t.priority]}`} onClick={() => setTargets(targets.filter((_, j) => j !== i))}>
                        <X className="size-3.5" aria-hidden />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Input list="sla-topics" aria-label="Categoría con plazos propios" placeholder="Categoría (tema)" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} className="w-56" maxLength={80} />
          <datalist id="sla-topics">
            {topics.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <Button type="button" size="sm" variant="outline" onClick={addCategory} disabled={!newCategory.trim()}>
            <Plus className="size-4" aria-hidden /> Plazos para una categoría
          </Button>
        </div>
      </fieldset>

      {problem && <p className="text-sm text-negative">{problem}</p>}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || Boolean(problem)}>
          {pending ? "Guardando…" : "Guardar como nueva versión"}
        </Button>
      </div>
    </form>
  );
}
