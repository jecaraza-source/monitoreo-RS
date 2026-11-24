"use client";

import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS_TICK, bucketLabel, bucketTick, formatNumber, TOOLTIP_STYLE } from "@/components/dashboard/chart-theme";
import type { CriticalPoint } from "@/lib/critical/model";

const pct = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });

/** Negative mentions per bucket (bars) and their share of the classified ones (line). */
export function NegativeTrend({ series, bucket }: { series: CriticalPoint[]; bucket: "hour" | "day" }) {
  const data = series.map((p) => ({ ...p, share: p.classified > 0 ? (p.negative / p.classified) * 100 : null }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }} accessibilityLayer>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="bucket" tickFormatter={(v: string) => bucketTick(v, bucket)} tickLine={false} axisLine={false} minTickGap={24} tick={AXIS_TICK} />
        <YAxis yAxisId="n" tickLine={false} axisLine={false} allowDecimals={false} tick={AXIS_TICK} width={32} />
        <YAxis yAxisId="p" orientation="right" domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} tickLine={false} axisLine={false} tick={AXIS_TICK} width={40} />
        <Tooltip
          {...TOOLTIP_STYLE}
          labelFormatter={(v) => bucketLabel(String(v), bucket)}
          formatter={(value, name) =>
            name === "share" ? [value == null ? "—" : `${pct.format(Number(value))} %`, "% negativo"] : [formatNumber(Number(value)), "Negativas"]
          }
        />
        <Bar yAxisId="n" dataKey="negative" fill="var(--negative)" fillOpacity={0.75} radius={[3, 3, 0, 0]} maxBarSize={28} />
        <Line yAxisId="p" dataKey="share" stroke="var(--muted-foreground)" strokeWidth={2} dot={false} connectNulls />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
