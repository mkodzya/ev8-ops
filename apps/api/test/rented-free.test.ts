// A moped in an open rental is the customer's, whatever its state says
// (GitHub issue #17, item 1; ADR-0049). A repair's end used to make every
// moped «Свободен», so one out on a running rental stood free on its card and
// could be handed to a second customer. Now: a repair ends with the customer
// while the rental is open; nothing hands such a moped out again; and an
// owner gives a moped left in the wrong state its «В аренде» back, with a
// reason. Every moped, person, point and number here is made up.
import { todayISO } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

const today = () => todayISO();
const digits = () => uniq().replace(/\D/g, '');

async function moped() {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Free ${uniq()}`, weeklyRateTetri: 15000, forRent: true } });
  return prisma.vehicle.create({ data: { vin: `TESTRF${digits().slice(-11).padStart(11, '0')}`, modelId: model.id, pool: 'rent' } });
}

async function customer() {
  const { prisma } = await import('../src/lib/db.js');
  return prisma.customer.create({ data: { name: `Test Renter ${uniq()}`, phone: `+9955${digits().slice(-8)}`, personalId: digits().slice(-11) } });
}

async function point(): Promise<string> {
  const { prisma } = await import('../src/lib/db.js');
  return (await prisma.location.create({ data: { name: `ТЕСТ point ${uniq()}` }, select: { id: true } })).id;
}

/** What the hand-over wizard sends for an existing customer, paid in cash. */
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
    payment: { later: false, channel: 'cash', amountTetri: 33000 },
    ...over,
  };
}

async function handOver(owner: string, vehicleId: string) {
  const c = await customer();
  const res = await call(owner, 'POST', '/api/pickups', pickup(c.id, vehicleId));
  expect(res.statusCode, res.body).toBe(201);
  return json<{ id: string; number: string }>(res);
}

/**
 * A moped out on a running rental whose card says «Свободен» — what a
 * repair's end left on production with 1.16 (the bug itself is shown in the
 * first suite; here the state is set as it was found).
 */
async function strayFree() {
  const { prisma } = await import('../src/lib/db.js');
  const owner = await loginAs('owner');
  const v = await moped();
  const rental = await handOver(owner, v.id);
  await prisma.vehicle.update({ where: { id: v.id }, data: { state: 'available', currentRentalId: null } });
  return { prisma, owner, v, rental };
}

const err = (res: { body: string }) => json<{ error: string; field?: string; rental?: string }>(res);
const state = async (id: string) => {
  const { prisma } = await import('../src/lib/db.js');
  return prisma.vehicle.findUniqueOrThrow({ where: { id }, select: { state: true, currentRentalId: true, locationId: true } });
};

describe.skipIf(!HAS_DB)('a repair ends where the moped was (issue #17)', () => {
  it('the case from production: hand-over, moves by hand, a repair left open, then closed — the moped stays «В аренде»', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const manager = await loginAs('manager');
    const v = await moped();
    // A repair opened on a moped in the yard takes it into service…
    const opened = await call(owner, 'POST', '/api/service', { vehicleId: v.id, reason: 'ТЕСТ brake noise' });
    expect(opened.statusCode, opened.body).toBe(201);
    const job = json<{ id: string }>(opened).id;
    // …somebody puts it back by hand while the repair stays open, and it is handed over.
    expect((await call(manager, 'POST', `/api/fleet/${v.id}/state`, { toState: 'available', reason: 'ТЕСТ rides fine' })).statusCode).toBe(200);
    const rental = await handOver(owner, v.id);
    expect(await state(v.id)).toMatchObject({ state: 'rented', currentRentalId: rental.id });

    // The repair is closed: before the fix this said «Свободен».
    const closed = await call(owner, 'POST', `/api/service/${job}/close`, { odometerKm: 1312, locationId: await point() });
    expect(closed.statusCode, closed.body).toBe(200);
    expect(await state(v.id)).toMatchObject({ state: 'rented', currentRentalId: rental.id, locationId: null });
    const out = await prisma.vehicleEvent.findFirstOrThrow({ where: { vehicleId: v.id, kind: 'service_out' } });
    expect(out).toMatchObject({ fromState: 'rented', toState: 'rented', rentalId: rental.id });
  });

  it('a repair cancelled on a moped whose rental is open gives it back to the customer, not to the yard', async () => {
    const owner = await loginAs('owner');
    const v = await moped();
    const job = json<{ id: string }>(await call(owner, 'POST', '/api/service', { vehicleId: v.id, reason: 'ТЕСТ wrong moped' })).id;
    expect((await call(owner, 'POST', `/api/fleet/${v.id}/state`, { toState: 'available', reason: 'ТЕСТ out of the workshop' })).statusCode).toBe(200);
    const rental = await handOver(owner, v.id);
    const cancelled = await call(owner, 'POST', `/api/service/${job}/cancel`, { reason: 'ТЕСТ opened by mistake' });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(await state(v.id)).toMatchObject({ state: 'rented', currentRentalId: rental.id });
  });

  it('with no rental open, a repair still ends with the moped free', async () => {
    const owner = await loginAs('owner');
    const v = await moped();
    const job = json<{ id: string }>(await call(owner, 'POST', '/api/service', { vehicleId: v.id, reason: 'ТЕСТ flat tyre' })).id;
    expect((await call(owner, 'POST', `/api/service/${job}/close`, { odometerKm: 50, locationId: await point() })).statusCode).toBe(200);
    expect(await state(v.id)).toMatchObject({ state: 'available', currentRentalId: null });
  });
});

describe.skipIf(!HAS_DB)('a moped out on a rental is handed to nobody else (issue #17)', () => {
  it('refuses a hand-over, a swap into another rental, a VIN confirmed later and a sale', async () => {
    const { owner, v, rental } = await strayFree();
    const manager = await loginAs('manager');
    const someone = await customer();
    expect(err(await call(manager, 'POST', '/api/pickups', pickup(someone.id, v.id)))).toMatchObject({ error: 'vehicle_in_rental', field: 'vehicleId', rental: rental.number });

    // Another running rental may not take it in a swap.
    const other = await moped();
    const running = await handOver(owner, other.id);
    const swap = await call(manager, 'POST', `/api/rentals/${running.id}/swap`, {
      swappedOn: today(),
      reason: 'ТЕСТ bigger battery',
      outOdometerKm: 150,
      items: { moped: { state: 'ok' }, key: { state: 'ok' } },
      toService: false,
      locationId: await point(),
      vehicleId: v.id,
      inOdometerKm: 120,
    });
    expect(err(swap)).toMatchObject({ error: 'vehicle_in_rental', rental: rental.number });

    // A rental handed over without a VIN may not be given it either.
    const noVin = await customer();
    const vinLater = await call(owner, 'POST', '/api/pickups', pickup(noVin.id, '', { vehicleId: null, vinNote: 'ТЕСТ papers at home' }));
    expect(vinLater.statusCode, vinLater.body).toBe(201);
    const confirm = await call(owner, 'PATCH', `/api/rentals/${json<{ id: string }>(vinLater).id}`, { vehicleId: v.id });
    expect(err(confirm)).toMatchObject({ error: 'vehicle_in_rental', rental: rental.number });

    // Nor sold: the same words as for a moped marked rented.
    const buyer = await customer();
    expect(err(await call(owner, 'POST', '/api/sales', { customerId: buyer.id, vehicleId: v.id, priceTetri: '2900', movePool: true }))).toMatchObject({ error: 'vehicle_rented_sale', rental: rental.number });
    expect(await state(v.id)).toMatchObject({ state: 'available', currentRentalId: null });
    // Not left free in its rental for the suites after this one.
    expect((await call(owner, 'POST', `/api/fleet/${v.id}/state`, { toState: 'rented', reason: 'ТЕСТ put right' })).statusCode).toBe(200);
  });

  it('a repair opened on it leaves it where it is and remembers the rental, as for any moped out with a customer', async () => {
    const { prisma, owner, v, rental } = await strayFree();
    const res = await call(owner, 'POST', '/api/service', { vehicleId: v.id, reason: 'ТЕСТ mirror', payer: 'customer' });
    expect(res.statusCode, res.body).toBe(201);
    const job = await prisma.serviceJob.findUniqueOrThrow({ where: { id: json<{ id: string }>(res).id } });
    expect(job).toMatchObject({ rentalId: rental.id, movedVehicle: false });
    expect(await state(v.id)).toMatchObject({ state: 'available' });
    // Not left open, nor free in its rental, for the suites after this one.
    expect((await call(owner, 'POST', `/api/service/${job.id}/cancel`, { reason: 'ТЕСТ done' })).statusCode).toBe(200);
    expect((await call(owner, 'POST', `/api/fleet/${v.id}/state`, { toState: 'rented', reason: 'ТЕСТ put right' })).statusCode).toBe(200);
  });
});

describe.skipIf(!HAS_DB)('an owner gives the moped its «В аренде» back (issue #17)', () => {
  it('the card names the open rental; only an owner, only to «В аренде», with a reason; journalled', async () => {
    const { prisma, owner, v, rental } = await strayFree();
    const manager = await loginAs('manager');
    const card = json<{ vehicle: { state: string; openRental: { id: string; number: string } | null } }>(await call(manager, 'GET', `/api/fleet/${v.id}`));
    expect(card.vehicle).toMatchObject({ state: 'available', openRental: { id: rental.id, number: rental.number } });
    const list = json<{ vehicles: { id: string; openRental: { number: string } | null }[] }>(await call(manager, 'GET', '/api/fleet'));
    expect(list.vehicles.find((x) => x.id === v.id)?.openRental).toMatchObject({ number: rental.number });

    const url = `/api/fleet/${v.id}/state`;
    // Nothing but «В аренде» while the rental is open — for anybody.
    expect(err(await call(manager, 'POST', url, { toState: 'service', reason: 'ТЕСТ noise' })).error).toBe('vehicle_rented_move');
    expect(err(await call(owner, 'POST', url, { toState: 'out', reason: 'ТЕСТ crash' })).error).toBe('vehicle_rented_move');
    // «В аренде» is an owner's, and wants the reason.
    expect(err(await call(manager, 'POST', url, { toState: 'rented', reason: 'ТЕСТ it is with the customer' })).error).toBe('owner_only');
    expect(err(await call(owner, 'POST', url, { toState: 'rented' }))).toMatchObject({ error: 'missing_field', field: 'reason' });

    const ok = await call(owner, 'POST', url, { toState: 'rented', reason: 'ТЕСТ the repair closed it by mistake' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(json<{ from: string; to: string }>(ok)).toEqual({ from: 'available', to: 'rented' });
    expect(await state(v.id)).toMatchObject({ state: 'rented', currentRentalId: rental.id, locationId: null });
    const event = await prisma.vehicleEvent.findFirstOrThrow({ where: { vehicleId: v.id, kind: 'manual' }, orderBy: { createdAt: 'desc' } });
    expect(event).toMatchObject({ fromState: 'available', toState: 'rented', rentalId: rental.id, reason: 'ТЕСТ the repair closed it by mistake' });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: v.id, action: 'vehicle.state.manual' }, orderBy: { createdAt: 'desc' } });
    expect(log.before).toEqual({ state: 'available' });
    expect(log.after).toEqual({ state: 'rented', rental: rental.number });
    expect(log.note).toBe('ТЕСТ the repair closed it by mistake');

    // Rented with its rental, it moves through the rental again.
    expect(err(await call(owner, 'POST', url, { toState: 'rented', reason: 'ТЕСТ again' })).error).toBe('vehicle_rented_move');
    expect(err(await call(owner, 'POST', url, { toState: 'available', reason: 'ТЕСТ back' })).error).toBe('vehicle_rented_move');
  });

  it('without an open rental «В аренде» is never chosen by hand — only a hand-over makes it', async () => {
    const owner = await loginAs('owner');
    const v = await moped();
    expect(err(await call(owner, 'POST', `/api/fleet/${v.id}/state`, { toState: 'rented', reason: 'ТЕСТ by hand' })).error).toBe('use_rental');
    const card = json<{ vehicle: { openRental: unknown } }>(await call(owner, 'GET', `/api/fleet/${v.id}`));
    expect(card.vehicle.openRental).toBeNull();
  });
});
