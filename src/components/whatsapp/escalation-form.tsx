"use client";

import { useState } from "react";
import { Send, Trash2 } from "lucide-react";
import { OptionSelect } from "@/components/inbox/option-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { inviteEscalation, removeContact, setEscalation } from "@/lib/whatsapp/actions";
import { cn } from "@/lib/utils";
import { CONTACT_STATUS, type ContactStatus } from "./responsibles-table";
import { useWhatsAppAction } from "./use-whatsapp-action";

/** Who hears about expired turns: a Comunicación user or an admin, with their WhatsApp. */
export function EscalationForm({
  userId,
  candidates,
  contact,
}: {
  userId: string | null;
  candidates: { id: string; label: string }[];
  contact: { phone: string; status: ContactStatus } | null;
}) {
  const { pending, run } = useWhatsAppAction();
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const status = CONTACT_STATUS[contact?.status ?? "none"];
  const resend = contact && phone === contact.phone;

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <OptionSelect
          label="Escalar turnos vencidos a"
          value={userId}
          emptyLabel="Nadie (sin escalamiento)"
          options={candidates.map((c) => ({ value: c.id, label: c.label }))}
          onChange={(next) => run(() => setEscalation({ userId: next }))}
          disabled={pending}
          className="min-w-64"
        />
        <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", status.className)}>{status.label}</span>
      </div>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => inviteEscalation({ phone }));
        }}
      >
        <Input
          aria-label="WhatsApp de quien recibe los turnos vencidos"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+52 55 1234 5678"
          className="h-8 w-44"
          disabled={!userId}
        />
        <Button type="submit" size="sm" variant="outline" disabled={pending || !userId || !phone.trim()}>
          <Send aria-hidden /> {resend ? "Reenviar" : "Invitar"}
        </Button>
        {contact && userId && (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Quitar WhatsApp de escalamiento"
            disabled={pending}
            onClick={() => confirm("¿Quitar este número? Dejará de recibir mensajes.") && run(() => removeContact({ userId }), () => setPhone(""))}
          >
            <Trash2 aria-hidden />
          </Button>
        )}
      </form>
    </div>
  );
}
