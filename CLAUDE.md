@AGENTS.md

# Monitoreo Municipal
Plataforma de escucha social para un gobierno municipal de México. Recolecta menciones públicas
sobre el municipio, el presidente municipal, funcionarios, dependencias y programas; las clasifica
con Claude (sentimiento, tema, dependencia, colonia, prioridad); las turna a dependencias; genera
alertas, dashboards ejecutivos y reportes con narrativa estratégica.

## Stack
Next.js App Router + TypeScript estricto, Tailwind, shadcn/ui, Framer Motion, Recharts, MapLibre.
Supabase (Postgres, Auth, RLS, Storage). Vercel (hosting + Cron). Resend (correo).
Claude API con @anthropic-ai/sdk: modelo de clasificación en env CLAUDE_MODEL_FAST,
modelo de reportes en env CLAUDE_MODEL_SMART.

## Convenciones
- UI en español de México; código, tablas y variables en inglés.
- Server Components por defecto; mutaciones con Server Actions; validación con zod.
- Toda tabla con org_id y políticas RLS. Migraciones en supabase/migrations.
- Llaves (service role, Anthropic, Meta, Resend) sólo en servidor.
- Llamadas a Claude sólo desde lib/ai/*, con salida JSON validada por zod y reintento.
- Componentes pequeños en components/<módulo>; sin librerías nuevas sin preguntar.
- Diseño: tema oscuro por defecto con modo claro, tarjetas con animación de entrada,
  números animados, colores semánticos (verde positivo, gris neutral, rojo negativo).

## Roles
admin, comunicacion (ve todo), dependencia (sólo lo turnado a su dependencia), lectura.

## Límites éticos y legales
Sólo contenido público por APIs oficiales o RSS. No crear perfiles de ciudadanos críticos,
periodistas u opositores; los análisis de autores se limitan a medios y figuras públicas.
El fin es atención ciudadana y evaluación de la gestión, no promoción personal.

## Comandos
npm run dev | build | lint | test ; supabase db push
