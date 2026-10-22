/**
 * One concept, one word (issue #9, 23.10.2026).
 *
 * The director's glossary gave 41 concepts one word each in ka, ru and en, and
 * took the old words out of every dictionary: the same word had named two
 * things — «ჯარიმა» any charge, «გაცემა» the moped and the deposit,
 * «Состояние» the status and the condition, «Парк» the fleet and the
 * assignment — or two words had named one. A string written tomorrow from
 * habit brings an old word back, and nothing else notices: the dictionaries
 * type-check either way. So this reads every string literal in the
 * dictionaries and fails on a word the glossary retired, or on a word kept for
 * one thing used for the other.
 *
 * The lists are the issue's own («Слова, закреплённые за одним понятием»),
 * Georgian and Russian; English followed the Georgian where it had the same
 * confusion but has no list. A rule reads a string only when the string is in
 * the rule's alphabet. Comments are not read: they may name the old word to
 * say why it went.
 *
 *   node scripts/words-guard.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'apps/web/src/i18n';
const ALPHABET = { ka: /[\u10A0-\u10FF]/u, ru: /[\u0400-\u04FF]/u };

/**
 * `word` is the retired word (any of its forms), `use` what the glossary says
 * instead. A word kept for one thing has `keeps(text)`: true when the string
 * uses it for that thing.
 */
const RULES = [
  // Georgian: nowhere.
  { lang: 'ka', word: /გამოი?სყიდ/u, use: 'buy-out from the rental is «ქირიდან შეძენა», buy-back «უკან შესყიდვა» (items 7, 8)' },
  { lang: 'ka', word: /შენატან/u, use: 'a payment of an instalment plan is «განვადების გადახდა» (item 2)' },
  {
    lang: 'ka',
    word: /გად(?:მო)?(?:ა|ი|ვი|აი|ავი)?ტან/u,
    use: 'what began before the system is «EV8 Ops-მდე»; a moped moves between assignments by «გადაყვანა» (items 1, 9)',
  },
  { lang: 'ka', word: /გირაო/u, use: 'a deposit is «დეპოზიტი» (item 4)' },
  { lang: 'ka', word: /გა(?:სა)?ყოფ|გაიყო(?!ლ)/u, use: 'a bank line is allocated — «განაწილება» (item 27)' },
  { lang: 'ka', word: /წერტილ/u, use: 'where a moped stands is «ადგილი» (items 19–20)' },
  { lang: 'ka', word: /სიჩუმ/u, use: 'days without movement are «უმოძრაოდ» (item 21)' },
  { lang: 'ka', word: /იჯარ/u, use: 'a rental is «ქირაობა», the renter «მოქირავე» (item 41)' },
  { lang: 'ka', word: /მოქირავნ/u, use: 'the renter is «მოქირავე» (item 41)' },
  // Georgian: one thing only.
  {
    lang: 'ka',
    word: /(?<!ტექნიკური )მდგომარეობ/u,
    use: 'a moped’s status is «სტატუსი»; «მდგომარეობა» only in «ტექნიკური მდგომარეობა» (items 17, 18)',
  },
  {
    lang: 'ka',
    word: /შე(?:ტან|ვიტან|იტან)/u,
    keeps: (text) => text.includes('ბანკ'),
    use: '«შეტანა» is cash paid into the bank only; data is entered — «შეყვანა» (item 3)',
  },
  {
    lang: 'ka',
    word: /ჯარიმ/u,
    keeps: (text) => /^ჯარიმ(?:ა|ები)$/u.test(text.trim()),
    use: 'a charge is «დარიცხვა»; «ჯარიმა» only as the kind of charge, a label of its own (item 26)',
  },
  {
    lang: 'ka',
    word: /გას?ცემ|გაიცა|გაუცი/u,
    // A deposit is returned. The hand-over wizard may still name the deposit it takes.
    keeps: (text) => !text.includes('დეპოზიტ') || text.includes('გაცემის ოსტატ'),
    use: 'a deposit is returned — «დეპოზიტის დაბრუნება»; «გაცემა» is the moped’s hand-over (items 5, 6)',
  },
  {
    lang: 'ka',
    word: /(?<!ხელზე )გასაცემ/u,
    // Batteries handed out with a moped, not money.
    keeps: (text) => text.includes('ვიდრე გასაცემია'),
    use: 'money handed over is «ხელზე გასაცემი» (item 40)',
  },
  // Russian.
  {
    lang: 'ru',
    word: /(?<!тех)состояни/iu,
    use: 'a moped’s status is «Статус»; «состояние» only as «техсостояние» (items 17, 18)',
  },
  {
    lang: 'ru',
    word: /парк\S*\s+(?:аренды|продажи)|без\s+парка|(?:оба|другой|другом)\s+парк|парк\S*\s+не\s+реш|(?:решить|изменён|изменить|смена)\s+парк/iu,
    use: 'a moped’s assignment is «Назначение»; «парк» is the whole fleet only (item 9)',
  },
  {
    lang: 'ru',
    word: /выкуп/iu,
    keeps: (text) => /обратн|из аренды/iu.test(text),
    use: 'the company buying a sold moped back is «обратный выкуп»; bare «выкуп» is the renter’s «выкуп из аренды» (items 7, 8)',
  },
  {
    lang: 'ru',
    word: /выда/iu,
    keeps: (text) => !/залог/iu.test(text) || /мастер\S* выдачи/iu.test(text),
    use: 'a deposit is returned — «вернуть / возврат»; «выдать / выдача» is the moped and cash (item 5)',
  },
];

