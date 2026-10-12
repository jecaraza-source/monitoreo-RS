"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setOfficialsAccess } from "@/app/(app)/configuracion/usuarios/actions";

export function OfficialsAccessToggle({ userId, email, allowed }: { userId: string; email: string; allowed: boolean }) {
  const [pending, startTransition] = useTransition();
  // Optimistic: the box flips at once and goes back if the server refuses.
  const [checked, setChecked] = useState(allowed);
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        disabled={pending}
        aria-label={`Acceso a Funcionarios para ${email}`}
        onChange={(e) => {
          const next = e.target.checked;
          setChecked(next);
          startTransition(async () => {
            const result = await setOfficialsAccess({ userId, allowed: next });
            if (result.ok) return void toast.success(result.message);
            setChecked(!next);
            toast.error(result.message);
          });
        }}
      />
      {checked ? "Autorizado" : "Sin acceso"}
    </label>
  );
}
