# CLAUDE.md — EV8 Ops

## What this is
Own operational system of E-Motion Motors LLC (EV8, Tbilisi). Owner: Mika (remote,
makes product decisions). Director on site: Kardu Kukhianidze (main daily user, phone).
Spec: `docs/spec/ev8-ops-tz-v1.1.html`. State and next step: `docs/handoff.md`.
Business rules, glossary, decisions and open questions live in the project book
(`~/Developer/ev8/handbook`, GitHub `mkodzya/ev8-handbook`, ADR-0002 there):
@~/Developer/ev8/handbook/CLAUDE.md

## Who runs sessions (since 28.09.2026; narrowed 11.10.2026)
**Narrowed by Mika on 11.10.2026: Kardu changes the customer site only** —
`mkodzya/ev8-site`, the site that moves to ev8.ge. EV8 Ops (this repository, the
company's ERP) and its two stands, test and prod, are not his to change: in a
session run by Kardu nothing is committed, merged or deployed here — such a
session says so and passes the request to Mika. Everything else about the site is
his to do himself — its pages, its releases, the DNS of ev8.ge (Mika, 11.10.2026:
«пускай он всё сам делает; единственное ему нельзя менять ERP»). **What the site needs is built on
the site's side, not here** (Mika, 11.10.2026: «это были правки для сайта»): the
visit counter with its Reports → Site screen and the daily petrol price, which
Kardu's session had merged here that day, were taken out again the same day
(migration 0038) and are not to come back as EV8 Ops features. The one thing of
the site's that lives here is the request form's `POST /api/site/queue` (accepted
by Mika on 07.10.2026). Before that (28.09.2026): "two people drive development, both merge
into `develop`" — `docs/onboarding.md` describes that arrangement and is kept for
the record.

Development here is driven by Mika's session, in `feature/*` branches merged into
`develop`. The way of working is Self Platform's (Mika, 28.09.2026):
**after a merge into `develop`, Mika's session puts it on the test stand at once**
(`ssh root@204.168.149.105 /srv/ev8-ops/deploy/follow-develop.sh --now`);
**a release reaches prod only on Mika's word**, and **since 12.10.2026 Mika runs it
himself with one line the session gives him** — `deploy/release.sh X.Y.Z "what it is"`
(`release/X.Y.Z`, versions, `main` with an annotated tag, back into `develop`, then
`deploy-prod.sh X.Y.Z` on the server and the test stand). That day the session's
permission system refused the release steps as a production deploy, and Mika chose
the command over lifting the guard; a session does not look for a way around it. The
session audits what `develop` holds beyond the last tag, reads production before and
after, and records the release in `docs/handoff.md`. `.githooks/pre-push` still
refuses a push of `main` or a tag from anyone but Mika. Product decisions stay with Mika; Kardu (GitHub `Kardu89`), the director on
site and the main daily user, proposes. Talk to whoever runs the session in the
language they write in.

## The repository is public (since 13.10.2026)
Mika made `mkodzya/ev8-ops` public on 13.10.2026 so that CI runs («пока оставим публичным»; the
project book and the site stay private). Everything pushed here — files, commit messages, branch
names — is read by anybody, at once and for good: the history cannot be taken back.
- **No real person's name, phone, personal number, address or account anywhere in it** — not in a
  comment, a test, a fixture, a type specimen, a QA report or a commit message. Every example is
  invented and says so. A customer is a row number of the reconciliation or a rental number.
- **No secret and nothing that opens a door**: no password, key or token; no value from a
  server's `.env`. The laptop's defaults in `.env.example` are public knowledge and must never
  be a stand's values.
- What is already in the history and cannot be removed: three customers' names (a type specimen
  since September, a QA report, a comment of 12.10.2026), two more customers' surnames (the
  handoff since 20.10.2026, taken out of the file on 22.10.2026), the server's address with its deploy
  commands, the Kommo account's address, debts by rental number. `docs/handoff.md` item 16.

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
   **Corrected by Mika on 07.10.2026:** Odoo holds no live data — it was an
   unfinished attempt and is no longer kept. What it gave is a draft, not the
   state of the business; the running rentals are entered anew (Kommo and the
   contracts in Drive are where they are written today). `docs/handoff.md` §2а.
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
- Time zone Asia/Tbilisi; rental periods are 7 calendar days from pickup; an owner may make
  the running week 1–6 days longer, and every later week follows (Mika, 21.10.2026; ADR-0041).
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
- **Механик в EV8 Ops** (ТЗ директора 19.10.2026, принято Микой 20.10.2026).
  `docs/spec/mechanic-in-erp.md`: механик ведёт ремонт с планшета, справочник
  работ, согласование, оплата механику по нормо-часам, плановое ТО; строится
  этапами по `docs/spec/mechanic-in-erp-plan.md`. Роли «механик» и «главный
  механик» добавляются к двум ролям 17.09.2026 (ADR-0032, 0033); «Зарплаты и
  HR» в ТЗ v1.1 вынесены за границы v1 — выплаты механику расходятся с ним
  осознанно.
