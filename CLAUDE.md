# CLAUDE.md — EV8 Ops

## What this is
Own operational system of E-Motion Motors LLC (EV8, Tbilisi). Owner: Mika (remote,
makes product decisions). Director on site: Kardu Kukhianidze (main daily user, phone).
Spec: `docs/spec/ev8-ops-tz-v1.1.html`. State and next step: `docs/handoff.md`.
Business rules, glossary, decisions and open questions live in the project book
(`~/Developer/ev8/handbook`, GitHub `mkodzya/ev8-handbook`, ADR-0002 there):
@~/Developer/ev8/handbook/CLAUDE.md

## Who runs sessions (since 28.09.2026)
Two people drive development, each with their own Claude on their own machine:
**Mika** and **Kardu** (GitHub `Kardu89`). Both work in `feature/*` branches and
merge into `develop`. The way of working is Self Platform's (Mika, 28.09.2026):
**after a merge into `develop`, Mika's session puts it on the test stand at once**
(`ssh root@204.168.149.105 /srv/ev8-ops/deploy/follow-develop.sh --now`);
**a release reaches prod only on Mika's word**, and then Mika's session cuts it —
`release/X.Y.Z`, versions, `main` with an annotated tag, back into `develop` — and
runs `ssh root@204.168.149.105 /srv/ev8-ops/deploy/deploy-prod.sh X.Y.Z`. Never on its
own. In a session run by Kardu: never push `main` or a tag, never touch the server
(`.githooks/pre-push` refuses it too); a merge of Kardu's reaches the test stand
with Mika's session's next deploy, or when Kardu asks Mika. Product decisions stay with Mika; Kardu proposes. Kardu's setup and
workflow: `docs/onboarding.md`. Talk to whoever runs the session in the language
they write in.

## Non-negotiable rules (from the owner)
1. **Never invent data.** Only data confirmed in Odoo, Google Drive, files Mika
   uploads, or the live site ev8.ge. Missing data is reported as missing, never
   filled with something plausible. Seed/demo data is allowed only when marked as
   such and never on the prod stand.
   ~~The Odoo import runs at the very end of the product~~ — **reversed by Mika
   on 15.09.2026**: the import ran, and the product is refined against live
   data from here on. `tools/migrate_stage1.py` is idempotent and can be re-run
   after every schema change; the cost of that was named and accepted. The DEMO
   dataset stays for an empty database and is still refused on a stand.
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
- Once an option is chosen: implement, commit, merge into `develop`, put it on the test
  stand, check it there. Prod — only when Mika says so; then release and deploy, and
  record the release in `docs/handoff.md`.
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

## Сессии и параллельная работа (протокол студии Self, ADR-0006…0010)
- Ветки — GitFlow: `develop` — работа и default, `main` — релизы с тегом голого semver `X.Y.Z`;
  `feature/<topic>` от develop, `hotfix/<topic>` от main. В develop/main напрямую не коммитить.
- Старт: `git status`, `git log -3`. Чужие незакоммиченные правки не трогать, не откатывать.
- Одна рабочая копия — один писатель: код — в worktree
  `git -C <repo> worktree add ../_worktrees/ev8-ops-<topic> -b feature/<topic> develop`;
  готово — merge в develop, `git worktree remove`, ветка удалена.
- Правки адресные (Edit), никаких tar/rsync поверх рабочей копии; `push --force`, `reset --hard` — никогда.
- Коммит и push по ходу: каждая законченная правка — коммит сразу и push тем же шагом; сессия не
  заканчивается с незапушенным. Заголовок коммита — фраза-вердикт в стиле NYT.
- Тяжёлые задачи под бюджет памяти (Mac 8 ГБ): одна тяжёлая задача на машину; `NODE_OPTIONS=--max-old-space-size=…`,
  `--maxWorkers=2`/`--runInBand`, `nice -n 10`, явный таймаут; второй запуск, пока первый не завершился, запрещён.
  Тяжёлое: `docker compose up`, Vite build, `tsc -p`, Prisma generate, Playwright, `npm ci`.
- В репозитории только рабочее: ни личных данных клиентов, ни снимков Odoo, ни выписок, ни секретов.
- Решения — в `docs/adr/`, формат Нюгарда, append-only. Практики — `docs/practices.md`, UX — `docs/design/ux.md`.

## Commit attribution
End commit messages with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Расширения сверх ТЗ

- **Склад запчастей** (14.09.2026). В ТЗ §2 «Складской учёт запчастей и
  зарядных по остаткам» вынесен за границы v1. Сделан по прямой просьбе
  Мики. Если ТЗ будет обновляться — это место расходится с ним осознанно.
