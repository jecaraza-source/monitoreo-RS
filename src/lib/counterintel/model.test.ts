import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CI_KINDS, CI_KIND_LABELS, parseIndicators, parseMentionRefs, parseOverview } from "./model.ts";

describe("parseOverview", () => {
  it("reads threats and indicator matches, and tolerates missing data", () => {
    const parsed = parseOverview({
      threats: [
        { id: "t1", published_at: "2026-10-27T10:00:00Z", text: "x", source: "RSS", severity: "emergency", incident_type: "violence", author: null, url: null },
        { id: null, text: "sin id" },
      ],
      matches: [
        { id: "m1", published_at: "2026-10-26T00:00:00Z", text: "entra a alvarado-apoyos.mx", report_id: "r1", report_title: "Página falsa", indicator: "alvarado-apoyos.mx" },
        { id: "m2", text: "sin reporte" },
      ],
    });
    assert.equal(parsed.threats.length, 1);
    assert.equal(parsed.threats[0].severity, "emergency");
    assert.equal(parsed.threats[0].author, null);
    assert.equal(parsed.matches.length, 1);
    assert.equal(parsed.matches[0].indicator, "alvarado-apoyos.mx");
    assert.equal(parsed.matches[0].author, null);
    assert.deepEqual(parseOverview(null), { threats: [], matches: [] });
  });
});

describe("report inputs", () => {
  it("one indicator per line, without blanks or repeats", () => {
    assert.deepEqual(parseIndicators(" @falso_ayto \n\nhttps://alvarado-gob.mx\n@FALSO_AYTO\n#Rumor"), ["@falso_ayto", "https://alvarado-gob.mx", "#Rumor"]);
  });

  it("takes mention ids from ids or inbox links", () => {
    const id = "0b5f2c1e-1111-4222-8333-444455556666";
    assert.deepEqual(parseMentionRefs(`https://app/bandeja/${id}\n${id.toUpperCase()} y otro`), [id]);
    assert.deepEqual(parseMentionRefs("nada"), []);
  });

  it("labels every kind", () => {
    for (const k of CI_KINDS) assert.ok(CI_KIND_LABELS[k]);
  });
});
