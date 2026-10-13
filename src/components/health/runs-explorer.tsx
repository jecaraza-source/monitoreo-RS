"use client";

import { useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, History } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui-kit";
import { OptionSelect } from "@/components/inbox/option-select";
import type { RunDetail } from "@/lib/health/data";
import { actionForError, formatCdmx } from "@/lib/health/model";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./status-badge";

const STATUS = { ok: { label: "Correcta", tone: "ok" }, partial: { label: "Parcial", tone: "warn" }, error: { label: "Error", tone: "error" } } as const;
const nf = new Intl.NumberFormat("es-MX");

/** Run log with filters in the URL (shareable, server-rendered) and the detail of each run. */
export function RunsExplorer({
  runs,
  more,
  sources,
}: {
  runs: RunDetail[];
  more: boolean;
  sources: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [loading, startTransition] = useTransition();

  function set(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("ver");
    startTransition(() => router.replace(`${pathname}?${next}#corridas`, { scroll: false }));
  }
  const moreHref = (() => {
    const next = new URLSearchParams(params);
    next.set("ver", String(runs.length + 50));
    return `${pathname}?${next}#corridas`;
  })();
  const filtered = ["fuente", "estado", "origen"].some((k) => params.get(k)) || (params.get("periodo") ?? "7d") !== "7d";

  return (
    <div className="flex flex-col gap-3" aria-busy={loading}>
      <div className="flex flex-wrap gap-2">
        <OptionSelect label="Fuente" value={params.get("fuente")} onChange={(v) => set("fuente", v)} emptyLabel="Todas las fuentes" options={sources.map((s) => ({ value: s.id, label: s.name }))} />
        <OptionSelect
          label="Resultado"
          value={params.get("estado")}
          onChange={(v) => set("estado", v)}
          emptyLabel="Todo resultado"
          options={[
            { value: "ok", label: "Correctas" },
            { value: "partial", label: "Parciales" },
            { value: "error", label: "Con error" },
          ]}
        />
        <OptionSelect
          label="Origen"
          value={params.get("origen")}
          onChange={(v) => set("origen", v)}
          emptyLabel="Programadas y manuales"
          options={[
            { value: "cron", label: "Programadas" },
            { value: "manual", label: "Manuales" },
          ]}
        />
        <OptionSelect
          label="Periodo"
          value={params.get("periodo") ?? "7d"}
          onChange={(v) => set("periodo", v ?? "7d")}
          options={[
            { value: "24h", label: "Últimas 24 h" },
            { value: "7d", label: "Últimos 7 días" },
            { value: "30d", label: "Últimos 30 días" },
          ]}
        />
      </div>

      {runs.length === 0 ? (
        <EmptyState
          icon={<History />}
          title={filtered ? "Sin corridas con estos filtros" : "Todavía no hay corridas"}
          description={filtered ? "Quita algún filtro o amplía el periodo." : "La ingesta corre cada hora; también puedes leer una fuente con “Reintentar ahora”."}
        />
      ) : (
        <ul className={cn("flex flex-col divide-y rounded-xl border", loading && "opacity-60")}>
          {runs.map((r) => {
            const status = STATUS[r.status];
            const action = r.status === "error" ? actionForError(r.error, r.sourceType) : null;
            return (
              <li key={r.id}>
                <details className="group">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
                    <span className="w-36 shrink-0 text-muted-foreground tabular-nums">{formatCdmx(r.startedAt)}</span>
                    <span className="min-w-32 flex-1 font-medium">{r.sourceName}</span>
                    <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                    <span className="text-muted-foreground">{r.trigger === "cron" ? "Programada" : "Manual"}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {nf.format(r.fetched)} capturadas · <span className="font-medium text-foreground">{nf.format(r.inserted)}</span> nuevas
                    </span>
                  </summary>
                  <div className="grid gap-3 border-t bg-muted/30 px-4 py-3 text-sm sm:grid-cols-2">
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                      <dt className="text-muted-foreground">Capturadas</dt>
                      <dd className="tabular-nums">{nf.format(r.fetched)}</dd>
                      <dt className="text-muted-foreground">Nuevas</dt>
                      <dd className="tabular-nums">{nf.format(r.inserted)}</dd>
                      <dt className="text-muted-foreground">Duplicadas</dt>
                      <dd className="tabular-nums">{nf.format(r.duplicates)}</dd>
                      <dt className="text-muted-foreground">Sin consulta que coincida</dt>
                      <dd className="tabular-nums">{nf.format(r.unmatched)}</dd>
                      <dt className="text-muted-foreground">Interacciones actualizadas</dt>
                      <dd className="tabular-nums">{nf.format(r.updated)}</dd>
                      <dt className="text-muted-foreground">Duración</dt>
                      <dd className="tabular-nums">{Math.max(0, Math.round((Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000))} s</dd>
                    </dl>
                    <div className="flex flex-col gap-1.5">
                      {r.windowFrom && r.windowTo && (
                        <p>
                          Ventana: {formatCdmx(r.windowFrom)} → {formatCdmx(r.windowTo)}
                          {r.complete === false ? " (no se leyó completa; continúa en la siguiente)" : r.complete ? " (completa)" : ""}
                        </p>
                      )}
                      {r.coveredUntil && <p>Leído hasta después de la corrida: {formatCdmx(r.coveredUntil)}</p>}
                      {r.limits.map((l, i) => (
                        <p key={i} className="text-muted-foreground">
                          {l.detail}
                        </p>
                      ))}
                      {r.gap && (
                        <p className="text-negative">
                          Sin cobertura recuperable del {formatCdmx(r.gap.from)} al {formatCdmx(r.gap.to)}.
                        </p>
                      )}
                      {r.error && <p className="text-negative">{r.error}</p>}
                      {action && (
                        <p>
                          Siguiente paso:{" "}
                          {action.kind === "edit" ? (
                            <Link className="underline underline-offset-2" href={action.href}>
                              {action.label}
                            </Link>
                          ) : action.kind === "retry" ? (
                            <Link className="underline underline-offset-2" href={`/salud#fuente-${r.sourceId}`}>
                              {action.label} desde la fuente
                            </Link>
                          ) : (
                            action.label
                          )}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">Corrida {r.runId ?? r.id}</p>
                    </div>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
      {more && (
        <Link href={moreHref} scroll={false} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "self-center")}>
          Ver más corridas
        </Link>
      )}
    </div>
  );
}
