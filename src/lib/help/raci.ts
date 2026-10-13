// Responsibility matrix (who does, approves, is consulted, is informed) of the
// operating activities. R = realiza, A = aprueba/responde, C = consultado,
// I = informado. Shared by /ayuda and docs/manual-operativo.md.

export const RACI_ROLES = ["Administración", "Comunicación (analista/coordinación)", "Enlace de dependencia", "Titular de dependencia", "Dirección (consulta)"] as const;

export const RACI: readonly { activity: string; cells: readonly string[] }[] = [
  { activity: "Configurar municipio (usuarios, catálogos, SLA, canales, retención, IA)", cells: ["R/A", "C", "—", "C", "I"] },
  { activity: "Verificar medios y figuras públicas", cells: ["A", "R", "—", "—", "—"] },
  { activity: "Revisar bandeja y corregir clasificación", cells: ["C", "R/A", "—", "—", "—"] },
  { activity: "Crear caso y asignar a dependencia", cells: ["A", "R", "I", "I", "—"] },
  { activity: "Aceptar o devolver un caso", cells: ["I", "I", "R", "A", "—"] },
  { activity: "Atender y registrar avances con evidencia", cells: ["—", "I", "R", "A", "—"] },
  { activity: "Validar y cerrar", cells: ["A", "R", "I", "I", "I"] },
  { activity: "Reabrir", cells: ["A", "R", "I", "I", "—"] },
  { activity: "Escalamiento por vencimiento", cells: ["I", "R", "I", "A", "—"] },
  { activity: "Aprobar y enviar reportes", cells: ["A", "R", "—", "—", "I"] },
  { activity: "Responder a falla de captura", cells: ["A", "R", "—", "—", "I"] },
  { activity: "Responder a incidente de seguridad", cells: ["R/A", "C", "—", "—", "I"] },
  { activity: "Conciliación y exportación autorizada", cells: ["R/A", "C", "—", "—", "I"] },
];
