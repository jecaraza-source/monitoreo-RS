import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  cursorFilter,
  dayEnd,
  dayStart,
  defaultDueAt,
  filtersToSearch,
  isOverdue,
  parseFilters,
  statusFor,
  upsertSorted,
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
