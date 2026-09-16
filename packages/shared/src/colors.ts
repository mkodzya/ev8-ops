/**
 * The colour of a moped, as the same fact written in different places.
 *
 * Odoo holds it as free text, and fifteen months of two people typing produced
 * eleven spellings of six colours: `შავი` and `Black` are one colour, so are
 * `წითელი` and `Red`. Nothing is rewritten in the database — what was entered
 * stays entered — but a screen shows one word, in the language of whoever is
 * reading, and a colour nobody here recognises is shown exactly as it was
 * typed rather than guessed at.
 */
export const VEHICLE_COLORS = ['black', 'white', 'red', 'green', 'grey', 'purple'] as const;
export type VehicleColor = (typeof VEHICLE_COLORS)[number];

/** Every spelling seen in the data, lower-cased. Add to this, never guess past it. */
const SPELLINGS: Record<VehicleColor, readonly string[]> = {
  black: ['black', 'შავი', 'чёрный', 'черный'],
  white: ['white', 'თეთრი', 'белый'],
  red: ['red', 'წითელი', 'красный'],
  green: ['green', 'მწვანე', 'зелёный', 'зеленый'],
  grey: ['grey', 'gray', 'ნაცრისფერი', 'серый'],
  purple: ['purple', 'violet', 'იისფერი', 'фиолетовый'],
};

/** The two words a bilingual paper prints for a colour. */
const PAPER: Record<VehicleColor, { ka: string; en: string }> = {
  black: { ka: 'შავი', en: 'Black' },
  white: { ka: 'თეთრი', en: 'White' },
  red: { ka: 'წითელი', en: 'Red' },
  green: { ka: 'მწვანე', en: 'Green' },
  grey: { ka: 'ნაცრისფერი', en: 'Grey' },
  purple: { ka: 'იისფერი', en: 'Purple' },
};

const BY_SPELLING = new Map<string, VehicleColor>(
  VEHICLE_COLORS.flatMap((c) => SPELLINGS[c].map((s) => [s, c] as [string, VehicleColor])),
);

/** The colour this text names, or null when nobody has taught us the word. */
export function colorOf(raw: string | null | undefined): VehicleColor | null {
  if (!raw) return null;
  return BY_SPELLING.get(raw.trim().toLowerCase()) ?? null;
}

/**
 * The colour as a contract prints it: both languages for a colour we know,
 * the text as written for one we do not, and nothing for nothing. A picker
 * now stores the code (`black`), and a paper must not print a code.
 */
export function colorOnPaper(raw: string | null | undefined): string {
  const code = colorOf(raw);
  if (code) return `${PAPER[code].ka} / ${PAPER[code].en}`;
  return raw?.trim() ?? '';
}
