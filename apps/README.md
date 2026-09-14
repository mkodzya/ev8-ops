# apps/

Planned layout, mirroring selfstudio-OPS (create in stage 1):

- `api/` — Fastify 5 + Prisma 7 + PostgreSQL 16, `src/routes`, `src/lib`, `migrations/`, `scripts/migrate.mjs`, vitest.
- `worker/` — cron jobs: rental periods (every night, Asia/Tbilisi), WhatsApp reminders, BOG statement pull, Kommo webhook fan-out.
- `web/` — React 18 + Vite 6, PWA, three locales (ka / ru / en), mobile-first.

Package names: `@ev8/api`, `@ev8/worker`, `@ev8/web`, `@ev8/shared`.
