import type { Bi } from './layout.js';

/**
 * The company as its own contract states it, copied from the signed
 * originals in Google Drive (14.09.2026). The registry address in Kutaisi is
 * what the template carries — not the Tbilisi office — so it is what the
 * generated contract carries too.
 */
export const COMPANY = {
  nameKa: 'შპს „ე-მოუშენ მოთორს“',
  nameEn: 'E-Motion Motors LLC',
  taxId: '412785721',
  addressKa: 'ქუთაისი, 26 მაისის ქუჩა 2შ, შენობა 11',
  addressEn: '26 Maisis St. 2sh, building 11, Kutaisi',
  directorKa: 'კარდუ კუხიანიძე',
  directorEn: 'Kardu Kukhianidze',
};

/** Fixed terms the template prints as text, not as a field. */
export const TERMS = {
  minWeeks: 1,
  lateFeePerDay: '30',
  lateFeeParts: '20 + 10',
  keyLoss: '250',
  batteryFine: '1000',
};

export const LESSOR: Bi = { ka: 'დამქირავებელი', en: 'Lessor' };
export const LESSEE: Bi = { ka: 'მოქირავე', en: 'Lessee' };

export const DISCLAIMER: Bi = {
  ka: 'დოკუმენტის ქართული ტექსტი არის ავთენტური; ინგლისური ტექსტი არაოფიციალური თარგმანია და შეუსაბამობის შემთხვევაში უპირატესობა ენიჭება ქართულს.',
  en: 'The Georgian text of this document is authentic; the English text is an unofficial translation and, in case of discrepancy, the Georgian prevails.',
};

/** 2026-09-14 → 14/09/2026, the way the company's own documents write it. */
export function dmy(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** Whole GEL as the paper form writes it: "150", not "150.00 ₾". */
/** An odometer reading as it is written on paper: "7 500 km"; none — a dash for a pen. */
export function km(n: number | null | undefined): string {
  if (n == null) return '';
  return `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} km`;
}

export function gel(tetri: number | null | undefined): string {
  if (tetri == null) return '—';
  const whole = Math.trunc(tetri / 100);
  const frac = Math.abs(tetri % 100);
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0')}`;
}

/** Money on an invoice, always with its tetri: "100.00", "84.75" (ADR-0045 §8) — `gel` prints "100". */
export function gel2(tetri: number): string {
  const sign = tetri < 0 ? '-' : '';
  const abs = Math.abs(tetri);
  const whole = String(Math.trunc(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${whole}.${String(abs % 100).padStart(2, '0')}`;
}
