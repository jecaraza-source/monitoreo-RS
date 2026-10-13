// Start-of-operation checklist (pure): automatic checks computed from the
// municipality's data, plus manual checks (per-role tests, exercise) recorded
// by an administrator in onboarding_checks (audited).

export type OnboardingFacts = {
  departments: number;
  neighborhoods: number;
  categories: number;
  /** Active categories with no department able to attend them. */
  categoriesWithoutCapability: number;
  /** Departments without link (responsible) or head. */
  departmentsWithoutLink: number;
  departmentsWithoutHead: number;
  /** Departments without any dependencia user. */
  departmentsWithoutUsers: number;
  admins: number;
  comunicacion: number;
  activeSources: number;
  /** Active sources that read successfully at least once. */
  sourcesReading: number;
  verifiedAuthors: number;
  slaApproved: boolean;
  retentionDecided: boolean;
  aiLimitsSet: boolean;
  /** Manual checks already recorded (key → note). */
  manual: Record<string, { note: string; doneAt: string; doneBy: string }>;
};

export type CheckItem = {
  key: string;
  group: "Catálogos" | "Responsables" | "Fuentes" | "Configuración" | "Pruebas por rol";
  label: string;
  ok: boolean;
  detail: string;
  href: string;
  /** Recorded by hand by an administrator (with a note). */
  manual?: boolean;
};

export const MANUAL_CHECKS: readonly { key: string; label: string; detail: string }[] = [
  { key: "destinatarios_prueba", label: "Envío a destinatarios de prueba", detail: "Un aviso y un reporte llegaron a buzones de prueba del municipio (no a ciudadanos)." },
  { key: "prueba_admin", label: "Prueba de Administración", detail: "Configuró un elemento, revisó su registro en Bitácora y lo revirtió." },
  { key: "prueba_comunicacion", label: "Prueba de Comunicación", detail: "Revisó la bandeja, creó un caso de práctica y lo asignó." },
  { key: "prueba_enlace", label: "Prueba de enlace", detail: "Aceptó el caso de práctica, registró avance con evidencia y lo marcó resuelto." },
  { key: "prueba_lectura", label: "Prueba de Consulta", detail: "Consultó dashboard y reportes, y confirmó que no puede modificar nada." },
  { key: "ejercicio_operativo", label: "Ejercicio operativo completo", detail: "Del caso de práctica a su validación y reapertura, según docs/ejercicio-operativo.md." },
  { key: "procedimientos_revisados", label: "Procedimientos revisados", detail: "Fallas de captura, incidentes de seguridad e IA no disponible, con sus responsables." },
];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function onboardingChecklist(f: OnboardingFacts): CheckItem[] {
  const auto: CheckItem[] = [
    { key: "dependencias", group: "Catálogos", label: "Dependencias registradas", ok: f.departments > 0, detail: plural(f.departments, "dependencia", "dependencias"), href: "/configuracion/catalogos" },
    { key: "colonias", group: "Catálogos", label: "Colonias registradas", ok: f.neighborhoods > 0, detail: plural(f.neighborhoods, "colonia", "colonias"), href: "/configuracion/catalogos" },
    {
      key: "categorias",
      group: "Catálogos",
      label: "Categorías de caso con dependencia capaz",
      ok: f.categories > 0 && f.categoriesWithoutCapability === 0,
      detail:
        f.categories === 0
          ? "Sin categorías"
          : f.categoriesWithoutCapability
            ? `${plural(f.categoriesWithoutCapability, "categoría", "categorías")} sin dependencia que la atienda`
            : plural(f.categories, "categoría", "categorías"),
      href: "/configuracion/catalogos",
    },
    {
      key: "enlaces",
      group: "Responsables",
      label: "Cada dependencia tiene enlace y titular",
      ok: f.departments > 0 && f.departmentsWithoutLink === 0 && f.departmentsWithoutHead === 0,
      detail: `Sin enlace: ${f.departmentsWithoutLink} · sin titular: ${f.departmentsWithoutHead}`,
      href: "/configuracion/sla",
    },
    {
      key: "usuarios",
      group: "Responsables",
      label: "Usuarios por rol",
      ok: f.admins > 0 && f.comunicacion > 0 && f.departmentsWithoutUsers === 0,
      detail: `${plural(f.admins, "administrador", "administradores")} · ${f.comunicacion} de Comunicación · ${plural(f.departmentsWithoutUsers, "dependencia", "dependencias")} sin usuario`,
      href: "/configuracion/usuarios",
    },
    {
      key: "fuentes",
      group: "Fuentes",
      label: "Fuentes activas que ya leen",
      ok: f.activeSources > 0 && f.sourcesReading === f.activeSources,
      detail: `${f.sourcesReading} de ${plural(f.activeSources, "fuente activa", "fuentes activas")} con lectura exitosa`,
      href: "/configuracion/fuentes",
    },
    {
      key: "autores",
      group: "Fuentes",
      label: "Medios y figuras públicas verificados",
      ok: f.verifiedAuthors > 0,
      detail: f.verifiedAuthors ? plural(f.verifiedAuthors, "cuenta verificada", "cuentas verificadas") : "Sin catálogo: todas las cuentas aparecen como no verificadas",
      href: "/configuracion/autores",
    },
    { key: "sla", group: "Configuración", label: "SLA aprobado como acuerdo", ok: f.slaApproved, detail: f.slaApproved ? "Versión vigente aprobada" : "Los plazos son de referencia hasta aprobarlos", href: "/configuracion/sla" },
    {
      key: "retencion",
      group: "Configuración",
      label: "Política de retención decidida",
      ok: f.retentionDecided,
      detail: f.retentionDecided ? "Registrada con su acuerdo (o sin eliminación automática)" : "Sin política: se usa el valor del despliegue",
      href: "/configuracion/retencion",
    },
    { key: "ia", group: "Configuración", label: "Límites de IA definidos", ok: f.aiLimitsSet, detail: f.aiLimitsSet ? "Definidos" : "Se usan los predeterminados, sin presupuesto", href: "/configuracion/consumo" },
  ];
  const manual: CheckItem[] = MANUAL_CHECKS.map((m) => {
    const done = f.manual[m.key];
    return {
      key: m.key,
      group: "Pruebas por rol",
      label: m.label,
      ok: Boolean(done),
      detail: done ? `${done.note} (${done.doneBy}, ${done.doneAt.slice(0, 10)})` : m.detail,
      href: "/configuracion/municipio",
      manual: true,
    };
  });
  return [...auto, ...manual];
}

export const readiness = (items: CheckItem[]) => ({ done: items.filter((i) => i.ok).length, total: items.length });
