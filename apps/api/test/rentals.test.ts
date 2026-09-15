// Hand-over and return, end to end through the API (RNT-01, RNT-04, RNT-05,
// FLT-03, CST-02). Needs a *_test database; the teardown removes everything.
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

async function fixtures() {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Model ${uniq()}`, weeklyRateTetri: 15000, forRent: true } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TEST${uniq().replace(/\D/g, '').slice(0, 13).padStart(13, '0')}`, modelId: model.id } });
  const customer = await prisma.customer.create({ data: { name: `Test Customer ${uniq()}`, phone: `+9955${uniq().replace(/\D/g, '').slice(-8)}` } });
  return { prisma, model, vehicle, customer };
}

describe.skipIf(!HAS_DB)('hand-over', () => {
  it('creates the rental, its first period, the deposit, the act, and moves the moped to rented — in one go', async () => {
    const { prisma, vehicle, customer } = await fixtures();
    const manager = await loginAs('manager');
    const res = await call(manager, 'POST', '/api/rentals', {
      customerId: customer.id,
      vehicleId: vehicle.id,
      weeklyRateTetri: '150',
      pickedUpOn: '2026-09-10',
      odometerKm: 120,
    });
    expect(res.statusCode, res.body).toBe(201);
    const { id, number, actId } = json<{ id: string; number: string; actId: string }>(res);
    expect(number).toMatch(/^R-\d{5}$/);
    expect(actId).toBeTruthy();

    const card = json<{ rental: { status: string; weeklyRateTetri: number; depositTetri: number }; periods: { seq: number; startsOn: string; endsOn: string }[]; deposit: { status: string; amountTetri: number }; acts: { kind: string }[] }>(
      await call(manager, 'GET', `/api/rentals/${id}`),
    );
    expect(card.rental.weeklyRateTetri).toBe(15000);
    expect(card.rental.depositTetri).toBe(18000);
    expect(card.periods[0]).toMatchObject({ seq: 1, startsOn: '2026-09-10', endsOn: '2026-09-16' });
    expect(card.deposit).toMatchObject({ status: 'held', amountTetri: 18000 });
    expect(card.acts.map((a) => a.kind)).toEqual(['pickup']);

    const v = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(v.state).toBe('rented');
    expect(v.currentRentalId).toBe(id);
    expect(v.odometerKm).toBe(120);
  });

  it('refuses a moped that is in service or sold (FLT-03)', async () => {
    const { prisma, vehicle, customer } = await fixtures();
    await prisma.vehicle.update({ where: { id: vehicle.id }, data: { state: 'service' } });
    const manager = await loginAs('manager');
    const res = await call(manager, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000 });
    expect(res.statusCode).toBe(409);
    expect(json<{ error: string }>(res).error).toBe('vehicle_not_available');
  });

  it('opens a rental without a VIN only with a note, and lists it as unconfirmed (RNT-06)', async () => {
    const { customer } = await fixtures();
    const manager = await loginAs('manager');
    const bare = await call(manager, 'POST', '/api/rentals', { customerId: customer.id, weeklyRateTetri: 14000 });
    expect(bare.statusCode).toBe(409);
    const ok = await call(manager, 'POST', '/api/rentals', { customerId: customer.id, weeklyRateTetri: 14000, vinNote: 'contract scan unreadable' });
    expect(ok.statusCode).toBe(201);
    const list = json<{ rentals: { id: string; vinUnconfirmed: boolean }[] }>(await call(manager, 'GET', '/api/rentals'));
    expect(list.rentals.find((r) => r.id === json<{ id: string }>(ok).id)?.vinUnconfirmed).toBe(true);
  });
});

