// A week at nothing is a paid week (ADR-0017; docs/redesign/due-today.md §8.1).
//
// Three things leave such a week: a pause or a dispute lifted (the weeks that
// began while the rental stood exist at 0), a weekly rate of 0, and a late
// return that replaced a week by the days of delay. It used to read "unpaid",
// and "paid through" stopped at it for good — the rental was overdue with a
// growing count of days and no debt, while the calendar skipped the week.
//
// The suites share one database and the real clock, so every date is counted
// from today and every assertion is about the suite's own rental.
import { addDays, todayISO, weekOf, type PaymentsCalendarAnswer } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

type Cal = PaymentsCalendarAnswer;

const today = () => todayISO();
const digits = () => uniq().replace(/\D/g, '');

async function fixtures() {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Model ${uniq()}`, weeklyRateTetri: 16000, forRent: true } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TEST${digits().slice(0, 13).padStart(13, '0')}`, modelId: model.id, pool: 'rent' } });
  const customer = await prisma.customer.create({ data: { name: `Test Customer ${uniq()}`, phone: `+9955${digits().slice(-8)}`, personalId: digits().slice(-11) } });
  return { prisma, model, vehicle, customer };
}

/** A rental handed over `daysAgo` days ago with the first week and deposit paid in cash. */
async function running(daysAgo: number, over: Record<string, unknown> = {}) {
  const f = await fixtures();
  const owner = await loginAs('owner');
  const res = await call(owner, 'POST', '/api/pickups', {
    customerId: f.customer.id,
    vehicleId: f.vehicle.id,
    weeklyRateTetri: 15000,
    depositTetri: 18000,
    pickedUpOn: addDays(today(), -daysAgo),
    nightParkingAddress: 'Test street 1',
    batteries: 2,
    chargers: 2,
    odometerKm: 100,
    payment: { later: false, channel: 'cash', amountTetri: 33000 },
    ...over,
  });
  if (res.statusCode !== 201) throw new Error(res.body);
  return { ...f, owner, id: json<{ id: string }>(res).id };
}

/** The rental stood while week `seq` began, and runs again: that week exists at nothing. */
async function stoodThrough(r: Awaited<ReturnType<typeof running>>, seq: number, how: 'paused' | 'disputed') {
  await r.prisma.rentalPeriod.deleteMany({ where: { rentalId: r.id, seq } });
  for (const body of [
    { status: how, reason: 'test: the moped stands' },
    { status: 'active', reason: 'test: back on the road' },
  ]) {
    const res = await call(r.owner, 'POST', `/api/rentals/${r.id}/status`, body);
    if (res.statusCode !== 200) throw new Error(res.body);
  }
}

interface Card {
  rental: { status: string; paidThrough: string | null; debtTetri: number };
  periods: { seq: number; amountTetri: number; paidTetri: number; payStatus: string }[];
  charges: { kind: string; amountTetri: number }[];
}
interface Plan {
  closes: { target: string; seq?: number; amountTetri: number }[];
  paidThroughBefore: string | null;
  paidThroughAfter: string | null;
}
const items = () => ({ moped: { state: 'ok' }, key: { state: 'ok' }, battery_1: { state: 'ok' }, battery_2: { state: 'ok' }, charger_1: { state: 'ok' }, charger_2: { state: 'ok' } });
interface Row {
  id: string;
  status: string;
  overdueDays: number;
  debtTetri: number;
  paidThrough: string | null;
}

const card = async (who: string, id: string) => json<Card>(await call(who, 'GET', `/api/rentals/${id}`));
const listed = async (who: string, id: string) => json<{ rentals: Row[] }>(await call(who, 'GET', '/api/rentals')).rentals.find((r) => r.id === id)!;
const balance = async (who: string, customerId: string) => json<{ owesTetri: number }>(await call(who, 'GET', `/api/customers/${customerId}/balance`));

/** Five whole weeks: three back, this one, one ahead. */
async function calendar(who: string): Promise<Cal> {
  const res = await call(who, 'GET', `/api/money/calendar?from=${weekOf(addDays(today(), -21)).from}&to=${weekOf(addDays(today(), 7)).to}`);
  if (res.statusCode !== 200) throw new Error(res.body);
  return json<Cal>(res);
}
const entriesOf = (c: Cal, rentalId: string) => c.entries.filter((e) => e.rentalId === rentalId);
const lateOf = (c: Cal, rentalId: string) => c.late.rentals.find((l) => l.rentalId === rentalId);

