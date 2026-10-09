import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ROLES, canAccessPath, homeForRole, sectionForPath, sectionsForRole } from "./roles.ts";

describe("sectionsForRole", () => {
  it("gives each role exactly its menu", () => {
    const menu = (role: (typeof ROLES)[number]) => sectionsForRole(role).map((s) => s.label);
    assert.deepEqual(menu("admin"), [
      "Dashboard", "Bandeja", "Mapa", "Alertas", "Reportes", "Asistente", "Configuración",
    ]);
    assert.deepEqual(menu("comunicacion"), ["Dashboard", "Bandeja", "Mapa", "Alertas", "Reportes", "Asistente"]);
    assert.deepEqual(menu("dependencia"), ["Bandeja", "Alertas"]);
    assert.deepEqual(menu("lectura"), ["Dashboard", "Mapa", "Alertas", "Reportes"]);
  });
});

describe("canAccessPath", () => {
  it("matches nested routes to their section", () => {
    assert.equal(sectionForPath("/configuracion/usuarios")?.key, "settings");
    assert.equal(canAccessPath("admin", "/configuracion/usuarios"), true);
    assert.equal(canAccessPath("comunicacion", "/configuracion/usuarios"), false);
  });

  it("does not confuse prefixes with sections", () => {
    assert.equal(sectionForPath("/mapas"), undefined);
    assert.equal(sectionForPath("/bandeja-vieja"), undefined);
  });

  it("blocks dependencia from executive sections", () => {
    for (const path of ["/dashboard", "/mapa", "/reportes", "/asistente", "/configuracion"]) {
      assert.equal(canAccessPath("dependencia", path), false, path);
    }
    assert.equal(canAccessPath("dependencia", "/bandeja/123"), true);
  });

  it("keeps lectura out of operational sections", () => {
    assert.equal(canAccessPath("lectura", "/bandeja"), false);
    assert.equal(canAccessPath("lectura", "/asistente"), false);
  });
});

describe("homeForRole", () => {
  it("lands each role on its first section", () => {
    assert.equal(homeForRole("admin"), "/dashboard");
    assert.equal(homeForRole("lectura"), "/dashboard");
    assert.equal(homeForRole("dependencia"), "/bandeja");
  });
});
