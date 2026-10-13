"use client";

import { AlarmClock, Building2, FolderKanban, MapPin, MessagesSquare } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { CaseStatusBadge } from "@/components/cases/case-status-badge";
import { caseOverdue } from "@/lib/cases/model";
import { PRIORITY_LABELS } from "@/lib/inbox/model";
import type { QueueCase } from "@/lib/inbox/query";
import { cn } from "@/lib/utils";
import { fromNow } from "./format";
import type { Lookups } from "./lookups";
import { CARD_HEIGHT } from "./mention-card";

/** A case in an operational view: same height as a mention card, visibly a case. */
export function CaseCard({
  item,
  lookups,
  active,
  checked,
  selectable,
  onSelect,
  onToggle,
}: {
  item: QueueCase;
  lookups: Lookups;
  active: boolean;
  checked: boolean;
  selectable: boolean;
  onSelect: () => void;
  onToggle: () => void;
}) {
  const overdue = caseOverdue(item.status, item.due_at);
  return (
    <article
      data-case-id={item.id}
      aria-label={`Caso ${item.folio}: ${item.title}`}
      onClick={onSelect}
      style={{ height: CARD_HEIGHT }}
      className={cn(
        "flex cursor-pointer flex-col gap-2 overflow-hidden rounded-xl border border-l-4 border-l-primary/70 bg-card p-3 transition-colors hover:bg-muted/40",
        active && "ring-2 ring-primary",
        overdue && "border-negative/40",
      )}
    >
      <header className="flex items-center gap-2 text-xs">
        {selectable && (
          <Checkbox
            checked={checked}
            onCheckedChange={onToggle}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Seleccionar caso ${item.folio}`}
          />
        )}
        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
          <FolderKanban className="size-3" aria-hidden /> Caso {item.folio}
        </span>
        <CaseStatusBadge status={item.status} />
        <span className="ml-auto text-muted-foreground" suppressHydrationWarning>
          abierto {fromNow(item.opened_at)}
        </span>
      </header>
      <p className="line-clamp-2 font-medium leading-snug">{item.title}</p>
      <footer className="mt-auto flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>Prioridad {PRIORITY_LABELS[item.priority].toLowerCase()}</span>
        <span className="inline-flex items-center gap-1">
          <MessagesSquare className="size-3" aria-hidden /> {item.mentions} {item.mentions === 1 ? "mención" : "menciones"}
        </span>
        <span className="inline-flex items-center gap-1">
          <Building2 className="size-3" aria-hidden /> {item.department_id ? lookups.departments.get(item.department_id) : "Sin responsable"}
        </span>
        {item.neighborhood_id && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3" aria-hidden /> {lookups.neighborhoods.get(item.neighborhood_id)}
          </span>
        )}
        {item.due_at && (
          <span className={cn("inline-flex items-center gap-1", overdue && "font-medium text-negative")} suppressHydrationWarning>
            {overdue && <AlarmClock className="size-3" aria-hidden />}
            {overdue ? "venció" : "vence"} {fromNow(item.due_at)}
          </span>
        )}
      </footer>
    </article>
  );
}
