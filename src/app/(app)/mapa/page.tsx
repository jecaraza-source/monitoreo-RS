import type { Metadata } from "next";
import { Map } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui-kit";
import { requireSection } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Mapa" };

export default async function MapaPage() {
  await requireSection("/mapa");

  return (
    <>
      <PageHeader title="Mapa" description="Menciones y sentimiento por colonia." />
      <EmptyState
        icon={<Map />}
        title="El mapa de colonias está en construcción"
        description="Mostrará la concentración de menciones y el sentimiento predominante en cada colonia."
      />
    </>
  );
}
