"use client";

import { useState, useTransition } from "react";
import { CalendarClock, Palette } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { splitList } from "@/lib/alerts/rules";
import { saveBrandColors, saveSchedule, type ReportActionResult } from "@/lib/reports/actions";
import type { ReportSchedule } from "@/lib/reports/list";
import { REPORT_KIND_LABELS, REPORT_KINDS, type ReportKind } from "@/lib/reports/period";

const WHEN: Record<ReportKind, string> = {
  daily: "Todos los días a las 7:00 con el día anterior.",
  weekly: "Los lunes a las 7:00 con la semana anterior.",
  monthly: "El día 1 a las 7:00 con el mes anterior.",
};

function useAction() {
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<ReportActionResult>) =>
    startTransition(async () => {
      const r = await action();
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    });
  return { pending, run };
}

export function ReportSettings({
  schedules,
  brand,
  canEdit,
  canEditBrand,
}: {
  schedules: ReportSchedule[];
  brand: { primary: string; accent: string };
  canEdit: boolean;
  canEditBrand: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle as="h2" className="flex items-center gap-2 text-base">
            <CalendarClock className="size-4 text-primary" aria-hidden /> Envío programado
          </CardTitle>
          <CardDescription>
            El sistema prepara el borrador a la hora indicada. Al aprobarlo se envía el PDF a la lista; con aprobación automática se envía sin
            revisión.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {REPORT_KINDS.map((kind) => (
            <ScheduleForm key={kind} kind={kind} schedule={schedules.find((s) => s.period === kind)} canEdit={canEdit} />
          ))}
        </CardContent>
      </Card>
      <BrandForm brand={brand} canEdit={canEditBrand} />
    </div>
  );
}

function ScheduleForm({ kind, schedule, canEdit }: { kind: ReportKind; schedule?: ReportSchedule; canEdit: boolean }) {
  const { pending, run } = useAction();
  const [active, setActive] = useState(schedule?.isActive ?? false);
  const [auto, setAuto] = useState(schedule?.autoApprove ?? false);
  const [to, setTo] = useState((schedule?.recipients ?? []).join(", "));
  const id = `sched-${kind}`;

  return (
    <fieldset className="flex flex-col gap-2" disabled={!canEdit || pending}>
      <legend className="sr-only">Reporte {REPORT_KIND_LABELS[kind].toLowerCase()}</legend>
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox checked={active} onCheckedChange={(v) => setActive(Boolean(v))} />
          {REPORT_KIND_LABELS[kind]}
        </label>
        <span className="text-xs text-muted-foreground">{WHEN[kind]}</span>
      </div>
      <Label htmlFor={id} className="sr-only">
        Destinatarios del reporte {REPORT_KIND_LABELS[kind].toLowerCase()}
      </Label>
      <Textarea id={id} rows={2} placeholder="Correos separados por coma" value={to} onChange={(e) => setTo(e.target.value)} />
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox checked={auto} onCheckedChange={(v) => setAuto(Boolean(v))} />
          Aprobar y enviar sin revisión
        </label>
        {canEdit && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => run(() => saveSchedule({ period: kind, recipients: splitList(to), autoApprove: auto, isActive: active }))}
          >
            Guardar
          </Button>
        )}
      </div>
    </fieldset>
  );
}

function BrandForm({ brand, canEdit }: { brand: { primary: string; accent: string }; canEdit: boolean }) {
  const { pending, run } = useAction();
  const [primary, setPrimary] = useState(brand.primary);
  const [accent, setAccent] = useState(brand.accent);
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="flex items-center gap-2 text-base">
          <Palette className="size-4 text-primary" aria-hidden /> Portada del PDF
        </CardTitle>
        <CardDescription>Colores del municipio en la portada de los reportes.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div
          className="flex h-24 flex-col justify-end rounded-lg p-3 text-white"
          style={{ backgroundColor: primary }}
          aria-label="Vista previa de la portada"
        >
          <span className="mb-2 block h-1 w-10" style={{ backgroundColor: accent }} />
          <span className="text-sm font-semibold">Escucha social y atención ciudadana</span>
        </div>
        <fieldset className="grid grid-cols-2 gap-3" disabled={!canEdit || pending}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="brand-primary">Principal</Label>
            <Input id="brand-primary" type="color" value={primary} onChange={(e) => setPrimary(e.target.value)} className="h-9 p-1" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="brand-accent">Acento</Label>
            <Input id="brand-accent" type="color" value={accent} onChange={(e) => setAccent(e.target.value)} className="h-9 p-1" />
          </div>
        </fieldset>
        {canEdit && (
          <Button size="sm" variant="outline" className="self-end" disabled={pending} onClick={() => run(() => saveBrandColors({ primary, accent }))}>
            Guardar colores
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
