// A moped's own number in the company: EV-007 (meeting of Mika and Kardu,
// 14.10.2026; Mika chose the form on 15.10.2026). It is given in the order the
// mopeds came to the company, never changes and never passes to another moped
// — a sold one keeps its number. VIN stays the moped's identity; the number is
// what people say, write on the sticker and type in the search.

export const FLEET_PREFIX = 'EV';

/** 7 → "EV-007"; four digits once the fleet passes 999. */
export function fleetNumber(n: number | null | undefined): string | null {
  if (n == null) return null;
  return `${FLEET_PREFIX}-${String(n).padStart(3, '0')}`;
}

/**
 * What a person typed, as a fleet number: "EV-007", "ev7", "EV 7", "ev-07".
 * Bare digits are a number only when asked (`digitsToo`): "150" in the search
 * is more often money than a moped.
 */
export function readFleetNumber(raw: string, opts: { digitsToo?: boolean } = {}): number | null {
  const s = raw.trim().toLowerCase();
  const m = /^ev[\s-]*0*(\d{1,4})$/.exec(s) ?? (opts.digitsToo ? /^0*(\d{1,4})$/.exec(s) : null);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 ? n : null;
}
