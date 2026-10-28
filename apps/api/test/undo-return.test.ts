// «Отменить возврат» (B5-08) after GitHub issue #17, item 4 (ADR-0049): the
// moped goes back to the customer on the day of the return it undoes, so a
// swap dated back to the real day of a change of moped is not refused; the
// weeks that began while the rental stood closed open at once, and the
// customer's money not yet placed lies on them, as the night would do. The
// two shapes are those of two rentals on production (a courier changed
// mopeds; the return was made, undone and replaced by a swap); every person,
// moped, sum and number here is made up.
import { addDays, todayISO } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

const today = () => todayISO();
const digits = () => uniq().replace(/\D/g, '');

async function moped() {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Undo ${uniq()}`, weeklyRateTetri: 15000, forRent: true } });
  return prisma.vehicle.create({ data: { vin: `TESTUR${digits().slice(-11).padStart(11, '0')}`, modelId: model.id, pool: 'rent' } });
}

async function customer() {
  const { prisma } = await import('../src/lib/db.js');
  return prisma.customer.create({ data: { name: `Test Courier ${uniq()}`, phone: `+9955${digits().slice(-8)}`, personalId: digits().slice(-11) } });
}

/**
 * A rental handed over `daysAgo` days ago at 150 a week, its first week and
 * the deposit paid in cash, then returned on `returnedOn` with nothing
 * wrong — the return somebody is about to take back.
 */
async function returned(daysAgo: number, returnedOn: string) {
  const { prisma } = await import('../src/lib/db.js');
  const owner = await loginAs('owner');
  const v = await moped();
  const c = await customer();
  const res = await call(owner, 'POST', '/api/pickups', {
    customerId: c.id,
    vehicleId: v.id,
    weeklyRateTetri: 15000,
    depositTetri: 18000,
    pickedUpOn: addDays(today(), -daysAgo),
    nightParkingAddress: 'Test street 1',
    batteries: 1,
    chargers: 1,
    odometerKm: 100,
    payment: { later: false, channel: 'cash', amountTetri: 33000 },
  });
  expect(res.statusCode, res.body).toBe(201);
  const rental = json<{ id: string; number: string }>(res);
  const items = { moped: { state: 'ok' }, key: { state: 'ok' }, battery_1: { state: 'ok' }, charger_1: { state: 'ok' } };
  const back = await call(owner, 'POST', `/api/rentals/${rental.id}/return`, { returnedOn, odometerKm: 150, items });
  expect(back.statusCode, back.body).toBe(200);
  return { prisma, owner, v, c, rental };
}

interface Card {
  rental: { status: string; paidThrough: string | null; debtTetri: number };
  periods: { seq: number; startsOn: string; endsOn: string; amountTetri: number; paidTetri: number }[];
}
const card = async (cookie: string, id: string) => json<Card>(await call(cookie, 'GET', `/api/rentals/${id}`));

describe.skipIf(!HAS_DB)('a return taken back (issue #17)', () => {
  it('the moped goes back on the day of the return, and a swap dated that day is let through', async () => {
    const returnedOn = addDays(today(), -2);
    const { prisma, owner, v, rental } = await returned(8, returnedOn);
    const undo = await call(owner, 'POST', `/api/rentals/${rental.id}/return/undo`, { reason: 'ТЕСТ he changed mopeds, not returned' });
    expect(undo.statusCode, undo.body).toBe(200);

    const { isoDate } = await import('../src/lib/dates.js');
    const back = await prisma.vehicleEvent.findFirstOrThrow({ where: { vehicleId: v.id, kind: 'pickup' }, orderBy: { createdAt: 'desc' } });
    // Not today, the day of the undo: the day of the return it undoes.
    expect(isoDate(back.occurredOn)).toBe(returnedOn);
    expect(back).toMatchObject({ rentalId: rental.id, toState: 'rented' });
    expect(await prisma.vehicle.findUniqueOrThrow({ where: { id: v.id }, select: { state: true, currentRentalId: true } })).toEqual({ state: 'rented', currentRentalId: rental.id });

    // The swap is dated the real day the courier changed mopeds.
    const fresh = await moped();
    const point = await prisma.location.create({ data: { name: `ТЕСТ point ${uniq()}` }, select: { id: true } });
    const swap = await call(owner, 'POST', `/api/rentals/${rental.id}/swap`, {
      swappedOn: returnedOn,
      reason: 'ТЕСТ the courier took another moped',
      outOdometerKm: 150,
      items: { moped: { state: 'ok' }, key: { state: 'ok' } },
      toService: false,
      locationId: point.id,
      vehicleId: fresh.id,
      inOdometerKm: 10,
    });
    expect(swap.statusCode, swap.body).toBe(200);
  });

  it('a week that began while the rental stood closed is opened at once, and money paid meanwhile lies on it', async () => {
    // Handed over 8 days ago: the first week ends the day before yesterday,
    // the second began yesterday — after the return, so the return dropped it.
    const returnedOn = addDays(today(), -2);
    const { owner, c, rental } = await returned(8, returnedOn);
    let r = await card(owner, rental.id);
    expect(r.periods.map((p) => p.seq)).toEqual([1]);

    // A transfer came while it stood closed: the customer's, tied to no rental.
    const paid = await call(owner, 'POST', '/api/payments', { customerId: c.id, channel: 'cash', grossTetri: 15000 });
    expect(paid.statusCode, paid.body).toBe(201);

    const undo = await call(owner, 'POST', `/api/rentals/${rental.id}/return/undo`, { reason: 'ТЕСТ returned by mistake' });
    expect(undo.statusCode, undo.body).toBe(200);
    r = await card(owner, rental.id);
    expect(r.rental.status).toBe('active');
    // Without waiting for the night: week two exists and is paid by that money.
    expect(r.periods.map((p) => [p.seq, p.startsOn, p.amountTetri, p.paidTetri])).toEqual([
      [1, addDays(today(), -8), 15000, 15000],
      [2, addDays(today(), -1), 15000, 15000],
    ]);
    expect(r.rental.paidThrough).toBe(addDays(today(), 5));
    expect(r.rental.debtTetri).toBe(0);
  });

  it('is refused when the moped went to somebody else in the meantime', async () => {
    const { owner, v, rental } = await returned(3, today());
    const next = await customer();
    const handed = await call(owner, 'POST', '/api/pickups', {
      customerId: next.id,
      vehicleId: v.id,
      weeklyRateTetri: 15000,
      depositTetri: 18000,
      pickedUpOn: today(),
      nightParkingAddress: 'Test street 2',
      batteries: 1,
      chargers: 1,
      odometerKm: 150,
      payment: { later: true },
    });
    expect(handed.statusCode, handed.body).toBe(201);
    const undo = await call(owner, 'POST', `/api/rentals/${rental.id}/return/undo`, { reason: 'ТЕСТ wrong rental' });
    expect(undo.statusCode).toBe(409);
    expect(json<{ error: string; rental: string }>(undo)).toMatchObject({ error: 'vehicle_in_rental', rental: json<{ number: string }>(handed).number });
    expect((await card(owner, rental.id)).rental.status).toBe('returned');
  });
});
