import { ExternalLink } from "lucide-react";
import { formatDateTime } from "@/components/inbox/format";
import type { CiMatch } from "@/lib/counterintel/model";

export function CiMatches({ matches }: { matches: CiMatch[] }) {
  if (matches.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Ninguna mención reciente contiene los indicadores de los reportes abiertos. Registra la URL, el dominio o la etiqueta de
        una página falsa para seguirla aquí.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2" aria-label="Menciones con indicadores">
      {matches.map((m) => (
        <li key={m.id} className="rounded-lg bg-muted/50 p-3 text-sm">
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded bg-background px-2 py-0.5 font-mono text-foreground">{m.indicator}</span>
            <span>{m.reportTitle}</span>
            <span>{formatDateTime(m.publishedAt)}</span>
            {m.source && <span>{m.source}</span>}
            {m.author && <span>{m.author}</span>}
          </p>
          <p className="mt-1 whitespace-pre-line">{m.text}</p>
          <p className="mt-2 flex flex-wrap gap-3 text-xs">
            <a className="underline" href={`/bandeja/${m.id}`}>
              Abrir en la bandeja
            </a>
            {m.url && (
              <a className="inline-flex items-center gap-1 underline" href={m.url} target="_blank" rel="noreferrer noopener">
                Publicación original <ExternalLink className="size-3" aria-hidden />
              </a>
            )}
          </p>
        </li>
      ))}
    </ul>
  );
}
