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
 * Most rules read the text alone. Three concepts are named by short labels that
 * do not say what they are about — «Вернуть», «К возврату», «Назначение»,
 * «Погашено» — so those rules read the key the string is the value of
 * (`deposits.handBack`) and refuse the old word there whatever the string says.
 *
 * Issue #18 of the director, part B (28.10.2026), added the words of the
 * audit: the money form has one name, «Принять оплату» («Принять наличные»
 * for whoever enters no bank money); the hand-over, the return and the swap
 * are «Выдать мопед», «Вернуть мопед», «Заменить мопед»; the repairs are
 * «Ремонты» and the status «В ремонте»; a customer's money on no rental is
 * «Аванс клиента»; cash into the bank is «Внесение наличных в банк»; one
 * line over several records is «Несколько услуг» both ways; goods are
 * «Товары»; the schedule's first tab is «К звонку», not a second «Сегодня»;
 * Settings' categories are «Статьи расходов» and «Статьи доходов». The
 * Russian words moved; in Georgian nine strings took the word Kardu already
 * had for the concept (docs/qa/issue-18-b-simplify-ka-strings.md, §2, for his
 * check) and no new one came in, so these rules are Russian.
 *
 *   node scripts/words-guard.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'apps/web/src/i18n';
const ALPHABET = { ka: /[\u10A0-\u10FF]/u, ru: /[\u0400-\u04FF]/u };

/**
 * The keys that name a deposit going back to the customer (item 5): the
 * buttons, columns, chips and toasts of the money form, the Deposits screen,
 * the return wizard, the expense line and the week's report.
 */
const DEPOSIT_BACK = new RegExp(
  '^(?:' +
    [
      'money\\.(?:tillMinus(?:Need|Ok)?|payOutFor|payOut|paidOut|toHandBack|chipToHandBack|kinds\\.deposit_payout)',
      'deposits\\.(?:to_hand_back|handBack|paidOutCol|returnedOn|decidedAll|decidedPart)',
      'back\\.payOut',
      'rentalMoney\\.paidOut',
      'exp\\.(?:deposit\\w*|toHandBack|looksLikeDeposit)',
      'weekReport\\.depositsOut',
      'drive\\.todayPaidBack',
      'errors\\.codes\\.(?:bad_channel|over_held)',
      'feedWords\\.statement\\.line\\.pay_out',
      'depositRevise\\.(?:payouts|rows\\.(?:back|paidOut)|journal\\.(?:backTetri|paidOutTetri))',
    ].join('|') +
    ')$',
  'u',
);

/**
 * The keys that name a moped's assignment, rental or sale (item 9). «Парк» /
 * «პარკი» stays the whole fleet — the tab, «в парке», «выбыл из парка».
 */
const ASSIGNMENT = new RegExp(
  '^(?:' +
    [
      '(?:fleet|receipt)\\.pool',
      'vehicle\\.events\\.to_(?:rent|sale)',
      'pools\\.(?:moved|rent|sale|none|move|menuToRent|menuToSale|bothWays|decidedOnExit)',
      'hand\\.(?:poolUndecided|showSale|hideSale|saleConfirm)',
      'sell\\.(?:forSale|movePool|movePoolNote)',
      'today\\.(?:actions\\.set_pool|noPool)',
      'feedWords\\.vehicle\\.pool(?:\\.undo)?',
      'errors\\.codes\\.(?:vehicle_in_rent_pool|vehicle_in_sale_pool|too_late|nothing_to_undo)',
      '(?:utilisationReport|weekReport)\\.(?:subtitle|noFigure|unassigned|basis|free)',
    ].join('|') +
    ')$',
  'u',
);

/**
 * The keys that name what a payment pays off (item 30): the money form's block
 * and the hand-over's lines before it is taken (what it pays off, and what an
 * overpayment will pay off next), the payment page's block and the toast
 * after. «Закрыть» / «დახურვა» stays a repair's, a rental's and a sale's word,
 * so the rule reads these keys and no others (QA after issue #9).
 */
const SETTLED = /^(?:money\.settles|hand\.(?:settles|overpay)|paymentPage\.settled|payments\.(?:allocated|recorded))$/u;

