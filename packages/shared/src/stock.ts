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

export type StockMoveKind = 'receipt' | 'issue' | 'adjust';

export interface StockMoveInput {
  kind: StockMoveKind;
  /** Signed: in is positive, out is negative. */
  qty: number;
  unitCostTetri?: number | null;
  occurredOn: ISODate;
}

export interface StockState {
  onHand: number;
  valueTetri: number;
  /** What one on the shelf is worth now, or nothing when the shelf is empty. */
  avgCostTetri: number | null;
}

export function stockState(moves: readonly StockMoveInput[]): StockState {
  const sorted = [...moves].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn));
  let onHand = 0;
  let value = 0;
  for (const m of sorted) {
    if (m.qty > 0) {
      // A receipt priced by its shipment brings its own cost in. One found
      // during a stock-take is worth what its shelfmates are worth; there is
      // nothing else it could honestly be worth.
      const unit = m.unitCostTetri ?? (onHand > 0 ? Math.round(value / onHand) : 0);
      value += m.qty * unit;
      onHand += m.qty;
    } else if (m.qty < 0) {
      const out = Math.min(-m.qty, Math.max(onHand, 0));
      value -= onHand > 0 ? Math.round((value * out) / onHand) : 0;
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
