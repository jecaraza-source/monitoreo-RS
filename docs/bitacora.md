# Bitácora técnica de implementación

Una entrada por etapa del prompt maestro, de la más reciente a la más antigua. El detalle de cada etapa vive en
su propio documento de `docs/`.

## Radar Social: herramientas de verificación (27 oct 2026, base `9bab03e`)

- **Migración `20261110000000_radar_checks.sql`:**
  - `ci_settings`: dominios oficiales y términos a vigilar por municipio, normalizados y validados;
  - `ci_checks`: registro de cada consulta (servicio, indicador, resultado, quién y cuándo). Sólo se agregan
    registros; no se editan ni se borran.
  - El acceso es el mismo de Radar Social: el permiso para leer; además Administración o Comunicación para consultar.
- **Servicios** (`src/lib/counterintel/providers.ts`):
  - reputación de dominios y URLs de los indicadores: URLhaus (`ABUSECH_AUTH_KEY`), PhishStats (abierto) y Google
    Safe Browsing (`GOOGLE_SAFE_BROWSING_API_KEY`);
  - dominios parecidos: certificados públicos de crt.sh con un término vigilado, sin los dominios oficiales ni sus
    subdominios;
  - verificaciones publicadas: Google Fact Check (`GOOGLE_FACTCHECK_API_KEY`);
  - notas en medios de los últimos 7 días: GDELT (abierto).
  - Sólo varía la consulta; los hosts son fijos. Cada llamada tiene tiempo y tamaño máximos.
  - Sin llave, el servicio aparece «sin configurar».
  - Límite: 10 consultas por minuto por persona.
- **Límites:** se consultan indicadores (dominios, URLs, afirmaciones, temas), no personas; la página lo indica.
- **Pruebas:**
  - pgTAP 987/987, con `radar_checks` (16);
  - 437 unitarias, con los proveedores (9);
  - e2e `radar-tools.spec.ts` con el simulador (no corre contra preview, que llamaría a los servicios reales);
  - batería completa: 73 pasan, 11 omitidas.
- **Activación:**
  - SQL en preview y producción, luego deploy;
  - las llaves opcionales se configuran en Vercel;
  - en Radar Social, guardar los dominios oficiales y los términos.
- **Revertir:** el despliegue anterior y `docs/rollback/20261110000000_radar_checks.down.sql`.

## Radar Social (27 oct 2026, base `47cc67a`)

- «Oficina de Contrainteligencia» se llama ahora **Radar Social**, para que quepa en el menú.
- Cambia en el menú, el título de la página, la columna de Configuración → Usuarios y los avisos.
- La dirección pasa de `/contrainteligencia` a `/radar-social`.
- Las tablas, funciones y permisos de la base no cambian (`ci_reports`, `ci_overview`, `can_view_counterintel`):
  sin SQL. Los permisos ya otorgados se conservan.
- Pruebas: tipos, lint, 428 unitarias; e2e de Radar Social, menú por rol, usuarios y funcionarios.

## Actualización de seguridad de dependencias (27 oct 2026, base `6f0a86f`)

