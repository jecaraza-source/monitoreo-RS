// Configuration of a municipality: each element, where it is edited, who may
// edit it and which audited tables record its changes (before/after, actor and
// date in audit_log). Pure module: the overview page and the tests use it.
// Who may edit is enforced by RLS/RPCs in the database; this registry must say
// the same (registry.test.ts checks it against the menu).

import type { Role } from "../auth/roles.ts";

export type ConfigElement = {
  key: string;
  label: string;
  description: string;
  href: string;
  /** Roles that may change it (the database enforces the same). */
  editors: readonly Role[];
  /** audit_log.entity values where its changes are recorded. */
  audited: readonly string[];
  /** Sensitive: changes alter commitments, access, deletions or cost. */
  sensitive: boolean;
};

export const CONFIG_ELEMENTS: readonly ConfigElement[] = [
  {
    key: "usuarios",
    label: "Usuarios, roles y permisos",
    description: "Quién entra, con qué rol y a qué dependencia pertenece; acceso al módulo de funcionarios.",
    href: "/configuracion/usuarios",
    editors: ["admin"],
    audited: ["memberships"],
    sensitive: true,
  },
  {
    key: "catalogos",
    label: "Dependencias y colonias",
    description: "Catálogos que usa la clasificación, el turnado y el mapa.",
    href: "/configuracion/catalogos",
    editors: ["admin"],
    audited: ["departments", "neighborhoods"],
    sensitive: false,
  },
  {
    key: "categorias",
    label: "Categorías de caso y capacidades",
    description: "Categorías con su dependencia sugerida y qué dependencias pueden atender cada una.",
    href: "/configuracion/catalogos",
    editors: ["admin"],
    audited: ["case_categories", "department_capabilities"],
    sensitive: false,
  },
  {
    key: "responsables",
    label: "Responsables (enlaces y titulares)",
    description: "A quién llegan los avisos y escalamientos de cada dependencia.",
    href: "/configuracion/sla",
    editors: ["admin"],
    audited: ["departments"],
    sensitive: true,
  },
  {
    key: "sla",
    label: "SLA, horarios y días inhábiles",
    description: "Plazos por prioridad y categoría con su calendario. Guardar crea una versión; los casos ya asignados conservan la suya.",
    href: "/configuracion/sla",
    editors: ["admin"],
    audited: ["sla_versions", "sla_calendars", "sla_holidays", "sla_targets", "cases"],
    sensitive: true,
  },
  {
    key: "escalamiento",
    label: "Escalamiento y canales",
    description: "Recordatorios, escalamiento a enlace, titular y coordinación; silencio nocturno; WhatsApp y correo.",
    href: "/configuracion/sla",
    editors: ["admin"],
    audited: ["notification_settings", "whatsapp_settings", "whatsapp_contacts"],
    sensitive: true,
  },
  {
    key: "emergencias",
    label: "Emergencias",
    description: "Canal institucional y aviso para incidentes de emergencia.",
    href: "/configuracion/emergencias",
    editors: ["admin"],
    audited: ["incident_policies"],
    sensitive: true,
  },
  {
    key: "fuentes",
    label: "Proyectos, consultas y fuentes",
    description: "Qué se monitorea y de dónde; umbrales de frescura por fuente.",
    href: "/configuracion/fuentes",
    editors: ["admin", "comunicacion"],
    audited: ["projects", "queries", "sources"],
    sensitive: false,
  },
  {
    key: "autores",
    label: "Verificación de autores",
    description: "Medios y figuras públicas verificados con evidencia y responsable.",
    href: "/configuracion/autores",
    editors: ["admin", "comunicacion"],
    audited: ["verified_authors"],
    sensitive: true,
  },
  {
    key: "salud",
    label: "Umbrales de salud",
    description: "Cuándo el clasificador y el dashboard se consideran atrasados.",
    href: "/salud",
    editors: ["admin", "comunicacion"],
    audited: ["monitor_settings"],
    sensitive: false,
  },
  {
    key: "ia",
    label: "Límites y presupuesto de IA",
    description: "Concurrencia, cuota por persona, presupuesto y facturas para conciliación.",
    href: "/configuracion/consumo",
    editors: ["admin"],
    audited: ["ai_limits", "ai_invoices"],
    sensitive: true,
  },
  {
    key: "retencion",
    label: "Retención y conservación",
    description: "Plazo de eliminación según acuerdo del municipio y conservaciones que la bloquean.",
    href: "/configuracion/retencion",
    editors: ["admin"],
    audited: ["retention_policies", "retention_holds"],
    sensitive: true,
  },
  {
    key: "identidad",
    label: "Identidad del municipio",
    description: "Logotipo y colores de los reportes.",
    href: "/configuracion/identidad",
    editors: ["admin"],
    audited: ["organizations"],
    sensitive: false,
  },
];

export const canEdit = (element: ConfigElement, role: Role) => element.editors.includes(role);
