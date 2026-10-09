"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type SentimentPoint = { day: string; positive: number; neutral: number; negative: number };

// Sentiment is a diverging scale: green / gray midpoint / red, from CSS tokens
// so it follows the theme. Identity is never color alone: legend + tooltip.
const SERIES = [
  { key: "positive", label: "Positivo", color: "var(--positive)" },
  { key: "neutral", label: "Neutral", color: "var(--neutral)" },
  { key: "negative", label: "Negativo", color: "var(--negative)" },
] as const;

export function SentimentTrendChart({ data }: { data: SentimentPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="day" tickLine={false} axisLine={false} minTickGap={24} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
        <YAxis tickLine={false} axisLine={false} allowDecimals={false} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
        <Tooltip
          cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
          contentStyle={{
            background: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            color: "var(--popover-foreground)",
            fontSize: 12,
          }}
          labelStyle={{ color: "var(--muted-foreground)" }}
          formatter={(value, name) => [value, SERIES.find((s) => s.key === name)?.label ?? name]}
        />
        <Legend
          verticalAlign="top"
          align="right"
          iconType="plainline"
          // Keep series order (positive → negative) instead of alphabetical.
          itemSorter={null}
          height={28}
          formatter={(value) => (
            <span className="text-xs text-muted-foreground">{SERIES.find((s) => s.key === value)?.label}</span>
          )}
        />
        {SERIES.map((s) => (
          <Line
            key={s.key}
            dataKey={s.key}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
