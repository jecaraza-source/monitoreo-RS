import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/components/inbox/format";
import { CASE_STATUS_LABELS } from "@/lib/cases/model";
import { inboxHref } from "@/lib/dashboard/model";
import { PRIORITY_LABELS, SENTIMENT_LABELS } from "@/lib/inbox/model";
import { casesHref, LOCATION_SOURCE_LABELS, type CaseColoniaRow, type CaseMapRow } from "@/lib/map/cases";
import type { UnlocatedMentions } from "@/lib/map/data";
import { mapHref, METRICS, TABLE_ALL_ROWS, type MapFilters, type MapRow } from "@/lib/map/model";
import { cn } from "@/lib/utils";

// Accessible equivalents of the map: real tables (keyboard and screen
// readers), with the same numbers and a note for colonias that are zero,
// approximate or not drawable. Server components: they render without JS.

const integer = new Intl.NumberFormat("es-MX");
type Period = { fromDay: string; toDay: string };
type Note = { drawable: boolean; problem: string | null; approx: boolean };

function note(c: Note, value: number, unit: string): string {
  const parts = [];
  if (c.problem) parts.push(`${c.problem}: no se dibuja`);
  else if (c.approx) parts.push("Zona aproximada");
  if (value === 0) parts.push(`0 ${unit} en el periodo`);
  return parts.join(" · ") || "—";
}

function ColoniaLink({ id, name, current, selected }: { id: string; name: string; current: string; selected: boolean }) {
  return (
    <Link
      href={mapHref(new URLSearchParams(current), { colonia: selected ? null : id })}
      scroll={false}
      aria-current={selected || undefined}
      className="font-medium underline-offset-2 hover:underline aria-[current]:underline"
    >
      {name}
    </Link>
  );
}

/**
 * Large catalogs list the colonias with activity first; the ones in zero come
 * on request (the count says how many), so the table stays usable and light.
 */
function visibleRows<T extends { id: string; total: number }>(rows: T[], current: string, selectedId: string | null) {
  const showAll = rows.length <= TABLE_ALL_ROWS || new URLSearchParams(current).get("ceros") === "1";
  const zeros = rows.filter((r) => r.total === 0).length;
  return {
    rows: showAll ? rows : rows.filter((r) => r.total > 0 || r.id === selectedId),
    hiddenZeros: showAll ? 0 : zeros,
    toggle:
      rows.length > TABLE_ALL_ROWS && zeros > 0
        ? { href: mapHref(new URLSearchParams(current), { ceros: showAll ? null : "1" }), label: showAll ? "Ocultar las colonias en cero" : `Mostrar también las ${integer.format(zeros)} colonias en cero` }
        : null,
  };
}

function ZeroToggle({ toggle, hidden }: { toggle: { href: string; label: string } | null; hidden: number }) {
  if (!toggle) return null;
  return (
    <p className="mt-3 text-xs text-muted-foreground">
      {hidden > 0 && `${integer.format(hidden)} colonias en cero no se listan. `}
      <Link href={toggle.href} scroll={false} className="underline">
        {toggle.label}
      </Link>
    </p>
  );
}

