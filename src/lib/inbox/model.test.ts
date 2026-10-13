import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  cursorFilter,
  dayEnd,
  dayStart,
  defaultDueAt,
  formatHours,
  slaFromRows,
  filtersToSearch,
  isOverdue,
  parseFilters,
  statusFor,
  upsertSorted,
  appendUnique,
  bulkMessage,
  compareQueue,
  queueFilters,
  queueKey,
  VIEWS_BY_SCOPE,
  type QueueCursor,
} from "./model.ts";

describe("parseFilters", () => {
  it("keeps valid values and drops malformed ones", () => {
    const filters = parseFilters({
      q: "  sin agua ",
      from: "2026-10-01",
      to: "ayer",
      sentiment: "negative",
      priority: "urgent",
      department: "00000000-0000-4000-b000-000000000001",
      neighborhood: "not-a-uuid",
      status: "overdue",
      extra: "x",
    });
    assert.deepEqual(filters, {
      q: "sin agua",
      from: "2026-10-01",
      sentiment: "negative",
      department: "00000000-0000-4000-b000-000000000001",
      status: "overdue",
    });
  });

  it("reads URLSearchParams and arrays", () => {
    assert.deepEqual(parseFilters(new URLSearchParams("topic=drenaje&q=")), { topic: "drenaje" });
    assert.deepEqual(parseFilters({ sentiment: ["positive", "negative"] }), { sentiment: "positive" });
  });

  it("round-trips through the URL", () => {
    const filters = { q: "fuga", source: "00000000-0000-4000-e200-000000000001", status: "reviewed" as const };
    assert.deepEqual(parseFilters(new URLSearchParams(filtersToSearch(filters).slice(1))), filters);
    assert.equal(filtersToSearch({}), "");
  });
});

describe("statusFor", () => {
  it("ignores statuses of the other scope", () => {
    assert.equal(statusFor("editor", "discarded"), "discarded");
    assert.equal(statusFor("editor", "overdue"), undefined);
    assert.equal(statusFor("department", "overdue"), "overdue");
    assert.equal(statusFor("department", "discarded"), undefined);
  });
});

describe("dates", () => {
  it("uses Mexico City calendar days", () => {
    assert.equal(dayStart("2026-10-09"), "2026-10-09T06:00:00.000Z");
    assert.equal(dayEnd("2026-10-09"), "2026-10-10T06:00:00.000Z");
  });

  it("sets the default due date by priority", () => {
    const now = new Date("2026-10-09T12:00:00Z");
    assert.equal(defaultDueAt("high", now).toISOString(), "2026-10-10T12:00:00.000Z");
    assert.equal(defaultDueAt(null, now).toISOString(), "2026-10-12T12:00:00.000Z");
    const sla = slaFromRows([{ priority: "high", hours: 6 }]);
    assert.deepEqual(sla, { critical: 12, high: 6, medium: 72, low: 168 });
    assert.equal(defaultDueAt("high", now, sla).toISOString(), "2026-10-09T18:00:00.000Z");
  });

  it("writes SLA hours for people", () => {
    assert.equal(formatHours(12), "12 h");
    assert.equal(formatHours(24), "1 día");
    assert.equal(formatHours(36), "36 h");
    assert.equal(formatHours(72), "3 días");
    assert.equal(formatHours(60), "2 días 12 h");
  });

  it("flags only open tickets past their due date", () => {
    const now = Date.parse("2026-10-09T12:00:00Z");
    assert.equal(isOverdue({ status: "open", due_at: "2026-10-09T11:00:00Z" }, now), true);
    assert.equal(isOverdue({ status: "in_progress", due_at: "2026-10-09T11:00:00Z" }, now), true);
    assert.equal(isOverdue({ status: "resolved", due_at: "2026-10-09T11:00:00Z" }, now), false);
    assert.equal(isOverdue({ status: "open", due_at: "2026-10-09T13:00:00Z" }, now), false);
    assert.equal(isOverdue({ status: "open", due_at: null }, now), false);
  });
});

