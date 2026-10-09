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
- `supabase db push` — aplica migraciones de `supabase/migrations`
