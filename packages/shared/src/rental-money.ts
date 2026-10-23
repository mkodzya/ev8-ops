// A rental's money as one picture, and what a correction does to it (issue
// #10, ADR-0044).
//
// The server settles a customer's credit one payment at a time, oldest first
// (`settleCredit`), each spread over the rental in the one order the rules
// give (PAY-02): the deposit while the rental runs, then the weeks from the
// oldest, then what was charged. A correction — the pickup moved to its true
// day, a deposit marked received before EV8 Ops — frees some of what payments
// closed, and the same order places that money again. The sheet shows it
// before anything is written: «что куда ляжет, долг до и после». This is the
// arithmetic both read, with no database; the server writes it the way it
// always has and a test holds the two to one answer.
import { customerDebt } from './debt.js';
import { paidThrough, periodPayStatus } from './periods.js';
import { spreadOverOwed, spreadPayment, type Allocation, type OpenDeposit, type OpenPeriod, type Owed, type Spread } from './payments.js';
import { daysBetween } from './time.js';
import type { Tetri } from './money.js';
import type { ISODate } from './types.js';

/** What a rental's money can close, as the spread reads it. */
export interface RentalOwedShape {
  deposit: OpenDeposit | null;
  periods: OpenPeriod[];
  charges: Owed[];
}

/**
 * Spread money over a rental in the one order (PAY-02, wave 3 §3.7): the
 * deposit first while the rental runs, then the weeks from the oldest, then
 * what a return or an owner charged. `deposit: false` leaves the deposit
 * alone — money kept out of it, rent closed by a mechanic's work.
 */
export function spreadRentalOwed(amountTetri: Tetri, owed: RentalOwedShape, opts: { deposit?: boolean } = {}): Spread {
  const first = spreadPayment(amountTetri, owed.periods, opts.deposit === false ? null : owed.deposit);
  const rest = spreadOverOwed(first.leftoverTetri, owed.charges, 'charge');
  return { allocations: [...first.allocations, ...rest.allocations], leftoverTetri: rest.leftoverTetri };
}

/** A payment as the settling reads it: what of it nothing has taken yet. */
export interface CreditPayment {
  id: string;
  creditTetri: Tetri;
}

export interface PlacedCredit {
  paymentId: string;
  allocations: Allocation[];
}

function applyAllocations(owed: RentalOwedShape, allocations: readonly Allocation[]): void {
  for (const a of allocations) {
    if (a.target === 'deposit' && owed.deposit?.id === a.id) owed.deposit.paidTetri += a.amountTetri;
    if (a.target === 'period') {
      const p = owed.periods.find((x) => x.id === a.id);
      if (p) p.paidTetri += a.amountTetri;
    }
    if (a.target === 'charge') {
      const c = owed.charges.find((x) => x.id === a.id);
      if (c) c.paidTetri += a.amountTetri;
    }
  }
}

/**
 * `settleCredit` without a database: each payment's credit, oldest first —
 * the order the caller gives — spread over what is still owed after the
 * payments before it.
 */
export function settleCreditPlan(payments: readonly CreditPayment[], owed: RentalOwedShape): { placed: PlacedCredit[]; owed: RentalOwedShape } {
  const now: RentalOwedShape = {
    deposit: owed.deposit ? { ...owed.deposit } : null,
    periods: owed.periods.map((p) => ({ ...p })),
    charges: owed.charges.map((c) => ({ ...c })),
  };
  const placed: PlacedCredit[] = [];
  for (const p of payments) {
    if (p.creditTetri <= 0) continue;
    const spread = spreadRentalOwed(p.creditTetri, now);
    if (spread.allocations.length === 0) continue;
    applyAllocations(now, spread.allocations);
    placed.push({ paymentId: p.id, allocations: spread.allocations });
  }
  return { placed, owed: now };
}

// ---------------------------------------------------------------------------
// A rental's money, with whose money closed what
// ---------------------------------------------------------------------------

/** One payment's part on one thing a rental owes; `id` — the allocation row, when it has one. */
export interface MoneyPart {
  paymentId: string;
  amountTetri: Tetri;
  id?: string;
}

export interface MoneyWeek {
  id: string;
  seq: number;
  startsOn: ISODate;
  endsOn: ISODate;
  amountTetri: Tetri;
  /** Paid without a payment: a week brought over as paid (B3-02). */
  paidBeforeTransfer: boolean;
  parts: MoneyPart[];
}

