import type { Metadata } from "next";
import { LayoutDashboard } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui-kit";
import { requireSection } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  await requireSection("/dashboard");

  return (
    <>
      <PageHeader title="Dashboard" description="Resumen ejecutivo de menciones, sentimiento y atención." />
      <EmptyState
        icon={<LayoutDashboard />}
        title="Aquí verás los indicadores del proyecto activo"
        description="Sentimiento, volumen de menciones, tiempos de atención y temas principales, comparados con el periodo anterior."
      />
    </>
  );
}
