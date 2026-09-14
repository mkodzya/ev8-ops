/**
 * One source for the design tokens.
 *
 * `packages/shared/tokens.json` holds the values; this writes the two forms
 * the code actually reads:
 *
 *   apps/web/src/styles/tokens.css   custom properties for the interface
 *   packages/shared/src/tokens.ts    the same values for the PDF writer,
 *                                    which draws into pdfkit and cannot ask
 *                                    a browser what `var(--ink)` means
 *
 * Both files are generated and committed, so a checkout builds without a
 * pre-step. CI runs `--check`, which regenerates into memory and fails if
 * what is committed has drifted from the JSON — the failure mode this is
 * here to prevent is someone editing the CSS and the token file quietly
 * meaning something else.
 *
 *   node scripts/tokens.mjs           write
 *   node scripts/tokens.mjs --check   compare, exit 1 on drift
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SOURCE = 'packages/shared/tokens.json';
const CSS_OUT = 'apps/web/src/styles/tokens.css';
const TS_OUT = 'packages/shared/src/tokens.ts';

const CHECK = process.argv.includes('--check');

/** camelCase -> kebab-case, digits counting as their own word: surface2 -> surface-2. */
function kebab(name) {
  return name
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/([a-zA-Z])(\d)/g, '$1-$2')
    .toLowerCase();
}

const spec = JSON.parse(readFileSync(SOURCE, 'utf8'));
const groups = spec.groups;

const all = groups.flatMap((g) => g.tokens);
const seen = new Set();
for (const t of all) {
  if (seen.has(t.name)) throw new Error(`tokens: ${t.name} is declared twice in ${SOURCE}`);
  seen.add(t.name);
}

const HEAD_LINES = [
  `EV8 Ops design tokens — generated from ${SOURCE}.`,
  'Do not edit by hand: run `node scripts/tokens.mjs` after changing the JSON.',
  'Source of the values: docs/design/brand.md (the ev8.ge theme).',
];
const CSS_HEAD = `/* ${HEAD_LINES.join('\n   ')} */`;
const TS_HEAD = HEAD_LINES.map((l) => `// ${l}`).join('\n');

/** Single quotes, like the rest of the TypeScript here. No token value carries one. */
function quote(value) {
  if (value.includes("'")) return JSON.stringify(value);
  return `'${value}'`;
}

function css() {
  const body = groups
    .map((g) => {
      const head = `  /* ${g.name} — ${g.note} */`;
      const lines = g.tokens.map((t) => `  --${kebab(t.name)}: ${t.value};${t.note ? ` /* ${t.note} */` : ''}`);
      return [head, ...lines].join('\n');
    })
    .join('\n\n');
  return `${CSS_HEAD}\n\n:root {\n${body}\n}\n`;
}

function ts() {
  const body = groups
    .map((g) => {
      const head = `  /** ${g.name} — ${g.note} */`;
      const lines = g.tokens.map((t) => `  ${t.name}: ${quote(t.value)},${t.note ? ` // ${t.note}` : ''}`);
      return [head, ...lines].join('\n');
    })
    .join('\n\n');
  return (
    `${TS_HEAD}\n\n` +
    `/**\n` +
    ` * The tokens as values, for code that draws outside the browser — today the\n` +
    ` * contract and act PDFs. In the interface use the custom properties in\n` +
    ` * apps/web/src/styles/tokens.css instead; importing colours into a component\n` +
    ` * would put the value back in two places.\n` +
    ` */\n` +
    `export const tokens = {\n${body}\n} as const;\n\n` +
    `export type TokenName = keyof typeof tokens;\n`
  );
}

const outputs = [
  [CSS_OUT, css()],
  [TS_OUT, ts()],
];

let drift = false;
for (const [path, want] of outputs) {
  if (!CHECK) {
    writeFileSync(path, want);
    console.log(`tokens: wrote ${path}`);
    continue;
  }
  let have = null;
  try {
    have = readFileSync(path, 'utf8');
  } catch {
    /* missing counts as drift */
  }
  if (have === want) {
    console.log(`tokens: ${path} matches ${SOURCE}`);
  } else {
    drift = true;
    console.error(`tokens: ${path} does not match ${SOURCE} — run \`node scripts/tokens.mjs\``);
  }
}

// The one colour that cannot be a custom property: <meta name="theme-color">
// paints the browser chrome before any stylesheet is read, so it carries a
// literal. It is checked against the token instead of being generated, in
// both modes — a page frame in one grey and a page body in another is the
// drift this exists to catch.
const HTML = 'apps/web/index.html';
const bg = all.find((t) => t.name === 'bg').value;
const themeColor = /<meta\s+name="theme-color"\s+content="([^"]+)"/.exec(readFileSync(HTML, 'utf8'));
if (!themeColor) {
  drift = true;
  console.error(`tokens: ${HTML} has no <meta name="theme-color"> to check against the bg token`);
} else if (themeColor[1] !== bg) {
  drift = true;
  console.error(`tokens: ${HTML} theme-color is ${themeColor[1]}, the bg token is ${bg}`);
} else {
  console.log(`tokens: ${HTML} theme-color matches the bg token`);
}

if (drift) process.exit(1);
