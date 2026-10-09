"use client";

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS_TICK, formatNumber, TOOLTIP_STYLE } from "./chart-theme";
import { useDashboardFrame } from "./dashboard-frame";

export type NssBar = { key: string; label: string; nss: number; total: number; positive: number; negative: number; href: string };

/** |NSS| below this reads as balanced and stays gray (the diverging midpoint). */
const BALANCED = 5;

const tone = (nss: number) => (nss >= BALANCED ? "var(--positive)" : nss <= -BALANCED ? "var(--negative)" : "var(--neutral)");
const signed = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0, signDisplay: "exceptZero" });

/**
 * Horizontal diverging bars of Net Sentiment Score (−100…100), worst first.
 * Click a bar to open the inbox filtered by that topic or department.
 */
export function NssBars({ rows, label }: { rows: NssBar[]; label: string }) {
  const { navigate } = useDashboardFrame();

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={rows}
        layout="vertical"
        margin={{ top: 4, right: 40, bottom: 0, left: 8 }}
        barCategoryGap={6}
        accessibilityLayer
        aria-label={label}
      >
        <CartesianGrid horizontal={false} stroke="var(--border)" />
        <XAxis type="number" domain={[-125, 125]} ticks={[-100, -50, 0, 50, 100]} tickLine={false} axisLine={false} tick={AXIS_TICK} />
        <YAxis
          type="category"
          dataKey="label"
          width={132}
          tickLine={false}
          axisLine={false}
          tick={{ ...AXIS_TICK, fill: "var(--foreground)" }}
          tickFormatter={(v: string) => (v.length > 20 ? `${v.slice(0, 19)}…` : v)}
        />
        <ReferenceLine x={0} stroke="var(--muted-foreground)" />
        <Tooltip
          cursor={{ fill: "var(--muted)", opacity: 0.5 }}
          {...TOOLTIP_STYLE}
          formatter={(_value, _name, item) => {
            const row = item.payload as NssBar;
            return [
              `NSS ${signed.format(row.nss)} · ${formatNumber(row.total)} menciones (${formatNumber(row.positive)} positivas, ${formatNumber(row.negative)} negativas)`,
              "",
            ];
          }}
          separator=""
        />
        <Bar
          dataKey="nss"
          radius={4}
          maxBarSize={22}
          animationDuration={700}
          className="cursor-pointer"
          onClick={(entry) => navigate((entry.payload as NssBar).href)}
        >
          {rows.map((row) => (
            <Cell key={row.key} fill={tone(row.nss)} />
          ))}
          <LabelList
            dataKey="nss"
            position="right"
            formatter={(v) => signed.format(Number(v))}
            style={{ fill: "var(--muted-foreground)", fontSize: 12 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
