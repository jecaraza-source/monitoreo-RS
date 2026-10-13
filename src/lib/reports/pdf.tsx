import "server-only";
import { Document, Font, Image, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import { isStructured, type AnyNarrative, type Kpi, type ReportFacts } from "@/lib/ai/narrative";
import { FAMILY_LABELS, KPI_BY_KEY } from "@/lib/kpi/dictionary";
import type { Logo } from "@/lib/branding/logo";

/** Cover colors and, optionally, the client's logo (Configuración → Identidad). */
export type PdfBrand = { primary: string; accent: string; logo?: Logo | null };

// Spanish words must not be split with English hyphenation rules.
Font.registerHyphenationCallback((word) => [word]);

// The built-in Helvetica covers Latin-1 (accents, ñ, ¿¡) but not every
// Unicode sign; replace the ones the narrative tends to use.
const clean = (s: string | null | undefined) =>
  (s ?? "")
    .replace(/[−–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, "...")
    .replace(/[^\u0009\u000A\u000D -ÿ€•]/g, "");

const nf = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });
const fmt = (v: number | null | undefined, suffix = "") => (v == null ? "s/d" : `${nf.format(v)}${suffix}`);
const signed = (v: number | null, unit: string) => (v == null ? "" : `${v > 0 ? "+" : ""}${nf.format(v)}${unit === "%" ? "%" : " pts"}`);

const POSITIVE = "#16a34a";
const NEUTRAL = "#94a3b8";
const NEGATIVE = "#dc2626";
const INK = "#0f172a";
const MUTED = "#64748b";

const s = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 56, paddingHorizontal: 44, fontFamily: "Helvetica", fontSize: 10, color: INK },
  // Body leading lives here, not on the Page: react-pdf drops a fixed render-prop Text
  // (the page number) that inherits a line height, and the footer with it.
  body: { fontSize: 10, lineHeight: 1.45 },
  cover: { padding: 0, fontFamily: "Helvetica" },
  h1: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 10 },
  h2: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 14, marginBottom: 6 },
  p: { marginBottom: 6 },
  muted: { color: MUTED, fontSize: 9 },
  row: { flexDirection: "row" },
  kpi: { width: "31.5%", marginRight: "2.75%", marginBottom: 8, padding: 8, borderRadius: 4, borderWidth: 1, borderColor: "#e2e8f0" },
  kpiValue: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  card: { padding: 8, borderRadius: 4, borderWidth: 1, borderColor: "#e2e8f0", marginBottom: 6 },
  bullet: { flexDirection: "row", marginBottom: 4 },
  table: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 4, marginBottom: 8 },
  th: { flexDirection: "row", backgroundColor: "#f1f5f9", paddingVertical: 4, paddingHorizontal: 6, fontFamily: "Helvetica-Bold", fontSize: 9 },
  tr: { flexDirection: "row", paddingVertical: 4, paddingHorizontal: 6, borderTopWidth: 1, borderTopColor: "#e2e8f0", fontSize: 9 },
  footer: { position: "absolute", bottom: 24, left: 44, right: 44, flexDirection: "row", justifyContent: "space-between", alignItems: "center", fontSize: 8, color: MUTED },
});

function Footer({ facts, logo }: { facts: ReportFacts; logo?: Logo | null }) {
  return (
    <View style={s.footer} fixed>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's Image has no alt; the footer names the municipality */}
        {logo && <Image src={logo} style={{ height: 14, maxWidth: 70, objectFit: "contain", marginRight: 6 }} />}
        <Text>
          {clean(facts.municipality)} · {clean(facts.period.label)}
        </Text>
      </View>
      <Text render={({ pageNumber, totalPages }) => `Sigma Pulso · ${pageNumber} / ${totalPages}`} />
    </View>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <View>
      {items.map((item, i) => (
        <View key={i} style={s.bullet} wrap={false}>
          <Text style={{ width: 12 }}>•</Text>
          <Text style={{ flex: 1 }}>{clean(item)}</Text>
        </View>
      ))}
    </View>
  );
}

