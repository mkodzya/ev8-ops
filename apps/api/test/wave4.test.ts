// Wave 4 at the API: the battery count (§3.8), a moped's state by role (§3.6),
// where a customer came from and a number that is already on another card (§3.5).
import { addDays, todayISO } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

const digits = () => uniq().replace(/\D/g, '');

async function fixtures() {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `W4 ${uniq()}`, weeklyRateTetri: 15000, forRent: true } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TESTW${digits().slice(-12).padStart(12, '0')}`, modelId: model.id, pool: 'rent' } });
  const customer = await prisma.customer.create({ data: { name: `ТЕСТ Волна 4 ${uniq()}`, phone: `+9955${digits().slice(-8)}` } });
  return { prisma, model, vehicle, customer };
}

interface Count {
  total: number;
  couriers: number;
  repair: number;
  showroom: number;
}

describe.skipIf(!HAS_DB)('wave 4 · batteries', () => {
  it('counts nothing until an owner counts, then follows the acts (crit. 29, 30)', async () => {
    const owner = await loginAs('owner');
    const { prisma } = await import('../src/lib/db.js');
    // "Before anybody counted" is a state, not an accident of test order: a
    // stocktake another suite left behind would answer this question for us.
    await prisma.batteryMove.deleteMany({});
    await prisma.batteryInventory.deleteMany({});
    const { customer, vehicle } = await fixtures();
    // A rental with two batteries: that is what the couriers hold.
    const made = await call(owner, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, batteries: 2, chargers: 2, pickedUpOn: addDays(todayISO(), -3) });
    expect(made.statusCode, made.body).toBe(201);
    // Before anybody counted, the whole count is zero — including what the
    // couriers hold: there is no total for it to be part of.
    expect(json<Count>(await call(owner, 'GET', '/api/batteries'))).toMatchObject({ total: 0, couriers: 0 });

    const counted = await call(owner, 'POST', '/api/batteries/inventory', { showroomQty: 7, repairQty: 1, reason: 'ТЕСТ: первый пересчёт' });
    expect(counted.statusCode, counted.body).toBe(201);
    const after = json<Count>(await call(owner, 'GET', '/api/batteries'));
    // The couriers' share is read from the acts of the rentals still out, so
    // it is never typed in; the shelf and the repairs are what was counted.
    expect(after.couriers).toBeGreaterThanOrEqual(2);
    expect({ showroom: after.showroom, repair: after.repair, total: after.total }).toEqual({ showroom: 7, repair: 1, total: 8 + after.couriers });
  });

  it('a battery that did not come back is one fewer, and says so in the movement (crit. 31)', async () => {
    const owner = await loginAs('owner');
    const { customer, vehicle } = await fixtures();
    const { id } = json<{ id: string }>(
      await call(owner, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, batteries: 2, chargers: 2, pickedUpOn: addDays(todayISO(), -3) }),
    );
    await call(owner, 'POST', '/api/batteries/inventory', { showroomQty: 5, repairQty: 0, reason: 'ТЕСТ: перед возвратом' });
    const before = json<Count>(await call(owner, 'GET', '/api/batteries'));
    const ret = await call(owner, 'POST', `/api/rentals/${id}/return`, {
      odometerKm: 10,
      items: { moped: { state: 'ok' }, key: { state: 'ok' }, battery_1: { state: 'ok' }, battery_2: { state: 'missing' }, charger_1: { state: 'ok' }, charger_2: { state: 'ok' } },
    });
    expect(ret.statusCode, ret.body).toBe(200);
    const after = json<Count & { moves: { kind: string; qty: number; number: string | null }[] }>(await call(owner, 'GET', '/api/batteries'));
    expect(after.total).toBe(before.total - 1);
    // Two left with the rental and neither is with a courier now; one of them is gone.
    expect(after.couriers).toBe(before.couriers - 2);
    expect(after.moves[0]).toMatchObject({ kind: 'lost', qty: 1 });
  });

  it('a count that differs needs a reason; a manager does not count at all (crit. 33)', async () => {
    const owner = await loginAs('owner');
    await call(owner, 'POST', '/api/batteries/inventory', { showroomQty: 4, repairQty: 0, reason: 'ТЕСТ: база' });
    const silent = await call(owner, 'POST', '/api/batteries/inventory', { showroomQty: 9, repairQty: 0 });
    expect(json<{ error: string; field: string }>(silent)).toMatchObject({ error: 'missing_field', field: 'reason' });
    const manager = await loginAs('manager');
    expect((await call(manager, 'POST', '/api/batteries/inventory', { showroomQty: 4, repairQty: 0, reason: 'x' })).statusCode).toBe(403);
    expect((await call(manager, 'GET', '/api/batteries')).statusCode).toBe(200);
  });

  it('to repair and back moves the count without touching the total', async () => {
    const owner = await loginAs('owner');
    await call(owner, 'POST', '/api/batteries/inventory', { showroomQty: 6, repairQty: 0, reason: 'ТЕСТ: база' });
    const before = json<Count>(await call(owner, 'GET', '/api/batteries'));
    expect((await call(owner, 'POST', '/api/batteries/moves', { kind: 'to_repair', qty: 2, reason: 'ТЕСТ: не держат заряд' })).statusCode).toBe(201);
    const mid = json<Count>(await call(owner, 'GET', '/api/batteries'));
    expect(mid).toMatchObject({ total: before.total, repair: 2, showroom: before.showroom - 2 });
    await call(owner, 'POST', '/api/batteries/moves', { kind: 'from_repair', qty: 1, reason: 'ТЕСТ: починили' });
    expect(json<Count>(await call(owner, 'GET', '/api/batteries'))).toMatchObject({ total: before.total, repair: 1, showroom: before.showroom - 1 });
    // A move needs words, whatever it is.
    expect(json<{ field: string }>(await call(owner, 'POST', '/api/batteries/moves', { kind: 'lost', qty: 1 })).field).toBe('reason');
  });
});

describe.skipIf(!HAS_DB)('wave 4 · a moped’s state by role (§3.6)', () => {
  it('a manager moves between free and service only; sold is a sale’s word (crit. 24, 25)', async () => {
    const { vehicle } = await fixtures();
    const manager = await loginAs('manager');
    const toService = await call(manager, 'POST', `/api/fleet/${vehicle.id}/state`, { toState: 'service', reason: 'ТЕСТ: не заводится' });
    expect(toService.statusCode, toService.body).toBe(200);
    expect((await call(manager, 'POST', `/api/fleet/${vehicle.id}/state`, { toState: 'out', reason: 'ТЕСТ' })).statusCode).toBe(403);
    const owner = await loginAs('owner');
    expect(json<{ error: string }>(await call(owner, 'POST', `/api/fleet/${vehicle.id}/state`, { toState: 'sold', reason: 'ТЕСТ' })).error).toBe('sold_by_sale');
    const off = await call(owner, 'POST', `/api/fleet/${vehicle.id}/state`, { toState: 'out', reason: 'ТЕСТ: после аварии' });
    expect(off.statusCode, off.body).toBe(200);
  });
});

describe.skipIf(!HAS_DB)('wave 4 · the customer card (§3.5)', () => {
  it('keeps where they came from, and refuses a number another card has (crit. 21, 23)', async () => {
    const { customer } = await fixtures();
    const other = await fixtures();
    const manager = await loginAs('manager');
    const saved = await call(manager, 'PATCH', `/api/customers/${customer.id}`, { name: customer.name, source: 'myauto' });
    expect(saved.statusCode, saved.body).toBe(200);
    const card = json<{ customer: { source: string | null } }>(await call(manager, 'GET', `/api/customers/${customer.id}`));
    expect(card.customer.source).toBe('myauto');

    const twin = await call(manager, 'PATCH', `/api/customers/${customer.id}`, { name: customer.name, phone: other.customer.phone });
    expect(twin.statusCode).toBe(409);
    expect(json<{ error: string; existing: { id: string } }>(twin)).toMatchObject({ error: 'duplicate_phone', existing: { id: other.customer.id } });
  });

  it('gives the card its debt, its sales and one feed', async () => {
    const owner = await loginAs('owner');
    const { customer, vehicle } = await fixtures();
    const { id } = json<{ id: string }>(
      await call(owner, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, pickedUpOn: addDays(todayISO(), -14) }),
    );
    await call(owner, 'POST', '/api/payments', { rentalId: id, channel: 'cash', grossTetri: 15000 });
    const card = json<{ debt: { owesTetri: number; parts: unknown[] }; sales: unknown[]; feed: { kind: string }[] }>(await call(owner, 'GET', `/api/customers/${customer.id}`));
    expect(card.debt.owesTetri).toBeGreaterThan(0);
    expect(card.feed.some((e) => e.kind === 'payment')).toBe(true);
    expect(Array.isArray(card.sales)).toBe(true);
  });
});
