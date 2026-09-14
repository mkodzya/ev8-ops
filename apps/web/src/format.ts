export { formatGel } from '@ev8/shared';

/** 2026-09-13 → 13.09.2026. One date format in every language, like money. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/** The last four characters of a VIN carry the eye (spec §9.2). */
export function vinParts(vin: string): { head: string; tail: string } {
  return { head: vin.slice(0, -4), tail: vin.slice(-4) };
}
