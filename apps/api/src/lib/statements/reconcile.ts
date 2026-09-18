import { daysBetween, grossOf, nameMatches, todayISO } from '@ev8/shared';
import { isoDate } from '../dates.js';
import { prisma } from '../db.js';
import { env } from '../env.js';

// What to do with one bank line (wave 2 §3.2, B2-03…B2-06, ADR-0004).
//
// One function decides, for the import and for its preview alike; the same
// reading gives the queue its hints, each with its reason in words. In order:
//   1. the money is already in, entered by hand: a payment of this amount
//      (gross or net) within ±3 days that has no bank line yet (Q2);
//   2. cash an owner took to the bank, found by amount and date;
//   3. a rule — and a rule needs two signs, never an amount alone:
//      the payer's name is one customer with one record this amount fits, or
//      the amount fits a rental and the date is its pick-up day or falls in
//      the week the amount would close. Disputed, paused and booked rentals
//      take part in no rule (Q25);
//   4. otherwise a person decides.

export const WINDOW_DAYS = 3;

/** A bank line as the rules read it. */
export interface Line {
  occurredOn: string;
  direction: 'in' | 'out';
  amountTetri: number;
  grossTetri: number | null;
  feeTetri: number | null;
  payer: string | null;
  purpose: string | null;
  raw: string;
  channel: 'transfer' | 'acquiring' | 'cash';
  bank: 'bog' | 'tbc' | 'credo';
}

interface RentalCand {
  id: string;
  number: string;
  customerId: string;
  customer: string;
  names: (string | null)[];
  status: string;
  pickedUpOn: string | null;
  weeklyRateTetri: number;
  openDepositTetri: number;
  openFirstPeriodTetri: number;
  firstOpenPeriod: { startsOn: string; endsOn: string } | null;
  owedNowTetri: number;
  openTotalTetri: number;
}

interface SaleCand {
  id: string;
  number: string;
  customerId: string;
  customer: string;
  names: (string | null)[];
  nextOpenTetri: number;
  dueOpenTetri: number;
}

interface PaymentCand {
  id: string;
  customerId: string | null;
  direction: 'in' | 'out';
  kind: string;
  occurredOn: string;
  grossTetri: number;
  netTetri: number;
  customer: string | null;
  number: string | null;
}

interface BankDepositCand {
  id: string;
  bank: string;
  occurredOn: string;
  amountTetri: number;
}

export interface Ctx {
  today: string;
  rentals: RentalCand[];
  sales: SaleCand[];
  customers: { id: string; name: string; names: (string | null)[] }[];
  payments: PaymentCand[];
  bankDeposits: BankDepositCand[];
}

const RULE_RENTALS = new Set(['active', 'overdue']);

