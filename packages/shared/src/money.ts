// Money in EV8 Ops is GEL stored in tetri as integers (CLAUDE.md). Every
// function here takes and returns integer tetri; floats exist only at the
// edge, when a person types "150" or a bank file says "315.20".

/** Integer tetri. A type alias so signatures say what unit they mean. */
export type Tetri = number;

export const VAT_RATE = 0.18;
/** Acquiring fee the bank keeps: net = gross − 1.5 % (315.20 = 320, 325.05 = 330). */
export const ACQUIRING_FEE_RATE = 0.015;
/** Default deposit, GEL 180 (spec RNT-01). */
export const DEFAULT_DEPOSIT_TETRI: Tetri = 180_00;
/** Weekly tariffs offered by default, editable per rental (spec RNT-01). */
export const DEFAULT_WEEKLY_RATES_TETRI: readonly Tetri[] = [140_00, 150_00, 170_00];

export function tetriFromGel(gel: number): Tetri {
  if (!Number.isFinite(gel)) throw new Error(`not an amount: ${gel}`);
  return Math.round(gel * 100);
}

export function gelFromTetri(tetri: Tetri): number {
  return tetri / 100;
}

/**
 * Parse what a person or a bank file wrote: "315.20", "315,20", "1 234.56".
 * Returns null rather than guessing when the text is not a number.
 */
export function parseGel(text: string): Tetri | null {
  const cleaned = text.replace(/[\s  ₾]/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return tetriFromGel(Number(cleaned));
}

/**
 * `1 234.56 ₾` — one format in every language, by decision (as in Self
 * Platform): a report that reads differently for two people is an argument
 * about reconciliation waiting to happen. Thousands are separated by a narrow
 * no-break space, the sign sits in front, the lari sign after.
 */
export function formatGel(tetri: Tetri | null | undefined, opts: { decimals?: boolean } = {}): string {
  if (tetri == null) return '—';
  const decimals = opts.decimals ?? true;
  const abs = Math.abs(tetri);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const body = decimals || frac !== 0 ? `${grouped}.${frac.toString().padStart(2, '0')}` : grouped;
  return `${tetri < 0 ? '-' : ''}${body} ₾`;
}

/** VAT 18 % on top of a net amount. Gross is rounded once, VAT is the difference. */
export function vatOnTop(netTetri: Tetri): { net: Tetri; vat: Tetri; gross: Tetri } {
  const gross = Math.round(netTetri * (1 + VAT_RATE));
  return { net: netTetri, vat: gross - netTetri, gross };
}

/** The net inside a VAT-inclusive price (site prices, rental tariffs). */
export function netFromGross(grossTetri: Tetri): { net: Tetri; vat: Tetri; gross: Tetri } {
  const net = Math.round(grossTetri / (1 + VAT_RATE));
  return { net, vat: grossTetri - net, gross: grossTetri };
}

/** What the bank credits after keeping its acquiring fee. */
export function acquiringNet(grossTetri: Tetri): Tetri {
  return Math.round(grossTetri * (1 - ACQUIRING_FEE_RATE));
}

/** The fee itself — a company expense, never the customer's debt (PAY-04). */
export function acquiringFee(grossTetri: Tetri): Tetri {
  return grossTetri - acquiringNet(grossTetri);
}

/**
 * Recover the gross a customer paid from the net the bank credited:
 * 31520 → 32000, 32505 → 33000. A 1.5 % step is finer than a tetri, so some
 * gross always reproduces the net; whether that gross is a plausible
 * tariff + deposit sum is the matcher's question (PAY-02), not this one's.
 */
export function acquiringGross(netTetri: Tetri): Tetri | null {
  const candidate = Math.round(netTetri / (1 - ACQUIRING_FEE_RATE));
  for (const gross of [candidate - 1, candidate, candidate + 1]) {
    if (acquiringNet(gross) === netTetri) return gross;
  }
  return null;
}
