/**
 * Find English written straight into a component.
 *
 * The dictionaries already have one guard: `en.ts` fixes the shape of `Dict`,
 * so a key ka.ts or ru.ts forgets is a type error and the build stops. That
 * catches a missing translation. It cannot catch the opposite — a string
 * typed into JSX instead of looked up — because nothing is missing then.
 *
 * So this reads the components as text and reports prose that never went
 * through the dictionary. Deliberately conservative: two or more Latin words,
 * or one long one, with an allow-list for words that are the same in every
 * language. Copied from Self Platform, allow-list adjusted for EV8.
 *
 *   node scripts/i18n-guard.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'apps/web/src';
const SKIP_DIRS = new Set(['i18n', 'generated']);

/** Words nobody translates, in any of the three languages. */
const ALLOW = new Set([
  'EV', 'EV8', 'Ops', 'ops', // the wordmark
  'VIN', 'GEL', 'WhatsApp', 'Odoo', 'Kommo', 'BOG', 'TBC',
  'PNG', 'JPEG', 'WebP', 'PDF', 'CSV', 'XLSX',
  'ID', 'URL', 'API', 'UTC',
]);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIRS.has(name)) out.push(...walk(p));
    } else if (name.endsWith('.tsx')) {
      out.push(p);
    }
  }
  return out;
}

// Anything outside Latin has been through a dictionary already: Georgian,
// Cyrillic, and the marks the mono meta is built from.
const NON_LATIN = /[Ͱ-῿℀-￿]/;
const CODEY = /[;=(){}[\]|`$*&\\]|\/\/|=>/;
const PROPERTY_ACCESS = /^[A-Za-z_$][\w$]*\s*\.\s*[A-Za-z_$][\w$]*$/;
const LONE_TYPE_NAME = /^[A-Z][A-Za-z]+$/;
const OPENS_A_BLOCK =
  /^(catch|finally|else|try|do|while|switch|default|case|return|interface|type|enum|class|function|const|let|var|export|import|extends|implements)\b/;

function isProse(raw) {
  const text = raw.replace(/&[a-z]+;|&#\d+;/g, ' ').trim();
  if (!text) return false;
  if (NON_LATIN.test(text)) return false;
  if (CODEY.test(text)) return false;
  if (PROPERTY_ACCESS.test(text) || LONE_TYPE_NAME.test(text)) return false;
  if (OPENS_A_BLOCK.test(text)) return false;
  const words = (text.match(/[A-Za-z][A-Za-z'’-]*/g) ?? []).filter((w) => !ALLOW.has(w));
  if (words.length === 0) return false;
  return words.length >= 2 || words[0].length >= 5;
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

const findings = [];
for (const file of walk(ROOT)) {
  const src = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));

  for (const m of src.matchAll(/[>}]([^<>{}]+)[<{]/g)) {
    if (isProse(m[1])) findings.push({ file, line: lineOf(src, m.index), text: m[1].trim(), how: 'text in markup' });
  }
  for (const m of src.matchAll(/\b(placeholder|title|aria-label|alt)="([^"]+)"/g)) {
    if (isProse(m[2])) findings.push({ file, line: lineOf(src, m.index), text: m[2], how: `attribute ${m[1]}` });
  }
}

if (findings.length === 0) {
  console.log('i18n guard: clean — no English outside the dictionaries.');
  process.exit(0);
}
console.error(`i18n guard: ${findings.length} line(s) bypass the dictionary\n`);
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}  (${f.how})`);
  console.error(`    ${f.text.replace(/\s+/g, ' ').slice(0, 130)}`);
}
process.exit(1);
