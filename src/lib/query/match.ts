// Boolean query language for monitoring projects, and its evaluator.
//
//   presidente municipal            implicit AND between terms
//   "san andres" OR sanandres       quotes = exact phrase (contiguous words)
//   educa*  "obra* public*"         * = any letters/digits inside one word
//   agua AND NOT (pipa OR garrafon) NOT binds tighter than AND, AND than OR
//
// Operators are the uppercase words AND, OR, NOT (quote them to search the
// word itself). Matching ignores case, accents and punctuation, and works on
// whole words: "agua" does not match "aguacate" (use "agua*" for that).

import { normalizeText, tokenize } from "./normalize.ts";

type WordPattern = { kind: "exact"; value: string } | { kind: "wild"; re: RegExp };

export type QueryNode =
  | { type: "term"; source: string; words: WordPattern[] }
  | { type: "not"; child: QueryNode }
  | { type: "and"; children: QueryNode[] }
  | { type: "or"; children: QueryNode[] };

export class QuerySyntaxError extends Error {
  /** Character offset in the expression, for pointing at the problem. */
  readonly position: number;

  constructor(message: string, position: number) {
    super(message);
    this.name = "QuerySyntaxError";
    this.position = position;
  }
}

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

type Token =
  | { kind: "(" | ")" | "AND" | "OR" | "NOT"; pos: number }
  | { kind: "TERM"; text: string; quoted: boolean; pos: number };

const OPERATORS = new Set(["AND", "OR", "NOT"]);

function lex(expression: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expression.length) {
    const ch = expression[i];
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === "(" || ch === ")") {
      tokens.push({ kind: ch, pos: i });
      i++;
    } else if (ch === '"') {
      const end = expression.indexOf('"', i + 1);
      if (end === -1) throw new QuerySyntaxError("Faltan las comillas de cierre.", i);
      tokens.push({ kind: "TERM", text: expression.slice(i + 1, end), quoted: true, pos: i });
      i = end + 1;
    } else {
      let end = i;
      while (end < expression.length && !/[\s()"]/.test(expression[end])) end++;
      const word = expression.slice(i, end);
      if (OPERATORS.has(word)) tokens.push({ kind: word as "AND" | "OR" | "NOT", pos: i });
      else tokens.push({ kind: "TERM", text: word, quoted: false, pos: i });
      i = end;
    }
  }
  return tokens;
}

/** Normalized words of a term; "*" survives as the wildcard. */
function termWords(text: string, pos: number): WordPattern[] {
  const words = normalizeText(text)
    .split(/[^\p{L}\p{N}*]+/u)
    .filter(Boolean);
  if (words.length === 0) throw new QuerySyntaxError("Hay un término vacío.", pos);

  return words.map((word) => {
    if (!word.includes("*")) return { kind: "exact", value: word };
    if (!/[\p{L}\p{N}]/u.test(word)) {
      throw new QuerySyntaxError("El comodín * necesita al menos una letra.", pos);
    }
    const body = word
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[\\p{L}\\p{N}]*");
    return { kind: "wild", re: new RegExp(`^${body}$`, "u") };
  });
}

// ---------------------------------------------------------------------------
// Parser (recursive descent): or := and (OR and)* ; and := not ((AND)? not)* ;
// not := NOT not | primary ; primary := "(" or ")" | TERM
// ---------------------------------------------------------------------------

