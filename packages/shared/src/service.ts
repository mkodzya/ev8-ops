// What a repair costs (wave 5 §3.7, `service.md`). Two lines make a job:
// parts off the shelf and hours of work. Both are priced by who is paying —
// the company pays what a part cost it, a customer pays what it is sold for —
// and the total is the sum, never a stored number.
import type { Tetri } from './money.js';

/**
 * An hour of work, until the book has norms per job (register #33). Since
 * stage 6 it is only where the company rate starts (`service_settings`,
 * ADR-0038 §3) and the rate of the owner's old line of hours.
 */
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
  /** What the line is (0058); a line from before it came off the shelf. */
  kind?: string | null;
  /** A bought line: what the mechanic paid for all of it, by the receipt. */
  paidTetri?: Tetri | null;
  /** A bought line refused at approval. */
  rejectedAt?: unknown;
}

/**
 * What one repair line adds to what the repair cost (ADR-0036). A part off the
 * shelf or off a donor is its quantity at its price; one the mechanic bought is
 * the receipt, to the tetri, however many it was for; one taken off onto the
 * shelf cost the repair nothing; a bought one refused is not the company's.
 * The one place this is worked out — the repair, the economics, the debt and
 * the moped's card all ask here.
 */
export function partLineTetri(line: JobLine): Tetri {
  if (line.rejectedAt != null || line.kind === 'removed') return 0;
  if (line.kind === 'bought' && line.paidTetri != null) return line.paidTetri;
  return line.qty * line.unitPriceTetri;
}

export function partsTetri(lines: readonly JobLine[]): Tetri {
  return lines.reduce((n, p) => n + partLineTetri(p), 0);
}

/** Parts plus work — what the job comes to today. */
export function jobTotalTetri(input: { parts: readonly JobLine[]; labourTetri: Tetri }): Tetri {
  return partsTetri(input.parts) + input.labourTetri;
}

// Parts and trackers in the mechanic's repair (stage 4; ADR-0036).

/** Off the shelf, bought by the mechanic, taken off onto the shelf, off a donor. */
export const SERVICE_PART_KINDS = ['stock', 'bought', 'removed', 'donor'] as const;
export type ServicePartKind = (typeof SERVICE_PART_KINDS)[number];

/** Only a bought line waits for a decision; the shelf and a donor are the company's own. */
export function partLineState(line: { kind?: string | null; approvedAt: unknown; rejectedAt: unknown }): WorkLineState | null {
  return line.kind === 'bought' ? workLineState(line) : null;
}

/**
 * An IMEI as it is read off a tracker's sticker: fifteen digits, spaces and
 * dashes allowed, and the last one a Luhn check digit — a digit typed wrong is
 * caught here and not when the moped is stolen. Null when it is not one.
 */
export function readImei(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/[\s-]/g, '');
  if (!/^[0-9]{15}$/.test(digits)) return null;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = Number(digits[14 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0 ? digits : null;
}

/** A SIM's number as it is kept: digits, a leading «+» if there was one. Null when it cannot be a number. */
export function readSimPhone(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  const plus = s.startsWith('+') ? '+' : '';
  const digits = s.replace(/[^0-9]/g, '');
  if (digits.length < 6 || digits.length > 15 || /[^0-9+\s()-]/.test(s)) return null;
  return plus + digits;
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
 * line. A payout rounds per repair (ADR-0037 §8): one call per repair, and a
 * payout is the sum of its repairs — so «К оплате», the repair's card, the
 * economics and the payout carry the same figure for a repair. The bot rounds
 * a whole payout once, so on other data the two may part by a tetri; that is
 * reported, not adjusted. On the bot's control (282.5 min at 50 ₾) both give
 * 235.42 ₾.
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

// Paying the mechanic (stage 5; ADR-0037).

/** A line of work as money reads it: its norm and rate, and the decision on it. */
export interface WorkMoneyLine extends WorkLine {
  approvedAt: unknown;
  rejectedAt: unknown;
}

/**
 * The approved mechanic work of one repair, rounded once for the repair
 * (ADR-0037 §8). A line waiting or refused is not work done; one approved
 * without a norm is not money until it has one (worksTotal skips it).
 */
export function approvedWorksTetri(works: readonly WorkMoneyLine[]): Tetri {
  return worksTotal(works.filter((w) => workLineState(w) === 'approved')).tetri;
}

/**
 * What a repair cost (ADR-0037 §6): the old line of hours and the parts — a
 * receipt is already among them (partLineTetri) — and, on the company's own
 * repair, the mechanic's approved work by the norm. A customer's repair is
 * charged what the owner typed and the parts: the mechanic's work is not added
 * to it, or the customer would pay for it twice. A repair called off cost no
 * work. Every place that sums a repair asks here.
 */
export function repairTotalTetri(job: {
  status: string;
  payer: string;
  labourTetri: Tetri;
  parts: readonly JobLine[];
  works: readonly WorkMoneyLine[];
}): Tetri {
  const works = job.payer === 'company' && job.status !== 'cancelled' ? approvedWorksTetri(job.works) : 0;
  return jobTotalTetri(job) + works;
}

/**
 * Where a repair stands for paying its mechanic (ADR-0037 §2): called off;
 * paid; still waiting — a draft, or a line of work or a bought part with no
 * decision; still in work; closed with an approved work that has no norm —
 * not payable until the chief mechanic gives it one; or payable.
 */
export type PayState = 'payable' | 'paid' | 'unnormed' | 'waiting' | 'open' | 'cancelled';

export function jobPayState(job: {
  status: string;
  paidInPayoutId: string | null;
  works: readonly { normSec: number | null; approvedAt: unknown; rejectedAt: unknown }[];
  parts: readonly { kind?: string | null; approvedAt: unknown; rejectedAt: unknown }[];
}): PayState {
  if (job.status === 'cancelled') return 'cancelled';
  if (job.paidInPayoutId != null) return 'paid';
  const waits = job.works.some((w) => workLineState(w) === 'waiting') || job.parts.some((p) => partLineState(p) === 'waiting');
  if (job.status === 'draft' || waits) return 'waiting';
  if (job.status === 'open') return 'open';
  if (job.works.some((w) => workLineState(w) === 'approved' && w.normSec == null)) return 'unnormed';
  return 'payable';
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
