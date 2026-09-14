# apps/

- `api/` — Fastify 5 + Prisma 7 + PostgreSQL 16. `src/routes` (auth, summary,
  fleet, customers, rentals — read side in stage 1 step 1), `src/lib` (env,
  db, auth, guard, audit), `migrations/*.sql` applied by `scripts/migrate.mjs`,
  `prisma/schema.prisma` mirrors the SQL for the generated client, vitest in `test/`.
  Every route declares a scope: `public`, `session`, or a permission from
  `@ev8/shared`; an undeclared scope is owner-only.
- `worker/` — cron jobs. Stage 1: weekly rental periods rolled nightly at 00:10
  Asia/Tbilisi (`PERIODS_CRON`), idempotent. Later: WhatsApp reminders, BOG
  statement pull, Kommo webhook fan-out.
- `web/` — React 18 + Vite 6, PWA (manifest + minimal service worker), three
  locales in `src/i18n` (`en.ts` fixes the `Dict` shape; `ka.ts`, `ru.ts` are
  typed against it), mobile-first: rail on a laptop, bottom bar on a phone.
  `scripts/i18n-guard.mjs` fails the build on English typed straight into JSX.

Package names: `@ev8/api`, `@ev8/worker`, `@ev8/web`, `@ev8/shared`.
