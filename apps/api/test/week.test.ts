// "Отчёты → Неделя" on live rows (wave 6 §3.1, criteria 1, 1а, 1б, 1в, 2, 3, 4, 9).
//
// The suites share one database, so nothing here asserts an absolute total:
// every money figure is read before and after the thing being tested and the
// difference is what is checked. That is also how the screen is read — the
// week is a difference, not a count of everything.
import { addDays, todayISO, weekOf } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

const today = () => todayISO(new Date(), 'Asia/Tbilisi');
const digits = () => uniq().replace(/\D/g, '');

interface Week {
  from: string;
  to: string;
  asOf: string;
  today: string;
  fleet: { rented: number; freeInRentPool: number; inService: number; serviceLongestDays: number | null };
  rentals: { started: number; returned: number; overdueCount: number; overdueTetri: number };
  money: {
    totalTetri: number;
    rentTetri: number;
    saleTetri: number;
    depositsInTetri: number;
    serviceTetri: number;
    acquiringFeeTetri: number;
    depositsOutTetri: number;
    withheldTetri: number;
    heldTetri: number;
    paidBeforeTransferTetri: number;
  };
  utilisation: { percent: number | null; rentedDays: number; poolDays: number; unassigned: number };
  batteries: { showroom: number; couriers: number; repair: number; total: number };
  unmatchedLines: number;
  batterySwaps: null;
}

const week = async (who: string, q = ''): Promise<Week> => json<Week>(await call(who, 'GET', `/api/reports/week${q}`));
/** The breakdown, to be checked against the total that was summed apart from it. */
const rows = (w: Week) => w.money.rentTetri + w.money.saleTetri + w.money.depositsInTetri + w.money.serviceTetri;
const range = (p: { from: string; to: string }) => `?from=${p.from}&to=${p.to}`;

async function fixtures() {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Week ${uniq()}`, weeklyRateTetri: 15000, forRent: true } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TESTW${digits().slice(-12).padStart(12, '0')}`, modelId: model.id, pool: 'rent' } });
  const customer = await prisma.customer.create({ data: { name: `ТЕСТ Неделя ${uniq()}`, phone: `+9955${digits().slice(-8)}`, personalId: digits().slice(-11) } });
  return { prisma, model, vehicle, customer };
}

function pickup(customerId: string, vehicleId: string, over: Record<string, unknown> = {}) {
  return {
    customerId,
    vehicleId,
    weeklyRateTetri: 15000,
    depositTetri: 18000,
    pickedUpOn: today(),
    nightParkingAddress: 'Test street 1',
    batteries: 2,
    chargers: 2,
    odometerKm: 100,
    payment: { later: true },
    ...over,
  };
}

