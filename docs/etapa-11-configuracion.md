# Etapa 11 — Configuración por municipio, ayuda por rol, manuales, retención y puesta en operación

Base: `9ad3389` (etapa 10 integrada). Migración `20261104000000_org_config.sql`.

## 1. Qué ya estaba resuelto y se conserva

- **Configuración por municipio** (cada tabla con `org_id` y RLS):
  - usuarios y roles;
  - dependencias y colonias;
  - responsables (enlace `responsible_user_id` y titular `head_user_id`);
  - SLA con calendario, días inhábiles y versiones;
  - escalamiento y silencio (`notification_settings`);
  - WhatsApp y emergencias;
  - fuentes y proyectos;
  - autores verificados (etapa 10);
  - umbrales de salud (`monitor_settings`);
  - límites de IA.
- **Bitácora** (`audit_log`) con antes/después, actor y fecha para usuarios, catálogos, proyectos, consultas,
  fuentes, reportes, organización, SLA (versiones y políticas), WhatsApp, emergencias, escalamiento y umbrales.
- **SLA no retroactivo:** guardar crea una versión y cada caso guarda la versión y los plazos con que se asignó
  (etapa 7).
- **Notas separadas:** internas (sólo Administración y Comunicación) y compartidas con la dependencia (etapa 4).
- **Acceso por rol:** el menú se filtra por rol y cada página vuelve a verificarlo en el servidor.

Todo eso sigue igual. Cambia lo siguiente.

## 2. Qué se agregó o corrigió

| Tema | Antes | Ahora |
|---|---|---|
| Categorías y capacidades | Categoría de caso en texto libre; nada decía qué dependencia podía atender qué | Catálogo `case_categories` con dependencia sugerida y `department_capabilities`; backfill desde SLA y casos existentes |
| Auditoría | Calendario, días inhábiles y metas del SLA, límites y facturas de IA sin auditoría por tabla | Triggers de auditoría en esas tablas, en los catálogos nuevos, en la retención y en la puesta en operación |
| Quién edita qué | Implícito en cada página | Registro `src/lib/settings/registry.ts` y Configuración → **Resumen** con quién edita y el último cambio (persona y fecha); una prueba lo contrasta con el menú |
| Aplicar un SLA nuevo a casos abiertos | No había forma, salvo editar caso por caso | **Reaplicar SLA**: vista previa, selección y motivo obligatorio. Cada caso registra el antes/después en su historial y en la bitácora; los plazos fijados a mano no se tocan salvo elección expresa |
| Retención | Un valor global (24 meses) y la depuración borraba también menciones que estaban en un caso | Política por municipio con referencia al acuerdo (sin plazo legal supuesto), conservaciones (holds) que bloquean la eliminación, vista previa y pausa. La depuración nunca borra menciones en casos ni conservadas, y registra su base |
| Exportación | Sólo CSV de dependencias en el dashboard | `/api/exportar`: casos, consumo de IA y bitácora; máximo un año; por rol; cada descarga queda en la bitácora; CSV a prueba de fórmulas |
| Ayuda | No había | Ayuda por perfil (analista, enlace, coordinación, dirección, administración): qué recibe, aceptar/devolver, evidencia, validar, reabrir, notas, operación sin IA. Botón «Ayuda» en Casos y en el detalle del caso. Diccionario de estados, matriz de responsabilidades y procedimientos en `/ayuda` |
| Manuales | No había | `docs/manual-operativo.md`, `docs/onboarding.md`, `docs/ejercicio-operativo.md` |
| Puesta en operación | No había | Lista en Resumen: revisiones automáticas (catálogos, responsables, usuarios por rol, fuentes que leen, autores, SLA aprobado, retención, IA) y pruebas por rol registradas a mano con resultado (auditadas) |
| Menú | Configuración abajo | Configuración y Ayuda abajo. Prueba e2e: cada entrada del menú de cada rol abre, y cada subsección ajena redirige; prueba unitaria: toda página de `(app)` verifica sesión y sección en el servidor |

## 3. Quién puede editar cada elemento

| Elemento | Página | Edita | Tablas auditadas |
|---|---|---|---|
| Usuarios, roles y permisos | Configuración → Usuarios | admin | memberships |
| Dependencias y colonias | Catálogos | admin | departments, neighborhoods |
| Categorías de caso y capacidades | Catálogos | admin | case_categories, department_capabilities |
| Responsables (enlaces y titulares) | SLA y escalamiento | admin | departments |
| SLA, horarios y días inhábiles | SLA y escalamiento | admin | sla_versions, sla_calendars, sla_holidays, sla_targets, cases (reaplicación) |
| Escalamiento y canales | SLA y escalamiento / WhatsApp | admin | notification_settings, whatsapp_settings, whatsapp_contacts |
| Emergencias | Emergencias | admin | incident_policies |
| Proyectos, consultas y fuentes | Proyectos / Fuentes | admin, comunicacion | projects, queries, sources |
| Verificación de autores | Autores verificados | admin, comunicacion | verified_authors |
| Umbrales de salud | Salud | admin, comunicacion | monitor_settings |
| Límites y presupuesto de IA | Consumo de IA | admin | ai_limits, ai_invoices |
| Retención y conservación | Retención y conciliación | admin | retention_policies, retention_holds |
| Identidad | Identidad | admin | organizations |

