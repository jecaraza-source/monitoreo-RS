import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ROLES, canAccessPath, homeForRole, sectionForPath, sectionsForRole, subsectionsForRole } from "./roles.ts";

describe("sectionsForRole", () => {
  it("gives each role exactly its menu", () => {
    const menu = (role: (typeof ROLES)[number]) => sectionsForRole(role).map((s) => s.label);
    assert.deepEqual(menu("admin"), [
      "Dashboard", "Bandeja", "Mapa", "Alertas", "Reportes", "Asistente", "Configuración",
    ]);
    assert.deepEqual(menu("comunicacion"), [
      "Dashboard", "Bandeja", "Mapa", "Alertas", "Reportes", "Asistente", "Configuración",
    ]);
    assert.deepEqual(menu("dependencia"), ["Bandeja", "Alertas", "Asistente"]);
    assert.deepEqual(menu("lectura"), ["Dashboard", "Mapa", "Alertas", "Reportes", "Asistente"]);
  });
});

describe("canAccessPath", () => {
  it("matches nested routes to their section", () => {
    assert.equal(sectionForPath("/configuracion/usuarios")?.key, "settings");
    assert.equal(canAccessPath("admin", "/configuracion/usuarios"), true);
  });

  it("lets comunicacion manage projects but not users or catalogs", () => {
    assert.equal(canAccessPath("comunicacion", "/configuracion/proyectos/abc"), true);
    assert.equal(canAccessPath("comunicacion", "/configuracion/usuarios"), false);
    assert.equal(canAccessPath("comunicacion", "/configuracion/catalogos"), false);
    assert.deepEqual(subsectionsForRole("comunicacion").map((s) => s.label), ["Proyectos", "Fuentes"]);
    assert.deepEqual(subsectionsForRole("admin").map((s) => s.label), ["Proyectos", "Fuentes", "Catálogos", "Usuarios"]);
  });

  it("does not confuse prefixes with sections", () => {
    assert.equal(sectionForPath("/mapas"), undefined);
    assert.equal(sectionForPath("/bandeja-vieja"), undefined);
  });

  it("blocks dependencia from executive sections", () => {
    for (const path of ["/dashboard", "/mapa", "/reportes", "/configuracion"]) {
      assert.equal(canAccessPath("dependencia", path), false, path);
    }
    assert.equal(canAccessPath("dependencia", "/bandeja/123"), true);
  });

  it("keeps lectura out of operational sections", () => {
    assert.equal(canAccessPath("lectura", "/bandeja"), false);
  });

  it("opens the assistant to every role (RLS scopes its answers)", () => {
    for (const role of ["admin", "comunicacion", "dependencia", "lectura"] as const) {
      assert.equal(canAccessPath(role, "/asistente"), true, role);
    }
  });
});

describe("homeForRole", () => {
  it("lands each role on its first section", () => {
    assert.equal(homeForRole("admin"), "/dashboard");
    assert.equal(homeForRole("lectura"), "/dashboard");
    assert.equal(homeForRole("dependencia"), "/bandeja");
  });
});

describe("crisis room", () => {
  it("is for org-wide readers only and stays out of the settings tabs", () => {
    assert.equal(canAccessPath("comunicacion", "/alertas/crisis"), true);
    assert.equal(canAccessPath("lectura", "/alertas/crisis"), true);
    assert.equal(canAccessPath("dependencia", "/alertas/crisis"), false);
    assert.equal(canAccessPath("dependencia", "/alertas"), true);
    assert.deepEqual(subsectionsForRole("lectura").map((s) => s.label), []);
    assert.deepEqual(subsectionsForRole("lectura", "/alertas").map((s) => s.label), ["Sala de crisis"]);
  });
});
