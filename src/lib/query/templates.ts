// Starting points for topic queries (municipal services). A template fills
// the builder with the topic's usual words; the place terms (the
// municipality's name) go in their own group so the query stays local.
// They search topics, never people (CLAUDE.md).
export type TopicTemplate = { key: string; label: string; terms: string[] };

export const TOPIC_TEMPLATES: readonly TopicTemplate[] = [
  { key: "agua", label: "Agua y drenaje", terms: ["sin agua", "falta de agua", "fuga de agua", "fugas", "agua potable", "drenaje", "aguas negras", "alcantarilla*", "tandeo"] },
  { key: "calles", label: "Baches y calles", terms: ["bache*", "pavimenta*", "calles en mal estado", "banqueta*", "socavón"] },
  { key: "alumbrado", label: "Alumbrado", terms: ["alumbrado", "luminaria*", "lámpara fundida", "calle oscura", "sin alumbrado"] },
  { key: "basura", label: "Basura y limpia", terms: ["basura", "recolección de basura", "camión de la basura", "tiradero", "basurero*"] },
  { key: "seguridad", label: "Seguridad", terms: ["inseguridad", "asalto*", "robo*", "balacera", "patrulla*", "policía municipal"] },
  { key: "salud", label: "Salud", terms: ["centro de salud", "hospital", "medicamento*", "dengue", "sin médico"] },
  { key: "transito", label: "Tránsito y transporte", terms: ["tránsito", "semáforo*", "transporte público", "embotellamiento", "accidente vial"] },
  { key: "atencion", label: "Trámites y atención", terms: ["mala atención", "nadie atiende", "trámite*", "corrupción", "mordida"] },
];

/** The municipality's name for the place group: "Municipio de Alvarado" → "Alvarado". */
export function placeTerm(orgName: string): string | null {
  const name = orgName.replace(/^\s*(h\.?\s*)?(ayuntamiento|municipio)( constitucional)? de\s+/i, "").trim();
  return name || null;
}
