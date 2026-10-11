"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import type { WhatsAppActionResult } from "@/lib/whatsapp/actions";

/** Runs a WhatsApp settings Server Action and reports the result as toasts. */
export function useWhatsAppAction() {
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<WhatsAppActionResult>, onSuccess?: () => void) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) return void toast.error(result.message);
      toast.success(result.message);
      if (result.warning) toast.warning(result.warning);
      onSuccess?.();
    });
  return { pending, run };
}
