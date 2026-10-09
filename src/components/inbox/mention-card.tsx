"use client";

import { motion, useReducedMotion } from "framer-motion";
import { AlarmClock, Building2, ExternalLink, MapPin, Tag } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { SentimentBadge } from "@/components/ui-kit";
import { isOverdue, PRIORITY_LABELS, SOURCE_LABELS, TICKET_LABELS, TRIAGE_LABELS, type InboxScope } from "@/lib/inbox/model";
import type { InboxItem } from "@/lib/inbox/query";
import { cn } from "@/lib/utils";
import { fromNow } from "./format";
import type { Lookups } from "./lookups";

/** Card height; the list row adds the gap. Text is clamped so every card fits. */
export const CARD_HEIGHT = 172;

const PRIORITY_TONE = {
  critical: "bg-negative text-white",
  high: "bg-negative/15 text-negative",
  medium: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  low: "bg-muted text-muted-foreground",
} as const;

export function MentionCard({
  item,
  scope,
  lookups,
  active,
  checked,
  fresh,
  onSelect,
  onToggle,
}: {
  item: InboxItem;
  scope: InboxScope;
  lookups: Lookups;
  active: boolean;
  checked: boolean;
  fresh: boolean;
  onSelect: () => void;
  onToggle: () => void;
}) {
  const reduce = useReducedMotion();
  const c = item.classifications;
  const source = lookups.sources.get(item.source_id);
  const author = item.authors?.display_name ?? (item.authors ? `@${item.authors.handle}` : "Autor desconocido");
  const neighborhood = c?.neighborhood_id ? lookups.neighborhoods.get(c.neighborhood_id) : null;
  const ticket = item.tickets[0];
  const overdue = ticket ? isOverdue(ticket) : false;

  return (
    <motion.article
      data-mention-id={item.id}
      aria-current={active ? "true" : undefined}
      onClick={onSelect}
      initial={fresh && !reduce ? { opacity: 0, x: -16, scale: 0.98 } : false}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 30 }}
      style={{ height: CARD_HEIGHT }}
      className={cn(
        "group relative flex cursor-pointer flex-col gap-2 overflow-hidden rounded-xl border bg-card p-3.5 text-card-foreground shadow-xs transition-colors hover:border-foreground/20",
        active && "border-primary/60 ring-2 ring-primary/30",
        checked && "bg-primary/5",
        fresh && "after:pointer-events-none after:absolute after:inset-0 after:animate-[inbox-flash_2.5s_ease-out] after:rounded-xl",
        item.triage === "discarded" && "opacity-60",
      )}
    >
      <header className="flex min-w-0 items-center gap-2 text-xs">
        {scope === "editor" && (
          <span onClick={(e) => e.stopPropagation()} className="flex">
            <Checkbox checked={checked} onCheckedChange={onToggle} aria-label={`Seleccionar mención de ${author}`} />
          </span>
        )}
        {scope === "editor" && item.triage === "new" && (
          <span className="size-2 shrink-0 rounded-full bg-primary" title="Nueva" aria-label="Nueva" />
        )}
        <span className="max-w-[45%] shrink-0 truncate font-medium">{author}</span>
        {item.authors?.kind === "media" && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">Medio</span>}
        <span className="min-w-0 truncate text-muted-foreground">
          · {source ? `${SOURCE_LABELS[source.type]} · ${source.name}` : "Fuente"}
        </span>
        <time dateTime={item.published_at} className="ml-auto shrink-0 text-muted-foreground" suppressHydrationWarning>
          {fromNow(item.published_at)}
        </time>
        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
            aria-label="Abrir publicación original"
            title="Abrir original"
          >
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        )}
      </header>

      <p className="line-clamp-3 text-sm leading-snug">{item.text}</p>

      <footer className="mt-auto flex min-w-0 flex-nowrap items-center gap-1.5 overflow-hidden text-xs">
        {c ? (
          <SentimentBadge sentiment={c.sentiment} confidence={c.confidence} />
        ) : (
          <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
            {item.status === "failed" ? "Falló la clasificación" : "Clasificando…"}
          </span>
        )}
        {c && (
          <span className={cn("shrink-0 rounded-full px-2 py-0.5 font-medium", PRIORITY_TONE[c.priority])}>
            {PRIORITY_LABELS[c.priority]}
          </span>
        )}
        {c?.topic && (
          <span className="inline-flex shrink-0 items-center gap-1 text-muted-foreground">
            <Tag className="size-3" aria-hidden />
            {c.topic}
          </span>
        )}
        {neighborhood && (
          <span className="inline-flex shrink-0 items-center gap-1 text-muted-foreground">
            <MapPin className="size-3" aria-hidden />
            {neighborhood}
          </span>
        )}
        <span className="ml-auto" />
        {ticket ? (
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5",
              overdue ? "bg-negative/15 font-medium text-negative" : "bg-muted text-muted-foreground",
            )}
            title={scope === "editor" ? `Turnada a ${lookups.departments.get(ticket.department_id) ?? "dependencia"}` : undefined}
          >
            {overdue ? <AlarmClock className="size-3" aria-hidden /> : <Building2 className="size-3" aria-hidden />}
            {scope === "editor" ? lookups.departments.get(ticket.department_id) : TICKET_LABELS[ticket.status]}
            {ticket.due_at && ticket.status !== "resolved" && ticket.status !== "closed" && (
              <span suppressHydrationWarning>· {overdue ? "venció" : "vence"} {fromNow(ticket.due_at)}</span>
            )}
          </span>
        ) : (
          scope === "editor" &&
          item.triage !== "new" && <span className="shrink-0 text-muted-foreground">{TRIAGE_LABELS[item.triage]}</span>
        )}
      </footer>
    </motion.article>
  );
}
