import type { Metadata } from "next";
import { Suspense } from "react";
import { DashboardContent } from "@/components/dashboard/dashboard-content";
import { DashboardFrame } from "@/components/dashboard/dashboard-frame";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import { requireSection } from "@/lib/auth/session";
import { getDashboard } from "@/lib/dashboard/data";
import { parsePeriod } from "@/lib/dashboard/period";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <Dashboard searchParams={searchParams} />
    </Suspense>
  );
}

async function Dashboard({ searchParams }: { searchParams: PageProps<"/dashboard">["searchParams"] }) {
  const member = await requireSection("/dashboard");
  const period = parsePeriod(await searchParams);
  const data = await getDashboard(member, period);

  return (
    <DashboardFrame toolbar={<PeriodSelector />}>
      <DashboardContent data={data} period={period} member={member} />
    </DashboardFrame>
  );
}
