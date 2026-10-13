import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { actionsFor, CASE_STATUSES, needsReason, TRANSITIONS, transitionAllowed } from "./model.ts";

// The migration is the authority: its transition table must match this mirror.
const sql = readFileSync(new URL("../../../supabase/migrations/20261027000000_cases.sql", import.meta.url), "utf8");

function sqlPairs(fn: string): string[] {
  const body = sql.slice(sql.indexOf(`create function public.${fn}`));
  const list = body.slice(body.indexOf(" in ("), body.indexOf(");\n$$;"));
  return [...list.matchAll(/\('([a-z_]+)', '([a-z_]+)'\)/g)].map((m) => `${m[1]}>${m[2]}`).sort();
}

describe("case workflow", () => {
  it("mirrors the database's transition table", () => {
    assert.deepEqual(TRANSITIONS.map(([a, b]) => `${a}>${b}`).sort(), sqlPairs("case_transition_allowed"));
  });

  it("offers departments only their own steps", () => {
    const dept = actionsFor("assigned", "department", true).map((a) => a.to);
    assert.deepEqual(dept, ["accepted", "returned"]);
    assert.deepEqual(actionsFor("assigned", "department", false), [], "a supporting department does not move the case");
    assert.deepEqual(actionsFor("resolved", "department", true), [], "validation is for comunicación");
    assert.deepEqual(actionsFor("in_progress", "reader", true), []);
  });

  it("editors get every allowed step, with reasons where required", () => {
    const resolved = actionsFor("resolved", "editor", false);
    assert.deepEqual(resolved.map((a) => [a.to, a.reason]), [["closed", false], ["in_progress", true]]);
    assert.equal(resolved.find((a) => a.to === "closed")?.label, "Validar y cerrar");
    assert.equal(actionsFor("closed", "editor", false)[0].label, "Reabrir");
    assert.equal(actionsFor("assigned", "editor", false).find((a) => a.to === "returned")?.reason, true);
  });

  it("merged is terminal and only reachable by merging", () => {
    for (const s of CASE_STATUSES) assert.equal(transitionAllowed(s, "merged"), false);
    assert.equal(actionsFor("merged", "editor", false).length, 0);
  });

  it("reasons: return, discard, reopen and rejected validation", () => {
    assert.equal(needsReason("assigned", "returned"), true);
    assert.equal(needsReason("closed", "in_review"), true);
    assert.equal(needsReason("resolved", "in_progress"), true);
    assert.equal(needsReason("new", "in_review"), false);
  });
});
