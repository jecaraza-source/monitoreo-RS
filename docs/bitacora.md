# Bitácora técnica de implementación

Una entrada por etapa del prompt maestro, de la más reciente a la más antigua. El detalle de cada etapa vive en
su propio documento de `docs/`.

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
