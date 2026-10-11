/**
 * Every refusal the API can send has words in every language (B1-02).
 *
 * The API speaks in codes (`vehicle_not_available`); the screen turns a code
 * into a sentence from `errors.codes` in the dictionaries. A code with no
 * sentence reaches a person as "It didn't work (vehicle_not_available)" —
 * so this reads the API as text, collects every code it can answer with, and
 * fails when a dictionary lacks one. Also fails on a sentence for a code the
 * API no longer sends, so the list does not rot.
 *
 *   node scripts/errors-guard.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const API = 'apps/api/src';
const DICTS = ['en', 'ru', 'ka'].map((l) => [l, `apps/web/src/i18n/${l}.ts`]);

/**
 * Codes a person never meets in EV8 Ops: the worker's own door, and the public
 * site's (`/api/site/*`), whose answers the site turns into its own words.
 */
const INTERNAL = new Set(['bad_worker_token', 'bad_site_request', 'bad_site_hit', 'site_mail_off', 'site_too_many', 'site_mail_failed']);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'generated' ? [] : walk(p);
    return name.endsWith('.ts') ? [p] : [];
  });
}

const sent = new Set();
for (const file of walk(API)) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/\b(?:badRequest|forbidden|notFound|conflict|unprocessable)\(\s*'([a-z0-9_]+)'/g)) sent.add(m[1]);
  for (const m of src.matchAll(/new ApiError\(\s*\d+\s*,\s*'([a-z0-9_]+)'/g)) sent.add(m[1]);
  for (const m of src.matchAll(/\berror:\s*'([a-z0-9_]+)'/g)) sent.add(m[1]);
}
for (const code of INTERNAL) sent.delete(code);

let failed = false;
for (const [lang, file] of DICTS) {
  const src = readFileSync(file, 'utf8');
  const block = src.match(/\n {4}codes: \{\n([\s\S]*?)\n {4}\},/);
  if (!block) {
    console.error(`errors-guard: ${file} has no errors.codes block`);
    failed = true;
    continue;
  }
  const have = new Set([...block[1].matchAll(/^ {6}([a-z0-9_]+):/gm)].map((m) => m[1]));
  const missing = [...sent].filter((c) => !have.has(c)).sort();
  const stale = [...have].filter((c) => !sent.has(c)).sort();
  if (missing.length) {
    console.error(`errors-guard: ${lang} has no words for: ${missing.join(', ')}`);
    failed = true;
  }
  if (stale.length) {
    console.error(`errors-guard: ${lang} explains codes the API never sends: ${stale.join(', ')}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`errors-guard: clean — ${sent.size} API codes, each with words in ${DICTS.length} languages.`);