- **Next.js 16.4.0 → 16.4.3** (y `eslint-config-next`). Corrige tres avisos:
  - [GHSA-2464-fhr4-w9xw](https://github.com/advisories/GHSA-2464-fhr4-w9xw): ejecución remota de código en la
    optimización de imágenes con SVG (crítico);
  - [GHSA-673q-mjm6-r5xr](https://github.com/advisories/GHSA-673q-mjm6-r5xr): ejecución remota de código en
    `use cache` con arreglos tipados (crítico);
  - [GHSA-p3m5-59mp-jv5r](https://github.com/advisories/GHSA-p3m5-59mp-jv5r): denegación de servicio con Server
    Actions (alto). Este sí aplica a la app, que usa Server Actions en casi todo.
- **`npm audit fix` sin `--force`** (sólo versiones menores dentro de los rangos):
  - `zod` 4.6.7: corrige agotamiento de memoria al validar colecciones grandes (alto); valida todas las Server
    Actions;
  - dependencias de `shadcn` (herramienta de desarrollo): `undici`, `body-parser`, `fast-uri` e `ip-address`.
- **Resultado:** `npm audit` reporta 0 vulnerabilidades. `next build` ya no muestra el aviso de seguridad.
- **Prueba ajustada:** `counterintel.spec.ts` busca el título del reporte dentro de la lista visible. Mientras la
  página se transmite, React deja por un momento una copia oculta, y la búsqueda en toda la página la encontraba.
- **Pruebas:** tipos, lint, 428 unitarias, pgTAP 971/971 y la batería e2e completa (72 pasan, 11 omitidas).
- **Sin SQL.** Revertir: el despliegue anterior.

## Oficina de Contrainteligencia (27 oct 2026, base `2aba4a3`)

- **Qué es:** sección restringida para seguir:
  - desinformación sobre el municipio;
  - cuentas o páginas que suplantan al ayuntamiento o a sus funcionarios;
  - bots coordinados;
  - amenazas a funcionarios o instalaciones.
- **Acceso** (migración `20261109000000_counterintel.sql`):
  - permiso explícito por usuario (`memberships.can_view_counterintel`), que se da en Configuración → Usuarios;
  - **también Administración lo necesita**: la oficina se limita a los funcionarios autorizados;
  - Consulta lee; Administración y Comunicación registran;
  - una dependencia nunca puede recibirlo;
  - cada consulta queda en la bitácora (`view`, `counterintel`).
- **Registro de la oficina** (`ci_reports`):
  - campos: tipo, gravedad, indicadores (URLs, dominios, etiquetas, nombres de página) y menciones de evidencia del
    mismo municipio;
  - estados: abierto, en seguimiento y cerrado con nota;
  - sin borrado; todo cambio queda auditado.
- **Pistas** (`ci_overview`):
  - menciones que contienen un indicador de un reporte abierto o en seguimiento;
  - posibles amenazas: gravedad alta o emergencia sobre violencia o seguridad pública;
  - nunca se nombra a ciudadanos; sólo a medios y figuras públicas.
- **Decisión de diseño:** desde la etapa 10, las cuentas no verificadas se guardan con seudónimo. Por eso la
  suplantación se sigue por contenido, no por el nombre de la cuenta. No se debilitó esa protección.
- **Límites (CLAUDE.md):**
  - no se registran ni se siguen ciudadanos, periodistas u opositores por sus opiniones;
  - la página lo dice;
  - los tipos de reporte son sólo los cuatro de la oficina.
- **Pruebas:**
  - pgTAP 971/971, con `counterintel` (27);
  - 428 unitarias;
  - e2e `counterintel.spec.ts` (3) y la batería completa: 72 pasan, 11 omitidas;
  - reversión y doble aplicación.
- **Pendiente:** al compilar, Next.js 16.4.0 avisó de una vulnerabilidad conocida y recomienda actualizar. No se
  actualizó en este cambio.
- **Activación / reversión:**
  - activar: SQL en preview y producción, deploy y dar el permiso en Usuarios;
  - revertir: el despliegue anterior y `docs/rollback/20261109000000_counterintel.down.sql`.

## Ajustes posteriores a la etapa 12 (13 oct 2026, base `c8463a9`)

- **Fuentes:** la lista de Configuración → Fuentes muestra primero la más reciente (PR #36).
- **Borrar proyectos** (migración `20261106000000_project_delete.sql`):
  - sólo Administración, también en la base: la política de borrado deja de incluir a comunicación, que sigue
    creando y editando;
  - función `delete_project`:
    - no borra el último proyecto del municipio;
    - conserva las menciones (pierden su consulta);
    - queda en la bitácora con quién lo hizo;
  - botón con confirmación escribiendo el nombre, visible sólo para Administración.
- **Logotipo hasta 5 MB** (migración `20261107000000_logo_5mb.sql`):
  - Vercel limita a 4.5 MB el cuerpo de una petición, así que el navegador sube directo a Storage con una URL
    firmada de un solo uso que sólo Administración obtiene;
  - después el servidor descarga la imagen y la valida como antes (formato real, dimensiones, peso) y, si no
    pasa, la borra;
  - el bucket también limita a 5 MB y PNG/JPEG.
- **Carrera en `transition_case`** (migración `20261108000000_transition_case_lock.sql`):
  - la función leía el estado del caso antes de bloquear la fila;
  - con dos cambios simultáneos (aceptar y devolver), el historial registraba un estado de origen viejo;
  - ahora bloquea la fila en la primera lectura;
  - lo detectó en CI `resilience.spec.ts` («actualización concurrente»): se reprodujo en local y, con el
    arreglo, pasó 20 de 20 repeticiones.
- **Pruebas:**
  - pgTAP 944/944, con `project_delete` (15);
  - 423 unitarias;
  - e2e nuevas en `admin-changes.spec.ts`: borrar proyecto por rol y logotipo de ~3 MB; además reportes y
    configuración;
  - reversión y doble aplicación de ambas migraciones;
  - e2e de casos, atención, entregas, WhatsApp y resiliencia en verde después del arreglo del bloqueo.
- **Limitación:** un logotipo grande aumenta el tamaño de cada PDF de reporte (se incrusta una vez por documento).
- **Activación / reversión:**
  - activar: SQL en preview y producción, luego deploy;
  - revertir: el despliegue anterior y los `down.sql` de `docs/rollback/`.

## Etapa 12 — Validación integral, piloto y decisión listo/no listo (13 oct 2026, base `776bb2b`)

- **Antes:**
  - Sin e2e del recorrido completo ni del enlace mágico real.
  - Permisos probados por SQL y por menú, no por llamada directa.
  - Fallas inyectadas sólo para concurrencia y correo.
  - Sin mediciones con volumen ni evaluación de IA separada del desarrollo.
  - CI en Node 22.
- **Después:**
  - E2E nuevas:
    - recorrido de la fuente al PDF con 4 roles y 2 municipios;
    - permisos por API, RPC y Storage;
    - 6 escenarios de falla con conciliación de contadores;
    - accesibilidad.
  - Mediciones con 107 000 menciones.
  - Holdout de IA de 48 casos con métricas, umbrales y hoja de validación humana.
  - Documentos de activación y del piloto, y SQL de métricas de sólo lectura.
  - CI en Node 24.
- **Hallazgos corregidos:**
  - **la bandeja no cargaba con ~100 000 menciones** (políticas RLS por fila: 9.9 s y 23 s frente a un límite de
    8 s). La migración `20261105000000_rls_scale.sql` las deja en 50 ms y 1.7 s, con visibilidad idéntica probada;
  - 7 combinaciones de texto bajo AA;
  - no había «Saltar al contenido»;
  - la 404 estaba en inglés.
- **Archivos:** ver `docs/etapa-12-validacion.md` § 7.
- **Pruebas** (Node 24):
  - lint, typecheck y 423 unitarias;
  - pgTAP 929/929 tras `db reset`;
  - reversión y doble aplicación;
  - build canario + `check:bundle` (254 archivos);
  - e2e: 67 pasaron y 11 omitidas (mediciones manuales);
  - mediciones 8/8;
  - respaldo y restauración local con conteos idénticos.
- **Consulta previa (sólo lectura):**
  - producción: 823 menciones, 1 caso, 3 usuarios, 7/7 fuentes leyendo, 23 errores de ingesta en 7 días
    (Reddit 429);
  - preview: 273 menciones, 3 casos;
  - ambas con las políticas anteriores.
- **Limitaciones:**
  - evaluación de IA real y validación humana pendientes (sin llave en este entorno);
  - lectura de fuentes reales sólo verificable en producción;
  - mediciones en hardware local compartido;
  - sin lector de pantalla real.
- **Revisión senior (tras el merge `98473c8`):**
  - el recorrido no cubría consulta ni la administración del municipio A, aunque el informe decía «cuatro
    roles»: corregido;
  - tres pruebas fallaban en el preview (redirección tardía, barra de Vercel, token de un solo uso): corregidas
    en `d58e545`;
  - pendiente: otras tablas que crecen con el volumen conservan RLS por fila (sin falla medida).
  - Detalle en `docs/etapa-12-validacion.md` § 11.
- **Decisión:** **no listo** para operación general; piloto controlado cuando se cumplan las 6 condiciones de
  `docs/etapa-12-validacion.md` § 10.
- **Activación / reversión:** `docs/etapa-12-activacion.md` (migración en preview → CI → producción → despliegue;
  reversión con el despliegue anterior y `down.sql`).

## Etapa 11 — Configuración por municipio, ayuda por rol, manuales, retención y puesta en operación (13 oct 2026, base `9ad3389`)

- **Antes:**
  - La configuración estaba repartida en varias páginas sin decir quién podía editar cada cosa.
  - Calendario, días inhábiles y metas del SLA, y límites y facturas de IA, se cambiaban sin auditoría por tabla.
  - No había forma auditada de aplicar un SLA nuevo a casos abiertos.
  - La retención era global (24 meses) y borraba menciones de casos.
  - No había ayuda en la app, manuales, exportación para conciliación ni lista de puesta en operación.
- **Después:**
  - Catálogo de categorías de caso con capacidades por dependencia.
  - Auditoría de toda la configuración sensible con antes/después, actor y fecha.
  - Configuración → Resumen: quién edita cada elemento y su último cambio.
  - «Reaplicar SLA» explícito, con vista previa, motivo y registro por caso.
  - Retención por municipio:
    - con el acuerdo que la respalda;
    - con conservaciones que la bloquean;
    - con vista previa y pausa;
    - nunca borra menciones de casos.
  - Exportación autorizada de casos, consumo de IA y bitácora, cada descarga auditada.
  - Ayuda por rol en `/ayuda` y en Casos.
  - Manual operativo, onboarding y ejercicio por rol.
  - Menú con Ayuda.
- **Archivos:** ver `docs/etapa-11-configuracion.md` § 5. Migración `20261104000000_org_config.sql` y su `down.sql`.
- **Pruebas:**
  - lint, typecheck y 415 unitarias, incluida una que verifica que toda página revisa la sesión y su sección;
  - pgTAP 890/890 tras `db reset`, con `org_config` (38);
  - reversión y reaplicación;
  - build canario + `check:bundle` (253 archivos);
  - e2e 50 en verde y 3 omitidas (las mismas que en main):
    - menú por cada rol: cada entrada abre y cada subsección ajena redirige;
    - administración configura con auditoría;
    - el enlace completa la atención con la ayuda.
- **Hallazgos corregidos antes de entregar:**
  - la purga anterior borraba menciones que pertenecían a un caso (ahora se conservan);
  - el texto de ayuda no coincidía con el flujo real («Solicitar validación»);
  - una etiqueta «Nombre» chocaba con el catálogo de funcionarios en la misma página;
  - durante el cierre de la etapa 10, la prueba de concurrencia dependía del municipio B, que no existe en
    preview (corregida en `e4a41ba`).
- **Consulta previa (sólo lectura):**
  - producción: 1 caso, 1 categoría que se creará con el backfill;
  - preview: 3 casos, 0 categorías;
  - ninguna instancia tiene menciones de más de 24 meses.
- **Limitaciones:** ayuda y manuales en código; CSV hasta 50 000 filas por archivo; la purga de WhatsApp sigue
  global; los municipios no se pueden eliminar desde la app.
- **Activación / reversión:**
  - activar: migración en preview y producción, deploy, y luego política de retención y lista en Resumen;
  - revertir: deploy anterior y `down.sql`.
- **Pendiente:** Node 22/24; asistente con casos; retención configurable de mensajes de WhatsApp.

## Etapa 10 — Cuotas y presupuesto de IA, costos versionados, asistente cancelable y autores verificados (13 oct 2026, base `27137bd`)

- **Antes:**
  - Sólo había un límite por minuto en el asistente; nada impedía que peticiones simultáneas rebasaran un tope.
  - Un modelo sin tarifa costaba 0.
  - El asistente perdía lo consumido si una ronda posterior fallaba, y cerrar el chat no detenía al proveedor.
  - La lectura del día se coordinaba sólo en memoria.
  - Todo canal de una búsqueda de YouTube era «medio», y de los ciudadanos se guardaban usuario, nombre y
    seguidores.
- **Después:**
  - **Reservas** (`reserve_ai`, `settle_ai`, `release_ai`), serializadas por organización:
    - concurrencia por propósito;
    - solicitudes por persona y día;
    - presupuesto diario y mensual en US$ y tokens por día;
    - mensajes en español.
  - **Costo desconocido** separado del conocido (`ai_calls.cost_usd` null, `ai_usage.unpriced_*`).
  - **Tarifas versionadas** con normalización de identificadores; panel de consumo con aviso de tarifa no
    configurada y conciliación con la factura.
  - **Asistente:** cancelación y tope de tiempo llegan al SDK; cada ronda se concilia al terminar.
  - **Lectura del día:** lease persistido en `ai_leases`.
  - **Catálogo de autores verificados** con evidencia y responsable.
  - **Cuentas no verificadas:** seudónimo sin identidad; constraints que impiden etiquetarlas como medio.
  - **Política aplicada** a rankings, prompts, bandeja, casos y filtro por autor.
- **Archivos:** ver `docs/etapa-10-ia-autores.md` § 8. Migración `20261103000000_ai_governance.sql` y su `down.sql`.
- **Pruebas:**
  - lint, typecheck y 399 unitarias;
  - pgTAP 852/852 tras `db reset`, incluidos `ai_governance` (41) y `verified_authors` (32);
  - backfill probado sobre el seed anterior;
  - reversión y reaplicación;
  - build canario + `check:bundle`;
  - e2e 43 en verde y 3 omitidas (las mismas que en main): 25 reservas simultáneas no rebasan la concurrencia ni el presupuesto; panel; catálogo; bandeja.
- **Hallazgos corregidos antes de entregar:**
  - un check que llamaba a `private.*` fallaba para `service_role`; se dejó en línea;
  - `map_cases.test.sql` y una e2e de WhatsApp dependían del azar del seed.
- **Conteo previo (sólo lectura):** producción y preview tienen 3 medios o figuras de demostración sin fuente
  configurada (X y YouTube) que pasan a seudónimo; se recuperan dándolos de alta en el catálogo con la misma
  cuenta. No hay filas de `ai_usage` con costo 0.
- **Limitaciones:** las tarifas viven en código; la estimación es un techo alto; una llamada cancelada antes de
  iniciar no deja consumo y lo cubre la conciliación mensual; los seudónimos no son reversibles.
- **Activación / reversión:**
  - activar: migración en preview y producción, luego deploy, y opcionalmente límites y catálogo;
  - revertir: deploy anterior y `down.sql`.
- **Pendiente:** Node 22/24; asistente con casos; tarifas configurables sin commit si se requiere.

## Etapa 9 — Indicadores de conversación y atención, reportes con instantánea y versiones (13 oct 2026, base `f1a8a15`)

- **Antes:**
  - La atención se medía en turnos (una mención turnada = un «caso»).
  - El reporte mezclaba el agregado horario con tablas en vivo.
  - Los periodos de 7 y 30 días eran ventanas de horas.
  - No había diccionario de indicadores, cobertura ni fecha de corte.
  - Se ordenaban dependencias con pocas menciones.
  - La narrativa no tenía apartados de decisión ni referencias, y no había versiones.
- **Después:**
  - **Dos familias con unidades distintas:** conversación en menciones; atención en casos y horas (nuevos,
    abiertos y vencidos al corte, primera atención y resolución con mediana/p90/n, cierres validados y
    reaperturas).
  - **Diccionario versionado** `KPI-2026.11` con fórmula, unidad, origen, periodo, denominador y
    tratamiento de reabiertos y datos faltantes, visible en cada tarjeta y en el reporte.
  - **Cobertura y comparabilidad:** barra con corte, última actualización, sin clasificar, sin colonia,
    fuentes parciales y notas de comparabilidad.
  - **Periodos:** días de CDMX, con el periodo anterior cortado en el mismo punto.
  - **Reportes desde `report_snapshot`:** una sola instantánea, cifras escritas sólo por el servidor.
  - **Narrativa estructurada:** Qué cambió, decisión, quién actúa y pendientes, con referencias autorizadas,
    validada en el modelo, el editor y la aprobación.
  - **Versiones:** la aprobada queda congelada; «Crear revisión» genera la versión + 1 y «Actualizar cifras»
    recalcula un borrador.
  - **Por dependencia:** desglose sin ranking engañoso, con CSV.
- **Archivos:** ver `docs/etapa-9-kpi.md` § 8. Migración `20261102000000_kpi_snapshot.sql` y su `down.sql`.
- **Pruebas:**
  - lint, typecheck y 377 unitarias;
  - pgTAP 779/779 tras `db reset` (`kpi_snapshot` 45: cifras conocidas, frontera de día de CDMX,
    reaperturas, fusionados, conciliación por periodos y con el agregado, correcciones, permisos, versiones);
  - reversión y reaplicación;
  - build canario + `check:bundle`;
  - e2e 38: `kpi.spec.ts`, más la suite completa;
  - rendimiento con 20 000 casos y 100 000 menciones (§ 7 del documento).
- **Hallazgo corregido antes de entregar:** `report_snapshot` tardaba 13.8 s con el conjunto de carga por
  subconsultas correlacionadas; con agregados y funciones de ventana quedó en ~3 s.
- **Conteo previo (sólo lectura):**
  - producción: 4 reportes aprobados, 0 borradores, 1 caso, 808 menciones en 30 días;
  - preview: 59 aprobados, 3 borradores, 3 casos.
- **Limitaciones:** la dependencia de un caso es la actual; «vencido al corte» usa el plazo vigente; el
  asistente sigue en turnos (con nota de unidades); 24 h es móvil.
- **Activación / reversión:**
  - activar: migración en preview y producción, luego deploy;
  - revertir: commit y `down.sql`.
- **Pendiente:** Node 22/24; asistente con casos; materializar la atención por día si crece el volumen.

## Etapa 8 — Mapa de conversación y casos operativos (13 oct 2026, base `aa94177`)

- **Antes:**
  - `/mapa` sólo con la conversación por colonia, para roles de lectura total.
  - Los casos no tenían ubicación propia y no había capa de casos.
  - Periodos en horas, distintos de la bandeja; sin tabla equivalente.
  - Sin manejo de mapa base caído ni de polígonos inválidos.
- **Después:**
  - Capas separadas Conversación y Casos; `dependencia` entra sólo a la de sus casos (RLS).
  - Filtros de periodo, colonia, categoría, prioridad, estado y dependencia, con los mismos predicados que
    `/casos` y la bandeja (días de CDMX).
  - Ubicación del caso confirmada, inferida o no disponible, con origen y confianza. Sólo las confirmadas
    llevan punto (redondeado a ~100 m en el mapa). Admin y comunicación confirman o corrigen con motivo, y
    queda el historial.
  - Intensidad, *clusters*, leyenda con unidad y denominador, panel con enlace a `/casos` y a la bandeja,
    tablas accesibles y listados de lo que no tiene ubicación.
  - Avisos de mapa base caído, WebGL, catálogo vacío y polígonos inválidos. Extractos enmascarados.
  - La política de lectura de `cases` se reescribió con la misma regla en forma de conjuntos:
    `map_case_rows` pasó de 2.2 s a 80 ms con 20 000 casos, y `/casos` también se beneficia.
- **Archivos:** ver `docs/etapa-8-mapa.md` § 8. Migración `20261101000000_map_cases.sql` y su `down.sql`.
- **Pruebas:**
  - lint, typecheck y 363 unitarias;
  - pgTAP 734/734 tras `db reset` (`map_cases` 43);
  - reversión, reaplicación sentencia por sentencia y en una transacción, con casos previos, y backfill
    repetido;
  - build canario + `check:bundle`;
  - e2e 34/34 (mapa: tabla y teclado con mapa base bloqueado, conteos iguales a `/casos`, confirmar y
    corregir con historial, lectura y dependencia);
  - mediciones con 1 500 colonias, 20 000 casos y 100 000 menciones (§ 6 del documento).
- **Hallazgo corregido antes de entregar:** el backfill dependía de un indicador local a la transacción y
  no surtía efecto si el archivo se corría sentencia por sentencia. Ahora el indicador es de sesión.
- **Conteo previo (sólo lectura):**
  - producción: 1 caso, con colonia;
  - preview: 3 casos sin colonia;
  - ambas: 61 colonias, todas con polígono.
- **Limitaciones:** puntos capturados como coordenadas, sin geocodificación; las menciones siguen siendo
  por colonia; más de unas 2 000 colonias requiere teselas o caché de geometrías.
- **Activación / reversión:**
  - activar: migración en preview y producción, luego deploy;
  - revertir: commit y `down.sql`, exportando antes las ubicaciones confirmadas.
- **Pendiente:** Node 22/24; selector de punto en el mapa; teselas vectoriales para catálogos grandes;
  medir la carga en Vercel.

## Etapa 7 — SLA con calendario, escalamiento, outbox y reportes programados (13 oct 2026, base `0206063`)

- **Antes:**
  - SLA sólo por prioridad y en horas corridas, sin versión ni calendario.
  - Escalamiento sólo de turnos por WhatsApp, a un contacto único.
  - Alertas y reportes enviados en directo, sin reintentos ni id del proveedor.
  - Reportes programados con `last_run_at` no atómico: dos crons podían generar dos reportes, y una falla dejaba el día como «ya corrió».
- **Después:**
  - SLA por categoría y prioridad (aceptación y atención), en horas corridas u hábiles, con días inhábiles y zona CDMX. Cada versión es de referencia hasta que un admin la aprueba; el caso guarda la versión y los plazos aplicados.
  - Recordatorio y escalamiento a enlace, titular y coordinación, con destinatarios de configuración verificada. Cada paso se registra una vez, con motivo, plazo, destinatario y resultado. Las emergencias son críticas.
  - Outbox con clave idempotente, estados, lease, backoff, límite de intentos y un registro por intento con el id del proveedor. El correo envía `Idempotency-Key` a Resend; WhatsApp con resultado desconocido queda «incierto».
  - Preferencias de canal y silencio por persona, y límite por hora. Lo crítico no espera.
  - `report_jobs` único por municipio, tipo y periodo, con etapas, reintentos y presupuesto de tiempo. Se marca enviado sólo cuando el correo fue aceptado. La aprobación humana sigue siendo la opción por omisión.
- **Archivos:** ver `docs/etapa-7-sla-escalamiento-envios.md` § 7. Migración `20261031000000_sla_outbox.sql` y su `down.sql`.
- **Pruebas:**
  - lint, typecheck y 351 unitarias;
  - pgTAP 691/691 tras `db reset` (SLA 27, outbox 33, escalamiento 21, report jobs 16);
  - reversión, reaplicación y siembra repetida;
  - build canario + `check:bundle`;
  - e2e 33/33 (nueva `delivery.spec.ts`: crons concurrentes, Resend caído, silencio contra emergencia, SLA hábil).
- **Conteo previo en producción (sólo lectura):** 1 municipio, 0 programaciones de reporte, 0 casos abiertos, SLA 12/24/72/168 h, 5 reglas de alerta activas, 2 dependencias con enlace.
- **Limitaciones:** WhatsApp sin idempotencia (queda «incierto»); plantilla `sigma_caso_aviso` pendiente; inhábiles capturados a mano; los turnos de menciones sueltas siguen con el seguimiento anterior.
- **Activación / reversión:**
  - activar: migración, deploy, y revisar el SLA, los enlaces y los titulares;
  - revertir: commit y `down.sql`.
- **Pendiente:** Node 22/24; medir gravedad en el eval; aprobar la versión del SLA con el acuerdo real; plantilla de WhatsApp para casos.

## Etapa 6 — Atención de casos (13 oct 2026, base `37d6d17`)

- **Antes:**
  - Los editores podían hacer cualquier paso, incluidos los de la dependencia.
  - Se cerraba con un botón, sin revisar evidencia ni registrar el resultado.
  - Reasignar o reabrir borraba las fechas de aceptación y atención.
  - No había avances con archivos, ni tareas entre áreas, ni plazo de aceptación.
- **Después:**
  - Actor por transición en la base (`case_transition_actor`). La coordinación (admin y comunicación, vía `is_case_coordinator`; sin rol nuevo) sólo registra pasos de la dependencia en su nombre y con motivo.
  - Cerrar sólo con `validate_case`: un avance en el ciclo, sin tareas abiertas, evidencia confirmada y resultado. Devolver exige motivo.
  - `assign_case` con persona responsable, plazo de aceptación y compromiso. «Vencidas» usa el plazo de aceptación.
  - Tareas por área, con área líder como responsable principal y visibilidad por RLS.
  - Avances con audiencia. Evidencia en el bucket privado `case-evidence` (`<org>/<caso>/<uuid>.ext`): se sube con la sesión del usuario, se valida por bytes y por los metadatos de Storage, a las fotos se les quitan EXIF y GPS, y se descarga con un enlace de 60 s.
  - Reapertura con evidencia y nuevo ciclo. Hitos de sólo agregar (`case_milestones`) y tiempos por ciclo.
- **Archivos:** ver `docs/etapa-6-atencion-de-casos.md` § 8. Migración `20261030000000_case_attention.sql` y su `down.sql`.
- **Pruebas:**
  - lint, typecheck y 336 unitarias;
  - `db reset` y pgTAP 594/594 (86 de atención, 4 del service role, `cases` ajustado);
  - reversión, reaplicación y backfill repetido en local, con pgTAP completo después;
  - build canario + `check:bundle`;
  - e2e 29/29 (nueva: atención completa con tareas, evidencia, permisos de descarga, devolución, cierre y reapertura).
- **Conteo previo (sólo lectura):** producción 1 caso «detectado»; preview 0. Ninguno tiene el bucket.
- **Limitaciones:** PDF sin limpiar metadatos; sin detección de rostros; sin avisos al devolver o validar; huérfanos sin limpieza automática.
- **Activación / reversión:**
  - activar: migración, luego deploy;
  - revertir: commit y `down.sql` (exportar antes; el bucket no se borra).
- **Pendiente:** Node 22/24; medir gravedad en el eval; avisos de devolución y validación; retención de evidencia.

## Etapa 5 — Bandeja operativa y revisión humana (13 oct 2026, base `d79a161`)

- **Antes:**
  - La bandeja sólo tenía la lista cronológica.
  - La prioridad del modelo mezclaba gravedad y urgencia, así que una crítica dura podía verse como urgente.
  - Las correcciones no guardaban la versión previa ni llegaban al dashboard hasta la siguiente clasificación.
  - No había revisión humana de clasificaciones dudosas.
- **Después:**
  - Seis vistas: Nuevas, Urgentes, Sin responsable, Por aceptar, Vencidas y Por validar.
    - Cada contador sale de la misma función que su lista (`inbox_items`, invoker, con RLS).
    - Orden por urgencia, plazo y antigüedad con desempate estable; cursor sin duplicados.
    - Tarjetas distintas para mención y caso.
  - Acciones masivas con el número real de registros actualizados y las fallas con su motivo.
  - Gravedad, tipo de incidente y necesidad de atención separados del sentimiento, y confirmables por una persona.
  - Políticas de emergencia mostradas y exigidas antes de turnar.
  - Cola de revisión: baja confianza, posible emergencia, riesgo alto, término de riesgo y señales contradictorias. La decisión guarda cambio y motivo, y la versión previa queda en una tabla de sólo agregar.
  - Invalidación durable de agregados: rollup, «Lectura del día» y aviso en borradores, dentro del SLA de frescura; Salud lo vigila.
- **Archivos:** ver `docs/etapa-5-bandeja-operativa.md` § 7.
- **Pruebas:**
  - lint, typecheck y unitarias;
  - pgTAP 503/503 (colas y contadores, revisión y versiones, lado servidor, matriz RLS);
  - reversión y reaplicación sobre base limpia;
  - build canario + `check:bundle`;
  - e2e 28/28 (4 nuevas: vista Urgentes con emergencia y política, turnado en bloque con fallas, revisión con versión e invalidación, acceso de dependencia).
- **Conteo previo en producción (sólo lectura):** 784 clasificaciones; 307 quedan con `needs_attention` por el backfill; ninguna entra a revisión con la migración.
- **Limitaciones:** las vistas no se reordenan solas en vivo; el eval aún no mide gravedad.
- **Activación / reversión:**
  - activar: migración, deploy, y revisar Configuración → Emergencias;
  - revertir: commit y `down.sql`.
- **Pendiente:** Node 22/24; medir gravedad en el eval.

## Etapa 4 — Casos (13 oct 2026, base `6e26ba5`)

- **Antes:**
  - La mención era la unidad de trabajo: cada publicación de la misma fuga se turnaba por separado.
  - No había historial de quién hizo qué, ni forma de agrupar, devolver por competencia o validar el cierre.
- **Después:**
  - `cases` (folio `C-00001` por municipio) y `case_mentions` (una mención en a lo más un caso); las menciones
    siguen contando una por una.
  - Una sola máquina de estados en la base, con motivo obligatorio para devolver, descartar, rechazar la
    validación y reabrir.
  - Los turnos son las asignaciones del caso y siguen su estado; Bandeja y WhatsApp mueven el caso.
  - Historial de sólo agregar (persona, WhatsApp o sistema) y notas internas o para la dependencia.
  - Fusión que conserva folios e historial; sugerencias de agrupación siempre confirmadas por una persona.
  - Backfill repetible de turnos a casos, con simulación y conciliación (admin, en `/casos`).
  - Interfaz `/casos` y `/casos/[id]`; en Bandeja, «Caso» (atajo `c`) y folio en tarjetas.
- **Archivos:** ver `docs/etapa-4-casos.md` § 7. Migración `20261027000000_cases.sql` y su `down.sql`.
- **Pruebas:**
  - lint, typecheck y unitarias (incluye espejo SQL↔TS de transiciones);
  - `db reset` y pgTAP 436/436 (casos, backfill, sugerencias, personas, matriz RLS);
  - reversión y reaplicación en local, con pgTAP completo después;
  - build canario + `check:bundle`;
  - e2e 24 (casos 2/2; volvió a fallar una vez la prueba intermitente del mapa y pasó al repetir).
- **Conteo previo (sólo lectura):** producción 189 turnos → 187 casos; preview 110 → 110.
- **Limitaciones:** sugerencias léxicas a 72 h; turnos sólo sobre la mención principal; persona responsable
  sólo de la dependencia asignada.
- **Activación / reversión:**
  - activar: migración, deploy, y en `/casos` Simular y Aplicar;
  - revertir: commit y `down.sql` (se pierden casos e historial; los turnos se conservan).
- **Pendiente:** Node 22/24, prueba intermitente del mapa.

### Adicional: logotipo del cliente en los reportes (pedido durante la etapa 4, commit aparte)

- **Antes:**
  - El PDF sólo llevaba los colores del municipio.
  - Su pie de página no se dibujaba: react-pdf descartaba el número de página al heredar el interlineado de la
    página.
- **Después:**
  - Configuración → Identidad (admin) sube o quita el logotipo y ajusta los colores.
  - El logo va en la portada, sobre blanco, y en el pie de cada página; el pie vuelve a salir con la
    numeración.
  - Bucket privado `branding`; formato validado por bytes; la ruta queda atada a la carpeta del municipio.
- **Archivos:**
  - `supabase/migrations/20261028000000_org_logo.sql` y su `down.sql`;
  - `src/lib/branding/*`, `src/components/settings/logo-form.tsx`, `src/app/(app)/configuracion/identidad`;
  - `src/lib/reports/{pdf.tsx,deliver.ts,list.ts}`.
- **Pruebas:**
  - `branding/image.test.ts` y `branding.test.sql` (8);
  - e2e de reportes: sube el logo y verifica la imagen en el PDF;
  - revisión visual del PDF.
- **Activación / reversión:**
  - activar: migración y deploy;
  - revertir: commit y `down.sql`, vaciando antes el bucket.

## Etapa 3 — Salud del monitoreo (13 oct 2026, base `1666fd6`)

- **Antes:**
  - El estado de las fuentes sólo se veía en Configuración → Fuentes y no distinguía pausa, falta de
    publicaciones, error y cobertura parcial.
  - No había umbrales, ni registro persistido de cuándo corrió el clasificador sin trabajo o se reconstruyó el
    dashboard.
  - Lectura no tenía un resumen.
- **Después:**
  - Sección `/salud`: detalle para admin y comunicación, resumen para lectura (recortado en la base); dependencia
    sin acceso.
  - Nueve estados por fuente, con motivo, próximo intento y siguiente paso.
  - Clasificador y dashboard con umbrales por municipio; frecuencia y umbrales por fuente (la ingesta respeta
    la frecuencia).
  - Hora de corte de la Ciudad de México; nunca verde con cobertura desconocida.
  - Corridas filtrables con detalle.
  - Reintento manual con *lease* y espera de 60 s.
  - Latidos persistidos y regla de alerta `monitor_health`.
- **Archivos:**
  - `supabase/migrations/20261026000000_monitor_health.sql` y `docs/rollback/…down.sql`;
  - `src/lib/health/*`, `src/components/health/*`, `src/app/(app)/salud/*`;
  - alertas (`rules.ts`, `evaluate.ts`, ícono y formulario), `roles.ts`/`nav-icons.ts`;
  - latidos en ingesta y clasificación, espera manual en `sources/actions.ts`;
  - pruebas: `health/model.test.ts`, `health.test.sql`, `e2e/health.spec.ts`, ajustes en `rules.test.ts`,
    `roles.test.ts` y `rls_matrix.test.sql`;
  - README y `docs/etapa-3-salud-del-monitoreo.md`.
- **Pruebas:**
  - lint, typecheck y 307 unitarias;
  - `db reset` de 19 migraciones y 338 pgTAP;
  - build canario + `check:bundle`;
  - e2e 22/22 (en la primera corrida falló la prueba previa del mapa; ver limitaciones);
  - humo de la alerta de salud con enfriamiento;
  - reversión y reaplicación probadas.
- **Hallazgo:** `e2e/map.spec.ts` es intermitente porque el panel de colonia ofrece a lectura un enlace a
  Bandeja, que redirige. Se propuso corregirlo en una tarea aparte.
- **Limitaciones:**
  - el próximo intento es una estimación sobre el cron horario;
  - los latidos de los crons son globales, no por municipio.
- **Activación / reversión:**
  - activar: migración antes del deploy y, opcionalmente, la regla "Salud del monitoreo";
  - revertir: commit y `down.sql`.
- **Pendiente:** cuotas y costo de IA, frescura tras correcciones, reportes programados, Node 22/24.

## Etapa 2 — Cobertura y clasificación confiable (13 oct 2026, base `ea3e9e8`)

- **Antes:**
  - **Ingesta:** los conectores truncaban en silencio (200 elementos, 1–4 páginas) y la siguiente corrida
    empezaba en el último éxito, así que lo omitido se perdía; las interacciones no se actualizaban.
  - **Clasificación:** dos workers clasificaban y mandaban a la IA las mismas menciones; el upsert pisaba
    correcciones humanas; guardar y cambiar estado eran dos escrituras sin transacción.
  - **Fallos:** las menciones `failed` quedaban así para siempre.
- **Después:**
  - **Contrato de conectores:** con ventana, completitud, `resumeUntil`, huecos y topes. `covered_until` sólo
    avanza sobre ventanas completas, con backfill de lo cortado.
  - **Paginación:** Facebook pagina y reanuda (comentarios por cursor); YouTube pagina la búsqueda; RSS sin tope
    y con tolerancia de 7 días.
  - **Almacenamiento:** `ingest_mentions` deduplica y actualiza métricas.
  - **Clasificación:** reserva con lease (`claim_mentions`) y guardado transaccional que respeta correcciones
    (`complete_classifications`).
  - **Corridas y fallos:** reintentos con espera y cola revisable (`pipeline_failures`); contadores por
    municipio (`worker_runs`).
- **Archivos:**
  - **Nuevos:**
    - `supabase/migrations/20261025000000_pipeline_reliability.sql`;
    - `docs/rollback/20261025000000_pipeline_reliability.down.sql`;
    - `src/lib/connectors/window.ts`;
    - `src/lib/ingest/coverage.ts` y `coverage.test.ts`;
    - `src/components/sources/failures-queue.tsx`;
    - `supabase/tests/database/pipeline.test.sql`;
    - `e2e/pipeline.spec.ts`;
    - `docs/etapa-2-cobertura-y-clasificacion.md`.
  - **Modificados:**
    - `connectors/types.ts`, `meta.ts`, `youtube.ts`, `rss.ts`, `recent.ts` y las pruebas de conectores;
    - `ingest/run.ts` y `assign.ts`, `ai/classify.ts` y `classifier.ts`;
    - `sources/actions.ts` y `data.ts`, la página de fuentes y `runs-table.tsx`, `sources-manager.tsx`;
    - `e2e/mock-anthropic.mjs` (registra qué menciones se envían), `database.types.ts` y el README.
- **Pruebas:**
  - lint, typecheck y 279 unitarias;
  - `db reset` de 18 migraciones y 311 pgTAP;
  - build canario + `check:bundle`;
  - 18 e2e;
  - el e2e de concurrencia falla con el código anterior (2 envíos por mención) y pasa con el nuevo;
  - reversión y reaplicación probadas.
- **Hallazgo:** la estructura de `queries` ya versionaba cada consulta (una fila por versión); se conserva y se
  documenta en lugar de agregar otra columna.
- **Limitaciones:**
  - paginación real de Facebook y YouTube sin probar contra los proveedores;
  - ingesta exitosa de punta a punta sin probar en el sandbox (sin internet);
  - comentarios de YouTube por encima de 500 entre corridas y feeds que se adelantan quedan como huecos
    reportados.
- **Activación / reversión:**
  - activar: migración en preview y producción antes del deploy;
  - revertir: commit y `down.sql`.
- **Pendiente:** orden de etapas y Node 22/24 (etapa 0); cuotas y costos (etapa 3).

## Etapa 1 — Endurecimiento (13 oct 2026, base `9ac734a`)

- **Antes:**
  - El feed RSS aceptaba cualquier `http(s)` (loopback, red privada, metadatos) y seguía redirecciones sin
    revisarlas.
  - El tope de 5 MB se medía después de leer todo, en caracteres.
  - El timeout de la fuente no cancelaba la petición.
  - Un editor podía, por la API, insertar reportes aprobados o enviados, borrar aprobados, escribir
    aprobador, envío o PDF y cambiar destinatarios sin rastro.
  - maplibre-gl 5.24 tenía un aviso crítico.
- **Después:**
  - `safe-fetch.ts` valida la IP en el `lookup` del socket (sin rebinding) y en cada redirección (máx. 5), con
    `RSS_ALLOWED_HOSTS` opcional.
  - Lectura en streaming con tope en bytes y cancelación.
  - `signal` en los conectores; `withDeadline` aborta la ingesta y "Probar fuente".
  - Migración `20261024000000_reports_hardening.sql`: políticas por operación, columnas, transiciones
    explícitas y RPC auditada `set_report_recipients`.
  - maplibre-gl 6.14 con `setWorkerUrl`.
- **Archivos:**
  - nuevos: `src/lib/connectors/safe-fetch.ts` y `safe-fetch.test.ts`, `src/components/map/maplibre.ts`,
    la migración, `docs/rollback/20261024000000_reports_hardening.down.sql`,
    `supabase/tests/database/reports_workflow.test.sql` y `reports_server.test.sql`,
    `docs/etapa-1-endurecimiento.md`;
  - modificados: `http.ts`, `types.ts`, `rss.ts`, `meta.ts`, `youtube.ts`, `ingest/run.ts`,
    `sources/actions.ts`, `catalogs/actions.ts`, `reports/actions.ts`, los dos mapas, `e2e/map.spec.ts`,
    `reports.test.sql`, `database.types.ts`, `package.json`/lock, README y `.env.example`.
- **Pruebas:** lint, typecheck, 268 unitarias, build canario + `check:bundle`, `db reset` de 17 migraciones,
  264 pgTAP, 17 e2e. Además, la reversión aplicada hace fallar 15 de 19 pruebas nuevas.
- **Hallazgo:** los triggers no pueden llamar a `private.*` porque `service_role` no tiene USAGE. pgTAP lo ocultó
  por un plan en caché; ahora las pruebas del servidor corren en sesión propia.
- **Limitaciones:**
  - 9 avisos altos sólo de desarrollo (`braces` vía `fast-glob`, sin versión corregida);
  - el demo RSS no funciona contra `localhost`;
  - el fondo de calles del mapa no se pudo ver en el sandbox.
- **Activación / reversión:**
  - activar: migración primero (preview y producción), luego deploy y, si se desea, `RSS_ALLOWED_HOSTS`;
  - revertir: commit y `down.sql`.
- **Pendiente:** orden de etapas y Node 22/24 (de la etapa 0).

## Etapa 0 — Línea base (13 oct 2026, base `918838d`)

- **Antes:** sin matriz de los 13 hallazgos; el seed tenía un solo municipio y `rls_matrix.test.sql` contaba tablas
  completas; el simulador no podía simular fallas y se caía con una petición mal formada.
- **Después:** matriz con evidencia (`docs/etapa-0-linea-base.md`); dos hallazgos reproducidos en local (#3
  clasificación concurrente, #8 costo desconocido); seed con un segundo municipio y sus cuatro roles; prueba
  `tenants.test.sql`; inyección de fallas en `e2e/mock-anthropic.mjs`. Sin cambios en la app ni en migraciones.
- **Archivos:** `docs/etapa-0-linea-base.md`, `docs/bitacora.md`, `supabase/seed.sql` (bloque al final),
  `supabase/tests/database/tenants.test.sql` (nuevo), `supabase/tests/database/rls_matrix.test.sql` (cuenta sólo el
  municipio A), `e2e/mock-anthropic.mjs`.
- **Pruebas:** lint, typecheck, 199 unitarias, build con claves canario + `check:bundle`, `db reset` de las 16
  migraciones, 228 pgTAP, 17 e2e, recorrido de 14 rutas × 5 usuarios. Todo en verde.
- **Limitaciones:** las reproducciones de #3 y #8 se hicieron a mano contra la app local, sin prueba automatizada
  (se agregará en sus etapas). El fixture del municipio B no se cargó en el proyecto de preview (sólo local y CI).
- **Activación / reversión:** nada que activar. Revertir = revertir el commit; para la base local,
  `npx supabase db reset`.
- **Pendiente:** decidir el orden de etapas propuesto; alinear Node 22 (CI) con 24 (producción).
