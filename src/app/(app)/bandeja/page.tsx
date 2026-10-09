import type { Metadata } from "next";
import { Inbox } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui-kit";
import { requireSection } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Bandeja" };

export default async function BandejaPage() {
  await requireSection("/bandeja");

  return (
    <>
      <PageHeader title="Bandeja" description="Menciones por atender y tickets turnados." />
      <EmptyState
        icon={<Inbox />}
        title="Tu bandeja está vacía"
        description="Cuando una mención se turne a tu área aparecerá aquí con su prioridad y fecha límite."
      />
    </>
  );
}
