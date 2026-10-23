import { daysBetween, goodsTotals, grossOf, nameMatches, todayISO } from '@ev8/shared';
import { isoDate } from '../dates.js';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { cardOf } from './parse.js';

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
//      take part in no rule (Q25), and neither does a rental carried over
//      with its paid weeks for a line dated on or before the day it was
//      carried over: that money may already be inside its «paid through»;
//   4. otherwise a person decides.
// A goods sale (issue #11, ADR-0045) takes part in the name rule only — one
// record of that customer's with a debt of exactly this sum — and is never
// attached by its amount alone. An open goods sale of the same sum within
// ±3 days stops the rental's amount-and-date rules: the line waits for a
// person, who sees the goods sale among the hints.

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
  /** The day a running rental was carried over with its paid weeks (the transfer wizard, the loader); null for one handed over here. */
  transferredOn: string | null;
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

interface GoodsCand {
  id: string;
  number: string;
  /** Null: a retail buyer with no card. */
  customerId: string | null;
  /** The customer's name; for a retail buyer the name he gave, if any. */
  customer: string | null;
  names: (string | null)[];
  openTetri: number;
  soldOn: string;
  promisedChannel: 'acquiring' | 'transfer' | null;
}

interface PaymentCand {
  id: string;
  customerId: string | null;
  rentalId: string | null;
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
  /** Goods sales with money still open (ADR-0045). */
  goods: GoodsCand[];
  customers: { id: string; name: string; names: (string | null)[] }[];
  payments: PaymentCand[];
  bankDeposits: BankDepositCand[];
}

const RULE_RENTALS = new Set(['active', 'overdue']);

