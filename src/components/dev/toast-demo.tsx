"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function ToastDemo() {
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => toast.success("Ticket turnado a Obras Públicas")}>Éxito</Button>
      <Button variant="outline" onClick={() => toast.info("Hay 12 menciones nuevas en la bandeja")}>Información</Button>
      <Button variant="outline" onClick={() => toast.warning("Pico de menciones negativas en San Miguel")}>Advertencia</Button>
      <Button variant="outline" onClick={() => toast.error("No se pudo generar el reporte")}>Error</Button>
    </div>
  );
}
