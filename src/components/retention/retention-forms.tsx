"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createRetentionHold, releaseRetentionHold, saveRetentionPolicy } from "@/lib/retention/actions";
import { EXPORT_KINDS, type ExportKind } from "@/lib/retention/model";

function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (work: () => Promise<{ ok: boolean; message: string }>, onOk?: () => void) =>
    startTransition(async () => {
      const r = await work();
      if (!r.ok) return void toast.error(r.message);
      toast.success(r.message);
      onOk?.();
      router.refresh();
    });
  return { pending, run };
}

export type PolicyValues = { mention_months: number | null; agreement_reference: string | null; agreement_date: string | null; notes: string; paused: boolean } | null;

export function RetentionPolicyForm({ policy }: { policy: PolicyValues }) {
  const { pending, run } = useAction();
  const [v, setV] = useState({
    mentionMonths: policy?.mention_months?.toString() ?? "",
    agreementReference: policy?.agreement_reference ?? "",
    agreementDate: policy?.agreement_date ?? "",
    notes: policy?.notes ?? "",
    paused: policy?.paused ?? false,
  });
  return (
    <form
      aria-label="Política de retención"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveRetentionPolicy(v));
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="ret-months">Eliminar menciones después de (meses)</Label>
          <Input id="ret-months" type="number" min={1} max={240} placeholder="Sin eliminación automática" value={v.mentionMonths} onChange={(e) => setV({ ...v, mentionMonths: e.target.value })} />
          <span className="text-xs text-muted-foreground">Vacío = nunca se eliminan solas.</span>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="ret-ref">Acuerdo del municipio (referencia)</Label>
          <Input id="ret-ref" maxLength={200} placeholder="Acta de cabildo, oficio…" value={v.agreementReference} onChange={(e) => setV({ ...v, agreementReference: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="ret-date">Fecha del acuerdo</Label>
          <Input id="ret-date" type="date" value={v.agreementDate} onChange={(e) => setV({ ...v, agreementDate: e.target.value })} />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="ret-notes">Notas (opcional)</Label>
        <Textarea id="ret-notes" rows={2} maxLength={1000} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
      </div>
      <label className="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" checked={v.paused} onChange={(e) => setV({ ...v, paused: e.target.checked })} />
        Pausar la depuración (p. ej. mientras se revisa el acuerdo)
      </label>
      <Button type="submit" className="w-fit" disabled={pending}>
        {pending ? "Guardando…" : "Guardar política"}
      </Button>
    </form>
  );
}

export type Hold = { id: string; covers_from: string | null; covers_to: string | null; reason: string; reference: string | null; created_at: string; released_at: string | null; release_reason: string | null };

export function HoldsManager({ holds }: { holds: Hold[] }) {
  const { pending, run } = useAction();
  const [v, setV] = useState({ coversFrom: "", coversTo: "", reason: "", reference: "" });
  const range = (h: Hold) => (h.covers_from || h.covers_to ? `${h.covers_from ?? "inicio"} a ${h.covers_to ?? "hoy"}` : "Todo el municipio");
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col divide-y rounded-lg border" aria-label="Conservaciones">
        {holds.length === 0 && <li className="p-3 text-sm text-muted-foreground">Sin conservaciones.</li>}
        {holds.map((h) => (
          <li key={h.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium">
                {range(h)}
                {h.released_at ? <span className="ml-2 text-xs text-muted-foreground">liberada</span> : <span className="ml-2 text-xs text-positive">activa</span>}
              </span>
              <span className="text-xs text-muted-foreground">
                {h.reason}
                {h.reference && ` · ${h.reference}`}
                {h.released_at && ` · liberada: ${h.release_reason}`}
              </span>
            </div>
            {!h.released_at && (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => {
                  const reason = window.prompt("Motivo para liberar la conservación (queda en el historial):");
                  if (reason) run(() => releaseRetentionHold({ id: h.id, reason }));
                }}
              >
                Liberar
              </Button>
            )}
          </li>
        ))}
      </ul>
      <form
        aria-label="Nueva conservación"
        className="grid gap-3 sm:grid-cols-[auto_auto_1fr]"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => createRetentionHold(v), () => setV({ coversFrom: "", coversTo: "", reason: "", reference: "" }));
        }}
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor="hold-from">Publicadas desde</Label>
          <Input id="hold-from" type="date" value={v.coversFrom} onChange={(e) => setV({ ...v, coversFrom: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="hold-to">Hasta</Label>
          <Input id="hold-to" type="date" value={v.coversTo} onChange={(e) => setV({ ...v, coversTo: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="hold-ref">Referencia (opcional)</Label>
          <Input id="hold-ref" maxLength={200} placeholder="Oficio, solicitud de información…" value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1 sm:col-span-3">
          <Label htmlFor="hold-reason">Obligación de conservar</Label>
          <Textarea id="hold-reason" rows={2} minLength={10} maxLength={500} required value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
        </div>
        <Button type="submit" className="w-fit" disabled={pending}>
          Registrar conservación
        </Button>
      </form>
    </div>
  );
}

export function ExportForm({ kinds, defaultFrom, defaultTo }: { kinds: ExportKind[]; defaultFrom: string; defaultTo: string }) {
  const [kind, setKind] = useState<ExportKind>(kinds[0]);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const href = `/api/exportar?${new URLSearchParams({ tipo: kind, desde: from, hasta: to })}`;
  return (
    <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Exportar para conciliación">
      <div className="flex flex-col gap-1">
        <Label htmlFor="exp-kind">Qué exportar</Label>
        <select id="exp-kind" className="h-8 rounded-lg border bg-transparent px-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value as ExportKind)}>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {EXPORT_KINDS[k].label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="exp-from">Desde</Label>
        <Input id="exp-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="exp-to">Hasta</Label>
        <Input id="exp-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <a href={href} download className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">
        Descargar CSV
      </a>
    </div>
  );
}
