# EV8 Ops

Operational system of **E-Motion Motors LLC (EV8)**, Tbilisi — electric mopeds:
fleet, weekly rentals, payments and bank reconciliation, sales, purchases,
service, WhatsApp notifications. Replaces Odoo entirely (owner's decision,
13.09.2026); Kommo stays the front office for leads and chats and is integrated
both ways.

- Spec v1.1: `docs/spec/ev8-ops-tz-v1.1.html` (also published as an artifact, link in `docs/handoff.md`).
- Handoff and current state: `docs/handoff.md`. Start prompt for a fresh session: `docs/START-PROMPT.md`.
- Brand: `docs/design/brand.md`. Demo: `docs/design/demo/`.
- Working rules for Claude Code: `CLAUDE.md`.

## Stack (same as selfstudio-OPS)
TypeScript · React 18 + Vite 6 (PWA, ka / ru / en) · Fastify 5 · Prisma 7 ·
PostgreSQL 16 · worker for cron · docker-compose · two stands (test, prod)
deployed through git.

```
apps/api        Fastify + Prisma; hand-written SQL migrations in migrations/
apps/worker     nightly roll of weekly rental periods (Asia/Tbilisi); later WhatsApp, BOG, Kommo
apps/web        React + Vite PWA; dictionaries in src/i18n (en fixes the shape)
packages/shared money in tetri, VAT, acquiring, periods, roles and permissions, states
tools/          odoo_rpc.py (read-only) and the migration scripts
scripts/        i18n-guard.mjs
```

## Run on a Mac
Double-click `Start EV8 Ops.command` (builds on first run), then open
http://localhost:5175 and sign in with the owner login from `.env`
(defaults: `mika@selfstudio.se` / `ev8-dev-password`). `Start EV8 Ops (DEV).command`
reloads on save; `Stop EV8 Ops.command` stops; `Reset EV8 Ops (wipe data).command`
drops the local database.

Ports are offset from Self Platform, which runs on the same Mac:
db **5433**, api **8082**, web **5175**. `cp .env.example .env` to change them.

There is no demo dataset by rule (never invent data). An empty stack holds one
owner login; real data arrives through `tools/migrate_stage1.py` from Odoo.

## Checks
Node is not required on the host — everything runs in `node:22-alpine`:

```bash
docker run --rm -v "$PWD":/app -w /app node:22-alpine sh -c "npm ci && npm run generate && npm run typecheck && npm test"
```

`npm test` = i18n guard + shared unit tests + api tests. The api integration
suites run only when `DATABASE_URL` points at a database whose name contains
`test` (they write and clean up after themselves):

```bash
docker compose exec -T db psql -U ev8ops -d ev8ops -c "CREATE DATABASE ev8ops_test"
docker run --rm --network ev8-ops-platform_default -v "$PWD":/app -w /app \
  -e DATABASE_URL=postgresql://ev8ops:ev8ops@db:5432/ev8ops_test -e ALLOW_DEV_SECRET=true \
  node:22-alpine sh -c "node apps/api/scripts/migrate.mjs && npm run test:api"
```

CI (`.github/workflows/ci.yml`) runs the same against a Postgres service.
