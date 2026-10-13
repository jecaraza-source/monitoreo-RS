"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, ExternalLink, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatDateTime } from "@/components/inbox/format";
import { OptionSelect } from "@/components/inbox/option-select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { decideReview } from "@/lib/inbox/actions";
import type { InboxCatalogs } from "@/lib/inbox/data";
import {
  INCIDENT_LABELS,
  INCIDENT_TYPES,
  INTENT_LABELS,
  INTENTS,
  PRIORITIES,
  PRIORITY_LABELS,
  SENTIMENT_LABELS,
  SENTIMENTS,
  SEVERITIES,
  SEVERITY_LABELS,
  SOURCE_LABELS,
  type Priority,
  type Sentiment,
  type Severity,
} from "@/lib/inbox/model";
import type { ReviewItem } from "@/lib/review/data";
import { REASON_LABELS, type ReviewReason } from "@/lib/review/model";
import { cn } from "@/lib/utils";

const pct = new Intl.NumberFormat("es-MX", { style: "percent", maximumFractionDigits: 0 });

/**
 * One classification to review: the original content, its source, what the
 * model said (model, confidence) and why it is here. The decision is stored
 * with its reason; a correction keeps the previous version.
 */
export function ReviewCard({ item, catalogs }: { item: ReviewItem; catalogs: InboxCatalogs }) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "correct" | "dismiss">("view");
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const ai = item.ai;
  const [draft, setDraft] = useState({
    sentiment: ai.sentiment as Sentiment,
    severity: (ai.severity ?? null) as Severity | null,
    incident_type: ai.incident_type ?? null,
    needs_attention: ai.needs_attention ?? null,
    priority: ai.priority as Priority,
    intent: ai.intent ?? "otro",
    topic: ai.topic ?? "otro",
    department_id: ai.department_id ?? null,
    neighborhood_id: ai.neighborhood_id ?? null,
  });
  const source = catalogs.sources.find((s) => s.id === item.mention?.source_id);
  const departments = new Map(catalogs.departments.map((d) => [d.id, d.name]));
  const neighborhoods = new Map(catalogs.neighborhoods.map((n) => [n.id, n.name]));
  const topics = catalogs.topics.includes(draft.topic) ? catalogs.topics : [draft.topic, ...catalogs.topics];

  function decide(decision: "confirmed" | "corrected" | "dismissed") {
    startTransition(async () => {
      const changes =
        decision === "corrected"
          ? Object.fromEntries(Object.entries(draft).filter(([k, v]) => (ai as Record<string, unknown>)[k] !== v))
          : {};
      const result = await decideReview({ reviewId: item.id, decision, changes, reason });
      if (!result.ok) return void toast.error(result.message);
      toast.success(result.message);
      router.refresh();
    });
  }

  return (
    <article className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-sm" aria-labelledby={`review-${item.id}`}>
      <header className="flex flex-wrap items-center gap-2">
        {item.reasons.map((r) => (
          <span
            key={r}
            title={REASON_LABELS[r as ReviewReason]?.hint}
            className={cn(
              "rounded-full border px-2 py-0.5 text-xs font-medium",
              r === "emergency" ? "border-negative bg-negative text-white" : r === "high_risk" || r === "risk_term" ? "border-negative/50 text-negative" : "",
            )}
          >
            {REASON_LABELS[r as ReviewReason]?.label ?? r}
          </span>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">En revisión desde {formatDateTime(item.created_at)}</span>
      </header>

      {item.mention ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">
            {source ? `${SOURCE_LABELS[source.type]} · ${source.name}` : "Fuente"} · {formatDateTime(item.mention.published_at)}
            {item.mention.author ? ` · ${item.mention.author}` : ""}
          </p>
          <p id={`review-${item.id}`} className="whitespace-pre-wrap leading-relaxed">
            {item.mention.text}
          </p>
          {item.mention.url && (
            <a href={item.mention.url} target="_blank" rel="noopener noreferrer" className="inline-flex w-fit items-center gap-1 text-xs text-primary hover:underline">
              Ver publicación original <ExternalLink className="size-3" aria-hidden />
            </a>
          )}
        </div>
      ) : (
        <p className="text-muted-foreground">La mención ya no existe.</p>
      )}

      <section aria-label="Salida del modelo" className="rounded-lg bg-muted/50 p-3">
        <p className="mb-2 text-xs text-muted-foreground">
          Modelo {ai.model} · confianza {ai.confidence === null ? "s/d" : pct.format(ai.confidence)}
        </p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
          <Field label="Sentimiento" value={SENTIMENT_LABELS[ai.sentiment as Sentiment] ?? ai.sentiment} />
          <Field label="Gravedad" value={ai.severity ? SEVERITY_LABELS[ai.severity as Severity] : "Sin evaluar"} />
          <Field label="Incidente" value={ai.incident_type ? (INCIDENT_LABELS[ai.incident_type] ?? ai.incident_type) : "Sin evaluar"} />
          <Field label="Atención" value={ai.needs_attention === null ? "—" : ai.needs_attention ? "Requiere" : "No requiere"} />
          <Field label="Urgencia" value={PRIORITY_LABELS[ai.priority as Priority] ?? ai.priority} />
          <Field label="Intención" value={ai.intent ? (INTENT_LABELS[ai.intent] ?? ai.intent) : "—"} />
          <Field label="Tema" value={ai.topic ?? "—"} />
          <Field label="Dependencia" value={ai.department_id ? (departments.get(ai.department_id) ?? "—") : "—"} />
          <Field label="Colonia" value={ai.neighborhood_id ? (neighborhoods.get(ai.neighborhood_id) ?? "—") : "—"} />
        </dl>
      </section>

      {mode === "correct" && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <OptionSelect label="Sentimiento" value={draft.sentiment} onChange={(v) => v && setDraft({ ...draft, sentiment: v as Sentiment })} options={SENTIMENTS.map((x) => ({ value: x, label: SENTIMENT_LABELS[x] }))} className="w-full" />
          <OptionSelect label="Gravedad" value={draft.severity} onChange={(v) => setDraft({ ...draft, severity: v as Severity | null })} emptyLabel="Sin evaluar" options={SEVERITIES.map((x) => ({ value: x, label: SEVERITY_LABELS[x] }))} className="w-full" />
          <OptionSelect label="Tipo de incidente" value={draft.incident_type} onChange={(v) => setDraft({ ...draft, incident_type: v })} emptyLabel="Sin evaluar" options={INCIDENT_TYPES.map((x) => ({ value: x, label: INCIDENT_LABELS[x] }))} className="w-full" />
          <OptionSelect
            label="Requiere atención"
            value={draft.needs_attention === null ? null : String(draft.needs_attention)}
            onChange={(v) => setDraft({ ...draft, needs_attention: v === null ? null : v === "true" })}
            emptyLabel="Sin evaluar"
            options={[
              { value: "true", label: "Sí requiere atención" },
              { value: "false", label: "No requiere atención" },
            ]}
            className="w-full"
          />
          <OptionSelect label="Urgencia" value={draft.priority} onChange={(v) => v && setDraft({ ...draft, priority: v as Priority })} options={PRIORITIES.map((x) => ({ value: x, label: PRIORITY_LABELS[x] }))} className="w-full" />
          <OptionSelect label="Intención" value={draft.intent} onChange={(v) => v && setDraft({ ...draft, intent: v })} options={INTENTS.map((x) => ({ value: x, label: INTENT_LABELS[x] }))} className="w-full" />
          <OptionSelect label="Tema" value={draft.topic} onChange={(v) => v && setDraft({ ...draft, topic: v })} options={topics.map((t) => ({ value: t, label: t }))} className="w-full" />
          <OptionSelect label="Dependencia" value={draft.department_id} onChange={(v) => setDraft({ ...draft, department_id: v })} emptyLabel="Sin dependencia" options={catalogs.departments.map((d) => ({ value: d.id, label: d.name }))} className="w-full" />
          <OptionSelect label="Colonia" value={draft.neighborhood_id} onChange={(v) => setDraft({ ...draft, neighborhood_id: v })} emptyLabel="Sin colonia" options={catalogs.neighborhoods.map((n) => ({ value: n.id, label: n.name }))} className="w-full" />
          <p className="col-span-full text-xs text-muted-foreground">
            Confirma el tipo de incidente y la urgencia sin cambiar el sentimiento si el tono fue bien leído: son independientes.
          </p>
        </div>
      )}

      {mode !== "view" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`reason-${item.id}`}>{mode === "correct" ? "Motivo de la corrección" : "Motivo para descartar"}</Label>
          <Textarea
            id={`reason-${item.id}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder={mode === "correct" ? "Es una queja con sarcasmo, no un elogio" : "Nota repetida; no requiere atención"}
          />
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {mode === "view" ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => setMode("dismiss")} disabled={pending}>
              <Trash2 aria-hidden /> Descartar
            </Button>
            <Button size="sm" variant="outline" onClick={() => setMode("correct")} disabled={pending}>
              <Pencil aria-hidden /> Corregir
            </Button>
            <Button size="sm" onClick={() => decide("confirmed")} disabled={pending}>
              <CheckCheck aria-hidden /> Confirmar
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="ghost" onClick={() => setMode("view")} disabled={pending}>
              Cancelar
            </Button>
            <Button size="sm" onClick={() => decide(mode === "correct" ? "corrected" : "dismissed")} disabled={pending || reason.trim().length < 3}>
              {pending ? "Guardando…" : mode === "correct" ? "Guardar corrección" : "Descartar mención"}
            </Button>
          </>
        )}
      </div>
    </article>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
