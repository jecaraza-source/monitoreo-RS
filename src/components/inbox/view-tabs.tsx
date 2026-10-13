"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { filtersToSearch, VIEW_LABELS, VIEWS_BY_SCOPE, type InboxFilters, type InboxScope, type ViewCounts } from "@/lib/inbox/model";
import { cn } from "@/lib/utils";

const nf = new Intl.NumberFormat("es-MX");

/**
 * Operational views with their counters. Each counter is computed by the same
 * database function as its list (public.inbox_counts / inbox_queue), with the
 * same filters, so the number always matches what the view shows.
 */
export function ViewTabs({ scope, filters, counts }: { scope: InboxScope; filters: InboxFilters; counts: ViewCounts | null }) {
  const current = filters.view ?? null;
  const nav = useRef<HTMLElement>(null);
  // On a phone the row scrolls sideways: keep the active view in sight.
  useEffect(() => {
    nav.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [current]);
  const href = (view: InboxFilters["view"]) => `/bandeja${filtersToSearch({ ...filters, view, status: view ? undefined : filters.status })}`;
  const tab = (active: boolean) =>
    cn(
      "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
      active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
    );
  return (
    <nav ref={nav} aria-label="Vistas de la bandeja" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      <Link href={href(undefined)} className={tab(current === null)} aria-current={current === null ? "page" : undefined}>
        Todas
      </Link>
      {VIEWS_BY_SCOPE[scope].map((view) => {
        const n = counts?.[view];
        const active = current === view;
        return (
          <Link
            key={view}
            href={href(view)}
            className={tab(active)}
            aria-current={active ? "page" : undefined}
            title={VIEW_LABELS[view].hint}
          >
            {VIEW_LABELS[view].label}
            {n !== undefined && (
              <span
                className={cn(
                  "rounded-full px-1.5 text-xs tabular-nums",
                  active ? "bg-primary-foreground/20" : view === "overdue" && n > 0 ? "bg-negative/15 text-negative" : "bg-muted",
                )}
                aria-label={`${n} en la vista`}
              >
                {nf.format(n)}
              </span>
            )}
          </Link>
        );
      })}
      {scope === "editor" && (
        <Link href="/bandeja/revision" className={cn(tab(false), "border-dashed")} title="Clasificaciones que necesitan una persona">
          <ClipboardCheck className="size-3.5" aria-hidden /> Revisión
          {counts && <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">{nf.format(counts.review)}</span>}
        </Link>
      )}
    </nav>
  );
}