export function ConversationTable({
  rows,
  notes,
  current,
  selectedId,
}: {
  rows: MapRow[];
  notes: Map<string, Note>;
  current: string;
  selectedId: string | null;
}) {
  const shown = visibleRows(rows, current, selectedId);
  const sorted = [...shown.rows].sort((a, b) => b.complaints - a.complaints || b.total - a.total || a.name.localeCompare(b.name, "es"));
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Tabla por colonia</CardTitle>
        <CardDescription>Los mismos datos del mapa. Cada colonia abre su detalle; las cifras coinciden con la bandeja con los mismos filtros.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="max-h-[32rem] overflow-auto" tabIndex={0} role="region" aria-label="Tabla de menciones por colonia, desplazable">
          <Table aria-label="Menciones por colonia">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Colonia</TableHead>
                <TableHead scope="col" className="text-right">Menciones</TableHead>
                <TableHead scope="col" className="text-right">Quejas</TableHead>
                <TableHead scope="col" className="text-right">% negativo</TableHead>
                <TableHead scope="col" className="text-right">NSS</TableHead>
                <TableHead scope="col">Nota</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((r) => {
                const neg = METRICS.negativo.value(r);
                const score = METRICS.nss.value(r);
                const n = notes.get(r.id) ?? { drawable: true, problem: null, approx: r.approx };
                return (
                  <TableRow key={r.id} className={cn(r.id === selectedId && "bg-muted/60")}>
                    <TableCell>
                      <ColoniaLink id={r.id} name={r.name} current={current} selected={r.id === selectedId} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{integer.format(r.total)}</TableCell>
                    <TableCell className="text-right tabular-nums">{integer.format(r.complaints)}</TableCell>
                    <TableCell className="text-right tabular-nums">{neg === null ? "—" : `${Math.round(neg)} %`}</TableCell>
                    <TableCell className="text-right tabular-nums">{score === null ? "—" : Math.round(score)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{note(n, r.total, "menciones")}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <ZeroToggle toggle={shown.toggle} hidden={shown.hiddenZeros} />
      </CardContent>
    </Card>
  );
}

export function CasesTable({ rows, current, selectedId }: { rows: CaseColoniaRow[]; current: string; selectedId: string | null }) {
  const shown = visibleRows(rows, current, selectedId);
  const sorted = [...shown.rows].sort((a, b) => b.total - a.total || b.overdue - a.overdue || a.name.localeCompare(b.name, "es"));
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Tabla por colonia</CardTitle>
        <CardDescription>Los mismos casos del mapa. «Inferida» cuenta en la colonia pero no es una ubicación exacta.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="max-h-[32rem] overflow-auto" tabIndex={0} role="region" aria-label="Tabla de casos por colonia, desplazable">
          <Table aria-label="Casos por colonia">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Colonia</TableHead>
                <TableHead scope="col" className="text-right">Casos</TableHead>
                <TableHead scope="col" className="text-right">Vencidos</TableHead>
                <TableHead scope="col" className="text-right">Confirmados</TableHead>
                <TableHead scope="col" className="text-right">Inferidos</TableHead>
                <TableHead scope="col">Nota</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((r) => (
                <TableRow key={r.id} className={cn(r.id === selectedId && "bg-muted/60")}>
                  <TableCell>
                    <ColoniaLink id={r.id} name={r.name} current={current} selected={r.id === selectedId} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{integer.format(r.total)}</TableCell>
                  <TableCell className="text-right tabular-nums">{integer.format(r.overdue)}</TableCell>
                  <TableCell className="text-right tabular-nums">{integer.format(r.confirmed)}</TableCell>
                  <TableCell className="text-right tabular-nums">{integer.format(r.inferred)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{note(r, r.total, "casos")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <ZeroToggle toggle={shown.toggle} hidden={shown.hiddenZeros} />
      </CardContent>
    </Card>
  );
}

/** Mentions without colonia: counted and listed (no text: the inbox shows it). */
export function UnlocatedMentionsList({ data, period }: { data: UnlocatedMentions; period: Period }) {
  return (
    <Card id="sin-ubicacion">
      <CardHeader>
        <CardTitle as="h2">Menciones sin colonia: {integer.format(data.count)}</CardTitle>
        <CardDescription>
          No aparecen en el mapa, pero cuentan: {integer.format(data.complaints)} son quejas. Las más recientes; ábrelas en la bandeja para ver el texto.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data.items.length ? (
          <ul className="flex flex-col divide-y text-sm" aria-label="Menciones sin colonia">
            {data.items.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5">
                <span className="text-xs text-muted-foreground tabular-nums">{formatDateTime(m.published_at)}</span>
                <span>{m.topic ?? "Sin tema"}</span>
                {m.sentiment && <span className="text-xs text-muted-foreground">{SENTIMENT_LABELS[m.sentiment]}</span>}
                {m.complaint && <span className="text-xs text-muted-foreground">Queja</span>}
                <Link href={inboxHref(period, { mention: m.id })} className="ml-auto text-xs underline">
                  Ver en la bandeja
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Todas las menciones del periodo tienen colonia.</p>
        )}
      </CardContent>
    </Card>
  );
}

/** Cases without location: counted and listed (folio and state, no title). */
export function UnlocatedCasesList({ cases, filters, period }: { cases: CaseMapRow[]; filters: MapFilters; period: Period }) {
  return (
    <Card id="sin-ubicacion">
      <CardHeader>
        <CardTitle as="h2">Casos sin ubicación: {integer.format(cases.length)}</CardTitle>
        <CardDescription>
          No aparecen en el mapa, pero cuentan.{" "}
          <Link href={casesHref(filters, period, "sin")} className="underline">
            Verlos en Casos con los mismos filtros
          </Link>
          .
        </CardDescription>
      </CardHeader>
      <CardContent>
        {cases.length ? (
          <ul className="flex flex-col divide-y text-sm" aria-label="Casos sin ubicación">
            {cases.slice(0, 50).map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5">
                <Link href={`/casos/${c.id}`} className="font-mono text-xs underline">
                  {c.folio}
                </Link>
                <span>{c.category ?? "Sin categoría"}</span>
                <span className="text-xs text-muted-foreground">
                  {PRIORITY_LABELS[c.priority]} · {CASE_STATUS_LABELS[c.status]}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">{LOCATION_SOURCE_LABELS.sin_dato}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Todos los casos de estos filtros tienen colonia.</p>
        )}
      </CardContent>
    </Card>
  );
}
