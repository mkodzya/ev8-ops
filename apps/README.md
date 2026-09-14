# apps/

- `api/` — Fastify 5 + Prisma 7 + PostgreSQL 16. `src/routes` (auth, summary,
  fleet, customers, rentals — reads; `ops.ts` — writes: customers, hand-over,
  return, deposit confirmation, manual vehicle state, models and mopeds;
  `files.ts` — act photos and customer documents, bytes in Postgres;
  `documents.ts` — the contract and the return act as PDFs; `users.ts` —
  the team's logins; `payments.ts` — money in, allocation and voiding),
  `src/lib/pdf`
  (a bilingual document set in Noto Sans and Noto Sans Georgian; the text is
  laid out run by run because neither face covers both alphabets),
  `src/lib` (env, db, auth, guard, audit, validate, `vehicles.ts` — the one
  way a moped changes state, `rentals.ts` — hand-over and return as single
  transactions), `migrations/*.sql` applied by `scripts/migrate.mjs`,
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
  Screens: Today, Fleet, Rentals, Customers, cards for a moped / rental /
  customer, the hand-over wizard (`pages/PickupWizard.tsx`, five steps) and the
  return wizard (`pages/ReturnWizard.tsx`), a customer form, settings for the
  owner (people and logins, models) and a profile page.

Package names: `@ev8/api`, `@ev8/worker`, `@ev8/web`, `@ev8/shared`.
