import { ExternalLink } from "lucide-react";
import { formatDateTime } from "@/components/inbox/format";
import type { CiThreat } from "@/lib/counterintel/model";

export function CiThreats({ threats }: { threats: CiThreat[] }) {
  if (threats.length === 0) return <p className="text-sm text-muted-foreground">Sin posibles amenazas en el periodo.</p>;
  return (
    <ul className="flex flex-col gap-2" aria-label="Posibles amenazas">
      {threats.map((t) => (
        <li key={t.id} className="rounded-lg bg-muted/50 p-3 text-sm">
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className={t.severity === "emergency" ? "font-semibold text-negative" : "font-medium text-foreground"}>
              {t.severity === "emergency" ? "Emergencia" : "Gravedad alta"}
            </span>
            <span>{formatDateTime(t.publishedAt)}</span>
            {t.source && <span>{t.source}</span>}
            {t.author && <span>{t.author}</span>}
          </p>
          <p className="mt-1 whitespace-pre-line">{t.text}</p>
          <p className="mt-2 flex flex-wrap gap-3 text-xs">
            <a className="underline" href={`/bandeja/${t.id}`}>
              Abrir en la bandeja
            </a>
            {t.url && (
              <a className="inline-flex items-center gap-1 underline" href={t.url} target="_blank" rel="noreferrer noopener">
                Publicación original <ExternalLink className="size-3" aria-hidden />
              </a>
            )}
          </p>
        </li>
      ))}
    </ul>
  );
}
