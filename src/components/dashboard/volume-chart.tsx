"use client";

import { useRef } from "react";
import { CartesianGrid, LabelList, Legend, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { findPeaks, inboxHref, type SeriesPoint } from "@/lib/dashboard/model";
import { toMxDay } from "@/lib/dashboard/period";
import { AXIS_TICK, bucketLabel, bucketTick, formatNumber, SENTIMENT_SERIES, TOOLTIP_STYLE } from "./chart-theme";
import { useDashboardFrame } from "./dashboard-frame";

type Row = SeriesPoint & { total: number };

export function VolumeChart({ series, bucket }: { series: SeriesPoint[]; bucket: "hour" | "day" }) {
  const { navigate } = useDashboardFrame();
  const data: Row[] = series.map((p) => ({ ...p, total: p.positive + p.neutral + p.negative + p.pending }));
  const peaks = findPeaks(series);
  const last = data.length - 1;
  // Recharts reports the hovered point on mouse move; clicks use the last one.
  const hovered = useRef<number | null>(null);

  // Click a point → the inbox for that calendar day.
  function open(index: number | undefined) {
    const point = index == null ? undefined : data[index];
    if (!point) return;
    const day = toMxDay(new Date(point.bucket));
    navigate(inboxHref({ fromDay: day, toDay: day }));
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart
        data={data}
        margin={{ top: 24, right: 72, bottom: 0, left: 4 }}
        onMouseMove={(state) => {
          hovered.current = state?.activeTooltipIndex == null ? null : Number(state.activeTooltipIndex);
        }}
        onMouseLeave={() => {
          hovered.current = null;
        }}
        onClick={() => open(hovered.current ?? undefined)}
        className="cursor-pointer"
        accessibilityLayer
      >
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="bucket"
          tickFormatter={(v: string) => bucketTick(v, bucket)}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
          tick={AXIS_TICK}
        />
        <YAxis tickLine={false} axisLine={false} allowDecimals={false} tick={AXIS_TICK} width={32} />
        <Tooltip
          cursor={{ stroke: "var(--muted-foreground)" }}
          {...TOOLTIP_STYLE}
          labelFormatter={(v) => bucketLabel(String(v), bucket)}
          formatter={(value, name) => [formatNumber(Number(value)), SENTIMENT_SERIES.find((s) => s.key === name)?.label ?? name]}
        />
        <Legend
          verticalAlign="top"
          align="left"
          iconType="plainline"
          itemSorter={null}
          height={28}
          formatter={(value) => <span className="text-xs text-muted-foreground">{SENTIMENT_SERIES.find((s) => s.key === value)?.label}</span>}
        />
        {SENTIMENT_SERIES.map((s) => (
          <Line
            key={s.key}
            dataKey={s.key}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--card)" }}
            animationDuration={800}
          >
            {/* Direct label at the end of each line, so identity is not color alone. */}
            <LabelList
              dataKey={s.key}
              content={(props) =>
                props.index === last ? (
                  <text x={Number(props.x) + 8} y={Number(props.y)} dy={4} fontSize={12} fill="var(--muted-foreground)">
                    {s.label}
                  </text>
                ) : null
              }
            />
          </Line>
        ))}
        {peaks.map((i) => (
          <ReferenceDot
            key={data[i].bucket}
            x={data[i].bucket}
            y={Math.max(data[i].positive, data[i].neutral, data[i].negative)}
            r={5}
            fill="var(--foreground)"
            stroke="var(--card)"
            strokeWidth={2}
            label={{
              value: `Pico · ${formatNumber(data[i].total)}`,
              position: "top",
              fill: "var(--foreground)",
              fontSize: 12,
              fontWeight: 500,
            }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
