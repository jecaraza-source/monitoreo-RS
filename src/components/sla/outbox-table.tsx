"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatDateTime } from "@/components/inbox/format";
import { Button } from "@/components/ui/button";
import { retryOutbox } from "@/lib/sla/actions";
import type { OutboxItem } from "@/lib/sla/data";
import { DEFERRED_LABELS, maskAddress, OUTBOX_KIND_LABELS, OUTBOX_STATUS_LABELS } from "@/lib/sla/model";
import { cn } from "@/lib/utils";

/** Recent outbox messages: state, attempts, provider id, error; failed or uncertain ones can be re-queued on purpose. */
export function OutboxTable({ items }: { items: OutboxItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (!items.length) return <p className="text-sm text-muted-foreground">Todavía no hay envíos.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] text-sm" aria-label="Envíos recientes">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="py-1 pr-2 font-normal">Creado</th>
            <th className="py-1 pr-2 font-normal">Tipo</th>
            <th className="py-1 pr-2 font-normal">Canal</th>
            <th className="py-1 pr-2 font-normal">Destino</th>
            <th className="py-1 pr-2 font-normal">Estado</th>
            <th className="py-1 pr-2 font-normal">Intentos</th>
            <th className="py-1 pr-2 font-normal">Detalle</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((o) => (
            <tr key={o.id} className="border-t align-top">
              <td className="py-1.5 pr-2 whitespace-nowrap">{formatDateTime(o.created_at)}</td>
              <td className={cn("py-1.5 pr-2", o.urgency === "critical" && "font-medium text-negative")}>{OUTBOX_KIND_LABELS[o.kind] ?? o.kind}</td>
              <td className="py-1.5 pr-2">{o.channel === "email" ? "Correo" : "WhatsApp"}</td>
              <td className="py-1.5 pr-2 font-mono text-xs">{maskAddress(o.address)}</td>
              <td className={cn("py-1.5 pr-2", (o.status === "dead" || o.status === "uncertain") && "font-medium text-negative")}>
                {OUTBOX_STATUS_LABELS[o.status] ?? o.status}
              </td>
              <td className="py-1.5 pr-2">
                {o.attempts}/{o.max_attempts}
              </td>
              <td className="max-w-72 py-1.5 pr-2 text-xs text-muted-foreground">
                {o.provider_message_id && <span className="block font-mono">{o.provider_message_id}</span>}
                {o.deferred_reason && o.status === "pending" && <span className="block">Espera por {DEFERRED_LABELS[o.deferred_reason] ?? o.deferred_reason}</span>}
                {o.deferred_reason === "channel_off" && o.status === "cancelled" && <span className="block">{DEFERRED_LABELS.channel_off}</span>}
                {o.last_error && <span className="block">{o.last_error}</span>}
              </td>
              <td className="py-1.5">
                {["dead", "uncertain", "cancelled"].includes(o.status) && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await retryOutbox({ outboxId: o.id });
                        if (!result.ok) return void toast.error(result.message);
                        toast.success(result.message);
                        router.refresh();
                      })
                    }
                  >
                    Reintentar
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
