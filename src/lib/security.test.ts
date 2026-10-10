// Static security checks over the source tree (run with the unit tests).
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(import.meta.dirname, "..");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
const sources = files(ROOT).map((path) => ({ path: relative(ROOT, path), text: readFileSync(path, "utf8") }));
const isClient = (text: string) => /^\s*["']use client["']/.test(text);
const isServerActions = (text: string) => /^\s*["']use server["']/.test(text);

/** Exported async functions of a module with their bodies (brace matching). */
function exportedFunctions(text: string): { name: string; params: string; body: string }[] {
  const out: { name: string; params: string; body: string }[] = [];
  for (const m of text.matchAll(/export async function (\w+)\(([^)]*)\)[^\n]*\{$/gm)) {
    let depth = 1;
    let i = m.index! + m[0].length;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") depth--;
    }
    out.push({ name: m[1], params: m[2].trim(), body: text.slice(m.index! + m[0].length, i) });
  }
  return out;
}

function resolveImport(spec: string): string | undefined {
  if (!spec.startsWith("@/")) return undefined;
  const base = spec.slice(2);
  return sources.find((s) => [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`].includes(s.path))?.path;
}

describe("security", () => {
  it("validates the input of every Server Action with zod", () => {
    const missing: string[] = [];
    for (const file of sources.filter((s) => isServerActions(s.text))) {
      for (const fn of exportedFunctions(file.text)) {
        // Actions without parameters take no input to validate.
        if (fn.params && !/\.(safeParse|parse)\(/.test(fn.body)) missing.push(`${file.path}#${fn.name}`);
      }
    }
    assert.deepEqual(missing, []);
  });

  it("never imports server-only modules from client components", () => {
    const leaks: string[] = [];
    for (const file of sources.filter((s) => isClient(s.text))) {
      for (const m of file.text.matchAll(/^import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm)) {
        const target = resolveImport(m[1]);
        const text = target && sources.find((s) => s.path === target)?.text;
        if (text && /^import\s+["']server-only["']/m.test(text)) leaks.push(`${file.path} → ${m[1]}`);
        if (/supabase\/admin|lib\/monitoring|reports\/(data|deliver|pdf)/.test(m[1])) leaks.push(`${file.path} → ${m[1]}`);
      }
    }
    assert.deepEqual(leaks, []);
  });

  it("reads no private environment variable in client code", () => {
    const reads = sources
      .filter((s) => isClient(s.text))
      .flatMap((s) => [...s.text.matchAll(/process\.env\.(\w+)/g)].map((m) => m[1]).filter((name) => !name.startsWith("NEXT_PUBLIC_")).map((n) => `${s.path}: ${n}`));
    assert.deepEqual(reads, []);
  });

  it("exposes only the expected NEXT_PUBLIC_ variables", () => {
    const allowed = new Set(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SITE_URL"]);
    const used = new Set(sources.flatMap((s) => [...s.text.matchAll(/NEXT_PUBLIC_\w+/g)].map((m) => m[0])));
    assert.deepEqual([...used].filter((n) => !allowed.has(n)), []);
  });

  it("keeps the service-role client behind server-only", () => {
    const admin = sources.find((s) => s.path === "lib/supabase/admin.ts")!;
    assert.match(admin.text, /^import "server-only";/m);
  });
});