describe.skipIf(!HAS_DB)('confirming a VIN later (RNT-06)', () => {
  it('hands the moped over as of today, so it never appears in two places at once', async () => {
    const { prisma, vehicle, customer } = await fixtures();
    const director = await loginAs('director');
    // This moped has a past: out with somebody else, and back.
    const earlier = await prisma.customer.create({ data: { name: `Earlier ${uniq()}` } });
    const first = json<{ id: string }>(
      await call(director, 'POST', '/api/rentals', { customerId: earlier.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, pickedUpOn: '2026-08-05' }),
    );
    await call(director, 'POST', `/api/rentals/${first.id}/return`, { returnedOn: '2026-08-26' });

    // A rental opened without a VIN, started BEFORE that return.
    const bare = json<{ id: string }>(
      await call(director, 'POST', '/api/rentals', { customerId: customer.id, weeklyRateTetri: 14000, pickedUpOn: '2026-08-25', vinNote: 'contract scan unreadable' }),
    );
    expect((await call(director, 'PATCH', `/api/rentals/${bare.id}`, { vehicleId: vehicle.id })).statusCode).toBe(200);

    const card = json<{ events: { kind: string; occurredOn: string }[] }>(await call(director, 'GET', `/api/fleet/${vehicle.id}`));
    // The fixture makes the moped directly, so there is no `arrived` event.
    const kinds = card.events.map((e) => e.kind);
    // The first hand-over also decides which park the moped is in (ADR-0005);
    // the second one finds it already decided and says nothing.
    expect(kinds).toEqual(['to_rent', 'pickup', 'return', 'pickup']);
    // The second hand-over is dated today, not back inside the first rental.
    expect(card.events[3].occurredOn > card.events[2].occurredOn).toBe(true);

    const v = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(v.state).toBe('rented');
    expect(v.currentRentalId).toBe(bare.id);
  });

  it('refuses a moped that is already out with somebody else', async () => {
    const { vehicle, customer } = await fixtures();
    const director = await loginAs('director');
    const other = await (await import('../src/lib/db.js')).prisma.customer.create({ data: { name: `Other ${uniq()}` } });
    await call(director, 'POST', '/api/rentals', { customerId: other.id, vehicleId: vehicle.id, weeklyRateTetri: 15000 });
    const bare = json<{ id: string }>(
      await call(director, 'POST', '/api/rentals', { customerId: customer.id, weeklyRateTetri: 14000, vinNote: 'unreadable' }),
    );
    const res = await call(director, 'PATCH', `/api/rentals/${bare.id}`, { vehicleId: vehicle.id });
    expect(res.statusCode).toBe(409);
    expect(json<{ error: string }>(res).error).toBe('vehicle_not_available');
  });
});

describe.skipIf(!HAS_DB)('return', () => {
  it('closes the rental, frees the moped, and a manager cannot decide on the deposit', async () => {
    const { prisma, vehicle, customer } = await fixtures();
    const manager = await loginAs('manager');
    const { id } = json<{ id: string }>(await call(manager, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, pickedUpOn: '2026-09-01' }));

    const refused = await call(manager, 'POST', `/api/rentals/${id}/return`, { returnedOn: '2026-09-12', deposit: { returnedTetri: 18000 } });
    expect(refused.statusCode).toBe(409);

    const ok = await call(manager, 'POST', `/api/rentals/${id}/return`, { returnedOn: '2026-09-12', odometerKm: 640 });
    expect(ok.statusCode, ok.body).toBe(200);
    const v = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(v.state).toBe('available');
    expect(v.currentRentalId).toBeNull();
    const card = json<{ rental: { status: string; returnedOn: string }; deposit: { status: string }; acts: { kind: string }[] }>(await call(manager, 'GET', `/api/rentals/${id}`));
    expect(card.rental).toMatchObject({ status: 'returned', returnedOn: '2026-09-12' });
    expect(card.deposit.status).toBe('held'); // waits for the director
    expect(card.acts.map((a) => a.kind)).toEqual(['pickup', 'return']);

    const again = await call(manager, 'POST', `/api/rentals/${id}/return`, { returnedOn: '2026-09-13' });
    expect(again.statusCode).toBe(409);
  });

  it('a director withholds part of the deposit with a reason; the owner confirms (RNT-05)', async () => {
    const { vehicle, customer } = await fixtures();
    const director = await loginAs('director');
    const { id } = json<{ id: string }>(await call(director, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, pickedUpOn: '2026-09-01' }));

    const noReason = await call(director, 'POST', `/api/rentals/${id}/return`, { returnedOn: '2026-09-12', deposit: { returnedTetri: 13000, withheldTetri: 5000 } });
    expect(noReason.statusCode).toBe(409);

    const ok = await call(director, 'POST', `/api/rentals/${id}/return`, {
      returnedOn: '2026-09-12',
      deposit: { returnedTetri: 13000, withheldTetri: 5000, withheldReason: 'broken mirror' },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const { prisma } = await import('../src/lib/db.js');
    let dep = await prisma.deposit.findUniqueOrThrow({ where: { rentalId: id } });
    expect(dep).toMatchObject({ status: 'partial', returnedTetri: 13000, withheldTetri: 5000, confirmedById: null });

    expect((await call(director, 'POST', `/api/rentals/${id}/deposit/confirm`)).statusCode).toBe(403);
    const owner = await loginAs('owner');
    expect((await call(owner, 'POST', `/api/rentals/${id}/deposit/confirm`)).statusCode).toBe(200);
    dep = await prisma.deposit.findUniqueOrThrow({ where: { rentalId: id } });
    expect(dep.confirmedById).not.toBeNull();
  });
});

