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
  /** A moped line carries the shipment's logistics; a part line does not (Q24). */
  isVehicle?: boolean;
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
 * What a shipment has been paid, and at what rate (wave 5 §3.5).
 *
 * The rate is what the money did: the GEL that left the account divided by
 * the invoice currency those payments bought. A shipment half paid has a
 * rate already — the rate of the half that was paid — and that is the rate
 * the goods are costed at until the rest goes out (Mika, Q23).
 */
export interface PaidSummary {
  /** GEL that left the account, the bank's own charge included. */
  paidTetri: Tetri;
  /** What those GEL bought, in the invoice currency's minor unit. */
  paidMinor: number;
  /** 0…100, how much of the invoice is covered. */
  percent: number;
  /** GEL for one unit of the invoice currency, to six places; null until something is paid. */
  rate: number | null;
  /** Still owed to the factory, in its own currency (B3-04). */
  debtMinor: number;
  /** Nothing is owed any more: costs stop being preliminary. */
  settled: boolean;
}

export function paidSummary(input: { payments: readonly { paidTetri: Tetri; paidMinor: number }[]; invoiceMinor: number }): PaidSummary {
  const paidTetri = input.payments.reduce((n, p) => n + p.paidTetri, 0);
  const paidMinor = input.payments.reduce((n, p) => n + p.paidMinor, 0);
  const invoice = Math.max(0, input.invoiceMinor);
  // A payment entered without its currency amount still says something: fall
  // back to the invoice, or a whole shipment would read as unpaid.
  const covered = paidMinor > 0 ? paidMinor : 0;
  return {
    paidTetri,
    paidMinor,
    percent: invoice > 0 ? Math.min(100, Math.round((covered / invoice) * 100)) : paidTetri > 0 ? 100 : 0,
    rate: paidMinor > 0 && paidTetri > 0 ? Math.round((paidTetri / paidMinor) * 1e6) / 1e6 : null,
    debtMinor: Math.max(0, invoice - covered),
    settled: invoice > 0 && covered >= invoice,
  };
}

/**
 * The landed cost of every line of a shipment.
 *
 * The goods are costed at the rate the payments actually went through at,
 * and the shipment's logistics and customs — after the refunded import VAT —
 * are split evenly over the mopeds, which is what they were paid to move
 * (умолчание Q24). A part costs what it cost; it did not ride in the
 * container on its own account.
 *
 * Until the invoice is fully paid this is a preliminary figure by the rate of
 * the payments made so far, and every further payment recomputes it (§7).
 */
export function landedCosts(input: {
  lines: PurchaseLineInput[];
  /** GEL per one minor unit of the invoice currency, from `paidSummary`. */
  rate: number | null;
  extrasTetri: Tetri;
}): LandedCost[] {
  const rate = input.rate ?? 0;
  const fob = input.lines.map((l) => Math.round(l.qty * l.unitPriceMinor * rate));
  // Only the mopeds carry the freight; when a shipment holds none, the parts
  // do, because the money was still spent on this shipment.
  const carriers = input.lines.some((l) => l.isVehicle) ? input.lines.map((l) => (l.isVehicle ? l.qty : 0)) : input.lines.map((l) => l.qty);
  const extras = shareOut(input.extrasTetri, carriers);
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
