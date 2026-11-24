"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { XSearchRow } from "@/lib/query/x-search";


async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copiada.`);
  } catch {
    toast.error("No se pudo copiar; selecciona el texto y cópialo a mano.");
  }
}

/** The active queries as X searches, ready for an Apify tweet-scraper task. */
export function XSearches({ rows, input }: { rows: XSearchRow[]; input: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Búsquedas por tema para X (Apify)</CardTitle>
        <CardDescription>
          Tus consultas activas convertidas a búsquedas de X. Pégalas en una tarea de Apify de tweets y conéctala como fuente
          «Apify (no oficial)»: así entra lo que se dice de cada tema, sin seguir a nadie en particular.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay consultas activas. Créalas en Configuración → Proyectos (puedes partir de un tema).
          </p>
        ) : (
          <>
            <ul className="flex flex-col divide-y rounded-xl border" aria-label="Búsquedas de X">
              {rows.map((r) => (
                <li key={r.name} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-sm font-medium">{r.name}</span>
                    <code className="text-xs break-words text-muted-foreground">{r.search}</code>
                    {r.approximate && (
                      <span className="text-xs text-muted-foreground">
                        X no acepta <code>*</code>: se buscó la raíz de la palabra; la consulta filtra el resto al capturar.
                      </span>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => copy(r.search, "Búsqueda")} aria-label={`Copiar búsqueda ${r.name}`}>
                    <Copy aria-hidden /> Copiar
                  </Button>
                </li>
              ))}
            </ul>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">Entrada para la tarea (JSON)</span>
                <Button variant="outline" size="sm" onClick={() => copy(input, "Entrada")}>
                  <Copy aria-hidden /> Copiar JSON
                </Button>
              </div>
              <pre className="max-h-48 overflow-auto rounded-lg border bg-muted/50 p-3 font-mono text-xs">{input}</pre>
              <p className="text-xs text-muted-foreground">
                En Apify: abre un actor de tweets (por ejemplo «Tweet Scraper»), cambia la entrada a JSON, pega esto, guarda como
                tarea y prográmala cada 3 a 6 horas. Para Facebook, la búsqueda por palabra no es confiable: conecta páginas de
                medios y grupos vecinales y deja marcada la opción de guardar sólo lo que coincida con tus consultas.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