describe.skipIf(!HAS_DB)('wave 6 · the week', () => {
  it('answers with every figure the book asks for, and says "no record" rather than nought for battery swaps (crit. 1, 2)', async () => {
    const owner = await loginAs('owner');
    const w = await week(owner);
    expect(w).toEqual({
      from: weekOf(today()).from,
      to: weekOf(today()).to,
      asOf: today(),
      today: today(),
      fleet: {
        rented: expect.any(Number),
        freeInRentPool: expect.any(Number),
        inService: expect.any(Number),
        serviceLongestDays: w.fleet.inService > 0 ? expect.any(Number) : null,
      },
      rentals: { started: expect.any(Number), returned: expect.any(Number), overdueCount: expect.any(Number), overdueTetri: expect.any(Number) },
      money: {
        totalTetri: expect.any(Number),
        rentTetri: expect.any(Number),
        saleTetri: expect.any(Number),
        depositsInTetri: expect.any(Number),
        serviceTetri: expect.any(Number),
        acquiringFeeTetri: expect.any(Number),
        depositsOutTetri: expect.any(Number),
        withheldTetri: expect.any(Number),
        heldTetri: expect.any(Number),
        paidBeforeTransferTetri: expect.any(Number),
      },
      utilisation: { percent: w.utilisation.percent, rentedDays: expect.any(Number), poolDays: expect.any(Number), unassigned: expect.any(Number) },
      batteries: { showroom: expect.any(Number), couriers: expect.any(Number), repair: expect.any(Number), total: expect.any(Number) },
      unmatchedLines: expect.any(Number),
      // Crit. 2: nobody keeps this. `null` is what the screen turns into
      // "нет данных — учёта нет"; a 0 here would be an invented fact.
      batterySwaps: null,
    });
  });

  /**
   * Crit. 1а. 600 ₾ handed over covers the deposit and four weeks; it all
   * belongs to the week it was paid in, and the following week — which the
   * money also pays for — shows nothing of it.
   */
  it('puts money paid in advance into the week of the payment and no later one (crit. 1а)', async () => {
    const { vehicle, customer } = await fixtures();
    const owner = await loginAs('owner');
    const before = await week(owner);
    const res = await call(owner, 'POST', '/api/pickups', pickup(customer.id, vehicle.id, { payment: { later: false, channel: 'cash', amountTetri: 60000 } }));
    expect(res.statusCode, res.body).toBe(201);

    const after = await week(owner);
    // 600 through the door on one day. The deposit takes 180 and the first
    // week 150; the 270 that has reached no week yet is still rent, because
    // that is what it was paid for (the mixed rule, designer 22.09.2026).
    expect(after.money.totalTetri - before.money.totalTetri).toBe(60000);
    expect(after.money.depositsInTetri - before.money.depositsInTetri).toBe(18000);
    expect(after.money.rentTetri - before.money.rentTetri).toBe(42000);
    expect(after.rentals.started - before.rentals.started).toBe(1);

    const next = weekOf(addDays(today(), 7));
    const later = await week(owner, range(next));
    expect(later.money.totalTetri).toBe(0);
    expect(later.money.rentTetri).toBe(0);
    expect(later.money.depositsInTetri).toBe(0);
  });

  /**
   * Crit. 1б. The plain hand-over: one payment of 330, two rows under it, and
   * a total that agrees with the breakdown. The total is summed straight off
   * the payments, so its agreeing with the rows is a real check rather than
   * the rows confirming themselves.
   */
  it('splits a hand-over of 330 into rent and deposit, and the rows add up to the total (crit. 1б)', async () => {
    const { vehicle, customer } = await fixtures();
    const owner = await loginAs('owner');
    const before = await week(owner);
    const res = await call(owner, 'POST', '/api/pickups', pickup(customer.id, vehicle.id, { payment: { later: false, channel: 'cash', amountTetri: 33000 } }));
    expect(res.statusCode, res.body).toBe(201);
    const after = await week(owner);

    expect(after.money.rentTetri - before.money.rentTetri).toBe(15000);
    expect(after.money.depositsInTetri - before.money.depositsInTetri).toBe(18000);
    expect(after.money.totalTetri - before.money.totalTetri).toBe(33000);
    expect(rows(after)).toBe(after.money.totalTetri);
  });

  /**
   * Crit. 1в. "Сегодня" and "Неделя" answer the arrears question with one
   * number and one sum, because they read one function. The book counts
   * arrears by rental, not by unpaid week.
   */
  it('shows the same arrears as "Today", to the tetri (crit. 1в)', async () => {
    const owner = await loginAs('owner');
    const w = await week(owner);
    const summary = json<{ rentals: { overdue: number }; overdueList: { debtTetri: number }[] }>(await call(owner, 'GET', '/api/summary'));
    expect(w.rentals.overdueCount).toBe(summary.rentals.overdue);
    expect(w.rentals.overdueTetri).toBe(summary.overdueList.reduce((n, o) => n + o.debtTetri, 0));
  });

  it('agrees with "Деньги → Залоги" about how much deposit money is held', async () => {
    const owner = await loginAs('owner');
    const w = await week(owner);
    const deposits = json<{ totals: { heldTetri: number } }>(await call(owner, 'GET', '/api/deposits'));
    expect(w.money.heldTetri).toBe(deposits.totals.heldTetri);
  });

  /**
   * Crit. 3. Last week is its own seven days: the money taken today is not in
   * it, and the period the API answers for is Monday to Sunday of the week
   * before this one — not "the seven days up to today".
   */
  it('counts the previous week by its own dates, not seven days back (crit. 3)', async () => {
    const { vehicle, customer } = await fixtures();
    const owner = await loginAs('owner');
    const last = weekOf(addDays(weekOf(today()).from, -1));
    const before = await week(owner, range(last));
    await call(owner, 'POST', '/api/pickups', pickup(customer.id, vehicle.id, { payment: { later: false, channel: 'cash', amountTetri: 33000 } }));
    const after = await week(owner, range(last));

    expect(after.from).toBe(last.from);
    expect(after.to).toBe(last.to);
    expect(addDays(after.to, 1)).toBe(weekOf(today()).from);
    // Today's money belongs to today's week and to no earlier one.
    expect(after.money.totalTetri).toBe(before.money.totalTetri);
    expect(after.money.rentTetri).toBe(before.money.rentTetri);
    expect(after.money.depositsInTetri).toBe(before.money.depositsInTetri);
    expect(after.rentals.started).toBe(before.rentals.started);
    // A finished week is read as at its last day, not as at this morning.
    expect(after.asOf).toBe(last.to);
  });

  /**
   * Crit. 9. A rental brought over from Odoo carries weeks that were settled
   * before the move and a deposit that was taken before it. None of that is
   * money through the door this week: it has no day and no payment, so it is
   * reported on a line of its own and never joins the takings.
   */
  it('keeps "paid before the transfer" out of the week’s takings and reports it apart (crit. 9)', async () => {
    const { vehicle, customer } = await fixtures();
    const owner = await loginAs('owner');
    const before = await week(owner);
    const pickedUpOn = addDays(today(), -60);
    const res = await call(owner, 'POST', '/api/pickups', {
      ...pickup(customer.id, vehicle.id, {
        pickedUpOn,
        odometerKm: undefined,
        payment: undefined,
        transfer: { paidThrough: addDays(pickedUpOn, 7 * 7 - 1), depositReceivedTetri: 18000 },
      }),
    });
    expect(res.statusCode, res.body).toBe(201);

    const after = await week(owner);
    // Seven weeks at 150 and a deposit of 180 came over: 1 230 ₾ in all.
    expect(after.money.paidBeforeTransferTetri - before.money.paidBeforeTransferTetri).toBe(7 * 15000 + 18000);
    // …and not one tetri of it landed in the week.
    expect(after.money.totalTetri).toBe(before.money.totalTetri);
    expect(after.money.rentTetri).toBe(before.money.rentTetri);
    expect(after.money.depositsInTetri).toBe(before.money.depositsInTetri);
    expect(after.money.saleTetri).toBe(before.money.saleTetri);
    // The deposit is ours to give back, so it does count as held.
    expect(after.money.heldTetri - before.money.heldTetri).toBe(18000);
    // The weeks it covers are paid: they are not arrears either.
    expect(after.rentals.overdueTetri - before.rentals.overdueTetri).toBe(2 * 15000);
  });

  it('prints the week on one page, in the brand’s own paper (crit. 4)', async () => {
    const owner = await loginAs('owner');
    const res = await call(owner, 'GET', '/api/reports/week.pdf');
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(res.rawPayload.length).toBeGreaterThan(2000);
    // One page. Seventeen figures at the contract's type size ran to two, and
    // a week that prints on two pages is a week nobody carries in (crit. 4).
    expect(/\/Count\s+(\d+)/.exec(res.rawPayload.toString('latin1'))?.[1]).toBe('1');
    // Georgian leads on this paper, so the face that can draw it is embedded.
    expect(res.rawPayload.toString('latin1')).toContain('NotoSansGeorgian');
  });

  it('refuses a period that runs backwards, and is an owner’s figure', async () => {
    const owner = await loginAs('owner');
    const wrong = await call(owner, 'GET', '/api/reports/week?from=2026-09-20&to=2026-09-14');
    expect(wrong.statusCode).toBe(400);
    expect(json<{ error: string }>(wrong).error).toBe('bad_period');

    const manager = await loginAs('manager');
    expect((await call(manager, 'GET', '/api/reports/week')).statusCode).toBe(403);
    expect((await call(manager, 'GET', '/api/reports/week.pdf')).statusCode).toBe(403);
  });
});
