"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { deletePolicy, savePolicy } from "@/lib/emergencies/actions";
import { INCIDENT_LABELS } from "@/lib/inbox/model";

export function IncidentPolicyForm({
  incidentType,
  policy,
}: {
  incidentType: string;
  policy: { channel: string; instructions: string } | null;
}) {
  const [channel, setChannel] = useState(policy?.channel ?? "");
  const [instructions, setInstructions] = useState(policy?.instructions ?? "");
  const [pending, startTransition] = useTransition();
  const id = `policy-${incidentType}`;

  const run = (action: () => ReturnType<typeof savePolicy>) =>
    startTransition(async () => {
      const r = await action();
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    });

  return (
    <form
      className="flex flex-col gap-2 rounded-lg border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => savePolicy({ incidentType, channel, instructions }));
      }}
    >
      <h3 className="font-medium">{INCIDENT_LABELS[incidentType]}</h3>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-channel`}>Canal institucional</Label>
        <Input id={`${id}-channel`} value={channel} onChange={(e) => setChannel(e.target.value)} maxLength={120} placeholder="911 · Protección Civil" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-instructions`}>Qué hacer antes de turnar</Label>
        <Textarea
          id={`${id}-instructions`}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="A quién avisar, por qué medio y qué datos dar."
        />
      </div>
      <div className="flex justify-end gap-2">
        {policy && (
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => run(() => deletePolicy({ incidentType }))}>
            Quitar
          </Button>
        )}
        <Button type="submit" size="sm" disabled={pending || channel.trim().length < 2 || instructions.trim().length < 10}>
          {pending ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </form>
  );
}
