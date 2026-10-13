# Etapa 12 — Plan del piloto

Piloto controlado de Sigma Pulso en un municipio, para comprobar con operación real lo que la etapa 12 validó en
local. Empieza sólo cuando se cumplen las condiciones de entrada del informe (§ 10). Las personas se nombran en el
acta de arranque del municipio, no en este repositorio.

## 1. Alcance y duración

- **Duración:** 6 semanas, siguiendo la activación gradual (activación § 4):
  - semana 1: sólo lectura;
  - semanas 2–3: casos con dos dependencias;
  - semanas 4–5: avisos y reportes;
  - semana 6: evaluación.
- **Dependencias del piloto:** dos, elegidas por Coordinación entre las de más volumen (por ejemplo, Agua y
  Obras).
- **Fuentes:** las activas hoy (7 RSS). Facebook y YouTube sólo si su credencial está vigente.
- **Fuera de alcance:**
  - perfiles de personas;
  - seguimiento de cuentas no verificadas;
  - envíos a destinatarios externos al gobierno municipal.

## 2. Responsables

| Rol en el piloto | Quién (perfil) | Responde por |
|---|---|---|
| Patrocinador | Titular de Comunicación Social | Decisión de continuar, pausar o ampliar |
| Responsable operativo | Coordinación de Comunicación (rol `comunicacion`) | Bandeja diaria, casos, validación, métricas semanales |
| Enlaces de dependencia | Uno por dependencia piloto (rol `dependencia`) | Aceptar o devolver, atender, evidencia |
| Consulta | Dirección o titulares (rol `lectura`) | Revisar el dashboard y los reportes; retroalimentación |
| Administración técnica | Administración (rol `admin`) con apoyo de SIGMA | Usuarios, configuración, migraciones, respaldos, incidentes |
| Validación de IA | Dos analistas de Comunicación | Hoja de revisión humana; correcciones en la bandeja |
| Protección de datos | Unidad de transparencia del municipio | Política de retención y conservaciones; atención de solicitudes |

Antes de empezar, el acta registra:

- nombre y suplente de cada responsable;
- el canal de incidentes;
- la política de retención con su acuerdo.

## 3. Cadencia

- **Diario** (responsable operativo, 15 min):
  - Salud;
  - bandeja Urgentes;
  - casos por vencer.
- **Semanal** (responsable operativo y Administración técnica, 30 min):
  - correr `supabase/pilot/pilot_metrics.sql` (sólo lectura) y anotar el resultado en § 5;
  - revisar las condiciones de pausa.
- **Al final de cada paso:** el patrocinador decide si se avanza al siguiente (activación § 4).

## 4. Métricas y metas

Las calcula `pilot_metrics.sql` salvo donde se indica. Un valor sin datos se reporta «sin datos», nunca 0.

| Grupo | Métrica | Meta | Pausa si |
|---|---|---|---|
| Cobertura | Fuentes activas que leyeron en la semana | 100 % | < 80 % dos días seguidos |
| Cobertura | Corridas con hueco de cobertura | 0 | hueco no explicado > 24 h |
| Atraso | Menciones pendientes de clasificar con más de 1 h | 0 | > 50 durante más de 2 h |
| Atraso | Revisiones pendientes al cierre del día | < 20 | > 100 |
| Atraso | Casos vencidos (aceptación o atención) | < 10 % de los abiertos | > 30 % |
| Errores | Menciones fallidas y fallas abiertas del pipeline | 0 | > 10 en la semana |
| Errores | Envíos `dead` o `uncertain` | 0 | cualquiera a un enlace en paso 3+ sin resolver en 24 h |
| Costos | Costo de IA de la semana | ≤ presupuesto semanal fijado en Consumo de IA | > 120 % o costo desconocido > 0 |
| Atención | Mediana de horas para aceptar | ≤ plazo de aceptación del SLA | > 2× el plazo |
| Atención | Mediana de horas para cerrar | ≤ plazo de atención del SLA | — (se informa) |
| Atención | Proporción cerrada fuera de plazo | < 20 % | > 40 % |
| Exactitud | Correcciones / clasificadas en la semana | < 15 % | > 30 % |
| Exactitud | Revisiones confirmadas / decididas | ≥ 80 % | < 60 % |
| Exactitud | Mención de riesgo no marcada urgente (reporte manual del responsable operativo) | 0 | **cualquiera** |
| Seguridad | Acceso indebido o fuga (manual § 7.2) | 0 | **cualquiera** |

## 5. Registro semanal

| Semana | Fecha | Paso | Cobertura | Atraso | Errores | Costo | Atención | Exactitud | Decisión |
|---|---|---|---|---|---|---|---|---|---|
| Línea base | 13 oct 2026 | — | 7/7 fuentes, 0 huecos | 0 pendientes, 8 revisiones | 23 errores de ingesta (19 de Reddit, HTTP 429) | US$0.07 (4 llamadas) | 1 caso abierto | sin datos | — |
| 1 | | | | | | | | | |

## 6. Condiciones de pausa y reversión

- **Pausa inmediata** (el responsable operativo la ejecuta y avisa al patrocinador):
  - una mención de riesgo no marcada como urgente;
  - acceso indebido o fuga;
  - envío a un destinatario equivocado.

  Se vuelve al paso anterior con los interruptores (activación § 4); lo pendiente queda en cola.
- **Pausa por métricas:** cualquier columna «Pausa si» de § 4.
  - Se congela el paso actual hasta que la métrica vuelva a meta durante 3 días hábiles.
- **Reversión técnica:** activación § 6.
  - Un problema de rendimiento de la bandeja se atiende primero con los índices y consultas; la reversión de
    `rls_scale` es el último recurso, porque devuelve la lentitud.
- **Sin IA:** si el proveedor falla o se agota el presupuesto, el piloto sigue en modo manual (manual § 7.3). No
  es causa de pausa salvo que dure más de 24 h.

## 7. Criterio de éxito al final de las 6 semanas

- Todas las metas de § 4 en verde las dos últimas semanas.
- Ninguna pausa inmediata sin resolver.
- Acuerdo humano ≥ 90 % en la hoja de evaluación.
- Umbrales críticos de IA cumplidos.
- Los dos enlaces y Comunicación responden la encuesta de cierre con una valoración de utilidad ≥ 4 de 5.
- Con eso, el patrocinador decide ampliar al resto de dependencias (activación § 4, paso 5).