/**
 * Every string literal in a source file, with the line it starts on: quoted
 * strings, and the text of a template literal with `${…}` for each expression
 * (a string inside an expression is a literal of its own). Comments are skipped.
 */
function literals(src) {
  const out = [];
  const n = src.length;
  let i = 0;
  let line = 1;

  function quoted(q) {
    const start = line;
    let text = '';
    i += 1;
    while (i < n && src[i] !== q) {
      if (src[i] === '\\') {
        text += src.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (src[i] === '\n') line += 1;
      text += src[i];
      i += 1;
    }
    i += 1;
    out.push({ line: start, text });
  }

  function template() {
    const start = line;
    let text = '';
    i += 1;
    while (i < n && src[i] !== '`') {
      if (src[i] === '\\') {
        text += src.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (src[i] === '$' && src[i + 1] === '{') {
        text += '${…}';
        i += 2;
        code(1);
        continue;
      }
      if (src[i] === '\n') line += 1;
      text += src[i];
      i += 1;
    }
    i += 1;
    out.push({ line: start, text });
  }

  // Reads code; inside a template's `${`, returns after the brace that closes it.
  function code(depth) {
    while (i < n) {
      const c = src[i];
      if (c === '\n') {
        line += 1;
        i += 1;
      } else if (c === '/' && src[i + 1] === '/') {
        while (i < n && src[i] !== '\n') i += 1;
      } else if (c === '/' && src[i + 1] === '*') {
        const end = src.indexOf('*/', i + 2);
        const stop = end < 0 ? n : end + 2;
        line += src.slice(i, stop).split('\n').length - 1;
        i = stop;
      } else if (c === "'" || c === '"') {
        quoted(c);
      } else if (c === '`') {
        template();
      } else if (c === '{') {
        if (depth) depth += 1;
        i += 1;
      } else if (c === '}') {
        i += 1;
        if (depth) {
          depth -= 1;
          if (depth === 0) return;
        }
      } else {
        i += 1;
      }
    }
  }

  code(0);
  return out;
}

// The dictionaries are .ts; index.tsx is the provider, and its JSX is not a string.
const files = readdirSync(DIR)
  .filter((name) => name.endsWith('.ts'))
  .sort()
  .map((name) => join(DIR, name));

const findings = [];
let read = 0;
for (const file of files) {
  for (const { line, text } of literals(readFileSync(file, 'utf8'))) {
    read += 1;
    for (const rule of RULES) {
      if (!ALPHABET[rule.lang].test(text) || !rule.word.test(text)) continue;
      if (rule.keeps?.(text)) continue;
      findings.push(`${file}:${line}: «${text}» — ${rule.use}`);
    }
  }
}

if (findings.length) {
  console.error(`words-guard: ${findings.length} retired ${findings.length === 1 ? 'word' : 'words'} in the dictionaries:`);
  for (const f of findings) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`words-guard: clean — ${read} strings in ${files.length} dictionaries, ${RULES.length} rules from issue #9.`);
