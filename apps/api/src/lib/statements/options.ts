import { daysBetween, fleetNumber, goodsTotals, nameMatches, numberMatches, partsTetri, phoneMatches, readFleetNumber, readQuery, rentWeekday, spellingMatches, spreadRentalOwed, vinMatches, type Query } from '@ev8/shared';
import { isoDate } from '../dates.js';
import { debtsOf } from '../debt.js';
import { prisma } from '../db.js';
import { PART_MONEY } from '../stock.js';
import { livePayerRules, payerKey } from './payers.js';
import { lineGross, loadCtx, type Line } from './reconcile.js';

// The panel beside a line coming in, once its kind is chosen (issue #13 of the
// director, ADR-0046): «Аренда», «Залог», «Продажа мопеда», «Товары»,
// «Ремонт / начисление», «Аванс клиента», «Сдача в банк». Each lists what the
// money can go on, the probable first — the payer's name, or the payer
// remembered — then what fits by its sum alone, without a mark, then the
// rest; a search narrows it. Each option says what the record owes and the
// customer's whole debt now, and a rental what this line would write on it.
// The choice is always the person's.

export const OPTION_KINDS = ['rental', 'deposit', 'sale', 'goods', 'repair', 'customer', 'bank_deposit'] as const;
export type OptionKind = (typeof OPTION_KINDS)[number];

/** What a line would write on a rental: the deposit, weeks by their days, charges, and what goes ahead. */
export type PlanPart =
  | { kind: 'deposit'; tetri: number }
  | { kind: 'week'; tetri: number; startsOn: string; endsOn: string; full: boolean }
  | { kind: 'charge'; tetri: number; charge: string }
  | { kind: 'ahead'; tetri: number };

export interface Option {
  key: string;
  /** The body «assign» (or «bank-deposit») takes for it. */
  target: Record<string, string>;
  number: string | null;
  /** The customer, the buyer, or the record's own words. */
  title: string;
  /** Small facts beside it: the moped, the phone, a date. */
  facts: string[];
  customerId: string | null;
  status: string | null;
  /** What this record owes now; 0 — nothing, or no limit (an advance). */
  owesTetri: number;
  /** The customer's one debt figure now (B7-02); null for a retail buyer or no customer. */
  customerDebtTetri: number | null;
  /** Why it is on top: the payer's name, or the payer remembered as this customer. */
  probable: 'name' | 'rule' | null;
  /** The sum fits it — shown after the probable, without a word. */
  fits: boolean;
  /** A rental: what this line would write, and the weekday its rent falls due on (ISO 1–7). */
  plan?: PlanPart[];
  payDay?: number | null;
  /** A rental carried over on or after the line's day: its money may be inside «paid through» (ADR-0018). */
  transferredOn?: string | null;
  /** A deposit's open part, a sale's next instalment and its day, a bank deposit's day. */
  extraTetri?: number;
  day?: string | null;
  /** A goods sale with no customer. */
  retail?: boolean;
  /** A charge: its kind and words. */
  charge?: { kind: string; note: string | null };
}

const LIMIT = 60;
const RUNNING_LIST = ['booked', 'active', 'overdue', 'paused', 'disputed'] as const;
const RUNNING = new Set<string>(RUNNING_LIST);

const order = (a: Option, b: Option) =>
  rank(a.probable) - rank(b.probable) || Number(b.fits) - Number(a.fits) || b.owesTetri - a.owesTetri || (b.number ?? '').localeCompare(a.number ?? '');
const rank = (p: Option['probable']) => (p === 'rule' ? 0 : p === 'name' ? 1 : 2);

