# CLAUDE.md — EV8 Ops

## What this is
Own operational system of E-Motion Motors LLC (EV8, Tbilisi). Owner: Mika (remote,
makes product decisions). Director on site: Kardu Kukhianidze (main daily user, phone).
Spec: `docs/spec/ev8-ops-tz-v1.1.html`. State and next step: `docs/handoff.md`.

## Non-negotiable rules (from the owner)
1. **Never invent data.** Only data confirmed in Odoo, Google Drive, files Mika
   uploads, or the live site ev8.ge. Missing data is reported as missing, never
   filled with something plausible. Seed/demo data is allowed only when marked as
   such and never on the prod stand.
   **The Odoo import runs at the very end of the product, not before** (Mika,
   14.09.2026). Until then every screen is built and tried on the DEMO dataset
   (`SEED_MODE=demo`), which is marked row by row and refused on a stand. Real
   figures from Odoo and Drive still belong in the spec and the handoff — the
   decision is about the database, not about what we may know.
2. **Never delete anything in Google Drive.** Suspected junk is moved to
   `_Мусор` inside `EV8 main`.
3. **Never handle bank credentials.** Bank logins, client secrets, Meta tokens:
   Mika registers and stores them; code reads them from server secrets and
   never logs or displays them. Only statement files Mika uploads are processed.
4. **Odoo is read-only for us.** Migration scripts read via `tools/odoo_rpc.py`;
   nothing is written to Odoo.

## Languages
Talk to Mika in Russian. Code, comments, commit messages in English. UI in
ka / ru / en with an i18n guard (no missing keys). Georgian text needs Noto Sans
Georgian in every font stack (Be Vietnam Pro and Inter have no Georgian glyphs).

## How Mika wants the work run
- Stage by stage, questions along the way when a decision genuinely branches the
  work; obvious defaults are not questions. One question at a time.
- No step narration between tool calls. Work, then a short Russian summary of what
  changed and what was verified.
- Verify by doing: run it, open it in the browser, measure before fixing.
- Once an option is chosen: implement, commit, push to main, deploy to both stands.
- Visual options go to Mika as HTML files; his in-app viewer runs **no JavaScript**,
  so static markup only (CSS-only interaction is fine).
- Report failures faithfully (red tests, skipped steps).

## Domain facts that shape the code
- Money in GEL, stored in tetri as integers; VAT 18 % added on top of net prices.
- Time zone Asia/Tbilisi; rental periods are 7 calendar days from pickup.
- Vehicle state is derived from events (pickup, return, service job, sale),
  never set by hand without a reason.
- Acquiring payments arrive without payer name; net = gross − 1.5 %
  (315.20 = 320, 325.05 = 330). Fee is a company expense, not customer debt.
- Deposits (default 180 GEL) are a liability, not revenue.

## Commit attribution
End commit messages with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Расширения сверх ТЗ

- **Склад запчастей** (14.09.2026). В ТЗ §2 «Складской учёт запчастей и
  зарядных по остаткам» вынесен за границы v1. Сделан по прямой просьбе
  Мики. Если ТЗ будет обновляться — это место расходится с ним осознанно.
