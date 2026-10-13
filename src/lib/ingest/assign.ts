// Pure step of ingestion: decide which fetched items are kept and which query
// captured each one. Shared by the cron worker and the "Probar" button.
import type { NormalizedMention } from "../connectors/types.ts";
import { compileQuery } from "../query/match.ts";

export type ActiveQuery = { id: string; expression: string };
export type CompiledQuery = { id: string; test: (text: string) => boolean };
export type Assigned = NormalizedMention & { queryId: string | null };

/** Compiles active queries in priority order; invalid ones are reported and skipped. */
export function compileQueries(queries: ActiveQuery[]): { compiled: CompiledQuery[]; invalid: string[] } {
  const compiled: CompiledQuery[] = [];
  const invalid: string[] = [];
  for (const q of queries) {
    try {
      compiled.push({ id: q.id, test: compileQuery(q.expression) });
    } catch {
      invalid.push(q.id);
    }
  }
  return { compiled, invalid };
}

/**
 * First matching query wins. With requireMatch, items no query captures are
 * dropped (broad sources like RSS); otherwise they are kept with queryId null
 * (e.g. comments on the municipality's own page).
 */
export function assignQueries(
  mentions: NormalizedMention[],
  queries: CompiledQuery[],
  requireMatch: boolean,
): { kept: Assigned[]; unmatched: number } {
  const kept: Assigned[] = [];
  let unmatched = 0;
  const seen = new Set<string>();
  for (const mention of mentions) {
    if (seen.has(mention.externalId)) continue; // same item twice in one fetch
    seen.add(mention.externalId);
    const queryId = queries.find((q) => q.test(mention.text))?.id ?? null;
    if (!queryId && requireMatch) {
      unmatched++;
      continue;
    }
    kept.push({ ...mention, queryId });
  }
  return { kept, unmatched };
}
