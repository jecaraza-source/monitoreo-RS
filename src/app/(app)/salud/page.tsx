import type { Metadata } from "next";
import { Suspense } from "react";
import { FailuresQueue } from "@/components/sources/failures-queue";
import { HealthSummaryView } from "@/components/health/health-summary";
import { MonitorSettingsForm } from "@/components/health/monitor-settings-form";
import { RunsExplorer } from "@/components/health/runs-explorer";
import { SourcesHealth } from "@/components/health/sources-health";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSection } from "@/lib/auth/session";
import { connectorEnabled, getHealth, getRuns, parseRunFilters } from "@/lib/health/data";
import { assessSource, summarize } from "@/lib/health/model";
import { getOpenFailures } from "@/lib/sources/data";
import { HealthSkeleton } from "./skeleton";

export const metadata: Metadata = { title: "Salud del monitoreo" };

export default function SaludPage({ searchParams }: PageProps<"/salud">) {
  return (
    <>
      <PageHeader
        title="Salud del monitoreo"
        description="Si las fuentes se están leyendo, si la clasificación va al día y qué tan fresco está el dashboard."
      />
      <Suspense fallback={<HealthSkeleton />}>
        <Health searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Health({ searchParams }: { searchParams: PageProps<"/salud">["searchParams"] }) {
  const member = await requireSection("/salud");
  const params = await searchParams;
  const snapshot = await getHealth(member);
  const now = new Date(snapshot.as_of);
  const summary = summarize(snapshot, now, connectorEnabled);

  // lectura: the aggregated picture only (no per-source errors or settings).
  if (!snapshot.editor) {
    return (
      <div className="flex flex-col gap-6">
        <HealthSummaryView summary={summary} snapshot={snapshot} />
        <p className="text-sm text-muted-foreground">
          El detalle por fuente, las corridas y los umbrales los revisan Administración y Comunicación Social.
        </p>
      </div>
    );
  }

  const filters = parseRunFilters(params);
  const [{ runs, more }, failures] = await Promise.all([getRuns(member, filters), getOpenFailures(member)]);
  const rows = snapshot.sources.map((source) => ({ source, health: assessSource(source, now, connectorEnabled(source.type)) }));

  return (
    <div className="flex flex-col gap-6">
      <HealthSummaryView summary={summary} snapshot={snapshot} />

      <Card>
        <CardHeader>
          <CardTitle as="h2">Fuentes</CardTitle>
          <CardDescription>
            Estado, atraso, próximo intento, lo que trajo la última corrida y su cobertura. “Reintentar ahora” lee la fuente al
            momento (como mucho una vez por minuto; si otra corrida la está leyendo, no se duplica).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SourcesHealth rows={rows} highlight={filters.source} />
        </CardContent>
      </Card>

      <Card id="fallos">
        <CardHeader>
          <CardTitle as="h2">Fallos por revisar</CardTitle>
          <CardDescription>
            Menciones que no se pudieron clasificar tras 5 intentos y fuentes con 5 fallos seguidos. Reintentar devuelve la mención a la
            cola o saca la fuente de la espera; descartar lo cierra sin reintentar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FailuresQueue failures={failures} />
        </CardContent>
      </Card>

      <Card id="corridas">
        <CardHeader>
          <CardTitle as="h2">Corridas</CardTitle>
          <CardDescription>Cada lectura de una fuente: lo que trajo, su ventana, los topes que alcanzó y sus errores.</CardDescription>
        </CardHeader>
        <CardContent>
          <RunsExplorer runs={runs} more={more} sources={snapshot.sources.map((s) => ({ id: s.id, name: s.name }))} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Umbrales de clasificación y dashboard</CardTitle>
          <CardDescription>
            Los de cada fuente se ajustan con “Umbrales” en su tarjeta. Para recibir avisos, crea una regla “Salud del monitoreo” en
            Alertas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MonitorSettingsForm settings={snapshot.settings} />
        </CardContent>
      </Card>
    </div>
  );
}