/** Everything the rules look at, read once. */
export async function loadCtx(): Promise<Ctx> {
  const today = todayISO(new Date(), env.TZ);
  const [rentals, sales, goods, customers, payments, bankDeposits] = await Promise.all([
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
    prisma.goodsSale.findMany({
      where: { status: 'active' },
      select: {
        id: true,
        number: true,
        customerId: true,
        buyerName: true,
        soldOn: true,
        promisedChannel: true,
        customer: { select: { name: true, nameKa: true, nameLat: true } },
        lines: { select: { qty: true, unitPriceTetri: true } },
        payments: { where: { voidedAt: null, kind: 'goods' }, select: { grossTetri: true } },
      },
    }),
    prisma.customer.findMany({ where: { archived: false }, select: { id: true, name: true, nameKa: true, nameLat: true } }),
    prisma.payment.findMany({
      // Cash and rent closed by work (0066) never reach a bank: no line is theirs.
      where: { statementLineId: null, voidedAt: null, source: 'manual', channel: { notIn: ['cash', 'offset'] } },
      select: {
        id: true,
        direction: true,
        kind: true,
        occurredOn: true,
        grossTetri: true,
        netTetri: true,
        customerId: true,
        rentalId: true,
        customer: { select: { name: true } },
        rental: { select: { number: true } },
        sale: { select: { number: true } },
        purchase: { select: { number: true } },
        goodsSale: { select: { number: true } },
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
        transferredOn: r.transferredAt ? todayISO(r.transferredAt, env.TZ) : null,
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
    goods: goods
      .map((g) => ({
        id: g.id,
        number: g.number,
        customerId: g.customerId,
        customer: g.customer?.name ?? g.buyerName ?? null,
        names: g.customer ? [g.customer.name, g.customer.nameKa, g.customer.nameLat] : [g.buyerName],
        openTetri: Math.max(0, goodsTotals(g.lines).grossTetri - g.payments.reduce((n, p) => n + p.grossTetri, 0)),
        soldOn: isoDate(g.soldOn)!,
        promisedChannel: (g.promisedChannel as 'acquiring' | 'transfer' | null) ?? null,
      }))
      .filter((g) => g.openTetri > 0),
    customers: customers.map((c) => ({ id: c.id, name: c.name, names: [c.name, c.nameKa, c.nameLat] })),
    payments: payments.map((p) => ({
      id: p.id,
      customerId: p.customerId,
      rentalId: p.rentalId,
      direction: p.direction,
      kind: p.kind,
      occurredOn: isoDate(p.occurredOn)!,
      grossTetri: p.grossTetri,
      netTetri: p.netTetri,
      customer: p.customer?.name ?? null,
      number: p.rental?.number ?? p.sale?.number ?? p.purchase?.number ?? p.goodsSale?.number ?? null,
    })),
    bankDeposits: bankDeposits.map((b) => ({ id: b.id, bank: b.bank, occurredOn: isoDate(b.occurredOn)!, amountTetri: b.amountTetri })),
  };
}

/** A line as it is stored, read the way the rules read it. */
export function storedLine(l: {
  occurredOn: Date;
  direction: 'in' | 'out';
  amountTetri: number;
  grossTetri: number | null;
  feeTetri: number | null;
  payer: string | null;
  purpose: string | null;
  raw: string;
  bank: 'bog' | 'tbc' | 'credo';
}): Line {
  // A card line is told by its text as well as by its stored sums: one loaded
  // before a bank's wording was known is read here as it would be read today.
  const card = l.direction === 'in' ? cardOf(l) : null;
  return {
    occurredOn: isoDate(l.occurredOn)!,
    direction: l.direction,
    amountTetri: l.amountTetri,
    grossTetri: card?.grossTetri ?? null,
    feeTetri: card?.feeTetri ?? null,
    payer: l.payer,
    purpose: l.purpose,
    raw: l.raw,
    channel: card ? 'acquiring' : 'transfer',
    bank: l.bank,
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
 * Is this line older than what the system knows of this rental? A rental
 * carried over arrives with «paid through» and no payments: every payment up
 * to that day is inside the date already. A bank line of that day or earlier
 * may be one of them, and nothing in the line says whether it is — so no rule
 * attaches it, whatever the name and the sum; a person looks, with the hint
 * saying why (Mika, 12.10.2026: statements are loaded from the day "that
 * does not start a muddle" — with this the day stops mattering).
 */
export const beforeTransfer = (r: { transferredOn: string | null }, occurredOn: string): boolean => r.transferredOn != null && occurredOn <= r.transferredOn;

/**
 * An incoming transfer whose bank writes a payer, and the payer is none of our
 * customers by any of their names. A card line names the terminal, not a
 * person, a line with no payer names nobody, and an outgoing line names its
 * recipient — a supplier, not a customer: none of them is a stranger.
 */
function namesStranger(line: Line, ctx: Ctx): boolean {
  if (line.direction !== 'in' || line.channel !== 'transfer' || !line.payer?.trim()) return false;
  const text = [line.payer, line.purpose].filter(Boolean).join(' ');
  return !ctx.customers.some((c) => nameMatches(text, c.names));
}

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

/**
 * The name rule's second sign: a record with a debt of exactly this sum — not
 * a week that is not owed yet (§3.2, QA-W2-04). A rental paid ahead takes
 * nothing by name; the line waits for a person.
 */
function rentalOwes(r: RentalCand, gross: number): boolean {
  if (r.owedNowTetri <= 0) return false;
  return [r.owedNowTetri, r.openDepositTetri + r.openFirstPeriodTetri, r.openTotalTetri].some((n) => n > 0 && n === gross);
}
function saleOwes(s: SaleCand, gross: number): boolean {
  return s.dueOpenTetri > 0 && [s.dueOpenTetri, s.nextOpenTetri].some((n) => n > 0 && n === gross);
}

/** Records this line could pay by its own signs — name with a debt, or pick-up day — for the "is it this or that" check. */
function otherCandidates(line: Line, ctx: Ctx, except: string | null): RentalCand[] {
  const gross = lineGross(line);
  const text = [line.payer, line.purpose].filter(Boolean).join(' ');
  const who = text ? new Set(ctx.customers.filter((c) => nameMatches(text, c.names)).map((c) => c.id)) : new Set<string>();
  return ctx.rentals.filter(
    (r) => r.id !== except && RULE_RENTALS.has(r.status) && ((who.has(r.customerId) && rentalOwes(r, gross)) || (r.pickedUpOn === line.occurredOn && rentalFits(r, gross) && r.owedNowTetri > 0)),
  );
}

export type RuleTarget =
  | { rentalId: string; saleId?: undefined; goodsSaleId?: undefined }
  | { saleId: string; rentalId?: undefined; goodsSaleId?: undefined }
  | { goodsSaleId: string; rentalId?: undefined; saleId?: undefined };

export type Decision =
  | { type: 'recorded'; paymentId: string }
  | { type: 'bank_deposit'; bankDepositId: string }
  | { type: 'rule'; rule: 'payer_name' | 'amount_date' | 'card_pickup_day'; target: RuleTarget; customerId: string; reason: Reason }
  | { type: 'queue' };

/** A reason, in data; the screen says it in its language (§3.2 "причина словами"). */
export interface Reason {
  /** `goods`: an open goods sale of this sum (ADR-0045) — `day` is the day it was sold, `channel` what the buyer promised. */
  code: 'name' | 'card_pickup' | 'amount_week' | 'amount' | 'recorded' | 'bank_deposit' | 'goods';
  /** On a hint for a rental carried over after this line's day: the day it was carried over. The money may be counted already. */
  transferredOn?: string;
  name?: string;
  number?: string;
  debtTetri?: number;
  grossTetri?: number;
  feeTetri?: number;
  netTetri?: number;
  day?: string;
  channel?: 'acquiring' | 'transfer' | null;
}

export function decide(line: Line, ctx: Ctx): Decision {
  const recorded = recordedFor(line, ctx);
  // Linked to what was entered by hand only when nothing else could be this
  // money: a second record with a debt of this sum on that day is a question
  // for a person (designer's answer 3 to wave 2 round 1; ADR-0004).
  // Nor when the bank names a payer who is none of our customers (director,
  // 22.10.2026): a transfer of 150 from one customer, whose bank spells his
  // name differently from his card, was taken for another customer's 150
  // entered by hand that day, and his own week stayed overdue. The line waits
  // under «already recorded», where a person says "yes, it is this" in a tap.
  if (recorded.length === 1 && !namesStranger(line, ctx) && otherCandidates(line, ctx, recorded[0].rentalId).length === 0) {
    return { type: 'recorded', paymentId: recorded[0].id };
  }
  if (recorded.length > 0) return { type: 'queue' };
  if (line.direction === 'out') return { type: 'queue' };

  if (isCashDeposit(line)) {
    const deposits = ctx.bankDeposits.filter((b) => b.bank === line.bank && b.amountTetri === line.amountTetri && near(b.occurredOn, line.occurredOn));
    if (deposits.length === 1) return { type: 'bank_deposit', bankDepositId: deposits[0].id };
    return { type: 'queue' };
  }

  const gross = lineGross(line);
  const eligible = ctx.rentals.filter((r) => RULE_RENTALS.has(r.status) && !beforeTransfer(r, line.occurredOn));
  const text = [line.payer, line.purpose].filter(Boolean).join(' ');

  // 1. The name, and one record of that customer's that this amount fits.
  const who = text ? ctx.customers.filter((c) => nameMatches(text, c.names)) : [];
  {
    if (who.length === 1) {
      const c = who[0];
      const rentals = eligible.filter((r) => r.customerId === c.id && rentalOwes(r, gross));
      const sales = ctx.sales.filter((s) => s.customerId === c.id && saleOwes(s, gross));
      // Goods of this customer's with exactly this sum open: one more record
      // the money may be — a rental of the same sum no longer takes it alone.
      const goods = ctx.goods.filter((g) => g.customerId === c.id && g.openTetri === gross);
      if (rentals.length + sales.length + goods.length === 1) {
        const target: RuleTarget = rentals[0] ? { rentalId: rentals[0].id } : sales[0] ? { saleId: sales[0].id } : { goodsSaleId: goods[0].id };
        const number = rentals[0]?.number ?? sales[0]?.number ?? goods[0].number;
        const debt = rentals[0]?.owedNowTetri ?? sales[0]?.dueOpenTetri ?? goods[0].openTetri;
        return { type: 'rule', rule: 'payer_name', target, customerId: c.id, reason: { code: 'name', name: c.name, number, debtTetri: debt } };
      }
    }
  }

  // 2. The amount, and the date: the pick-up day, or inside the week it closes.
  //    A line that names somebody is about that somebody: nobody else's rental.
  const named = new Set(who.map((c) => c.id));
  //    Not while a goods sale of this very sum, sold within ±3 days, waits for
  //    its money — a retail buyer's card, or the named customer's own goods:
  //    two records fit, and a person says which (ADR-0045 §7).
  if (ctx.goods.some((g) => g.openTetri === gross && near(g.soldOn, line.occurredOn) && (named.size === 0 || g.customerId == null || named.has(g.customerId)))) {
    return { type: 'queue' };
  }
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
  kind: 'rental' | 'sale' | 'customer' | 'payment' | 'bank_deposit' | 'goods_sale';
  /** A goods sale to a retail buyer, who has no card (ADR-0045). */
  retail?: boolean;
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
  if (recorded.length > 0) {
    // Beside the payment entered by hand, the other record this could be (§3.2, answer 3).
    const alt = recorded.length === 1 ? otherCandidates(line, ctx, recordedFor(line, ctx)[0].rentalId) : [];
    return {
      group: 'recorded',
      recorded,
      suggestions: alt.map((r) => ({ kind: 'rental' as const, id: r.id, number: r.number, customer: r.customer, customerId: r.customerId, reason: { code: 'amount' as const, number: r.number, debtTetri: r.owedNowTetri } })),
    };
  }

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
      for (const g of ctx.goods.filter((x) => x.customerId === c.id)) {
        out.push({ kind: 'goods_sale', id: g.id, number: g.number, customer: c.name, customerId: c.id, reason: { code: 'name', name: c.name, number: g.number, debtTetri: g.openTetri } });
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
    // Goods of this sum sold within ±3 days, the ones promised by this line's
    // channel first: above the rentals that only fit by their sum (ADR-0045 §7).
    const goodsHint = (g: GoodsCand): Suggestion => ({
      kind: 'goods_sale',
      id: g.id,
      number: g.number,
      customer: g.customer,
      ...(g.customerId ? { customerId: g.customerId } : {}),
      retail: g.customerId == null,
      amountTetri: g.openTetri,
      occurredOn: g.soldOn,
      reason: { code: 'goods', number: g.number, debtTetri: g.openTetri, day: g.soldOn, channel: g.promisedChannel },
    });
    const sameSum = ctx.goods.filter((g) => !seen.has(g.id) && g.openTetri === gross);
    const promised = (g: GoodsCand) => (g.promisedChannel != null && g.promisedChannel === line.channel ? 0 : 1);
    for (const g of sameSum.filter((x) => near(x.soldOn, line.occurredOn)).sort((a, b) => promised(a) - promised(b) || Math.abs(daysBetween(a.soldOn, line.occurredOn)) - Math.abs(daysBetween(b.soldOn, line.occurredOn)))) {
      out.push(goodsHint(g));
      seen.add(g.id);
    }
    for (const r of ctx.rentals.filter((x) => !seen.has(x.id) && rentalFits(x, gross))) {
      out.push({ kind: 'rental', id: r.id, number: r.number, customer: r.customer, customerId: r.customerId, reason: { code: 'amount', number: r.number, debtTetri: r.owedNowTetri } });
      seen.add(r.id);
    }
    for (const s of ctx.sales.filter((x) => !seen.has(x.id) && saleFits(x, gross))) {
      out.push({ kind: 'sale', id: s.id, number: s.number, customer: s.customer, customerId: s.customerId, reason: { code: 'amount', number: s.number, debtTetri: s.dueOpenTetri || s.nextOpenTetri } });
    }
    // Goods of this sum sold further away: last.
    for (const g of sameSum.filter((x) => !seen.has(x.id))) out.push(goodsHint(g));
  }
  // A hint for a rental carried over after this line's day says so: the screen
  // adds that the money may already be inside «paid through».
  const carried = new Map(ctx.rentals.filter((r) => beforeTransfer(r, line.occurredOn)).map((r) => [r.id, r.transferredOn!]));
  const suggestions = out.slice(0, 8).map((s) => (s.kind === 'rental' && carried.has(s.id) ? { ...s, reason: { ...s.reason, transferredOn: carried.get(s.id)! } } : s));
  return { group: suggestions.length > 0 ? 'suggested' : 'none', recorded: [], suggestions };
}
