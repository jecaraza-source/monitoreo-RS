"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteAiInvoice, saveAiInvoice } from "@/lib/ai-usage/actions";

export function InvoiceForm({ defaultMonth }: { defaultMonth: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState({ month: defaultMonth, amount_usd: "", reference: "", notes: "" });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveAiInvoice(values);
      if (!result.ok) return void toast.error(result.message);
      toast.success(result.message);
      setValues({ ...values, amount_usd: "", reference: "", notes: "" });
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[auto_auto_1fr_auto] sm:items-end" aria-label="Registrar factura">
      <div className="flex flex-col gap-1">
        <Label htmlFor="inv-month">Mes</Label>
        <Input id="inv-month" type="month" required value={values.month} onChange={(e) => setValues({ ...values, month: e.target.value })} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="inv-amount">Monto facturado (US$)</Label>
        <Input
          id="inv-amount"
          type="number"
          min={0}
          step="0.01"
          required
          className="w-36"
          value={values.amount_usd}
          onChange={(e) => setValues({ ...values, amount_usd: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="inv-ref">Referencia (opcional)</Label>
        <Input id="inv-ref" maxLength={120} value={values.reference} onChange={(e) => setValues({ ...values, reference: e.target.value })} />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Guardando…" : "Registrar factura"}
      </Button>
    </form>
  );
}

export function DeleteInvoiceButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          if (!window.confirm("¿Borrar la factura de este mes?")) return;
          const result = await deleteAiInvoice({ id });
          if (!result.ok) return void toast.error(result.message);
          toast.success(result.message);
          router.refresh();
        })
      }
    >
      Borrar
    </Button>
  );
}
