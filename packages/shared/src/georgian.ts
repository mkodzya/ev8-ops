// Georgian names, written the way each source writes them.
//
// A customer is ვაჟა ჯაფარიძე on their card. Bank of Georgia writes the same
// person into a statement line as `vaJa jafariZe` — the transliteration
// Georgian banks use, where თ is T, შ is S, ძ is Z and ხ is x. TBC writes
// them in Georgian. Odoo held both spellings in one string.
//
// So matching a payer to a customer means folding all of that to one form:
// transliterate Georgian to that scheme, lower-case it, drop everything that
// is not a letter, and compare the set of words — a bank writes surname
// first as often as not.
//
// The table is read off real statement lines, not invented: `Caricxva`
// (ჩარიცხვა), `daniSnuleba` (დანიშნულება), `gadmomricxavi` (გადმომრიცხავი),
// `mimRebi` (მიმღები), `naSTi` (ნაშთი), `sawyisi` (საწყისი).

const LETTERS: Record<string, string> = {
  ა: 'a', ბ: 'b', გ: 'g', დ: 'd', ე: 'e', ვ: 'v', ზ: 'z', თ: 'T', ი: 'i',
  კ: 'k', ლ: 'l', მ: 'm', ნ: 'n', ო: 'o', პ: 'p', ჟ: 'J', რ: 'r', ს: 's',
  ტ: 't', უ: 'u', ფ: 'f', ქ: 'q', ღ: 'R', ყ: 'y', შ: 'S', ჩ: 'C', ც: 'c',
  ძ: 'Z', წ: 'w', ჭ: 'W', ხ: 'x', ჯ: 'j', ჰ: 'h',
  // Letters dropped from the modern alphabet, still seen in older documents.
  ჱ: 'e', ჲ: 'y', ჳ: 'w', ჴ: 'x', ჵ: 'o', ჶ: 'f', ჷ: 'e', ჸ: 'y',
};

/** Georgian text in the transliteration Georgian banks use. */
export function transliterateGeorgian(text: string): string {
  let out = '';
  for (const ch of text) out += LETTERS[ch] ?? ch;
  return out;
}

/** One comparable form: transliterated, lower-case, letters and digits only. */
export function normaliseName(text: string): string[] {
  return transliterateGeorgian(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length > 1);
}

// ---------------------------------------------------------------------------
// The loose form: one spelling for a name however it was written
// ---------------------------------------------------------------------------
//
// The cards of this company's customers came from Kommo, and Kommo holds a
// name the way people type Georgian in Latin letters — `Khachapuridze`,
// `Shota` (an invented name, as every example here). A bank never writes
// that. TBC writes ხაჭაპურიძე; Bank of Georgia writes `xaWapuriZe` — its own
// scheme, where ხ is x and not kh, ჭ is W and not ch, შ is S and not sh. So a customer whose card has only the typed Latin name was a stranger
// to every statement line (12.10.2026: ten of the twelve renters on
// production).
//
// The loose form folds all three spellings to one. It is coarser than the
// alphabet on purpose: typed Latin cannot tell თ from ტ, ქ from კ and ყ, ფ
// from პ, ც from წ, ჩ from ჭ, so each pair is one sound here. Two surnames
// that differ only in such a pair would be one name — which is why the loose
// form is never a sign by itself: a name still needs two whole words, and a
// rule still needs its second sign (the debt of exactly this sum).

const LOOSE: Record<string, string> = {
  ა: 'a', ბ: 'b', გ: 'g', დ: 'd', ე: 'e', ვ: 'v', ზ: 'z', თ: 't', ი: 'i',
  კ: 'k', ლ: 'l', მ: 'm', ნ: 'n', ო: 'o', პ: 'p', ჟ: 'zh', რ: 'r', ს: 's',
  ტ: 't', უ: 'u', ფ: 'p', ქ: 'k', ღ: 'gh', ყ: 'k', შ: 'sh', ჩ: 'ch', ც: 'ts',
  ძ: 'dz', წ: 'ts', ჭ: 'ch', ხ: 'kh', ჯ: 'j', ჰ: 'h',
  ჱ: 'e', ჲ: 'i', ჳ: 'v', ჴ: 'kh', ჵ: 'o', ჶ: 'p', ჷ: 'e', ჸ: 'k',
};

