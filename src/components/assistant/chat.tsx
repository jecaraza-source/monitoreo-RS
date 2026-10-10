"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowUp, Bot, Inbox, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { AssistantEvent, ChatMessage } from "@/lib/ai/assistant";
import type { ToolChart, ToolLink } from "@/lib/ai/tools";
import { cn } from "@/lib/utils";

// Recharts loads only when the first chart arrives.
const MiniChart = dynamic(() => import("./mini-chart").then((m) => m.MiniChart), {
  ssr: false,
  loading: () => <Skeleton className="h-36" />,
});

type Turn = {
  role: "user" | "assistant";
  text: string;
  charts: ToolChart[];
  links: ToolLink[];
  steps: string[];
  error?: string;
  pending?: boolean;
};

export function AssistantChat({ suggestions, scopeNote }: { suggestions: string[]; scopeNote: string | null }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const patchLast = (fn: (t: Turn) => Turn) => setTurns((list) => [...list.slice(0, -1), fn(list[list.length - 1])]);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    const history: ChatMessage[] = [
      ...turns.filter((t) => t.text.trim() && !t.error).map((t) => ({ role: t.role, content: t.text.trim() })),
      { role: "user", content: text },
    ];
    setTurns((list) => [
      ...list,
      { role: "user", text, charts: [], links: [], steps: [] },
      { role: "assistant", text: "", charts: [], links: [], steps: [], pending: true },
    ]);
    setDraft("");
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/asistente", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "No se pudo contactar al asistente.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as AssistantEvent;
          if (event.type === "text") patchLast((t) => ({ ...t, text: t.text + event.delta }));
          else if (event.type === "tool") patchLast((t) => ({ ...t, steps: [...t.steps, event.label] }));
          else if (event.type === "chart") patchLast((t) => ({ ...t, charts: [...t.charts, event.chart] }));
          else if (event.type === "links")
            patchLast((t) => ({ ...t, links: [...t.links, ...event.links.filter((l) => !t.links.some((x) => x.href === l.href))] }));
          else if (event.type === "error") patchLast((t) => ({ ...t, error: event.message }));
        }
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") patchLast((t) => ({ ...t, error: (error as Error).message }));
    } finally {
      patchLast((t) => ({ ...t, pending: false }));
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[60svh] flex-1 flex-col gap-4">
      {turns.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 py-8 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Sparkles className="size-6" aria-hidden />
          </span>
          <div className="flex max-w-md flex-col gap-1">
            <h2 className="text-lg font-semibold">¿Qué quieres saber de la conversación pública?</h2>
            <p className="text-sm text-muted-foreground">
              Respondo con las cifras del sistema y te dejo enlaces a la bandeja filtrada.{scopeNote ? ` ${scopeNote}` : ""}
            </p>
          </div>
          <ul className="grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
            {suggestions.map((q) => (
              <li key={q}>
                <button
                  type="button"
                  onClick={() => ask(q)}
                  className="h-full w-full rounded-xl border bg-card p-3 text-left text-sm transition-colors hover:border-primary/50 hover:bg-primary/5"
                >
                  {q}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ol className="flex flex-1 flex-col gap-5" aria-live="polite">
          {turns.map((turn, i) => (
            <li key={i} className={cn("flex gap-3", turn.role === "user" && "justify-end")}>
              {turn.role === "assistant" && (
                <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Bot className="size-4" aria-hidden />
                </span>
              )}
              {turn.role === "user" ? (
                <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-primary-foreground">{turn.text}</p>
              ) : (
                <div className="flex min-w-0 max-w-[92%] flex-1 flex-col gap-3">
                  {turn.steps.length > 0 && (
                    <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {turn.steps.map((s, j) => (
                        <span key={j}>· {s}</span>
                      ))}
                    </p>
                  )}
                  {turn.text.trim() ? <Markdown text={turn.text.trim()} /> : turn.pending && <Thinking />}
                  {turn.error && <p className="text-sm text-negative">{turn.error}</p>}
                  {turn.charts.map((chart, j) => (
                    <MiniChart key={j} chart={chart} />
                  ))}
                  {turn.links.length > 0 && !turn.pending && (
                    <div className="flex flex-wrap gap-2">
                      {turn.links.slice(0, 6).map((l) => (
                        <Link
                          key={l.href}
                          href={l.href}
                          className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs hover:border-primary/50 hover:bg-primary/5"
                        >
                          <Inbox className="size-3.5" aria-hidden /> {l.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
          <div ref={endRef} />
        </ol>
      )}

      <form
        className="sticky bottom-0 flex items-end gap-2 rounded-2xl border bg-card p-2 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(draft);
        }}
      >
        <label htmlFor="pregunta" className="sr-only">
          Pregunta
        </label>
        <Textarea
          id="pregunta"
          rows={1}
          value={draft}
          maxLength={2000}
          placeholder="Pregunta, por ejemplo: ¿qué dependencia tiene peor sentimiento este mes?"
          className="max-h-40 min-h-9 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask(draft);
            }
          }}
        />
        {turns.length > 0 && (
          <Button type="button" variant="ghost" size="icon" aria-label="Nueva conversación" disabled={busy} onClick={() => setTurns([])}>
            <RotateCcw aria-hidden />
          </Button>
        )}
        <Button type="submit" size="icon" aria-label="Enviar" disabled={busy || !draft.trim()}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <ArrowUp aria-hidden />}
        </Button>
      </form>
      <p className="text-center text-xs text-muted-foreground">Las respuestas usan sólo datos de la plataforma. Verifica antes de difundir.</p>
    </div>
  );
}

function Thinking() {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden /> Analizando…
    </p>
  );
}

/** Minimal Markdown: paragraphs, "- " bullets and **bold** (no HTML is interpreted). */
function Markdown({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="flex flex-col gap-2 text-[0.95rem] leading-relaxed">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        if (lines.every((l) => /^\s*[-•*]\s+/.test(l))) {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {lines.map((l, j) => (
                <li key={j}>
                  <Inline text={l.replace(/^\s*[-•*]\s+/, "")} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                <Inline text={l.replace(/^#+\s*/, "")} />
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i} className="font-semibold">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
