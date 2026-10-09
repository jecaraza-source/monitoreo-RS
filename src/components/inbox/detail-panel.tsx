"use client";

import { useEffect, useState, useTransition } from "react";
import { AlarmClock, Archive, CheckCheck, ExternalLink, Pencil, RotateCcw, Send, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { SentimentBadge } from "@/components/ui-kit";
import { createClient } from "@/lib/supabase/client";
import { addNote, correctClassification, setTicketStatus, setTriage, type InboxActionResult } from "@/lib/inbox/actions";
import type { InboxCatalogs } from "@/lib/inbox/data";
import {
  INTENT_LABELS,
  INTENTS,
  isOverdue,
  PRIORITIES,
  PRIORITY_LABELS,
  SENTIMENT_LABELS,
  SENTIMENTS,
  SOURCE_LABELS,
  TICKET_LABELS,
  TICKET_STATUSES,
  TRIAGE_LABELS,
  type InboxScope,
  type Priority,
  type Sentiment,
} from "@/lib/inbox/model";
import { fetchNotes, type InboxItem, type InboxNote } from "@/lib/inbox/query";
import { cn } from "@/lib/utils";
import { formatDateTime, fromNow } from "./format";
import type { Lookups } from "./lookups";
import { OptionSelect } from "./option-select";

function useAction() {
  const [pending, startTransition] = useTransition();
  function run(action: () => Promise<InboxActionResult>, onOk?: () => void) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(result.message);
        onOk?.();
      } else toast.error(result.message);
    });
  }
  return { pending, run };
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function DetailPanel({
  item,
  scope,
  catalogs,
  lookups,
  notesVersion,
  onRoute,
  onChanged,
}: {
  item: InboxItem;
  scope: InboxScope;
  catalogs: InboxCatalogs;
  lookups: Lookups;
  /** Bumped by Realtime when someone adds a note to this mention. */
  notesVersion: number;
  onRoute: () => void;
  onChanged: (id: string) => void;
}) {
  const source = lookups.sources.get(item.source_id);
  const author = item.authors?.display_name ?? (item.authors ? `@${item.authors.handle}` : "Autor desconocido");
  const editor = scope === "editor";

  return (
    <div className="flex flex-col gap-5 text-sm">
      <header className="flex flex-col gap-1.5 pr-8">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{author}</span>
          {item.authors?.kind === "media" && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">Medio</span>}
          {editor && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{TRIAGE_LABELS[item.triage]}</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {source ? `${SOURCE_LABELS[source.type]} · ${source.name}` : "Fuente"} · {formatDateTime(item.published_at)}
        </p>
        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            Ver publicación original <ExternalLink className="size-3" aria-hidden />
          </a>
        )}
      </header>

      <p className="text-[0.95rem] leading-relaxed whitespace-pre-wrap">{item.text}</p>

      {editor && <TriageActions key={`t-${item.id}`} item={item} onRoute={onRoute} onChanged={onChanged} />}

      <Separator />
      <Classification
        key={`c-${item.id}-${item.classifications?.corrected_at ?? ""}`}
        item={item}
        editor={editor}
        catalogs={catalogs}
        lookups={lookups}
        onChanged={onChanged}
      />

      <Separator />
      <Tickets item={item} scope={scope} lookups={lookups} onRoute={onRoute} onChanged={onChanged} />

      <Separator />
      <Notes key={`n-${item.id}`} mentionId={item.id} version={notesVersion} />
    </div>
  );
}

function TriageActions({ item, onRoute, onChanged }: { item: InboxItem; onRoute: () => void; onChanged: (id: string) => void }) {
  const { pending, run } = useAction();
  const triage = (value: "new" | "reviewed" | "discarded") =>
    run(() => setTriage({ ids: [item.id], triage: value }), () => onChanged(item.id));
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={onRoute} disabled={pending}>
        <Send aria-hidden /> Turnar <kbd className="ml-1 text-[10px] opacity-70">T</kbd>
      </Button>
      {item.triage !== "reviewed" && item.triage !== "routed" && (
        <Button size="sm" variant="outline" onClick={() => triage("reviewed")} disabled={pending}>
          <CheckCheck aria-hidden /> Revisada <kbd className="ml-1 text-[10px] opacity-70">R</kbd>
        </Button>
      )}
      {item.triage === "discarded" ? (
        <Button size="sm" variant="outline" onClick={() => triage("new")} disabled={pending}>
          <RotateCcw aria-hidden /> Restaurar
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={() => triage("discarded")} disabled={pending}>
          <Archive aria-hidden /> Descartar <kbd className="ml-1 text-[10px] opacity-70">D</kbd>
        </Button>
      )}
    </div>
  );
}