export interface MoneyDeposit {
  id: string;
  amountTetri: Tetri;
  /** Received before EV8 Ops — no payment behind it (ADR-0044). */
  receivedBeforeTetri: Tetri;
  /** Oldest payment first: the order a correction frees them in. */
  parts: MoneyPart[];
}

export interface RentalMoney {
  weeks: MoneyWeek[];
  /** Null once the rental is returned: the deposit is then the decision's, not a debt (B5-08). */
  deposit: MoneyDeposit | null;
  /** In the order they were charged. */
  charges: { id: string; amountTetri: Tetri; parts: MoneyPart[] }[];
  /** The payments `settleCredit` reads for this rental, oldest first, with what of each nothing has taken yet. */
  credit: CreditPayment[];
}

const sumParts = (parts: readonly MoneyPart[]) => parts.reduce((n, p) => n + p.amountTetri, 0);

/** A week's paid figure as `recomputeRental` works it out. */
export function weekPaidTetri(w: Pick<MoneyWeek, 'amountTetri' | 'paidBeforeTransfer' | 'parts'>): Tetri {
  return w.paidBeforeTransfer ? w.amountTetri : sumParts(w.parts);
}

/** The deposit's received figure: what came before EV8 Ops, and what payments put on it. */
export function depositPaidTetri(d: Pick<MoneyDeposit, 'receivedBeforeTetri' | 'parts'>): Tetri {
  return d.receivedBeforeTetri + sumParts(d.parts);
}

export function owedOf(m: RentalMoney): RentalOwedShape {
  return {
    deposit: m.deposit ? { id: m.deposit.id, amountTetri: m.deposit.amountTetri, paidTetri: depositPaidTetri(m.deposit) } : null,
    periods: m.weeks.map((w) => ({ id: w.id, seq: w.seq, amountTetri: w.amountTetri, paidTetri: weekPaidTetri(w) })),
    charges: m.charges.map((c, i) => ({ id: c.id, seq: i + 1, amountTetri: c.amountTetri, paidTetri: sumParts(c.parts) })),
  };
}

/** The money after `settleCredit` has run: every payment's credit placed by the one order. */
export function settleMoney(m: RentalMoney): RentalMoney {
  const { placed } = settleCreditPlan(m.credit, owedOf(m));
  const out: RentalMoney = {
    weeks: m.weeks.map((w) => ({ ...w, parts: [...w.parts] })),
    deposit: m.deposit ? { ...m.deposit, parts: [...m.deposit.parts] } : null,
    charges: m.charges.map((c) => ({ ...c, parts: [...c.parts] })),
    credit: m.credit.map((p) => ({ ...p })),
  };
  for (const p of placed) {
    for (const a of p.allocations) {
      const part = { paymentId: p.paymentId, amountTetri: a.amountTetri };
      if (a.target === 'deposit' && out.deposit) out.deposit.parts.push(part);
      if (a.target === 'period') out.weeks.find((w) => w.id === a.id)?.parts.push(part);
      if (a.target === 'charge') out.charges.find((c) => c.id === a.id)?.parts.push(part);
      const credit = out.credit.find((c) => c.id === p.paymentId);
      if (credit) credit.creditTetri -= a.amountTetri;
    }
  }
  return out;
}

/** Money freed from what it closed goes back to its payment, which `settleCredit` then reads. */
export function moneyWithCredit(credit: readonly CreditPayment[], freed: readonly MoneyPart[]): CreditPayment[] {
  const out = credit.map((c) => ({ ...c }));
  for (const f of freed) {
    const c = out.find((x) => x.id === f.paymentId);
    if (c) c.creditTetri += f.amountTetri;
  }
  return out;
}

/**
 * What this rental alone owes today, the card's figure (B7-02): its weeks due
 * by their pay day, a deposit not received in full, its charges — the one
 * debt function, asked about one rental.
 */
export function rentalOwesTetri(m: RentalMoney, ctx: { today: ISODate; payOffsetDays: number }): Tetri {
  const owed = owedOf(m);
  const debt = customerDebt({
    today: ctx.today,
    rentals: [
      {
        id: 'rental',
        number: '',
        open: m.deposit != null,
        periods: m.weeks.map((w, i) => ({ startsOn: w.startsOn, amountTetri: w.amountTetri, paidTetri: owed.periods[i].paidTetri })),
        payOffsetDays: ctx.payOffsetDays,
        deposit: owed.deposit,
        charges: owed.charges,
      },
    ],
    sales: [],
    repairs: [],
    unplacedTetri: 0,
    depositHeldTetri: 0,
  });
  return debt.parts.reduce((n, p) => n + p.owesTetri, 0);
}

