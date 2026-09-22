/**
 * Every action the journal can print has words in every language (QA-W6-09).
 *
 * The API writes what happened as a code — `payment.record`, `vehicle.pool` —
 * and both the feed on a card and the journal turn that code into a sentence
 * from `feedWords`. A code with no sentence reaches a person as
 * `periods.roll`, which is not an answer to "что". So this reads the API and
 * the migrations as text, collects every action they can write, and fails
 * when a dictionary lacks one — or keeps one the product no longer writes,
 * so the list does not rot.
 *
 *   node scripts/actions-guard.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const API = 'apps/api/src';
const MIGRATIONS = 'apps/api/migrations';
const DICT = 'apps/web/src/i18n/wave4.ts';
const LANGS = ['en', 'ru', 'ka'];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'generated' ? [] : walk(p);
    return name.endsWith('.ts') ? [p] : [];
  });
}

/**
 * An action looks like `a.b`; a lone word is a decision or a column, not an
 * action. A segment may be camelCase — `customer.personalId.view` is one.
 */
const ACTION = /'([a-z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+)'/g;

const written = new Set();
for (const file of walk(API)) {
  const src = readFileSync(file, 'utf8');
  // Up to a line or so after `action:` — enough for a ternary that picks
  // between two of them, not enough to swallow the next field.
  for (const m of src.matchAll(/action:\s*([^\n]{0,160})/g)) {
    for (const a of m[1].matchAll(ACTION)) written.add(a[1]);
  }
}
for (const name of readdirSync(MIGRATIONS)) {
  if (!name.endsWith('.sql')) continue;
  const src = readFileSync(join(MIGRATIONS, name), 'utf8');
  // A migration that writes its own journal row names the action beside the
  // table it writes to.
  if (!/insert\s+into\s+audit_log/i.test(src)) continue;
  for (const a of src.matchAll(ACTION)) written.add(a[1]);
}

const src = readFileSync(DICT, 'utf8');
const lines = src.split('\n');
const starts = lines.flatMap((l, i) => (l === '  feedWords: {' ? [i] : []));
let failed = false;
if (starts.length !== LANGS.length) {
  console.error(`actions-guard: ${DICT} holds ${starts.length} feedWords blocks, expected ${LANGS.length}`);
  process.exit(1);
}

starts.forEach((start, i) => {
  const lang = LANGS[i];
  const have = new Set();
  for (let j = start + 1; j < lines.length && !lines[j].startsWith('  }'); j++) {
    const m = lines[j].match(/^ {4}'([^']+)':/);
    if (m) have.add(m[1]);
  }
  const missing = [...written].filter((a) => !have.has(a)).sort();
  const stale = [...have].filter((a) => !written.has(a)).sort();
  if (missing.length) {
    console.error(`actions-guard: ${lang} has no words for: ${missing.join(', ')}`);
    failed = true;
  }
  if (stale.length) {
    console.error(`actions-guard: ${lang} keeps words for actions nobody writes: ${stale.join(', ')}`);
    failed = true;
  }
});

if (failed) process.exit(1);
console.log(`actions-guard: clean — ${written.size} journal actions, each with words in ${LANGS.length} languages.`);
