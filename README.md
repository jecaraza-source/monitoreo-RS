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
- `npm test` — pruebas unitarias (`node --test`, archivos `*.test.ts`)
- `npm run db:reset` — recrea la base local con migraciones + `supabase/seed.sql`
- `npm run db:types` — regenera `src/lib/supabase/database.types.ts`
- `npm run test:db` — pruebas de RLS (pgTAP) en `supabase/tests`
- `supabase db push` — aplica migraciones de `supabase/migrations` al proyecto remoto

## Base de datos local

Requiere Docker. `npx supabase start` levanta el stack; `npm run db:reset` carga
un municipio ficticio con 5 dependencias, 10 colonias y 200 menciones.
Usuarios de prueba (contraseña `password123`): `admin@`, `comunicacion@`,
`obras@`, `agua@` y `lectura@monitoreo.test`.

## Acceso y roles

- Entrada con **magic link** de Supabase (`/login`). El acceso es sólo por invitación:
  el formulario nunca crea cuentas y responde igual exista o no el correo.
- Un **admin** invita desde **Configuración** (correo, rol y, para `dependencia`, su área).
- Cada rol ve sólo su menú y no puede abrir otras secciones (`src/lib/auth/roles.ts`):

  | Rol | Secciones |
  |---|---|
  | admin | Dashboard, Bandeja, Mapa, Alertas, Reportes, Asistente, Configuración |
  | comunicacion | Dashboard, Bandeja, Mapa, Alertas, Reportes, Asistente |
  | dependencia | Bandeja, Alertas |
  | lectura | Dashboard, Mapa, Alertas, Reportes |

  Esto controla la navegación; la visibilidad de los datos la impone RLS.

En local, los correos llegan a Mailpit: http://127.0.0.1:54324.

### Configurar el proyecto de Supabase (producción)

1. **Auth > URL Configuration:** Site URL = dominio de la app; Redirect URLs = `https://<dominio>/**`
   (y la URL de previews de Vercel si se usan).
2. **Auth > Providers > Email:** desactivar *Allow new users to sign up*.
3. **Auth > Email Templates:** copiar `supabase/templates/magic_link.html` e `invite.html`. Usan
   `token_hash`, así el enlace funciona aunque se abra en otro dispositivo.
4. En Vercel: `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` y `SUPABASE_SERVICE_ROLE_KEY` (sólo servidor).

## UI kit

Primitivas en `src/components/ui-kit` (KpiCard, SentimentBadge, ChartCard, EmptyState,
PageTransition), con ejemplos en **`/dev/ui`** (oculto en producción).

Los colores viven en variables CSS en `src/app/globals.css`. Para aplicar la identidad del
municipio basta con cambiar las `--brand-*` (claro y oscuro); los colores de sentimiento
(`--positive`, `--neutral`, `--negative`) son independientes de la marca.
