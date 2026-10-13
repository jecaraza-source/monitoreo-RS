"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MapPin } from "lucide-react";
import { toast } from "sonner";
import { formatDateTime } from "@/components/inbox/format";
import { OptionSelect } from "@/components/inbox/option-select";
import { StatusBadge } from "@/components/health/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { clearCaseLocation, setCaseLocation } from "@/lib/cases/actions";
import type { CaseLocationEvent } from "@/lib/cases/data";
import { LOCATION_LABELS, LOCATION_SOURCE_LABELS } from "@/lib/map/cases";

export type CaseLocationState = {
  status: "confirmed" | "inferred" | "unavailable";
  source: string;
  confidence: number | null;
  neighborhoodId: string | null;
  lat: number | null;
  lng: number | null;
};

const TONE = { confirmed: "ok", inferred: "info", unavailable: "muted" } as const;
const percent = (v: number | null) => (v === null ? "" : ` · confianza ${Math.round(v * 100)} %`);

/**
 * The location of the case: confirmed (an analyst), inferred (from the
 * colonia captured or classified, never a point) or unavailable. Coordinators
 * confirm, correct or remove it with a reason; every change stays in the history.
 */
export function CaseLocation({
  caseId,
  location,
  history,
  neighborhoods,
  canEdit,
}: {
  caseId: string;
  location: CaseLocationState;
  history: CaseLocationEvent[];
  neighborhoods: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const [dialog, setDialog] = useState<"set" | "clear" | null>(null);
  const names = Object.fromEntries(neighborhoods.map((n) => [n.id, n.name]));
  const colonia = location.neighborhoodId ? (names[location.neighborhoodId] ?? "Colonia") : null;

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={TONE[location.status]}>
          <MapPin aria-hidden className="size-3" /> {LOCATION_LABELS[location.status]}
        </StatusBadge>
        <span className="text-muted-foreground">
          {colonia ?? "Sin colonia"} · {LOCATION_SOURCE_LABELS[location.source] ?? location.source}
          {location.status !== "unavailable" && percent(location.confidence)}
        </span>
      </div>
      {location.status === "inferred" && (
        <p className="text-xs text-muted-foreground">Inferida: cuenta en su colonia, pero no es un punto exacto y no aparece como punto en el mapa.</p>
      )}
      {location.status === "confirmed" && location.lat !== null && location.lng !== null && (
        <p className="text-xs text-muted-foreground tabular-nums">
          Punto: {location.lat.toFixed(5)}, {location.lng.toFixed(5)} (en el mapa ejecutivo se redondea a ~100 m)
        </p>
      )}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setDialog("set")}>
            {location.status === "confirmed" ? "Corregir ubicación" : "Confirmar ubicación"}
          </Button>
          {location.status !== "unavailable" && (
            <Button size="sm" variant="ghost" onClick={() => setDialog("clear")}>
              Quitar ubicación
            </Button>
          )}
        </div>
      )}
      {history.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Historial de ubicación ({history.length})</summary>
          <ol className="mt-2 flex flex-col gap-1.5" aria-label="Historial de ubicación">
            {history.map((e) => (
              <li key={e.id} className="flex flex-col">
                <span>
                  <span className="font-medium">{LOCATION_LABELS[e.status]}</span>
                  {" · "}
                  {e.neighborhood_id ? (names[e.neighborhood_id] ?? "Colonia") : "sin colonia"}
                  {e.source && ` · ${LOCATION_SOURCE_LABELS[e.source] ?? e.source}`}
                  {e.lat !== null && " · con punto"}
                </span>
                <span className="text-muted-foreground">
                  {e.actor_name || "Sistema"} · {formatDateTime(e.at)}
                  {e.reason && ` · «${e.reason}»`}
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}
      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          {dialog === "set" && <SetForm caseId={caseId} location={location} neighborhoods={neighborhoods} onClose={() => setDialog(null)} />}
          {dialog === "clear" && <ClearForm caseId={caseId} onClose={() => setDialog(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SetForm({
  caseId,
  location,
  neighborhoods,
  onClose,
}: {
  caseId: string;
  location: CaseLocationState;
  neighborhoods: { id: string; name: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [neighborhoodId, setNeighborhoodId] = useState(location.neighborhoodId);
  const [lat, setLat] = useState(location.lat?.toString() ?? "");
  const [lng, setLng] = useState(location.lng?.toString() ?? "");
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  // A correction (a confirmed location or another colonia) needs a reason.
  const needsReason = location.status === "confirmed" || neighborhoodId !== location.neighborhoodId;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!neighborhoodId) return toast.error("Elige una colonia del municipio.");
    startTransition(async () => {
      const result = await setCaseLocation({ caseId, neighborhoodId, lat, lng, reason });
      if (!result.ok) return void toast.error(result.message);
      toast.success(result.message);
      onClose();
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{location.status === "confirmed" ? "Corregir ubicación" : "Confirmar ubicación"}</DialogTitle>
        <DialogDescription>
          Confirma la colonia que verificaste. El punto es opcional: sólo si conoces el lugar exacto; debe caer dentro de la colonia. No anotes
          domicilios ni nombres.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label>Colonia</Label>
        <OptionSelect
          label="Colonia"
          size="default"
          value={neighborhoodId}
          onChange={setNeighborhoodId}
          emptyLabel="Elige una colonia"
          options={neighborhoods.map((n) => ({ value: n.id, label: n.name }))}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="location-lat">Latitud (opcional)</Label>
          <Input id="location-lat" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="19.39500" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="location-lng">Longitud (opcional)</Label>
          <Input id="location-lng" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="-99.12500" />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="location-reason">Motivo{needsReason ? "" : " (opcional)"}</Label>
        <Textarea
          id="location-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          rows={2}
          required={needsReason}
          placeholder="Cómo se verificó (recorrido, llamada a la dependencia…)"
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          Guardar
        </Button>
      </DialogFooter>
    </form>
  );
}

function ClearForm({ caseId, onClose }: { caseId: string; onClose: () => void }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await clearCaseLocation({ caseId, reason });
      if (!result.ok) return void toast.error(result.message);
      toast.success(result.message);
      onClose();
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Quitar ubicación</DialogTitle>
        <DialogDescription>El caso quedará sin colonia: se contará en «sin ubicación» del mapa.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="clear-reason">Motivo</Label>
        <Textarea id="clear-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} required minLength={3} />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" variant="destructive" disabled={pending}>
          Quitar
        </Button>
      </DialogFooter>
    </form>
  );
}
