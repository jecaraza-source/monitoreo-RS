"use client";

import { AUTHOR_KIND_LABEL } from "@/lib/authors/label";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Lightbulb, MapPin, Plus, Tag, X } from "lucide-react";
import { toast } from "sonner";
import { fromNow, formatDateTime } from "@/components/inbox/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SentimentBadge } from "@/components/ui-kit";
import { addMentionsToCase, removeMentionFromCase } from "@/lib/cases/actions";
import type { CaseMention, CaseSuggestion } from "@/lib/cases/data";

const nf = new Intl.NumberFormat("es-MX");
const pct = new Intl.NumberFormat("es-MX", { style: "percent", maximumFractionDigits: 0 });

type Pending = { kind: "remove"; mention: CaseMention } | { kind: "add"; suggestion: CaseSuggestion };

/** Mentions of the case (each one still counts) and, for editors, grouping suggestions a person confirms. */
export function CaseMentions({
  caseId,
  mentions,
  suggestions,
  editor,
  neighborhoods,
}: {
  caseId: string;
  mentions: CaseMention[];
  suggestions: CaseSuggestion[];
  editor: boolean;
  neighborhoods: Record<string, string>;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? mentions : mentions.slice(0, 20);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!confirm) return;
    startTransition(async () => {
      const result =
        confirm.kind === "remove"
          ? await removeMentionFromCase({ caseId, mentionId: confirm.mention.id, reason: reason.trim() })
          : await addMentionsToCase({ caseId, mentionIds: [confirm.suggestion.id], reason: reason.trim() || "Sugerencia confirmada" });
      if (!result.ok) return void toast.error(result.message);
      toast.success(result.message);
      setConfirm(null);
      setReason("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2" aria-label="Menciones del caso">
        {visible.map((m) => (
          <li key={m.id} className="flex flex-col gap-1.5 rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{m.author?.name ?? "Autor desconocido"}</span>
              {m.author && m.author.kind !== "citizen" && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">{AUTHOR_KIND_LABEL[m.author.kind]}</span>
              )}
              <span>· {formatDateTime(m.published_at)}</span>
              {m.primary && <span className="rounded-full bg-muted px-2 py-0.5">Mención principal</span>}
              {m.url && (
                <a href={m.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                  Original <ExternalLink className="size-3" aria-hidden />
                </a>
              )}
              {editor && mentions.length > 1 && (
                <Button
                  size="xs"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => setConfirm({ kind: "remove", mention: m })}
                  aria-label="Quitar del caso"
                >
                  <X aria-hidden /> Quitar
                </Button>
              )}
            </div>
            <p className="line-clamp-3 leading-snug">{m.text}</p>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {m.sentiment && <SentimentBadge sentiment={m.sentiment} />}
              {m.topic && (
                <span className="inline-flex items-center gap-1">
                  <Tag className="size-3" aria-hidden /> {m.topic}
                </span>
              )}
              {m.neighborhood_id && neighborhoods[m.neighborhood_id] && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3" aria-hidden /> {neighborhoods[m.neighborhood_id]}
                </span>
              )}
              {m.reason && <span>· Motivo: {m.reason}</span>}
            </div>
          </li>
        ))}
      </ul>
      {mentions.length > visible.length && (
        <Button variant="outline" size="sm" className="w-fit" onClick={() => setShowAll(true)}>
          Ver las {nf.format(mentions.length)} menciones
        </Button>
      )}

      {editor && suggestions.length > 0 && (
        <section aria-labelledby="suggestions-title" className="flex flex-col gap-2 rounded-lg border border-dashed p-3">
          <h3 id="suggestions-title" className="flex items-center gap-1.5 text-sm font-medium">
            <Lightbulb className="size-4" aria-hidden /> Posiblemente del mismo problema
          </h3>
          <p className="text-xs text-muted-foreground">
            Por cercanía de lugar, palabras y tiempo. No se agregan solas: revisa cada una.
          </p>
          <ul className="flex flex-col gap-2">
            {suggestions.map((s) => (
              <li key={s.id} className="flex items-start gap-3 text-sm">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="line-clamp-2">{s.text}</span>
                  <span className="text-xs text-muted-foreground" suppressHydrationWarning>
                    {[
                      s.same_neighborhood && "misma colonia",
                      s.word_overlap > 0 && `${pct.format(s.word_overlap)} de palabras en común`,
                      s.same_topic && "mismo tema",
                      fromNow(s.published_at),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <Button size="xs" variant="outline" onClick={() => setConfirm({ kind: "add", suggestion: s })}>
                  <Plus aria-hidden /> Agregar
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          {confirm && (
            <form onSubmit={submit} className="flex flex-col gap-4">
              <DialogHeader>
                <DialogTitle>{confirm.kind === "remove" ? "Quitar mención del caso" : "Agregar mención al caso"}</DialogTitle>
                <DialogDescription className="line-clamp-3">
                  {confirm.kind === "remove" ? confirm.mention.text : confirm.suggestion.text}
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mention-reason">{confirm.kind === "remove" ? "Motivo" : "Motivo (opcional)"}</Label>
                <Textarea
                  id="mention-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                  rows={2}
                  required={confirm.kind === "remove"}
                  placeholder={confirm.kind === "remove" ? "Es otro problema, otra calle…" : "Misma fuga, misma calle"}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setConfirm(null)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={pending || (confirm.kind === "remove" && reason.trim().length < 3)}>
                  {pending ? "Guardando…" : confirm.kind === "remove" ? "Quitar" : "Agregar"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
