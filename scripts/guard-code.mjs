/**
 * Two rules that are cheap to keep and expensive to lose.
 *
 * 1. No colour literal outside the generated token files.
 *    A design system survives exactly as long as nobody writes `#557553` into
 *    a component. Tuff Stuff's audit on 11.09.2026 found 694 literals against
 *    46 `var()` calls — by then the tokens were decoration. The values live in
 *    packages/shared/tokens.json; the interface reads `var(--accent)`, the PDF
 *    writer reads `tokens.accent`.
 *
 * 2. No var(--…) pointing at a token that does not exist.
 *    An unknown custom property is not an error anywhere: the declaration is
 *    dropped and the element quietly inherits. That is how `--text-h1` — a
 *    name the generator never produced — left every heading at body size on a
 *    page that otherwise looked finished.
 *
 * 3. No user input interpolated into SQL.
 *    Prisma's tagged `$queryRaw` is parameterised and fine; the `...Unsafe`
 *    variants take a built string and are not. There is no raw SQL in this
 *    codebase today, and this is what keeps it that way (APECS SEC-001).
 *
 *   node scripts/guard-code.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['apps/api/src', 'apps/web/src', 'apps/worker/src', 'packages/shared/src'];
const SKIP_DIRS = new Set(['generated', 'assets']);

/** Generated from tokens.json — the one place a colour value may be written out. */
const TOKEN_FILES = new Set(['apps/web/src/styles/tokens.css', 'packages/shared/src/tokens.ts']);

const EXT = /\.(ts|tsx|css|mjs|js)$/;

function files(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) out.push(...files(path));
    } else if (EXT.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

const DECLARED = /(--[a-z0-9-]+)\s*:/g;
const USED = /var\(\s*(--[a-z0-9-]+)/g;

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const RGB = /\brgba?\(/g;
const UNSAFE_SQL = /\$(?:query|execute)RawUnsafe\b/g;
/**
 * A date or a time drawn from the reader's own clock. Everything the product
 * records happened on the company's day (CLAUDE.md, Asia/Tbilisi), and
 * `localDateTime`/`todayISO` are how you say so. For an owner in London the
 * two differ after midnight: the journal printed a UTC date beside a London
 * time and named a day that never existed (QA-W6-18). Nobody testing from
 * Tbilisi can see this, which is exactly why it is checked here.
 */
const READER_CLOCK = /\.toLocale(?:Date|Time|)String\s*\(/g;
/**
 * A calendar day cut out of an instant's ISO string, which names the UTC day.
 * Between 20:00 UTC and midnight that is yesterday in Tbilisi, so a card's
 * feed put a return on the 21st beside the act it produced on the 22nd
 * (QA-W6-19). `dayOf()` in the API, `localDateTime()` on a screen.
 */
const UTC_DAY = /toISOString\(\)\.slice\(0, ?10\)/g;
/**
 * The same cut made on a timestamp as the API hands it over, a string already:
 * `p.createdAt.slice(0, 10)`, `j.at.slice(0, 10)`. The payment's page said
 * «Внёс …, 22.10.2026 01:08» for a payment made at 01:08 on the 23rd in
 * Tbilisi, and had since 18.09 (QA after issue #7, 23.10.2026). A moment's
 * field is named `…At` or `at`; a day's is `…On` and is cut by nobody.
 * `fmtDateAt()`/`localDateTime()` on a screen, `todayISO(new Date(at))` in
 * shared code, `dayOf()` in the API. No file is excused: a timestamp's first
 * ten characters are the UTC day everywhere.
 */
const UTC_DAY_OF_MOMENT = /\b(?:[a-z]\w*At|at)\??\.slice\(0, ?10\)/g;
/**
 * Where a UTC day is the answer: `isoDate` reads `date` columns, which Prisma
 * hands back at UTC midnight and which carry no time to get wrong, and the
 * shared modules do calendar arithmetic on date-only values in UTC on purpose.
 */
const UTC_DAY_OK = new Set([
  'apps/api/src/lib/dates.ts',
  'apps/api/src/routes/today.ts',
  'packages/shared/src/time.ts',
  'packages/shared/src/week.ts',
  'packages/shared/src/payments.ts',
]);

const problems = [];

// Every custom property this codebase declares, wherever it declares it: the
// generated token file, and the handful a stylesheet defines for itself.
const declared = new Set();
const uses = [];

for (const root of ROOTS) {
  for (const path of files(root)) {
    // Comments are blanked, not removed, so line numbers stay true. A rule
    // written out in prose — `var(--text-…)`, `#557553` as an example — is
    // documentation, and reporting it would teach people to stop explaining.
    const text = readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      const where = `${path}:${i + 1}`;
      if (!TOKEN_FILES.has(path)) {
        for (const m of line.matchAll(HEX)) {
          problems.push(`${where}  colour literal ${m[0]} — use var(--…) or tokens.… (packages/shared/tokens.json)`);
        }
        for (const m of line.matchAll(RGB)) {
          problems.push(`${where}  colour literal ${m[0]}…) — add it to packages/shared/tokens.json and use the token`);
        }
      }
      for (const m of line.matchAll(DECLARED)) declared.add(m[1]);
      for (const m of line.matchAll(USED)) uses.push({ name: m[1], where });
      for (const m of line.matchAll(UNSAFE_SQL)) {
        problems.push(`${where}  ${m[0]} builds SQL from a string — use the tagged $queryRaw\`…\` or the Prisma client`);
      }
      if (path.startsWith('apps/web/src')) {
        for (const m of line.matchAll(READER_CLOCK)) {
          problems.push(`${where}  ${m[0].trim()} reads the device's clock — say the company's day with localDateTime() or todayISO()`);
        }
      }
      if (!UTC_DAY_OK.has(path)) {
        for (const m of line.matchAll(UTC_DAY)) {
          problems.push(`${where}  ${m[0]} names the UTC day, not the company's — dayOf() in the API, localDateTime() on a screen`);
        }
      }
      for (const m of line.matchAll(UTC_DAY_OF_MOMENT)) {
        problems.push(`${where}  ${m[0]} cuts the UTC day out of a timestamp — fmtDateAt() or localDateTime() on a screen, dayOf() in the API`);
      }
    });
  }
}

for (const use of uses) {
  if (!declared.has(use.name)) {
    problems.push(`${use.where}  var(${use.name}) — no token declares it, so the declaration is dropped silently`);
  }
}

if (problems.length) {
  console.error(`guard-code: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(
  `guard-code: clean — no colour literals outside the token files, ` +
    `${uses.length} var() uses all resolve, no unsafe raw SQL, every day the company's`,
);