Lo hace cumplir la base de datos (RLS y RPC); la tabla de la app es la misma (`registry.test.ts`).

## 4. Qué funciona sin IA

- **Siguen funcionando:**
  - bandeja y turnado manual;
  - casos, tareas, evidencias, validación y reapertura;
  - SLA y escalamiento;
  - mapa;
  - avisos;
  - exportaciones.
- **Esperan:**
  - clasificación (las menciones quedan «Sin clasificar» y se procesan una vez al volver);
  - lectura del día;
  - redacción de reportes;
  - asistente.

Procedimiento completo: `docs/manual-operativo.md` § 7.3.

## 5. Archivos

- **Migración y reversión:**
  - `supabase/migrations/20261104000000_org_config.sql`;
  - `docs/rollback/20261104000000_org_config.down.sql`.
- **Configuración:**
  - `src/lib/settings/{registry,onboarding,data,actions}.ts`;
  - `src/components/settings/onboarding-checklist.tsx`;
  - `src/app/(app)/configuracion/municipio/page.tsx`.
- **Categorías:** `src/lib/catalogs/categories.ts`, `src/components/catalogs/categories-catalog.tsx` y la página
  de Catálogos.
- **SLA:** `src/lib/sla/{actions,data}.ts` (reaplicar), `src/components/sla/sla-reapply.tsx` y la página de SLA.
- **Retención y exportación:**
  - `src/lib/retention/{model,actions,data}.ts`;
  - `src/components/retention/retention-forms.tsx`;
  - `src/app/(app)/configuracion/retencion/page.tsx`;
  - `src/app/api/exportar/route.ts`;
  - `src/app/api/cron/retention/route.ts` (política por municipio).
- **Ayuda:**
  - `src/lib/help/{content,raci}.ts`, `src/components/help/help-sheet.tsx`, `src/app/(app)/ayuda/page.tsx`;
  - botón en `casos/page.tsx` y `casos/[id]/page.tsx`.
- **Menú:** `src/lib/auth/roles.ts` (Ayuda, Resumen, Retención y conciliación), `app-sidebar.tsx`, `nav-icons.ts`.
- **Seed:** categorías y capacidades ficticias.
- **Pruebas:**
  - unitarias: `src/lib/help/content.test.ts`, `src/lib/settings/{registry,onboarding}.test.ts`,
    `src/lib/retention/model.test.ts`, `roles.test.ts`;
  - pgTAP: `supabase/tests/database/org_config.test.sql` (38) y ajuste de `rls_matrix`;
  - e2e: `e2e/org-config.spec.ts` (7).
- **Documentos:** `docs/manual-operativo.md`, `docs/onboarding.md` y `docs/ejercicio-operativo.md`.

## 6. Consulta previa (sólo lectura, 13 oct 2026)

| Instancia | Municipios | Casos | Categorías que creará el backfill | Menciones de más de 24 meses |
|---|---|---|---|---|
| Producción | 1 | 1 | 1 | 0 |
| Preview | 1 | 3 | 0 | 0 |

Ninguna instancia tiene hoy menciones que la depuración vaya a eliminar.

## 7. Limitaciones

- **Ayuda y manuales:** están en el código y en `docs/`; cambiarlos requiere un commit.
- **Conciliación:** la exportación es por CSV con tope de 50 000 filas y un año por archivo.
- **Retención:**
  - sin política propia, el municipio sigue con el valor del despliegue (24 meses por omisión), marcado en
    pantalla como no legal;
  - la purga de mensajes de WhatsApp sigue usando ese valor global.
- **Reaplicar SLA:** calcula desde la asignación original. No reabre casos ni toca los cerrados.
- **Municipios:** no se pueden eliminar desde la app (las tablas auditadas lo impiden); no es parte de esta etapa.

## 8. Activación y reversión

- **Activación:**
  1. Correr el SQL en preview y después en producción.
  2. Desplegar.
  3. Administración revisa Configuración → Resumen, registra la política de retención con el acuerdo del
     municipio y completa la lista de puesta en operación.
- **Reversión:**
  1. Desplegar la versión anterior.
  2. Correr `docs/rollback/20261104000000_org_config.down.sql`.
  3. Se pierden las categorías, la política, las conservaciones y la lista; quedan sus registros en la bitácora.
