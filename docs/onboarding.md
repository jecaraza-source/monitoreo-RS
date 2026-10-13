# Puesta en operación (onboarding)

Lista para dejar listo un municipio antes de usarlo con datos reales. Su avance se ve en **Configuración →
Resumen → Puesta en operación**: lo automático se revisa con los datos del municipio, y las pruebas por rol se
registran a mano con su resultado (quedan en la bitácora).

> Nunca escribas llaves, tokens ni contraseñas en este documento, en tickets ni en chats. Las credenciales se
> capturan sólo en los paneles de los proveedores y en las variables del despliegue (`.env.example` lista los
> nombres, sin valores).

## 1. Entorno de práctica con datos ficticios

1. En un entorno local o de preview (nunca producción):
   - `npx supabase db reset` carga el seed ficticio:
     - el municipio «San Andrés del Valle»;
     - dependencias, colonias y categorías de caso;
     - menciones inventadas y usuarios de prueba por rol (`admin@`, `comunicacion@`, `obras@`, `agua@`,
       `lectura@monitoreo.test`).
   - Los correos de esos usuarios no existen: el acceso de práctica es por enlace mágico generado por el
     administrador del entorno.
2. Las fuentes del seed apuntan a `example.com` y están inactivas: no consultan servicios reales.
3. **Destinatarios de prueba:**
   - usa buzones del propio municipio creados para la capacitación (p. ej. `capacitacion@<dominio del municipio>`)
     o el simulador local (`e2e/mock-anthropic.mjs` también simula correo y WhatsApp);
   - nunca uses correos o teléfonos de ciudadanos.

## 2. Checklist

### Catálogos
- [ ] Dependencias registradas (Catálogos).
- [ ] Colonias importadas (Catálogos → importar GeoJSON u OpenStreetMap).
- [ ] Categorías de caso, cada una con al menos una dependencia que la pueda atender y su dependencia sugerida.

### Responsables
- [ ] Cada dependencia con **enlace** y **titular** (SLA y escalamiento → Enlaces y titulares).
- [ ] Usuarios por rol: al menos una persona de Administración, una de Comunicación y un enlace por dependencia.
- [ ] Persona de escalamiento para WhatsApp (si se usa).

### Fuentes
- [ ] Proyectos y consultas del municipio.
- [ ] Fuentes activas que ya leyeron al menos una vez (Salud las muestra en verde).
- [ ] Medios y figuras públicas verificados con evidencia (Autores verificados).

### Configuración
- [ ] SLA revisado y **aprobado** como acuerdo (con la nota del acuerdo).
- [ ] Escalamiento y horario de silencio.
- [ ] Política de retención decidida con referencia al acuerdo del municipio (o «sin eliminación automática»).
- [ ] Límites y presupuesto de IA.

### Pruebas por rol (se registran a mano en Resumen)
- [ ] **Destinatarios de prueba:** un aviso y un reporte llegaron a buzones de prueba del municipio.
- [ ] **Administración:** configuró un elemento, lo vio en la Bitácora con antes/después y lo revirtió.
- [ ] **Comunicación:** revisó la bandeja, creó un caso de práctica y lo asignó.
- [ ] **Enlace:** aceptó el caso, registró un avance con evidencia y solicitó validación (con la Ayuda abierta).
- [ ] **Consulta:** revisó dashboard y reportes y confirmó que no puede modificar nada.
- [ ] **Ejercicio operativo completo** (ver `docs/ejercicio-operativo.md`).
- [ ] **Procedimientos revisados:** falla de captura, incidente de seguridad, IA no disponible, con sus
      responsables (`docs/manual-operativo.md` § 7).

## 3. Al terminar

- Elimina del entorno real los casos de práctica (o márcalos como descartados con motivo «práctica»).
- Confirma en Configuración → Resumen que no queda nada pendiente y que el último cambio de cada elemento
  corresponde a la persona responsable.
