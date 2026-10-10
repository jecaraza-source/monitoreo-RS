import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { ReportView } from "@/components/reports/report-view";
import { Skeleton } from "@/components/ui/skeleton";
import { requireSection } from "@/lib/auth/session";
import { getReport } from "@/lib/reports/list";
import { REPORT_KIND_LABELS } from "@/lib/reports/period";

export const metadata: Metadata = { title: "Reporte" };
// Approving renders the PDF and may email it (Server Actions on this page).
export const maxDuration = 120;

export default function ReportePage({ params }: PageProps<"/reportes/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-[70svh]" />}>
      <Report params={params} />
    </Suspense>
  );
}

async function Report({ params }: { params: PageProps<"/reportes/[id]">["params"] }) {
  const member = await requireSection("/reportes");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const report = await getReport(member, id);
  if (!report) notFound();

  return (
    <>
      <Link href="/reportes" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Reportes
      </Link>
      <PageHeader title={`Reporte ${REPORT_KIND_LABELS[report.kind].toLowerCase()}`} description={report.facts.period.label} />
      <ReportView report={report} canEdit={member.role === "admin" || member.role === "comunicacion"} />
    </>
  );
}
