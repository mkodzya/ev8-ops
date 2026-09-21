// A VIN is 17 characters and never contains I, O or Q (ISO 3779): the three
// letters a one, a zero and a nought could be read as. The rule lives here
// because three places need the same answer — adding a moped by hand, the
// owner correcting a VIN, and a whole CMR pasted into the batch being
// received (wave 5 §3.6, §3.9, B3-06).
export const VIN_LENGTH = 17;

/** I, O and Q are not in a VIN; everything else is 0-9 and A-Z. */
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

/** What a person typed, as the system stores it: upper case, no spaces or dashes. */
export function normalizeVin(input: string): string {
  return input.trim().toUpperCase().replace(/[\s-]+/g, '');
}

export type VinFault = 'length' | 'letters' | 'duplicate' | 'known';

export function vinFault(input: string): VinFault | null {
  const vin = normalizeVin(input);
  if (vin.length !== VIN_LENGTH) return 'length';
  if (!VIN_RE.test(vin)) return 'letters';
  return null;
}

export function isVin(input: string): boolean {
  return vinFault(input) === null;
}

export interface VinLine {
  /** 1-based, as a person counts the lines of a pasted list (crit. 14). */
  line: number;
  vin: string;
  fault: VinFault | null;
}

/**
 * A list pasted from a CMR, one VIN to a line. Nothing is dropped and
 * nothing is guessed: every line comes back with what is wrong with it, so
 * the screen can name the line rather than refuse the whole paste with one
 * word. A VIN the fleet already holds stops the receipt outright (`purchasing.md`).
 */
export function checkVinList(text: string, known: readonly string[] = []): VinLine[] {
  const seen = new Set<string>();
  const have = new Set(known.map(normalizeVin));
  return text
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((raw, i) => {
      const vin = normalizeVin(raw);
      const fault = vinFault(raw) ?? (seen.has(vin) ? 'duplicate' : have.has(vin) ? 'known' : null);
      seen.add(vin);
      return { line: i + 1, vin, fault };
    });
}
