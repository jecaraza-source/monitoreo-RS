import { AlarmClock, CheckCircle2, FolderOpen, FolderPlus, Gauge, MessageSquareWarning, MessagesSquare, RotateCcw, Share2, ThumbsDown, Timer, TimerReset } from "lucide-react";
import { KpiCard } from "@/components/ui-kit";
import { FAMILY_LABELS, type KpiFamily, type KpiUnit } from "@/lib/kpi/dictionary";
import type { KpiValue } from "@/lib/kpi/snapshot";
import { cn } from "@/lib/utils";
import { KpiDefinitionInfo } from "./kpi-definition";

const FORMAT: Record<KpiUnit, Intl.NumberFormatOptions> = {
  menciones: { maximumFractionDigits: 0 },
  interacciones: { maximumFractionDigits: 0 },
  casos: { maximumFractionDigits: 0 },
  puntos: { maximumFractionDigits: 0, signDisplay: "exceptZero" },
  "%": { style: "unit", unit: "percent", maximumFractionDigits: 1 },
  horas: { style: "unit", unit: "hour", maximumFractionDigits: 1 },
};

const ICONS: Record<string, React.ReactNode> = {
  mentions: <MessagesSquare />,
  nss: <Gauge />,
  negative_pct: <ThumbsDown />,
  complaints: <MessageSquareWarning />,
  interactions: <Share2 />,
  cases_opened: <FolderPlus />,
  open_at_cut: <FolderOpen />,
  overdue_at_cut: <AlarmClock />,
  first_attention_h: <TimerReset />,
  resolution_h: <Timer />,
  validated_closures: <CheckCircle2 />,
  reopenings: <RotateCcw />,
};

const UNIT_NOTE: Record<KpiFamily, string> = {
  conversacion: "Unidad: menciones (publicaciones). Una queja publicada muchas veces cuenta muchas veces; no son incidentes.",
  atencion: "Unidad: casos (incidentes) y horas. Un caso agrupa las menciones de un mismo problema; los fusionados no cuentan.",
};

/** One family of KPIs with its dictionary behind each (i). Keys not listed are left out (coverage figures go elsewhere). */
export function KpiSection({
  family,
  values,
  keys,
  startIndex = 0,
  children,
}: {
  family: KpiFamily;
  values: KpiValue[];
  keys: string[];
  startIndex?: number;
  children?: React.ReactNode;
}) {
  const shown = keys.map((k) => values.find((v) => v.def.key === k)).filter((v): v is KpiValue => Boolean(v));
  const id = `kpi-${family}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h2 id={id} className="text-lg font-semibold tracking-tight">
          {FAMILY_LABELS[family]}
        </h2>
        <p className="text-xs text-muted-foreground">{UNIT_NOTE[family]}</p>
      </div>
      <div className={cn("grid grid-cols-2 gap-3 sm:gap-4", shown.length > 5 ? "lg:grid-cols-4" : "lg:grid-cols-5")}>
        {shown.map((v, i) => (
          <KpiCard
            key={v.def.key}
            index={startIndex + i}
            label={v.def.label}
            info={<KpiDefinitionInfo def={v.def} />}
            value={v.value}
            // A change that cannot be compared (thin medians) is not drawn.
            previousValue={v.change === null && v.value !== null && v.previous !== null ? undefined : v.previous}
            deltaMode={v.changeUnit === "puntos" ? "points" : "relative"}
            higherIsBetter={v.def.direction === "none" ? null : v.def.direction === "up"}
            formatOptions={FORMAT[v.def.unit]}
            icon={ICONS[v.def.key]}
            footnote={footnote(v)}
          />
        ))}
      </div>
      {children}
    </section>
  );
}

function footnote(v: KpiValue): string | null {
  const parts: string[] = [];
  if (v.def.unit === "horas") parts.push(`n = ${v.n ?? 0} ${v.n === 1 ? "caso" : "casos"}`);
  else if (v.n !== null && (v.def.unit === "%" || v.def.unit === "puntos")) parts.push(`sobre ${v.n} clasificadas`);
  if (v.detail) parts.push(v.detail);
  if (v.def.unit === "horas" && v.change === null && v.value !== null) parts.push("pocos casos para comparar");
  return parts.length ? parts.join(" · ") : null;
}
