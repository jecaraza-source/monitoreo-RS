"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { OptionSelect } from "@/components/inbox/option-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { splitList } from "@/lib/alerts/rules";
import { generateReport } from "@/lib/reports/actions";
import { REPORT_KIND_LABELS, REPORT_KINDS, reportPeriod, type ReportKind } from "@/lib/reports/period";

const yesterday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date(Date.now() - 86_400_000));

export function GenerateReport() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ReportKind>("weekly");
  const [endDay, setEndDay] = useState(yesterday);
  const [recipients, setRecipients] = useState("");
  const [pending, startTransition] = useTransition();
  const label = /^\d{4}-\d{2}-\d{2}$/.test(endDay) ? reportPeriod(kind, endDay).label : "";

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await generateReport({ kind, endDay, recipients: splitList(recipients) });
      if (!result.ok) return void toast.error(result.message);
      toast.success(result.message);
      setOpen(false);
      if (result.id) router.push(`/reportes/${result.id}`);
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <FilePlus2 aria-hidden /> Generar reporte
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Generar reporte</DialogTitle>
              <DialogDescription>
                Las cifras se calculan en el sistema y Claude redacta la narrativa. Podrás editarla antes de aprobar.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Tipo</Label>
                <OptionSelect
                  label="Tipo de reporte"
                  size="default"
                  value={kind}
                  onChange={(v) => v && setKind(v as ReportKind)}
                  options={REPORT_KINDS.map((k) => ({ value: k, label: REPORT_KIND_LABELS[k] }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="report-end">Último día</Label>
                <Input id="report-end" type="date" value={endDay} max={yesterday()} onChange={(e) => setEndDay(e.target.value)} required />
              </div>
            </div>
            {label && <p className="text-sm text-muted-foreground">Periodo: {label}</p>}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="report-to">Destinatarios (opcional)</Label>
              <Input
                id="report-to"
                placeholder="correo@municipio.gob.mx, otro@…"
                value={recipients}
                onChange={(e) => setRecipients(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Recibirán el PDF cuando apruebes el reporte.</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden /> Redactando… (hasta 1 min)
                  </>
                ) : (
                  "Generar borrador"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
