"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveMonitorSettings } from "@/lib/health/actions";
import type { HealthSnapshot } from "@/lib/health/model";

/** Classifier and dashboard thresholds of the municipality (the per-source ones live with each source). */
export function MonitorSettingsForm({ settings }: { settings: HealthSnapshot["settings"] }) {
  const [backlog, setBacklog] = useState(String(settings.classify_backlog_minutes));
  const [stale, setStale] = useState(String(settings.classify_stale_minutes));
  const [dashboard, setDashboard] = useState(String(settings.dashboard_stale_minutes));
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await saveMonitorSettings({ classifyBacklogMinutes: backlog, classifyStaleMinutes: stale, dashboardStaleMinutes: dashboard });
          (result.ok ? toast.success : toast.error)(result.message);
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ms-backlog">Rezago de clasificación (min)</Label>
          <Input id="ms-backlog" type="number" min={5} max={1440} value={backlog} onChange={(e) => setBacklog(e.target.value)} required />
          <span className="text-xs text-muted-foreground">Antigüedad máxima de la mención pendiente más vieja.</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ms-stale">Clasificador detenido (min)</Label>
          <Input id="ms-stale" type="number" min={5} max={1440} value={stale} onChange={(e) => setStale(e.target.value)} required />
          <span className="text-xs text-muted-foreground">Sin corridas este tiempo mientras hay pendientes. Corre cada 5 min.</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ms-dashboard">Dashboard desactualizado (min)</Label>
          <Input id="ms-dashboard" type="number" min={5} max={1440} value={dashboard} onChange={(e) => setDashboard(e.target.value)} required />
          <span className="text-xs text-muted-foreground">Sin reconstruirse mientras hay clasificaciones nuevas.</span>
        </div>
      </div>
      <Button type="submit" size="sm" className="self-start" disabled={pending}>
        {pending ? "Guardando…" : "Guardar umbrales"}
      </Button>
    </form>
  );
}
