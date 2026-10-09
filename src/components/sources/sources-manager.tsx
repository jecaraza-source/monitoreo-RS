"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, FlaskConical, Pause, Pencil, Play, Plus, RefreshCw, Rss, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui-kit";
import {
  deleteSource,
  runSourceNow,
  setSourceActive,
  testSource,
  type TestResult,
} from "@/lib/sources/actions";
import type { ConnectorInfo, SourceView } from "@/lib/sources/data";
import { cn } from "@/lib/utils";
import { SourceForm } from "./source-form";

const relative = new Intl.RelativeTimeFormat("es-MX", { numeric: "auto" });
function ago(iso: string | null): string {
  if (!iso) return "nunca";
  const minutes = Math.round((Date.parse(iso) - Date.now()) / 60_000);
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 48) return relative.format(hours, "hour");
  return relative.format(Math.round(hours / 24), "day");
}

function describe(source: SourceView): string {
  const c = source.config;
  if (source.type === "rss") return String(c.url ?? "");
  if (source.type === "meta") return `Página ${String(c.pageId ?? "")}${c.includeComments === false ? "" : " · con comentarios"}`;
  if (source.type === "youtube") {
    return [c.query ? `“${String(c.query)}”` : null, c.channelId ? `canal ${String(c.channelId)}` : null].filter(Boolean).join(" · ");
  }
  return "";
}

export function SourcesManager({ connectors, sources }: { connectors: ConnectorInfo[]; sources: SourceView[] }) {
  const [editing, setEditing] = useState<SourceView | "new" | null>(sources.length === 0 ? "new" : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, TestResult | string>>({});
  const [, startTransition] = useTransition();
  const label = (type: string) => connectors.find((c) => c.type === type)?.label ?? type;

  function act(id: string, kind: string, fn: () => Promise<{ ok: boolean; message: string }>) {
    setBusy(`${id}:${kind}`);
    startTransition(async () => {
      const result = await fn();
      setBusy(null);
      (result.ok ? toast.success : toast.error)(result.message);
    });
  }

  function test(id: string) {
    setBusy(`${id}:test`);
    startTransition(async () => {
      const result = await testSource(id);
      setBusy(null);
      setTests((t) => ({ ...t, [id]: result.ok ? result.data! : result.message }));
      (result.ok ? toast.success : toast.error)(result.message);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {editing ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2">{editing === "new" ? "Conectar fuente" : `Editar ${editing.name}`}</CardTitle>
            <CardDescription>Sólo contenido público, por APIs oficiales o RSS.</CardDescription>
          </CardHeader>
          <CardContent>
            <SourceForm
              key={editing === "new" ? "new" : editing.id}
              connectors={connectors}
              editing={editing === "new" ? null : editing}
              onDone={() => setEditing(null)}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="flex justify-end">
          <Button onClick={() => setEditing("new")}>
            <Plus aria-hidden /> Conectar fuente
          </Button>
        </div>
      )}

      {sources.length === 0 ? (
        <EmptyState icon={<Rss />} title="Sin fuentes" description="Conecta un feed RSS, una página de Facebook o una búsqueda de YouTube." />
      ) : (
        <ul className="flex flex-col gap-3">
          {sources.map((source) => {
            const failing = source.consecutiveFailures > 0;
            const available = connectors.find((c) => c.type === source.type)?.enabled ?? false;
            const result = tests[source.id];
            return (
              <li key={source.id} className={cn("rounded-xl border p-4", !source.isActive && "opacity-70")}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium">{source.name}</h3>
                      <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{label(source.type)}</span>
                      {!source.isActive && <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs">Pausada</span>}
                      {source.type === "meta" && !source.hasSecret && (
                        <span className="rounded-md bg-negative/12 px-1.5 py-0.5 text-xs text-negative">Sin token</span>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground" title={describe(source)}>
                      {describe(source)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Último éxito: {ago(source.lastSuccessAt)} · Última corrida: {ago(source.lastRunAt)}
                    </p>
                    {failing && source.lastError && (
                      <p className="flex items-start gap-1.5 text-xs text-negative">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                        <span>
                          {source.lastError} ({source.consecutiveFailures}{" "}
                          {source.consecutiveFailures === 1 ? "fallo" : "fallos seguidos"}, {ago(source.lastErrorAt)})
                        </span>
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Button variant="outline" size="sm" disabled={busy !== null || !available} onClick={() => test(source.id)}>
                      <FlaskConical aria-hidden /> {busy === `${source.id}:test` ? "Probando…" : "Probar"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy !== null || !source.isActive || !available}
                      onClick={() => act(source.id, "run", () => runSourceNow(source.id))}
                    >
                      <RefreshCw aria-hidden className={cn(busy === `${source.id}:run` && "animate-spin")} /> Ejecutar ahora
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={source.isActive ? `Pausar ${source.name}` : `Activar ${source.name}`}
                      disabled={busy !== null || (!available && !source.isActive)}
                      onClick={() => act(source.id, "toggle", () => setSourceActive(source.id, !source.isActive))}
                    >
                      {source.isActive ? <Pause aria-hidden /> : <Play aria-hidden />}
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Editar ${source.name}`} onClick={() => setEditing(source)}>
                      <Pencil aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Eliminar ${source.name}`}
                      disabled={busy !== null}
                      onClick={() => confirm(`¿Eliminar ${source.name}?`) && act(source.id, "delete", () => deleteSource(source.id))}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                </div>

                {result && (
                  <div className="mt-3 rounded-lg bg-muted/50 p-3 text-sm" aria-live="polite">
                    {typeof result === "string" ? (
                      <p className="text-negative">{result}</p>
                    ) : (
                      <>
                        <p className="mb-2 text-xs text-muted-foreground">
                          Prueba (últimos 7 días, sin guardar): {result.fetched} encontrados · {result.kept} se guardarían
                          {result.unmatched > 0 && ` · ${result.unmatched} sin consulta`}
                        </p>
                        {result.sample.length === 0 ? (
                          <p className="text-xs text-muted-foreground">Nada que guardar con las consultas activas.</p>
                        ) : (
                          <ul className="flex flex-col gap-2">
                            {result.sample.map((s, i) => (
                              <li key={i} className="flex flex-col gap-0.5">
                                <span className="line-clamp-2">{s.text}</span>
                                <span className="text-xs text-muted-foreground">
                                  {s.queryName ? `Consulta: ${s.queryName}` : "Sin consulta"} · {ago(s.publishedAt)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
