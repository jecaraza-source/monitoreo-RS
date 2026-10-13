"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { reapplySla } from "@/lib/sla/actions";
import type { ReapplyRow } from "@/lib/sla/data";

const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-MX", { timeZone: "America/Mexico_City", dateStyle: "short", timeStyle: "short" }) : "—");

/** Preview and explicit, audited reapplication of the current SLA version to chosen open cases. */
export function SlaReapply({ rows }: { rows: ReapplyRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const includeOverridden = rows.some((r) => selected.has(r.case_id) && r.overridden);

  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">Todos los casos abiertos tienen los plazos de la versión vigente. No hay nada que reaplicar.</p>;
  }
  const toggle = (id: string) => setSelected((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));
  return (
    <form
      aria-label="Reaplicar SLA"
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!window.confirm(`Se cambiarán los plazos de ${selected.size} caso(s). Queda en su historial y en la bitácora. ¿Continuar?`)) return;
        startTransition(async () => {
          const result = await reapplySla({ caseIds: [...selected], reason, includeOverridden });
          if (!result.ok) return void toast.error(result.message);
          toast.success(result.message);
          setSelected(new Set());
          setReason("");
          router.refresh();
        });
      }}
    >
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Casos con plazos de otra versión, desplazable">
        <Table aria-label="Casos con plazos de otra versión">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">
                <span className="sr-only">Elegir</span>
              </TableHead>
              <TableHead scope="col">Caso</TableHead>
              <TableHead scope="col">Versión</TableHead>
              <TableHead scope="col">Compromiso actual</TableHead>
              <TableHead scope="col">Con la versión vigente</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.case_id}>
                <TableCell>
                  <input type="checkbox" aria-label={`Elegir ${r.folio}`} checked={selected.has(r.case_id)} onChange={() => toggle(r.case_id)} />
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {r.folio}
                  {r.overridden && <span className="ml-2 font-sans text-[10px] uppercase text-muted-foreground">plazo manual</span>}
                </TableCell>
                <TableCell className="text-xs">
                  {r.version_from ?? "—"} → {r.version_to ?? "—"}
                </TableCell>
                <TableCell className="text-xs">{dt(r.due_from)}</TableCell>
                <TableCell className="text-xs">{dt(r.due_to)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="sla-reapply-reason">Motivo (queda en el historial de cada caso)</Label>
        <Textarea id="sla-reapply-reason" rows={2} minLength={10} maxLength={500} required value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <Button type="submit" className="w-fit" disabled={pending || selected.size === 0}>
        {pending ? "Aplicando…" : `Reaplicar a ${selected.size} caso(s)`}
      </Button>
    </form>
  );
}
