import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { GenerateReport } from "@/components/reports/generate-report";
import { ReportList } from "@/components/reports/report-list";
import { ReportSettings } from "@/components/reports/report-settings";
import { Skeleton } from "@/components/ui/skeleton";
import { requireSection } from "@/lib/auth/session";
import { getReports } from "@/lib/reports/list";

export const metadata: Metadata = { title: "Reportes" };
// Generating a report waits for Claude (Server Action on this page).
export const maxDuration = 120;

export default function ReportesPage() {
  return (
    <Suspense fallback={<ReportsSkeleton />}>
      <Reports />
    </Suspense>
  );
}

async function Reports() {
  const member = await requireSection("/reportes");
  const { reports, schedules, brand } = await getReports(member);
  const canEdit = member.role === "admin" || member.role === "comunicacion";

  return (
    <>
      <PageHeader
        title="Reportes"
        description="Reportes diario, semanal y mensual con narrativa redactada por IA a partir de las cifras del sistema."
        actions={canEdit && <GenerateReport />}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <ReportList reports={reports} />
        <ReportSettings schedules={schedules} brand={brand} canEdit={canEdit} canEditBrand={member.role === "admin"} />
      </div>
    </>
  );
}

function ReportsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Cargando reportes">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    </div>
  );
}