export async function optionsFor(line: Line, kind: OptionKind, raw: string): Promise<Option[]> {
  const q = readQuery(raw);
  const gross = lineGross(line);
  const text = [line.payer, line.purpose].filter(Boolean).join(' ');
  const named = (names: (string | null | undefined)[]) => !!text && nameMatches(text, names);
  const key = payerKey(line);
  const remembered = key ? (await livePayerRules(prisma)).get(key) ?? null : null;
  const ruleCustomer = remembered?.kind === 'customer' ? remembered.customerId : null;
  const probableOf = (customerId: string | null, names: (string | null | undefined)[]): Option['probable'] =>
    customerId && customerId === ruleCustomer ? 'rule' : named(names) ? 'name' : null;
  const byCustomer = (q: Query, c: { name: string; nameKa: string | null; nameLat: string | null } | null) => !!c && spellingMatches(q, [c.name, c.nameKa, c.nameLat]);

  if (kind === 'rental' || kind === 'deposit') {
    const [ctx, rentals] = await Promise.all([
      loadCtx(),
      prisma.rental.findMany({
        select: {
          id: true,
          number: true,
          status: true,
          customerId: true,
          pickedUpOn: true,
          payWeekday: true,
          weekShiftDays: true,
          transferredAt: true,
          customer: { select: { name: true, nameKa: true, nameLat: true, phone: true } },
          vehicle: { select: { vin: true, fleetNo: true } },
          periods: { orderBy: { seq: 'asc' }, select: { id: true, seq: true, amountTetri: true, paidTetri: true, startsOn: true, endsOn: true } },
          deposit: { select: { id: true, amountTetri: true, paidTetri: true } },
          charges: { where: { voidedAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true, kind: true, amountTetri: true, allocations: { where: { payment: { voidedAt: null } }, select: { amountTetri: true } } } },
        },
      }),
    ]);
    const sums = new Map(ctx.rentals.map((r) => [r.id, r]));
    const debts = await debtsOf([...new Set(rentals.map((r) => r.customerId))]);
    const fleetNo = q ? readFleetNumber(q.text, { digitsToo: true }) : null;
    const out: Option[] = [];
    for (const r of rentals) {
      const s = sums.get(r.id);
      if (!s) continue;
      const debt = debts.get(r.customerId);
      const owes = (debt?.parts ?? []).filter((p) => p.id === r.id && (p.kind === 'rent' || p.kind === 'deposit' || p.kind === 'charge')).reduce((n, p) => n + p.owesTetri, 0);
      // A deposit is paid while the rental runs; after the return the deposit decision settles it.
      if (kind === 'deposit' ? !RUNNING.has(r.status) || s.openDepositTetri <= 0 : !RUNNING.has(r.status) && owes <= 0) continue;
      if (q && !(numberMatches(q, r.number) || byCustomer(q, r.customer) || phoneMatches(q, r.customer.phone) || vinMatches(q, r.vehicle?.vin) || (fleetNo != null && r.vehicle?.fleetNo === fleetNo))) continue;
      const returned = r.status === 'returned';
      const owed = {
        rentalId: r.id,
        returned,
        deposit: r.deposit && !returned ? r.deposit : null,
        periods: r.periods,
        charges: r.charges.map((c, i) => ({ id: c.id, seq: i + 1, kind: c.kind, amountTetri: c.amountTetri, paidTetri: c.allocations.reduce((n, a) => n + a.amountTetri, 0) })),
      };
      const spread = spreadRentalOwed(gross, owed);
      const plan: PlanPart[] = [];
      for (const a of spread.allocations) {
        if (a.target === 'deposit') plan.push({ kind: 'deposit', tetri: a.amountTetri });
        else if (a.target === 'period') {
          const p = r.periods.find((x) => x.id === a.id)!;
          plan.push({ kind: 'week', tetri: a.amountTetri, startsOn: isoDate(p.startsOn)!, endsOn: isoDate(p.endsOn)!, full: p.paidTetri + a.amountTetri >= p.amountTetri });
        } else if (a.target === 'charge') plan.push({ kind: 'charge', tetri: a.amountTetri, charge: owed.charges.find((c) => c.id === a.id)?.kind ?? '' });
      }
      if (spread.leftoverTetri > 0) plan.push({ kind: 'ahead', tetri: spread.leftoverTetri });
      const pickedUpOn = isoDate(r.pickedUpOn);
      const names = [r.customer.name, r.customer.nameKa, r.customer.nameLat];
      out.push({
        key: `${kind}:${r.id}`,
        target: { rentalId: r.id },
        number: r.number,
        title: r.customer.name,
        facts: [fleetNumber(r.vehicle?.fleetNo), r.vehicle?.vin ? `…${r.vehicle.vin.slice(-4)}` : null, r.customer.phone].filter((x): x is string => !!x),
        customerId: r.customerId,
        status: r.status,
        owesTetri: owes,
        customerDebtTetri: debt?.owesTetri ?? 0,
        probable: probableOf(r.customerId, names),
        fits:
          kind === 'deposit'
            ? s.openDepositTetri === gross || s.openDepositTetri + s.openFirstPeriodTetri === gross
            : [s.openDepositTetri + s.openFirstPeriodTetri, s.openFirstPeriodTetri, s.openTotalTetri, s.weeklyRateTetri, s.owedNowTetri].some((n) => n > 0 && n === gross),
        plan,
        payDay: pickedUpOn && !returned ? rentWeekday(pickedUpOn, r.weekShiftDays, r.payWeekday) : null,
        transferredOn: s.transferredOn && line.occurredOn <= s.transferredOn ? s.transferredOn : null,
        ...(kind === 'deposit' ? { extraTetri: s.openDepositTetri } : {}),
      });
    }
    return out.sort(order).slice(0, LIMIT);
  }

  if (kind === 'sale') {
    const sales = await prisma.sale.findMany({
      where: { status: 'active' },
      select: {
        id: true,
        number: true,
        status: true,
        customerId: true,
        customer: { select: { name: true, nameKa: true, nameLat: true, phone: true } },
        vehicle: { select: { vin: true, fleetNo: true } },
        instalments: { orderBy: { seq: 'asc' }, select: { dueOn: true, amountTetri: true, paidTetri: true } },
      },
    });
    const debts = await debtsOf([...new Set(sales.map((s) => s.customerId))]);
    return sales
      .map((s): Option | null => {
        const next = s.instalments.find((i) => i.paidTetri < i.amountTetri);
        if (!next) return null;
        if (q && !(numberMatches(q, s.number) || byCustomer(q, s.customer) || phoneMatches(q, s.customer.phone) || vinMatches(q, s.vehicle?.vin))) return null;
        const due = (debts.get(s.customerId)?.parts ?? []).filter((p) => p.kind === 'sale' && p.id === s.id).reduce((n, p) => n + p.owesTetri, 0);
        const nextTetri = next.amountTetri - next.paidTetri;
        return {
          key: `sale:${s.id}`,
          target: { saleId: s.id },
          number: s.number,
          title: s.customer.name,
          facts: [fleetNumber(s.vehicle?.fleetNo), s.vehicle?.vin ? `…${s.vehicle.vin.slice(-4)}` : null].filter((x): x is string => !!x),
          customerId: s.customerId,
          status: s.status,
          owesTetri: due,
          customerDebtTetri: debts.get(s.customerId)?.owesTetri ?? 0,
          probable: probableOf(s.customerId, [s.customer.name, s.customer.nameKa, s.customer.nameLat]),
          fits: nextTetri === gross || (due > 0 && due === gross),
          extraTetri: nextTetri,
          day: isoDate(next.dueOn),
        };
      })
      .filter((x): x is Option => x != null)
      .sort(order)
      .slice(0, LIMIT);
  }

  if (kind === 'goods') {
    const goods = await prisma.goodsSale.findMany({
      where: { status: 'active' },
      select: {
        id: true,
        number: true,
        status: true,
        customerId: true,
        buyerName: true,
        buyerPhone: true,
        soldOn: true,
        customer: { select: { name: true, nameKa: true, nameLat: true, phone: true } },
        lines: { select: { name: true, nameKa: true, spec: true, qty: true, unitPriceTetri: true } },
        payments: { where: { voidedAt: null, kind: 'goods' }, select: { grossTetri: true } },
      },
    });
    const debts = await debtsOf([...new Set(goods.map((g) => g.customerId).filter((x): x is string => !!x))]);
    return goods
      .map((g): Option | null => {
        const open = Math.max(0, goodsTotals(g.lines).grossTetri - g.payments.reduce((n, p) => n + p.grossTetri, 0));
        if (open <= 0) return null;
        if (q && !(numberMatches(q, g.number) || byCustomer(q, g.customer) || spellingMatches(q, [g.buyerName]) || phoneMatches(q, g.customer?.phone ?? g.buyerPhone) || g.lines.some((l) => spellingMatches(q, [l.name, l.nameKa, l.spec])))) return null;
        const soldOn = isoDate(g.soldOn)!;
        return {
          key: `goods:${g.id}`,
          target: { goodsSaleId: g.id },
          number: g.number,
          title: g.customer?.name ?? g.buyerName ?? '',
          facts: g.lines.map((l) => (l.qty > 1 ? `${l.name} × ${l.qty}` : l.name)),
          customerId: g.customerId,
          status: g.status,
          owesTetri: open,
          customerDebtTetri: g.customerId ? (debts.get(g.customerId)?.owesTetri ?? 0) : null,
          probable: probableOf(g.customerId, g.customer ? [g.customer.name, g.customer.nameKa, g.customer.nameLat] : [g.buyerName]),
          fits: open === gross && Math.abs(daysBetween(soldOn, line.occurredOn)) <= 3,
          day: soldOn,
          retail: g.customerId == null,
        };
      })
      .filter((x): x is Option => x != null)
      .sort(order)
      .slice(0, LIMIT);
  }

  if (kind === 'repair') {
    const [jobs, charges] = await Promise.all([
      prisma.serviceJob.findMany({
        where: { payer: 'customer', status: 'done', customerId: { not: null } },
        select: {
          id: true,
          number: true,
          status: true,
          customerId: true,
          labourTetri: true,
          withheldTetri: true,
          closedOn: true,
          parts: { select: PART_MONEY },
          payments: { where: { voidedAt: null }, select: { grossTetri: true } },
          customer: { select: { name: true, nameKa: true, nameLat: true, phone: true } },
          vehicle: { select: { vin: true, fleetNo: true } },
        },
      }),
      prisma.rentalCharge.findMany({
        where: { voidedAt: null },
        select: {
          id: true,
          kind: true,
          note: true,
          amountTetri: true,
          createdAt: true,
          allocations: { where: { payment: { voidedAt: null } }, select: { amountTetri: true } },
          rental: { select: { id: true, number: true, customerId: true, customer: { select: { name: true, nameKa: true, nameLat: true, phone: true } }, vehicle: { select: { vin: true, fleetNo: true } } } },
        },
      }),
    ]);
    const debts = await debtsOf([...new Set([...jobs.map((j) => j.customerId!), ...charges.map((c) => c.rental.customerId)])]);
    const out: Option[] = [];
    for (const j of jobs) {
      const open = Math.max(0, Math.max(0, j.labourTetri + partsTetri(j.parts) - j.withheldTetri) - j.payments.reduce((n, p) => n + p.grossTetri, 0));
      if (open <= 0 || !j.customer) continue;
      if (q && !(numberMatches(q, j.number) || byCustomer(q, j.customer) || phoneMatches(q, j.customer.phone) || vinMatches(q, j.vehicle.vin))) continue;
      out.push({
        key: `repair:${j.id}`,
        target: { serviceJobId: j.id },
        number: j.number,
        title: j.customer.name,
        facts: [fleetNumber(j.vehicle.fleetNo), `…${j.vehicle.vin.slice(-4)}`].filter((x): x is string => !!x),
        customerId: j.customerId,
        status: j.status,
        owesTetri: open,
        customerDebtTetri: debts.get(j.customerId!)?.owesTetri ?? 0,
        probable: probableOf(j.customerId, [j.customer.name, j.customer.nameKa, j.customer.nameLat]),
        fits: open === gross,
        day: isoDate(j.closedOn),
      });
    }
    for (const c of charges) {
      const open = c.amountTetri - c.allocations.reduce((n, a) => n + a.amountTetri, 0);
      if (open <= 0) continue;
      const cu = c.rental.customer;
      if (q && !(numberMatches(q, c.rental.number) || byCustomer(q, cu) || phoneMatches(q, cu.phone) || vinMatches(q, c.rental.vehicle?.vin) || spellingMatches(q, [c.note]))) continue;
      out.push({
        key: `charge:${c.id}`,
        target: { chargeId: c.id },
        number: c.rental.number,
        title: cu.name,
        facts: [fleetNumber(c.rental.vehicle?.fleetNo)].filter((x): x is string => !!x),
        customerId: c.rental.customerId,
        status: null,
        owesTetri: open,
        customerDebtTetri: debts.get(c.rental.customerId)?.owesTetri ?? 0,
        probable: probableOf(c.rental.customerId, [cu.name, cu.nameKa, cu.nameLat]),
        fits: open === gross,
        charge: { kind: c.kind, note: c.note },
        day: isoDate(c.createdAt),
      });
    }
    return out.sort(order).slice(0, LIMIT);
  }

  if (kind === 'customer') {
    const customers = await prisma.customer.findMany({
      where: { archived: false, recordKind: { not: 'supplier' } },
      select: { id: true, name: true, nameKa: true, nameLat: true, phone: true, rentals: { where: { status: { in: [...RUNNING_LIST] } }, select: { number: true } } },
      orderBy: { name: 'asc' },
    });
    const picked = customers.filter((c) => {
      const names = [c.name, c.nameKa, c.nameLat];
      if (q) return byCustomer(q, c) || phoneMatches(q, c.phone) || c.rentals.some((r) => numberMatches(q, r.number));
      // Without a search: the payer's own card and the payer remembered, then whoever rents now.
      return probableOf(c.id, names) != null || c.rentals.length > 0;
    });
    const debts = await debtsOf(picked.map((c) => c.id));
    return picked
      .map(
        (c): Option => ({
          key: `customer:${c.id}`,
          target: { customerId: c.id },
          number: null,
          title: c.name,
          facts: [...c.rentals.map((r) => r.number), c.phone].filter((x): x is string => !!x),
          customerId: c.id,
          status: null,
          owesTetri: 0,
          customerDebtTetri: debts.get(c.id)?.owesTetri ?? 0,
          probable: probableOf(c.id, [c.name, c.nameKa, c.nameLat]),
          fits: false,
        }),
      )
      .sort(order)
      .slice(0, LIMIT);
  }

  // Cash an owner took to the bank and no line has found yet (§3.4): this
  // sum and this bank first, the nearest day first.
  const deposits = await prisma.bankCashDeposit.findMany({
    where: { statementLineId: null, voidedAt: null },
    orderBy: { occurredOn: 'desc' },
    take: 100,
    select: { id: true, bank: true, occurredOn: true, amountTetri: true, user: { select: { name: true } } },
  });
  return deposits
    .map((b): Option => {
      const day = isoDate(b.occurredOn)!;
      return {
        key: `bank_deposit:${b.id}`,
        target: { bankDepositId: b.id },
        number: null,
        title: b.user?.name ?? '',
        facts: [b.bank],
        customerId: null,
        status: null,
        owesTetri: b.amountTetri,
        customerDebtTetri: null,
        probable: null,
        fits: b.amountTetri === line.amountTetri && b.bank === line.bank && Math.abs(daysBetween(day, line.occurredOn)) <= 3,
        extraTetri: b.amountTetri,
        day,
      };
    })
    .sort((a, b) => Number(b.fits) - Number(a.fits) || Math.abs(daysBetween(a.day!, line.occurredOn)) - Math.abs(daysBetween(b.day!, line.occurredOn)));
}
