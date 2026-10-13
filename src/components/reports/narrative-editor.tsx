"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Plus, Save, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  isStructured,
  SUMMARY_MAX_WORDS,
  validateNarrative,
  wordCount,
  type AnyNarrative,
  type FactReference,
  type LegacyNarrative,
  type Narrative,
  type ReportFacts,
} from "@/lib/ai/narrative";
import { splitList } from "@/lib/alerts/rules";
import { saveReport } from "@/lib/reports/actions";
import { cn } from "@/lib/utils";

const lines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

type Statement = { text: string; refs: string[] };
type StatementKey = "what_changed" | "decisions" | "pending";

const SECTIONS: { key: StatementKey; title: string; hint: string; min: number; max: number }[] = [
  { key: "what_changed", title: "Qué cambió", hint: "Frente al periodo anterior, en conversación y en atención.", min: 1, max: 6 },
  { key: "decisions", title: "Qué requiere decisión", hint: "Lo que la coordinación o el cabildo debe decidir.", min: 0, max: 5 },
  { key: "pending", title: "Qué sigue pendiente", hint: "Casos vencidos y asuntos abiertos.", min: 0, max: 6 },
];

export function NarrativeEditor({
  reportId,
  narrative,
  facts,
  recipients,
  editable,
}: {
  reportId: string;
  narrative: AnyNarrative;
  facts: ReportFacts;
  recipients: string[];
  editable: boolean;
}) {
  if (!isStructured(narrative)) return <LegacyNarrativeView reportId={reportId} n={narrative} facts={facts} recipients={recipients} editable={editable} />;
  if (!editable) return <NarrativeReadOnly n={narrative} facts={facts} />;
  return <StructuredEditor reportId={reportId} initial={narrative} facts={facts} initialRecipients={recipients} />;
}

