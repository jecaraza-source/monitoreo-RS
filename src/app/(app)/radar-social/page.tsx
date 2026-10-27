import type { Metadata } from "next";
import { Suspense } from "react";
import { ShieldAlert } from "lucide-react";
import { CiMatches } from "@/components/counterintel/ci-matches";
import { CiReportForm } from "@/components/counterintel/ci-report-form";
import { CiReports } from "@/components/counterintel/ci-reports";
import { CiThreats } from "@/components/counterintel/ci-threats";
import { LookalikeResults, SearchResults } from "@/components/counterintel/radar-checks";
import { LookalikeButton, RadarSearchForm, RadarSettingsForm } from "@/components/counterintel/radar-tools";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { requireSection } from "@/lib/auth/session";
import { getOverview, getRadarChecks, getRadarSettings, getReports, radarConfigured } from "@/lib/counterintel/data";

export const metadata: Metadata = { title: "Radar Social" };

const DAYS = 30;

export default function CounterintelPage() {
  return (
    <>
      <PageHeader
        title="Radar Social"
        description="Desinformación sobre el municipio, cuentas que suplantan al ayuntamiento o a sus funcionarios, bots coordinados y amenazas. Acceso sólo para funcionarios autorizados; cada consulta queda en la bitácora."
      />
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <Counterintel />
      </Suspense>
    </>
  );
}

async function Counterintel() {
  // Section + explicit grant (admins too); the database checks it again.
  const member = await requireSection("/radar-social");
  const [overview, reports, settings, checks] = await Promise.all([
    getOverview(member, DAYS),
    getReports(member),
    getRadarSettings(member),
    getRadarChecks(member),
  ]);
  const configured = radarConfigured();
  const canEdit = member.role === "admin" || member.role === "comunicacion";

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        Radar Social trabaja sobre contenidos, cuentas que se presentan como oficiales, dominios y narrativas. No se registra
        ni se da seguimiento a ciudadanos, periodistas u opositores por sus opiniones; las críticas no son desinformación.
      </p>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Registro de reportes</CardTitle>
          <CardDescription>Lo que se sigue, con sus indicadores y evidencias. Los reportes se cierran con una nota; no se borran.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {canEdit && <CiReportForm />}
          <CiReports reports={reports} canEdit={canEdit} checks={Object.fromEntries(checks.byReport)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Dominios parecidos</CardTitle>
          <CardDescription>
            Certificados públicos (crt.sh) emitidos para dominios que usan un término vigilado y no son oficiales: es
            como suelen aparecer las páginas falsas. Los indicadores de cada reporte se revisan en URLhaus, PhishStats y
            Google Safe Browsing.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {canEdit ? (
            <RadarSettingsForm officialDomains={settings.officialDomains} watchTerms={settings.watchTerms} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Dominios oficiales: {settings.officialDomains.join(", ") || "—"} · Términos: {settings.watchTerms.join(", ") || "—"}
            </p>
          )}
          {canEdit && (
            <div>
              <LookalikeButton disabled={settings.watchTerms.length === 0} />
            </div>
          )}
          <LookalikeResults checks={checks.lookalikes} />
          <p className="text-xs text-muted-foreground">
            Servicios con llave: URLhaus {configured.urlhaus ? "configurado" : "sin configurar"} · Safe Browsing{" "}
            {configured.safe_browsing ? "configurado" : "sin configurar"} · Fact Check {configured.factcheck ? "configurado" : "sin configurar"}.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Verificaciones y medios</CardTitle>
          <CardDescription>
            Busca si una afirmación ya fue verificada (Google Fact Check) y cómo la cubren los medios en los últimos 7 días
            (GDELT). Busca temas y afirmaciones, no personas.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {canEdit && <RadarSearchForm factCheckReady={configured.factcheck} />}
          <SearchResults checks={checks.searches} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Menciones con indicadores</CardTitle>
          <CardDescription>
            Menciones que contienen un indicador (URL, dominio, etiqueta o nombre de página) de un reporte abierto o en
            seguimiento. Sirve para seguir páginas falsas, rumores y campañas por su contenido. Últimos {DAYS} días.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CiMatches matches={overview.matches} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Posibles amenazas</CardTitle>
          <CardDescription>
            Menciones de gravedad alta o emergencia sobre violencia o seguridad pública. Los ciudadanos aparecen sin nombre.
            Últimos {DAYS} días.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CiThreats threats={overview.threats} />
        </CardContent>
      </Card>
    </div>
  );
}
