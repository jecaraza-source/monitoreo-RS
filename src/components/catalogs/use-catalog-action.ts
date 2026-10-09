"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import type { CatalogResult } from "@/lib/catalogs/actions";

/** Runs a catalog Server Action and reports the result as a toast. */
export function useCatalogAction() {
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<CatalogResult>, onSuccess?: () => void) =>
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(result.message);
        onSuccess?.();
      } else {
        toast.error(result.message);
      }
    });
  return { pending, run };
}
