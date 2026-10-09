// HTTP helper for connectors: timeout, size cap and readable errors.
import { ConnectorError } from "./types.ts";

const USER_AGENT = "MonitoreoMunicipal/1.0 (+escucha social; contenido publico)";

export async function fetchText(
  fetchImpl: typeof fetch,
  url: string,
  { timeoutMs = 15000, maxBytes = 5 * 1024 * 1024, accept = "*/*" }: { timeoutMs?: number; maxBytes?: number; accept?: string } = {},
): Promise<{ status: number; text: string }> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { "user-agent": USER_AGENT, accept },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError" ? "tardó demasiado en responder" : "no respondió";
    throw new ConnectorError(`${new URL(url).host} ${reason}.`);
  }
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > maxBytes) throw new ConnectorError(`La respuesta pesa más de ${Math.round(maxBytes / 1e6)} MB.`);
  const text = await response.text();
  if (text.length > maxBytes) throw new ConnectorError(`La respuesta pesa más de ${Math.round(maxBytes / 1e6)} MB.`);
  return { status: response.status, text };
}

export async function fetchJson<T>(fetchImpl: typeof fetch, url: string): Promise<{ status: number; body: T }> {
  const { status, text } = await fetchText(fetchImpl, url, { accept: "application/json" });
  try {
    return { status, body: JSON.parse(text) as T };
  } catch {
    throw new ConnectorError(`Respuesta inválida de ${new URL(url).host} (HTTP ${status}).`);
  }
}

/** Keeps tokens out of logs and error messages. */
export function redactUrl(url: string): string {
  return url.replace(/(access_token|key|appsecret_proof)=[^&]+/g, "$1=***");
}
