import { KPI_VERSION, type KpiDefinition } from "@/lib/kpi/dictionary";

/** The dictionary entry of a KPI, inside its (i): formula, unit, base, period and edge cases. */
export function KpiDefinitionInfo({ def }: { def: KpiDefinition }) {
  return (
    <dl className="grid gap-1">
      <Item label="Fórmula">{def.formula}</Item>
      <Item label="Unidad">{def.unit}</Item>
      <Item label="Denominador">{def.denominator}</Item>
      <Item label="Periodo">{def.period}</Item>
      <Item label="Reabiertos">{def.reopened}</Item>
      <Item label="Sin dato">{def.missing}</Item>
      <Item label="Origen">
        <code className="text-[11px]">{def.source}</code> · {KPI_VERSION}
      </Item>
    </dl>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="inline font-medium">{label}: </dt>
      <dd className="inline">{children}</dd>
    </div>
  );
}
