import Link from "next/link";
import { ExternalLink, Gauge, Heart, Landmark, Lock, MessagesSquare, ThumbsDown } from "lucide-react";
import { formatNumber, NSS_ROW_HEIGHT } from "@/components/dashboard/chart-theme";
import { LazyNssBars, LazyVolumeChart } from "@/components/dashboard/lazy-charts";
import type { NssBar } from "@/components/dashboard/nss-bars";
import { ChartCard, EmptyState, KpiCard, SentimentBadge } from "@/components/ui-kit";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { periodSearch, type Period } from "@/lib/dashboard/period";
import type { OfficialMention } from "@/lib/officials/data";
import { totals, type OfficialStats } from "@/lib/officials/model";
import { cn } from "@/lib/utils";

const INTEGER: Intl.NumberFormatOptions = { maximumFractionDigits: 0 };
const SCORE: Intl.NumberFormatOptions = { maximumFractionDigits: 0, signDisplay: "exceptZero" };
const PERCENT: Intl.NumberFormatOptions = { style: "unit", unit: "percent", maximumFractionDigits: 1 };
const signed = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0, signDisplay: "exceptZero" });
const when = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Mexico_City" });

const SENTIMENT_FILTERS = [
  { value: null, label: "Todas" },
  { value: "negative", label: "Negativas" },
  { value: "neutral", label: "Neutrales" },
  { value: "positive", label: "Positivas" },
] as const;

/** /funcionarios URL keeping the period. */
function href(period: Period, params: { funcionario?: string; sentimiento?: string | null }) {
  const search = new URLSearchParams(periodSearch(period.key, period.fromDay, period.toDay).slice(1));
  if (params.funcionario) search.set("funcionario", params.funcionario);
  if (params.sentimiento) search.set("sentimiento", params.sentimiento);
  return `/funcionarios?${search}`;
}

const nssTone = (nss: number) => (nss >= 5 ? "text-positive" : nss <= -5 ? "text-negative" : "text-muted-foreground");

