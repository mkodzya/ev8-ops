import { localDateTime } from '@ev8/shared';

export { formatGel } from '@ev8/shared';

/** 2026-09-13 → 13.09.2026. One date format in every language, like money. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/**
 * A moment → the company's day it fell on, 23.10.2026. For a timestamp the API
 * hands over (`createdAt`, `at`); a `date` field goes through fmtDate. Cutting
 * the first ten characters of a timestamp names the UTC day, which between
 * 00:00 and 04:00 in Tbilisi is yesterday: a payment made at 01:08 on the 23rd
 * read «22.10.2026 01:08» (QA after issue #7, 23.10.2026; guard-code catches
 * the cut now).
 */
export function fmtDateAt(at: string | null | undefined): string {
  return at ? localDateTime(at).date : '—';
}

/** 2026-10-14 → 14.10. Where the year is said once already — in the month's name over a calendar. */
export function fmtDayMonth(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [, m, d] = iso.split('-');
  return `${d}.${m}`;
}

/** The last four characters of a VIN carry the eye (spec §9.2). */
export function vinParts(vin: string): { head: string; tail: string } {
  return { head: vin.slice(0, -4), tail: vin.slice(-4) };
}

/**
 * A record's number held together in a line of text: a word joiner (U+2060,
 * nothing visible) after the hyphen of `TS-00001`, `R-00480`, `SL-00007`, so
 * a narrow line breaks before the number and not inside it. For a string
 * that cannot carry a `.nobr` span — the toast's words (QA 23.10.2026:
 * «Продано TS-» / «00001»); the same joiner keeps «Signify-ში» whole.
 */
export function holdNumbers(text: string): string {
  return text.replace(/\b([A-Z]{1,3})-(?=\d)/g, '$1-⁠');
}
