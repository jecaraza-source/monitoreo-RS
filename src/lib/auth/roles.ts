// Role-based access to app sections. Pure module (no React, no Next) so it can
// be shared by the proxy, Server Components and unit tests.
//
// This only decides what each role can *navigate* to. Data visibility is
// enforced by RLS in the database, never by these checks alone.

export const ROLES = ["admin", "comunicacion", "dependencia", "lectura"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administración",
  comunicacion: "Comunicación Social",
  dependencia: "Dependencia",
  lectura: "Consulta",
};

export type SectionKey =
  | "dashboard"
  | "inbox"
  | "map"
  | "alerts"
  | "reports"
  | "assistant"
  | "settings";

export type Section = {
  key: SectionKey;
  href: string;
  label: string;
  roles: readonly Role[];
};

// Order here is the sidebar order.
export const SECTIONS: readonly Section[] = [
  { key: "dashboard", href: "/dashboard", label: "Dashboard", roles: ["admin", "comunicacion", "lectura"] },
  { key: "inbox", href: "/bandeja", label: "Bandeja", roles: ["admin", "comunicacion", "dependencia"] },
  { key: "map", href: "/mapa", label: "Mapa", roles: ["admin", "comunicacion", "lectura"] },
  { key: "alerts", href: "/alertas", label: "Alertas", roles: ["admin", "comunicacion", "dependencia", "lectura"] },
  { key: "reports", href: "/reportes", label: "Reportes", roles: ["admin", "comunicacion", "lectura"] },
  { key: "assistant", href: "/asistente", label: "Asistente", roles: ["admin", "comunicacion", "dependencia", "lectura"] },
  { key: "settings", href: "/configuracion", label: "Configuración", roles: ["admin", "comunicacion"] },
];

// Pages inside a section with a narrower audience than the section itself.
// Comunicación manages projects and queries; users and catalogs are admin-only.
export const SUBSECTIONS: readonly { href: string; label: string; roles: readonly Role[] }[] = [
  { href: "/configuracion/proyectos", label: "Proyectos", roles: ["admin", "comunicacion"] },
  { href: "/configuracion/fuentes", label: "Fuentes", roles: ["admin", "comunicacion"] },
  { href: "/configuracion/catalogos", label: "Catálogos", roles: ["admin"] },
  { href: "/configuracion/usuarios", label: "Usuarios", roles: ["admin"] },
  // Crisis room: live org-wide picture, so not for a single department.
  { href: "/alertas/crisis", label: "Sala de crisis", roles: ["admin", "comunicacion", "lectura"] },
];

function isUnder(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function sectionsForRole(role: Role): Section[] {
  return SECTIONS.filter((section) => section.roles.includes(role));
}

/** Section that owns a pathname (exact match or nested route), if any. */
export function sectionForPath(pathname: string): Section | undefined {
  return SECTIONS.find((section) => isUnder(pathname, section.href));
}

/** Paths outside every section (e.g. /sin-acceso) are not role-gated here. */
export function canAccessPath(role: Role, pathname: string): boolean {
  const section = sectionForPath(pathname);
  if (section && !section.roles.includes(role)) return false;
  const subsection = SUBSECTIONS.find((sub) => isUnder(pathname, sub.href));
  return !subsection || subsection.roles.includes(role);
}

/** Subsections under `parent` (e.g. "/configuracion") the role may open. */
export function subsectionsForRole(role: Role, parent = "/configuracion") {
  return SUBSECTIONS.filter((sub) => sub.roles.includes(role) && isUnder(sub.href, parent));
}

/** Landing page after login: the first section the role can open. */
export function homeForRole(role: Role): string {
  return sectionsForRole(role)[0]?.href ?? "/sin-acceso";
}
