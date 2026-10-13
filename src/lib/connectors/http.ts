// HTTP helper for connectors: timeout, cancellation, streamed size cap and readable errors.
import { ConnectorError } from "./types.ts";

const USER_AGENT = "MonitoreoMunicipal/1.0 (+escucha social; contenido publico)";

export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

const tooLarge = (maxBytes: number) => new ConnectorError(`La respuesta pesa más de ${Math.round(maxBytes / 1e6)} MB.`);

/**
 * Reads the body as UTF-8, counting the bytes as they arrive and cancelling
 * the stream as soon as it passes maxBytes, whatever Content-Length says. If
 * the signal aborts mid-body, the read stops and the abort reason is thrown.
 */
export async function readCapped(response: Response, maxBytes: number, signal?: AbortSignal): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw tooLarge(maxBytes);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const onAbort = () => void reader.cancel(signal?.reason).catch(() => {});
  signal?.addEventListener("abort", onAbort, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    signal?.throwIfAborted();
    for (;;) {
      const { done, value } = await reader.read();
      // A cancel on abort ends the stream as if it were complete.
      signal?.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw tooLarge(maxBytes);
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** The run was cancelled from outside (source timeout or caller). */
export class CancelledError extends ConnectorError {
  constructor() {
    super("La lectura de la fuente se canceló.");
    this.name = "CancelledError";
  }
}

export type FetchTextOptions = { timeoutMs?: number; maxBytes?: number; accept?: string; signal?: AbortSignal };

export async function fetchText(
  fetchImpl: typeof fetch,
  url: string,
  { timeoutMs = 15000, maxBytes = DEFAULT_MAX_BYTES, accept = "*/*", signal: outer }: FetchTextOptions = {},
): Promise<{ status: number; text: string }> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = outer ? AbortSignal.any([timeout, outer]) : timeout;
  const host = new URL(url).host;
  // Keeps ConnectorErrors (blocked destination, too large, too many redirects) and names the rest.
  const explain = (error: unknown) => {
    if (outer?.aborted) return outer.reason instanceof ConnectorError ? outer.reason : new CancelledError();
    if (timeout.aborted) return new ConnectorError(`${host} tardó demasiado en responder.`);
    if (error instanceof ConnectorError) return error;
    return new ConnectorError(`${host} no respondió.`);
  };
  try {
    const response = await fetchImpl(url, { headers: { "user-agent": USER_AGENT, accept }, redirect: "follow", signal });
    return { status: response.status, text: await readCapped(response, maxBytes, signal) };
  } catch (error) {
    throw explain(error);
  }
}

export async function fetchJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  { signal }: { signal?: AbortSignal } = {},
): Promise<{ status: number; body: T }> {
  const { status, text } = await fetchText(fetchImpl, url, { accept: "application/json", signal });
  try {
    return { status, body: JSON.parse(text) as T };
  } catch {
    throw new ConnectorError(`Respuesta inválida de ${new URL(url).host} (HTTP ${status}).`);
  }
}

/**
 * Runs connector work with a deadline. On timeout the signal aborts with a
 * readable ConnectorError, so requests and body reads stop instead of running
 * on in the background after the source was reported as failed.
 */
export async function withDeadline<T>(work: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new ConnectorError("La fuente tardó demasiado.")), ms);
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
  });
  aborted.catch(() => {});
  try {
    return await Promise.race([work(controller.signal), aborted]);
  } finally {
    clearTimeout(timer);
    // Whatever is still running (a connector that ignored the signal) is cut off.
    if (!controller.signal.aborted) controller.abort(new ConnectorError("La fuente terminó."));
  }
}

/** Keeps tokens out of logs and error messages. */
export function redactUrl(url: string): string {
  return url.replace(/(access_token|key|appsecret_proof)=[^&]+/g, "$1=***");
}
