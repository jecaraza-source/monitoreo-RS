import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ROLES } from "../auth/roles.ts";
import { CASE_STATUSES } from "../cases/model.ts";
import { CASE_STATES, GUIDES, guidesFor, PROCEDURES, topicsFor } from "./content.ts";

describe("help content", () => {
  it("every role has a guide that explains what it receives", () => {
    for (const role of ROLES) {
      const guides = guidesFor(role);
      assert.ok(guides.length > 0, role);
      assert.ok(guides.some((g) => (g.topics.recibe?.length ?? 0) > 0), `${role}: qué recibe`);
    }
  });

  it("the department guide covers accept/return, evidence, validation and reopening, without internal notes", () => {
    const topics = topicsFor("dependencia", ["aceptar", "evidencia", "validar", "reabrir", "notas"]);
    assert.deepEqual(topics.map((t) => t.topic), ["aceptar", "evidencia", "validar", "reabrir", "notas"]);
    const notes = topics.find((t) => t.topic === "notas")!.lines.join(" ");
    assert.doesNotMatch(notes, /Nota interna/);
    assert.match(notes, /Nota compartida/);
  });

  it("coordination explains validating and reopening; editors see both kinds of notes", () => {
    const topics = topicsFor("comunicacion", ["validar", "reabrir", "notas"]).map((t) => t.topic);
    assert.deepEqual(topics, ["validar", "reabrir", "notas"]);
    assert.match(topicsFor("admin", ["notas"])[0].lines.join(" "), /Nota interna/);
  });

  it("the state dictionary covers every case status", () => {
    assert.deepEqual(CASE_STATES.map((s) => s.status), [...CASE_STATUSES]);
    for (const s of CASE_STATES) assert.ok(s.meaning && s.next && s.label, s.status);
  });

  it("procedures include capture failures, security incidents and AI unavailable, with what keeps working", () => {
    assert.deepEqual(PROCEDURES.map((p) => p.key), ["captura", "seguridad", "ia"]);
    assert.match(PROCEDURES.find((p) => p.key === "ia")!.steps.join(" "), /Siguen funcionando/);
  });

  it("help never contains credentials or keys", () => {
    const text = JSON.stringify([GUIDES, PROCEDURES]);
    assert.doesNotMatch(text, /sk-|api[_-]?key|service_role|password|contraseña:/i);
  });
});