export function OfficialsContent({
  officials,
  selected,
  mentions,
  sentiment,
  period,
  isAdmin,
}: {
  officials: OfficialStats[];
  selected: OfficialStats | null;
  mentions: OfficialMention[];
  sentiment: OfficialMention["sentiment"];
  period: Period;
  isAdmin: boolean;
}) {
  const notice = (
    <p className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      Acceso restringido. Cada consulta queda registrada en la bitácora. Los ciudadanos se muestran de forma anónima; sólo se
      nombra a medios y figuras públicas. Uso exclusivo para evaluar la gestión y atender a la ciudadanía.
    </p>
  );

  if (!officials.length) {
    return (
      <>
        {notice}
        <EmptyState
          icon={<Landmark />}
          title="Sin funcionarios en el catálogo"
          description={
            isAdmin ? (
              <>
                Agrégalos con sus alias en{" "}
                <Link href="/configuracion/catalogos" className="text-primary underline-offset-4 hover:underline">
                  Configuración → Catálogos
                </Link>
                .
              </>
            ) : (
              "Pide a un administrador que agregue a los funcionarios al catálogo."
            )
          }
        />
      </>
    );
  }

  const t = totals(officials);
  const bars: NssBar[] = officials
    .filter((o) => o.mentions > 0)
    .map((o) => ({ key: o.id, label: o.name, nss: o.nss, total: o.mentions, positive: o.positive, negative: o.negative, href: href(period, { funcionario: o.id }) }))
    .sort((a, b) => a.nss - b.nss);

  return (
    <>
      {notice}
      <h2 className="sr-only">Indicadores</h2>
      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiCard index={0} label="Menciones sobre funcionarios" value={t.mentions} previousValue={t.previous.mentions} higherIsBetter={null} formatOptions={INTEGER} icon={<MessagesSquare />} />
        <KpiCard index={1} label="Net Sentiment Score" value={t.nss} previousValue={t.previous.mentions ? t.previous.nss : null} deltaMode="points" formatOptions={SCORE} icon={<Gauge />} />
        <KpiCard index={2} label="% negativo" value={t.negativePct} previousValue={t.previous.mentions ? t.previous.negativePct : null} deltaMode="points" higherIsBetter={false} formatOptions={PERCENT} icon={<ThumbsDown />} />
        <KpiCard index={3} label="Interacciones" value={t.interactions} higherIsBetter={null} formatOptions={INTEGER} icon={<Heart />} />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <ChartCard
          index={4}
          className="lg:col-span-5"
          title="Sentimiento neto por funcionario"
          description="Clic en una barra para ver su detalle."
          height={Math.max(bars.length, 3) * NSS_ROW_HEIGHT + 32}
        >
          {bars.length ? (
            <LazyNssBars rows={bars} label="Funcionarios por Net Sentiment Score" />
          ) : (
            <div className="flex h-full items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
              Sin menciones en este periodo.
            </div>
          )}
        </ChartCard>

        <section aria-label="Funcionarios" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:col-span-7">
          {officials.map((o) => {
            const active = o.id === selected?.id;
            const change = o.previous.mentions ? Math.round(((o.mentions - o.previous.mentions) / o.previous.mentions) * 100) : null;
            return (
              <Link
                key={o.id}
                href={href(period, { funcionario: o.id })}
                scroll={false}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "flex flex-col gap-2 rounded-xl border bg-card p-4 text-card-foreground shadow-xs transition-colors hover:border-foreground/20",
                  active && "border-primary/60 ring-2 ring-primary/30",
                )}
              >
                <div>
                  <p className="font-semibold">{o.name}</p>
                  <p className="text-xs text-muted-foreground">{o.position}</p>
                </div>
                <dl className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Menciones</dt>
                    <dd className="text-base font-semibold tabular-nums">{formatNumber(o.mentions)}</dd>
                    {change !== null && <dd className="text-muted-foreground tabular-nums">{signed.format(change)} %</dd>}
                  </div>
                  <div>
                    <dt className="text-muted-foreground">NSS</dt>
                    <dd className={cn("text-base font-semibold tabular-nums", nssTone(o.nss))}>{o.mentions ? signed.format(o.nss) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Negativas</dt>
                    <dd className="text-base font-semibold tabular-nums">{o.mentions ? `${o.negativePct} %` : "—"}</dd>
                  </div>
                </dl>
              </Link>
            );
          })}
        </section>
      </div>

      {selected && (
        <section aria-labelledby="official-detail" className="flex flex-col gap-4">
          <h2 id="official-detail" className="text-lg font-semibold tracking-tight">
            {selected.name} <span className="font-normal text-muted-foreground">· {selected.position}</span>
          </h2>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <ChartCard index={5} className="lg:col-span-8" title="Menciones por día" height={240}>
              {selected.daily.length ? (
                <LazyVolumeChart
                  series={selected.daily.map((d) => ({ bucket: `${d.day}T12:00:00-06:00`, positive: d.positive, neutral: d.neutral, negative: d.negative, pending: 0 }))}
                  bucket="day"
                />
              ) : (
                <div className="flex h-full items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                  Sin menciones en este periodo.
                </div>
              )}
            </ChartCard>
            <Card className="lg:col-span-4">
              <CardHeader>
                <CardTitle as="h3">Temas y emociones</CardTitle>
                <CardDescription>De qué se habla y cómo se siente la gente.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 text-sm">
                <ul className="flex flex-col gap-2">
                  {selected.topics.map((topic) => (
                    <li key={topic.topic} className="flex flex-col gap-1">
                      <div className="flex justify-between gap-2">
                        <span>{topic.topic}</span>
                        <span className="tabular-nums text-muted-foreground">{topic.mentions}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                        <div className="h-full bg-negative" style={{ width: `${(topic.negative / Math.max(topic.mentions, 1)) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                  {!selected.topics.length && <li className="text-muted-foreground">Sin datos.</li>}
                </ul>
                {selected.emotions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {selected.emotions.map((e) => (
                      <span key={e.emotion} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                        {e.emotion} · {e.mentions}
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">La barra roja es la proporción de menciones negativas de cada tema.</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle as="h3">Lo que se dice</CardTitle>
              <CardDescription>Últimas 30 menciones del periodo. Los ciudadanos aparecen como «Ciudadano».</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <nav aria-label="Filtrar por sentimiento" className="flex flex-wrap gap-1.5">
                {SENTIMENT_FILTERS.map((f) => (
                  <Link
                    key={f.label}
                    href={href(period, { funcionario: selected.id, sentimiento: f.value })}
                    scroll={false}
                    aria-current={sentiment === f.value ? "true" : undefined}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium",
                      sentiment === f.value ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                    )}
                  >
                    {f.label}
                  </Link>
                ))}
              </nav>
              {mentions.length ? (
                <ul className="flex flex-col divide-y">
                  {mentions.map((m) => (
                    <li key={m.id} className="flex flex-col gap-1.5 py-3 text-sm">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        {m.sentiment && <SentimentBadge sentiment={m.sentiment} />}
                        <span className="font-medium text-foreground">{m.author ?? "Ciudadano"}</span>
                        {m.source && <span>· {m.source}</span>}
                        <span>· {when.format(new Date(m.publishedAt))}</span>
                        {m.topic && <span>· {m.topic}</span>}
                        {m.interactions > 0 && <span>· {formatNumber(m.interactions)} interacciones</span>}
                      </div>
                      <p className="whitespace-pre-wrap">{m.text}</p>
                      {m.url && (
                        <a href={m.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                          Ver publicación <ExternalLink className="size-3" aria-hidden />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">Sin menciones con este filtro en el periodo.</p>
              )}
            </CardContent>
          </Card>
        </section>
      )}
    </>
  );
}
