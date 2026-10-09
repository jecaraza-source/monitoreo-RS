import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui-kit";
import { requireSection } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Reportes" };

export default async function ReportesPage() {
  await requireSection("/reportes");

  return (
    <>
      <PageHeader title="Reportes" description="Reportes periódicos con narrativa estratégica." />
      <EmptyState
        icon={<FileText />}
        title="Aún no hay reportes"
        description="Los reportes diarios, semanales y mensuales se generarán automáticamente."
      />
    </>
  );
}
