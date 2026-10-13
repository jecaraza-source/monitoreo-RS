import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { actionsFor, CASE_STATUSES, caseDueAt, caseOverdue, formatDuration, needsReason, taskActions, TRANSITIONS, transitionActor, transitionAllowed } from "./model.ts";

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
    assert.deepEqual(actionsFor("resolved", "department", true), [], "validation is for coordination");
    assert.deepEqual(actionsFor("in_progress", "reader", true), []);
  });

  it("coordination validates in one dialog and reopens with evidence", () => {
    const resolved = actionsFor("resolved", "editor", false);
    assert.deepEqual(resolved.map((a) => [a.to, a.validate, a.label]), [["closed", true, "Validar"]], "no plain close or reject buttons");
    const reopen = actionsFor("closed", "editor", false)[0];
    assert.deepEqual([reopen.label, reopen.reopen, reopen.reason], ["Reabrir", true, true]);
    assert.equal(actionsFor("discarded", "editor", false)[0].reopen, false, "a discarded case goes back to review without the evidence dialog");
  });

  it("department steps are the department's; coordination may register them on its behalf, with a reason", () => {
    assert.deepEqual(actionsFor("in_progress", "department", true).map((a) => a.label), ["Solicitar validación"]);
    const editor = actionsFor("assigned", "editor", false);
    assert.deepEqual(editor.filter((a) => !a.onBehalf).map((a) => a.to), ["assigned"]);
    const accept = editor.find((a) => a.to === "accepted")!;
    assert.deepEqual([accept.onBehalf, accept.reason, accept.primary], [true, true, false]);
    assert.equal(accept.label, "Aceptar (en nombre de la dependencia)");
  });

  it("who performs each transition", () => {
    assert.equal(transitionActor("assigned", "accepted"), "department");
    assert.equal(transitionActor("in_progress", "resolved"), "department");
    assert.equal(transitionActor("resolved", "closed"), "validation");
    assert.equal(transitionActor("resolved", "in_progress"), "validation");
    assert.equal(transitionActor("in_review", "assigned"), "coordination");
    assert.equal(transitionActor("closed", "in_review"), "coordination");
    assert.equal(transitionActor("in_progress", "closed"), null, "no jump to closed");
  });

  it("the deadline that matters: acceptance first, then the commitment", () => {
    const accept = "2026-10-10T10:00:00Z";
    const due = "2026-10-12T10:00:00Z";
    assert.equal(caseDueAt({ status: "assigned", due_at: due, accept_due_at: accept }), accept);
    assert.equal(caseDueAt({ status: "accepted", due_at: due, accept_due_at: accept }), due);
    assert.equal(caseDueAt({ status: "resolved", due_at: due }), null, "waiting for validation is not the department's delay");
    const now = new Date("2026-10-11T00:00:00Z").getTime();
    assert.equal(caseOverdue({ status: "assigned", due_at: due, accept_due_at: accept }, now), true, "not accepted in time");
    assert.equal(caseOverdue({ status: "accepted", due_at: due, accept_due_at: accept }, now), false);
  });

  it("tasks: the area works them; the lead area or coordination cancel or reopen", () => {
    assert.deepEqual(taskActions("pending", false).map((a) => a.to), ["in_progress", "done"]);
    assert.deepEqual(taskActions("in_progress", true).map((a) => [a.to, a.note]), [["done", false], ["cancelled", true]]);
    assert.deepEqual(taskActions("done", false), []);
    assert.deepEqual(taskActions("done", true).map((a) => a.to), ["in_progress"]);
  });

  it("formats elapsed times", () => {
    assert.equal(formatDuration(45 * 60_000), "45 min");
    assert.equal(formatDuration(200 * 60_000), "3 h 20 min");
    assert.equal(formatDuration(52 * 3_600_000), "2 d 4 h");
    assert.equal(formatDuration(-5), "0 min");
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
