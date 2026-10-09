import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Clock, Frown, Inbox, MessagesSquare, Ticket } from "lucide-react";
import { SentimentTrendChart, type SentimentPoint } from "@/components/dev/sentiment-trend-chart";
import { ToastDemo } from "@/components/dev/toast-demo";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import { ChartCard, EmptyState, KpiCard, PageTransition, SentimentBadge } from "@/components/ui-kit";

export const metadata: Metadata = { title: "UI kit", robots: { index: false } };

// Fixed sample data so the page is fully static.
const TREND: SentimentPoint[] = [
  [42, 61, 33], [38, 58, 41], [51, 64, 29], [47, 70, 36], [55, 66, 52], [60, 72, 47], [58, 69, 38],
  [63, 75, 35], [59, 71, 44], [66, 78, 31], [61, 74, 28], [70, 80, 33], [68, 77, 30], [74, 82, 26],
].map(([positive, neutral, negative], i) => ({ day: `${i + 1} oct`, positive, neutral, negative }));

const SWATCHES = [
  ["--brand", "Marca"], ["--brand-secondary", "Marca secundaria"], ["--brand-muted", "Marca tenue"],
  ["--positive", "Positivo"], ["--neutral", "Neutral"], ["--negative", "Negativo"],
  ["--chart-3", "Gráfica 3"], ["--chart-4", "Gráfica 4"], ["--chart-5", "Gráfica 5"],
] as const;

export default function UiKitPage() {
  // Showcase for development and previews only.
  if (process.env.VERCEL_ENV === "production") notFound();

  return (
    <PageTransition className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-10 md:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">components/ui-kit</p>
          <h1 className="text-3xl font-semibold tracking-tight">Primitivas de interfaz</h1>
        </div>
        <ThemeToggle />
      </header>

      <Section title="KpiCard" note="Número animado y variación vs. periodo anterior. El color depende de si subir es bueno.">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard index={0} label="Menciones" value={1284} previousValue={1102} icon={<MessagesSquare />} />
          <KpiCard
            index={1}
            label="Menciones negativas"
            value={0.231}
            previousValue={0.274}
            higherIsBetter={false}
            formatOptions={{ style: "percent", maximumFractionDigits: 1 }}
            icon={<Frown />}
          />
          <KpiCard
            index={2}
            label="Tiempo de respuesta"
            value={31.5}
            previousValue={26}
            higherIsBetter={false}
            formatOptions={{ maximumFractionDigits: 1, style: "unit", unit: "hour" }}
            icon={<Clock />}
          />
          <KpiCard index={3} label="Tickets resueltos" value={86} previousValue={86} icon={<Ticket />} />
        </div>
      </Section>

      <Section title="SentimentBadge">
        <div className="flex flex-wrap items-center gap-3">
          <SentimentBadge sentiment="positive" />
          <SentimentBadge sentiment="neutral" />
          <SentimentBadge sentiment="negative" />
          <SentimentBadge sentiment="negative" confidence={0.93} />
        </div>
      </Section>

      <Section title="ChartCard" note="Con gráfica de Recharts y en estado de carga.">
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Sentimiento por día" description="Menciones clasificadas, últimos 14 días">
            <SentimentTrendChart data={TREND} />
          </ChartCard>
          <ChartCard title="Menciones por colonia" description="Cargando…" loading index={1} />
        </div>
      </Section>

      <Section title="EmptyState">
        <EmptyState
          icon={<Inbox />}
          title="Tu bandeja está vacía"
          description="Cuando una mención se turne a tu área aparecerá aquí."
          action={<Button variant="outline">Ver todas las menciones</Button>}
        />
      </Section>

      <Section title="Notificaciones (toast)">
        <ToastDemo />
      </Section>

      <Section
        title="Paleta"
        note="Variables CSS. Para aplicar los colores del municipio basta con sobrescribir las --brand-*."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {SWATCHES.map(([token, label]) => (
            <div key={token} className="flex items-center gap-3 rounded-lg border p-3">
              <span className="size-8 shrink-0 rounded-md ring-1 ring-foreground/10" style={{ background: `var(${token})` }} />
              <span className="flex flex-col">
                <span className="text-sm">{label}</span>
                <code className="text-xs text-muted-foreground">{token}</code>
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="PageTransition" note="Esta página entra con PageTransition; las del app la usan desde app/(app)/template.tsx." />
    </PageTransition>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium">{title}</h2>
        {note && <p className="text-sm text-muted-foreground">{note}</p>}
      </div>
      {children}
    </section>
  );
}
