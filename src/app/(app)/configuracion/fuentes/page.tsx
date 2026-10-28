import type { Metadata } from "next";
import { FailuresQueue } from "@/components/sources/failures-queue";
import { RunsTable } from "@/components/sources/runs-table";
import { SourcesManager } from "@/components/sources/sources-manager";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSection } from "@/lib/auth/session";
import { connectorInfo, getOpenFailures, getRecentRuns, getSources } from "@/lib/sources/data";

export const metadata: Metadata = { title: "Fuentes" };

export default async function SourcesPage() {
  const member = await requireSection("/configuracion/fuentes");
  const [sources, runs, failures] = await Promise.all([getSources(member), getRecentRuns(member), getOpenFailures(member)]);

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        La ingesta corre cada hora: lee lo nuevo de cada fuente activa, descarta repetidos (y actualiza sus
        interacciones) y asigna la consulta que lo capturó. Si una corrida alcanza un tope, la siguiente lee lo que
        faltó. Las menciones entran como pendientes de clasificar.
      </p>
      <SourcesManager connectors={connectorInfo()} sources={sources} canConnectUnofficial={member.role === "admin"} />
      <Card>
        <CardHeader>
          <CardTitle as="h2">Corridas recientes</CardTitle>
          <CardDescription>Programadas (cron) y manuales, con sus errores.</CardDescription>
        </CardHeader>
        <CardContent>
          <RunsTable runs={runs} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle as="h2">Fallos por revisar</CardTitle>
          <CardDescription>
            Menciones que no se pudieron clasificar tras 5 intentos (ya no se reintentan solas) y fuentes con 5 fallos
            seguidos (siguen reintentando, cada vez más espaciado, hasta una vez al día).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FailuresQueue failures={failures} />
        </CardContent>
      </Card>
    </div>
  );
}
