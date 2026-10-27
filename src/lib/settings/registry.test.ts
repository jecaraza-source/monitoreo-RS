import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { canAccessPath, ROLES, SECTIONS, SUBSECTIONS } from "../auth/roles.ts";
import { CONFIG_ELEMENTS } from "./registry.ts";

describe("configuration registry", () => {
  it("every element can be opened by its editors, and is audited", () => {
    for (const e of CONFIG_ELEMENTS) {
      assert.ok(e.audited.length > 0, e.key);
      for (const role of e.editors) assert.ok(canAccessPath(role, e.href), `${role} → ${e.href}`);
    }
  });

  it("no one edits an element whose page they cannot open", () => {
    for (const e of CONFIG_ELEMENTS) {
      const sub = SUBSECTIONS.find((s) => s.href === e.href);
      if (sub) for (const role of e.editors) assert.ok(sub.roles.includes(role), `${e.key}: ${role}`);
    }
  });
});

/** Every page.tsx under src/app/(app). */
function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? pages(path) : name === "page.tsx" ? [path] : [];
  });
}

describe("menu entries need real authorization", () => {
  it("every app page checks the member and its section on the server", () => {
    const root = join(process.cwd(), "src/app/(app)");
    for (const page of pages(root)) {
      const source = readFileSync(page, "utf8");
      assert.match(source, /require(Section|Member|Role)\(/, page);
    }
  });

  it("every menu entry and subsection matches the path check used by pages", () => {
    for (const role of ROLES) {
      for (const s of SECTIONS) assert.equal(canAccessPath(role, s.href, { officials: true, counterintel: true }), s.roles.includes(role), `${role} ${s.href}`);
      for (const s of SUBSECTIONS) assert.equal(canAccessPath(role, s.href), s.roles.includes(role), `${role} ${s.href}`);
    }
  });
});
