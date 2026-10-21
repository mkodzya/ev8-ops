// What the fleet list says beside a moped's state (the call of 21.10.2026;
// ADR-0005, addendum 21.10.2026): why it stands in service, as recorded, and
// the sale park it may be waiting in. Needs a *_test database; the teardown
// removes everything it made. Every reason and name here is invented.
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

interface Why {
  kind: string | null;
  text: string | null;
  from: 'job' | 'manual' | null;
}
interface Row {
  id: string;
  state: string;
  pool: string | null;
  serviceWhy: Why | null;
}

async function freeVehicle(modelExtra: Record<string, unknown> = {}) {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Model ${uniq()}`, forRent: true, ...modelExtra } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TESTF${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id } });
  return { prisma, vehicle };
}

/** Closing a repair names where the moped stands (B5-06), as in service.test.ts. */
async function point(): Promise<string> {
  const { prisma } = await import('../src/lib/db.js');
  const row = await prisma.location.findFirst({ where: { archived: false }, select: { id: true } });
  return (row ?? (await prisma.location.create({ data: { name: `ТЕСТ point ${uniq()}` }, select: { id: true } }))).id;
}

async function rowOf(cookie: string, id: string): Promise<Row> {
  const res = await call(cookie, 'GET', '/api/fleet');
  expect(res.statusCode, res.body).toBe(200);
  const row = json<{ vehicles: Row[] }>(res).vehicles.find((v) => v.id === id);
  if (!row) throw new Error(`moped ${id} is not on the fleet list`);
  return row;
}

describe.skipIf(!HAS_DB)('the fleet says why a moped is in service', () => {
  it('reads what the open repair says happened, and forgets it once the repair is closed', async () => {
    const { vehicle } = await freeVehicle();
    const owner = await loginAs('owner');
    const opened = await call(owner, 'POST', '/api/service', { vehicleId: vehicle.id, reason: 'invented: brake pads', openedOn: '2026-10-20' });
    expect(opened.statusCode, opened.body).toBe(201);
    const { id } = json<{ id: string }>(opened);

    expect(await rowOf(owner, vehicle.id)).toMatchObject({ state: 'service', serviceWhy: { kind: null, text: 'invented: brake pads', from: 'job' } });

    const closed = await call(owner, 'POST', `/api/service/${id}/close`, { closedOn: '2026-10-21', odometerKm: 1312, locationId: await point() });
    expect(closed.statusCode, closed.body).toBe(200);
    expect(await rowOf(owner, vehicle.id)).toMatchObject({ state: 'available', serviceWhy: null });
  });

  it('names the kind the repair recorded before its words', async () => {
    const { prisma, vehicle } = await freeVehicle();
    const owner = await loginAs('owner');
    const { id } = json<{ id: string }>(await call(owner, 'POST', '/api/service', { vehicleId: vehicle.id, reason: 'invented: hit from behind' }));
    // The kind as the workshop tablet records it (POST /api/service/workshop).
    await prisma.serviceJob.update({ where: { id }, data: { reasonKind: 'accident' } });

    expect((await rowOf(owner, vehicle.id)).serviceWhy).toEqual({ kind: 'accident', text: 'invented: hit from behind', from: 'job' });
  });

  it('names the kind the office picked, and the kind the owner changed it to (Mika, 21.10.2026)', async () => {
    const { vehicle } = await freeVehicle();
    const owner = await loginAs('owner');
    const opened = await call(owner, 'POST', '/api/service', { vehicleId: vehicle.id, reason: 'invented: bent fork', reasonKind: 'accident' });
    expect(opened.statusCode, opened.body).toBe(201);
    const { id } = json<{ id: string }>(opened);
    expect((await rowOf(owner, vehicle.id)).serviceWhy).toEqual({ kind: 'accident', text: 'invented: bent fork', from: 'job' });

    const changed = await call(owner, 'PATCH', `/api/service/${id}`, { reasonKind: 'wear' });
    expect(changed.statusCode, changed.body).toBe(200);
    expect((await rowOf(owner, vehicle.id)).serviceWhy).toEqual({ kind: 'wear', text: 'invented: bent fork', from: 'job' });
    expect((await call(owner, 'POST', `/api/service/${id}/cancel`, { reason: 'invented: done' })).statusCode).toBe(200);
  });

  it('reads a manager’s reported breakdown while it waits for an owner', async () => {
    const { vehicle } = await freeVehicle();
    const manager = await loginAs('manager');
    const reported = await call(manager, 'POST', '/api/service', { vehicleId: vehicle.id, reason: 'invented: does not start' });
    expect(reported.statusCode, reported.body).toBe(201);

    // The manager reads the same list, and the same answer.
    expect(await rowOf(manager, vehicle.id)).toMatchObject({ state: 'service', serviceWhy: { kind: null, text: 'invented: does not start', from: 'job' } });
  });

  it('falls back to the reason given when somebody moved the moped into service by hand', async () => {
    const { vehicle } = await freeVehicle();
    const manager = await loginAs('manager');
    const moved = await call(manager, 'POST', `/api/fleet/${vehicle.id}/state`, { toState: 'service', reason: 'invented: waits for a part' });
    expect(moved.statusCode, moved.body).toBe(200);

    expect((await rowOf(manager, vehicle.id)).serviceWhy).toEqual({ kind: null, text: 'invented: waits for a part', from: 'manual' });
  });

  it('says nothing for a moped that stands in service with nothing written — never a guess', async () => {
    const { prisma, vehicle } = await freeVehicle();
    const owner = await loginAs('owner');
    // As the Odoo-era mopeds stand: in service, with no repair and no event.
    await prisma.vehicle.update({ where: { id: vehicle.id }, data: { state: 'service' } });

    expect((await rowOf(owner, vehicle.id)).serviceWhy).toEqual({ kind: null, text: null, from: null });
  });

  it('asks nothing of a moped that is not in service, a repair at the renter’s included', async () => {
    const { prisma, vehicle } = await freeVehicle();
    const owner = await loginAs('owner');
    expect((await rowOf(owner, vehicle.id)).serviceWhy).toBeNull();

    const customer = await prisma.customer.create({ data: { name: `Test Renter ${uniq()}` } });
    const rented = await call(owner, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, pickedUpOn: '2026-10-01' });
    expect(rented.statusCode, rented.body).toBe(201);
    const repair = await call(owner, 'POST', '/api/service', { vehicleId: vehicle.id, reason: 'invented: flat tyre' });
    expect(repair.statusCode, repair.body).toBe(201);

    expect(await rowOf(owner, vehicle.id)).toMatchObject({ state: 'rented', serviceWhy: null });
  });
});

describe.skipIf(!HAS_DB)('the sale park on the fleet list', () => {
  it('keeps a moped for sale in the sale park through a repair, and lets it go when it is sold', async () => {
    const { prisma, vehicle } = await freeVehicle({ salePriceTetri: 290000 });
    const owner = await loginAs('owner');
    expect((await call(owner, 'POST', `/api/fleet/${vehicle.id}/pool`, { pool: 'sale' })).statusCode).toBe(200);
    expect(await rowOf(owner, vehicle.id)).toMatchObject({ state: 'available', pool: 'sale', serviceWhy: null });

    // Made ready for sale in the workshop: still the sale park, now with a reason.
    const { id } = json<{ id: string }>(await call(owner, 'POST', '/api/service', { vehicleId: vehicle.id, reason: 'invented: new tyres before the sale' }));
    expect(await rowOf(owner, vehicle.id)).toMatchObject({ state: 'service', pool: 'sale', serviceWhy: { text: 'invented: new tyres before the sale' } });
    // Only a moped standing free is sold.
    const customer = await prisma.customer.create({ data: { name: `Test Buyer ${uniq()}` } });
    const early = await call(owner, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '2900' });
    expect(early.statusCode).toBe(409);
    expect(json<{ error: string }>(early).error).toBe('vehicle_not_available');

    await call(owner, 'POST', `/api/service/${id}/close`, { odometerKm: 1312, locationId: await point() });
    const sold = await call(owner, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '2900' });
    expect(sold.statusCode, sold.body).toBe(201);

    // Sold is the way out of the park: the row stays a record, in neither park.
    expect(await rowOf(owner, vehicle.id)).toMatchObject({ state: 'sold', serviceWhy: null });
    const card = json<{ events: { kind: string }[] }>(await call(owner, 'GET', `/api/fleet/${vehicle.id}`));
    expect(card.events.map((e) => e.kind)).toEqual(['to_sale', 'service_in', 'service_out', 'sold']);
  });
});
