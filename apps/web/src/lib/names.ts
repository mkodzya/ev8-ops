import type { Locale } from '@ev8/shared';

// A customer here has up to three spellings of one name: `name` as it was
// first written, `nameKa` in Georgian, `nameLat` in Latin. Odoo held them
// mixed in one column and the team read whichever came out.
//
// The rule (U14): the interface language chooses which spelling leads. The
// other one follows in grey when it says something different — a person whose
// two spellings are the same gets one, not the same name twice.

export interface Named {
  name: string;
  nameKa?: string | null;
  nameLat?: string | null;
}

export function primaryName(c: Named, locale: Locale): string {
  const first = locale === 'ka' ? c.nameKa : c.nameLat;
  return (first ?? '').trim() || c.name;
}

export function secondName(c: Named, locale: Locale): string | null {
  const other = locale === 'ka' ? c.nameLat : c.nameKa;
  const second = (other ?? '').trim();
  if (!second) return null;
  return second === primaryName(c, locale) ? null : second;
}

/** Sorting follows what is on screen, not what is in the first column. */
export function byName(locale: Locale) {
  return (a: Named, b: Named): number => primaryName(a, locale).localeCompare(primaryName(b, locale), locale);
}
