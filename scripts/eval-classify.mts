/**
 * Measures classifier accuracy against evals/classify/dataset.json using the
 * same cascade as production (CLAUDE_MODEL_FAST, re-pass with CLAUDE_MODEL_SMART).
 *
 *   npm run eval:classify            # whole set
 *   npm run eval:classify -- --fast  # fast model only, no escalation
 *
 * Needs ANTHROPIC_API_KEY (read from the environment or .env.local).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import {
  classifyBatch,
  MAX_BATCH,
  totalUsage,
  type CallRecord,
  type Classification,
  type ClassifierContext,
  type MentionInput,
} from "../src/lib/ai/classifier.ts";

type Expected = Pick<Classification, "sentiment" | "intent" | "priority" | "topic" | "department" | "neighborhood">;
type Item = MentionInput & { expected: Expected; note: string };
type Dataset = { context: ClassifierContext; items: Item[] };

const FIELDS = ["sentiment", "intent", "priority", "topic", "department", "neighborhood"] as const;
type Field = (typeof FIELDS)[number];

const DATASET = new URL("../evals/classify/dataset.json", import.meta.url);
const RESULTS_DIR = new URL("../evals/classify/results/", import.meta.url);

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const fastOnly = process.argv.includes("--fast");
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

const dataset = JSON.parse(readFileSync(DATASET, "utf8")) as Dataset;
const client = new Anthropic();
const models = { fast, smart: fastOnly ? fast : smart };

const predictions = new Map<string, Classification & { model: string }>();
const failed: { id: string; error: string }[] = [];
const calls: CallRecord[] = [];
let escalated = 0;
const started = Date.now();

for (let i = 0; i < dataset.items.length; i += MAX_BATCH) {
  const batch = dataset.items.slice(i, i + MAX_BATCH);
  const result = await classifyBatch(client, models, dataset.context, batch);
  result.results.forEach((c, id) => predictions.set(id, c));
  failed.push(...result.failed);
  calls.push(...result.calls);
  escalated += result.escalated;
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "—");
const show = (v: string | null) => v ?? "null";

// Accuracy per field over the whole set (a failed mention counts as wrong).
const total = dataset.items.length;
const correct = Object.fromEntries(FIELDS.map((f) => [f, 0])) as Record<Field, number>;
const errors: string[] = [];
for (const item of dataset.items) {
  const p = predictions.get(item.id);
  const wrong: string[] = [];
  for (const f of FIELDS) {
    if (p && p[f] === item.expected[f]) correct[f]++;
    else wrong.push(`${f}: esperado ${show(item.expected[f])}, obtuvo ${p ? show(p[f]) : "falló"}`);
  }
  if (wrong.length) errors.push(`  ${item.id} (${item.note}) [${p?.model ?? "—"}]\n    ${wrong.join("\n    ")}`);
}

// Per-class precision / recall for the categorical fields.
function perClass(field: "sentiment" | "intent" | "priority") {
  const labels = [...new Set(dataset.items.map((i) => i.expected[field]))];
  return labels.map((label) => {
    let tp = 0, predicted = 0, actual = 0;
    for (const item of dataset.items) {
      const p = predictions.get(item.id)?.[field];
      if (p === label) predicted++;
      if (item.expected[field] === label) actual++;
      if (p === label && item.expected[field] === label) tp++;
    }
    return { label, precision: pct(tp, predicted), recall: pct(tp, actual), n: actual };
  });
}

const exact = dataset.items.filter((item) => {
  const p = predictions.get(item.id);
  return p && FIELDS.every((f) => p[f] === item.expected[f]);
}).length;
const { usage, costUsd } = totalUsage(calls);
const fieldAvg = FIELDS.reduce((s, f) => s + correct[f], 0) / (FIELDS.length * total);

console.log(`\nEvaluación del clasificador — ${total} menciones`);
console.log(`Modelos: rápido ${fast}${fastOnly ? " (sin escalar)" : `, inteligente ${smart}`} · escaladas ${escalated} · fallidas ${failed.length}`);
console.log(`\nPrecisión por campo:`);
for (const f of FIELDS) console.log(`  ${f.padEnd(13)} ${pct(correct[f], total).padStart(6)}  (${correct[f]}/${total})`);
console.log(`  ${"promedio".padEnd(13)} ${(fieldAvg * 100).toFixed(1).padStart(5)}%`);
console.log(`  ${"todo exacto".padEnd(13)} ${pct(exact, total).padStart(6)}  (${exact}/${total})`);
for (const f of ["sentiment", "intent", "priority"] as const) {
  console.log(`\n${f}: precisión / exhaustividad por clase`);
  for (const r of perClass(f)) console.log(`  ${r.label.padEnd(10)} ${r.precision.padStart(6)} / ${r.recall.padStart(6)}  (n=${r.n})`);
}
console.log(
  `\nTokens: entrada ${usage.inputTokens}, salida ${usage.outputTokens}, caché leída ${usage.cacheReadTokens}, caché escrita ${usage.cacheWriteTokens}`,
);
console.log(`Costo estimado: US$${costUsd.toFixed(4)} en ${calls.length} llamadas · ${((Date.now() - started) / 1000).toFixed(1)} s`);
if (errors.length) console.log(`\nDiferencias:\n${errors.join("\n")}`);
for (const f of failed) console.log(`  falló ${f.id}: ${f.error}`);

mkdirSync(RESULTS_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = new URL(`${stamp}.json`, RESULTS_DIR);
writeFileSync(
  out,
  JSON.stringify(
    {
      models,
      accuracy: Object.fromEntries(FIELDS.map((f) => [f, correct[f] / total])),
      exact: exact / total,
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
console.log(`\nResultados: ${out.pathname}`);
