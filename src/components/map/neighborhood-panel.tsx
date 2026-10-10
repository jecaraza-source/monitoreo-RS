import Link from "next/link";
import { ArrowUpRight, X } from "lucide-react";
import { formatNumber } from "@/components/dashboard/chart-theme";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AnimatedNumber, Reveal, SentimentBadge } from "@/components/ui-kit";
import { inboxHref, nss } from "@/lib/dashboard/model";
import type { Period } from "@/lib/dashboard/period";
import type { NeighborhoodDetail } from "@/lib/map/data";

const when = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Mexico_City" });
const SCORE: Intl.NumberFormatOptions = { maximumFractionDigits: 0, signDisplay: "exceptZero" };

/** Side panel of one colonia: what is said there, who has it, and the latest mentions. */
export function NeighborhoodPanel({ detail, period, closeHref }: { detail: NeighborhoodDetail; period: Period; closeHref: string }) {
  const { totals } = detail;
  const classified = totals.positive + totals.neutral + totals.negative;
  const inColonia = { neighborhood: detail.id };
  const share = (v: number) => (classified ? `${(v / classified) * 100}%` : "0%");

  return (
    <Reveal>
      <Card>
        <CardHeader>
          <CardTitle as="h2">{detail.name}</CardTitle>
          <CardDescription>
            {detail.approx ? "Zona aproximada (OpenStreetMap)" : "Colonia"} · periodo seleccionado
          </CardDescription>
          <CardAction>
            <Link href={closeHref} scroll={false} aria-label="Cerrar detalle" className={buttonVariants({ variant: "ghost", size: "icon-sm" })}>
              <X aria-hidden />
            </Link>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <dl className="grid grid-cols-3 gap-3">
            <Stat label="Menciones" value={totals.mentions} />
            <Stat label="Quejas" value={totals.complaints} />
            <Stat label="NSS" value={nss(totals.positive, totals.negative, classified)} format={SCORE} />
          </dl>

          {classified > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex h-2 overflow-hidden rounded-full bg-muted" role="img"
                aria-label={`${totals.positive} positivas, ${totals.neutral} neutrales, ${totals.negative} negativas`}>
                <span className="bg-positive" style={{ width: share(totals.positive) }} />
                <span className="bg-neutral" style={{ width: share(totals.neutral) }} />
                <span className="bg-negative" style={{ width: share(totals.negative) }} />
              </div>
              <p className="text-xs text-muted-foreground">
                {formatNumber(totals.positive)} positivas · {formatNumber(totals.neutral)} neutrales · {formatNumber(totals.negative)} negativas
              </p>
            </div>
          )}

          {detail.topics.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Temas</h3>
              <ul className="flex flex-col gap-1">
                {detail.topics.map((t) => (
                  <li key={t.topic}>
                    <Link href={inboxHref(period, { ...inColonia, topic: t.topic })}
                      className="flex items-baseline gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-muted/60">
                      <span className="flex-1 truncate first-letter:uppercase">{t.topic}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {formatNumber(t.total)} · {formatNumber(t.complaints)} quejas
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Turnos</h3>
            {detail.tickets.length ? (
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="pb-1 text-left font-normal">Dependencia</th>
                    <th className="pb-1 pl-3 text-right font-normal">Abiertos</th>
                    <th className="pb-1 pl-3 text-right font-normal">Vencidos</th>
                    <th className="pb-1 pl-3 text-right font-normal">Resueltos</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.tickets.map((t) => (
                    <tr key={t.id} className="border-t">
                      <td className="py-1.5 pr-2">
                        <Link href={inboxHref(period, { ...inColonia, department: t.id })} className="hover:underline">
                          {t.name}
                        </Link>
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{formatNumber(t.open)}</td>
                      <td className={t.overdue ? "py-1.5 text-right font-medium tabular-nums text-negative" : "py-1.5 text-right tabular-nums"}>
                        {formatNumber(t.overdue)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{formatNumber(t.resolved)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-muted-foreground">Sin turnos abiertos ni resueltos en el periodo.</p>
            )}
          </section>

          {detail.latest.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Últimas menciones</h3>
              <ul className="flex flex-col gap-2">
                {detail.latest.map((m) => (
                  <li key={m.id}>
                    <Link href={inboxHref(period, { mention: m.id })} className="flex flex-col gap-1 rounded-md border p-2 text-sm hover:bg-muted/50">
                      <span className="line-clamp-3">{m.text}</span>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        {m.sentiment && <SentimentBadge sentiment={m.sentiment} />}
                        <span className="truncate first-letter:uppercase">{m.topic}</span>
                        <span className="ml-auto shrink-0">{when.format(new Date(m.published_at))}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <Link href={inboxHref(period, inColonia)} className={buttonVariants({ variant: "outline" })}>
            Ver todas en la bandeja <ArrowUpRight aria-hidden />
          </Link>
        </CardContent>
      </Card>
    </Reveal>
  );
}

function Stat({ label, value, format }: { label: string; value: number; format?: Intl.NumberFormatOptions }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-muted/50 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>
        <AnimatedNumber value={value} formatOptions={format} className="text-xl font-semibold tracking-tight" />
      </dd>
    </div>
  );
}
