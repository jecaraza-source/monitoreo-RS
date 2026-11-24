import Link from "next/link";
import { ArrowUpRight, EyeOff, Flame, MessageSquareWarning, Percent, TrendingUp } from "lucide-react";
import { formatNumber } from "@/components/dashboard/chart-theme";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartCard, EmptyState, InfoTip, KpiCard, Reveal } from "@/components/ui-kit";
import { change, share, type CriticalCount, type CriticalPlace, type CriticalVoices } from "@/lib/critical/model";
import { inboxHref } from "@/lib/dashboard/model";
import { previousLabel, type Period } from "@/lib/dashboard/period";
import { SOURCE_LABELS } from "@/lib/inbox/model";
import type { SourceType } from "@/lib/connectors/types";
import { cn } from "@/lib/utils";
import { LazyNegativeTrend } from "./lazy-trend";

const pct = new Intl.NumberFormat("es-MX", { style: "percent", maximumFractionDigits: 0, signDisplay: "exceptZero" });
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Growth({ now, before }: { now: number; before: number }) {
  const c = change(now, before);
  if (c === null) return <span className="text-muted-foreground">{now > 0 ? "nuevo" : "—"}</span>;
  return <span className={cn(c > 0 ? "text-negative" : c < 0 ? "text-positive" : "text-muted-foreground")}>{pct.format(c)}</span>;
}

function RisingBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-negative/12 px-1.5 py-0.5 text-xs text-negative">
      <TrendingUp className="size-3" aria-hidden /> En aumento
    </span>
  );
}

