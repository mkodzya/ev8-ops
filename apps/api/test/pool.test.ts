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
    const otherOwner = await loginAs('owner');
    const { vehicle } = await fixtures();
    expect((await card(otherOwner, vehicle.id)).vehicle.pool).toBeNull();
    const list = json<{ byPool: Record<string, number>; vehicles: { id: string; pool: string | null }[] }>(await call(otherOwner, 'GET', '/api/fleet'));
    expect(list.vehicles.find((v) => v.id === vehicle.id)?.pool).toBeNull();
    expect(list.byPool.none).toBeGreaterThan(0);
  });

  it('is decided by the hand-over itself, without anybody saying it twice', async () => {
    const otherOwner = await loginAs('owner');
    const { vehicle, customer } = await fixtures();
    const res = await call(otherOwner, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: '150', pickedUpOn: '2026-09-10' });
    expect(res.statusCode, res.body).toBe(201);

    const after = await card(otherOwner, vehicle.id);
    expect(after.vehicle.pool).toBe('rent');
    // The park move is its own event, and it left the state where it was.
    const moved = after.events.find((e) => e.kind === 'to_rent');
    expect(moved).toMatchObject({ fromPool: null, toPool: 'rent', toState: 'available' });
    expect(after.events.filter((e) => e.kind === 'to_rent')).toHaveLength(1);
  });
});

describe.skipIf(!HAS_DB)('moving between parks', () => {
  it('writes one event with a reason and changes nothing else', async () => {
    const otherOwner = await loginAs('owner');
    const { vehicle } = await fixtures();
    const res = await call(otherOwner, 'POST', `/api/fleet/${vehicle.id}/pool`, { pool: 'sale', reason: 'goes in the window' });
    expect(res.statusCode, res.body).toBe(200);
    expect(json<{ changed: boolean; from: string | null; to: string }>(res)).toMatchObject({ changed: true, from: null, to: 'sale' });

    const after = await card(otherOwner, vehicle.id);
    expect(after.vehicle).toMatchObject({ pool: 'sale', state: 'available' });
    expect(after.events.filter((e) => e.kind === 'to_sale')).toHaveLength(1);
  });

  it('says nothing twice: a moped already in that park gets no second event', async () => {
    const otherOwner = await loginAs('owner');
    const { vehicle } = await fixtures();
    await call(otherOwner, 'POST', `/api/fleet/${vehicle.id}/pool`, { pool: 'sale' });
    const again = await call(otherOwner, 'POST', `/api/fleet/${vehicle.id}/pool`, { pool: 'sale' });
    expect(again.statusCode).toBe(200);
    expect(json<{ changed: boolean }>(again).changed).toBe(false);
    expect((await card(otherOwner, vehicle.id)).events.filter((e) => e.kind === 'to_sale')).toHaveLength(1);
  });

  it('follows a moped that is already out on rent — that is what a renter buying it looks like', async () => {
    const otherOwner = await loginAs('owner');
    const { vehicle, customer } = await fixtures();
    await call(otherOwner, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: '150', pickedUpOn: '2026-09-10' });
    const res = await call(otherOwner, 'POST', `/api/fleet/${vehicle.id}/pool`, { pool: 'sale', reason: 'renter is buying it' });
    expect(res.statusCode, res.body).toBe(200);
    const after = await card(otherOwner, vehicle.id);
    expect(after.vehicle).toMatchObject({ pool: 'sale', state: 'rented' });
  });

  it('refuses a moped that has left the fleet, and refuses a word that is not a park', async () => {
    const { prisma, vehicle } = await fixtures();
    const otherOwner = await loginAs('owner');
    await prisma.vehicle.update({ where: { id: vehicle.id }, data: { state: 'sold' } });
    const gone = await call(otherOwner, 'POST', `/api/fleet/${vehicle.id}/pool`, { pool: 'rent' });
    expect(gone.statusCode).toBe(409);
    expect(json<{ error: string }>(gone).error).toBe('vehicle_gone');

    const { vehicle: other } = await fixtures();
    expect((await call(otherOwner, 'POST', `/api/fleet/${other.id}/pool`, { pool: 'showroom' })).statusCode).toBe(400);
  });

  it('is an owner\'s call, not a manager\'s', async () => {
    const manager = await loginAs('manager');
    const { vehicle } = await fixtures();
    expect((await call(manager, 'POST', `/api/fleet/${vehicle.id}/pool`, { pool: 'sale' })).statusCode).toBe(403);
    // Though a hand-over by that same manager still decides it (the rental is the fact).
    expect((await call(manager, 'GET', '/api/fleet')).statusCode).toBe(200);
  });
});

