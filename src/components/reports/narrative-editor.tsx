"use client";

import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, Plus, Save, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SUMMARY_MAX_WORDS, validateNarrative, wordCount, type Narrative, type ReportFacts } from "@/lib/ai/narrative";
import { splitList } from "@/lib/alerts/rules";
import { saveReport } from "@/lib/reports/actions";
import { cn } from "@/lib/utils";

const lines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

export function NarrativeEditor({
  reportId,
  narrative: initial,
  facts,
  recipients: initialRecipients,
  editable,
}: {
  reportId: string;
  narrative: Narrative;
  facts: ReportFacts;
  recipients: string[];
  editable: boolean;
}) {
  const [n, setN] = useState<Narrative>(initial);
  const [recipients, setRecipients] = useState(initialRecipients.join(", "));
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();
  const check = useMemo(() => validateNarrative(n, facts), [n, facts]);

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

  if (!editable) return <NarrativeReadOnly n={n} />;

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

      {!check.ok && (
        <div role="status" className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
          <div>
            {check.unknownNumbers.length > 0 && (
              <p>
                Estas cifras no aparecen en los datos del periodo: <strong>{check.unknownNumbers.join(", ")}</strong>. Verifícalas antes de aprobar.
              </p>
            )}
            {check.problems.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
        </div>
      )}

      <Field label="Titular" htmlFor="n-headline">
        <Input id="n-headline" value={n.headline} onChange={(e) => update({ headline: e.target.value })} />
      </Field>

      <Field label="Resumen ejecutivo" htmlFor="n-summary" hint={`${words} / ${SUMMARY_MAX_WORDS} palabras`} warn={words > SUMMARY_MAX_WORDS}>
        <Textarea id="n-summary" rows={5} value={n.executive_summary} onChange={(e) => update({ executive_summary: e.target.value })} />
      </Field>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium">Hallazgos</legend>
        {n.findings.map((f, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <Input
                aria-label={`Título del hallazgo ${i + 1}`}
                value={f.title}
                onChange={(e) => update({ findings: n.findings.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })}
              />
              <RemoveButton label={`Quitar hallazgo ${i + 1}`} disabled={n.findings.length <= 1} onClick={() => update({ findings: n.findings.filter((_, j) => j !== i) })} />
            </div>
            <Textarea
              aria-label={`Evidencia del hallazgo ${i + 1}`}
              rows={2}
              value={f.evidence}
              onChange={(e) => update({ findings: n.findings.map((x, j) => (j === i ? { ...x, evidence: e.target.value } : x)) })}
            />
            <Textarea
              aria-label={`Impacto del hallazgo ${i + 1}`}
              rows={2}
              value={f.impact}
              onChange={(e) => update({ findings: n.findings.map((x, j) => (j === i ? { ...x, impact: e.target.value } : x)) })}
            />
          </div>
        ))}
        {n.findings.length < 8 && (
          <Button size="sm" variant="outline" className="self-start" onClick={() => update({ findings: [...n.findings, { title: "", evidence: "", impact: "" }] })}>
            <Plus aria-hidden /> Hallazgo
          </Button>
        )}
      </fieldset>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Riesgos (uno por línea)" htmlFor="n-risks">
          <Textarea id="n-risks" rows={5} defaultValue={n.risks.join("\n")} onChange={(e) => update({ risks: lines(e.target.value) })} />
        </Field>
        <Field label="Oportunidades (una por línea)" htmlFor="n-opps">
          <Textarea id="n-opps" rows={5} defaultValue={n.opportunities.join("\n")} onChange={(e) => update({ opportunities: lines(e.target.value) })} />
        </Field>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Recomendaciones</legend>
        {n.recommendations.map((r, i) => (
          <div key={i} className="grid grid-cols-1 gap-2 rounded-lg border p-3 md:grid-cols-[minmax(0,3fr)_minmax(0,1.5fr)_minmax(0,1fr)_auto]">
            <Textarea
              aria-label={`Acción ${i + 1}`}
              rows={2}
              value={r.action}
              onChange={(e) => update({ recommendations: n.recommendations.map((x, j) => (j === i ? { ...x, action: e.target.value } : x)) })}
            />
            <Input
              aria-label={`Responsable sugerido ${i + 1}`}
              value={r.owner}
              onChange={(e) => update({ recommendations: n.recommendations.map((x, j) => (j === i ? { ...x, owner: e.target.value } : x)) })}
            />
            <Input
              aria-label={`Plazo ${i + 1}`}
              value={r.deadline}
              onChange={(e) => update({ recommendations: n.recommendations.map((x, j) => (j === i ? { ...x, deadline: e.target.value } : x)) })}
            />
            <RemoveButton
              label={`Quitar recomendación ${i + 1}`}
              disabled={n.recommendations.length <= 1}
              onClick={() => update({ recommendations: n.recommendations.filter((_, j) => j !== i) })}
            />
          </div>
        ))}
        {n.recommendations.length < 8 && (
          <Button
            size="sm"
            variant="outline"
            className="self-start"
            onClick={() => update({ recommendations: [...n.recommendations, { action: "", owner: "", deadline: "" }] })}
          >
            <Plus aria-hidden /> Recomendación
          </Button>
        )}
      </fieldset>

      <Field label="Mensajes clave para comunicación social (uno por línea)" htmlFor="n-msg">
        <Textarea id="n-msg" rows={4} defaultValue={n.messaging.join("\n")} onChange={(e) => update({ messaging: lines(e.target.value) })} />
      </Field>

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

function NarrativeReadOnly({ n }: { n: Narrative }) {
  return (
    <section aria-labelledby="narrativa" className="flex flex-col gap-5 rounded-xl border bg-card p-4 sm:p-6">
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
