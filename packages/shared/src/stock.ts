// What is on the shelf, and what it is worth.
//
// A count is never stored. It is the sum of the movements, so a receipt
// corrected or a repair line removed changes the shelf at once and there is
// no second copy to drift away from the first.
//
// Value follows a moving average, because that is the only method the parts
// themselves support: a box of brake pads from two shipments at two prices
// is one box, and nobody marks which pad came from which invoice. Taking
// three of ten off the shelf takes three tenths of what the shelf is worth,
// so the last one out carries exactly what is left and the value lands on
// zero instead of a rounding crumb.
import type { ISODate } from './types.js';

export type StockMoveKind = 'receipt' | 'issue' | 'adjust' | 'return';

export interface StockMoveInput {
  kind: StockMoveKind;
  /** Signed: in is positive, out is negative. */
  qty: number;
  /**
   * What one cost. A receipt brings its own in. An issue usually takes none —
   * what it carries away is worked out from the shelf — except the out-half of
   * a part that only passed through on its way into a moped (bought by the
   * mechanic, or off a donor; ADR-0036): that one leaves at what it came in
   * at, so the shelf's average is not touched by it.
   */
  unitCostTetri?: number | null;
  occurredOn: ISODate;
  /** When it was written: the order of a day's movements (ADR-0036). */
  at?: string | null;
}

export interface StockState {
  onHand: number;
  valueTetri: number;
  /** What one on the shelf is worth now, or nothing when the shelf is empty. */
  avgCostTetri: number | null;
}

/**
 * Movements in the order they happened: by day, then by when they were
 * written, and — written in the same instant — what came in before what went
 * out. Until stage 4 a day's movements came in whatever order the database
 * gave them, and a part bought and fitted the same day would have been
 * averaged one way or the other by chance (code check §3, stage 4).
 */
function inOrder(moves: readonly StockMoveInput[]): StockMoveInput[] {
  return [...moves].sort(
    (a, b) =>
      a.occurredOn.localeCompare(b.occurredOn) ||
      (a.at ?? '').localeCompare(b.at ?? '') ||
      Number(b.qty > 0) - Number(a.qty > 0),
  );
}

export function stockState(moves: readonly StockMoveInput[]): StockState {
  let onHand = 0;
  let value = 0;
  for (const m of inOrder(moves)) {
    if (m.qty > 0) {
      // A receipt priced by its shipment brings its own cost in. One found
      // during a stock-take is worth what its shelfmates are worth; there is
      // nothing else it could honestly be worth. A part taken off a moped
      // comes in at a cost of nought that somebody named (ADR-0036): it is
      // a figure, not a gap, and it pulls the average down.
      const unit = m.unitCostTetri ?? (onHand > 0 ? Math.round(value / onHand) : 0);
      value += m.qty * unit;
      onHand += m.qty;
    } else if (m.qty < 0) {
      if (m.unitCostTetri != null) {
        // The out-half of a part passing through: it takes exactly what its
        // in-half brought, and the rest of the shelf is as it was.
        value -= -m.qty * m.unitCostTetri;
      } else {
        const out = Math.min(-m.qty, Math.max(onHand, 0));
        value -= onHand > 0 ? Math.round((value * out) / onHand) : 0;
      }
      onHand += m.qty;
    }
  }
  // A shelf in the red holds nothing, whatever the ledger says it is worth.
  if (onHand <= 0) value = 0;
  return { onHand, valueTetri: value, avgCostTetri: onHand > 0 ? Math.round(value / onHand) : null };
}

/** How many more are needed to reach the level somebody set. */
export function shortfall(onHand: number, minQty: number): number {
  return minQty > 0 && onHand < minQty ? minQty - onHand : 0;
}
