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
  { key: "assistant", href: "/asistente", label: "Asistente", roles: ["admin", "comunicacion"] },
  { key: "settings", href: "/configuracion", label: "Configuración", roles: ["admin"] },
];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function sectionsForRole(role: Role): Section[] {
  return SECTIONS.filter((section) => section.roles.includes(role));
}

/** Section that owns a pathname (exact match or nested route), if any. */
export function sectionForPath(pathname: string): Section | undefined {
  return SECTIONS.find(
    (section) => pathname === section.href || pathname.startsWith(`${section.href}/`),
  );
}

/** Paths outside every section (e.g. /sin-acceso) are not role-gated here. */
export function canAccessPath(role: Role, pathname: string): boolean {
  const section = sectionForPath(pathname);
  return !section || section.roles.includes(role);
}

/** Landing page after login: the first section the role can open. */
export function homeForRole(role: Role): string {
  return sectionsForRole(role)[0]?.href ?? "/sin-acceso";
}