describe.skipIf(!HAS_DB)('a week at nothing is a paid week (ADR-0017)', () => {
  it.each(['paused', 'disputed'] as const)('left by a rental that was %s: "paid through" walks over it, and the list agrees with the calendar', async (how) => {
    const r = await running(8);
    const t = today();
    await stoodThrough(r, 2, how);

    const c = await card(r.owner, r.id);
    expect(c.periods[1]).toMatchObject({ seq: 2, amountTetri: 0, paidTetri: 0, payStatus: 'paid' });
    // Week 2 began yesterday: its last day is five days ahead.
    expect(c.rental).toMatchObject({ status: 'active', paidThrough: addDays(t, 5), debtTetri: 0 });
    expect(await listed(r.owner, r.id)).toMatchObject({ status: 'active', overdueDays: 0, debtTetri: 0, paidThrough: addDays(t, 5) });
    expect((await balance(r.owner, r.customer.id)).owesTetri).toBe(0);

    const cal = await calendar(r.owner);
    expect(entriesOf(cal, r.id).map((e) => e.seq)).not.toContain(2);
    expect(lateOf(cal, r.id)).toBeUndefined();
  });

  it('an older unpaid week still stops "paid through": the week at nothing after it changes nothing', async () => {
    const r = await running(15);
    const t = today();
    await stoodThrough(r, 3, 'paused');

    const c = await card(r.owner, r.id);
    expect(c.periods.map((p) => [p.seq, p.amountTetri, p.payStatus])).toEqual([
      [1, 15000, 'paid'],
      [2, 15000, 'unpaid'],
      [3, 0, 'paid'],
    ]);
    // Week 1 ended nine days ago, and that is as far as the money reaches.
    expect(c.rental).toMatchObject({ status: 'overdue', paidThrough: addDays(t, -9), debtTetri: 15000 });
    // Week 2 was due eight days ago: today is its eighth late day, on the list and on the calendar.
    expect(await listed(r.owner, r.id)).toMatchObject({ status: 'overdue', overdueDays: 8, debtTetri: 15000, paidThrough: addDays(t, -9) });
    expect(lateOf(await calendar(r.owner), r.id)).toEqual({ rentalId: r.id, debtTetri: 15000, overdueTetri: 15000, weeks: 1, sinceOn: addDays(t, -8), days: 8 });
  });

  it('a rental at a rate of 0 is paid up and owes nothing: no week on the calendar, no late row', async () => {
    const r = await running(8, { weeklyRateTetri: 0, payment: { later: false, channel: 'cash', amountTetri: 18000 } });
    const t = today();

    const c = await card(r.owner, r.id);
    expect(c.periods.map((p) => [p.seq, p.amountTetri, p.payStatus])).toEqual([
      [1, 0, 'paid'],
      [2, 0, 'paid'],
    ]);
    expect(c.rental).toMatchObject({ status: 'active', paidThrough: addDays(t, 5), debtTetri: 0 });
    expect(await listed(r.owner, r.id)).toMatchObject({ status: 'active', overdueDays: 0, debtTetri: 0 });

    const cal = await calendar(r.owner);
    expect(entriesOf(cal, r.id)).toEqual([]);
    expect(lateOf(cal, r.id)).toBeUndefined();
  });

  /**
   * The release day itself. A week at nothing written before this rule is
   * stored as "unpaid" with "paid through" stopped before it — that is how the
   * rows of a working stand lie today. Nothing migrates them: the roll's own
   * repair of the two stored derived facts does, at the worker's first run
   * after the deploy. Held here so that narrowing that repair goes red.
   */
  it('a week at nothing stored the old way is put right by the roll, and no figure moves', async () => {
    const r = await running(8);
    const t = today();
    await stoodThrough(r, 2, 'paused');
    // The stored state the old rule left: the week "unpaid", "paid through" at the end of week 1.
    const { dateFromISO } = await import('../src/lib/dates.js');
    await r.prisma.rentalPeriod.updateMany({ where: { rentalId: r.id, seq: 2 }, data: { payStatus: 'unpaid' } });
    await r.prisma.rental.update({ where: { id: r.id }, data: { paidThrough: dateFromISO(addDays(t, -2)) } });

    const money = async () => {
      const c = await card(r.owner, r.id);
      return { cardDebtTetri: c.rental.debtTetri, weeks: c.periods.map((p) => [p.seq, p.amountTetri, p.paidTetri]), owesTetri: (await balance(r.owner, r.customer.id)).owesTetri };
    };
    // The stale "paid through" the stored row carries until the roll. It no longer makes the
    // rental look late with nothing owed: since issue #18 (B4) the list's status and days are
    // what «Оплаты по графику» says, and the schedule reads the week's money, not this date.
    expect(await listed(r.owner, r.id)).toMatchObject({ status: 'active', overdueDays: 0, debtTetri: 0, paidThrough: addDays(t, -2) });
    const before = await money();
    expect(before).toEqual({
      cardDebtTetri: 0,
      weeks: [
        [1, 15000, 15000],
        [2, 0, 0],
      ],
      owesTetri: 0,
    });

    const { rollPeriods } = await import('../src/lib/periods.js');
    await rollPeriods(t);

    const c = await card(r.owner, r.id);
    expect(c.periods[1]).toMatchObject({ seq: 2, amountTetri: 0, paidTetri: 0, payStatus: 'paid' });
    expect(c.rental).toMatchObject({ status: 'active', paidThrough: addDays(t, 5), debtTetri: 0 });
    expect(await listed(r.owner, r.id)).toMatchObject({ status: 'active', overdueDays: 0, debtTetri: 0, paidThrough: addDays(t, 5) });
    expect(await money()).toEqual(before);
  });

  it('the money form promises "paid through" over a week at nothing, and the payment keeps the promise', async () => {
    const r = await running(15);
    const t = today();
    await stoodThrough(r, 3, 'paused');

    // Week 2 is owed; week 3 stood at nothing. Paying week 2 carries "paid through" to the end of week 3.
    const plan = json<Plan>(await call(r.owner, 'POST', '/api/money/preview', { kind: 'rent', rentalId: r.id, amountTetri: '150', channel: 'cash' }));
    expect(plan.closes.map((x) => [x.target, x.seq, x.amountTetri])).toEqual([['period', 2, 15000]]);
    expect(plan).toMatchObject({ paidThroughBefore: addDays(t, -9), paidThroughAfter: addDays(t, 5) });

    const paid = await call(r.owner, 'POST', '/api/payments', { rentalId: r.id, channel: 'cash', grossTetri: 15000 });
    expect(paid.statusCode, paid.body).toBe(201);
    expect((await card(r.owner, r.id)).rental).toMatchObject({ status: 'active', paidThrough: addDays(t, 5), debtTetri: 0 });
    expect(await listed(r.owner, r.id)).toMatchObject({ status: 'active', overdueDays: 0, debtTetri: 0, paidThrough: addDays(t, 5) });
  });

  it('a week a late return replaced is a week at nothing: it reads paid, and the debt is the days of delay alone', async () => {
    // Paid through yesterday, planned back two days ago: the started week gives way to two days of delay.
    const r = await running(7, { expectedReturnOn: addDays(today(), -2) });
    const t = today();
    const back = await call(r.owner, 'POST', `/api/rentals/${r.id}/return`, { odometerKm: 150, items: items() });
    expect(back.statusCode, back.body).toBe(200);

    const c = await card(r.owner, r.id);
    expect(c.periods.map((p) => [p.seq, p.amountTetri, p.paidTetri, p.payStatus])).toEqual([
      [1, 15000, 15000, 'paid'],
      [2, 0, 0, 'paid'],
    ]);
    expect(c.charges.map((x) => [x.kind, x.amountTetri])).toEqual([['late', 6000]]);
    expect(c.rental).toMatchObject({ status: 'returned', paidThrough: addDays(t, 6), debtTetri: 6000 });
    expect(await listed(r.owner, r.id)).toMatchObject({ status: 'returned', overdueDays: 0, debtTetri: 6000 });
    expect((await balance(r.owner, r.customer.id)).owesTetri).toBe(6000);
  });

  it('moves no money: a rental with no week at nothing reads the same before and after the roll', async () => {
    const r = await running(8);
    const read = async () => {
      const c = await card(r.owner, r.id);
      const row = await listed(r.owner, r.id);
      return {
        paidThrough: c.rental.paidThrough,
        cardDebtTetri: c.rental.debtTetri,
        weeks: c.periods.map((p) => [p.seq, p.amountTetri, p.paidTetri, p.payStatus]),
        listDebtTetri: row.debtTetri,
        owesTetri: (await balance(r.owner, r.customer.id)).owesTetri,
      };
    };
    const before = await read();
    expect(before).toEqual({
      paidThrough: addDays(today(), -2),
      cardDebtTetri: 15000,
      weeks: [
        [1, 15000, 15000, 'paid'],
        [2, 15000, 0, 'unpaid'],
      ],
      listDebtTetri: 15000,
      owesTetri: 15000,
    });

    const { rollPeriods } = await import('../src/lib/periods.js');
    await rollPeriods(today());
    expect(await read()).toEqual(before);
  });
});
