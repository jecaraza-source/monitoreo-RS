import type { Metadata } from "next";
import { Suspense } from "react";
import { DashboardFrame } from "@/components/dashboard/dashboard-frame";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import { OfficialsContent } from "@/components/officials/officials-content";
import { requireSection } from "@/lib/auth/session";
import { parsePeriod } from "@/lib/dashboard/period";
import { getOfficialMentions, getOfficialsStats, type OfficialMention } from "@/lib/officials/data";

export const metadata: Metadata = { title: "Percepción de funcionarios" };

const SENTIMENTS = ["positive", "neutral", "negative"] as const;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default function OfficialsPage({ searchParams }: PageProps<"/funcionarios">) {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <Officials searchParams={searchParams} />
    </Suspense>
  );
}

async function Officials({ searchParams }: { searchParams: PageProps<"/funcionarios">["searchParams"] }) {
  // Section + per-user grant (admins always; others when an admin authorizes them).
  const member = await requireSection("/funcionarios");
  const params = await searchParams;
  const period = parsePeriod(params);
  const officials = await getOfficialsStats(member, period);

  const requested = first(params.funcionario);
  const selected = officials.find((o) => o.id === requested) ?? officials.find((o) => o.mentions > 0) ?? officials[0] ?? null;
  const rawSentiment = first(params.sentimiento);
  const sentiment = SENTIMENTS.find((s) => s === rawSentiment) ?? null;
  const mentions: OfficialMention[] = selected ? await getOfficialMentions(member, selected.id, period, sentiment) : [];

  return (
    <DashboardFrame
      title="Percepción de funcionarios"
      description="Lo que la ciudadanía dice de la gestión del presidente municipal y los funcionarios."
      toolbar={<PeriodSelector basePath="/funcionarios" />}
    >
      <OfficialsContent
        officials={officials}
        selected={selected}
        mentions={mentions}
        sentiment={sentiment}
        period={period}
        isAdmin={member.role === "admin"}
      />
    </DashboardFrame>
  );
}
