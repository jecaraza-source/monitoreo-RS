"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clearOnboardingCheck, recordOnboardingCheck } from "@/lib/settings/actions";
import type { CheckItem } from "@/lib/settings/onboarding";

function ManualRecord({ item }: { item: CheckItem }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const run = (work: () => Promise<{ ok: boolean; message: string }>) =>
    startTransition(async () => {
      const result = await work();
      if (!result.ok) return void toast.error(result.message);
      toast.success(result.message);
      setNote("");
      router.refresh();
    });
  if (item.ok) {
    return (
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => clearOnboardingCheck({ key: item.key }))}>
        Quitar
      </Button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => recordOnboardingCheck({ key: item.key, note }));
      }}
    >
      <Input aria-label={`Resultado: ${item.label}`} placeholder="Qué se probó y resultado" value={note} onChange={(e) => setNote(e.target.value)} className="h-8 w-64" />
      <Button type="submit" size="sm" disabled={pending}>
        Registrar
      </Button>
    </form>
  );
}

export function OnboardingChecklist({ items }: { items: CheckItem[] }) {
  const groups = [...new Set(items.map((i) => i.group))];
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <section key={g} aria-label={g}>
          <h3 className="mb-2 text-sm font-medium">{g}</h3>
          <ul className="flex flex-col divide-y rounded-lg border">
            {items
              .filter((i) => i.group === g)
              .map((i) => (
                <li key={i.key} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                  {i.ok ? (
                    <CheckCircle2 className="size-4 shrink-0 text-positive" aria-label="Listo" />
                  ) : (
                    <Circle className="size-4 shrink-0 text-muted-foreground" aria-label="Pendiente" />
                  )}
                  <div className="flex min-w-0 flex-1 flex-col">
                    {i.manual ? (
                      <span className="font-medium">{i.label}</span>
                    ) : (
                      <Link href={i.href} className="font-medium hover:underline">
                        {i.label}
                      </Link>
                    )}
                    <span className="text-xs text-muted-foreground">{i.detail}</span>
                  </div>
                  {i.manual && <ManualRecord item={i} />}
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
