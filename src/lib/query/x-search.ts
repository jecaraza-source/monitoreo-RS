// A monitoring query → an X (Twitter) search string, for the search terms of an
// Apify tweet-scraper task. X search has AND (space), OR, "phrases", -exclude
// and parentheses, but no wildcards: "fuga*" becomes "fuga" and the result is
// marked approximate (the platform's own matching still filters what comes in).
import { parseQuery, type QueryNode } from "./match.ts";

export type XSearch = { search: string; approximate: boolean };
/** One active query as an X search, as the Fuentes page lists it. */
export type XSearchRow = XSearch & { name: string };

function render(node: QueryNode, parent: QueryNode["type"] | null, state: { approximate: boolean }): string {
  switch (node.type) {
    case "term": {
      if (node.source.includes("*")) state.approximate = true;
      const text = node.source.replace(/\*/g, "").replace(/\s+/g, " ").trim();
      return /\s/.test(text) ? `"${text}"` : text;
    }
    case "not": {
      const child = node.child;
      // NOT (a OR b) → -a -b: X negates single terms most reliably.
      if (child.type === "or") return child.children.map((c) => render({ type: "not", child: c }, "and", state)).join(" ");
      const inner = render(child, "not", state);
      return `-${inner}`;
    }
    case "and": {
      const joined = node.children.map((c) => render(c, "and", state)).join(" ");
      return parent === "not" ? `(${joined})` : joined;
    }
    case "or": {
      const joined = node.children.map((c) => render(c, "or", state)).join(" OR ");
      return parent === "and" || parent === "not" ? `(${joined})` : joined;
    }
  }
}

export function toXSearch(expression: string): XSearch {
  const state = { approximate: false };
  const search = render(parseQuery(expression), null, state);
  return { search, approximate: state.approximate };
}

/** Input for an Apify tweet-scraper task: newest posts in Spanish for each search. */
export function tweetScraperInput(searches: string[], maxItems = 200) {
  return { searchTerms: searches, sort: "Latest", tweetLanguage: "es", maxItems };
}
