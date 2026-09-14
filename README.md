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
TypeScript · React 18 + Vite 6 (PWA) · Fastify 5 · Prisma 7 · PostgreSQL 16 ·
worker for cron · docker-compose · two stands (test, prod) deployed through git.

## Run
```bash
cp .env.example .env
docker compose up db
```
`apps/*` are created in stage 1 (see `docs/handoff.md`).