function Classification({
  item,
  editor,
  catalogs,
  lookups,
  onChanged,
}: {
  item: InboxItem;
  editor: boolean;
  catalogs: InboxCatalogs;
  lookups: Lookups;
  onChanged: (id: string) => void;
}) {
  const c = item.classifications;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => ({
    sentiment: c?.sentiment ?? "neutral",
    topic: c?.topic ?? "otro",
    intent: c?.intent && INTENTS.includes(c.intent) ? c.intent : "otro",
    priority: c?.priority ?? "low",
    departmentId: c?.department_id ?? null,
    neighborhoodId: c?.neighborhood_id ?? null,
  }));
  const { pending, run } = useAction();

  if (!c) {
    return (
      <Section title="Clasificación">
        <p className="text-muted-foreground">
          {item.status === "failed"
            ? "El modelo no pudo clasificar esta mención."
            : "Pendiente: el clasificador la procesará en unos minutos."}
        </p>
      </Section>
    );
  }

  const topics = catalogs.topics.includes(draft.topic) ? catalogs.topics : [draft.topic, ...catalogs.topics];

  return (
    <Section
      title="Clasificación"
      action={
        editor &&
        !editing && (
          <Button size="xs" variant="ghost" onClick={() => setEditing(true)}>
            <Pencil aria-hidden /> Corregir
          </Button>
        )
      }
    >
      {editing ? (
        <form
          className="grid grid-cols-2 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => correctClassification({ mentionId: item.id, ...draft }), () => {
              setEditing(false);
              onChanged(item.id);
            });
          }}
        >
          <OptionSelect
            label="Sentimiento"
            value={draft.sentiment}
            onChange={(v) => v && setDraft({ ...draft, sentiment: v as Sentiment })}
            options={SENTIMENTS.map((s) => ({ value: s, label: SENTIMENT_LABELS[s] }))}
            className="w-full"
          />
          <OptionSelect
            label="Prioridad"
            value={draft.priority}
            onChange={(v) => v && setDraft({ ...draft, priority: v as Priority })}
            options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))}
            className="w-full"
          />
          <OptionSelect
            label="Intención"
            value={draft.intent}
            onChange={(v) => v && setDraft({ ...draft, intent: v })}
            options={INTENTS.map((i) => ({ value: i, label: INTENT_LABELS[i] }))}
            className="w-full"
          />
          <OptionSelect
            label="Tema"
            value={draft.topic}
            onChange={(v) => v && setDraft({ ...draft, topic: v })}
            options={topics.map((t) => ({ value: t, label: t }))}
            className="w-full"
          />
          <OptionSelect
            label="Dependencia"
            value={draft.departmentId}
            onChange={(v) => setDraft({ ...draft, departmentId: v })}
            emptyLabel="Sin dependencia"
            options={catalogs.departments.map((d) => ({ value: d.id, label: d.name }))}
            className="w-full"
          />
          <OptionSelect
            label="Colonia"
            value={draft.neighborhoodId}
            onChange={(v) => setDraft({ ...draft, neighborhoodId: v })}
            emptyLabel="Sin colonia"
            options={catalogs.neighborhoods.map((n) => ({ value: n.id, label: n.name }))}
            className="w-full"
          />
          <div className="col-span-2 flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              Guardar corrección
            </Button>
          </div>
        </form>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          <dt className="text-muted-foreground">Sentimiento</dt>
          <dd>
            <SentimentBadge sentiment={c.sentiment} confidence={c.corrected_at ? null : c.confidence} />
          </dd>
          <dt className="text-muted-foreground">Prioridad</dt>
          <dd>{PRIORITY_LABELS[c.priority]}</dd>
          <dt className="text-muted-foreground">Intención</dt>
          <dd>{c.intent ? (INTENT_LABELS[c.intent] ?? c.intent) : "—"}</dd>
          <dt className="text-muted-foreground">Emoción</dt>
          <dd>{c.emotion ?? "—"}</dd>
          <dt className="text-muted-foreground">Tema</dt>
          <dd>{c.topic ?? "—"}</dd>
          <dt className="text-muted-foreground">Dependencia</dt>
          <dd>{c.department_id ? lookups.departments.get(c.department_id) : "—"}</dd>
          <dt className="text-muted-foreground">Colonia</dt>
          <dd>{c.neighborhood_id ? lookups.neighborhoods.get(c.neighborhood_id) : "—"}</dd>
          <dt className="text-muted-foreground">Origen</dt>
          <dd className="text-muted-foreground">
            {c.corrected_at ? (
              <span className="inline-flex items-center gap-1">
                <UserCheck className="size-3.5" aria-hidden /> Corregida por una persona · {formatDateTime(c.corrected_at)}
              </span>
            ) : (
              c.model
            )}
          </dd>
        </dl>
      )}
    </Section>
  );
}

