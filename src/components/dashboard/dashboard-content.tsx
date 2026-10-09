import { AlarmClock, Gauge, MessagesSquare, ThumbsDown, Timer } from "lucide-react";
import { ChartCard, EmptyState, KpiCard } from "@/components/ui-kit";
import type { Dashboard } from "@/lib/dashboard/data";
import { inboxHref, negativeShare, nss } from "@/lib/dashboard/model";
import type { Period } from "@/lib/dashboard/period";
import { bucketLabel, formatNumber, NSS_ROW_HEIGHT } from "./chart-theme";
import { DailyReading } from "./daily-reading";
import { DataTable } from "./data-table";
import { LazyNeighborhoodsMap, LazyNssBars, LazyVolumeChart } from "./lazy-charts";
import type { MapFeature } from "./neighborhoods-map-canvas";
import type { NssBar } from "./nss-bars";
import { TopMedia, TopMentions } from "./rankings";

const INTEGER: Intl.NumberFormatOptions = { maximumFractionDigits: 0 };
const SCORE: Intl.NumberFormatOptions = { maximumFractionDigits: 0, signDisplay: "exceptZero" };
const PERCENT: Intl.NumberFormatOptions = { style: "unit", unit: "percent", maximumFractionDigits: 1 };
const HOURS: Intl.NumberFormatOptions = { style: "unit", unit: "hour", maximumFractionDigits: 1 };
const signed = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0, signDisplay: "exceptZero" });

const barsHeight = (rows: number) => Math.max(rows, 3) * NSS_ROW_HEIGHT + 32;

