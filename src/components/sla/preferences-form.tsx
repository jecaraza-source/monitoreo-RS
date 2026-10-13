"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveMyPreferences } from "@/lib/sla/actions";

export function PreferencesForm({
  initial,
  orgQuiet,
  whatsappActive,
}: {
  initial: { email: boolean; whatsapp: boolean; quiet: { start: number; end: number } | null };
  orgQuiet: { start: number; end: number };
  whatsappActive: boolean;
}) {
  const [email, setEmail] = useState(initial.email);
  const [whatsapp, setWhatsapp] = useState(initial.whatsapp);
  const [custom, setCustom] = useState(initial.quiet !== null);
  const [quiet, setQuiet] = useState(initial.quiet ?? orgQuiet);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveMyPreferences({ email, whatsapp, quiet: custom ? quiet : null });
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-label="Mis avisos">
      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1 font-medium">Canales</legend>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> Correo
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={whatsapp} onChange={(e) => setWhatsapp(e.target.checked)} /> WhatsApp
          {!whatsappActive && <span className="text-xs text-muted-foreground">(tu número aún no está vinculado)</span>}
        </label>
      </fieldset>
      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1 font-medium">Horario de silencio</legend>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={custom} onChange={(e) => setCustom(e.target.checked)} />
          Usar mi propio horario (si no, el del municipio: {orgQuiet.start}:00 a {orgQuiet.end}:00)
        </label>
        {custom && (
          <div className="flex gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="quiet-start">Desde (hora)</Label>
              <Input id="quiet-start" type="number" min={0} max={23} value={quiet.start} onChange={(e) => setQuiet({ ...quiet, start: Number(e.target.value) })} className="w-24" />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="quiet-end">Hasta (hora)</Label>
              <Input id="quiet-end" type="number" min={0} max={23} value={quiet.end} onChange={(e) => setQuiet({ ...quiet, end: Number(e.target.value) })} className="w-24" />
            </div>
          </div>
        )}
      </fieldset>
      <p className="text-xs text-muted-foreground">
        Los avisos de emergencia y las alertas críticas llegan siempre, aunque desactives un canal o estés en horario de silencio: no se ocultan eventos
        críticos. Los demás esperan al final del silencio, nunca se pierden.
      </p>
      <Button type="submit" className="w-fit" disabled={pending}>
        {pending ? "Guardando…" : "Guardar"}
      </Button>
    </form>
  );
}