describe.skipIf(!HAS_DB)('silence on the fleet screen', () => {
  it('is not broken by a park move — that is paper, not a ride', async () => {
    const { prisma, vehicle } = await fixtures();
    const otherOwner = await loginAs('owner');
    await prisma.vehicle.update({ where: { id: vehicle.id }, data: { arrivedOn: new Date('2026-03-01') } });
    await prisma.vehicleEvent.create({ data: { vehicleId: vehicle.id, kind: 'return', occurredOn: new Date('2026-05-04'), toState: 'available' } });
    await call(otherOwner, 'POST', `/api/fleet/${vehicle.id}/pool`, { pool: 'sale', reason: 'goes in the window' });

    const seen = async () =>
      json<{ vehicles: { id: string; lastSeenOn: string | null }[] }>(await call(otherOwner, 'GET', '/api/fleet')).vehicles.find((v) => v.id === vehicle.id)
        ?.lastSeenOn;
    expect(await seen()).toBe('2026-05-04');

    // With nothing but the move, the silence runs from the day it arrived.
    await prisma.vehicleEvent.deleteMany({ where: { vehicleId: vehicle.id, kind: 'return' } });
    expect(await seen()).toBe('2026-03-01');
  });
});

describe.skipIf(!HAS_DB)('a moped that has left the fleet', () => {
  it('counts in neither park on the fleet screen', async () => {
    const { prisma, vehicle } = await fixtures();
    const otherOwner = await loginAs('owner');
    await call(otherOwner, 'POST', `/api/fleet/${vehicle.id}/pool`, { pool: 'sale' });
    const before = json<{ byPool: Record<string, number> }>(await call(otherOwner, 'GET', '/api/fleet')).byPool;
    await prisma.vehicle.update({ where: { id: vehicle.id }, data: { state: 'sold' } });
    const after = json<{ byPool: Record<string, number> }>(await call(otherOwner, 'GET', '/api/fleet')).byPool;
    expect(after.sale).toBe(before.sale - 1);
    expect(after.gone).toBe(before.gone + 1);
  });
});

describe.skipIf(!HAS_DB)('taking a park move back', () => {
  it('restores "nobody has decided", which no second move could reach', async () => {
    const otherOwner = await loginAs('owner');
    const { vehicle } = await fixtures();
    await call(otherOwner, 'POST', `/api/fleet/${vehicle.id}/pool`, { pool: 'sale' });
    expect((await card(otherOwner, vehicle.id)).vehicle.pool).toBe('sale');

    const undo = await call(otherOwner, 'POST', `/api/fleet/${vehicle.id}/pool/undo`, {});
    expect(undo.statusCode, undo.body).toBe(200);
    expect(json<{ pool: string | null }>(undo).pool).toBeNull();

    // A mis-click is not a decision, so it leaves no line in the moped's own
    // history — the change journal keeps both halves instead.
    const after = await card(otherOwner, vehicle.id);
    expect(after.vehicle.pool).toBeNull();
    expect(after.events.filter((e) => e.kind === 'to_sale')).toHaveLength(0);

    const { prisma } = await import('../src/lib/db.js');
    const trail = await prisma.auditLog.findMany({ where: { entityId: vehicle.id }, orderBy: { createdAt: 'asc' } });
    expect(trail.map((a) => a.action)).toEqual(['vehicle.pool', 'vehicle.pool.undo']);
  });

  it('gives back the park the moped was in before, not an empty one', async () => {
    const otherOwner = await loginAs('owner');
    const { vehicle } = await fixtures();
    await call(otherOwner, 'POST', `/api/fleet/${vehicle.id}/pool`, { pool: 'rent' });
    await call(otherOwner, 'POST', `/api/fleet/${vehicle.id}/pool`, { pool: 'sale' });
    await call(otherOwner, 'POST', `/api/fleet/${vehicle.id}/pool/undo`, {});
    expect((await card(otherOwner, vehicle.id)).vehicle.pool).toBe('rent');
  });

  it('is only for the person who made the move, and only when there is one', async () => {
    const otherOwner = await loginAs('owner');
    const owner = await loginAs('owner');
    const { vehicle } = await fixtures();

    const nothing = await call(otherOwner, 'POST', `/api/fleet/${vehicle.id}/pool/undo`, {});
    expect(nothing.statusCode).toBe(409);
    expect(json<{ error: string }>(nothing).error).toBe('nothing_to_undo');

    await call(otherOwner, 'POST', `/api/fleet/${vehicle.id}/pool`, { pool: 'sale' });
    const notYours = await call(owner, 'POST', `/api/fleet/${vehicle.id}/pool/undo`, {});
    expect(notYours.statusCode).toBe(409);
    expect(json<{ error: string }>(notYours).error).toBe('not_yours');
    expect((await card(otherOwner, vehicle.id)).vehicle.pool).toBe('sale');
  });

  it('stops being an undo once the move has had time to become a decision', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const otherOwner = await loginAs('owner');
    const { vehicle } = await fixtures();
    await call(otherOwner, 'POST', `/api/fleet/${vehicle.id}/pool`, { pool: 'sale' });
    const event = await prisma.vehicleEvent.findFirstOrThrow({ where: { vehicleId: vehicle.id, kind: 'to_sale' } });
    await prisma.vehicleEvent.update({ where: { id: event.id }, data: { createdAt: new Date(Date.now() - 11 * 60 * 1000) } });

    const late = await call(otherOwner, 'POST', `/api/fleet/${vehicle.id}/pool/undo`, {});
    expect(late.statusCode).toBe(409);
    expect(json<{ error: string }>(late).error).toBe('too_late');
    expect((await card(otherOwner, vehicle.id)).vehicle.pool).toBe('sale');
  });
});