export function DashboardContent({ data, period }: { data: Dashboard; period: Period }) {
  const { totals, previous } = data;
  const empty = totals.mentions === 0;

  const topicBars: NssBar[] = data.topics.map((t) => ({
    key: t.topic,
    label: t.topic,
    nss: t.nss,
    total: t.total,
    positive: t.positive,
    negative: t.negative,
    href: inboxHref(period, { topic: t.topic }),
  }));
  const departmentBars: NssBar[] = data.departments.map((d) => ({
    key: d.id,
    label: d.name,
    nss: d.nss,
    total: d.total,
    positive: d.positive,
    negative: d.negative,
    href: inboxHref(period, { department: d.id }),
  }));

  const stats = new Map(data.neighborhoods.map((n) => [n.id, n]));
  const mapFeatures: MapFeature[] = data.neighborhoodShapes
    .filter((s) => s.geometry)
    .map((s) => ({
      id: s.id,
      name: s.name,
      complaints: stats.get(s.id)?.complaints ?? 0,
      total: stats.get(s.id)?.total ?? 0,
      href: inboxHref(period, { neighborhood: s.id }),
      geometry: s.geometry!,
    }));
  const maxComplaints = Math.max(0, ...mapFeatures.map((f) => f.complaints));
  const neighborhoodRows = data.neighborhoodShapes
    .map((s) => ({ name: s.name, ...(stats.get(s.id) ?? { complaints: 0, total: 0, negative: 0 }) }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.complaints - a.complaints);

  return (
    <>
      {/* Section headings keep the outline h1 → h2 → h3 for screen readers. */}
      <h2 className="sr-only">Indicadores</h2>
      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <KpiCard
          index={0}
          label="Menciones"
          value={totals.mentions}
          previousValue={previous.mentions}
          higherIsBetter={null}
          formatOptions={INTEGER}
          icon={<MessagesSquare />}
        />
        <KpiCard
          index={1}
          label="Net Sentiment Score"
          value={nss(totals.positive, totals.negative, totals.classified)}
          previousValue={previous.classified ? nss(previous.positive, previous.negative, previous.classified) : null}
          deltaMode="points"
          formatOptions={SCORE}
          icon={<Gauge />}
        />
        <KpiCard
          index={2}
          label="% negativo"
          value={negativeShare(totals)}
          previousValue={previous.classified ? negativeShare(previous) : null}
          deltaMode="points"
          higherIsBetter={false}
          formatOptions={PERCENT}
          icon={<ThumbsDown />}
        />
        <KpiCard
          index={3}
          label="Quejas abiertas"
          value={totals.openTickets}
          previousValue={previous.openTickets}
          higherIsBetter={false}
          formatOptions={INTEGER}
          icon={<AlarmClock />}
        />
        <KpiCard
          index={4}
          label="Tiempo medio de atención"
          value={totals.attentionHours ?? 0}
          previousValue={totals.attentionHours == null ? undefined : previous.attentionHours}
          higherIsBetter={false}
          formatOptions={HOURS}
          comparisonLabel={totals.attentionHours == null ? undefined : "vs. periodo anterior"}
          icon={<Timer />}
          className="col-span-2 lg:col-span-1"
        />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <DailyReading index={5} />
        </div>
        <ChartCard
          index={6}
          className="lg:col-span-8"
          title="Volumen por sentimiento"
          description="Clic en un punto para ver las menciones de ese día."
          height={280}
          footer={
            <DataTable
              caption="Menciones por sentimiento"
              columns={[period.bucket === "hour" ? "Hora" : "Día", "Positivo", "Neutral", "Negativo", "Pendiente"]}
              rows={data.series.map((p) => [bucketLabel(p.bucket, period.bucket), p.positive, p.neutral, p.negative, p.pending])}
            />
          }
        >
          {empty ? <EmptyChart /> : <LazyVolumeChart series={data.series} bucket={period.bucket} />}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          index={7}
          title="Temas por NSS"
          description="Los temas con más menciones, del peor al mejor tono. Clic para abrir la bandeja."
          height={barsHeight(topicBars.length)}
          footer={
            <DataTable
              caption="Temas por NSS"
              columns={["Tema", "NSS", "Menciones", "Negativas"]}
              rows={topicBars.map((b) => [b.label, signed.format(b.nss), b.total, b.negative])}
            />
          }
        >
          {topicBars.length ? <LazyNssBars rows={topicBars} label="Temas por Net Sentiment Score" /> : <EmptyChart />}
        </ChartCard>
        <ChartCard
          index={8}
          title="Dependencias por NSS"
          description="Tono de lo que se dice de cada dependencia. Clic para ver sus menciones."
          height={barsHeight(departmentBars.length)}
          footer={
            <DataTable
              caption="Dependencias por NSS"
              columns={["Dependencia", "NSS", "Menciones", "Negativas"]}
              rows={departmentBars.map((b) => [b.label, signed.format(b.nss), b.total, b.negative])}
            />
          }
        >
          {departmentBars.length ? <LazyNssBars rows={departmentBars} label="Dependencias por Net Sentiment Score" /> : <EmptyChart />}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <ChartCard
          index={9}
          className="lg:col-span-7"
          title="Quejas por colonia"
          description="Más intenso, más quejas y denuncias. Clic en una colonia para ver sus menciones."
          height={360}
          action={<ComplaintsLegend max={maxComplaints} />}
          footer={
            <DataTable
              caption="Quejas por colonia"
              columns={["Colonia", "Quejas", "Menciones", "Negativas"]}
              rows={neighborhoodRows.map((r) => [r.name, r.complaints, r.total, r.negative])}
            />
          }
        >
          {mapFeatures.length ? (
            <LazyNeighborhoodsMap features={mapFeatures} max={maxComplaints} />
          ) : (
            <EmptyState
              title="Faltan los polígonos de las colonias"
              description="Súbelos como GeoJSON en Configuración → Catálogos para ver el mapa."
              className="h-full"
            />
          )}
        </ChartCard>
        <div className="flex flex-col gap-4 lg:col-span-5">
          <TopMentions mentions={data.topMentions} period={period} index={10} />
          <TopMedia media={data.topMedia} period={period} index={11} />
        </div>
      </div>
    </>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-full items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
      Sin menciones en este periodo.
    </div>
  );
}

function ComplaintsLegend({ max }: { max: number }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-label={`Escala de quejas de 0 a ${max}`}>
      <span>0</span>
      <span
        aria-hidden
        className="h-2 w-20 rounded-full"
        style={{ background: "linear-gradient(to right, color-mix(in oklch, var(--negative) 6%, transparent), color-mix(in oklch, var(--negative) 72%, transparent))" }}
      />
      <span>{formatNumber(max)}</span>
    </div>
  );
}
