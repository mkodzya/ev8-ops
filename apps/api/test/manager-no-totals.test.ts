// A manager reads no money of all the customers together (Mika's «да» of
// 25.10.2026; ADR-0048, addendum of 25.10.2026). «Оплаты по графику» already
// sends him the rows without their sums; every other answer he reaches does
// the same now: "Today" without a group's sum, the rentals without leave to
// add their debts up, the sales and the goods without what all their buyers
// owe, «Мои платежи» without what came in over them. One customer's figure,
// one rental's, one sale's stay — and an owner's answers keep every sum.
//
// The suites share one database and the real clock: what is asserted is who
// gets a figure and who gets null, never the size of a total other suites
// move. The suite's own rental makes "Today" say something for both readers.
import { todayISO } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

const digits = () => uniq().replace(/\D/g, '');

/** A made-up renter with a rental handed over today: its deposit and its first week still owed. */
async function rental() {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `No totals ${uniq()}`, forRent: true } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TESTNT${digits().slice(-11).padStart(11, '0')}`, modelId: model.id } });
  const customer = await prisma.customer.create({ data: { name: `Test No Totals ${uniq()}` } });
  const owner = await loginAs('owner');
  const res = await call(owner, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, pickedUpOn: todayISO() });
  if (res.statusCode !== 201) throw new Error(res.body);
  return { owner, customer, rentalId: json<{ id: string }>(res).id };
}

async function get<T>(who: string, url: string): Promise<T> {
  const res = await call(who, 'GET', url);
  if (res.statusCode !== 200) throw new Error(`${url}: ${res.statusCode} ${res.body}`);
  return json<T>(res);
}

describe.skipIf(!HAS_DB)('no money of all the customers together for a manager (ADR-0048, addendum of 25.10.2026)', () => {
  it('"Today": each row keeps its sum, no group carries the sum of its rows; an owner’s groups do', async () => {
    const r = await rental();
    const manager = await loginAs('manager');
    type Today = { queue: { group: string; rows: { id: string; amountTetri: number | null }[]; total: number; totalTetri: number | null }[]; numbers: { overdueTetri: number | null } };
    const mine = await get<Today>(manager, '/api/today');
    const theirs = await get<Today>(r.owner, '/api/today');
    expect(mine.queue.length).toBeGreaterThan(0);
    for (const g of mine.queue) expect(g.totalTetri, g.group).toBeNull();
    for (const g of theirs.queue) expect(typeof g.totalTetri, g.group).toBe('number');
    // The rental's own row still says what it owes — to both.
    const row = (t: Today) => t.queue.flatMap((g) => g.rows).find((x) => x.id === `due_today:${r.rentalId}`);
    const owed = row(theirs)?.amountTetri;
    if (owed != null) expect(row(mine)?.amountTetri).toBe(owed);
    expect(mine.numbers.overdueTetri).toBeNull();
    expect(typeof theirs.numbers.overdueTetri).toBe('number');
  });

  it('the rentals: the same rows, each with its debt; leave to add them up only for an owner', async () => {
    const r = await rental();
    const manager = await loginAs('manager');
    type Rentals = { totals: boolean; rentals: { id: string; debtTetri: number }[] };
    const mine = await get<Rentals>(manager, '/api/rentals');
    const theirs = await get<Rentals>(r.owner, '/api/rentals');
    expect(mine.totals).toBe(false);
    expect(theirs.totals).toBe(true);
    const one = (x: Rentals) => x.rentals.find((y) => y.id === r.rentalId)?.debtTetri;
    expect(one(mine)).toBeGreaterThan(0);
    expect(one(mine)).toBe(one(theirs));
  });

  it('the sales: what every buyer is behind on together is an owner’s figure', async () => {
    const manager = await loginAs('manager');
    const owner = await loginAs('owner');
    type Sales = { overdueTetri: number | null; sales: { overdueTetri: number }[] };
    const mine = await get<Sales>(manager, '/api/sales');
    expect(mine.overdueTetri).toBeNull();
    // Each sale keeps its own.
    expect(mine.sales.every((s) => typeof s.overdueTetri === 'number')).toBe(true);
    expect(typeof (await get<Sales>(owner, '/api/sales')).overdueTetri).toBe('number');
    // The summary's figure of the same, too.
    type Summary = { salesOverdueTetri: number | null };
    expect((await get<Summary>(manager, '/api/summary')).salesOverdueTetri).toBeNull();
    expect(typeof (await get<Summary>(owner, '/api/summary')).salesOverdueTetri).toBe('number');
  });

  it('the goods: how many wait for payment, not how much all of them together', async () => {
    const manager = await loginAs('manager');
    const owner = await loginAs('owner');
    type Goods = { count: number; openCount: number; openTetri: number | null; sales: { openTetri: number }[] };
    const mine = await get<Goods>(manager, '/api/goods-sales');
    expect(mine.openTetri).toBeNull();
    expect(typeof mine.openCount).toBe('number');
    expect(mine.sales.every((s) => typeof s.openTetri === 'number')).toBe(true);
    expect(typeof (await get<Goods>(owner, '/api/goods-sales')).openTetri).toBe('number');
  });

  it('«Мои платежи»: no sum of what came in over them; one customer’s payments keep theirs, and an owner’s list too', async () => {
    const r = await rental();
    const manager = await loginAs('manager');
    // An odd sum of his own cash on the suite's rental, so the list has a row of his.
    expect((await call(manager, 'POST', '/api/payments', { rentalId: r.rentalId, channel: 'cash', grossTetri: 4391 })).statusCode).toBe(201);
    type List = { totals: { inTetri: number } | null; payments: { grossTetri: number }[] };
    const mine = await get<List>(manager, '/api/payments');
    expect(mine.payments.some((p) => p.grossTetri === 4391)).toBe(true);
    expect(mine.totals).toBeNull();
    // One customer's own payments, on his card: the sum is that customer's.
    expect((await get<List>(manager, `/api/payments?customerId=${r.customer.id}`)).totals?.inTetri).toBe(4391);
    expect(typeof (await get<List>(r.owner, '/api/payments')).totals?.inTetri).toBe('number');
    // His till stays: the cash he hands over is his own to know.
    type Today = { numbers: { myTillTetri: number | null } };
    expect((await get<Today>(manager, '/api/today')).numbers.myTillTetri).toBeGreaterThanOrEqual(4391);
  });
});
