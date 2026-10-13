// In-app help: role guides, state dictionary and procedures. Pure module,
// shared by /ayuda, the contextual help of each page and the tests. The
// longer operating manual lives in docs/manual-operativo.md and says the same.

import type { Role } from "../auth/roles.ts";
import { CASE_STATUS_LABELS, CASE_STATUSES, type CaseStatus } from "../cases/model.ts";

export type HelpTopic = "recibe" | "aceptar" | "evidencia" | "validar" | "reabrir" | "notas" | "sin_ia";

export const TOPIC_LABELS: Record<HelpTopic, string> = {
  recibe: "Qué información recibo",
  aceptar: "Aceptar o devolver",
  evidencia: "Qué evidencia aportar",
  validar: "Cómo se valida",
  reabrir: "Cómo se reabre",
  notas: "Notas internas y compartidas",
  sin_ia: "Si la IA no está disponible",
};

export type Profile = "analista" | "enlace" | "coordinador" | "direccion" | "administrador";

export type Guide = {
  profile: Profile;
  title: string;
  who: string;
  /** Steps of the profile's daily work. */
  steps: string[];
  topics: Partial<Record<HelpTopic, string[]>>;
};

const NOTES = [
  "Nota interna: sólo la ven Administración y Comunicación. Úsala para contexto político, dudas o datos que la dependencia no necesita.",
  "Nota compartida: la ven también la dependencia asignada. Úsala para instrucciones y acuerdos de atención.",
  "Las notas no se editan ni se borran; si te equivocas, agrega otra nota que lo aclare.",
  "Nunca escribas datos personales de quien publicó (nombre, teléfono, domicilio): el caso trata del problema, no de la persona.",
];

const WITHOUT_AI = [
  "Siguen funcionando: bandeja, turnado manual, casos, tareas, evidencias, validación, reapertura, SLA y escalamiento, mapa, avisos por correo y WhatsApp, y la exportación.",
  "Esperan a que vuelva la IA: la clasificación automática (las menciones nuevas quedan «sin clasificar»), la lectura del día, la redacción de reportes y el asistente.",
  "Mientras tanto, revisa a mano lo urgente en la bandeja (estado «Sin clasificar») y turna lo que lo requiera. Al volver, el clasificador procesa lo pendiente sin duplicar.",
];