function StructuredEditor({ reportId, initial, facts, initialRecipients }: { reportId: string; initial: Narrative; facts: ReportFacts; initialRecipients: string[] }) {
  const [n, setN] = useState<Narrative>(initial);
  const [recipients, setRecipients] = useState(initialRecipients.join(", "));
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();
  const check = useMemo(() => validateNarrative(n, facts), [n, facts]);
  const references = facts.references ?? [];
  const owners = facts.allowed_owners ?? [];

  const update = (patch: Partial<Narrative>) => {
    setN((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };

  function save() {
    startTransition(async () => {
      const r = await saveReport({ reportId, narrative: n, recipients: splitList(recipients) });
      if (r.ok) {
        toast.success(r.message);
        setDirty(false);
      } else toast.error(r.message);
    });
  }

  const words = wordCount(n.executive_summary);
  return (
    <section aria-labelledby="narrativa" className="flex flex-col gap-5 rounded-xl border bg-card p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="narrativa" className="text-lg font-semibold">
          Narrativa
        </h2>
        <Button onClick={save} disabled={pending || !dirty}>
          <Save aria-hidden /> {dirty ? "Guardar cambios" : "Guardado"}
        </Button>
      </div>

      <CheckPanel check={check} />

      <Field label="Titular" htmlFor="n-headline">
        <Input id="n-headline" value={n.headline} onChange={(e) => update({ headline: e.target.value })} />
      </Field>
      <Field label="Resumen ejecutivo" htmlFor="n-summary" hint={`${words} / ${SUMMARY_MAX_WORDS} palabras`} warn={words > SUMMARY_MAX_WORDS}>
        <Textarea id="n-summary" rows={5} value={n.executive_summary} onChange={(e) => update({ executive_summary: e.target.value })} />
      </Field>

      {SECTIONS.slice(0, 2).map((s) => (
        <StatementList key={s.key} section={s} items={n[s.key]} references={references} onChange={(items) => update({ [s.key]: items })} />
      ))}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Quién debe actuar</legend>
        <p className="text-xs text-muted-foreground">El responsable es una dependencia o área del catálogo, nunca una persona.</p>
        {n.actions.map((a, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto]">
              <select
                aria-label={`Responsable de la acción ${i + 1}`}
                className="h-8 rounded-lg border bg-transparent px-2 text-sm"
                value={owners.includes(a.owner) ? a.owner : ""}
                onChange={(e) => update({ actions: n.actions.map((x, j) => (j === i ? { ...x, owner: e.target.value } : x)) })}
              >
                <option value="">{a.owner && !owners.includes(a.owner) ? `${a.owner} (fuera del catálogo)` : "Elige el responsable"}</option>
                {owners.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
              <Input
                aria-label={`Plazo de la acción ${i + 1}`}
                value={a.deadline}
                placeholder="Plazo"
                onChange={(e) => update({ actions: n.actions.map((x, j) => (j === i ? { ...x, deadline: e.target.value } : x)) })}
              />
              <RemoveButton label={`Quitar acción ${i + 1}`} disabled={n.actions.length <= 1} onClick={() => update({ actions: n.actions.filter((_, j) => j !== i) })} />
            </div>
            <Textarea
              aria-label={`Acción ${i + 1}`}
              rows={2}
              value={a.action}
              onChange={(e) => update({ actions: n.actions.map((x, j) => (j === i ? { ...x, action: e.target.value } : x)) })}
            />
            <RefPicker
              label={`Evidencia de la acción ${i + 1}`}
              value={a.refs}
              references={references}
              onChange={(refs) => update({ actions: n.actions.map((x, j) => (j === i ? { ...x, refs } : x)) })}
            />
          </div>
        ))}
        {n.actions.length < 8 && (
          <Button size="sm" variant="outline" className="self-start" onClick={() => update({ actions: [...n.actions, { owner: "", action: "", deadline: "", refs: [] }] })}>
            <Plus aria-hidden /> Acción
          </Button>
        )}
      </fieldset>

      <StatementList section={SECTIONS[2]} items={n.pending} references={references} onChange={(items) => update({ pending: items })} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Riesgos (uno por línea)" htmlFor="n-risks">
          <Textarea id="n-risks" rows={4} defaultValue={n.risks.join("\n")} onChange={(e) => update({ risks: lines(e.target.value) })} />
        </Field>
        <Field label="Mensajes clave para comunicación social (uno por línea)" htmlFor="n-msg">
          <Textarea id="n-msg" rows={4} defaultValue={n.messaging.join("\n")} onChange={(e) => update({ messaging: lines(e.target.value) })} />
        </Field>
      </div>

      <Field label="Destinatarios del PDF" htmlFor="n-to" hint="Correos separados por coma. Reciben el PDF al aprobar.">
        <Input
          id="n-to"
          value={recipients}
          onChange={(e) => {
            setRecipients(e.target.value);
            setDirty(true);
          }}
        />
      </Field>
    </section>
  );
}

function StatementList({
  section,
  items,
  references,
  onChange,
}: {
  section: (typeof SECTIONS)[number];
  items: Statement[];
  references: FactReference[];
  onChange: (items: Statement[]) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{section.title}</legend>
      <p className="text-xs text-muted-foreground">{section.hint} Cada afirmación cita al menos un dato.</p>
      {items.map((item, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-lg border p-3">
          <div className="flex items-start gap-2">
            <Textarea
              aria-label={`${section.title} ${i + 1}`}
              rows={2}
              value={item.text}
              onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
            />
            <RemoveButton label={`Quitar ${section.title.toLowerCase()} ${i + 1}`} disabled={items.length <= section.min} onClick={() => onChange(items.filter((_, j) => j !== i))} />
          </div>
          <RefPicker
            label={`Evidencia de ${section.title.toLowerCase()} ${i + 1}`}
            value={item.refs}
            references={references}
            onChange={(refs) => onChange(items.map((x, j) => (j === i ? { ...x, refs } : x)))}
          />
        </div>
      ))}
      {items.length < section.max && (
        <Button size="sm" variant="outline" className="self-start" onClick={() => onChange([...items, { text: "", refs: [] }])}>
          <Plus aria-hidden /> {section.title}
        </Button>
      )}
    </fieldset>
  );
}

const KIND_LABELS: Record<FactReference["kind"], string> = {
  kpi: "Indicadores",
  caso: "Casos",
  mencion: "Menciones",
  dependencia: "Dependencias",
  tema: "Temas",
  pico: "Picos",
  colonia: "Colonias",
};

/** The references a statement rests on, chosen from the authorized list of the facts. */
function RefPicker({ label, value, references, onChange }: { label: string; value: string[]; references: FactReference[]; onChange: (refs: string[]) => void }) {
  const byId = new Map(references.map((r) => [r.id, r]));
  const groups = Object.entries(KIND_LABELS)
    .map(([kind, title]) => ({ title, items: references.filter((r) => r.kind === kind && !value.includes(r.id)) }))
    .filter((g) => g.items.length);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">Evidencia:</span>
      {value.map((id) => (
        <span
          key={id}
          className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs", !byId.has(id) && "border-negative/60 text-negative")}
        >
          {byId.get(id)?.label ?? `${id} (no existe)`}
          <button type="button" aria-label={`Quitar ${byId.get(id)?.label ?? id}`} onClick={() => onChange(value.filter((x) => x !== id))}>
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}
      {value.length < 8 && groups.length > 0 && (
        <select
          aria-label={label}
          className="h-7 rounded-md border bg-transparent px-1.5 text-xs"
          value=""
          onChange={(e) => e.target.value && onChange([...value, e.target.value])}
        >
          <option value="">+ Agregar dato</option>
          {groups.map((g) => (
            <optgroup key={g.title} label={g.title}>
              {g.items.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      )}
    </div>
  );
}

function CheckPanel({ check }: { check: ReturnType<typeof validateNarrative> }) {
  if (check.ok) {
    return (
      <p role="status" className="flex items-center gap-2 rounded-lg border border-positive/40 bg-positive/10 p-3 text-sm">
        <CheckCircle2 className="size-4 shrink-0 text-positive" aria-hidden /> Cifras, referencias y responsables verificados contra los datos del reporte.
      </p>
    );
  }
  return (
    <div role="status" className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
      <div className="flex flex-col gap-1">
        <p className="font-medium">No se puede aprobar todavía.</p>
        {check.unknownNumbers.length > 0 && (
          <p>
            Cifras que no están en los datos del periodo: <strong>{check.unknownNumbers.join(", ")}</strong>.
          </p>
        )}
        {check.unknownRefs.length > 0 && (
          <p>
            Referencias que no existen en este reporte: <strong>{check.unknownRefs.join(", ")}</strong>.
          </p>
        )}
        {check.badOwners.length > 0 && (
          <p>
            Responsables fuera del catálogo: <strong>{check.badOwners.join(", ")}</strong>.
          </p>
        )}
        {check.problems.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </div>
    </div>
  );
}

function Field({ label, htmlFor, hint, warn, children }: { label: string; htmlFor: string; hint?: string; warn?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={htmlFor}>{label}</Label>
        {hint && <span className={cn("text-xs", warn ? "text-negative" : "text-muted-foreground")}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function RemoveButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <Button size="icon-sm" variant="ghost" aria-label={label} onClick={onClick} disabled={disabled}>
      <X aria-hidden />
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Read-only views
// ---------------------------------------------------------------------------

/** A reference as a link to its data: the case, the KPI or the mention in this page. */
export function RefLinks({ refs, facts }: { refs: string[]; facts: ReportFacts }) {
  const byId = new Map((facts.references ?? []).map((r) => [r.id, r]));
  if (!refs.length) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {refs.map((id) => {
        const r = byId.get(id);
        const label = r?.label ?? id;
        const href =
          r?.kind === "caso" && r.target
            ? `/casos/${r.target}`
            : r?.kind === "kpi"
              ? `#kpi-${id.slice(4)}`
              : r?.kind === "mencion"
                ? `#mencion-${id.slice(8)}`
                : r?.kind === "dependencia"
                  ? "#dependencias"
                  : null;
        return href ? (
          <Link key={id} href={href} className="rounded-full border px-2 py-0.5 text-xs underline-offset-2 hover:underline">
            {label}
          </Link>
        ) : (
          <span key={id} className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
            {label}
          </span>
        );
      })}
    </span>
  );
}

function NarrativeReadOnly({ n, facts }: { n: Narrative; facts: ReportFacts }) {
  return (
    <section aria-labelledby="narrativa" className="flex flex-col gap-5 rounded-xl border bg-card p-4 sm:p-6">
      <h2 id="narrativa" className="text-xl font-semibold leading-snug">
        {n.headline}
      </h2>
      <p className="leading-relaxed">{n.executive_summary}</p>
      {SECTIONS.slice(0, 2).map((s) => (
        <StatementsView key={s.key} title={s.title} items={n[s.key]} facts={facts} />
      ))}
      <div className="flex flex-col gap-2">
        <h3 className="font-semibold">Quién debe actuar</h3>
        <ul className="flex flex-col gap-2">
          {n.actions.map((a, i) => (
            <li key={i} className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
              <p>
                <strong>{a.owner}</strong>: {a.action}
              </p>
              <p className="text-xs text-muted-foreground">Plazo: {a.deadline}</p>
              <RefLinks refs={a.refs} facts={facts} />
            </li>
          ))}
        </ul>
      </div>
      <StatementsView title="Qué sigue pendiente" items={n.pending} facts={facts} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <List title="Riesgos" items={n.risks} />
        <List title="Mensajes clave" items={n.messaging} />
      </div>
    </section>
  );
}

function StatementsView({ title, items, facts }: { title: string; items: Statement[]; facts: ReportFacts }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-semibold">{title}</h3>
      {items.length ? (
        <ul className="flex flex-col gap-2">
          {items.map((s, i) => (
            <li key={i} className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
              <p>{s.text}</p>
              <RefLinks refs={s.refs} facts={facts} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nada que señalar.</p>
      )}
    </div>
  );
}

/** A report generated before stage 9: shown as it is; its recipients can still change. */
function LegacyNarrativeView({ reportId, n, facts, recipients: initial, editable }: { reportId: string; n: LegacyNarrative; facts: ReportFacts; recipients: string[]; editable: boolean }) {
  const [recipients, setRecipients] = useState(initial.join(", "));
  const [pending, startTransition] = useTransition();
  const check = useMemo(() => validateNarrative(n, facts), [n, facts]);
  return (
    <section aria-labelledby="narrativa" className="flex flex-col gap-5 rounded-xl border bg-card p-4 sm:p-6">
      {editable && (
        <p role="note" className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          Este borrador usa el formato anterior a los apartados de decisión. Para editarlo con referencias, genera un borrador nuevo del mismo periodo.
        </p>
      )}
      {editable && !check.ok && <CheckPanel check={check} />}
      <h2 id="narrativa" className="text-xl font-semibold leading-snug">
        {n.headline}
      </h2>
      <p className="leading-relaxed">{n.executive_summary}</p>
      <div className="flex flex-col gap-3">
        <h3 className="font-semibold">Hallazgos</h3>
        {n.findings.map((f, i) => (
          <div key={i} className="rounded-lg border p-3">
            <p className="font-medium">
              {i + 1}. {f.title}
            </p>
            <p className="text-sm">{f.evidence}</p>
            <p className="text-sm text-muted-foreground">Impacto: {f.impact}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <List title="Riesgos" items={n.risks} />
        <List title="Oportunidades" items={n.opportunities} />
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="font-semibold">Recomendaciones</h3>
        <ul className="flex flex-col gap-2">
          {n.recommendations.map((r, i) => (
            <li key={i} className="rounded-lg border p-3 text-sm">
              <p>{r.action}</p>
              <p className="text-xs text-muted-foreground">
                {r.owner} · {r.deadline}
              </p>
            </li>
          ))}
        </ul>
      </div>
      <List title="Mensajes clave" items={n.messaging} />
      {editable && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Destinatarios del PDF" htmlFor="n-to" hint="Correos separados por coma.">
            <Input id="n-to" value={recipients} onChange={(e) => setRecipients(e.target.value)} />
          </Field>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await saveReport({ reportId, narrative: n, recipients: splitList(recipients) });
                if (r.ok) toast.success(r.message);
                else toast.error(r.message);
              })
            }
          >
            <Save aria-hidden /> Guardar destinatarios
          </Button>
        </div>
      )}
    </section>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-semibold">{title}</h3>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
