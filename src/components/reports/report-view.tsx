import Link from "next/link";
import { ChartCard } from "@/components/ui-kit";
import { LazyNssBars, LazyVolumeChart } from "@/components/dashboard/lazy-charts";
import type { NssBar } from "@/components/dashboard/nss-bars";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Kpi, ReportFacts } from "@/lib/ai/narrative";
import { FAMILY_LABELS, KPI_BY_KEY } from "@/lib/kpi/dictionary";
import type { ReportRow } from "@/lib/reports/data";
import { cn } from "@/lib/utils";
import { NarrativeEditor } from "./narrative-editor";
import { ReportActions } from "./report-actions";
import { STATUS_LABELS, STATUS_TONE } from "./report-list";

const nf = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });
const signed = (v: number, unit: string) => `${v > 0 ? "+" : ""}${nf.format(v)}${unit === "%" ? "%" : " pts"}`;
const SENTIMENT_TONE: Record<string, string> = { positivo: "text-positive", negativo: "text-negative", neutral: "text-muted-foreground" };
const UNIT_SUFFIX: Record<string, string> = { "%": " %", horas: " h" };
const mxDateTime = (iso: string) => new Date(iso).toLocaleString("es-MX", { timeZone: "America/Mexico_City" });

type Versions = { previous: { id: string; version: number } | null; next: { id: string; version: number; status: string } | null };

