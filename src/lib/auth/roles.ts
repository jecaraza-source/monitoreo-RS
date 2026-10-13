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
  | "cases"
  | "map"
  | "alerts"
  | "reports"
  | "assistant"
  | "officials"
  | "health"
  | "settings";

export type Section = {
  key: SectionKey;
  href: string;
  label: string;
  roles: readonly Role[];
  /** Also needs an explicit per-user grant (memberships.can_view_officials). */
  restricted?: boolean;
};

/** Per-user grants on top of the role. */
export type Access = { officials: boolean };
const NO_GRANTS: Access = { officials: false };

// Order here is the sidebar order.
export const SECTIONS: readonly Section[] = [
  { key: "dashboard", href: "/dashboard", label: "Dashboard", roles: ["admin", "comunicacion", "lectura"] },
  { key: "inbox", href: "/bandeja", label: "Bandeja", roles: ["admin", "comunicacion", "dependencia"] },
  // Cases: dependencia sees only cases assigned to it (RLS); lectura reads without acting.
  { key: "cases", href: "/casos", label: "Casos", roles: ["admin", "comunicacion", "dependencia", "lectura"] },
  { key: "map", href: "/mapa", label: "Mapa", roles: ["admin", "comunicacion", "lectura"] },
  { key: "alerts", href: "/alertas", label: "Alertas", roles: ["admin", "comunicacion", "dependencia", "lectura"] },
  { key: "reports", href: "/reportes", label: "Reportes", roles: ["admin", "comunicacion", "lectura"] },
  { key: "assistant", href: "/asistente", label: "Asistente", roles: ["admin", "comunicacion", "dependencia", "lectura"] },
  // Perception of officials: restricted to members an admin authorizes.
  { key: "officials", href: "/funcionarios", label: "Funcionarios", roles: ["admin", "comunicacion", "lectura"], restricted: true },
  // Health of the monitor: detail for admin and comunicacion, a freshness summary for lectura.
  { key: "health", href: "/salud", label: "Salud", roles: ["admin", "comunicacion", "lectura"] },
  { key: "settings", href: "/configuracion", label: "Configuración", roles: ["admin", "comunicacion"] },
];

// Pages inside a section with a narrower audience than the section itself.
// Comunicación manages projects and queries; users and catalogs are admin-only.
export const SUBSECTIONS: readonly { href: string; label: string; roles: readonly Role[] }[] = [
  { href: "/configuracion/proyectos", label: "Proyectos", roles: ["admin", "comunicacion"] },
  { href: "/configuracion/fuentes", label: "Fuentes", roles: ["admin", "comunicacion"] },
  { href: "/configuracion/catalogos", label: "Catálogos", roles: ["admin"] },
  { href: "/configuracion/usuarios", label: "Usuarios", roles: ["admin"] },
  // Client logo and cover colors for the reports.
  { href: "/configuracion/identidad", label: "Identidad", roles: ["admin"] },
  // Incident policies (emergency channels): admin.
  { href: "/configuracion/emergencias", label: "Emergencias", roles: ["admin"] },
  { href: "/configuracion/whatsapp", label: "WhatsApp", roles: ["admin"] },
  // SLA calendar and targets, escalation levels; the outbox and report jobs monitor.
  { href: "/configuracion/sla", label: "SLA y escalamiento", roles: ["admin"] },
  { href: "/configuracion/envios", label: "Envíos", roles: ["admin"] },
  { href: "/configuracion/bitacora", label: "Bitácora", roles: ["admin"] },
  // Human review of doubtful classifications: editorial work.
  { href: "/bandeja/revision", label: "Revisión", roles: ["admin", "comunicacion"] },
  // Crisis room: live org-wide picture, so not for a single department.
  { href: "/alertas/crisis", label: "Sala de crisis", roles: ["admin", "comunicacion", "lectura"] },
];

function isUnder(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function sectionsForRole(role: Role, access: Access = NO_GRANTS): Section[] {
  return SECTIONS.filter((section) => section.roles.includes(role) && (!section.restricted || access.officials));
}

/** Whether the member may open the officials module: admins always, others when granted. */
export function canViewOfficials(role: Role, granted: boolean): boolean {
  return role === "admin" || (granted && (role === "comunicacion" || role === "lectura"));
}

/** Section that owns a pathname (exact match or nested route), if any. */
export function sectionForPath(pathname: string): Section | undefined {
  return SECTIONS.find((section) => isUnder(pathname, section.href));
}

/** Paths outside every section (e.g. /sin-acceso) are not role-gated here. */
export function canAccessPath(role: Role, pathname: string, access: Access = NO_GRANTS): boolean {
  const section = sectionForPath(pathname);
  if (section && !section.roles.includes(role)) return false;
  if (section?.restricted && !access.officials) return false;
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
