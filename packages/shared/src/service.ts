// What a repair costs (wave 5 §3.7, `service.md`). Two lines make a job:
// parts off the shelf and hours of work. Both are priced by who is paying —
// the company pays what a part cost it, a customer pays what it is sold for —
// and the total is the sum, never a stored number.
import type { Tetri } from './money.js';

/** An hour of work, until the book has norms per job (register #33). */
export const LABOUR_RATE_TETRI = 5000;

export type ServicePayer = 'company' | 'customer';

/**
 * Hours are entered as a person says them — 1.5 — and kept as minutes, so a
 * third of an hour is not a recurring decimal in the database.
 */
export function minutesFromHours(hours: number): number {
  return Math.max(0, Math.round(hours * 60));
}

export function hoursFromMinutes(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

/** 1.5 hours at 50 ₾ is 75 ₾ (crit. 24). */
export function labourTetri(minutes: number, rateTetri: Tetri = LABOUR_RATE_TETRI): Tetri {
  return Math.round((Math.max(0, minutes) / 60) * rateTetri);
}

/**
 * What one part goes on the line at (B8-04): the company's own repair is
 * costed at what the shelf paid, a customer's at the price it is sold for.
 * A part with no retail price falls back to its cost — a repair is not
 * stopped by a price nobody has set, and the figure is never invented.
 */
export function partPriceTetri(payer: ServicePayer, part: { avgCostTetri?: number | null; salePriceTetri?: number | null }): Tetri | null {
  const cost = part.avgCostTetri ?? null;
  const retail = part.salePriceTetri ?? null;
  return payer === 'customer' ? (retail ?? cost) : (cost ?? retail);
}

export interface JobLine {
  qty: number;
  unitPriceTetri: Tetri;
}

/** Parts plus work — what the job comes to today. */
export function jobTotalTetri(input: { parts: readonly JobLine[]; labourTetri: Tetri }): Tetri {
  return input.parts.reduce((n, p) => n + p.qty * p.unitPriceTetri, 0) + input.labourTetri;
}

/**
 * Closing a repair charged to a customer (§3.7, `service.md`, Q26): what can
 * be kept from the deposit is never more than the repair cost and never more
 * than the deposit still holds; whatever is left becomes the customer's debt,
 * as one line named after the job.
 */
export function closeCharge(input: { totalTetri: Tetri; withholdTetri: Tetri; depositFreeTetri: Tetri }): { withheldTetri: Tetri; debtTetri: Tetri } {
  const withheldTetri = Math.max(0, Math.min(input.withholdTetri, input.totalTetri, input.depositFreeTetri));
  return { withheldTetri, debtTetri: Math.max(0, input.totalTetri - withheldTetri) };
}
