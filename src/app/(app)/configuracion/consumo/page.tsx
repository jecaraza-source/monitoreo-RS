import type { Metadata } from "next";
import { ConsumptionSummary } from "@/components/ai-usage/consumption-summary";
import { InvoiceForm } from "@/components/ai-usage/invoice-form";
import { LimitsForm } from "@/components/ai-usage/limits-form";
import { ReconciliationTable } from "@/components/ai-usage/reconciliation-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAiConsumption } from "@/lib/ai-usage/data";
import { requireSection } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Consumo de IA" };

export default async function AiConsumptionPage() {
  const member = await requireSection("/configuracion/consumo");
  const data = await getAiConsumption(member);
  const isAdmin = member.role === "admin";

  return (
    <div className="flex flex-col gap-5 pt-4">
      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">
            Consumo de IA
          </CardTitle>
          <CardDescription>
            Solicitudes, tokens y costo estimado por uso y modelo. Un modelo sin tarifa configurada muestra «Costo desconocido» con sus tokens; nunca se
            cuenta como cero.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ConsumptionSummary data={data} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">
            Límites y presupuesto
          </CardTitle>
          <CardDescription>
            {isAdmin ? "Se aplican a todas las instancias a la vez." : "Sólo un administrador puede cambiarlos."}
            {data.limitsUpdatedAt && ` Última modificación: ${new Date(data.limitsUpdatedAt).toLocaleString("es-MX", { timeZone: "America/Mexico_City" })}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LimitsForm limits={data.limits} canEdit={isAdmin} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">
            Conciliación con facturación
          </CardTitle>
          <CardDescription>
            Compara el estimado de cada mes con lo que factura el proveedor. Si el mes tiene llamadas de costo desconocido, el estimado está incompleto.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {isAdmin && <InvoiceForm defaultMonth={data.todayDay.slice(0, 7)} />}
          <ReconciliationTable rows={data.reconciliation} canEdit={isAdmin} />
        </CardContent>
      </Card>
    </div>
  );
}
