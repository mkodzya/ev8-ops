#!/usr/bin/env node
// Dictionary keys nobody reads.
//
// `i18n-guard.mjs` answers "does every language say the same things"; it
// cannot answer "does anybody ever look at this one". A key that is defined
// in ka, ru and en and read from nowhere is a line somebody still has to
// translate, review and carry (wave 5 §8, the tester's idea, 21.09.2026).
//
// How it reads the code:
//
//   * the shape comes from `en.ts` plus the wave dictionaries it spreads in —
//     every leaf path, e.g. `repair.statuses.draft`;
//   * a read is `t.<path>`, and `t` is not the only root: the dictionary is
//     also taken through `currentDict()` (`lib/use.ts`, `ds/form/operation.ts`),
//     so any variable assigned `currentDict()` or a subtree of it counts, and
//     so does any variable assigned a subtree of `t` (`const w = t.repair`);
//   * a table read by a computed key (`t.feedWords[x]`, `t.errors.codes[code]`)
//     marks the whole subtree as read — its keys are checked against what the
//     server can send, not against the code.
//
// It prints what looks unread and exits 0: a dictionary is cleaned by a
// decision, not by a script. Only `--check` makes it fail, and nothing runs
// it that way yet.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const i18nDir = join(root, 'apps/web/src/i18n');

/** Every leaf path of an object literal, read from the source rather than evaluated. */
function paths(src, prefix = '') {
  const out = new Set();
  // A crude but sufficient walk: track brace depth and remember the key that
  // opened each level. The dictionaries are plain literals, one key per line.
  const stack = [];
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue;
    const opens = (line.match(/\{/g) ?? []).length;
    const closes = (line.match(/\}/g) ?? []).length;
    const key = line.match(/^'?([A-Za-z_$][\w.$-]*|[\w.]+)'?\s*:/)?.[1] ?? null;
    if (key && opens > closes) {
      stack.push(key);
      continue;
    }
    if (key) out.add([prefix, ...stack, key].filter(Boolean).join('.'));
    for (let i = 0; i < closes - opens; i++) stack.pop();
  }
  return out;
}

function sourceFiles(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, acc);
    else if (/\.tsx?$/.test(e.name)) acc.push(p);
  }
  return acc;
}

// ---- the shape ----
const shape = new Set();
for (const f of readdirSync(i18nDir).filter((f) => /^(en|wave\d|wave5-\w+)\.ts$/.test(f))) {
  const src = readFileSync(join(i18nDir, f), 'utf8');
  // Only the English half of a wave file: the three are the same shape.
  const en = src.split(/export const \w+(?:Ru|Ka)\b/)[0];
  for (const p of paths(en)) shape.add(p);
}

// ---- the reads ----
const code = sourceFiles(join(root, 'apps/web/src'));
const read = new Set();
const computed = new Set();
for (const f of code) {
  const src = readFileSync(f, 'utf8');
  // Roots: `t`, plus anything holding currentDict() or a subtree of either.
  const roots = new Map([['t', '']]);
  for (const m of src.matchAll(/const (\w+) = currentDict\(\)((?:\.\w+)*)/g)) roots.set(m[1], m[2].replace(/^\./, ''));
  for (const m of src.matchAll(/const (\w+) = t((?:\.\w+)+)/g)) roots.set(m[1], m[2].replace(/^\./, ''));
  for (const [name, base] of roots) {
    const dotted = new RegExp(`\\b${name}((?:\\.[A-Za-z_$][\\w$]*)+)`, 'g');
    for (const m of src.matchAll(dotted)) read.add([base, m[1].replace(/^\./, '')].filter(Boolean).join('.'));
    const byKey = new RegExp(`\\b${name}((?:\\.[A-Za-z_$][\\w$]*)*)\\s*\\[`, 'g');
    for (const m of src.matchAll(byKey)) computed.add([base, m[1].replace(/^\./, '')].filter(Boolean).join('.'));
  }
}

const isRead = (path) => {
  if (read.has(path)) return true;
  // A parent read as a whole (`{...t.money}`) or by computed key covers it.
  for (const p of [...read, ...computed]) if (p && (path === p || path.startsWith(`${p}.`))) return true;
  return false;
};

const unread = [...shape].filter((p) => !isRead(p)).sort();
const byTable = new Map();
for (const p of unread) {
  const table = p.split('.').slice(0, 2).join('.');
  byTable.set(table, (byTable.get(table) ?? 0) + 1);
}

if (unread.length === 0) {
  console.log(`i18n-unused: clean — every one of ${shape.size} keys is read somewhere.`);
} else {
  console.log(`i18n-unused: ${unread.length} of ${shape.size} keys are read nowhere.\n`);
  for (const p of unread) console.log(`  ${p}`);
  console.log('\nby table:');
  for (const [table, n] of [...byTable].sort((a, b) => b[1] - a[1])) console.log(`  ${table}: ${n}`);
  console.log('\nThis is a list to decide on, not to delete from. A key may be read');
  console.log('through a computed key this script did not see, or live only in');
  console.log('/design, which shows components on real strings.');
}
process.exit(process.argv.includes('--check') && unread.length > 0 ? 1 : 0);