export const GUIDES: readonly Guide[] = [
  {
    profile: "analista",
    title: "Analista de Comunicación",
    who: "Rol Comunicación Social. Revisa lo que se publica y decide qué se atiende.",
    steps: [
      "Revisa la bandeja empezando por la vista «Urgentes» y el estado «Sin clasificar».",
      "Corrige la clasificación si es necesario (queda la versión anterior y el motivo).",
      "Agrupa menciones del mismo problema en un caso y turna a la dependencia responsable.",
      "Da seguimiento en Casos a lo vencido y a lo pendiente de validación.",
    ],
    topics: {
      recibe: [
        "Todas las menciones públicas del municipio, clasificadas por tema, colonia, dependencia y prioridad.",
        "Alertas de picos, temas sensibles y emergencias; indicadores del dashboard y reportes.",
        "Sólo se nombran medios y figuras públicas verificados; las demás cuentas aparecen como «Cuenta no verificada».",
      ],
      notas: NOTES,
      sin_ia: WITHOUT_AI,
    },
  },
  {
    profile: "enlace",
    title: "Enlace de dependencia",
    who: "Rol Dependencia. Atiende los casos asignados a su área.",
    steps: [
      "Abre Casos: verás sólo lo asignado a tu dependencia, con su plazo de aceptación y de atención.",
      "Acepta el caso (o devuélvelo con motivo) antes de que venza el plazo de aceptación.",
      "Inicia la atención, registra avances con evidencia y completa las tareas que te toquen.",
      "Al terminar, usa «Solicitar validación»: Coordinación revisa la evidencia y lo cierra o te lo regresa.",
    ],
    topics: {
      recibe: [
        "Los casos asignados a tu dependencia: descripción, colonia, menciones relacionadas, plazos, tareas y notas compartidas.",
        "Avisos por correo o WhatsApp cuando se te asigna un caso, antes de que venza y si se escala.",
        "No ves notas internas ni casos de otras dependencias.",
      ],
      aceptar: [
        "Aceptar: confirmas que tu área lo atiende. Desde ese momento corre el plazo de atención.",
        "Devolver: escribe el motivo (no es de tu competencia, falta información, ya está atendido). Regresa a Comunicación para reasignar.",
        "Si no aceptas ni devuelves antes del plazo, el sistema recuerda y escala al titular y a coordinación.",
      ],
      evidencia: [
        "Fotos o documentos del trabajo realizado (antes y después, oficio, orden de trabajo).",
        "Sin datos personales de terceros visibles; si una foto muestra rostros o placas, recórtala.",
        "Archivos de imagen o PDF; cada avance puede llevar evidencia y queda con fecha y autor.",
      ],
      validar: [
        "Con «Solicitar validación» el caso pasa a «Pendiente de validación». Coordinación revisa la evidencia: lo cierra con el resultado o te lo devuelve a atención con el motivo.",
      ],
      reabrir: ["Si el problema vuelve, Comunicación reabre el caso: inicia un ciclo nuevo y conserva todo el historial."],
      notas: NOTES.filter((n) => !n.startsWith("Nota interna")),
      sin_ia: WITHOUT_AI.slice(0, 1),
    },
  },
  {
    profile: "coordinador",
    title: "Coordinación de casos",
    who: "Administración o Comunicación. Asigna, da seguimiento, valida y reabre.",
    steps: [
      "Asigna el caso a la dependencia con responsable, compromiso y plazos (por defecto, los del SLA vigente).",
      "Vigila aceptaciones pendientes, vencidos y escalamientos en Casos.",
      "Valida lo resuelto: revisa evidencia y resultado; cierra o regresa a atención.",
      "Reabre si el problema persiste.",
    ],
    topics: {
      aceptar: [
        "Un caso devuelto vuelve a ti con el motivo: reasígnalo a otra dependencia o pásalo a revisión.",
        "Puedes reasignar un caso asignado o aceptado; queda registrado quién y por qué.",
      ],
      validar: [
        "Revisa que la evidencia muestre el trabajo y que el resultado responda al problema reportado.",
        "Validar y cerrar: escribe el resultado y confirma que revisaste la evidencia; el caso cuenta en «cierres validados».",
        "Devolver a la dependencia: escribe qué falta; el caso vuelve a «En atención» y el plazo sigue corriendo.",
      ],
      reabrir: [
        "Reabrir un caso cerrado pide motivo y, de preferencia, evidencia de que el problema persiste; crea un ciclo nuevo (los tiempos se miden por ciclo).",
        "El historial, las notas y la evidencia del ciclo anterior se conservan.",
      ],
      evidencia: ["Exige evidencia antes de validar; si no la hay, regrésalo a atención con la indicación."],
      notas: NOTES,
    },
  },
  {
    profile: "direccion",
    title: "Dirección y titulares",
    who: "Rol Consulta (o titular de dependencia). Lee indicadores y reportes; no modifica.",
    steps: [
      "Consulta el dashboard: conversación y percepción (menciones) y atención y cumplimiento (casos).",
      "Revisa los reportes aprobados y la sala de crisis cuando haya una emergencia.",
      "Como titular, recibes escalamientos de los casos vencidos de tu dependencia.",
    ],
    topics: {
      recibe: [
        "Indicadores con su definición (botón «i»), cobertura y fecha de corte.",
        "Reportes aprobados con cifras congeladas; escalamientos si eres titular.",
        "No ves notas internas ni puedes cambiar nada.",
      ],
      sin_ia: WITHOUT_AI,
    },
  },
  {
    profile: "administrador",
    title: "Administración del municipio",
    who: "Rol Administración. Configura el municipio y responde por los cambios sensibles.",
    steps: [
      "Revisa Configuración → Resumen: qué está configurado, quién puede cambiarlo y el último cambio.",
      "Completa la lista de puesta en operación antes de usar el sistema con datos reales.",
      "Mantén usuarios, responsables, SLA, canales, retención y límites de IA al día.",
      "Consulta la Bitácora: todo cambio de configuración queda con antes/después, persona y fecha.",
    ],
    topics: {
      recibe: ["Todo lo que recibe Comunicación, más la bitácora, los envíos y el consumo de IA."],
      validar: [
        "Un cambio de SLA crea una versión nueva: los casos ya asignados conservan sus plazos. Para aplicarla a casos abiertos usa «Reaplicar SLA» con motivo; queda auditado.",
      ],
      sin_ia: WITHOUT_AI,
    },
  },
];

