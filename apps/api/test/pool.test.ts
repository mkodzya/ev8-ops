// The parks: what a moped is for, and how it changes (ADR-0005).
// Needs a *_test database; the teardown removes everything it made.
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

async function fixtures(modelExtra: Record<string, unknown> = {}) {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Model ${uniq()}`, weeklyRateTetri: 15000, forRent: true, ...modelExtra } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TEST${uniq().replace(/\D/g, '').slice(0, 13).padStart(13, '0')}`, modelId: model.id } });
  const customer = await prisma.customer.create({ data: { name: `Test Customer ${uniq()}`, phone: `+9955${uniq().replace(/\D/g, '').slice(-8)}` } });
  return { prisma, model, vehicle, customer };
}

const card = async (cookie: string, id: string) =>
  json<{ vehicle: { pool: string | null; state: string }; events: { kind: string; fromPool: string | null; toPool: string | null; toState: string }[] }>(
    await call(cookie, 'GET', `/api/fleet/${id}`),
  );

describe.skipIf(!HAS_DB)('a moped nobody has decided on', () => {
  it('starts in neither park and says so, rather than taking the likelier one', async () => {
    const director = await loginAs('director');
    const { vehicle } = await fixtures();
    expect((await card(director, vehicle.id)).vehicle.pool).toBeNull();
    const list = json<{ byPool: Record<string, number>; vehicles: { id: string; pool: string | null }[] }>(await call(director, 'GET', '/api/fleet'));
    expect(list.vehicles.find((v) => v.id === vehicle.id)?.pool).toBeNull();
    expect(list.byPool.none).toBeGreaterThan(0);
  });

  it('is decided by the hand-over itself, without anybody saying it twice', async () => {
    const director = await loginAs('director');
    const { vehicle, customer } = await fixtures();
    const res = await call(director, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: '150', pickedUpOn: '2026-09-10' });
    expect(res.statusCode, res.body).toBe(201);

    const after = await card(director, vehicle.id);
    expect(after.vehicle.pool).toBe('rent');
    // The park move is its own event, and it left the state where it was.
    const moved = after.events.find((e) => e.kind === 'to_rent');
    expect(moved).toMatchObject({ fromPool: null, toPool: 'rent', toState: 'available' });
    expect(after.events.filter((e) => e.kind === 'to_rent')).toHaveLength(1);
  });
});

describe.skipIf(!HAS_DB)('moving between parks', () => {
  it('writes one event with a reason and changes nothing else', async () => {
    const director = await loginAs('director');
    const { vehicle } = await fixtures();
    const res = await call(director, 'POST', `/api/fleet/${vehicle.id}/pool`, { pool: 'sale', reason: 'goes in the window' });
    expect(res.statusCode, res.body).toBe(200);
    expect(json<{ changed: boolean; from: string | null; to: string }>(res)).toMatchObject({ changed: true, from: null, to: 'sale' });

    const after = await card(director, vehicle.id);
    expect(after.vehicle).toMatchObject({ pool: 'sale', state: 'available' });
    expect(after.events.filter((e) => e.kind === 'to_sale')).toHaveLength(1);
  });

  it('says nothing twice: a moped already in that park gets no second event', async () => {
    const director = await loginAs('director');
    const { vehicle } = await fixtures();
    await call(director, 'POST', `/api/fleet/${vehicle.id}/pool`, { pool: 'sale' });
    const again = await call(director, 'POST', `/api/fleet/${vehicle.id}/pool`, { pool: 'sale' });
    expect(again.statusCode).toBe(200);
    expect(json<{ changed: boolean }>(again).changed).toBe(false);
    expect((await card(director, vehicle.id)).events.filter((e) => e.kind === 'to_sale')).toHaveLength(1);
  });

  it('follows a moped that is already out on rent — that is what a renter buying it looks like', async () => {
    const director = await loginAs('director');
    const { vehicle, customer } = await fixtures();
    await call(director, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: '150', pickedUpOn: '2026-09-10' });
    const res = await call(director, 'POST', `/api/fleet/${vehicle.id}/pool`, { pool: 'sale', reason: 'renter is buying it' });
    expect(res.statusCode, res.body).toBe(200);
    const after = await card(director, vehicle.id);
    expect(after.vehicle).toMatchObject({ pool: 'sale', state: 'rented' });
  });

  it('refuses a moped that has left the fleet, and refuses a word that is not a park', async () => {
    const { prisma, vehicle } = await fixtures();
    const director = await loginAs('director');
    await prisma.vehicle.update({ where: { id: vehicle.id }, data: { state: 'sold' } });
    const gone = await call(director, 'POST', `/api/fleet/${vehicle.id}/pool`, { pool: 'rent' });
    expect(gone.statusCode).toBe(409);
    expect(json<{ error: string }>(gone).error).toBe('vehicle_gone');

    const { vehicle: other } = await fixtures();
    expect((await call(director, 'POST', `/api/fleet/${other.id}/pool`, { pool: 'showroom' })).statusCode).toBe(400);
  });

  it('is the director\'s call, not the manager\'s', async () => {
    const manager = await loginAs('manager');
    const { vehicle } = await fixtures();
    expect((await call(manager, 'POST', `/api/fleet/${vehicle.id}/pool`, { pool: 'sale' })).statusCode).toBe(403);
    // Though a hand-over by that same manager still decides it (the rental is the fact).
    expect((await call(manager, 'GET', '/api/fleet')).statusCode).toBe(200);
  });
});

describe.skipIf(!HAS_DB)('a moped that has left the fleet', () => {
  it('counts in neither park on the fleet screen', async () => {
    const { prisma, vehicle } = await fixtures();
    const director = await loginAs('director');
    await call(director, 'POST', `/api/fleet/${vehicle.id}/pool`, { pool: 'sale' });
    const before = json<{ byPool: Record<string, number> }>(await call(director, 'GET', '/api/fleet')).byPool;
    await prisma.vehicle.update({ where: { id: vehicle.id }, data: { state: 'sold' } });
    const after = json<{ byPool: Record<string, number> }>(await call(director, 'GET', '/api/fleet')).byPool;
    expect(after.sale).toBe(before.sale - 1);
    expect(after.gone).toBe(before.gone + 1);
  });
});
