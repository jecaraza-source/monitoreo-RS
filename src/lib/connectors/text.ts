// Text cleanup shared by connectors: HTML/XML entities, tags, whitespace.

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
  ntilde: "ñ", Ntilde: "Ñ", uuml: "ü", Uuml: "Ü", iexcl: "¡", iquest: "¿",
  laquo: "«", raquo: "»", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
  hellip: "…", ndash: "–", mdash: "—", deg: "°", copy: "©", reg: "®",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    return NAMED[entity] ?? match;
  });
}

/** HTML fragment (possibly entity-escaped, as in many feeds) → plain text. */
export function htmlToText(html: string): string {
  let text = html.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  // Feeds often escape the HTML itself (&lt;p&gt;), so decode before and after stripping tags.
  text = decodeEntities(text);
  text = text
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  text = decodeEntities(text);
  return text.replace(/[ \t\f\v ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

export const MAX_TEXT_LENGTH = 5000;

export function clampText(text: string, max = MAX_TEXT_LENGTH): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** "Title — body" without repeating the title when the body already starts with it. */
export function joinTitleAndBody(title: string, body: string): string {
  const t = title.trim();
  const b = body.trim();
  if (!t) return b;
  if (!b || b.toLowerCase().startsWith(t.toLowerCase())) return b || t;
  return `${t} — ${b}`;
}
