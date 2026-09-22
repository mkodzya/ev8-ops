/**
 * No hook after an early return (QA-W6-17).
 *
 * React counts hooks by the order they run. A component that returns early
 * while something loads, and then calls `useRef` further down, runs fewer
 * hooks on its first render than on its second — React answers with error
 * #310 and the screen goes white. That is what happened to the return wizard:
 * two hooks were added in the middle of a component whose top holds three
 * early returns, and the whole screen stopped opening.
 *
 * The real tool for this is eslint's `react-hooks/rules-of-hooks`, which the
 * repository has no linter for. This is the narrow check that matters: inside
 * a component, a `use…()` call at the body's own level, after a `return` at
 * that same level.
 *
 *   node scripts/hooks-guard.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const WEB = 'apps/web/src';

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return name.endsWith('.tsx') ? [p] : [];
  });
}

/** `export function Name(` / `function Name(` at the start of a line. */
const COMPONENT = /^(?:export )?function ([A-Z]\w*)/;
/**
 * A hook called at the body's own level: `  const x = useThing(`,
 * `  useThing(`, or `  const x = useThing<T>(` — the type argument is part of
 * how half of them are written here.
 */
const HOOK = /^ {2}(?:const [^=]+=\s*)?(use[A-Z]\w*)(?:<[^>]*>)?\s*\(/;
/** A return at the body's own level, with or without a condition before it. */
const EARLY_RETURN = /^ {2}(?:if \([^)]*\)\s*)?return[\s;(]/;

let failed = false;
for (const file of walk(WEB)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  let inComponent = null;
  let returnedAt = 0;
  lines.forEach((line, i) => {
    const start = line.match(COMPONENT);
    if (start) {
      inComponent = start[1];
      returnedAt = 0;
      return;
    }
    if (!inComponent) return;
    if (line === '}') {
      inComponent = null;
      return;
    }
    if (EARLY_RETURN.test(line) && !returnedAt) returnedAt = i + 1;
    const hook = line.match(HOOK);
    if (hook && returnedAt) {
      console.error(`hooks-guard: ${file}:${i + 1} — ${inComponent} calls ${hook[1]}() after the return on line ${returnedAt}. Move it above every early return.`);
      failed = true;
    }
  });
}

if (failed) process.exit(1);
console.log('hooks-guard: clean — no hook stands after an early return.');
