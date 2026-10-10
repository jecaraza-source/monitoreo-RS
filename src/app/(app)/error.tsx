"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useReportError } from "@/components/layout/report-error";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useReportError(error);
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <AlertTriangle className="size-8 text-negative" aria-hidden />
      <h1 className="text-lg font-semibold">Algo salió mal</h1>
      <p className="text-sm text-muted-foreground">
        El error quedó registrado para revisarlo.{error.digest ? ` Referencia: ${error.digest}.` : ""}
      </p>
      <Button onClick={reset}>Intentar de nuevo</Button>
    </div>
  );
}
