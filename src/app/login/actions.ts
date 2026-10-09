"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { rateLimitMessage } from "@/lib/auth/rate-limit";
import { safeNext } from "@/lib/auth/redirect";
import { getSiteUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";

export type MagicLinkState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "error"; message: string };

const schema = z.object({
  email: z.email("Escribe un correo válido.").trim().toLowerCase(),
  next: z.string().optional(),
});

export async function sendMagicLink(_prev: MagicLinkState, formData: FormData): Promise<MagicLinkState> {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Correo inválido." };
  }

  const { email, next } = parsed.data;
  const site = await getSiteUrl();
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // Access is by invitation only: never create accounts from the login form.
      shouldCreateUser: false,
      emailRedirectTo: `${site}/auth/confirm?next=${encodeURIComponent(safeNext(next))}`,
    },
  });

  const limited = rateLimitMessage(error);
  if (limited) return { status: "error", message: limited };
  if (error) {
    // Unknown emails also land here. Answer the same as a success so the form
    // cannot be used to find out who has an account.
    console.warn("[auth] signInWithOtp:", error.code ?? error.message);
  }
  return { status: "sent", email };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
