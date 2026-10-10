import type { Metadata } from "next";
import { Suspense } from "react";
import { AssistantChat } from "@/components/assistant/chat";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { SUGGESTED_QUESTIONS } from "@/lib/ai/assistant";
import { requireSection } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Asistente" };

export default function AsistentePage() {
  return (
    <Suspense fallback={<Skeleton className="h-[60svh]" />}>
      <Assistant />
    </Suspense>
  );
}

async function Assistant() {
  const member = await requireSection("/asistente");
  return (
    <>
      <PageHeader title="Asistente" description="Pregunta en lenguaje natural sobre las menciones y la atención ciudadana." />
      <AssistantChat
        suggestions={SUGGESTED_QUESTIONS}
        scopeNote={member.role === "dependencia" ? `Sólo veo lo turnado a ${member.departmentName ?? "tu dependencia"}.` : null}
      />
    </>
  );
}
