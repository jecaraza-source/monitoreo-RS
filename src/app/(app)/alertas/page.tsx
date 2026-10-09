import type { Metadata } from "next";
import { Bell } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui-kit";
import { requireSection } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Alertas" };

export default async function AlertasPage() {
  await requireSection("/alertas");

  return (
    <>
      <PageHeader title="Alertas" description="Picos de menciones y temas que requieren atención." />
      <EmptyState
        icon={<Bell />}
        title="Sin alertas activas"
        description="Te avisaremos aquí y por correo cuando una regla de alerta se active."
      />
    </>
  );
}
