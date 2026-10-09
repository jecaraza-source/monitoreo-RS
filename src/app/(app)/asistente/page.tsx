import type { Metadata } from "next";
import { Bot } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui-kit";
import { requireSection } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Asistente" };

export default async function AsistentePage() {
  await requireSection("/asistente");

  return (
    <>
      <PageHeader title="Asistente" description="Pregunta sobre las menciones y la conversación pública." />
      <EmptyState
        icon={<Bot />}
        title="El asistente estará disponible pronto"
        description="Podrás hacer preguntas en lenguaje natural sobre lo que se dice del municipio."
      />
    </>
  );
}