describe("keyset pagination", () => {
  it("quotes timestamps in the or() filter", () => {
    assert.equal(
      cursorFilter({ publishedAt: "2026-10-09T12:00:00+00:00", id: "abc" }),
      'published_at.lt."2026-10-09T12:00:00+00:00",and(published_at.eq."2026-10-09T12:00:00+00:00",id.lt.abc)',
    );
  });

  it("inserts and replaces keeping newest first", () => {
    const list = [
      { id: "c", published_at: "2026-10-09T12:00:00Z", v: 1 },
      { id: "a", published_at: "2026-10-09T10:00:00Z", v: 1 },
    ];
    assert.deepEqual(upsertSorted(list, { id: "b", published_at: "2026-10-09T11:00:00Z", v: 1 }).map((i) => i.id), ["c", "b", "a"]);
    assert.deepEqual(upsertSorted(list, { id: "d", published_at: "2026-10-09T13:00:00Z", v: 1 }).map((i) => i.id), ["d", "c", "a"]);
    assert.deepEqual(upsertSorted(list, { id: "z", published_at: "2026-10-01T00:00:00Z", v: 1 }).map((i) => i.id), ["c", "a", "z"]);
    const replaced = upsertSorted(list, { id: "a", published_at: "2026-10-09T10:00:00Z", v: 2 });
    assert.deepEqual(replaced.map((i) => [i.id, i.v]), [["c", 1], ["a", 2]]);
  });
});

describe("operational views", () => {
  const row = (over: Partial<QueueCursor>): QueueCursor => ({
    urgency: 0,
    due_at: null,
    item_at: "2026-10-01T00:00:00Z",
    kind: "mention",
    id: "00000000-0000-4000-0000-000000000001",
    ...over,
  });

  it("orders by urgency, then due date (none last), then age, then kind and id", () => {
    const rows = [
      row({ id: "a", urgency: 1 }),
      row({ id: "b", urgency: 3, due_at: "2026-10-05T00:00:00Z" }),
      row({ id: "c", urgency: 3, due_at: "2026-10-02T00:00:00Z" }),
      row({ id: "d", urgency: 3 }),
      row({ id: "e", urgency: 1, item_at: "2026-09-01T00:00:00Z" }),
      row({ id: "f", urgency: 1, kind: "case" }),
    ];
    assert.deepEqual([...rows].sort(compareQueue).map((r) => r.id), ["c", "b", "d", "e", "f", "a"]);
  });

  it("appends pages without repeating an item", () => {
    const page1 = [{ key: "mention:1" }, { key: "case:1" }];
    const page2 = [{ key: "case:1" }, { key: "mention:2" }, { key: "mention:2" }];
    assert.deepEqual(appendUnique(page1, page2).map((e) => e.key), ["mention:1", "case:1", "mention:2"]);
    assert.equal(queueKey("case", "1"), "case:1");
  });

  it("sends the row filters to the queue, not the view or the status", () => {
    assert.deepEqual(queueFilters({ view: "urgent", status: "new", q: "fuga", priority: "high" }), { q: "fuga", priority: "high" });
  });

  it("keeps the view in the URL", () => {
    assert.deepEqual(parseFilters(new URLSearchParams("view=overdue&q=fuga")), { view: "overdue", q: "fuga" });
    assert.deepEqual(parseFilters(new URLSearchParams("view=nope")), {});
    assert.equal(filtersToSearch({ view: "validation" }), "?view=validation");
  });

  it("offers departments only the views of their own work", () => {
    assert.deepEqual([...VIEWS_BY_SCOPE.department], ["urgent", "acceptance", "overdue", "validation"]);
    assert.equal(VIEWS_BY_SCOPE.editor.length, 6);
  });

  it("reports how many changed and why the rest did not", () => {
    assert.equal(bulkMessage("descartadas", 3, []), "3 actualizadas (descartadas).");
    assert.equal(
      bulkMessage("turnadas", 1, [
        { id: "a", reason: "pertenece a C-00002" },
        { id: "b", reason: "pertenece a C-00002" },
      ]),
      "1 actualizada (turnadas); 2 sin cambio: pertenece a C-00002.",
    );
  });
});