/** Stacked daily (or hourly) volume by sentiment. */
function VolumeChart({ series, accent, hourly }: { series: ReportFacts["series"]; accent: string; hourly: boolean }) {
  const max = Math.max(1, ...series.map((p) => p.positive + p.neutral + p.negative));
  const height = 90;
  const step = series.length > 31 ? Math.ceil(series.length / 12) : series.length > 14 ? 3 : 1;
  return (
    <View>
      <View style={{ flexDirection: "row", alignItems: "flex-end", height, borderBottomWidth: 1, borderBottomColor: "#cbd5e1" }}>
        {series.map((p, i) => (
          <View key={i} style={{ flex: 1, marginHorizontal: 1, justifyContent: "flex-end", height }}>
            <View style={{ height: (p.negative / max) * height, backgroundColor: NEGATIVE }} />
            <View style={{ height: (p.neutral / max) * height, backgroundColor: NEUTRAL }} />
            <View style={{ height: (p.positive / max) * height, backgroundColor: POSITIVE }} />
          </View>
        ))}
      </View>
      <View style={{ flexDirection: "row" }}>
        {series.map((p, i) => (
          <Text key={i} style={{ flex: 1, fontSize: 6, color: MUTED, textAlign: "center" }}>
            {i % step === 0 ? bucketLabel(p.bucket, hourly) : ""}
          </Text>
        ))}
      </View>
      <View style={{ flexDirection: "row", marginTop: 4, gap: 10 }}>
        {[
          ["Positivas", POSITIVE],
          ["Neutrales", NEUTRAL],
          ["Negativas", NEGATIVE],
        ].map(([label, color]) => (
          <View key={label} style={{ flexDirection: "row", alignItems: "center" }}>
            <View style={{ width: 7, height: 7, backgroundColor: color, marginRight: 3 }} />
            <Text style={s.muted}>{label}</Text>
          </View>
        ))}
        <Text style={[s.muted, { marginLeft: "auto", color: accent }]}>Volumen de menciones</Text>
      </View>
    </View>
  );
}

const dayFmt = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "America/Mexico_City" });
const hourFmt = new Intl.DateTimeFormat("es-MX", { hour: "2-digit", timeZone: "America/Mexico_City" });
function bucketLabel(bucket: string, hourly: boolean): string {
  const d = new Date(bucket);
  return clean(hourly ? `${hourFmt.format(d)} h` : dayFmt.format(d));
}

