// Reads a provider listing that comes newest first (YouTube search, Facebook
// posts) page by page, until it passes the start of the window, a page cap,
// the item cap or the soft deadline. When it stops early it says where: the
// next run reads (since, resumeUntil] and nothing in between is lost.
import { ConnectorError, timeUp, type ConnectorContext, type CoverageLimit } from "./types.ts";

export type Page<T> = { items: T[]; next?: string };

export type WindowRead<T> = {
  items: T[];
  complete: boolean;
  /** Publication time of the oldest item read (inclusive resume point) when incomplete. */
  resumeUntil?: string;
  limits: CoverageLimit[];
  interruptedBy?: string;
};

const reason = (error: unknown) => (error instanceof ConnectorError ? error.message : "Error inesperado del proveedor.");

export async function readNewestFirst<T>(options: {
  ctx: Pick<ConnectorContext, "deadline" | "limit">;
  since: Date;
  maxPages: number;
  label: string;
  fetchPage: (token: string | undefined) => Promise<Page<T>>;
  timeOf: (item: T) => Date;
}): Promise<WindowRead<T>> {
  const { ctx, since, maxPages, label, fetchPage, timeOf } = options;
  const items: T[] = [];
  const limits: CoverageLimit[] = [];
  let oldest: number | null = null;
  let token: string | undefined;

  const stop = (limit?: CoverageLimit, interruptedBy?: string): WindowRead<T> => {
    if (limit) limits.push(limit);
    return {
      items,
      complete: false,
      resumeUntil: oldest === null ? undefined : new Date(oldest).toISOString(),
      limits,
      interruptedBy,
    };
  };

  for (let page = 0; ; page++) {
    if (page > 0 && timeUp(ctx)) return stop({ kind: "time", detail: `${label}: se acabó el tiempo de la corrida en la página ${page + 1}.` });
    if (page >= maxPages) return stop({ kind: "pages", detail: `${label}: se leyeron ${maxPages} páginas; el resto se lee en la siguiente corrida.` });

    let res: Page<T>;
    try {
      res = await fetchPage(token);
    } catch (error) {
      // Nothing read yet: the run fails as a whole. Otherwise keep what was read.
      if (page === 0) throw error;
      return stop({ kind: "error", detail: `${label}: falló la página ${page + 1}.` }, reason(error));
    }

    let reachedStart = false;
    for (const item of res.items) {
      const t = timeOf(item).getTime();
      if (t <= since.getTime()) {
        reachedStart = true;
        continue;
      }
      items.push(item);
      oldest = oldest === null ? t : Math.min(oldest, t);
    }
    if (items.length >= ctx.limit) return stop({ kind: "items", detail: `${label}: se alcanzó el tope de ${ctx.limit} elementos.` });
    if (reachedStart || !res.next) return { items, complete: true, limits };
    token = res.next;
  }
}

/**
 * The inclusive end of a resumed window as an exclusive API bound: one second
 * later, so items that share the resume timestamp are read again (dedupe
 * absorbs them) instead of skipped.
 */
export function exclusiveEnd(until: Date): Date {
  return new Date(until.getTime() + 1000);
}
