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

// The mechanic's own repair (stage 2 of docs/spec/mechanic-in-erp-plan.md).

/** Why a repair came in: the bot's five reasons, one of them on every repair a mechanic opens. */
export const SERVICE_REASONS = ['wear', 'accident', 'renter_fault', 'warranty', 'planned'] as const;
export type ServiceReason = (typeof SERVICE_REASONS)[number];

/**
 * Photos of the damage a new repair carries, besides the odometer's: at least
 * one, at most four — five "before" photos in all, as the spec says.
 */
export const JOB_PHOTOS_MAX = 4;

/** How many of one work a line may say; more is a typing slip, not a repair. */
export const WORK_QTY_MAX = 99;

/** The longest norm the book takes: a hundred hours. */
const NORM_MAX_SEC = 100 * 3600;

/**
 * A norm as a person types it — "30", "2,5", 2.5 minutes — kept in seconds.
 * OT-01 is two and a half minutes in the bot's book: in whole minutes it would
 * have to become another norm, and the book's norms are the company's, not
 * the column's (code check, §3). Null when it is not a norm.
 */
export function normSecFromMinutes(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  const n = typeof input === 'number' ? input : Number(String(input).trim().replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  const sec = Math.round(n * 60);
  return sec > 0 && sec <= NORM_MAX_SEC ? sec : null;
}

/** 150 seconds → 2.5 minutes; the screen writes it in its own language. */
export function normMinutes(sec: number): number {
  return Math.round((sec / 60) * 100) / 100;
}

export interface WorkLine {
  qty: number;
  /** Empty for a work that is not in the book and has no norm yet. */
  normSec: number | null;
  rateTetri: Tetri;
}

/**
 * One line of work: quantity × norm × the mechanic's rate for an hour of norm,
 * as in the bot. Null while the line has no norm — it is not paid until it
 * has one.
 */
export function workLineTetri(line: WorkLine): Tetri | null {
  if (line.normSec == null) return null;
  return Math.round((line.qty * line.normSec * line.rateTetri) / 3600);
}

/**
 * The lines together: the time by the norm, the money, and how many lines
 * still have no norm. The money is rounded once, on the sum, not line by
 * line — the bot's control figure (282.5 min at 50 ₾ = 235.42 ₾) only holds
 * that way; whether a payout rounds so is stage 5's question.
 */
export function worksTotal(lines: readonly WorkLine[]): { seconds: number; tetri: Tetri; unnormed: number } {
  let seconds = 0;
  let exact = 0;
  let unnormed = 0;
  for (const l of lines) {
    if (l.normSec == null) {
      unnormed++;
      continue;
    }
    seconds += l.qty * l.normSec;
    exact += (l.qty * l.normSec * l.rateTetri) / 3600;
  }
  return { seconds, tetri: Math.round(exact), unnormed };
}

/** The category of a work is the letters of its code: BR-04 is brakes. */
export function workCategoryOf(code: string): string {
  return code.split('-')[0] ?? '';
}

/**
 * The code a new work gets: the next number of its category, never one that
 * was used — a switched-off work keeps its code (BR-07 → BR-08).
 */
export function nextWorkCode(category: string, codes: readonly string[]): string {
  let top = 0;
  for (const c of codes) {
    if (workCategoryOf(c) !== category) continue;
    const n = Number(c.slice(category.length + 1));
    if (Number.isInteger(n) && n > top) top = n;
  }
  return `${category}-${String(top + 1).padStart(2, '0')}`;
}

// Approving and closing the mechanic's repair (stage 3; ADR-0035).

/** Photos after the repair: one at least on a mechanic's repair, five at most (the spec). */
export const AFTER_PHOTOS_MAX = 5;

/**
 * Where a line of work stands. A line waits until the repair it is on is
 * approved, or — added once the work had started — until it is approved on
 * its own; a refused line stays on the repair, struck through, and is never
 * paid (Mika, 20.10.2026).
 */
export type WorkLineState = 'approved' | 'rejected' | 'waiting';

export function workLineState(line: { approvedAt: unknown; rejectedAt: unknown }): WorkLineState {
  if (line.rejectedAt != null) return 'rejected';
  return line.approvedAt != null ? 'approved' : 'waiting';
}

/**
 * The owner is offered «за счёт клиента» on a repair of a moped out with a
 * renter only when the renter is to blame. An accident is not offered: who
 * was at fault the system does not know, and a breakdown not the courier's
 * fault is the insurance's (Mika, 20.10.2026; register #110).
 */
export function suggestsCustomerPays(job: { reasonKind: string | null; payer: string; rental: unknown; status: string }): boolean {
  return job.reasonKind === 'renter_fault' && job.payer === 'company' && job.rental != null && (job.status === 'draft' || job.status === 'open');
}