/** The labels of the return wherever it stands: «Вернуть мопед», never a bare «Возврат» (issue #18, B2). */
const RETURN_ACTION = /^(?:actions\.returnRental|shell\.actions\.return|today\.actions\.return)$/u;

/**
 * `word` is the retired word (any of its forms), `use` what the glossary says
 * instead. A word kept for one thing has `keeps(text)`: true when the string
 * uses it for that thing. A rule with `at` reads only the strings whose key
 * matches it.
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
    // A deposit is returned. The hand-over wizard may still name the deposit it
    // takes. A document issued and a bank's export file are another sense of the
    // verb, which the director's patch left as it was (ka-strings doc, question 5).
    keeps: (text) => !text.includes('დეპოზიტ') || text.includes('გაცემის ოსტატ'),
    use: 'a deposit is returned — «დეპოზიტის დაბრუნება»; «გაცემა» is the moped’s hand-over (items 5, 6)',
  },
  {
    lang: 'ka',
    at: DEPOSIT_BACK,
    word: /გა(?:სა|ს)?ცემ|გაიცა|გაუცი/u,
    use: 'a deposit is returned — «დაბრუნება», «დასაბრუნებელი», «დაბრუნებული» (item 5)',
  },
  {
    lang: 'ka',
    at: ASSIGNMENT,
    word: /პარკ(?!ირ)/u,
    use: 'a moped’s assignment is «დანიშნულება: ქირავნობა / გაყიდვა»; «პარკი» is the whole fleet only (item 9)',
  },
  {
    lang: 'ka',
    at: SETTLED,
    word: /დახურ/u,
    use: 'what a payment pays off is «დაფარულია», before it is taken «დაფარავს» (item 30)',
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
    at: ASSIGNMENT,
    word: /парк(?!ов)/iu,
    use: 'a moped’s assignment is «Назначение: аренда / продажа»; «парк» is the whole fleet only (item 9)',
  },
  {
    lang: 'ru',
    at: SETTLED,
    word: /закр/iu,
    use: 'what a payment pays off is «Погашено», before it is taken «Погасит» (item 30)',
  },
  {
    lang: 'ru',
    word: /выда/iu,
    // A login given, a document issued: another sense of the verb, which the
    // director's patch left as it was (ka-strings doc, question 5).
    keeps: (text) => !/залог/iu.test(text) || /мастер\S* выдачи/iu.test(text),
    use: 'a deposit is returned — «вернуть / возврат»; «выдать / выдача» is the moped and cash (item 5)',
  },
  {
    lang: 'ru',
    at: DEPOSIT_BACK,
    word: /выда/iu,
    use: 'a deposit is returned — «Вернуть», «К возврату», «Возвращено» (item 5)',
  },
  // Issue #18, part B (28.10.2026).
  {
    lang: 'ru',
    word: /Принять деньги|Принять долг|Провести вручную|Провести платёж|Записать платёж/iu,
    use: 'the money form is «Принять оплату» — «Принять наличные» for whoever enters no bank money (issue #18 B1)',
  },
  {
    lang: 'ru',
    word: /Новая выдача|Оформить выдачу|Завести аренду|Принять возврат/iu,
    use: 'a moped is «Выдать мопед», «Вернуть мопед», «Заменить мопед» wherever it is asked (issue #18 B2)',
  },
  {
    lang: 'ru',
    at: RETURN_ACTION,
    word: /^Возврат$/u,
    use: 'the return as an action is «Вернуть мопед» (issue #18 B2)',
  },
  {
    lang: 'ru',
    word: /(?:^|[\s«(])(?:в |из )?сервис(?:е|а)?(?=$|[\s».,;)])|^Сервис$/iu,
    // A point may be called «сервис» out loud: the points' hint names it as an example.
    keeps: (text) => /склад, шоурум, сервис/u.test(text),
    use: 'the repairs are «Ремонты», a moped in them «В ремонте» (issue #18 B5)',
  },
  { lang: 'ru', word: /Аванс по аренде/iu, use: 'a customer’s money on no rental is «Аванс клиента» (issue #18 B5)' },
  {
    lang: 'ru',
    word: /Внёс в банк|Сдача наличных в банк/iu,
    use: 'cash paid into the bank is «Внесение наличных в банк»; «сдача» is the till’s (issue #18 B5)',
  },
  {
    lang: 'ru',
    at: /^sort\.(?:split|splitTitle)$/u,
    word: /^Разнести/u,
    use: 'one bank line over several records is «Несколько услуг», coming in and going out (issue #18 B5)',
  },
  { lang: 'ru', word: /Товары \/ запчасти/iu, use: 'goods are «Товары» (issue #18 B5)' },
  {
    lang: 'ru',
    at: /^shell\.tabs\.due$/u,
    word: /^Сегодня$/u,
    use: 'the schedule’s first tab is «К звонку»: «Сегодня» is the section (issue #18 B5)',
  },
  {
    lang: 'ru',
    at: /^(?:shell\.tabs\.(?:expenseItems|incomeItems)|exp\.title|inc\.settings\.title)$/u,
    word: /Поступлени|^Расходы$|Категории/u,
    use: 'Settings keeps «Статьи расходов» and «Статьи доходов»; «Поступления» is «Разобрать»’s and the report’s (issue #18 B5)',
  },
];

/**
 * Every string literal in a source file, with the line it starts on and the
 * object key it is the value of (`money.payOut`): quoted strings, and the
 * text of a template literal with `${…}` for each expression (a string
 * inside an expression is a literal of its own). Comments are skipped; a
 * quoted key is a key, not a string.
 */
