// Builds the routing and case requests from the selected mentions. Shared by
// the chronological inbox and the operational views.
import type { CaseRequest } from "@/components/cases/case-dialog";
import type { Priority } from "@/lib/inbox/model";
import type { InboxItem } from "@/lib/inbox/query";
import type { Lookups } from "./lookups";
import type { RouteRequest } from "./route-dialog";

const PRIORITY_RANK: Record<Priority, number> = { critical: 3, high: 2, medium: 1, low: 0 };

function highestPriority(list: readonly InboxItem[]): Priority | null {
  return (
    list
      .map((i) => i.classifications?.priority)
      .filter((p): p is Priority => Boolean(p))
      .sort((a, b) => PRIORITY_RANK[b] - PRIORITY_RANK[a])[0] ?? null
  );
}

export function routeRequestFor(list: readonly InboxItem[]): RouteRequest {
  const departments = new Set(list.map((i) => i.classifications?.department_id ?? null));
  // One mention already routed: start from its leading department.
  const routed = list.length === 1 ? list[0].tickets : [];
  const leader = routed.find((t) => t.is_primary)?.department_id ?? null;
  const emergencies = [
    ...new Set(
      list
        .filter((i) => i.classifications?.severity === "emergency")
        .map((i) => i.classifications?.incident_type ?? "other"),
    ),
  ];
  return {
    ids: list.map((i) => i.id),
    departmentId: leader ?? (departments.size === 1 ? [...departments][0] : null),
    routed: routed.map((t) => t.department_id),
    priority: highestPriority(list),
    emergencies,
  };
}

export function caseRequestFor(list: readonly InboxItem[], lookups: Lookups): CaseRequest {
  const same = <T,>(pick: (i: InboxItem) => T) => (new Set(list.map(pick)).size === 1 ? pick(list[0]) : null);
  const topic = same((i) => i.classifications?.topic ?? null);
  const neighborhoodId = same((i) => i.classifications?.neighborhood_id ?? null);
  const place = neighborhoodId ? lookups.neighborhoods.get(neighborhoodId) : null;
  const title = topic
    ? `${topic.charAt(0).toUpperCase()}${topic.slice(1)}${place ? ` en ${place}` : ""}`
    : list[0].text.replace(/\s+/g, " ").slice(0, 80);
  return {
    ids: list.map((i) => i.id),
    title,
    category: topic ?? list[0].classifications?.topic ?? null,
    neighborhoodId,
    priority: highestPriority(list) ?? "medium",
  };
}
