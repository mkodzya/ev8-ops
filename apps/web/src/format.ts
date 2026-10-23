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
