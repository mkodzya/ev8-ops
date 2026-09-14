// A customer who pays ahead (PAY-06).
//
// "Переплата зачитывается в следующий период автоматически" — the money a
// customer paid beyond what was owed has to land on the next week by
// itself, not wait for somebody to notice it.
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

async function rentalPickedUp(pickedUpOn: string, rate = 14000) {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Model ${uniq()}`, forRent: true } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TESTC${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id } });
  const customer = await prisma.customer.create({ data: { name: `Ahead ${uniq()}` } });
  const director = await loginAs('director');
  const { id } = json<{ id: string }>(
    await call(director, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: rate, pickedUpOn }),
  );
  // The hand-over opens every week up to today; this suite is about weeks
  // that do not exist yet, so it starts from exactly one.
  await prisma.rentalPeriod.deleteMany({ where: { rentalId: id, seq: { gt: 1 } } });
  return { prisma, director, customer, rentalId: id };
}

function card(res: { body: string }) {
  return json<{
    rental: { paidThrough: string | null };
    deposit: { amountTetri: number; paidTetri: number } | null;
    periods: { seq: number; paidTetri: number; payStatus: string }[];
  }>(res);
}

describe.skipIf(!HAS_DB)('money paid ahead', () => {
  it('lands on the next week the moment that week exists', async () => {
    const { director, rentalId } = await rentalPickedUp('2026-09-01');
    // Deposit 180 + week one 140 + two weeks ahead 280.
    await call(director, 'POST', '/api/payments', { rentalId, channel: 'cash', grossTetri: 60000, occurredOn: '2026-09-01' });

    let c = card(await call(director, 'GET', `/api/rentals/${rentalId}`));
    expect(c.deposit).toMatchObject({ paidTetri: 18000 });
    expect(c.periods).toHaveLength(1);
    expect(c.rental.paidThrough).toBe('2026-09-07');

    const { rollPeriods } = await import('../src/lib/periods.js');
    const rolled = await rollPeriods('2026-09-15'); // three weeks exist by then
    expect(rolled.created).toBeGreaterThanOrEqual(2);
    expect(rolled.settledTetri).toBeGreaterThanOrEqual(28000);

    c = card(await call(director, 'GET', `/api/rentals/${rentalId}`));
    expect(c.periods.map((p) => p.payStatus)).toEqual(['paid', 'paid', 'paid']);
    expect(c.rental.paidThrough).toBe('2026-09-21');
  });

  it('places only what it has, and leaves the rest as credit', async () => {
    const { director, rentalId } = await rentalPickedUp('2026-09-01');
    await call(director, 'POST', '/api/payments', { rentalId, channel: 'cash', grossTetri: 39000, occurredOn: '2026-09-01' });
    // 180 deposit + 140 week one leaves 70 — half of the next week.
    const { rollPeriods } = await import('../src/lib/periods.js');
    await rollPeriods('2026-09-08');

    const c = card(await call(director, 'GET', `/api/rentals/${rentalId}`));
    expect(c.periods.map((p) => p.payStatus)).toEqual(['paid', 'partial']);
    expect(c.periods[1].paidTetri).toBe(7000);
    // A half-paid week does not move the date: the debt is that week.
    expect(c.rental.paidThrough).toBe('2026-09-07');
  });

  it('a payment made against the customer, with no rental named, still pays their rental', async () => {
    const { director, customer, rentalId } = await rentalPickedUp('2026-09-01');
    await call(director, 'POST', '/api/payments', { customerId: customer.id, channel: 'transfer', grossTetri: 60000, occurredOn: '2026-09-01' });
    const { rollPeriods } = await import('../src/lib/periods.js');
    await rollPeriods('2026-09-15');
    const c = card(await call(director, 'GET', `/api/rentals/${rentalId}`));
    expect(c.periods.map((p) => p.payStatus)).toEqual(['paid', 'paid', 'paid']);
  });

  it('voiding the payment takes the credit back out of the weeks it paid for', async () => {
    const { director, rentalId } = await rentalPickedUp('2026-09-01');
    const { id } = json<{ id: string }>(
      await call(director, 'POST', '/api/payments', { rentalId, channel: 'cash', grossTetri: 60000, occurredOn: '2026-09-01' }),
    );
    const { rollPeriods } = await import('../src/lib/periods.js');
    await rollPeriods('2026-09-15');
    expect((await call(director, 'POST', `/api/payments/${id}/void`, { reason: 'wrong rental' })).statusCode).toBe(200);

    const c = card(await call(director, 'GET', `/api/rentals/${rentalId}`));
    expect(c.periods.every((p) => p.payStatus === 'unpaid')).toBe(true);
    expect(c.deposit).toMatchObject({ paidTetri: 0 });
    expect(c.rental.paidThrough).toBeNull();
  });

  it('rolling twice changes nothing the second time', async () => {
    const { director, rentalId } = await rentalPickedUp('2026-09-01');
    await call(director, 'POST', '/api/payments', { rentalId, channel: 'cash', grossTetri: 60000, occurredOn: '2026-09-01' });
    const { rollPeriods } = await import('../src/lib/periods.js');
    await rollPeriods('2026-09-15');
    const again = await rollPeriods('2026-09-15');
    expect(again.created).toBe(0);
    expect(again.settledTetri).toBe(0);
    const c = card(await call(director, 'GET', `/api/rentals/${rentalId}`));
    expect(c.periods).toHaveLength(3);
  });
});

describe.skipIf(!HAS_DB)('the job the worker calls', () => {
  it('answers only to the worker token', async () => {
    const { getApp } = await import('./helpers.js');
    const app = await getApp();
    const wrong = await app.inject({ method: 'POST', url: '/api/jobs/roll-periods', headers: { 'x-worker-token': 'nope' } });
    expect(wrong.statusCode).toBe(401);
    const none = await app.inject({ method: 'POST', url: '/api/jobs/roll-periods' });
    expect(none.statusCode).toBe(401);
    const right = await app.inject({
      method: 'POST',
      url: '/api/jobs/roll-periods',
      headers: { 'x-worker-token': process.env.WORKER_TOKEN ?? 'dev-worker-token', 'content-type': 'application/json' },
      payload: { asOf: '2026-09-15' },
    });
    expect(right.statusCode).toBe(200);
    expect(json<{ rentals: number }>(right)).toHaveProperty('rentals');
  });
});