/** "Paid through" of these weeks, as `recomputeRental` works it out. */
export function moneyPaidThrough(m: RentalMoney): ISODate | null {
  return paidThrough(m.weeks.map((w) => ({ seq: w.seq, endsOn: w.endsOn, payStatus: periodPayStatus(w.amountTetri, weekPaidTetri(w)) })));
}

// ---------------------------------------------------------------------------
// Before and after, for the sheet
// ---------------------------------------------------------------------------

/** Where a payment's money lies on this rental: the deposit, a week by its number, a charge — or nowhere yet. */
export interface MoneyTarget {
  kind: 'deposit' | 'week' | 'charge' | 'credit';
  /** The week's number, or the charge's place in the list. */
  seq?: number;
  amountTetri: Tetri;
}

export interface MoneyChange {
  /** Every week before or after, by its number: its days on each side (null — not there), its price, what is paid on it. */
  weeks: { seq: number; was: { startsOn: ISODate; endsOn: ISODate } | null; now: { startsOn: ISODate; endsOn: ISODate } | null; amountTetri: Tetri; paidWas: Tetri; paidNow: Tetri }[];
  deposit: { amountTetri: Tetri; paidWas: Tetri; paidNow: Tetri; receivedBeforeWas: Tetri; receivedBeforeNow: Tetri } | null;
  /** Each payment whose money lies elsewhere after: what it closed before, and what it closes after. */
  moves: { paymentId: string; was: MoneyTarget[]; now: MoneyTarget[] }[];
  owes: { was: Tetri; now: Tetri };
  paidThrough: { was: ISODate | null; now: ISODate | null };
}

function targetsOf(m: RentalMoney, paymentId: string): MoneyTarget[] {
  const out: MoneyTarget[] = [];
  const add = (kind: MoneyTarget['kind'], parts: readonly MoneyPart[], seq?: number) => {
    const sum = sumParts(parts.filter((p) => p.paymentId === paymentId));
    if (sum > 0) out.push({ kind, ...(seq != null ? { seq } : {}), amountTetri: sum });
  };
  if (m.deposit) add('deposit', m.deposit.parts);
  for (const w of [...m.weeks].sort((a, b) => a.seq - b.seq)) add('week', w.parts, w.seq);
  m.charges.forEach((c, i) => add('charge', c.parts, i + 1));
  const credit = m.credit.find((c) => c.id === paymentId)?.creditTetri ?? 0;
  if (credit > 0) out.push({ kind: 'credit', amountTetri: credit });
  return out;
}

const sameTargets = (a: MoneyTarget[], b: MoneyTarget[]) => JSON.stringify(a) === JSON.stringify(b);

/** The money of a rental before a correction and after it, side by side. */
export function moneyChange(was: RentalMoney, now: RentalMoney, ctx: { today: ISODate; payOffsetWas: number; payOffsetNow: number }): MoneyChange {
  const seqs = [...new Set([...was.weeks, ...now.weeks].map((w) => w.seq))].sort((a, b) => a - b);
  const weeks = seqs.map((seq) => {
    const a = was.weeks.find((w) => w.seq === seq);
    const b = now.weeks.find((w) => w.seq === seq);
    return {
      seq,
      was: a ? { startsOn: a.startsOn, endsOn: a.endsOn } : null,
      now: b ? { startsOn: b.startsOn, endsOn: b.endsOn } : null,
      amountTetri: (b ?? a)!.amountTetri,
      paidWas: a ? weekPaidTetri(a) : 0,
      paidNow: b ? weekPaidTetri(b) : 0,
    };
  });
  const payments = [
    ...new Set([
      ...[...was.weeks, ...now.weeks].flatMap((w) => w.parts.map((p) => p.paymentId)),
      ...[was.deposit, now.deposit].flatMap((d) => d?.parts.map((p) => p.paymentId) ?? []),
      ...[...was.charges, ...now.charges].flatMap((c) => c.parts.map((p) => p.paymentId)),
      ...now.credit.map((c) => c.id),
    ]),
  ];
  const moves = payments
    .map((paymentId) => ({ paymentId, was: targetsOf(was, paymentId), now: targetsOf(now, paymentId) }))
    .filter((m) => !sameTargets(m.was, m.now));
  // Payments in the order they came: the order `settleCredit` reads them in.
  const order = new Map(now.credit.map((c, i) => [c.id, i]));
  moves.sort((a, b) => (order.get(a.paymentId) ?? -1) - (order.get(b.paymentId) ?? -1));
  return {
    weeks,
    deposit:
      was.deposit && now.deposit
        ? {
            amountTetri: now.deposit.amountTetri,
            paidWas: depositPaidTetri(was.deposit),
            paidNow: depositPaidTetri(now.deposit),
            receivedBeforeWas: was.deposit.receivedBeforeTetri,
            receivedBeforeNow: now.deposit.receivedBeforeTetri,
          }
        : null,
    moves,
    owes: { was: rentalOwesTetri(was, { today: ctx.today, payOffsetDays: ctx.payOffsetWas }), now: rentalOwesTetri(now, { today: ctx.today, payOffsetDays: ctx.payOffsetNow }) },
    paidThrough: { was: moneyPaidThrough(was), now: moneyPaidThrough(now) },
  };
}

