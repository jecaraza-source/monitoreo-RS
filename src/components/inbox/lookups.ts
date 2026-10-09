import type { InboxCatalogs } from "@/lib/inbox/data";

export type Lookups = {
  departments: Map<string, string>;
  neighborhoods: Map<string, string>;
  sources: Map<string, InboxCatalogs["sources"][number]>;
};

export function buildLookups(catalogs: InboxCatalogs): Lookups {
  return {
    departments: new Map(catalogs.departments.map((d) => [d.id, d.name])),
    neighborhoods: new Map(catalogs.neighborhoods.map((n) => [n.id, n.name])),
    sources: new Map(catalogs.sources.map((s) => [s.id, s])),
  };
}
