"use client";

import { useState, useTransition } from "react";
import { Pause, Pencil, Play, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { OptionSelect } from "@/components/inbox/option-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createDefaultRules, deleteRule, saveRule, setRuleActive, type AlertActionResult } from "@/lib/alerts/actions";
import type { AlertRule } from "@/lib/alerts/data";
import {
  CONDITION_SCHEMAS,
  DEFAULT_COOLDOWN,
  describeRule,
  RULE_KIND_HELP,
  RULE_KIND_LABELS,
  RULE_KINDS,
  SEVERITY_LABELS,
  splitList,
  type RuleKind,
} from "@/lib/alerts/rules";
import { cn } from "@/lib/utils";

type Department = { id: string; name: string };

function useAction() {
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<AlertActionResult>, onOk?: () => void) =>
    startTransition(async () => {
      const r = await action();
      if (r.ok) {
        toast.success(r.message);
        onOk?.();
      } else toast.error(r.message);
    });
  return { pending, run };
}

const cooldownLabel = (m: number) => (m % 1440 === 0 ? `${m / 1440} d` : m % 60 === 0 ? `${m / 60} h` : `${m} min`);

export function RulesPanel({ rules, departments, canEdit }: { rules: AlertRule[]; departments: Department[]; canEdit: boolean }) {
  const { pending, run } = useAction();
  const [editing, setEditing] = useState<AlertRule | "new" | null>(null);
  const departmentName = new Map(departments.map((d) => [d.id, d.name]));

  return (
    <section aria-labelledby="reglas" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="reglas" className="text-lg font-semibold">
          Reglas
        </h2>
        {canEdit && rules.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
            <Plus aria-hidden /> Nueva regla
          </Button>
        )}
      </div>

      {rules.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          <p>Todavía no hay reglas. Empieza con las sugeridas (una de cada tipo) y ajusta los umbrales.</p>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={pending} onClick={() => run(createDefaultRules)}>
                <Sparkles aria-hidden /> Crear reglas sugeridas
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
                <Plus aria-hidden /> Nueva regla
              </Button>
            </div>
          )}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rules.map((rule) => {
            const rated = rule.useful + rule.falseAlarms;
            return (
              <li key={rule.id} className={cn("flex flex-col gap-1.5 rounded-xl border bg-card p-3", !rule.isActive && "opacity-60")}>
                <div className="flex items-start gap-2">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="font-medium">{rule.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {[rule.name !== RULE_KIND_LABELS[rule.kind] && RULE_KIND_LABELS[rule.kind], rule.departmentId && (departmentName.get(rule.departmentId) ?? "Dependencia")]
                        .filter(Boolean)
                        .join(" · ") || "Todo el municipio"}
                      {!rule.isActive && " · en pausa"}
                    </span>
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0 gap-0.5">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={rule.isActive ? `Pausar ${rule.name}` : `Activar ${rule.name}`}
                        disabled={pending}
                        onClick={() => run(() => setRuleActive(rule.id, !rule.isActive))}
                      >
                        {rule.isActive ? <Pause aria-hidden /> : <Play aria-hidden />}
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label={`Editar ${rule.name}`} onClick={() => setEditing(rule)}>
                        <Pencil aria-hidden />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Eliminar ${rule.name}`}
                        disabled={pending}
                        onClick={() => confirm(`¿Eliminar «${rule.name}» y sus alertas?`) && run(() => deleteRule(rule.id))}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{describeRule(rule.kind, rule.condition)}</p>
                <p className="text-xs text-muted-foreground">
                  Enfriamiento {cooldownLabel(rule.cooldownMinutes)} · Correo {rule.channels.email.length} · WhatsApp{" "}
                  {rule.channels.whatsapp.length}
                  {rated > 0 && ` · ${rule.useful} útiles, ${rule.falseAlarms} falsas alarmas`}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <RuleDialog editing={editing} departments={departments} onClose={() => setEditing(null)} />
    </section>
  );
}

function RuleDialog({
  editing,
  departments,
  onClose,
}: {
  editing: AlertRule | "new" | null;
  departments: Department[];
  onClose: () => void;
}) {
  return (
    <Dialog open={editing !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        {editing && <RuleForm key={editing === "new" ? "new" : editing.id} rule={editing === "new" ? null : editing} departments={departments} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

type Field = { key: string; label: string; min: number; max: number; step?: number; help?: string };

const FIELDS: Record<RuleKind, Field[]> = {
  spike: [
    { key: "window_minutes", label: "Ventana (minutos)", min: 10, max: 1440 },
    { key: "baseline_days", label: "Días de referencia", min: 3, max: 60 },
    { key: "k", label: "Desviaciones (k)", min: 1, max: 10, step: 0.5, help: "3 = sólo picos claros; 2 = más sensible." },
    { key: "min_mentions", label: "Mínimo de menciones", min: 1, max: 10000 },
  ],
  sentiment_drop: [
    { key: "window_minutes", label: "Ventana (minutos)", min: 30, max: 1440 },
    { key: "baseline_days", label: "Días de referencia", min: 3, max: 60 },
    { key: "drop_points", label: "Caída de NSS (puntos)", min: 5, max: 200 },
    { key: "min_mentions", label: "Mínimo de menciones", min: 1, max: 10000 },
  ],
  risk_term: [{ key: "window_minutes", label: "Revisar las últimas (minutos)", min: 5, max: 1440 }],
  media_negative: [{ key: "window_minutes", label: "Revisar las últimas (minutos)", min: 5, max: 1440 }],
  daily_digest: [{ key: "hour", label: "Hora de envío (0–23, Ciudad de México)", min: 0, max: 23 }],
};

function RuleForm({ rule, departments, onClose }: { rule: AlertRule | null; departments: Department[]; onClose: () => void }) {
  const { pending, run } = useAction();
  const [kind, setKind] = useState<RuleKind>(rule?.kind ?? "spike");
  const [name, setName] = useState(rule?.name ?? RULE_KIND_LABELS.spike);
  const [condition, setCondition] = useState<Record<string, unknown>>(
    () => (rule ? { ...CONDITION_SCHEMAS[rule.kind].parse({}), ...rule.condition } : CONDITION_SCHEMAS.spike.parse({})) as Record<string, unknown>,
  );
  const [cooldown, setCooldown] = useState(rule?.cooldownMinutes ?? DEFAULT_COOLDOWN.spike);
  const [emails, setEmails] = useState(rule?.channels.email.join("\n") ?? "");
  const [whatsapp, setWhatsapp] = useState(rule?.channels.whatsapp.join("\n") ?? "");
  const [departmentId, setDepartmentId] = useState<string | null>(rule?.departmentId ?? null);

  function changeKind(next: RuleKind) {
    if (!rule && name === RULE_KIND_LABELS[kind]) setName(RULE_KIND_LABELS[next]);
    setKind(next);
    setCondition(CONDITION_SCHEMAS[next].parse({}) as Record<string, unknown>);
    setCooldown(DEFAULT_COOLDOWN[next]);
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            saveRule({
              id: rule?.id ?? null,
              name,
              kind,
              condition,
              channels: { email: splitList(emails), whatsapp: splitList(whatsapp) },
              departmentId,
              cooldownMinutes: cooldown,
              isActive: rule?.isActive ?? true,
            }),
          onClose,
        );
      }}
    >
      <DialogHeader>
        <DialogTitle>{rule ? "Editar regla" : "Nueva regla"}</DialogTitle>
        <DialogDescription>{RULE_KIND_HELP[kind]}</DialogDescription>
      </DialogHeader>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="rule-name">Nombre</Label>
          <Input id="rule-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Tipo</Label>
          <OptionSelect
            label="Tipo de regla"
            size="default"
            value={kind}
            onChange={(v) => v && changeKind(v as RuleKind)}
            options={RULE_KINDS.map((k) => ({ value: k, label: RULE_KIND_LABELS[k] }))}
            className="w-full"
            disabled={Boolean(rule)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Alcance</Label>
          <OptionSelect
            label="Dependencia"
            size="default"
            value={departmentId}
            onChange={setDepartmentId}
            emptyLabel="Todo el municipio"
            options={departments.map((d) => ({ value: d.id, label: d.name }))}
            className="w-full"
          />
        </div>

        {FIELDS[kind].map((f) => (
          <div key={f.key} className="flex flex-col gap-1.5">
            <Label htmlFor={`rule-${f.key}`}>{f.label}</Label>
            <Input
              id={`rule-${f.key}`}
              type="number"
              min={f.min}
              max={f.max}
              step={f.step ?? 1}
              value={String(condition[f.key] ?? "")}
              onChange={(e) => setCondition({ ...condition, [f.key]: e.target.value === "" ? "" : Number(e.target.value) })}
              required
            />
            {f.help && <span className="text-xs text-muted-foreground">{f.help}</span>}
          </div>
        ))}
        {kind === "risk_term" && (
          <div className="flex flex-col gap-1.5">
            <Label>Severidad mínima</Label>
            <OptionSelect
              label="Severidad mínima"
              size="default"
              value={String(condition.min_severity ?? "medium")}
              onChange={(v) => v && setCondition({ ...condition, min_severity: v })}
              options={(["low", "medium", "high", "critical"] as const).map((s) => ({ value: s, label: SEVERITY_LABELS[s] }))}
              className="w-full"
            />
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-cooldown">Enfriamiento (minutos)</Label>
          <Input id="rule-cooldown" type="number" min={5} max={10080} value={cooldown} onChange={(e) => setCooldown(Number(e.target.value))} required />
          <span className="text-xs text-muted-foreground">No repite la misma alerta antes de este tiempo.</span>
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="rule-emails">Avisar por correo</Label>
          <Textarea id="rule-emails" rows={2} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="prensa@municipio.gob.mx, …" />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="rule-whatsapp">Avisar por WhatsApp</Label>
          <Textarea id="rule-whatsapp" rows={2} value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+5212291234567" />
          <span className="text-xs text-muted-foreground">Se enviará cuando el canal de WhatsApp esté configurado.</span>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {rule ? "Guardar cambios" : "Crear regla"}
        </Button>
      </DialogFooter>
    </form>
  );
}
