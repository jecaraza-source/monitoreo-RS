// Visual query builder model → boolean expression for match.ts.
//
// Groups combine with AND. Each group joins its terms as:
//   any  "incluir cualquiera de"  (a OR b)
//   all  "incluir todas"          (a AND b)
//   none "excluir"                NOT (a OR b)

import { normalizeText } from "./normalize.ts";

export type GroupMode = "any" | "all" | "none";
export type QueryGroup = { mode: GroupMode; terms: string[] };
export type QueryBuilderState = { groups: QueryGroup[] };

export const GROUP_LABELS: Record<GroupMode, string> = {
  any: "Incluir cualquiera de",
  all: "Incluir todas",
  none: "Excluir",
};

const OPERATOR_WORDS = new Set(["AND", "OR", "NOT"]);

/**
 * One term as the user typed it → a safe expression atom. Quotes and parens
 * are stripped; multi-word terms become "phrases"; a trailing/inner * stays a
 * wildcard. Returns null for terms with nothing searchable.
 */
export function formatTerm(raw: string): string | null {
  const cleaned = raw.replace(/["()]/g, " ").replace(/\s+/g, " ").trim();
  if (!/[\p{L}\p{N}]/u.test(cleaned)) return null;
  const needsQuotes = /[^\p{L}\p{N}*]/u.test(cleaned) || OPERATOR_WORDS.has(cleaned);
  return needsQuotes ? `"${cleaned}"` : cleaned;
}

/** Usable terms of a group, deduplicated ignoring case and accents. */
export function groupAtoms(group: QueryGroup): string[] {
  const seen = new Set<string>();
  const atoms: string[] = [];
  for (const term of group.terms) {
    const atom = formatTerm(term);
    if (!atom) continue;
    const key = normalizeText(atom);
    if (seen.has(key)) continue;
    seen.add(key);
    atoms.push(atom);
  }
  return atoms;
}

function groupExpression(group: QueryGroup, atoms: string[]): string {
  const joined = atoms.join(group.mode === "all" ? " AND " : " OR ");
  const wrapped = atoms.length > 1 ? `(${joined})` : joined;
  return group.mode === "none" ? `NOT ${wrapped}` : wrapped;
}

export type BuildResult = { ok: true; expression: string } | { ok: false; message: string };

export function buildExpression(state: QueryBuilderState): BuildResult {
  const parts = state.groups
    .map((group) => ({ group, atoms: groupAtoms(group) }))
    .filter(({ atoms }) => atoms.length > 0);

  // Inclusions first so the expression reads "what we look for, minus noise".
  const includes = parts.filter(({ group }) => group.mode !== "none");
  const excludes = parts.filter(({ group }) => group.mode === "none");
  if (includes.length === 0) {
    return { ok: false, message: "Agrega al menos un grupo de términos a incluir." };
  }

  const expression = [...includes, ...excludes]
    .map(({ group, atoms }) => groupExpression(group, atoms))
    .join(" AND ");
  return { ok: true, expression };
}

export const EMPTY_BUILDER: QueryBuilderState = {
  groups: [
    { mode: "any", terms: [] },
    { mode: "none", terms: [] },
  ],
};