// ---------------------------------------------------------------------------
// The deposit received before EV8 Ops, on a running rental (ADR-0044 §2)
// ---------------------------------------------------------------------------
//
// The first case of issue #10: a deposit came with the customer's previous
// moped, before EV8 Ops; the rental was entered without saying so, and the
// first rent went onto the deposit by the order's rule. The owner marks the
// deposit received earlier: no money behind it, never in «Пришло денег» or the
// till, as a rental carried over has it (B3-02). What payments put on the
// deposit beyond its sum is freed, oldest payment first — the first payment of
// a rental is the one the rule sends to the deposit — and the order places it
// on the weeks. The second case is the reverse: the mark was set and the
// deposit came by the bank; it is taken off (0), and the bank line then closes
// the deposit first.

export interface DepositBeforePlan {
  /** The money after the mark and the parts it frees, before `settleCredit` places them. */
  money: RentalMoney;
  /** What was freed, payment by payment (an allocation row's `id` with its sum taken off). */
  freed: MoneyPart[];
  freedTetri: Tetri;
}

/**
 * The deposit marked received before EV8 Ops for `receivedBeforeTetri` (0 —
 * the mark taken off). Set, not added: a second mark replaces the first. The
 * parts payments put on the deposit beyond its sum are freed, oldest first.
 */
export function depositBeforePlan(m: RentalMoney, receivedBeforeTetri: Tetri): DepositBeforePlan {
  const d = m.deposit;
  if (!d) throw new Error('no deposit on a rental that runs');
  if (!Number.isInteger(receivedBeforeTetri) || receivedBeforeTetri < 0 || receivedBeforeTetri > d.amountTetri) {
    throw new Error(`received earlier is 0 to the deposit's sum, got ${receivedBeforeTetri}`);
  }
  let excess = Math.max(0, receivedBeforeTetri + sumParts(d.parts) - d.amountTetri);
  const freed: MoneyPart[] = [];
  const parts: MoneyPart[] = [];
  for (const p of d.parts) {
    const take = Math.min(p.amountTetri, excess);
    excess -= take;
    if (take > 0) freed.push({ ...p, amountTetri: take });
    if (p.amountTetri - take > 0) parts.push({ ...p, amountTetri: p.amountTetri - take });
  }
  return {
    money: { ...m, deposit: { ...d, receivedBeforeTetri, parts }, credit: moneyWithCredit(m.credit, freed) },
    freed,
    freedTetri: sumParts(freed),
  };
}

/**
 * The pickup wizard, carrying a rental over (ADR-0044 §3): «залог получен
 * ранее» is not ticked by itself, and for a rental handed over in the last
 * three weeks ticking it first asks whether the deposit came by the bank or in
 * cash after the hand-over — in the second case of issue #10 it came by the
 * bank on the day of the hand-over, and was marked received earlier all the
 * same. A hand-over older than that is a rental from before EV8 Ops, whose
 * deposit was taken then.
 */
export const DEPOSIT_EARLIER_ASK_DAYS = 21;

export function depositEarlierAsks(pickedUpOn: ISODate, today: ISODate): boolean {
  return daysBetween(pickedUpOn, today) <= DEPOSIT_EARLIER_ASK_DAYS;
}