describe.skipIf(!HAS_DB)('fleet by hand', () => {
  it('a manual move needs a reason, never targets rented, and is refused while a moped is out', async () => {
    const { vehicle, customer } = await fixtures();
    const mechanic = await loginAs('mechanic');
    expect((await call(mechanic, 'POST', `/api/fleet/${vehicle.id}/state`, { toState: 'service' })).statusCode).toBe(400);
    expect((await call(mechanic, 'POST', `/api/fleet/${vehicle.id}/state`, { toState: 'rented', reason: 'x' })).statusCode).toBe(409);
    const ok = await call(mechanic, 'POST', `/api/fleet/${vehicle.id}/state`, { toState: 'service', reason: 'flat tyre' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(json<{ from: string; to: string }>(ok)).toEqual({ from: 'available', to: 'service' });
    const back = await call(mechanic, 'POST', `/api/fleet/${vehicle.id}/state`, { toState: 'available', reason: 'fixed' });
    expect(back.statusCode).toBe(200);

    const manager = await loginAs('manager');
    await call(manager, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000 });
    const out = await call(mechanic, 'POST', `/api/fleet/${vehicle.id}/state`, { toState: 'service', reason: 'noise' });
    expect(out.statusCode).toBe(409);

    const card = json<{ events: { kind: string; toState: string; reason: string | null }[] }>(await call(mechanic, 'GET', `/api/fleet/${vehicle.id}`));
    // A park move repeats the state it found, because it changes no state.
    expect(card.events.map((e) => `${e.kind}:${e.toState}`)).toEqual(['manual:service', 'manual:available', 'to_rent:available', 'pickup:rented']);
  });
});

describe.skipIf(!HAS_DB)('customers', () => {
  it('refuses a second card with the same personal number, and names the existing one (CST-02)', async () => {
    const manager = await loginAs('manager');
    const pid = `T${uniq().replace(/\D/g, '')}`;
    const first = await call(manager, 'POST', '/api/customers', { name: 'One', personalId: pid, phone: `+99555${uniq().replace(/\D/g, '').slice(-7)}` });
    expect(first.statusCode, first.body).toBe(201);
    const second = await call(manager, 'POST', '/api/customers', { name: 'Two', personalId: pid });
    expect(second.statusCode).toBe(409);
    expect(json<{ existing: { id: string } }>(second).existing.id).toBe(json<{ id: string }>(first).id);
    // Even when forced past the phone check, the personal number stays unique.
    const forced = await call(manager, 'POST', '/api/customers', { name: 'Two', personalId: pid, force: true });
    expect(forced.statusCode).toBe(409);
  });
});
