"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { History, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SentimentBadge } from "@/components/ui-kit";
import { previewQuery, saveQueryVersion, type PreviewResult } from "@/lib/projects/actions";
import type { QueryVersion } from "@/lib/projects/data";
import {
  buildExpression,
  EMPTY_BUILDER,
  GROUP_LABELS,
  type GroupMode,
  type QueryBuilderState,
} from "@/lib/query/builder";
import { validateQuery } from "@/lib/query/match";
import { cn } from "@/lib/utils";
import { TermInput } from "./term-input";

const MODES: GroupMode[] = ["any", "all", "none"];
const dateTime = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" });
const dateOnly = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" });

const PLACEHOLDERS: Record<GroupMode, string> = {
  any: "San Andrés, #SanAndrés, ayuntamiento…",
  all: "agua, colonia Centro…",
  none: "San Andrés Tuxtla, pipa*…",
};

export function QueryBuilder({
  projectId,
  lineageId,
  initialName,
  versions,
}: {
  projectId: string;
  /** Null for a brand-new query. */
  lineageId: string | null;
  initialName: string;
  /** Newest first. */
  versions: QueryVersion[];
}) {
  const router = useRouter();
  const active = versions.find((v) => v.isActive) ?? null;
  const [name, setName] = useState(initialName);
  const [state, setState] = useState<QueryBuilderState>(active?.builder ?? EMPTY_BUILDER);
  const [saving, startSaving] = useTransition();

  const built = useMemo(() => buildExpression(state), [state]);
  const syntax = built.ok ? validateQuery(built.expression) : null;
  const expression = built.ok && syntax?.ok ? built.expression : null;
  const unchanged =
    active != null && expression === active.expression && name.trim() === active.name;

  // Live preview against existing mentions, debounced; stale answers are ignored.
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const requestId = useRef(0);
  useEffect(() => {
    if (!expression) return;
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      setPreviewing(true);
      const result = await previewQuery(expression);
      if (id !== requestId.current) return;
      setPreviewing(false);
      if (result.ok) setPreview(result.data);
      else toast.error(result.message);
    }, 400);
    return () => clearTimeout(timer);
  }, [expression]);

  const setGroup = (index: number, patch: Partial<QueryBuilderState["groups"][number]>) =>
    setState((s) => ({ groups: s.groups.map((g, i) => (i === index ? { ...g, ...patch } : g)) }));

  function save() {
    startSaving(async () => {
      const result = await saveQueryVersion({ projectId, lineageId, name, builder: state });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(`Consulta guardada como versión ${result.data.version}.`);
      if (!lineageId) router.replace(`/configuracion/proyectos/${projectId}?consulta=${result.data.lineageId}`);
      else router.refresh();
    });
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Label htmlFor="query-name">Nombre de la consulta</Label>
          <Input id="query-name" value={name} onChange={(e) => setName(e.target.value)} className="max-w-sm" />
        </div>

        <ol className="flex flex-col gap-3">
          {state.groups.map((group, index) => (
            <li
              key={index}
              className={cn(
                "flex flex-col gap-2 rounded-xl border p-3",
                group.mode === "none" && "border-negative/30 bg-negative/5",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {index > 0 && <span className="text-xs font-semibold text-muted-foreground">Y</span>}
                  <Select
                    value={group.mode}
                    onValueChange={(mode) => setGroup(index, { mode: mode as GroupMode })}
                  >
                    <SelectTrigger size="sm" className="w-52" aria-label={`Tipo del grupo ${index + 1}`}>
                      <SelectValue>{(mode: GroupMode) => GROUP_LABELS[mode]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {MODES.map((mode) => (
                        <SelectItem key={mode} value={mode}>
                          {GROUP_LABELS[mode]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Quitar grupo ${index + 1}`}
                  onClick={() => setState((s) => ({ groups: s.groups.filter((_, i) => i !== index) }))}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
              <TermInput
                terms={group.terms}
                onChange={(terms) => setGroup(index, { terms })}
                placeholder={PLACEHOLDERS[group.mode]}
                label={`Términos del grupo ${index + 1}`}
                tone={group.mode === "none" ? "exclude" : "include"}
              />
            </li>
          ))}
        </ol>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setState((s) => ({ groups: [...s.groups, { mode: "any", terms: [] }] }))}
            disabled={state.groups.length >= 20}
          >
            <Plus aria-hidden /> Agregar grupo
          </Button>
          <p className="text-xs text-muted-foreground">
            Varias palabras en un término buscan esa frase exacta. <code>*</code> completa palabras
            (<code>educa*</code>). No importan acentos ni mayúsculas.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Expresión generada</Label>
          <pre
            aria-live="polite"
            className={cn(
              "rounded-lg border bg-muted/50 p-3 font-mono text-sm whitespace-pre-wrap break-words",
              !expression && "text-muted-foreground",
            )}
          >
            {built.ok ? built.expression : built.message}
          </pre>
          {built.ok && syntax && !syntax.ok && <p className="text-sm text-destructive">{syntax.message}</p>}
        </div>

        <div className="flex items-center justify-end gap-3">
          {unchanged && <span className="text-sm text-muted-foreground">Sin cambios respecto a la versión activa.</span>}
          <Button type="button" onClick={save} disabled={!expression || unchanged || saving}>
            <Save aria-hidden />
            {saving
              ? "Guardando…"
              : lineageId
                ? `Guardar como versión ${(versions[0]?.version ?? 0) + 1}`
                : "Guardar consulta"}
          </Button>
        </div>

        {versions.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <History className="size-4" aria-hidden /> Versiones
            </h3>
            <ul className="flex flex-col divide-y rounded-xl border">
              {versions.map((v) => (
                <li key={v.id} className="flex flex-col gap-1 p-3 text-sm sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="font-medium">
                      v{v.version} {v.isActive && <span className="ml-1 rounded bg-positive/12 px-1.5 py-0.5 text-xs text-positive">activa</span>}
                      <span className="ml-2 font-normal text-muted-foreground">{dateTime.format(new Date(v.createdAt))}</span>
                    </span>
                    <code className="truncate text-xs text-muted-foreground" title={v.expression}>
                      {v.expression}
                    </code>
                  </div>
                  {!v.isActive && v.builder && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setState(v.builder!);
                        toast.info(`Versión ${v.version} cargada en el editor. Guárdala para activarla.`);
                      }}
                    >
                      <RotateCcw aria-hidden /> Cargar
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <aside className="flex flex-col gap-3 xl:sticky xl:top-20 xl:self-start" aria-label="Vista previa">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-medium">Vista previa</h3>
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {previewing
              ? "Buscando…"
              : preview && expression
                ? `${preview.matched} de ${preview.scanned} menciones`
                : ""}
          </span>
        </div>
        {!expression || !preview ? (
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            Agrega términos para ver qué menciones existentes coinciden.
          </p>
        ) : preview.matched === 0 ? (
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            Ninguna mención existente coincide con esta consulta.
          </p>
        ) : (
          <ul
            className={cn(
              "flex flex-col gap-2 transition-opacity xl:max-h-[calc(100svh-10rem)] xl:overflow-y-auto xl:pr-1",
              previewing && "opacity-60",
            )}
          >
            {preview.sample.map((m) => (
              <li key={m.id} className="flex flex-col gap-1.5 rounded-xl border p-3 text-sm">
                <p>{m.text}</p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {m.sentiment && <SentimentBadge sentiment={m.sentiment} />}
                  <span>{dateOnly.format(new Date(m.publishedAt))}</span>
                </div>
              </li>
            ))}
            {preview.matched > preview.sample.length && (
              <li className="text-center text-xs text-muted-foreground">
                y {preview.matched - preview.sample.length} más
              </li>
            )}
          </ul>
        )}
      </aside>
    </div>
  );
}