/** Which guides each role sees first (the rest stay available below). */
export const GUIDES_FOR_ROLE: Record<Role, readonly Profile[]> = {
  admin: ["administrador", "coordinador"],
  comunicacion: ["analista", "coordinador"],
  dependencia: ["enlace"],
  lectura: ["direccion"],
};

export function guidesFor(role: Role): Guide[] {
  return GUIDES_FOR_ROLE[role].map((p) => GUIDES.find((g) => g.profile === p)!);
}

/** Topics of a page for a role, in order, from its guides (contextual help). */
export function topicsFor(role: Role, topics: readonly HelpTopic[]): { topic: HelpTopic; label: string; lines: string[] }[] {
  const guides = guidesFor(role);
  return topics
    .map((topic) => ({ topic, label: TOPIC_LABELS[topic], lines: [...new Set(guides.flatMap((g) => g.topics[topic] ?? []))] }))
    .filter((t) => t.lines.length > 0);
}

/** State dictionary of a case: what it means and who acts next. */
export const CASE_STATE_DICTIONARY: Record<CaseStatus, { meaning: string; next: string }> = {
  new: { meaning: "Se creó a partir de menciones; nadie lo ha revisado.", next: "Comunicación revisa, asigna o descarta." },
  in_review: { meaning: "Comunicación lo está revisando antes de asignarlo.", next: "Comunicación asigna o descarta." },
  assigned: { meaning: "Asignado a una dependencia con plazos; espera aceptación.", next: "El enlace acepta o devuelve." },
  accepted: { meaning: "La dependencia confirmó que lo atiende.", next: "El enlace inicia la atención." },
  in_progress: { meaning: "La dependencia lo está atendiendo.", next: "El enlace registra avances y lo marca resuelto." },
  resolved: { meaning: "La dependencia reporta que terminó; falta validar.", next: "Coordinación valida: cierra o regresa a atención." },
  closed: { meaning: "Validado y terminado.", next: "Sólo se reabre con motivo si el problema vuelve." },
  returned: { meaning: "La dependencia lo devolvió con motivo.", next: "Coordinación reasigna o revisa." },
  discarded: { meaning: "No requiere atención (duplicado, fuera de competencia, sin sustento).", next: "Puede volver a revisión con motivo." },
  merged: { meaning: "Se unió a otro caso del mismo problema.", next: "Se trabaja en el caso principal." },
};

export const CASE_STATES = CASE_STATUSES.map((s) => ({ status: s, label: CASE_STATUS_LABELS[s], ...CASE_STATE_DICTIONARY[s] }));

/** Short procedures shown in /ayuda (the manual has the full version). */
export const PROCEDURES: readonly { key: string; title: string; steps: string[] }[] = [
  {
    key: "captura",
    title: "Falla de captura (una fuente deja de traer menciones)",
    steps: [
      "Salud del monitoreo marca la fuente como atrasada o fallando y genera alerta.",
      "Comunicación revisa el error en Salud; si es de credenciales o permisos, avisa a Administración.",
      "Usa «Reintentar» una vez; si sigue fallando, pausa la fuente y regístralo en la nota del día.",
      "Al restablecerse, la captura retoma desde donde se quedó; los huecos que el proveedor ya no entrega se informan como tales.",
    ],
  },
  {
    key: "seguridad",
    title: "Incidente de seguridad (acceso indebido, cuenta comprometida, fuga)",
    steps: [
      "Administración quita de inmediato el acceso de la cuenta afectada (Configuración → Usuarios) y avisa al área de TI del municipio.",
      "Revisa la Bitácora (exportable) para saber qué se consultó o cambió y desde cuándo.",
      "Rota las credenciales del proveedor afectado en el panel del proveedor, nunca por correo ni chat.",
      "Documenta fecha, alcance y acciones; si hubo datos personales, sigue el procedimiento de protección de datos del municipio.",
    ],
  },
  {
    key: "ia",
    title: "Proveedor de IA no disponible",
    steps: [...WITHOUT_AI, "Si el corte se debe a un límite de presupuesto o cuota, Administración lo ajusta en Consumo de IA (queda auditado)."],
  },
];