/** Horizontal bars: share of a value, colored by sentiment balance. */
function Bars({ rows }: { rows: { label: string; value: number; display: string; color: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <View>
      {rows.map((r, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", marginBottom: 3 }} wrap={false}>
          <Text style={{ width: 150, fontSize: 9 }}>{clean(r.label)}</Text>
          <View style={{ flex: 1, height: 9, backgroundColor: "#f1f5f9" }}>
            <View style={{ width: `${(Math.abs(r.value) / max) * 100}%`, height: 9, backgroundColor: r.color }} />
          </View>
          <Text style={{ width: 48, fontSize: 9, textAlign: "right" }}>{r.display}</Text>
        </View>
      ))}
    </View>
  );
}

const nssColor = (v: number) => (v >= 5 ? POSITIVE : v <= -5 ? NEGATIVE : NEUTRAL);

const UNIT_SUFFIX: Record<string, string> = { "%": "%", horas: " h" };

function KpiGrid({ kpis, color }: { kpis: Kpi[]; color: string }) {
  return (
    <View style={[s.row, { flexWrap: "wrap" }]}>
      {kpis.map((k, i) => (
        <View key={k.key} style={[s.kpi, i % 3 === 2 ? { marginRight: 0 } : {}]} wrap={false}>
          <Text style={s.muted}>{clean(k.label)}</Text>
          <Text style={[s.kpiValue, { color }]}>{fmt(k.value, UNIT_SUFFIX[k.unit ?? ""] ?? "")}</Text>
          <Text style={s.muted}>{k.change == null ? "Sin comparación" : `${signed(k.change, k.change_unit)} vs. anterior (${fmt(k.previous)})`}</Text>
          {k.unit === "horas" && <Text style={s.muted}>n = {k.n ?? 0}{k.detail ? ` · ${clean(k.detail)}` : ""}</Text>}
        </View>
      ))}
    </View>
  );
}

/** "Datos: Casos vencidos al corte · Caso C-0012": what a statement rests on. */
function RefLine({ refs, facts }: { refs: string[]; facts: ReportFacts }) {
  const labels = new Map((facts.references ?? []).map((r) => [r.id, r.label]));
  if (!refs.length) return null;
  return <Text style={s.muted}>Datos: {clean(refs.map((r) => labels.get(r) ?? r).join(" · "))}</Text>;
}

function Statements({ title, items, facts, color }: { title: string; items: { text: string; refs: string[] }[]; facts: ReportFacts; color: string }) {
  return (
    <View>
      <Text style={[s.h2, { color }]}>{title}</Text>
      {items.length ? (
        items.map((x, i) => (
          <View key={i} style={s.card} wrap={false}>
            <Text style={s.p}>{clean(x.text)}</Text>
            <RefLine refs={x.refs} facts={facts} />
          </View>
        ))
      ) : (
        <Text style={s.muted}>Nada que señalar.</Text>
      )}
    </View>
  );
}

function ReportDocument({ facts, narrative, brand, title }: { facts: ReportFacts; narrative: AnyNarrative; brand: PdfBrand; title: string }) {
  const structured = isStructured(narrative) ? narrative : null;
  const legacy = isStructured(narrative) ? null : narrative;
  const kind = { daily: "Reporte diario", weekly: "Reporte semanal", monthly: "Reporte mensual" }[facts.period.kind];
  return (
    <Document title={clean(title)} author="Sigma Pulso" subject={clean(`${kind} de escucha social`)} language="es-MX">
      {/* Cover in the municipality's colors */}
      <Page size="LETTER" style={s.cover}>
        <View style={{ flex: 1, backgroundColor: brand.primary, padding: 56, justifyContent: "space-between" }}>
          <View>
            {/* The logo sits on white so it reads on any cover color. */}
            {brand.logo && (
              <View style={{ alignSelf: "flex-start", backgroundColor: "#ffffff", borderRadius: 6, padding: 10, marginBottom: 22 }}>
                {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's Image has no alt */}
                <Image src={brand.logo} style={{ height: 52, maxWidth: 220, objectFit: "contain" }} />
              </View>
            )}
            <View style={{ width: 56, height: 6, backgroundColor: brand.accent, marginBottom: 18 }} />
            <Text style={{ color: "#ffffff", fontSize: 13, opacity: 0.85 }}>
              {clean(facts.municipality)}
              {facts.state ? `, ${clean(facts.state)}` : ""}
            </Text>
          </View>
          <View>
            <Text style={{ color: brand.accent, fontSize: 12, fontFamily: "Helvetica-Bold", marginBottom: 8 }}>{clean(kind.toUpperCase())}</Text>
            <Text style={{ color: "#ffffff", fontSize: 30, fontFamily: "Helvetica-Bold", marginBottom: 10, lineHeight: 1.2 }}>
              Escucha social y atención ciudadana
            </Text>
            <Text style={{ color: "#ffffff", fontSize: 14, opacity: 0.9 }}>{clean(facts.period.label)}</Text>
            <View style={{ marginTop: 28, padding: 14, backgroundColor: "#ffffff", borderRadius: 4 }}>
              <Text style={{ color: brand.primary, fontSize: 13, fontFamily: "Helvetica-Bold", lineHeight: 1.35 }}>{clean(narrative.headline)}</Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: "#ffffff", fontSize: 9, opacity: 0.75 }}>Documento de uso interno · Sigma Pulso</Text>
            <View style={{ width: 120, height: 4, backgroundColor: brand.accent }} />
          </View>
        </View>
      </Page>

      <Page size="LETTER" style={s.page}>
        <View style={s.body}>
          <Text style={[s.h1, { color: brand.primary }]}>Resumen ejecutivo</Text>
          <Text style={s.p}>{clean(narrative.executive_summary)}</Text>

          <Text style={s.h2}>Indicadores del periodo</Text>
          <Text style={[s.muted, { marginBottom: 6 }]}>
            Comparación contra {clean(facts.period.previous_label)}
            {facts.period.cut ? `, al corte del ${clean(facts.period.cut)}` : ""}. Menciones y casos son unidades distintas.
          </Text>
          {facts.facts_version === 2 ? (
            (["conversacion", "atencion"] as const).map((family) => (
              <View key={family}>
                <Text style={[s.muted, { fontFamily: "Helvetica-Bold", marginBottom: 4 }]}>{FAMILY_LABELS[family]}</Text>
                <KpiGrid kpis={facts.kpis.filter((k) => k.family === family)} color={brand.primary} />
              </View>
            ))
          ) : (
            <KpiGrid kpis={facts.kpis} color={brand.primary} />
          )}

          <Text style={s.h2}>Volumen y tono</Text>
          <VolumeChart series={facts.series} accent={brand.primary} hourly={facts.period.kind === "daily"} />
          <Text style={[s.muted, { marginTop: 4 }]}>
            Positivas {fmt(facts.sentiment.positive_pct, "%")} · Neutrales {fmt(facts.sentiment.neutral_pct, "%")} · Negativas{" "}
            {fmt(facts.sentiment.negative_pct, "%")} · NSS {fmt(facts.sentiment.nss)}
          </Text>
        </View>
        <Footer facts={facts} logo={brand.logo} />
      </Page>

      <Page size="LETTER" style={s.page}>
        <View style={s.body}>
          {structured ? (
            <>
              <Text style={[s.h1, { color: brand.primary }]}>Qué cambió y qué requiere decisión</Text>
              <Statements title="Qué cambió" items={structured.what_changed} facts={facts} color={brand.primary} />
              <Statements title="Qué requiere decisión" items={structured.decisions} facts={facts} color={brand.primary} />
            </>
          ) : (
            <>
              <Text style={[s.h1, { color: brand.primary }]}>Hallazgos</Text>
              {legacy!.findings.map((f, i) => (
                <View key={i} style={s.card} wrap={false}>
                  <Text style={{ fontFamily: "Helvetica-Bold", marginBottom: 3 }}>
                    {i + 1}. {clean(f.title)}
                  </Text>
                  <Text style={s.p}>{clean(f.evidence)}</Text>
                  <Text style={s.muted}>Impacto: {clean(f.impact)}</Text>
                </View>
              ))}
            </>
          )}

          <Text style={s.h2}>Temas principales</Text>
          <Bars
            rows={facts.top_topics.map((t) => ({
              label: t.topic,
              value: t.mentions,
              display: `${nf.format(t.mentions)}`,
              color: nssColor(t.nss),
            }))}
          />
          <Text style={s.muted}>Color según sentimiento neto del tema (verde positivo, gris neutral, rojo negativo).</Text>

          <Text style={s.h2}>Dependencias por sentimiento neto (NSS)</Text>
          {facts.facts_version === 2 && <Text style={s.muted}>Sólo dependencias con volumen suficiente para comparar su tono.</Text>}
          <Bars
            rows={facts.departments_by_nss.map((d) => ({
              label: d.department,
              value: d.nss,
              display: fmt(d.nss),
              color: nssColor(d.nss),
            }))}
          />
        </View>
        <Footer facts={facts} logo={brand.logo} />
      </Page>

      <Page size="LETTER" style={s.page}>
        <View style={s.body}>
          <Text style={[s.h1, { color: brand.primary }]}>Territorio y atención</Text>
          <Text style={s.h2}>Colonias con más quejas</Text>
          <View style={s.table}>
            <View style={s.th}>
              <Text style={{ flex: 2 }}>Colonia</Text>
              <Text style={{ flex: 1, textAlign: "right" }}>Quejas</Text>
              <Text style={{ flex: 2, paddingLeft: 8 }}>Tema principal</Text>
            </View>
            {facts.neighborhoods_most_complaints.map((h, i) => (
              <View key={i} style={s.tr} wrap={false}>
                <Text style={{ flex: 2 }}>{clean(h.neighborhood)}</Text>
                <Text style={{ flex: 1, textAlign: "right" }}>{nf.format(h.complaints)}</Text>
                <Text style={{ flex: 2, paddingLeft: 8 }}>{clean(h.top_topic ?? "")}</Text>
              </View>
            ))}
          </View>

          {facts.departments ? (
            <>
              <Text style={s.h2}>Casos por dependencia</Text>
              <Text style={s.muted}>Desglose en orden alfabético, no un ranking. Resolución: mediana · p90 · n de ciclos cerrados.</Text>
              <View style={s.table}>
                <View style={s.th}>
                  <Text style={{ flex: 3 }}>Dependencia</Text>
                  <Text style={{ flex: 1, textAlign: "right" }}>Nuevos</Text>
                  <Text style={{ flex: 1, textAlign: "right" }}>Abiertos</Text>
                  <Text style={{ flex: 1, textAlign: "right" }}>Vencidos</Text>
                  <Text style={{ flex: 1, textAlign: "right" }}>Cierres</Text>
                  <Text style={{ flex: 2, textAlign: "right" }}>Resolución</Text>
                  <Text style={{ flex: 2, paddingLeft: 6 }}>Nota</Text>
                </View>
                {facts.departments.map((d, i) => (
                  <View key={i} style={s.tr} wrap={false}>
                    <Text style={{ flex: 3 }}>{clean(d.department)}</Text>
                    <Text style={{ flex: 1, textAlign: "right" }}>{nf.format(d.opened)}</Text>
                    <Text style={{ flex: 1, textAlign: "right" }}>{nf.format(d.open_at_cut)}</Text>
                    <Text style={{ flex: 1, textAlign: "right" }}>{nf.format(d.overdue_at_cut)}</Text>
                    <Text style={{ flex: 1, textAlign: "right" }}>{nf.format(d.validated_closures)}</Text>
                    <Text style={{ flex: 2, textAlign: "right" }}>
                      {d.resolution_n ? `${fmt(d.resolution_median_h, " h")} · ${fmt(d.resolution_p90_h, " h")} · ${d.resolution_n}` : "-"}
                    </Text>
                    <Text style={{ flex: 2, paddingLeft: 6 }}>{[d.low_volume ? "volumen bajo" : "", d.new_in_catalog ? "nueva" : ""].filter(Boolean).join(", ")}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : facts.attention ? (
            <>
              <Text style={s.h2}>Tiempos de atención por dependencia</Text>
              <View style={s.table}>
                <View style={s.th}>
                  <Text style={{ flex: 3 }}>Dependencia</Text>
                  <Text style={{ flex: 1, textAlign: "right" }}>Turnadas</Text>
                  <Text style={{ flex: 1, textAlign: "right" }}>Resueltas</Text>
                  <Text style={{ flex: 1, textAlign: "right" }}>Vencidas</Text>
                  <Text style={{ flex: 1, textAlign: "right" }}>Horas</Text>
                </View>
                {facts.attention.by_department.map((d, i) => (
                  <View key={i} style={s.tr} wrap={false}>
                    <Text style={{ flex: 3 }}>{clean(d.department)}</Text>
                    <Text style={{ flex: 1, textAlign: "right" }}>{nf.format(d.routed)}</Text>
                    <Text style={{ flex: 1, textAlign: "right" }}>{nf.format(d.resolved)}</Text>
                    <Text style={{ flex: 1, textAlign: "right" }}>{nf.format(d.overdue)}</Text>
                    <Text style={{ flex: 1, textAlign: "right" }}>{fmt(d.avg_hours)}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          {facts.pending_cases && facts.pending_cases.length > 0 && (
            <>
              <Text style={s.h2}>Casos vencidos al corte</Text>
              {facts.pending_cases.map((c) => (
                <Text key={c.ref} style={{ fontSize: 9, marginBottom: 2 }}>
                  {clean(`${c.folio} · ${c.category ?? "Sin categoría"} · ${c.department ?? "Sin asignar"}${c.overdue_hours != null ? ` · ${nf.format(c.overdue_hours)} h de atraso` : ""}`)}
                </Text>
              ))}
            </>
          )}

          {facts.peaks.length > 0 && <Text style={s.h2}>Picos de conversación</Text>}
          {facts.peaks.map((p, i) => (
            <View key={i} style={s.card} wrap={false}>
              <Text style={{ fontFamily: "Helvetica-Bold" }}>
                {clean(p.when)}: {nf.format(p.mentions)} menciones ({nf.format(p.times_typical)} veces lo habitual)
              </Text>
              <Text style={s.muted}>{clean(p.top_topics.map((t) => `${t.topic} (${t.mentions})`).join(" · "))}</Text>
            </View>
          ))}

          <Text style={s.h2}>Alertas</Text>
          <Text style={s.p}>
            {nf.format(facts.alerts.total)} alertas en el periodo: {nf.format(facts.alerts.critical)} críticas, {nf.format(facts.alerts.high)} altas,{" "}
            {nf.format(facts.alerts.medium)} medias. Calificadas como útiles: {nf.format(facts.alerts.useful)}; falsas alarmas:{" "}
            {nf.format(facts.alerts.false_alarms)}.
          </Text>
        </View>
        <Footer facts={facts} logo={brand.logo} />
      </Page>

      <Page size="LETTER" style={s.page}>
        <View style={s.body}>
          {structured ? (
            <>
              <Text style={[s.h1, { color: brand.primary }]}>Quién debe actuar y qué sigue pendiente</Text>
              <View style={s.table}>
                <View style={s.th}>
                  <Text style={{ flex: 2 }}>Responsable</Text>
                  <Text style={{ flex: 4, paddingLeft: 6 }}>Acción</Text>
                  <Text style={{ flex: 1, paddingLeft: 6 }}>Plazo</Text>
                </View>
                {structured.actions.map((a, i) => (
                  <View key={i} style={s.tr} wrap={false}>
                    <Text style={{ flex: 2 }}>{clean(a.owner)}</Text>
                    <View style={{ flex: 4, paddingLeft: 6 }}>
                      <Text>{clean(a.action)}</Text>
                      <RefLine refs={a.refs} facts={facts} />
                    </View>
                    <Text style={{ flex: 1, paddingLeft: 6 }}>{clean(a.deadline)}</Text>
                  </View>
                ))}
              </View>
              <Statements title="Qué sigue pendiente" items={structured.pending} facts={facts} color={brand.primary} />
              <Text style={s.h2}>Riesgos</Text>
              <Bullets items={structured.risks} />
              <Text style={s.h2}>Mensajes clave para comunicación social</Text>
              <Bullets items={structured.messaging} />
            </>
          ) : (
            <>
              <Text style={[s.h1, { color: brand.primary }]}>Riesgos y oportunidades</Text>
              <Text style={s.h2}>Riesgos</Text>
              <Bullets items={legacy!.risks} />
              <Text style={s.h2}>Oportunidades</Text>
              <Bullets items={legacy!.opportunities} />

              <Text style={s.h2}>Recomendaciones</Text>
              <View style={s.table}>
                <View style={s.th}>
                  <Text style={{ flex: 4 }}>Acción</Text>
                  <Text style={{ flex: 2, paddingLeft: 6 }}>Responsable sugerido</Text>
                  <Text style={{ flex: 1, paddingLeft: 6 }}>Plazo</Text>
                </View>
                {legacy!.recommendations.map((r, i) => (
                  <View key={i} style={s.tr} wrap={false}>
                    <Text style={{ flex: 4 }}>{clean(r.action)}</Text>
                    <Text style={{ flex: 2, paddingLeft: 6 }}>{clean(r.owner)}</Text>
                    <Text style={{ flex: 1, paddingLeft: 6 }}>{clean(r.deadline)}</Text>
                  </View>
                ))}
              </View>

              <Text style={s.h2}>Mensajes clave para comunicación social</Text>
              <Bullets items={legacy!.messaging} />
            </>
          )}

          <Text style={[s.muted, { marginTop: 18 }]}>
            Cifras calculadas por Sigma Pulso con menciones públicas del periodo. La narrativa fue redactada con apoyo de IA a partir de esas cifras y
            revisada antes de su aprobación.
          </Text>
        </View>
        <Footer facts={facts} logo={brand.logo} />
      </Page>

      {facts.facts_version === 2 && (
        <Page size="LETTER" style={s.page}>
          <View style={s.body}>
            <Text style={[s.h1, { color: brand.primary }]}>Cobertura y definiciones</Text>
            {facts.coverage && (
              <>
                <Text style={s.p}>
                  {clean(
                    `Sin clasificar: ${nf.format(facts.coverage.unclassified)} de ${nf.format(facts.coverage.mentions)} menciones. Clasificadas sin colonia: ${nf.format(facts.coverage.without_neighborhood)}. Casos nuevos sin categoría: ${nf.format(facts.coverage.cases_without_category)}; sin ubicación: ${nf.format(facts.coverage.cases_without_location)}.`,
                  )}
                </Text>
                <Bullets items={[...(facts.coverage.sources_partial.length ? [`Fuentes con lectura parcial: ${facts.coverage.sources_partial.join(", ")}.`] : []), ...facts.coverage.notes]} />
              </>
            )}
            <Text style={s.h2}>Definiciones ({clean(facts.kpi_version ?? "")})</Text>
            {facts.kpis.map((k) => {
              const d = KPI_BY_KEY[k.key];
              return d ? (
                <View key={k.key} style={{ marginBottom: 5 }} wrap={false}>
                  <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 9 }}>
                    {clean(d.label)} ({clean(d.unit)})
                  </Text>
                  <Text style={s.muted}>{clean(`${d.formula} Denominador: ${d.denominator} Periodo: ${d.period} Reabiertos: ${d.reopened} Sin dato: ${d.missing}`)}</Text>
                </View>
              ) : null;
            })}
            <Text style={[s.muted, { marginTop: 8 }]}>
              {clean(`Cifras de un mismo corte de la base de datos${facts.as_of ? ` (${new Date(facts.as_of).toLocaleString("es-MX", { timeZone: "America/Mexico_City" })})` : ""}. Un reporte aprobado conserva estas cifras aunque los datos cambien después.`)}
            </Text>
          </View>
          <Footer facts={facts} logo={brand.logo} />
        </Page>
      )}
    </Document>
  );
}

export async function renderReportPdf(input: { facts: ReportFacts; narrative: AnyNarrative; brand: PdfBrand; title: string }): Promise<Buffer> {
  return renderToBuffer(<ReportDocument {...input} />);
}
