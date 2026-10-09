// X (Twitter) connector: interface ready, disabled. Reading X requires a paid
// API tier; enable it once there is a contract and a token to store in Vault.
import { z } from "zod";
import { ConnectorError, type Connector } from "./types.ts";

export const xConfigSchema = z.object({
  query: z.string().trim().max(500).optional(),
  requireMatch: z.boolean().optional(),
});
export type XConfig = z.infer<typeof xConfigSchema>;

export const xConnector: Connector<XConfig> = {
  type: "x",
  label: "X (deshabilitado)",
  enabled: false,
  requiresSecret: true,
  configSchema: xConfigSchema,
  defaultRequireMatch: true,
  async fetchSince() {
    throw new ConnectorError("El conector de X está deshabilitado: requiere un plan de pago de la API de X.");
  },
};
