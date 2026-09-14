// What a moped actually cost to put in the yard (PUR-01, PUR-02).
//
// The company's own method, from the calculation of 13.08.2026:
//
//   * the invoice is in the factory's currency (CNY), the bank pays in
//     another (USD) and the books are in a third (GEL);
//   * the rate that counts is the one that actually happened — what left
//     the account divided by what the invoice said — not a reference rate,
//     because the reference rate is not what the company paid;
//   * logistics and customs are paid once for a whole shipment and are
//     split evenly over its units, there being nothing in an invoice to
//     split them by;
//   * import VAT is not a cost: it came back through the VAT return, so it
//     is subtracted from the shipment's costs before they are split.
//
// No intermediate rate is computed and rounded here. The GEL that was paid
// is shared out over the lines in proportion to their invoice value, so the
// costs of a shipment add up to exactly what left the bank — a rounded rate
// multiplied line by line does not.
import type { Tetri } from './money.js';

export interface PurchaseLineInput {
  id: string;
  qty: number;
  /** Price for one, in the invoice currency's minor unit (fen, cents). */
  unitPriceMinor: number;
}

export interface LandedCost {
  lineId: string;
  /** The goods themselves, in GEL tetri, at the rate that really happened. */
  fobTetri: Tetri;
  /** This line's share of the shipment's logistics and customs. */
  extrasTetri: Tetri;
  totalTetri: Tetri;
  /** What one unit of this line cost, landed. */
  unitCostTetri: Tetri;
}

/**
 * Share `total` out over `weights` so that the parts add up to `total`
 * exactly. Whoever loses most to rounding gets the odd tetri — the largest
 * remainder, which is the standard way and the only one that does not drift.
 */
function shareOut(total: number, weights: number[]): number[] {
  const sum = weights.reduce((n, w) => n + w, 0);
  if (sum <= 0 || total === 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / sum);
  const floors = exact.map(Math.floor);
  let left = total - floors.reduce((n, f) => n + f, 0);
  const order = exact
    .map((e, i) => ({ i, rem: e - Math.floor(e) }))
    .sort((a, b) => b.rem - a.rem);
  const out = [...floors];
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k].i]++;
  return out;
}

/**
 * The landed cost of every line of a shipment.
 *
 * `paidTetri` is what the bank actually sent for these goods, and
 * `extrasTetri` is what the shipment's logistics and customs cost after the
 * refunded import VAT is taken out.
 */
export function landedCosts(input: {
  lines: PurchaseLineInput[];
  paidTetri: Tetri;
  extrasTetri: Tetri;
}): LandedCost[] {
  const values = input.lines.map((l) => l.qty * l.unitPriceMinor);
  const fob = shareOut(input.paidTetri, values);
  const units = input.lines.map((l) => l.qty);
  const extras = shareOut(input.extrasTetri, units);
  return input.lines.map((l, i) => {
    const totalTetri = fob[i] + extras[i];
    return {
      lineId: l.id,
      fobTetri: fob[i],
      extrasTetri: extras[i],
      totalTetri,
      unitCostTetri: l.qty > 0 ? Math.round(totalTetri / l.qty) : 0,
    };
  });
}

/**
 * The rate a shipment actually went through at, for reading rather than for
 * multiplying: GEL per one unit of the invoice currency, to six places.
 * Null until something has been paid.
 */
export function effectiveRate(paidTetri: Tetri, invoiceMinorTotal: number): number | null {
  if (invoiceMinorTotal <= 0 || paidTetri <= 0) return null;
  return Math.round((paidTetri / invoiceMinorTotal) * 1e6) / 1e6;
}