function PlaceList({
  title,
  info,
  rows,
  hrefFor,
  index,
}: {
  title: string;
  info: string;
  rows: CriticalPlace[];
  hrefFor: (row: CriticalPlace) => string;
  index: number;
}) {
  const max = Math.max(1, ...rows.map((r) => r.negative));
  return (
    <Reveal delay={index * 0.06} className="h-full">
      <Card className="h-full">
        <CardHeader>
          <div className="flex items-center gap-1">
            <CardTitle as="h3">{title}</CardTitle>
            <InfoTip label={title}>{info}</InfoTip>
          </div>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin menciones negativas con este dato.</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {rows.slice(0, 8).map((r) => (
                <li key={r.id}>
                  <Link href={hrefFor(r)} className="group flex flex-col gap-1 rounded-md px-1 py-1 hover:bg-muted/50">
                    <span className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate">{r.name}</span>
                        {r.rising && <RisingBadge />}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {formatNumber(r.negative)} <span className="text-xs"><Growth now={r.negative} before={r.prevNegative} /></span>
                      </span>
                    </span>
                    <span className="h-1.5 rounded-full bg-muted">
                      <span className="block h-full rounded-full bg-negative/70" style={{ width: `${(r.negative / max) * 100}%` }} />
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </Reveal>
  );
}

function CountBars({ rows, label }: { rows: { label: string; negative: number }[]; label: string }) {
  const total = rows.reduce((sum, r) => sum + r.negative, 0);
  if (total === 0) return <p className="text-sm text-muted-foreground">Sin datos en el periodo.</p>;
  return (
    <ul className="flex flex-col gap-2" aria-label={label}>
      {rows.slice(0, 6).map((r) => (
        <li key={r.label} className="flex items-center gap-3 text-sm">
          <span className="w-32 shrink-0 truncate">{r.label}</span>
          <span className="h-2 flex-1 rounded-full bg-muted">
            <span className="block h-full rounded-full bg-negative/60" style={{ width: `${(r.negative / total) * 100}%` }} />
          </span>
          <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">{Math.round((r.negative / total) * 100)} %</span>
        </li>
      ))}
    </ul>
  );
}

const platformLabel = (c: CriticalCount) => SOURCE_LABELS[c.key as SourceType] ?? c.key;

export function CriticalContent({ data, period }: { data: CriticalVoices; period: Period }) {
  const { totals } = data;
  const negHref = (filters: Parameters<typeof inboxHref>[1] = {}) => inboxHref(period, { sentiment: "negative", ...filters });
  const risingTopics = data.topics.filter((t) => t.rising);
  const risingPlaces = data.neighborhoods.filter((p) => p.rising);

  return (
    <>
      <p className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
        <EyeOff className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          <strong className="font-medium text-foreground">Sin identidades.</strong> Este panel muestra qué se critica, dónde y con
          qué intensidad, no quién lo dice: no lista autores ni perfiles, y los términos frecuentes omiten @usuarios, correos y
          enlaces.
        </span>
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          index={0}
          label="Menciones negativas"
          value={totals.negative}
          previousValue={totals.prevNegative}
          higherIsBetter={false}
          comparisonLabel={`vs. ${previousLabel(period)}`}
          icon={<MessageSquareWarning className="size-4" aria-hidden />}
          info="Menciones clasificadas como negativas en el periodo, de cualquier fuente."
        />
        <KpiCard
          index={1}
          label="% negativo"
          value={share(totals.negative, totals.classified)}
          previousValue={share(totals.prevNegative, totals.prevClassified)}
          higherIsBetter={false}
          deltaMode="points"
          formatOptions={{ maximumFractionDigits: 1 }}
          comparisonLabel={`vs. ${previousLabel(period)}`}
          icon={<Percent className="size-4" aria-hidden />}
          info="Negativas entre todas las menciones clasificadas del periodo."
          footnote={`de ${formatNumber(totals.classified)} clasificadas`}
        />
        <KpiCard
          index={2}
          label="Temas en aumento"
          value={risingTopics.length}
          higherIsBetter={false}
          icon={<Flame className="size-4" aria-hidden />}
          info="Temas con 5 o más menciones negativas que crecieron 50 % o más frente al periodo anterior (o que no tenían)."
          footnote={risingTopics.slice(0, 3).map((t) => t.topic).join(", ") || "Ninguno"}
        />
        <KpiCard
          index={3}
          label="Colonias en aumento"
          value={risingPlaces.length}
          higherIsBetter={false}
          icon={<TrendingUp className="size-4" aria-hidden />}
          info="Colonias con 5 o más menciones negativas que crecieron 50 % o más frente al periodo anterior."
          footnote={risingPlaces.slice(0, 3).map((p) => p.name).join(", ") || "Ninguna"}
        />
      </div>

      {totals.classified === 0 ? (
        <EmptyState icon={<MessageSquareWarning />} title="Sin menciones clasificadas" description="Cambia el periodo o espera a que se clasifiquen las menciones nuevas." />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <ChartCard
              index={4}
              className="lg:col-span-7"
              title="Tendencia de la crítica"
              description="Menciones negativas (barras) y su porcentaje del total clasificado (línea)."
              info="Un día con muchas negativas pero bajo porcentaje es un día de mucha conversación; un porcentaje que sube indica que la crítica crece más que la conversación."
              height={260}
            >
              <LazyNegativeTrend series={data.series} bucket={period.bucket} />
            </ChartCard>
            <Reveal delay={5 * 0.06} className="h-full lg:col-span-5">
              <Card className="h-full">
                <CardHeader>
                  <div className="flex items-center gap-1">
                    <CardTitle as="h3">De qué se habla</CardTitle>
                    <InfoTip label="De qué se habla">
                      Palabras y frases que más se repiten en las menciones negativas del periodo (cada mención cuenta una vez). Toca
                      una para ver esas menciones en la bandeja.
                    </InfoTip>
                  </div>
                  <CardDescription>Lo más repetido en la crítica.</CardDescription>
                </CardHeader>
                <CardContent>
                  {data.terms.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Aún no hay suficientes menciones negativas.</p>
                  ) : (
                    <ul className="flex flex-wrap gap-2" aria-label="Términos frecuentes">
                      {data.terms.map((t) => (
                        <li key={t.term}>
                          <Link
                            href={negHref({ q: t.term.includes(" ") ? `"${t.term}"` : t.term })}
                            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm hover:bg-muted"
                          >
                            {t.term} <span className="text-xs tabular-nums text-muted-foreground">{formatNumber(t.count)}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </Reveal>
          </div>

          <Reveal delay={6 * 0.06}>
            <Card>
              <CardHeader>
                <div className="flex items-center gap-1">
                  <CardTitle as="h3">Temas criticados</CardTitle>
                  <InfoTip label="Temas criticados">
                    Menciones negativas por tema y su cambio frente al periodo anterior. «En aumento»: 5 o más negativas y 50 % o más de
                    crecimiento.
                  </InfoTip>
                </div>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {data.topics.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin temas con menciones negativas.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="py-2 font-medium">Tema</th>
                        <th className="py-2 text-right font-medium">Negativas</th>
                        <th className="py-2 text-right font-medium">vs. anterior</th>
                        <th className="py-2 text-right font-medium">% del tema</th>
                        <th className="py-2 pl-3 font-medium"><span className="sr-only">Estado</span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {data.topics.slice(0, 12).map((t) => (
                        <tr key={t.topic}>
                          <td className="py-2">
                            <Link href={negHref({ topic: t.topic })} className="hover:underline">
                              {capitalize(t.topic)}
                            </Link>
                          </td>
                          <td className="py-2 text-right tabular-nums">{formatNumber(t.negative)}</td>
                          <td className="py-2 text-right tabular-nums"><Growth now={t.negative} before={t.prevNegative} /></td>
                          <td className="py-2 text-right tabular-nums text-muted-foreground">
                            {t.classified > 0 ? `${Math.round((t.negative / t.classified) * 100)} %` : "—"}
                          </td>
                          <td className="py-2 pl-3">{t.rising && <RisingBadge />}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </Reveal>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <PlaceList
              index={7}
              title="Colonias"
              info="Dónde se concentra la crítica, con su cambio frente al periodo anterior."
              rows={data.neighborhoods}
              hrefFor={(r) => negHref({ neighborhood: r.id })}
            />
            <PlaceList
              index={8}
              title="Dependencias señaladas"
              info="A qué dependencia apunta la crítica según la clasificación."
              rows={data.departments}
              hrefFor={(r) => negHref({ department: r.id })}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <Reveal delay={9 * 0.06} className="h-full lg:col-span-4">
              <Card className="h-full">
                <CardHeader>
                  <CardTitle as="h3">Emociones</CardTitle>
                  <CardDescription>Qué sienten quienes critican.</CardDescription>
                </CardHeader>
                <CardContent>
                  <CountBars label="Emociones" rows={data.emotions.map((e) => ({ label: capitalize(e.key), negative: e.negative }))} />
                </CardContent>
              </Card>
            </Reveal>
            <Reveal delay={9 * 0.06} className="h-full lg:col-span-4">
              <Card className="h-full">
                <CardHeader>
                  <CardTitle as="h3">Dónde se dice</CardTitle>
                  <CardDescription>Plataformas de la crítica.</CardDescription>
                </CardHeader>
                <CardContent>
                  <CountBars label="Plataformas" rows={data.platforms.map((p) => ({ label: platformLabel(p), negative: p.negative }))} />
                </CardContent>
              </Card>
            </Reveal>
            <Reveal delay={10 * 0.06} className="h-full lg:col-span-4">
              <Card className="h-full">
                <CardHeader>
                  <div className="flex items-center gap-1">
                    <CardTitle as="h3">Críticas con más alcance</CardTitle>
                    <InfoTip label="Críticas con más alcance">
                      Menciones negativas con más interacciones (likes, compartidos y comentarios). Se muestra el texto, no el autor.
                    </InfoTip>
                  </div>
                </CardHeader>
                <CardContent>
                  {data.top.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Sin menciones negativas.</p>
                  ) : (
                    <ol className="flex flex-col divide-y" aria-label="Críticas con más alcance">
                      {data.top.slice(0, 5).map((m) => (
                        <li key={m.id}>
                          <Link href={inboxHref(period, { mention: m.id })} className="group flex gap-2 rounded-md py-2 hover:bg-muted/50">
                            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                              <span className="line-clamp-2 text-sm leading-snug">{m.text}</span>
                              <span className="truncate text-xs text-muted-foreground">
                                {[SOURCE_LABELS[m.sourceType as SourceType] ?? m.sourceType, m.topic && capitalize(m.topic), m.neighborhood]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            </span>
                            <span className="flex shrink-0 items-start gap-1 text-sm font-semibold tabular-nums">
                              {formatNumber(m.interactions)}
                              <ArrowUpRight className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" aria-hidden />
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ol>
                  )}
                </CardContent>
              </Card>
            </Reveal>
          </div>
        </>
      )}
    </>
  );
}
