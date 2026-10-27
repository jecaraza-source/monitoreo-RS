import { ExternalLink } from "lucide-react";
import { formatDateTime } from "@/components/inbox/format";
import type { RadarCheck } from "@/lib/counterintel/data";
import { PROVIDER_LABELS, type CheckStatus, type FactCheckItem, type Lookalike, type NewsItem } from "@/lib/counterintel/providers";
import { cn } from "@/lib/utils";

const STATUS: Record<CheckStatus, { label: string; className: string }> = {
  flagged: { label: "Alerta", className: "bg-negative text-negative-foreground" },
  found: { label: "Con resultados", className: "bg-primary/15 text-foreground" },
  clear: { label: "Sin registro", className: "bg-muted text-muted-foreground" },
  skipped: { label: "Sin configurar", className: "bg-muted text-muted-foreground" },
  error: { label: "Sin respuesta", className: "bg-muted text-muted-foreground" },
};

export function CheckBadge({ status }: { status: CheckStatus }) {
  const s = STATUS[status];
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", s.className)}>{s.label}</span>;
}

function Link({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className="inline-flex items-center gap-1 underline" href={href} target="_blank" rel="noreferrer noopener">
      {children} <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}

/** One row per indicator and service, from the latest run. */
export function IndicatorChecks({ checks }: { checks: RadarCheck[] }) {
  if (checks.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-col gap-1 text-xs" aria-label="Revisión de indicadores">
      {checks.map((c) => (
        <li key={c.id} className="flex flex-wrap items-center gap-2">
          <CheckBadge status={c.status} />
          <span className="font-mono">{c.subject}</span>
          <span className="text-muted-foreground">{PROVIDER_LABELS[c.provider]}: {c.summary}</span>
          <span className="text-muted-foreground">{formatDateTime(c.checkedAt)}</span>
        </li>
      ))}
    </ul>
  );
}

export function LookalikeResults({ checks }: { checks: RadarCheck[] }) {
  if (checks.length === 0) return <p className="text-sm text-muted-foreground">Todavía no se ha buscado.</p>;
  return (
    <div className="flex flex-col gap-3">
      {checks.map((c) => {
        const domains = (c.details.domains as Lookalike[] | undefined) ?? [];
        return (
          <div key={c.id} className="text-sm">
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <CheckBadge status={c.status} />
              <span>«{c.subject}»</span>
              <span>{c.summary}</span>
              <span>{formatDateTime(c.checkedAt)}</span>
            </p>
            {domains.length > 0 && (
              <ul className="mt-2 grid gap-1 sm:grid-cols-2" aria-label={`Dominios parecidos con ${c.subject}`}>
                {domains.map((d) => (
                  <li key={d.domain} className="flex flex-wrap items-baseline gap-2 rounded bg-muted/50 px-2 py-1">
                    <span className="font-mono">{d.domain}</span>
                    <span className="text-xs text-muted-foreground">
                      desde {d.firstSeen ? formatDateTime(d.firstSeen) : "—"}
                      {d.issuer ? ` · ${d.issuer}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function SearchResults({ checks }: { checks: RadarCheck[] }) {
  if (checks.length === 0) return <p className="text-sm text-muted-foreground">Sin búsquedas recientes.</p>;
  return (
    <div className="flex flex-col gap-4">
      {checks.map((c) => (
        <section key={c.id} className="text-sm" aria-label={`${PROVIDER_LABELS[c.provider]}: ${c.subject}`}>
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <CheckBadge status={c.status} />
            <span className="font-medium text-foreground">{PROVIDER_LABELS[c.provider]}</span>
            <span>«{c.subject}»</span>
            <span>{c.summary}</span>
            <span>{formatDateTime(c.checkedAt)}</span>
          </p>
          {c.provider === "factcheck" && (
            <ul className="mt-2 flex flex-col gap-2">
              {((c.details.items as FactCheckItem[] | undefined) ?? []).map((i, n) => (
                <li key={n} className="rounded bg-muted/50 p-2">
                  <p>{i.claim}</p>
                  <p className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {i.rating && <span className="font-semibold text-foreground">{i.rating}</span>}
                    {i.publisher && <span>{i.publisher}</span>}
                    {i.date && <span>{formatDateTime(i.date)}</span>}
                    {i.url && <Link href={i.url}>Ver verificación</Link>}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {c.provider === "gdelt" && (
            <ul className="mt-2 flex flex-col gap-1">
              {((c.details.items as NewsItem[] | undefined) ?? []).map((i) => (
                <li key={i.url} className="flex flex-wrap items-baseline gap-2">
                  <Link href={i.url}>{i.title}</Link>
                  <span className="text-xs text-muted-foreground">
                    {[i.domain, i.date ? formatDateTime(i.date) : null].filter(Boolean).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
