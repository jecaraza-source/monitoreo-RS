// Text normalization shared by the query matcher, the builder and catalogs:
// case- and accent-insensitive, punctuation-free word tokens.

/** "Atención en San Andrés" → "atencion en san andres". ñ becomes n. */
export function normalizeText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
}

/** Normalized words. "#SanAndrés, ¡ya!" → ["sanandres", "ya"]. */
export function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}
