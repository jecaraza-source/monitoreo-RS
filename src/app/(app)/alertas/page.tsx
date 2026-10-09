import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { Siren } from "lucide-react";
import { AlertsFeed } from "@/components/alerts/alerts-feed";
import { RulesPanel } from "@/components/alerts/rules-panel";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { canAccessPath } from "@/lib/auth/roles";
import { requireSection } from "@/lib/auth/session";
import { getAlerts } from "@/lib/alerts/data";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Alertas" };

export default function AlertasPage({ searchParams }: PageProps<"/alertas">) {
  return (
    <Suspense fallback={<AlertsSkeleton />}>
      <Alerts searchParams={searchParams} />
    </Suspense>
  );
}

async function Alerts({ searchParams }: { searchParams: PageProps<"/alertas">["searchParams"] }) {
  const member = await requireSection("/alertas");
  const highlight = (await searchParams).alerta;
  const supabase = await createClient();
  const [{ rules, events }, departments] = await Promise.all([
    getAlerts(member),
    supabase.from("departments").select("id, name").eq("org_id", member.orgId).order("name"),
  ]);
  const canEdit = member.role === "admin" || member.role === "comunicacion";

  return (
    <>
      <PageHeader
        title="Alertas"
        description="Picos, caídas de sentimiento, términos de riesgo, medios en contra y el resumen diario."
        actions={
          canAccessPath(member.role, "/alertas/crisis") && (
            <Link href="/alertas/crisis" className={buttonVariants({ variant: "destructive" })}>
              <Siren aria-hidden /> Sala de crisis
            </Link>
          )
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <AlertsFeed
          orgId={member.orgId}
          initialEvents={events}
          canRate={member.role !== "lectura"}
          highlightId={typeof highlight === "string" ? highlight : null}
        />
        {member.role !== "dependencia" && <RulesPanel rules={rules} departments={departments.data ?? []} canEdit={canEdit} />}
      </div>
    </>
  );
}

function AlertsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Cargando alertas">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    </div>
  );
}
