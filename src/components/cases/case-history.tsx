import { Bot, Lock, MessageCircle, User } from "lucide-react";
import { formatDateTime } from "@/components/inbox/format";
import type { CaseEvent } from "@/lib/cases/data";
import { CASE_STATUS_LABELS, EVENT_LABELS, FIELD_LABELS } from "@/lib/cases/model";
import { PRIORITY_LABELS, type Priority } from "@/lib/inbox/model";

const ACTOR_ICON = { user: User, whatsapp: MessageCircle, system: Bot } as const;
const nf = new Intl.NumberFormat("es-MX");

/** Append-only history, newest first: who, when, what and why. */
export function CaseHistory({ events, names }: { events: CaseEvent[]; names: Record<string, string> }) {
  if (!events.length) return <p className="text-sm text-muted-foreground">Sin movimientos.</p>;
  return (
    <ol className="relative flex flex-col gap-4 border-l pl-5" aria-label="Historial del caso">
      {events.map((e) => {
        const Icon = ACTOR_ICON[e.actor_kind as keyof typeof ACTOR_ICON] ?? User;
        return (
          <li key={e.id} className="relative text-sm">
            <span className="absolute top-0.5 -left-[1.95rem] flex size-5 items-center justify-center rounded-full border bg-background">
              <Icon className="size-3" aria-hidden />
            </span>
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{e.actor_name || "Usuario"}</span>
              {e.actor_kind === "whatsapp" && <span>por WhatsApp</span>}
              <span>{formatDateTime(e.at)}</span>
              {e.internal && (
                <span className="inline-flex items-center gap-1">
                  <Lock className="size-3" aria-hidden /> Interno
                </span>
              )}
            </p>
            <p className="mt-0.5">{describe(e, names)}</p>
            {e.reason && <p className="mt-0.5 text-muted-foreground">Motivo: {e.reason}</p>}
          </li>
        );
      })}
    </ol>
  );
}

function describe(e: CaseEvent, names: Record<string, string>): string {
  const label = EVENT_LABELS[e.operation] ?? e.operation;
  const changes = e.changes ?? {};
  if ((e.operation === "status" || e.operation === "reopened") && e.to_status) {
    const pair = changes.department_id;
    const lead = Array.isArray(pair) ? pair[1] : null;
    const department = typeof lead === "string" ? names[lead] : null;
    const from = e.from_status ? `${CASE_STATUS_LABELS[e.from_status]} → ` : "";
    return `${from}${CASE_STATUS_LABELS[e.to_status]}${department ? ` (${department})` : ""}`;
  }
  if (e.operation === "updated") {
    const fields = Object.keys(changes).map((k) => {
      const pair = changes[k];
      const after = Array.isArray(pair) ? pair[1] : null;
      return `${FIELD_LABELS[k] ?? k}${after != null ? `: ${show(k, after, names)}` : " (vacío)"}`;
    });
    return `${label}: ${fields.join("; ")}`;
  }
  if (e.operation === "created" || e.operation === "mentions_added") {
    const n = Number(changes.mentions ?? changes.added ?? 0);
    return n ? `${label} (${nf.format(n)} ${n === 1 ? "mención" : "menciones"})` : label;
  }
  if (e.operation === "backfill") {
    const n = Number(changes.tickets ?? 0);
    return n ? `${label} (${nf.format(n)} ${n === 1 ? "turno" : "turnos"})` : label;
  }
  const folio = changes.target_folio ?? changes.source_folio;
  if (typeof folio === "string") return `${label}: ${folio}`;
  return label;
}

function show(key: string, value: unknown, names: Record<string, string>): string {
  if (key === "priority") return PRIORITY_LABELS[value as Priority] ?? String(value);
  if (key === "due_at" && typeof value === "string") return formatDateTime(value);
  if (typeof value === "string" && names[value]) return names[value];
  if (key.endsWith("_id")) return "actualizado";
  return String(value).slice(0, 120);
}
