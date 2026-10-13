/**
 * Measures the classifier against a labeled set using the same cascade as
 * production (CLAUDE_MODEL_FAST, re-pass with CLAUDE_MODEL_SMART).
 *
 *   npm run eval:classify                       # development set (evals/classify/dataset.json)
 *   npm run eval:classify -- --holdout          # validation set (evals/classify/holdout.json)
 *   npm run eval:classify -- --fast             # fast model only, no escalation
 *
 * Prints accuracy per field, precision/recall/F1 per class, results per group
 * (sarcasm, ambiguity, risk, injection), the proposed acceptance thresholds
 * and writes the results plus a CSV for human validation to
 * evals/classify/results/. Needs ANTHROPIC_API_KEY (environment or
 * .env.local). With ANTHROPIC_BASE_URL pointing at the local simulator the
 * run is marked SIMULATED: it checks the harness, not the model.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { classifyBatch, MAX_BATCH, totalUsage, type CallRecord, type ClassifierContext, type MentionInput } from "../src/lib/ai/classifier.ts";
import { accepted, checkThresholds, EVAL_FIELDS, evaluate, humanReviewCsv, type EvalItem, type Prediction } from "../src/lib/evals/classify-metrics.ts";

type Dataset = { context: ClassifierContext; items: (EvalItem & MentionInput)[] };

const holdout = process.argv.includes("--holdout");
const fastOnly = process.argv.includes("--fast");
const DATASET = new URL(`../evals/classify/${holdout ? "holdout" : "dataset"}.json`, import.meta.url);
const RESULTS_DIR = new URL("../evals/classify/results/", import.meta.url);

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const fast = process.env.CLAUDE_MODEL_FAST;
const smart = process.env.CLAUDE_MODEL_SMART;
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Falta ANTHROPIC_API_KEY (variable de entorno o .env.local).");
  process.exit(2);
}
if (!fast || !smart) {
  console.error("Faltan CLAUDE_MODEL_FAST y/o CLAUDE_MODEL_SMART.");
  process.exit(2);
}
const simulated = Boolean(process.env.ANTHROPIC_BASE_URL && /127\.0\.0\.1|localhost/.test(process.env.ANTHROPIC_BASE_URL));

const dataset = JSON.parse(readFileSync(DATASET, "utf8")) as Dataset;
const client = new Anthropic();
const models = { fast, smart: fastOnly ? fast : smart };

const predictions = new Map<string, Prediction>();
const failed: { id: string; error: string }[] = [];
const calls: CallRecord[] = [];
let escalated = 0;
const started = Date.now();

for (let i = 0; i < dataset.items.length; i += MAX_BATCH) {
  const batch = dataset.items.slice(i, i + MAX_BATCH);
  const result = await classifyBatch(client, models, dataset.context, batch);
  result.results.forEach((c, id) => predictions.set(id, c as unknown as Prediction));
  failed.push(...result.failed);
  calls.push(...result.calls);
  escalated += result.escalated;
}

const pct = (v: number | null) => (v === null ? "—" : `${(100 * v).toFixed(1)}%`);
const report = evaluate(dataset.items, predictions);
const thresholds = checkThresholds(report);
const { usage, costUsd } = totalUsage(calls);

console.log(`\nEvaluación del clasificador — ${holdout ? "conjunto de validación (holdout)" : "conjunto de desarrollo"} · ${report.n} menciones`);
if (simulated) console.log("SIMULADO: ANTHROPIC_BASE_URL apunta al simulador local; estos números prueban el arnés, no el modelo.");
console.log(`Modelos: rápido ${fast}${fastOnly ? " (sin escalar)" : `, inteligente ${smart}`} · escaladas ${escalated} · fallidas ${failed.length}`);
console.log("\nPrecisión por campo:");
for (const f of EVAL_FIELDS) console.log(`  ${f.padEnd(13)} ${pct(report.byField[f].accuracy).padStart(6)}  (${report.byField[f].correct}/${report.n})`);
console.log(`  ${"todo exacto".padEnd(13)} ${pct(report.exact).padStart(6)}`);
for (const [field, classes] of Object.entries(report.perClass)) {
  console.log(`\n${field}: precisión / exhaustividad / F1 por clase`);
  for (const c of classes) console.log(`  ${c.label.padEnd(10)} ${pct(c.precision).padStart(6)} / ${pct(c.recall).padStart(6)} / ${pct(c.f1).padStart(6)}  (n=${c.support})`);
}
console.log("\nPor grupo (promedio de campos · todo exacto · sentimiento):");
for (const [tag, g] of Object.entries(report.byTag)) console.log(`  ${tag.padEnd(11)} ${pct(g.fieldAccuracy).padStart(6)} · ${pct(g.exact).padStart(6)} · ${pct(g.byField.sentiment).padStart(6)}  (n=${g.n})`);
if (report.risk.n) console.log(`\nRiesgo: prioridad alta ${report.risk.highPriority}/${report.risk.n}, gravedad alta o emergencia ${report.risk.severeOrWorse}/${report.risk.n}`);
if (report.injection.n) console.log(`Inyección: resistió ${report.injection.resisted}/${report.injection.n}${report.injection.broken.length ? ` (cedió: ${report.injection.broken.join(", ")})` : ""}`);
console.log("\nUmbrales propuestos (C = crítico):");
for (const t of thresholds) console.log(`  ${t.pass ? "✓" : "✗"} ${t.critical ? "C" : " "} ${t.label.padEnd(52)} ${pct(t.value).padStart(6)}  (mín. ${pct(t.min)})`);
console.log(`\nDictamen: ${simulated ? "no aplica (simulado)" : accepted(thresholds) ? "cumple los umbrales críticos" : "NO cumple los umbrales críticos"}`);
console.log(`Tokens: entrada ${usage.inputTokens}, salida ${usage.outputTokens}, caché leída ${usage.cacheReadTokens}, caché escrita ${usage.cacheWriteTokens}`);
console.log(`Costo estimado: US$${costUsd.toFixed(4)} en ${calls.length} llamadas · ${((Date.now() - started) / 1000).toFixed(1)} s`);
for (const f of failed) console.log(`  falló ${f.id}: ${f.error}`);

mkdirSync(RESULTS_DIR, { recursive: true });
const stamp = `${new Date().toISOString().replace(/[:.]/g, "-")}${holdout ? "-holdout" : ""}${simulated ? "-simulado" : ""}`;
const out = new URL(`${stamp}.json`, RESULTS_DIR);
writeFileSync(
  out,
  JSON.stringify(
    {
      dataset: holdout ? "holdout" : "dataset",
      simulated,
      models,
      report,
      thresholds,
      accepted: simulated ? null : accepted(thresholds),
      escalated,
      failed,
      usage,
      costUsd,
      predictions: dataset.items.map((i) => ({ id: i.id, expected: i.expected, got: predictions.get(i.id) ?? null })),
    },
    null,
    2,
  ),
);
const sheet = new URL(`${stamp}-revision-humana.csv`, RESULTS_DIR);
writeFileSync(sheet, humanReviewCsv(dataset.items, predictions));
console.log(`\nResultados: ${out.pathname}\nHoja de validación humana: ${sheet.pathname}`);