function literals(src) {
  const out = [];
  const n = src.length;
  let i = 0;
  let line = 1;
  // One entry per open bracket, `${` included; an object's entry holds the key
  // last named in it.
  const open = [];
  // The last character of code read, outside strings and comments.
  let prev = '';

  const path = () =>
    open
      .filter((b) => b.ch === '{' && b.key)
      .map((b) => b.key)
      .join('.');
  // `{` or `,` just before, inside an object, `:` just after: a key.
  const atKey = () => open.at(-1)?.ch === '{' && (prev === '{' || prev === ',');
  const colonAhead = () => {
    let j = i;
    while (j < n && /\s/u.test(src[j])) j += 1;
    return src[j] === ':';
  };

  function quoted(q) {
    const start = line;
    const where = path();
    const key = atKey();
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
    prev = q;
    if (key && colonAhead()) open.at(-1).key = text;
    else out.push({ line: start, path: where, text });
  }

  function template() {
    const start = line;
    const where = path();
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
        open.push({ ch: '${', key: null });
        code();
        continue;
      }
      if (src[i] === '\n') line += 1;
      text += src[i];
      i += 1;
    }
    i += 1;
    prev = '`';
    out.push({ line: start, path: where, text });
  }

  // Reads code; inside a template's `${`, returns after the brace that closes it.
  function code() {
    while (i < n) {
      const c = src[i];
      if (c === '\n') {
        line += 1;
        i += 1;
      } else if (/\s/u.test(c)) {
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
      } else if (/[\w$]/u.test(c)) {
        const key = atKey();
        let word = '';
        while (i < n && /[\w$]/u.test(src[i])) word += src[i++];
        if (key && colonAhead()) open.at(-1).key = word;
        prev = word.at(-1);
      } else if (c === '{' || c === '(' || c === '[') {
        open.push({ ch: c, key: null });
        prev = c;
        i += 1;
      } else if (c === '}' || c === ')' || c === ']') {
        i += 1;
        prev = c;
        if (open.pop()?.ch === '${') return;
      } else {
        prev = c;
        i += 1;
      }
    }
  }

  code();
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
  for (const { line, path, text } of literals(readFileSync(file, 'utf8'))) {
    read += 1;
    for (const rule of RULES) {
      if (!ALPHABET[rule.lang].test(text) || !rule.word.test(text)) continue;
      if (rule.at && !rule.at.test(path)) continue;
      if (rule.keeps?.(text)) continue;
      findings.push(`${file}:${line}: ${path} «${text}» — ${rule.use}`);
    }
  }
}

if (findings.length) {
  console.error(`words-guard: ${findings.length} retired ${findings.length === 1 ? 'word' : 'words'} in the dictionaries:`);
  for (const f of findings) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`words-guard: clean — ${read} strings in ${files.length} dictionaries, ${RULES.length} rules from issues #9 and #18.`);