/** Everything the rules look at, read once. */
export async function loadCtx(): Promise<Ctx> {
  const today = todayISO(new Date(), env.TZ);
  const [rentals, sales, customers, payments, bankDeposits] = await Promise.all([
    prisma.rental.findMany({
      include: {
        customer: { select: { id: true, name: true, nameKa: true, nameLat: true } },
        deposit: { select: { amountTetri: true, paidTetri: true } },
        periods: { orderBy: { seq: 'asc' }, select: { startsOn: true, endsOn: true, amountTetri: true, paidTetri: true } },
      },
    }),
    prisma.sale.findMany({
      where: { status: 'active' },
      include: { customer: { select: { name: true, nameKa: true, nameLat: true } }, instalments: { orderBy: { seq: 'asc' } } },
    }),
    prisma.customer.findMany({ where: { archived: false }, select: { id: true, name: true, nameKa: true, nameLat: true } }),
    prisma.payment.findMany({
      where: { statementLineId: null, voidedAt: null, source: 'manual', channel: { not: 'cash' } },
      select: {
        id: true,
        direction: true,
        kind: true,
        occurredOn: true,
        grossTetri: true,
        netTetri: true,
        customerId: true,
        customer: { select: { name: true } },
        rental: { select: { number: true } },
        sale: { select: { number: true } },
        purchase: { select: { number: true } },
      },
    }),
    prisma.bankCashDeposit.findMany({ where: { statementLineId: null, voidedAt: null }, select: { id: true, bank: true, occurredOn: true, amountTetri: true } }),
  ]);
  return {
    today,
    rentals: rentals.map((r) => {
      const open = r.periods.filter((p) => p.paidTetri < p.amountTetri);
      const first = open[0] ?? null;
      const openDeposit = r.deposit ? Math.max(0, r.deposit.amountTetri - r.deposit.paidTetri) : 0;
      const owedNow = r.periods.filter((p) => isoDate(p.startsOn)! <= today).reduce((n, p) => n + Math.max(0, p.amountTetri - p.paidTetri), 0);
      return {
        id: r.id,
        number: r.number,
        customerId: r.customerId,
        customer: r.customer.name,
        names: [r.customer.name, r.customer.nameKa, r.customer.nameLat],
        status: r.status,
        pickedUpOn: isoDate(r.pickedUpOn),
        weeklyRateTetri: r.weeklyRateTetri,
        openDepositTetri: openDeposit,
        openFirstPeriodTetri: first ? first.amountTetri - first.paidTetri : 0,
        firstOpenPeriod: first ? { startsOn: isoDate(first.startsOn)!, endsOn: isoDate(first.endsOn)! } : null,
        owedNowTetri: owedNow + (RULE_RENTALS.has(r.status) || r.status === 'paused' || r.status === 'disputed' || r.status === 'booked' ? openDeposit : 0),
        openTotalTetri: openDeposit + open.reduce((n, p) => n + p.amountTetri - p.paidTetri, 0),
      };
    }),
    sales: sales.map((s) => {
      const open = s.instalments.filter((i) => i.paidTetri < i.amountTetri);
      return {
        id: s.id,
        number: s.number,
        customerId: s.customerId,
        customer: s.customer.name,
        names: [s.customer.name, s.customer.nameKa, s.customer.nameLat],
        nextOpenTetri: open[0] ? open[0].amountTetri - open[0].paidTetri : 0,
        dueOpenTetri: open.filter((i) => isoDate(i.dueOn)! <= today).reduce((n, i) => n + i.amountTetri - i.paidTetri, 0),
      };
    }),
    customers: customers.map((c) => ({ id: c.id, name: c.name, names: [c.name, c.nameKa, c.nameLat] })),
    payments: payments.map((p) => ({
      id: p.id,
      customerId: p.customerId,
      direction: p.direction,
      kind: p.kind,
      occurredOn: isoDate(p.occurredOn)!,
      grossTetri: p.grossTetri,
      netTetri: p.netTetri,
      customer: p.customer?.name ?? null,
      number: p.rental?.number ?? p.sale?.number ?? p.purchase?.number ?? null,
    })),
    bankDeposits: bankDeposits.map((b) => ({ id: b.id, bank: b.bank, occurredOn: isoDate(b.occurredOn)!, amountTetri: b.amountTetri })),
  };
}

/** The gross a line stands for: what closes a debt (a card line's net plus the 1.5 %). */
export function lineGross(line: Line): number {
  return grossOf({ amountTetri: line.amountTetri, grossTetri: line.grossTetri, occurredOn: line.occurredOn, channel: line.channel, payer: line.payer, purpose: line.purpose });
}

// Words a bank uses for cash paid in at a branch (Q2-b: more from a sample
// statement when there is one).
const CASH_DEPOSIT = /(cash\s*deposit|naRdi\s*fulis\s*Setana|ნაღდი\s*ფულის\s*შეტანა|შეტანა|Setana|взнос\s*налич)/i;
export const isCashDeposit = (line: Line) => line.direction === 'in' && CASH_DEPOSIT.test(`${line.purpose ?? ''} ${line.raw}`);

const near = (a: string, b: string) => Math.abs(daysBetween(a, b)) <= WINDOW_DAYS;

/**
 * Payments entered by hand this line may already be (B2-03): the amount,
 * gross or net, within ±3 days. When the line names a customer, only that
 * customer's payments — the same sum from somebody else is somebody else's.
 */
export function recordedFor(line: Line, ctx: Ctx): PaymentCand[] {
  const gross = lineGross(line);
  const text = [line.payer, line.purpose].filter(Boolean).join(' ');
  const named = text ? new Set(ctx.customers.filter((c) => nameMatches(text, c.names)).map((c) => c.id)) : new Set<string>();
  return ctx.payments.filter(
    (p) =>
      p.direction === line.direction &&
      near(p.occurredOn, line.occurredOn) &&
      (p.grossTetri === gross || p.netTetri === line.amountTetri || p.grossTetri === line.amountTetri) &&
      (named.size === 0 || (p.customerId != null && named.has(p.customerId))),
  );
}

