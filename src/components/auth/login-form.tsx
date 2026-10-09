"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { MailCheck } from "lucide-react";
import { sendMagicLink, type MagicLinkState } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const LINK_ERRORS: Record<string, string> = {
  link: "El enlace no es válido o ya expiró. Pide uno nuevo.",
};

export function LoginForm() {
  const searchParams = useSearchParams();
  const linkError = LINK_ERRORS[searchParams.get("error") ?? ""];
  const [state, formAction, pending] = useActionState<MagicLinkState, FormData>(sendMagicLink, {
    status: "idle",
  });

  if (state.status === "sent") {
    return (
      <div role="status" className="flex flex-col items-center gap-3 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-positive/12 text-positive">
          <MailCheck className="size-6" aria-hidden />
        </div>
        <h2 className="font-medium">Revisa tu correo</h2>
        <p className="text-sm text-muted-foreground">
          Si <strong className="text-foreground">{state.email}</strong> tiene acceso, recibirás un enlace
          para entrar. Expira en una hora.
        </p>
      </div>
    );
  }

  const error = state.status === "error" ? state.message : linkError;

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="next" value={searchParams.get("next") ?? ""} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Correo institucional</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="nombre@municipio.gob.mx"
          required
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "email-error" : undefined}
        />
        {error && (
          <p id="email-error" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Enviando…" : "Enviarme un enlace de acceso"}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        El acceso es sólo por invitación. Si no tienes cuenta, pídela al área de Comunicación Social.
      </p>
    </form>
  );
}
