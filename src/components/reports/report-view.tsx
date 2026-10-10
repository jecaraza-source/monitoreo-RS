import { ChartCard } from "@/components/ui-kit";
import { LazyNssBars, LazyVolumeChart } from "@/components/dashboard/lazy-charts";
import type { NssBar } from "@/components/dashboard/nss-bars";
import type { ReportRow } from "@/lib/reports/data";
import { cn } from "@/lib/utils";
import { NarrativeEditor } from "./narrative-editor";
import { ReportActions } from "./report-actions";
import { STATUS_LABELS, STATUS_TONE } from "./report-list";

const nf = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });
const signed = (v: number, unit: string) => `${v > 0 ? "+" : ""}${nf.format(v)}${unit === "%" ? "%" : " pts"}`;
const SENTIMENT_TONE: Record<string, string> = { positivo: "text-positive", negativo: "text-negative", neutral: "text-muted-foreground" };

export function ReportView({ report, canEdit }: { report: ReportRow; canEdit: boolean }) {
  const { facts } = report;
  const series = facts.series.map((s) => ({ ...s, pending: 0 }));
  const topicRows: NssBar[] = facts.top_topics.map((t) => ({
    key: t.topic,
    label: t.topic,
    nss: t.nss,
    total: t.mentions,
    positive: 0,
    negative: 0,
    href: "",
  }));
  const departmentRows: NssBar[] = facts.departments_by_nss.map((d) => ({
    key: d.department,
    label: d.department,
    nss: d.nss,
    total: d.mentions,
    positive: 0,
    negative: d.negative,
    href: "",
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
        <div className="flex flex-col gap-1">
          <span className={cn("w-fit rounded-full px-2 py-0.5 text-xs font-medium", STATUS_TONE[report.status])}>{STATUS_LABELS[report.status]}</span>
          <p className="text-sm text-muted-foreground">
            {report.status === "draft"
              ? "Revisa y edita la narrativa. Al aprobar se congela, se genera el PDF y se envía a los destinatarios."
              : report.sentAt
                ? `Enviado el ${new Date(report.sentAt).toLocaleString("es-MX", { timeZone: "America/Mexico_City" })}.`
                : "Aprobado. Descarga el PDF o envíalo a los destinatarios."}
          </p>
        </div>
        <ReportActions report={{ id: report.id, status: report.status, pdfPath: report.pdfPath, recipients: report.recipients }} canEdit={canEdit} />
      </div>

      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {facts.kpis.map((k) => (
          <div key={k.key} className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">{k.label}</p>
            <p className="text-2xl font-semibold tabular-nums">{k.value == null ? "s/d" : nf.format(k.value)}</p>
            <p className="text-xs text-muted-foreground">
              {k.change == null ? "Sin comparación" : `${signed(k.change, k.change_unit)} vs. ${facts.period.previous_label}`}
            </p>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Volumen por sentimiento" description={facts.period.label} height={240} className="lg:col-span-2">
          <LazyVolumeChart series={series} bucket={facts.period.kind === "daily" ? "hour" : "day"} />
        </ChartCard>
        <ChartCard title="Temas principales" description="Sentimiento neto (NSS) de los temas con más menciones." height={Math.max(160, topicRows.length * 30 + 32)}>
          <LazyNssBars rows={topicRows} label="Sentimiento neto por tema" />
        </ChartCard>
        <ChartCard title="Dependencias por NSS" description="De peor a mejor sentimiento neto." height={Math.max(160, departmentRows.length * 30 + 32)}>
          <LazyNssBars rows={departmentRows} label="Sentimiento neto por dependencia" />
        </ChartCard>
      </div>

      <NarrativeEditor reportId={report.id} narrative={report.narrative} facts={facts} recipients={report.recipients} editable={canEdit && report.status === "draft"} />

      <section aria-labelledby="anexo" className="flex flex-col gap-3">
        <h2 id="anexo" className="text-lg font-semibold">
          Menciones representativas
        </h2>
        <p className="text-sm text-muted-foreground">Las 15 menciones que Claude recibió como contexto. Los ciudadanos nunca se identifican.</p>
        <ol className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {facts.representative_mentions.map((m) => (
            <li key={m.ref} className="rounded-xl border bg-card p-3 text-sm">
              <p className="mb-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                <span>{m.date}</span>
                <span>{m.source}</span>
                {m.sentiment && <span className={SENTIMENT_TONE[m.sentiment]}>{m.sentiment}</span>}
                {m.topic && <span>{m.topic}</span>}
              </p>
              <p className="line-clamp-4">{m.text}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
