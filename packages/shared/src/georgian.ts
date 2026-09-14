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

/**
 * Is this bank text about this person?
 *
 * Every word of the shorter name has to appear in the longer one, and at
 * least two words have to match — one shared word is a coincidence waiting
 * to attach a stranger's money to a customer. A single-word name (a company)
 * matches on that word alone, which is the whole name there is.
 */
export function nameMatches(bankText: string, customerNames: (string | null | undefined)[]): boolean {
  const haystack = new Set(normaliseName(bankText));
  if (haystack.size === 0) return false;
  for (const name of customerNames) {
    if (!name) continue;
    const words = normaliseName(name);
    if (words.length === 0) continue;
    const hits = words.filter((w) => haystack.has(w)).length;
    if (hits === words.length && (words.length >= 2 || haystack.size === 1)) return true;
  }
  return false;
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
