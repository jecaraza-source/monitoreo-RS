import type { Metadata } from "next";
import { Suspense } from "react";
import { ShieldAlert } from "lucide-react";
import { CiMatches } from "@/components/counterintel/ci-matches";
import { CiReportForm } from "@/components/counterintel/ci-report-form";
import { CiReports } from "@/components/counterintel/ci-reports";
import { CiThreats } from "@/components/counterintel/ci-threats";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { requireSection } from "@/lib/auth/session";
import { getOverview, getReports } from "@/lib/counterintel/data";

export const metadata: Metadata = { title: "Oficina de Contrainteligencia" };

const DAYS = 30;

export default function CounterintelPage() {
  return (
    <>
      <PageHeader
        title="Oficina de Contrainteligencia"
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
  const member = await requireSection("/contrainteligencia");
  const [overview, reports] = await Promise.all([getOverview(member, DAYS), getReports(member)]);
  const canEdit = member.role === "admin" || member.role === "comunicacion";

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        La oficina trabaja sobre contenidos, cuentas que se presentan como oficiales, dominios y narrativas. No se registra
        ni se da seguimiento a ciudadanos, periodistas u opositores por sus opiniones; las críticas no son desinformación.
      </p>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Registro de la oficina</CardTitle>
          <CardDescription>Lo que la oficina sigue, con sus indicadores y evidencias. Los reportes se cierran con una nota; no se borran.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {canEdit && <CiReportForm />}
          <CiReports reports={reports} canEdit={canEdit} />
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