export function parseQuery(expression: string): QueryNode {
  const tokens = lex(expression);
  if (tokens.length === 0) throw new QuerySyntaxError("La consulta está vacía.", 0);
  let index = 0;

  const peek = () => tokens[index];
  const startsOperand = (t: Token | undefined) => t?.kind === "TERM" || t?.kind === "(" || t?.kind === "NOT";

  function parseOr(): QueryNode {
    const children = [parseAnd()];
    while (peek()?.kind === "OR") {
      index++;
      children.push(parseAnd());
    }
    return children.length === 1 ? children[0] : { type: "or", children };
  }

  function parseAnd(): QueryNode {
    const children = [parseNot()];
    for (;;) {
      if (peek()?.kind === "AND") {
        index++;
        children.push(parseNot());
      } else if (startsOperand(peek())) {
        children.push(parseNot()); // implicit AND
      } else {
        break;
      }
    }
    return children.length === 1 ? children[0] : { type: "and", children };
  }

  function parseNot(): QueryNode {
    if (peek()?.kind === "NOT") {
      index++;
      return { type: "not", child: parseNot() };
    }
    return parsePrimary();
  }

  function parsePrimary(): QueryNode {
    const token = peek();
    if (!token) {
      const last = tokens[tokens.length - 1];
      throw new QuerySyntaxError("La consulta termina con un operador.", last.pos);
    }
    if (token.kind === "(") {
      index++;
      if (peek()?.kind === ")") throw new QuerySyntaxError("Hay paréntesis vacíos.", token.pos);
      const inner = parseOr();
      if (peek()?.kind !== ")") throw new QuerySyntaxError("Falta cerrar un paréntesis.", token.pos);
      index++;
      return inner;
    }
    if (token.kind === "TERM") {
      index++;
      return { type: "term", source: token.text, words: termWords(token.text, token.pos) };
    }
    const previous = tokens[index - 1];
    if (previous && (previous.kind === "AND" || previous.kind === "OR" || previous.kind === "NOT")) {
      throw new QuerySyntaxError(`Falta un término después de ${previous.kind}.`, token.pos);
    }
    if (token.kind === ")") throw new QuerySyntaxError("Sobra un paréntesis de cierre.", token.pos);
    throw new QuerySyntaxError(`Falta un término antes de ${token.kind}.`, token.pos);
  }

  const ast = parseOr();
  const rest = peek();
  if (rest) {
    throw new QuerySyntaxError(
      rest.kind === ")" ? "Sobra un paréntesis de cierre." : "No se entiende la consulta en este punto.",
      rest.pos,
    );
  }
  return ast;
}

export type QueryValidation = { ok: true } | { ok: false; message: string; position: number };

export function validateQuery(expression: string): QueryValidation {
  try {
    parseQuery(expression);
    return { ok: true };
  } catch (error) {
    if (error instanceof QuerySyntaxError) return { ok: false, message: error.message, position: error.position };
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

function wordMatches(pattern: WordPattern, word: string): boolean {
  return pattern.kind === "exact" ? pattern.value === word : pattern.re.test(word);
}

function termMatches(words: WordPattern[], textWords: string[], wordSet: Set<string>): boolean {
  if (words.length === 1) {
    const [only] = words;
    return only.kind === "exact" ? wordSet.has(only.value) : textWords.some((w) => only.re.test(w));
  }
  // Phrase: the words must appear contiguously, in order.
  for (let start = 0; start + words.length <= textWords.length; start++) {
    if (words.every((pattern, offset) => wordMatches(pattern, textWords[start + offset]))) return true;
  }
  return false;
}

function evaluate(node: QueryNode, textWords: string[], wordSet: Set<string>): boolean {
  switch (node.type) {
    case "term":
      return termMatches(node.words, textWords, wordSet);
    case "not":
      return !evaluate(node.child, textWords, wordSet);
    case "and":
      return node.children.every((child) => evaluate(child, textWords, wordSet));
    case "or":
      return node.children.some((child) => evaluate(child, textWords, wordSet));
  }
}

/** Parses once; the returned function tests many texts (e.g. a preview). Throws QuerySyntaxError. */
export function compileQuery(expression: string): (text: string) => boolean {
  const ast = parseQuery(expression);
  return (text) => {
    const words = tokenize(text);
    return evaluate(ast, words, new Set(words));
  };
}

/** Does `text` satisfy `expression`? Throws QuerySyntaxError on invalid syntax. */
export function matches(expression: string, text: string): boolean {
  return compileQuery(expression)(text);
}
