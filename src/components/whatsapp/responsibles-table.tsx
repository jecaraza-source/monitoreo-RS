"use client";

import { useState } from "react";
import { Send, Trash2 } from "lucide-react";
import { OptionSelect } from "@/components/inbox/option-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { inviteResponsible, removeContact, setResponsible } from "@/lib/whatsapp/actions";
import { cn } from "@/lib/utils";
import { useWhatsAppAction } from "./use-whatsapp-action";

export type ContactStatus = "pending" | "active" | "declined" | "opted_out";

export type ResponsibleRow = {
  departmentId: string;
  departmentName: string;
  responsibleId: string | null;
  /** Members who may be responsible: its dependencia users, Comunicación and admins. */
  candidates: { id: string; label: string }[];
  contact: { phone: string; status: ContactStatus } | null;
};

export const CONTACT_STATUS: Record<ContactStatus | "none", { label: string; className: string }> = {
  none: { label: "Sin WhatsApp", className: "bg-muted text-muted-foreground" },
  pending: { label: "Invitación enviada", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  active: { label: "Activo", className: "bg-positive/15 text-positive" },
  declined: { label: "No aceptó", className: "bg-negative/15 text-negative" },
  opted_out: { label: "Se dio de baja", className: "bg-negative/15 text-negative" },
};

export function ResponsiblesTable({ rows }: { rows: ResponsibleRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Dependencia</TableHead>
          <TableHead>Responsable</TableHead>
          <TableHead>WhatsApp</TableHead>
          <TableHead>Estado</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <Row key={row.departmentId} row={row} />
        ))}
      </TableBody>
    </Table>
  );
}

function Row({ row }: { row: ResponsibleRow }) {
  const { pending, run } = useWhatsAppAction();
  const [phone, setPhone] = useState(row.contact?.phone ?? "");
  const status = CONTACT_STATUS[row.contact?.status ?? "none"];
  const resend = row.contact && phone === row.contact.phone;

  return (
    <TableRow>
      <TableCell className="font-medium">{row.departmentName}</TableCell>
      <TableCell className="min-w-56">
        <OptionSelect
          label={`Responsable de ${row.departmentName}`}
          value={row.responsibleId}
          emptyLabel="Sin responsable"
          options={row.candidates.map((c) => ({ value: c.id, label: c.label }))}
          onChange={(userId) => run(() => setResponsible({ departmentId: row.departmentId, userId }))}
          disabled={pending}
          className="w-full"
        />
      </TableCell>
      <TableCell className="min-w-72">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => inviteResponsible({ departmentId: row.departmentId, phone }));
          }}
        >
          <Input
            aria-label={`WhatsApp del responsable de ${row.departmentName}`}
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+52 55 1234 5678"
            className="h-8 w-44"
            disabled={!row.responsibleId}
          />
          <Button type="submit" size="sm" variant="outline" disabled={pending || !row.responsibleId || !phone.trim()}>
            <Send aria-hidden /> {resend ? "Reenviar" : "Invitar"}
          </Button>
          {row.contact && row.responsibleId && (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={`Quitar WhatsApp de ${row.departmentName}`}
              disabled={pending}
              onClick={() =>
                confirm("¿Quitar este número? Dejará de recibir mensajes.") &&
                run(() => removeContact({ userId: row.responsibleId }), () => setPhone(""))
              }
            >
              <Trash2 aria-hidden />
            </Button>
          )}
        </form>
      </TableCell>
      <TableCell>
        <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", status.className)}>
          {status.label}
        </span>
      </TableCell>
    </TableRow>
  );
}
