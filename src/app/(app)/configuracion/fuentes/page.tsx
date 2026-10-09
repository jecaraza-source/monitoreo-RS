import type { Metadata } from "next";
import { RunsTable } from "@/components/sources/runs-table";
import { SourcesManager } from "@/components/sources/sources-manager";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSection } from "@/lib/auth/session";
import { connectorInfo, getRecentRuns, getSources } from "@/lib/sources/data";

export const metadata: Metadata = { title: "Fuentes" };

export default async function SourcesPage() {
  const member = await requireSection("/configuracion/fuentes");
  const [sources, runs] = await Promise.all([getSources(member), getRecentRuns(member)]);

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        La ingesta corre cada hora: lee lo nuevo de cada fuente activa, descarta repetidos y asigna la consulta
        que lo capturó. Las menciones entran como pendientes de clasificar.
      </p>
      <SourcesManager connectors={connectorInfo()} sources={sources} />
      <Card>
        <CardHeader>
          <CardTitle as="h2">Corridas recientes</CardTitle>
          <CardDescription>Programadas (cron) y manuales, con sus errores.</CardDescription>
        </CardHeader>
        <CardContent>
          <RunsTable runs={runs} />
        </CardContent>
      </Card>
    </div>
  );
}
