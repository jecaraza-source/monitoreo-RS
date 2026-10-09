# Monitoreo Municipal

Plataforma de escucha social para un gobierno municipal de México. Ver `CLAUDE.md`
para contexto, stack, convenciones y límites éticos.

## Setup local

```bash
npm install
cp .env.example .env.local   # llena los valores
npm run dev
```

## Comandos

- `npm run dev` — servidor de desarrollo
- `npm run build` — build de producción
- `npm run lint` — ESLint
- `npm run typecheck` — TypeScript
- `npm run db:reset` — recrea la base local con migraciones + `supabase/seed.sql`
- `npm run db:types` — regenera `src/lib/supabase/database.types.ts`
- `npm run test:db` — pruebas de RLS (pgTAP) en `supabase/tests`
- `supabase db push` — aplica migraciones de `supabase/migrations` al proyecto remoto

## Base de datos local

Requiere Docker. `npx supabase start` levanta el stack; `npm run db:reset` carga
un municipio ficticio con 5 dependencias, 10 colonias y 200 menciones.
Usuarios de prueba (contraseña `password123`): `admin@`, `comunicacion@`,
`obras@`, `agua@` y `lectura@monitoreo.test`.
