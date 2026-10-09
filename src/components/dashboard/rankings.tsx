import Link from "next/link";
import { ArrowUpRight, Megaphone, Newspaper } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Reveal, SentimentBadge } from "@/components/ui-kit";
import { inboxHref, type MediaRow, type TopMention } from "@/lib/dashboard/model";
import type { Period } from "@/lib/dashboard/period";
import { cn } from "@/lib/utils";
import { formatNumber } from "./chart-theme";

const signed = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0, signDisplay: "exceptZero" });

export function TopMentions({ mentions, period, index }: { mentions: TopMention[]; period: Period; index: number }) {
  return (
    <Reveal delay={index * 0.06} className="h-full">
      <Card className="h-full">
        <CardHeader>
          <CardTitle as="h3">Mayor alcance</CardTitle>
          <CardDescription>Menciones con más interacciones (likes, compartidos y comentarios).</CardDescription>
        </CardHeader>
        <CardContent>
          {mentions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin menciones en el periodo.</p>
          ) : (
            <ol className="flex flex-col divide-y">
              {mentions.map((m, i) => (
                <li key={m.id}>
                  <Link
                    href={inboxHref(period, { mention: m.id })}
                    className="group flex gap-3 rounded-md py-2.5 transition-colors hover:bg-muted/50"
                  >
                    <span className="w-5 shrink-0 pt-0.5 text-sm font-semibold text-muted-foreground">{i + 1}</span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="line-clamp-2 text-sm leading-snug">{m.text}</span>
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span className="truncate">{[m.author, m.source].filter(Boolean).join(" · ")}</span>
                        {m.sentiment && <SentimentBadge sentiment={m.sentiment} className="py-0" />}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end">
                      <span className="text-sm font-semibold">{formatNumber(m.interactions)}</span>
                      <span className="text-[10px] text-muted-foreground uppercase">interacc.</span>
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

export function TopMedia({ media, period, index }: { media: MediaRow[]; period: Period; index: number }) {
  return (
    <Reveal delay={index * 0.06} className="h-full">
      <Card className="h-full">
        <CardHeader>
          <CardTitle as="h3">Medios y figuras públicas</CardTitle>
          <CardDescription>Quién más habló del municipio y con qué tono (NSS).</CardDescription>
        </CardHeader>
        <CardContent>
          {media.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin publicaciones de medios en el periodo.</p>
          ) : (
            <ol className="flex flex-col divide-y">
              {media.map((m) => (
                <li key={m.id}>
                  <Link
                    href={inboxHref(period, { author: m.id })}
                    className="flex items-center gap-3 rounded-md py-2.5 transition-colors hover:bg-muted/50"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      {m.kind === "media" ? <Newspaper className="size-4" aria-hidden /> : <Megaphone className="size-4" aria-hidden />}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{m.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatNumber(m.mentions)} {m.mentions === 1 ? "mención" : "menciones"} · {formatNumber(m.interactions)} interacciones
                      </span>
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        "text-foreground",
                        m.nss >= 5 ? "bg-positive/15" : m.nss <= -5 ? "bg-negative/15" : "bg-muted",
                      )}
                      title="Net Sentiment Score"
                    >
                      NSS {signed.format(m.nss)}
                    </span>
                    <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
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
