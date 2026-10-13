// How a publication's author is shown. Only verified media and public figures
// are named; any other account is "Cuenta no verificada" (its stored handle is
// a pseudonym and is never displayed, exported or sent to the AI).

export type AuthorKind = "media" | "public_figure" | "citizen";
export type AuthorLike = { display_name: string | null; handle: string; kind: AuthorKind } | null | undefined;

export const UNVERIFIED_AUTHOR = "Cuenta no verificada";

export const AUTHOR_KIND_LABEL: Record<AuthorKind, string> = { media: "Medio", public_figure: "Figura pública", citizen: "No verificada" };

export function authorName(author: AuthorLike): string {
  if (!author) return "Autor desconocido";
  if (author.kind === "citizen") return UNVERIFIED_AUTHOR;
  return author.display_name ?? `@${author.handle}`;
}

/** Badge for verified accounts; null for the rest. */
export function authorBadge(author: AuthorLike): string | null {
  return author && author.kind !== "citizen" ? AUTHOR_KIND_LABEL[author.kind] : null;
}

/** What each platform's handle is, so the catalog matches what the connectors read. */
export const HANDLE_HINTS = {
  rss: "Dominio del medio, p. ej. diario.example",
  meta: "Usuario o ID de la página",
  youtube: "ID del canal (empieza con UC)",
  x: "Usuario sin @",
} as const;
