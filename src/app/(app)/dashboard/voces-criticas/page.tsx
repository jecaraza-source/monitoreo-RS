import type { Metadata } from "next";
import { Suspense } from "react";
import { CriticalContent } from "@/components/critical/critical-content";
import { DashboardFrame } from "@/components/dashboard/dashboard-frame";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { DashboardTabs } from "@/components/dashboard/dashboard-tabs";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import { requireSection } from "@/lib/auth/session";
import { getCriticalVoices } from "@/lib/critical/data";
import { parsePeriod } from "@/lib/dashboard/period";

export const metadata: Metadata = { title: "Voces críticas" };

export default function CriticalVoicesPage({ searchParams }: PageProps<"/dashboard/voces-criticas">) {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <CriticalVoices searchParams={searchParams} />
    </Suspense>
  );
}

async function CriticalVoices({ searchParams }: { searchParams: PageProps<"/dashboard/voces-criticas">["searchParams"] }) {
  const member = await requireSection("/dashboard/voces-criticas");
  const period = parsePeriod(await searchParams);
  const data = await getCriticalVoices(member, period);

  return (
    <DashboardFrame
      title="Voces críticas"
      description="Qué se critica, dónde y si va en aumento. Sin identidades."
      toolbar={<PeriodSelector basePath="/dashboard/voces-criticas" />}
    >
      <DashboardTabs />
      <CriticalContent data={data} period={period} />
    </DashboardFrame>
  );
}
