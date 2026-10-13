# Ejercicio operativo por rol

Ejercicio de capacitación con **datos ficticios** (seed local o preview). Recorre un caso de punta a punta con
cada rol y verifica que cada quien ve sólo lo suyo. Duración: ~45 minutos. Lo automatizado del ejercicio está en
`e2e/org-config.spec.ts` (menú por rol, configuración auditada, atención con ayuda) y `e2e/attention.spec.ts`.

## Preparación (Administración)

1. Configuración → Resumen: revisa la lista de puesta en operación.
2. Catálogos → Categorías de caso: confirma que «alumbrado» la atiende Servicios Públicos.
3. SLA y escalamiento: confirma los plazos de prioridad media y que la versión está aprobada.
4. **Resultado esperado:**
   - la Bitácora muestra cada cambio con valor anterior, nuevo, persona y fecha;
   - Comunicación no puede abrir Catálogos, Usuarios ni Retención (el menú no los muestra y la URL directa redirige).

## 1. Analista (Comunicación)

1. Bandeja → estado «Sin clasificar» y vista «Urgentes»: identifica una mención ficticia de alumbrado.
2. Crea un caso desde la mención con categoría «alumbrado» y prioridad media.
3. Abre el caso → **Ayuda**: revisa «Notas internas y compartidas».
4. Agrega una nota **interna** («contexto para Comunicación») y una **compartida** («favor de atender hoy»).
5. **Asignar:** Servicios Públicos, con los plazos que propone el SLA.
6. **Resultado esperado:** el caso queda «Asignado» con plazo de aceptación y compromiso de atención.

## 2. Enlace (Dependencia)

1. Entra con el usuario de la dependencia: el menú no muestra Dashboard, Reportes ni Configuración.
2. Casos: sólo aparece el caso asignado a su dependencia.
3. Abre el caso → **Ayuda**: lee «Aceptar o devolver», «Qué evidencia aportar» y «Cómo se valida».
4. Ve la nota compartida, pero **no** la interna.
5. Acepta, inicia la atención, registra un avance con una foto ficticia (sin rostros ni placas) y solicita
   validación.
6. **Resultado esperado:** el caso queda «Pendiente de validación»; el enlace ya no puede cerrarlo.

## 3. Coordinación (Comunicación o Administración)

1. Valida: si falta evidencia, **devuelve a atención** con el motivo.
2. El enlace agrega la evidencia y vuelve a solicitar validación.
3. Coordinación cierra con el resultado y confirma la evidencia.
4. **Reabre** con motivo («el vecino reporta que la luminaria volvió a fallar»).
5. **Resultado esperado:**
   - nuevo ciclo;
   - el historial conserva el ciclo anterior, sus notas y evidencias;
   - los tiempos se miden por ciclo.

## 4. Dirección (Consulta)

1. Dashboard: «Atención y cumplimiento» refleja el caso cerrado y su reapertura.
2. Ayuda → «Dirección y titulares»: confirma qué recibe.
3. **Resultado esperado:** no puede crear, asignar, editar ni exportar (la descarga responde «sin permiso»).

## 5. Administración: cierre del ejercicio

1. Bitácora: verifica las entradas del ejercicio.
2. Retención y conciliación: exporta «Casos y compromisos» del día y verifica que la exportación quedó registrada.
3. Procedimiento «IA no disponible»: con el asistente de prueba sin clave, confirma que bandeja y casos siguen
   funcionando.
4. Registra en Resumen cada prueba por rol con su resultado.
5. Descarta o borra el caso de práctica.

## Registro

| Rol | Persona | Fecha | Resultado | Observaciones |
|---|---|---|---|---|
| Administración |  |  |  |  |
| Comunicación |  |  |  |  |
| Enlace |  |  |  |  |
| Consulta |  |  |  |  |
