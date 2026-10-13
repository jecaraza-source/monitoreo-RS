# Manual operativo — Sigma Pulso

Manual breve para operar el sistema en un municipio. La misma información, por rol, está en la aplicación en **Ayuda**
y en el botón **Ayuda** de Casos y del detalle de un caso. Este manual no contiene llaves ni contraseñas: las
credenciales se administran sólo en los paneles de los proveedores y en las variables del despliegue.

## 1. Roles y qué recibe cada uno

| Perfil | Rol en el sistema | Qué recibe | Qué no ve |
|---|---|---|---|
| **Administración** | admin | Todo, más configuración, bitácora, envíos, consumo de IA, retención y conciliación | — |
| **Analista** | comunicacion | Menciones públicas clasificadas (tema, colonia, dependencia, prioridad), alertas, dashboard, reportes; coordina casos | Bitácora, usuarios, retención |
| **Coordinación** | admin o comunicacion | Casos: asigna, da seguimiento, valida, devuelve, cierra y reabre | — |
| **Enlace de dependencia** | dependencia | Sólo los casos asignados a su dependencia, con plazos, tareas, menciones y notas compartidas; avisos por correo/WhatsApp | Notas internas, otras dependencias, dashboard municipal |
| **Dirección / titulares** | lectura (titular: dependencia o lectura con `head_user_id`) | Dashboard, reportes aprobados, sala de crisis; los titulares reciben escalamientos | No modifica nada; no ve notas internas |

Sólo se nombran medios y figuras públicas **verificados**. Cualquier otra cuenta aparece como «Cuenta no verificada».
Nunca se registran datos personales de quien publicó.

## 2. Matriz de responsabilidades

R = realiza · A = aprueba o responde · C = se le consulta · I = se le informa.

| Actividad | Administración | Comunicación | Enlace | Titular | Dirección |
|---|---|---|---|---|---|
| Configurar municipio (usuarios, catálogos, SLA, canales, retención, IA) | R/A | C | — | C | I |
| Verificar medios y figuras públicas | A | R | — | — | — |
| Revisar bandeja y corregir clasificación | C | R/A | — | — | — |
| Crear caso y asignar a dependencia | A | R | I | I | — |
| Aceptar o devolver un caso | I | I | R | A | — |
| Atender y registrar avances con evidencia | — | I | R | A | — |
| Validar y cerrar | A | R | I | I | I |
| Reabrir | A | R | I | I | — |
| Escalamiento por vencimiento | I | R | I | A | — |
| Aprobar y enviar reportes | A | R | — | — | I |
| Responder a falla de captura | A | R | — | — | I |
| Responder a incidente de seguridad | R/A | C | — | — | I |
| Conciliación y exportación autorizada | R/A | C | — | — | I |

(La misma matriz está en Ayuda; su fuente es `src/lib/help/raci.ts`.)

## 3. Diccionario de estados de un caso

| Estado | Significa | Sigue |
|---|---|---|
| Detectado | Se creó a partir de menciones; nadie lo ha revisado. | Comunicación revisa, asigna o descarta. |
| En revisión | Comunicación lo revisa antes de asignarlo. | Comunicación asigna o descarta. |
| Asignado | Asignado a una dependencia con plazos; espera aceptación. | El enlace acepta o devuelve. |
| Aceptado | La dependencia confirmó que lo atiende. | El enlace inicia la atención. |
| En atención | La dependencia lo está atendiendo. | El enlace registra avances y solicita validación. |
| Pendiente de validación | La dependencia reporta que terminó. | Coordinación valida: cierra o devuelve a atención. |
| Cerrado | Validado y terminado, con resultado. | Sólo se reabre con motivo. |
| Devuelto | La dependencia lo devolvió con motivo. | Coordinación reasigna o revisa. |
| Descartado | No requiere atención (duplicado, fuera de competencia). | Puede volver a revisión con motivo. |
| Fusionado | Se unió a otro caso del mismo problema. | Se trabaja en el caso principal. |

Otros estados:

- **Mención en bandeja:** Nueva, Revisada, Turnada, Descartada, más «Sin clasificar» mientras la IA no la procesa.
- **Turno (ticket) dentro de un caso:** Abierto, En atención, Resuelto, Cerrado.

## 4. Atención de un caso, paso a paso

1. **Asignar** (Coordinación).
   - Elige la dependencia responsable, opcionalmente las de apoyo, la persona responsable y el compromiso.
   - Los plazos de aceptación y de atención salen del SLA vigente y se pueden ajustar.
2. **Aceptar o devolver** (enlace), antes del plazo de aceptación.
   - Para devolver se escribe el motivo (no es de su competencia, falta información, ya está atendido).
3. **Atender.**
   - «Iniciar atención».
   - Registrar avances con evidencia: fotos o PDF del trabajo, sin rostros, placas ni datos de terceros visibles.
   - Completar las tareas asignadas a su área.
4. **Solicitar validación** (enlace). El caso pasa a «Pendiente de validación».
5. **Validar** (Coordinación).
   - Revisar la evidencia.
   - Cerrar con el resultado, confirmando que la evidencia es suficiente.
   - O devolver a atención con el motivo; el plazo sigue corriendo.
6. **Reabrir** (Coordinación), si el problema vuelve.
   - Pide motivo y, de preferencia, evidencia.
   - Crea un ciclo nuevo y conserva todo el historial.