export function ReportView({ report, canEdit, versions }: { report: ReportRow; canEdit: boolean; versions: Versions }) {
  const { facts } = report;
  const series = facts.series.map((s) => ({ ...s, pending: 0 }));
  const topicRows: NssBar[] = facts.top_topics.map((t) => ({ key: t.topic, label: t.topic, nss: t.nss, total: t.mentions, positive: 0, negative: 0, href: "" }));
  const departmentRows: NssBar[] = facts.departments_by_nss.map((d) => ({
    key: d.department,
    label: d.department,
    nss: d.nss,
    total: d.mentions,
    positive: 0,
    negative: d.negative,
    href: "",
  }));
  const structured = facts.facts_version === 2;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
        <div className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className={cn("w-fit rounded-full px-2 py-0.5 text-xs font-medium", STATUS_TONE[report.status])}>{STATUS_LABELS[report.status]}</span>
            <span className="text-xs text-muted-foreground">Versión {report.version}</span>
          </span>
          <p className="text-sm text-muted-foreground">
            {report.status === "draft"
              ? "Revisa y edita la narrativa. Al aprobar se congelan sus cifras y su texto, se genera el PDF y se envía a los destinatarios."
              : report.sentAt
                ? `Enviado el ${mxDateTime(report.sentAt)}. Sus cifras y su texto quedaron congelados; una corrección se hace en una revisión.`
                : "Aprobado: cifras y texto congelados. Descarga el PDF, envíalo o crea una revisión."}
          </p>
          <p className="text-xs text-muted-foreground">
            {report.snapshotAt ? `Cifras al ${mxDateTime(report.snapshotAt)}` : `Cifras del ${mxDateTime(report.createdAt)}`}
            {facts.period.cut && ` · corte ${facts.period.cut}`}
            {report.kpiVersion && ` · definiciones ${report.kpiVersion}`}
            {versions.previous && (
              <>
                {" · revisa la "}
                <Link className="underline" href={`/reportes/${versions.previous.id}`}>
                  versión {versions.previous.version}
                </Link>
              </>
            )}
            {versions.next && (
              <>
                {" · tiene una revisión: "}
                <Link className="underline" href={`/reportes/${versions.next.id}`}>
                  versión {versions.next.version} ({STATUS_LABELS[versions.next.status as keyof typeof STATUS_LABELS] ?? versions.next.status})
                </Link>
              </>
            )}
          </p>
        </div>
        <ReportActions
          report={{ id: report.id, status: report.status, pdfPath: report.pdfPath, recipients: report.recipients, hasRevision: Boolean(versions.next) }}
          canEdit={canEdit}
        />
      </div>
      {report.status === "draft" && report.factsStaleAt && (
        <p role="status" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          Hubo correcciones en este periodo después de calcular las cifras ({mxDateTime(report.factsStaleAt)}). Usa «Actualizar cifras» para incluirlas; el texto se
          vuelve a verificar.
        </p>
      )}

      {structured ? (
        (["conversacion", "atencion"] as const).map((family) => (
          <KpiGroup key={family} title={FAMILY_LABELS[family]} kpis={facts.kpis.filter((k) => k.family === family)} previousLabel={facts.period.previous_label} />
        ))
      ) : (
        <KpiGroup title="Indicadores" kpis={facts.kpis} previousLabel={facts.period.previous_label} />
      )}

      {facts.coverage && <Coverage facts={facts} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Volumen por sentimiento" description={`${facts.period.label} · menciones`} height={240} className="lg:col-span-2">
          <LazyVolumeChart series={series} bucket={facts.period.kind === "daily" ? "hour" : "day"} />
        </ChartCard>
        <ChartCard title="Temas principales" description="Sentimiento neto (NSS) de los temas con más menciones." height={Math.max(160, topicRows.length * 30 + 32)}>
          <LazyNssBars rows={topicRows} label="Sentimiento neto por tema" />
        </ChartCard>
        <ChartCard
          title="Dependencias por NSS"
          description={structured ? "Sólo dependencias con volumen suficiente para comparar su tono." : "De peor a mejor sentimiento neto."}
          height={Math.max(160, departmentRows.length * 30 + 32)}
        >
          <LazyNssBars rows={departmentRows} label="Sentimiento neto por dependencia" />
        </ChartCard>
      </div>

      {facts.departments && <Departments facts={facts} />}
      {facts.pending_cases && facts.pending_cases.length > 0 && <Pending facts={facts} />}

      <NarrativeEditor reportId={report.id} narrative={report.narrative} facts={facts} recipients={report.recipients} editable={canEdit && report.status === "draft"} />

      <section aria-labelledby="anexo" className="flex flex-col gap-3">
        <h2 id="anexo" className="text-lg font-semibold">
          Menciones representativas
        </h2>
        <p className="text-sm text-muted-foreground">Las 15 menciones que Claude recibió como contexto. Los ciudadanos nunca se identifican.</p>
        <ol className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {facts.representative_mentions.map((m) => (
            <li key={m.ref} id={`mencion-${m.ref}`} className="scroll-mt-20 rounded-xl border bg-card p-3 text-sm">
              <p className="mb-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                <span className="font-medium">Mención {m.ref}</span>
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

      {structured && <Definitions facts={facts} kpiVersion={report.kpiVersion} />}
    </div>
  );
}

function KpiGroup({ title, kpis, previousLabel }: { title: string; kpis: Kpi[]; previousLabel: string }) {
  if (!kpis.length) return null;
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.key} id={`kpi-${k.key}`} className="scroll-mt-20 rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">{k.label}</p>
            <p className="text-2xl font-semibold tabular-nums">
              {k.value == null ? "s/d" : `${nf.format(k.value)}${UNIT_SUFFIX[k.unit ?? ""] ?? ""}`}
            </p>
            <p className="text-xs text-muted-foreground">
              {k.change == null ? "Sin comparación" : `${signed(k.change, k.change_unit)} vs. ${previousLabel}`}
            </p>
            {(k.n != null || k.detail) && (
              <p className="text-xs text-muted-foreground">{[k.unit === "horas" ? `n = ${k.n ?? 0}` : null, k.detail].filter(Boolean).join(" · ")}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function Coverage({ facts }: { facts: ReportFacts }) {
  const c = facts.coverage!;
  return (
    <section aria-label="Cobertura" className="rounded-xl border bg-card p-4 text-sm">
      <h2 className="mb-2 text-base font-semibold">Cobertura</h2>
      <ul className="flex flex-col gap-1 text-muted-foreground">
        <li>
          Sin clasificar: {nf.format(c.unclassified)} de {nf.format(c.mentions)} menciones{c.unclassified_pct != null && ` (${nf.format(c.unclassified_pct)} %)`}.
        </li>
        <li>
          Clasificadas sin colonia: {nf.format(c.without_neighborhood)}
          {c.without_neighborhood_pct != null && ` (${nf.format(c.without_neighborhood_pct)} %)`}.
        </li>
        <li>
          Casos nuevos sin categoría: {nf.format(c.cases_without_category)}; sin ubicación: {nf.format(c.cases_without_location)}; abiertos sin plazo:{" "}
          {nf.format(c.open_without_due)}.
        </li>
        {c.sources_partial.length > 0 && <li>Fuentes con lectura parcial al corte: {c.sources_partial.join(", ")}.</li>}
        {c.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </section>
  );
}

function Departments({ facts }: { facts: ReportFacts }) {
  const rows = facts.departments!;
  return (
    <section aria-labelledby="dependencias-title" id="dependencias" className="scroll-mt-20 rounded-xl border bg-card p-4">
      <h2 id="dependencias-title" className="text-base font-semibold">
        Casos por dependencia
      </h2>
      <p className="mb-2 text-xs text-muted-foreground">Desglose en orden alfabético, no un ranking. «Volumen bajo» y «nueva» no se comparan.</p>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Casos por dependencia, desplazable">
        <Table aria-label="Casos por dependencia">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Dependencia</TableHead>
              <TableHead scope="col" className="text-right">Nuevos</TableHead>
              <TableHead scope="col" className="text-right">Abiertos al corte</TableHead>
              <TableHead scope="col" className="text-right">Vencidos</TableHead>
              <TableHead scope="col" className="text-right">Cierres validados</TableHead>
              <TableHead scope="col" className="text-right">Resolución (mediana · p90 · n)</TableHead>
              <TableHead scope="col" className="text-right">Reaperturas</TableHead>
              <TableHead scope="col">Nota</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((d) => (
              <TableRow key={d.department}>
                <TableCell className="font-medium">{d.department}</TableCell>
                <TableCell className="text-right tabular-nums">{d.opened}</TableCell>
                <TableCell className="text-right tabular-nums">{d.open_at_cut}</TableCell>
                <TableCell className="text-right tabular-nums">{d.overdue_at_cut}</TableCell>
                <TableCell className="text-right tabular-nums">{d.validated_closures}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {d.resolution_n ? `${nf.format(d.resolution_median_h ?? 0)} h · ${nf.format(d.resolution_p90_h ?? 0)} h · ${d.resolution_n}` : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">{d.reopenings}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {[d.low_volume && "Volumen bajo", d.new_in_catalog && "Nueva en el catálogo"].filter(Boolean).join(" · ") || "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function Pending({ facts }: { facts: ReportFacts }) {
  return (
    <section aria-labelledby="pendientes" className="rounded-xl border bg-card p-4">
      <h2 id="pendientes" className="text-base font-semibold">
        Casos vencidos al corte
      </h2>
      <ul className="mt-2 flex flex-col divide-y text-sm">
        {facts.pending_cases!.map((c) => (
          <li key={c.ref} className="flex flex-wrap items-center gap-x-3 py-1.5">
            <Link href={`/casos/${c.case_id}`} className="font-mono text-xs underline">
              {c.folio}
            </Link>
            <span>{c.category ?? "Sin categoría"}</span>
            <span className="text-xs text-muted-foreground">{c.department ?? "Sin asignar"}</span>
            {c.overdue_hours != null && <span className="ml-auto text-xs text-negative tabular-nums">{nf.format(c.overdue_hours)} h de atraso</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Definitions({ facts, kpiVersion }: { facts: ReportFacts; kpiVersion: string | null }) {
  const defs = facts.kpis.map((k) => KPI_BY_KEY[k.key]).filter(Boolean);
  return (
    <details className="rounded-xl border bg-card p-4 text-sm">
      <summary className="cursor-pointer font-semibold">Definiciones de los indicadores ({kpiVersion ?? facts.kpi_version})</summary>
      <dl className="mt-3 flex flex-col gap-3">
        {defs.map((d) => (
          <div key={d.key}>
            <dt className="font-medium">
              {d.label} <span className="text-xs font-normal text-muted-foreground">({d.unit})</span>
            </dt>
            <dd className="text-muted-foreground">
              {d.formula} Denominador: {d.denominator} Periodo: {d.period} Reabiertos: {d.reopened} Sin dato: {d.missing}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
