"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { History, RefreshCw, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui-kit";
import { saveSourceThresholds } from "@/lib/health/actions";
import { COVERAGE_LABEL, formatCdmx, formatDuration, type SourceHealth, type SourceSnapshot } from "@/lib/health/model";
import { runSourceNow } from "@/lib/sources/actions";
import { cn } from "@/lib/utils";
import { StatusBadge, TONE_BORDER } from "./status-badge";

const TYPE_LABEL: Record<string, string> = { rss: "RSS", meta: "Facebook", youtube: "YouTube", x: "X" };
const nf = new Intl.NumberFormat("es-MX");

export type SourceRow = { source: SourceSnapshot; health: SourceHealth };

/** One card per source: state and why, timing, last run counters, coverage and the next step. */
export function SourcesHealth({ rows, highlight }: { rows: SourceRow[]; highlight: string | null }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<SourceSnapshot | null>(null);
  const [, startTransition] = useTransition();

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<RefreshCw />}
        title="Sin fuentes"
        description="Conecta un feed, una página o un canal en Configuración → Fuentes para empezar a escuchar."
        action={
          <Link href="/configuracion/fuentes" className={buttonVariants({ variant: "outline" })}>
            Ir a Fuentes
          </Link>
        }
      />
    );
  }

  function retry(id: string) {
    setBusy(id);
    startTransition(async () => {
      const result = await runSourceNow(id);
      setBusy(null);
      (result.ok ? toast.success : toast.error)(result.message);
    });
  }

  return (
    <>
      <ul className="flex flex-col gap-3">
        {rows.map(({ source: s, health: h }) => {
          const run = s.last_run;
          const canRetry = s.is_active && h.state !== "unavailable";
          return (
            <li
              key={s.id}
              id={`fuente-${s.id}`}
              className={cn("flex flex-col gap-3 rounded-xl border p-4", TONE_BORDER[h.tone], highlight === s.id && "ring-2 ring-ring")}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium">{s.name}</h3>
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{TYPE_LABEL[s.type] ?? s.type}</span>
                    <StatusBadge tone={h.tone}>{h.label}</StatusBadge>
                    {s.running && <StatusBadge tone="info">Leyéndose ahora</StatusBadge>}
                  </div>
                  <p className="text-sm text-muted-foreground">{h.reason}</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {h.action?.kind === "edit" && (
                    <Link href={h.action.href} className={buttonVariants({ variant: "outline", size: "sm" })}>
                      {h.action.label}
                    </Link>
                  )}
                  <Button variant="outline" size="sm" disabled={!canRetry || busy !== null || s.running} onClick={() => retry(s.id)}>
                    <RefreshCw aria-hidden className={cn(busy === s.id && "animate-spin")} />
                    {busy === s.id ? "Leyendo…" : "Reintentar ahora"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                    <SlidersHorizontal aria-hidden /> Umbrales
                  </Button>
                  <Link href={`/salud?fuente=${s.id}#corridas`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                    <History aria-hidden /> Corridas
                  </Link>
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
                <Fact label="Último intento" value={s.last_run_at ? formatCdmx(s.last_run_at) : "Nunca"} />
                <Fact label="Último éxito" value={s.last_success_at ? formatCdmx(s.last_success_at) : "Nunca"} />
                <Fact
                  label="Atraso"
                  value={h.lagMinutes === null ? "Desconocido" : formatDuration(h.lagMinutes)}
                  hint={`Umbral: ${formatDuration(s.stale_after_minutes ?? s.expected_every_minutes * 3)}`}
                />
                <Fact label="Próximo intento" value={h.nextAttemptAt ? formatCdmx(h.nextAttemptAt) : "No programado"} hint={`Cada ${formatDuration(s.expected_every_minutes)}`} />
                <Fact label="Errores seguidos" value={nf.format(s.consecutive_failures)} />
                <Fact label="Cobertura" value={COVERAGE_LABEL[h.coverage]} hint={h.coverageReason ?? undefined} />
              </dl>

              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                {run ? (
                  <span>
                    Última corrida ({run.trigger === "cron" ? "programada" : "manual"}, {formatCdmx(run.started_at)}): capturadas {nf.format(run.fetched)} ·
                    nuevas {nf.format(run.inserted)} · duplicadas {nf.format(run.duplicates)} · sin consulta {nf.format(run.unmatched)} · interacciones
                    actualizadas {nf.format(run.updated)}
                  </span>
                ) : (
                  <span>Sin corridas registradas.</span>
                )}
                {s.day && s.day.runs > 0 && (
                  <span>
                    24 h: {s.day.runs} corridas ({s.day.errors} con error, {s.day.partial} parciales) · {nf.format(s.day.inserted)} nuevas
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>{editing && <ThresholdsForm source={editing} onClose={() => setEditing(null)} />}</DialogContent>
      </Dialog>
    </>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate" title={hint ? `${value} · ${hint}` : value}>
        {value}
      </dd>
      {hint && <dd className="truncate text-xs text-muted-foreground">{hint}</dd>}
    </div>
  );
}

function ThresholdsForm({ source, onClose }: { source: SourceSnapshot; onClose: () => void }) {
  const [every, setEvery] = useState(String(source.expected_every_minutes));
  const [stale, setStale] = useState(source.stale_after_minutes ? String(source.stale_after_minutes) : "");
  const [quiet, setQuiet] = useState(String(source.quiet_after_hours));
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await saveSourceThresholds({
            sourceId: source.id,
            expectedEveryMinutes: every,
            staleAfterMinutes: stale === "" ? null : stale,
            quietAfterHours: quiet,
          });
          (result.ok ? toast.success : toast.error)(result.message);
          if (result.ok) onClose();
        });
      }}
    >
      <DialogHeader>
        <DialogTitle>Umbrales de {source.name}</DialogTitle>
        <DialogDescription>Ajusta qué cuenta como atraso o como silencio normal para esta fuente.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="th-every">Leer cada (minutos)</Label>
          <Input id="th-every" type="number" min={15} max={10080} value={every} onChange={(e) => setEvery(e.target.value)} required />
          <span className="text-xs text-muted-foreground">La ingesta corre cada hora; una fuente cada 360 min se lee 4 veces al día.</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="th-stale">Atrasada después de (minutos)</Label>
          <Input id="th-stale" type="number" min={15} max={43200} value={stale} placeholder={`${Number(every) * 3 || 180} (3 × frecuencia)`} onChange={(e) => setStale(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="th-quiet">Sin publicaciones es normal hasta (horas)</Label>
          <Input id="th-quiet" type="number" min={1} max={2160} value={quiet} onChange={(e) => setQuiet(e.target.value)} required />
          <span className="text-xs text-muted-foreground">Después se muestra como “sin publicaciones nuevas”, no como error.</span>
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : "Guardar"}
        </Button>
      </DialogFooter>
    </form>
  );
}