function rentalFits(r: RentalCand, gross: number): boolean {
  return [r.openDepositTetri + r.openFirstPeriodTetri, r.openFirstPeriodTetri, r.openTotalTetri, r.weeklyRateTetri, r.owedNowTetri].some((n) => n > 0 && n === gross);
}
function saleFits(s: SaleCand, gross: number): boolean {
  return [s.nextOpenTetri, s.dueOpenTetri].some((n) => n > 0 && n === gross);
}

export type RuleTarget = { rentalId: string; saleId?: undefined } | { saleId: string; rentalId?: undefined };

export type Decision =
  | { type: 'recorded'; paymentId: string }
  | { type: 'bank_deposit'; bankDepositId: string }
  | { type: 'rule'; rule: 'payer_name' | 'amount_date' | 'card_pickup_day'; target: RuleTarget; customerId: string; reason: Reason }
  | { type: 'queue' };

/** A reason, in data; the screen says it in its language (§3.2 "причина словами"). */
export interface Reason {
  code: 'name' | 'card_pickup' | 'amount_week' | 'amount' | 'recorded' | 'bank_deposit';
  name?: string;
  number?: string;
  debtTetri?: number;
  grossTetri?: number;
  feeTetri?: number;
  netTetri?: number;
  day?: string;
}

export function decide(line: Line, ctx: Ctx): Decision {
  const recorded = recordedFor(line, ctx);
  if (recorded.length === 1) return { type: 'recorded', paymentId: recorded[0].id };
  if (recorded.length > 1) return { type: 'queue' };
  if (line.direction === 'out') return { type: 'queue' };

  if (isCashDeposit(line)) {
    const deposits = ctx.bankDeposits.filter((b) => b.bank === line.bank && b.amountTetri === line.amountTetri && near(b.occurredOn, line.occurredOn));
    if (deposits.length === 1) return { type: 'bank_deposit', bankDepositId: deposits[0].id };
    return { type: 'queue' };
  }

  const gross = lineGross(line);
  const eligible = ctx.rentals.filter((r) => RULE_RENTALS.has(r.status));
  const text = [line.payer, line.purpose].filter(Boolean).join(' ');

  // 1. The name, and one record of that customer's that this amount fits.
  const who = text ? ctx.customers.filter((c) => nameMatches(text, c.names)) : [];
  {
    if (who.length === 1) {
      const c = who[0];
      const rentals = eligible.filter((r) => r.customerId === c.id && rentalFits(r, gross));
      const sales = ctx.sales.filter((s) => s.customerId === c.id && saleFits(s, gross));
      if (rentals.length + sales.length === 1) {
        const target: RuleTarget = rentals[0] ? { rentalId: rentals[0].id } : { saleId: sales[0].id };
        const number = rentals[0]?.number ?? sales[0].number;
        const debt = rentals[0]?.owedNowTetri ?? sales[0].dueOpenTetri;
        return { type: 'rule', rule: 'payer_name', target, customerId: c.id, reason: { code: 'name', name: c.name, number, debtTetri: debt } };
      }
    }
  }

  // 2. The amount, and the date: the pick-up day, or inside the week it closes.
  //    A line that names somebody is about that somebody: nobody else's rental.
  const named = new Set(who.map((c) => c.id));
  const byDate = eligible.filter(
    (r) =>
      (named.size === 0 || named.has(r.customerId)) &&
      rentalFits(r, gross) &&
      (r.pickedUpOn === line.occurredOn || (!!r.firstOpenPeriod && line.occurredOn >= r.firstOpenPeriod.startsOn && line.occurredOn <= r.firstOpenPeriod.endsOn)),
  );
  if (byDate.length === 1) {
    const r = byDate[0];
    const pickup = r.pickedUpOn === line.occurredOn;
    return {
      type: 'rule',
      rule: pickup && line.channel === 'acquiring' ? 'card_pickup_day' : 'amount_date',
      target: { rentalId: r.id },
      customerId: r.customerId,
      reason: pickup
        ? { code: 'card_pickup', number: r.number, name: r.customer, grossTetri: gross, feeTetri: gross - line.amountTetri, netTetri: line.amountTetri, day: line.occurredOn }
        : { code: 'amount_week', number: r.number, name: r.customer, debtTetri: r.owedNowTetri },
    };
  }
  return { type: 'queue' };
}

