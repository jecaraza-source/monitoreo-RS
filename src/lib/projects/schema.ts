// Shared (client + server) validation for the project sheet and query builder.
import { z } from "zod";

export const kpiSchema = z.object({
  name: z.string().trim().min(1, "Cada KPI necesita un nombre.").max(80),
  target: z.number().finite().nullable(),
  unit: z.string().trim().max(20).default(""),
});

export const territorySchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("municipality"), notes: z.string().trim().max(500).default("") }),
  z.object({
    scope: z.literal("neighborhoods"),
    neighborhoodIds: z.array(z.guid("Identificador inválido.")).min(1, "Elige al menos una colonia."),
    notes: z.string().trim().max(500).default(""),
  }),
]);

export const projectSchema = z.object({
  name: z.string().trim().min(3, "El nombre debe tener al menos 3 caracteres.").max(120),
  goal: z.string().trim().max(1000).default(""),
  kpis: z.array(kpiSchema).max(12, "Máximo 12 KPIs."),
  territory: territorySchema,
});

export type ProjectInput = z.input<typeof projectSchema>;
export type Kpi = z.infer<typeof kpiSchema>;
export type Territory = z.infer<typeof territorySchema>;

export const builderSchema = z.object({
  groups: z
    .array(
      z.object({
        mode: z.enum(["any", "all", "none"]),
        terms: z.array(z.string().max(120)).max(100),
      }),
    )
    .max(20),
});

/** Reads a stored territory, tolerating rows written before validation existed. */
export function readTerritory(value: unknown): Territory {
  const parsed = territorySchema.safeParse(value);
  return parsed.success ? parsed.data : { scope: "municipality", notes: "" };
}

export function readKpis(value: unknown): Kpi[] {
  const parsed = z.array(kpiSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}