/** A bank's letter back to the Georgian one: the table above read the other way, case and all. */
const FROM_BANK: Record<string, string> = Object.fromEntries(
  Object.entries(LETTERS)
    .slice(0, 33)
    .map(([georgian, bank]) => [bank, georgian]),
);

/** Typed Latin, longest spelling first: `tch` before `ch`, `kh` before `k`. */
const TYPED = /tch|kh|gh|sh|ch|zh|dz|ts|ph|th|[a-z0-9]/g;
const TYPED_SOUND: Record<string, string> = { tch: 'ch', ph: 'p', th: 't', q: 'k', x: 'kh', f: 'p', c: 'ts' };

const words = (text: string): string[] =>
  text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 1);

/** Georgian letters to their sounds; everything that is not a letter or a digit parts two words. */
function soundsOfGeorgian(text: string): string {
  let out = '';
  for (const ch of text) out += LOOSE[ch] ?? (/[a-z0-9]/.test(ch) ? ch : ' ');
  return out;
}

/**
 * A name in the loose form, once for each way the text may have been written:
 * as typed (Georgian script, or Latin the way people type it), and — for
 * Latin text — as a bank's transliteration, where the case of a letter is a
 * different letter. Which of the two a text is cannot be told from the text,
 * so both are offered and the caller matches against either.
 */
export function looseNames(text: string): string[][] {
  const typed = text.toLowerCase().replace(TYPED, (m) => TYPED_SOUND[m] ?? m);
  const forms = [words(soundsOfGeorgian(typed))];
  if (/[A-Za-z]/.test(text)) {
    let georgian = '';
    for (const ch of text) georgian += FROM_BANK[ch] ?? FROM_BANK[ch.toLowerCase()] ?? ch;
    forms.push(words(soundsOfGeorgian(georgian.toLowerCase())));
  }
  return forms.filter((f) => f.length > 0);
}

/** Every word of the name is in the text, and that is two words — or the text is that one word and nothing else. */
const allIn = (name: readonly string[], text: ReadonlySet<string>): boolean =>
  name.length > 0 && name.every((w) => text.has(w)) && (name.length >= 2 || text.size === 1);

/**
 * Is this bank text about this person?
 *
 * Every word of the shorter name has to appear in the longer one, and at
 * least two words have to match — one shared word is a coincidence waiting
 * to attach a stranger's money to a customer. A single-word name (a company)
 * matches on that word alone, which is the whole name there is.
 *
 * First letter for letter, in the bank's own transliteration; then in the
 * loose form, which is what finds a card typed `Khachapuridze Shota` in a
 * line that says `xaWapuriZe SoTa` or ხაჭაპურიძე შოთა.
 */
export function nameMatches(bankText: string, customerNames: (string | null | undefined)[]): boolean {
  const haystack = new Set(normaliseName(bankText));
  if (haystack.size === 0) return false;
  const named = customerNames.filter((n): n is string => !!n);
  if (named.some((name) => allIn(normaliseName(name), haystack))) return true;
  const loose = looseNames(bankText).map((f) => new Set(f));
  return named.some((name) => looseNames(name).some((form) => loose.some((text) => allIn(form, text))));
}

/**
 * An amount as a bank writes it: `1,350.00`, `3152.0`, `-100.0`, `315,20`.
 * Returns whole tetri, or null when the text is not an amount.
 */
export function parseBankAmount(text: string): number | null {
  const t = text.trim().replace(/\s| /g, '');
  if (t === '') return null;
  // A comma is a thousands separator when a dot follows it, a decimal point
  // otherwise: `1,350.00` against `315,20`.
  const cleaned = t.includes('.') ? t.replace(/,/g, '') : t.replace(',', '.');
  if (!/^-?\d+(\.\d{1,4})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}
