"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS_TICK, SENTIMENT_SERIES, TOOLTIP_STYLE } from "@/components/dashboard/chart-theme";

export type MinutePoint = { minute: string; positive: number; neutral: number; negative: number; pending: number };

const clock = new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" });
const SERIES = [...SENTIMENT_SERIES, { key: "pending", label: "Por clasificar", color: "var(--muted-foreground)" }] as const;

/** Mentions per minute, stacked by sentiment (2px gaps between segments). */
export function MinuteChart({ data }: { data: MinutePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap={1} accessibilityLayer>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="minute"
          tickFormatter={(v: string) => clock.format(new Date(v))}
          tickLine={false}
          axisLine={false}
          minTickGap={32}
          tick={AXIS_TICK}
        />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={AXIS_TICK} width={28} />
        <Tooltip
          cursor={{ fill: "var(--muted)", opacity: 0.5 }}
          {...TOOLTIP_STYLE}
          labelFormatter={(v) => clock.format(new Date(String(v)))}
          formatter={(value, name) => [value, SERIES.find((s) => s.key === name)?.label ?? name]}
        />
        <Legend
          verticalAlign="top"
          align="left"
          height={24}
          iconType="square"
          itemSorter={null}
          formatter={(value) => <span className="text-xs text-muted-foreground">{SERIES.find((s) => s.key === value)?.label}</span>}
        />
        {SERIES.map((s) => (
          <Bar key={s.key} dataKey={s.key} stackId="m" fill={s.color} stroke="var(--card)" strokeWidth={1} isAnimationActive={false} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
