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
 * 2. No user input interpolated into SQL.
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

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const RGB = /\brgba?\(/g;
const UNSAFE_SQL = /\$(?:query|execute)RawUnsafe\b/g;

const problems = [];

for (const root of ROOTS) {
  for (const path of files(root)) {
    const text = readFileSync(path, 'utf8');
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
      for (const m of line.matchAll(UNSAFE_SQL)) {
        problems.push(`${where}  ${m[0]} builds SQL from a string — use the tagged $queryRaw\`…\` or the Prisma client`);
      }
    });
  }
}

if (problems.length) {
  console.error(`guard-code: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`guard-code: clean — no colour literals outside the token files, no unsafe raw SQL`);