function Tickets({
  item,
  scope,
  lookups,
  onRoute,
  onChanged,
}: {
  item: InboxItem;
  scope: InboxScope;
  lookups: Lookups;
  onRoute: () => void;
  onChanged: (id: string) => void;
}) {
  const { pending, run } = useAction();
  return (
    <Section
      title={scope === "editor" ? "Turnado" : "Ticket"}
      action={
        scope === "editor" &&
        item.tickets.length > 0 && (
          <Button size="xs" variant="ghost" onClick={onRoute}>
            <Send aria-hidden /> Turnar a otra
          </Button>
        )
      }
    >
      {item.tickets.length === 0 ? (
        <p className="text-muted-foreground">Sin turnar.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {item.tickets.map((t) => {
            const overdue = isOverdue(t);
            return (
              <li key={t.id} className={cn("flex flex-col gap-2 rounded-lg border p-3", overdue && "border-negative/40 bg-negative/5")}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{lookups.departments.get(t.department_id) ?? "Dependencia"}</span>
                  <OptionSelect
                    label="Estado del ticket"
                    value={t.status}
                    disabled={pending}
                    onChange={(status) =>
                      status &&
                      status !== t.status &&
                      run(() => setTicketStatus({ ticketId: t.id, status }), () => onChanged(item.id))
                    }
                    options={TICKET_STATUSES.map((s) => ({ value: s, label: TICKET_LABELS[s] }))}
                    className="w-36"
                  />
                </div>
                <p className={cn("text-xs text-muted-foreground", overdue && "font-medium text-negative")}>
                  {overdue && <AlarmClock className="mr-1 inline size-3.5" aria-hidden />}
                  {t.due_at ? `Fecha límite ${formatDateTime(t.due_at)} (${fromNow(t.due_at)})` : "Sin fecha límite"}
                  {t.resolved_at && ` · resuelto ${formatDateTime(t.resolved_at)}`}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function Notes({ mentionId, version }: { mentionId: string; version: number }) {
  const [notes, setNotes] = useState<InboxNote[] | null>(null);
  const [body, setBody] = useState("");
  const { pending, run } = useAction();
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchNotes(createClient(), mentionId).then((rows) => !cancelled && setNotes(rows));
    return () => {
      cancelled = true;
    };
  }, [mentionId, version, reload]);

  return (
    <Section title="Notas">
      {notes === null ? (
        <p className="text-muted-foreground">Cargando…</p>
      ) : notes.length === 0 ? (
        <p className="text-muted-foreground">Sin notas todavía.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg bg-muted/60 px-3 py-2">
              <p className="text-xs text-muted-foreground">
                {n.author_name || "Usuario"} · {formatDateTime(n.created_at)}
              </p>
              <p className="whitespace-pre-wrap">{n.body}</p>
            </li>
          ))}
        </ol>
      )}
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!body.trim()) return;
          run(() => addNote({ mentionId, body }), () => {
            setBody("");
            setReload((r) => r + 1);
          });
        }}
      >
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Agrega una nota de seguimiento…"
          aria-label="Nueva nota"
          rows={2}
          maxLength={2000}
        />
        <Button type="submit" size="sm" variant="outline" className="self-end" disabled={pending || !body.trim()}>
          Agregar nota
        </Button>
      </form>
    </Section>
  );
}