export interface Suggestion {
  kind: 'rental' | 'sale' | 'customer' | 'payment' | 'bank_deposit';
  id: string;
  number: string | null;
  customer: string | null;
  customerId?: string;
  amountTetri?: number;
  occurredOn?: string;
  reason: Reason;
}

/**
 * What the queue offers under a line, best first (§3.2 "Подсказки"): the
 * payer's own records with a debt — returned rentals included — then amount
 * and date, then the rest. Already-recorded candidates are their own group.
 */
export function suggest(line: Line, ctx: Ctx): { group: 'recorded' | 'suggested' | 'none'; recorded: Suggestion[]; suggestions: Suggestion[] } {
  const recorded: Suggestion[] = recordedFor(line, ctx).map((p) => ({
    kind: 'payment',
    id: p.id,
    number: p.number,
    customer: p.customer,
    amountTetri: p.grossTetri,
    occurredOn: p.occurredOn,
    reason: { code: 'recorded', number: p.number ?? undefined, name: p.customer ?? undefined },
  }));
  if (recorded.length > 0) return { group: 'recorded', recorded, suggestions: [] };

  const out: Suggestion[] = [];
  if (line.direction === 'in') {
    const gross = lineGross(line);
    const deposits = ctx.bankDeposits.filter((b) => b.amountTetri === line.amountTetri && near(b.occurredOn, line.occurredOn));
    for (const b of deposits) out.push({ kind: 'bank_deposit', id: b.id, number: null, customer: null, amountTetri: b.amountTetri, occurredOn: b.occurredOn, reason: { code: 'bank_deposit' } });

    const text = [line.payer, line.purpose].filter(Boolean).join(' ');
    const who = text ? ctx.customers.filter((c) => nameMatches(text, c.names)) : [];
    for (const c of who) {
      for (const r of ctx.rentals.filter((x) => x.customerId === c.id && x.owedNowTetri > 0)) {
        out.push({ kind: 'rental', id: r.id, number: r.number, customer: c.name, customerId: c.id, reason: { code: 'name', name: c.name, number: r.number, debtTetri: r.owedNowTetri } });
      }
      for (const s of ctx.sales.filter((x) => x.customerId === c.id && (x.dueOpenTetri > 0 || x.nextOpenTetri > 0))) {
        out.push({ kind: 'sale', id: s.id, number: s.number, customer: c.name, customerId: c.id, reason: { code: 'name', name: c.name, number: s.number, debtTetri: s.dueOpenTetri || s.nextOpenTetri } });
      }
      out.push({ kind: 'customer', id: c.id, number: null, customer: c.name, customerId: c.id, reason: { code: 'name', name: c.name } });
    }
    const seen = new Set(out.map((s) => s.id));
    for (const r of ctx.rentals.filter((x) => !seen.has(x.id) && x.pickedUpOn === line.occurredOn && rentalFits(x, gross))) {
      out.push({
        kind: 'rental',
        id: r.id,
        number: r.number,
        customer: r.customer,
        customerId: r.customerId,
        reason: { code: 'card_pickup', number: r.number, grossTetri: gross, feeTetri: gross - line.amountTetri, netTetri: line.amountTetri, day: line.occurredOn },
      });
      seen.add(r.id);
    }
    for (const r of ctx.rentals.filter((x) => !seen.has(x.id) && rentalFits(x, gross))) {
      out.push({ kind: 'rental', id: r.id, number: r.number, customer: r.customer, customerId: r.customerId, reason: { code: 'amount', number: r.number, debtTetri: r.owedNowTetri } });
      seen.add(r.id);
    }
    for (const s of ctx.sales.filter((x) => !seen.has(x.id) && saleFits(x, gross))) {
      out.push({ kind: 'sale', id: s.id, number: s.number, customer: s.customer, customerId: s.customerId, reason: { code: 'amount', number: s.number, debtTetri: s.dueOpenTetri || s.nextOpenTetri } });
    }
  }
  const suggestions = out.slice(0, 8);
  return { group: suggestions.length > 0 ? 'suggested' : 'none', recorded: [], suggestions };
}