**Notas:**

- La **interna** sólo la ven Administración y Comunicación.
- La **compartida** la ve también la dependencia.
- Ninguna se edita ni se borra.

## 5. Configuración del municipio

Configuración → **Resumen** muestra:

- cada elemento configurable;
- quién puede cambiarlo;
- su último cambio (fecha y persona).

Toda modificación queda en la **Bitácora** con el valor anterior y el nuevo.

| Elemento | Dónde | Quién lo cambia |
|---|---|---|
| Usuarios y roles | Configuración → Usuarios | Administración |
| Dependencias, colonias, categorías de caso y capacidades | Configuración → Catálogos | Administración |
| Responsables (enlace y titular), SLA, horarios, días inhábiles, escalamiento | Configuración → SLA y escalamiento | Administración |
| WhatsApp, emergencias | Configuración → WhatsApp / Emergencias | Administración |
| Proyectos, consultas y fuentes | Configuración → Proyectos / Fuentes | Administración y Comunicación |
| Verificación de autores | Configuración → Autores verificados | Administración y Comunicación |
| Umbrales de salud | Salud | Administración y Comunicación |
| Límites y presupuesto de IA | Configuración → Consumo de IA | Administración |
| Retención y conservaciones | Configuración → Retención y conciliación | Administración |

**SLA:**

- Guardar el SLA crea una versión nueva; los casos ya asignados **conservan** sus plazos.
- Para aplicar la versión vigente a casos abiertos se usa **Reaplicar SLA** en la misma página:
  1. vista previa;
  2. selección de casos;
  3. motivo obligatorio.
- Cada cambio queda en el historial del caso y en la bitácora.
- Los plazos que se fijaron a mano no se tocan salvo que se elijan expresamente.

## 6. Retención, conservación y conciliación

**Plazo de retención:**

- Lo fija **un acuerdo del municipio** (acta, oficio), que se registra con su referencia y fecha. El sistema no
  supone ningún plazo legal.
- Sin política propia se usa el valor del despliegue, que no es un plazo legal; está marcado así en la pantalla.
- **Nunca se eliminan:**
  - las menciones que forman parte de un caso;
  - las cubiertas por una **conservación** activa (solicitud de información, procedimiento, auditoría).

**Conservaciones:** no se editan ni se borran; se liberan con motivo.

**Revisión antes de eliminar:**

1. La vista previa muestra cuántas menciones se eliminarían y cuántas se conservan, y por qué.
2. Se registra o cambia la política, que queda auditada.
3. La depuración diaria deja en la bitácora cuántas eliminó y con qué base.
4. Si algo debe revisarse, se marca «Pausar la depuración».

**Exportación para conciliación** (CSV, máximo un año por archivo):

- casos con sus compromisos (Administración y Comunicación);
- llamadas a la IA (el costo desconocido sale vacío, nunca 0);
- la bitácora (Administración).

Cada descarga queda registrada (quién, qué, periodo, filas). No se exportan autores ni datos de ciudadanos.

## 7. Procedimientos

### 7.1 Falla de captura (una fuente deja de traer menciones)

1. Salud marca la fuente como atrasada o fallando y genera alerta.
2. Comunicación revisa el error en Salud.
   - Si es de credenciales o permisos, avisa a Administración.
   - Administración renueva la credencial en el panel del proveedor y la vuelve a capturar en la fuente.
3. «Reintentar» una vez; si sigue fallando, pausar la fuente y anotarlo.
4. Al restablecerse, la captura retoma desde donde quedó. Los periodos que el proveedor ya no entrega se informan
   como huecos de cobertura en el dashboard y en los reportes.

### 7.2 Incidente de seguridad (acceso indebido, cuenta comprometida, fuga)

1. Administración quita de inmediato el acceso de la cuenta afectada (Configuración → Usuarios) y avisa a TI del
   municipio.
2. Exporta la bitácora del periodo para saber qué se consultó o cambió.
3. Rota las credenciales afectadas en el panel del proveedor (nunca por correo ni chat) y actualiza las variables
   del despliegue.
4. Documenta fecha, alcance y acciones. Si hubo datos personales, sigue el procedimiento de protección de datos
   del municipio.

### 7.3 Proveedor de IA no disponible (o límite de presupuesto alcanzado)

- **Siguen funcionando:**
  - bandeja y turnado manual;
  - casos, tareas, evidencias, validación y reapertura;
  - SLA y escalamiento;
  - mapa;
  - avisos por correo y WhatsApp;
  - exportaciones.
- **Esperan revisión o el regreso de la IA:**
  - clasificación automática (las menciones quedan «Sin clasificar»);
  - lectura del día;
  - redacción de reportes;
  - asistente.
- **Mientras tanto:** Comunicación revisa a mano lo urgente con el estado «Sin clasificar» y turna lo necesario.
  Al volver la IA, lo pendiente se clasifica una sola vez.
- **Si la causa es un límite** de cuota o presupuesto: Administración lo revisa en Consumo de IA. Ajustarlo queda
  auditado; el mensaje en pantalla dice qué límite se alcanzó.

## 8. Puesta en operación

Ver [`docs/onboarding.md`](onboarding.md) y el ejercicio por rol en
[`docs/ejercicio-operativo.md`](ejercicio-operativo.md). Configuración → Resumen muestra la lista con su avance.
