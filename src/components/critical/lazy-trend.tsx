"use client";

import dynamic from "next/dynamic";
import { WhenVisible } from "@/components/dashboard/when-visible";
import { Skeleton } from "@/components/ui/skeleton";
import type { CriticalPoint } from "@/lib/critical/model";

// Recharts loads in its own chunk, only when the chart is about to be seen.
const NegativeTrend = dynamic(() => import("./negative-trend").then((m) => m.NegativeTrend), {
  ssr: false,
  loading: () => <Skeleton className="size-full" />,
});

export function LazyNegativeTrend(props: { series: CriticalPoint[]; bucket: "hour" | "day" }) {
  return (
    <WhenVisible>
      <NegativeTrend {...props} />
    </WhenVisible>
  );
}
