import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ROLES, canAccessPath, canViewOfficials, homeForRole, sectionForPath, sectionsForRole, subsectionsForRole } from "./roles.ts";

describe("sectionsForRole", () => {
  it("gives each role exactly its menu", () => {
    const menu = (role: (typeof ROLES)[number]) => sectionsForRole(role).map((s) => s.label);
    assert.deepEqual(menu("admin"), [
      "Dashboard", "Bandeja", "Casos", "Mapa", "Alertas", "Reportes", "Asistente", "Salud", "Configuración", "Ayuda",
    ]);
    assert.deepEqual(menu("comunicacion"), [
      "Dashboard", "Bandeja", "Casos", "Mapa", "Alertas", "Reportes", "Asistente", "Salud", "Configuración", "Ayuda",
    ]);
    assert.deepEqual(menu("dependencia"), ["Bandeja", "Casos", "Mapa", "Alertas", "Asistente", "Ayuda"]);
    assert.deepEqual(menu("lectura"), ["Dashboard", "Casos", "Mapa", "Alertas", "Reportes", "Asistente", "Salud", "Ayuda"]);
  });

  it("shows Funcionarios only with the explicit grant", () => {
    const granted = { officials: true, counterintel: false };
    assert.ok(sectionsForRole("comunicacion", granted).some((s) => s.key === "officials"));
    assert.ok(sectionsForRole("lectura", granted).some((s) => s.key === "officials"));
    assert.ok(!sectionsForRole("dependencia", granted).some((s) => s.key === "officials"));
    assert.equal(canAccessPath("lectura", "/funcionarios"), false);
    assert.equal(canAccessPath("lectura", "/funcionarios", granted), true);
    assert.equal(canAccessPath("dependencia", "/funcionarios", granted), false);
    assert.equal(canViewOfficials("admin", false), true);
    assert.equal(canViewOfficials("comunicacion", false), false);
    assert.equal(canViewOfficials("dependencia", true), false);
  });

  it("shows the counter-intelligence office only with its own grant, also to admins", () => {
    const office = { officials: false, counterintel: true };
    const has = (role: (typeof ROLES)[number], access?: typeof office) => sectionsForRole(role, access).some((s) => s.key === "counterintel");
    assert.equal(has("admin"), false);
    assert.equal(has("admin", office), true);
    assert.equal(has("comunicacion", office), true);
    assert.equal(has("lectura", office), true);
    assert.equal(has("dependencia", office), false);
    assert.equal(sectionsForRole("admin", office).find((s) => s.key === "counterintel")?.label, "Oficina de Contrainteligencia");
    assert.equal(canAccessPath("admin", "/contrainteligencia"), false);
    assert.equal(canAccessPath("admin", "/contrainteligencia", office), true);
    assert.equal(canAccessPath("comunicacion", "/contrainteligencia", { officials: true, counterintel: false }), false);
    assert.equal(canAccessPath("dependencia", "/contrainteligencia", office), false);
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
    assert.equal(canAccessPath("comunicacion", "/configuracion/whatsapp"), false);
    assert.equal(canAccessPath("comunicacion", "/configuracion/identidad"), false);
    assert.deepEqual(subsectionsForRole("comunicacion").map((s) => s.label), ["Resumen", "Proyectos", "Fuentes", "Autores verificados", "Consumo de IA"]);
    assert.equal(canAccessPath("comunicacion", "/configuracion/retencion"), false);
    assert.equal(canAccessPath("lectura", "/configuracion/consumo"), false);
    assert.equal(canAccessPath("dependencia", "/configuracion/autores"), false);
    assert.deepEqual(subsectionsForRole("admin").map((s) => s.label), ["Resumen", "Proyectos", "Fuentes", "Autores verificados", "Consumo de IA", "Catálogos", "Usuarios", "Identidad", "Emergencias", "WhatsApp", "SLA y escalamiento", "Envíos", "Retención y conciliación", "Bitácora"]);
  });

  it("does not confuse prefixes with sections", () => {
    assert.equal(sectionForPath("/mapas"), undefined);
    assert.equal(sectionForPath("/bandeja-vieja"), undefined);
  });

  it("keeps dependencia out of the monitor's health", () => {
    assert.equal(canAccessPath("dependencia", "/salud"), false);
    assert.equal(canAccessPath("lectura", "/salud"), true);
  });

  it("blocks dependencia from executive sections", () => {
    for (const path of ["/dashboard", "/reportes", "/configuracion"]) {
      assert.equal(canAccessPath("dependencia", path), false, path);
    }
    // The map opens with only the cases of its area (mapLayers + RLS).
    assert.equal(canAccessPath("dependencia", "/mapa"), true);
    assert.equal(canAccessPath("dependencia", "/bandeja/123"), true);
  });

  it("opens cases to every role (RLS scopes what each one sees)", () => {
    for (const role of ["admin", "comunicacion", "dependencia", "lectura"] as const) {
      assert.equal(canAccessPath(role, "/casos/abc"), true, role);
    }
  });

  it("keeps the review queue to editors", () => {
    assert.equal(canAccessPath("comunicacion", "/bandeja/revision"), true);
    assert.equal(canAccessPath("dependencia", "/bandeja/revision"), false);
    assert.equal(canAccessPath("dependencia", "/bandeja"), true);
    assert.equal(canAccessPath("comunicacion", "/configuracion/emergencias"), false);
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
