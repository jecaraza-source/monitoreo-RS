import { Info } from "lucide-react";
import { formatDateTime } from "@/components/inbox/format";
import { KPI_VERSION } from "@/lib/kpi/dictionary";
import { comparabilityNotes, type KpiSnapshot } from "@/lib/kpi/snapshot";

const integer = new Intl.NumberFormat("es-MX");
const pct = (part: number, total: number) => (total ? `${Math.round((part / total) * 1000) / 10} %` : "0 %");

/**
 * What the figures cover: the cut, the last data in, what is not classified
 * or located yet, partial sources, and why the comparison may not be like for like.
 */
export function CoverageBar({ snapshot, previousLabel }: { snapshot: KpiSnapshot; previousLabel: string }) {
  const c = snapshot.conversation.current;
  const a = snapshot.attention.current;
  const notes = comparabilityNotes(snapshot);
  return (
    <section aria-label="Cobertura y actualización" className="rounded-xl border bg-card px-4 py-3 text-xs text-muted-foreground">
      <dl className="flex flex-wrap gap-x-5 gap-y-1">
        <Item label="Corte">{formatDateTime(snapshot.period.cut)} (CDMX)</Item>
        <Item label="Última mención recolectada">{snapshot.coverage.lastMentionAt ? formatDateTime(snapshot.coverage.lastMentionAt) : "—"}</Item>
        <Item label="Última clasificación">{snapshot.coverage.lastClassifiedAt ? formatDateTime(snapshot.coverage.lastClassifiedAt) : "—"}</Item>
        <Item label="Sin clasificar">
          {integer.format(c.unclassified)} de {integer.format(c.mentions)} menciones ({pct(c.unclassified, c.mentions)})
        </Item>
        <Item label="Clasificadas sin colonia">
          {integer.format(c.withoutNeighborhood)} ({pct(c.withoutNeighborhood, c.classified)})
        </Item>
        <Item label="Casos nuevos sin categoría / sin ubicación">
          {integer.format(a.openedWithoutCategory)} / {integer.format(a.openedWithoutLocation)}
        </Item>
        <Item label="Fuentes">
          {snapshot.coverage.sourcesPartial.length
            ? `${snapshot.coverage.sourcesPartial.length} de ${snapshot.coverage.sourcesActive} con lectura parcial`
            : `${snapshot.coverage.sourcesActive} activas, leídas hasta el corte`}
        </Item>
        <Item label="Gráficas">{snapshot.coverage.rollupRefreshedAt ? `actualizadas ${formatDateTime(snapshot.coverage.rollupRefreshedAt)}` : "—"}</Item>
        <Item label="Definiciones">{KPI_VERSION}</Item>
      </dl>
      {notes.length > 0 && (
        <div className="mt-2 flex gap-2 border-t pt-2">
          <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <div>
            <p className="font-medium text-foreground">Comparación con {previousLabel}</p>
            <ul className="list-disc pl-4">
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-1">
      <dt>{label}:</dt>
      <dd className="font-medium text-foreground tabular-nums">{children}</dd>
    </div>
  );
}
