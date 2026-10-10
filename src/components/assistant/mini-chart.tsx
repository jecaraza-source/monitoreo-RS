"use client";

import { Area, AreaChart, Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ToolChart } from "@/lib/ai/tools";
import { AXIS_TICK, TOOLTIP_STYLE } from "@/components/dashboard/chart-theme";

const nf = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });

/** Small chart under an answer: daily series by sentiment or horizontal bars. */
export function MiniChart({ chart }: { chart: ToolChart }) {
  if (chart.kind === "series") {
    return (
      <figure className="rounded-lg border bg-background/60 p-3">
        <figcaption className="mb-2 text-xs font-medium text-muted-foreground">{chart.title}</figcaption>
        <div className="h-36">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chart.data} margin={{ top: 4, right: 4, bottom: 0, left: -24 }} accessibilityLayer aria-label={chart.title}>
              <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v, name) => [nf.format(Number(v)), name]} />
              <Area type="monotone" dataKey="negative" name="Negativas" stackId="s" stroke="var(--negative)" fill="var(--negative)" fillOpacity={0.5} />
              <Area type="monotone" dataKey="neutral" name="Neutrales" stackId="s" stroke="var(--neutral)" fill="var(--neutral)" fillOpacity={0.4} />
              <Area type="monotone" dataKey="positive" name="Positivas" stackId="s" stroke="var(--positive)" fill="var(--positive)" fillOpacity={0.5} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </figure>
    );
  }
  const height = Math.max(96, chart.data.length * 26 + 16);
  const diverging = chart.data.some((d) => d.value < 0);
  return (
    <figure className="rounded-lg border bg-background/60 p-3">
      <figcaption className="mb-2 text-xs font-medium text-muted-foreground">{chart.title}</figcaption>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chart.data} layout="vertical" margin={{ top: 0, right: 28, bottom: 0, left: 4 }} accessibilityLayer aria-label={chart.title}>
            <XAxis type="number" hide domain={diverging ? [-100, 100] : [0, "dataMax"]} />
            <YAxis
              type="category"
              dataKey="label"
              width={128}
              tick={{ ...AXIS_TICK, fill: "var(--foreground)" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: string) => (v.length > 18 ? `${v.slice(0, 17)}…` : v)}
            />
            <Tooltip {...TOOLTIP_STYLE} separator="" formatter={(v) => [`${nf.format(Number(v))} ${chart.unit}`, ""]} cursor={{ fill: "var(--muted)", opacity: 0.5 }} />
            <Bar
              dataKey="value"
              radius={4}
              label={{ position: "right", fontSize: 11, fill: "var(--muted-foreground)", formatter: (v: unknown) => nf.format(Number(v)) }}
            >
              {chart.data.map((d) => (
                <Cell key={d.label} fill={diverging ? (d.value >= 5 ? "var(--positive)" : d.value <= -5 ? "var(--negative)" : "var(--neutral)") : "var(--primary)"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
