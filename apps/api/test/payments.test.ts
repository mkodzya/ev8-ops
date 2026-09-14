// Money in, end to end (PAY-02, PAY-04, PAY-05, PAY-06). The figures are the
// ones the company actually sees: 320 by card credited as 315.20, a weekly
// tariff of 140 and a deposit of 180.
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

async function activeRental(weeklyRateTetri = 14000, pickedUpOn = '2026-09-01') {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Model ${uniq()}`, forRent: true } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TESTP${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id } });
  const customer = await prisma.customer.create({ data: { name: `Payer ${uniq()}` } });
  const director = await loginAs('director');
  const { id } = json<{ id: string }>(
    await call(director, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri, pickedUpOn }),
  );
  return { prisma, director, customer, rentalId: id };
}

function card(res: { body: string }) {
  return json<{
    rental: { paidThrough: string | null };
    deposit: { amountTetri: number; paidTetri: number } | null;
    periods: { seq: number; amountTetri: number; paidTetri: number; payStatus: string }[];
  }>(res);
}

describe.skipIf(!HAS_DB)('recording a payment', () => {
  it('320 by card closes the 180 deposit and the first week, and leaves no 4.80 debt (PAY-04)', async () => {
    const { director, rentalId } = await activeRental();
    const res = await call(director, 'POST', '/api/payments', {
      rentalId,
      channel: 'acquiring',
      grossTetri: 32000,
      occurredOn: '2026-09-01',
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(json<{ allocated: number; leftover: number }>(res)).toEqual({ id: expect.any(String), allocated: 32000, leftover: 0 });

    const { prisma } = await import('../src/lib/db.js');
    const p = await prisma.payment.findFirstOrThrow({ where: { rentalId } });
    expect(p.grossTetri).toBe(32000);
    expect(p.feeTetri).toBe(480); // the acquirer's 1.5 %, a company expense
    expect(p.netTetri).toBe(31520); // what the bank credits

    const c = card(await call(director, 'GET', `/api/rentals/${rentalId}`));
    expect(c.deposit).toMatchObject({ amountTetri: 18000, paidTetri: 18000 });
    expect(c.periods[0]).toMatchObject({ seq: 1, paidTetri: 14000, payStatus: 'paid' });
    expect(c.rental.paidThrough).toBe('2026-09-07');
  });

  it('recovers the gross from the net a statement shows, and refuses a net no gross produces', async () => {
    const { director, rentalId } = await activeRental();
    const ok = await call(director, 'POST', '/api/payments', { rentalId, channel: 'acquiring', netTetri: 31520 });
    expect(ok.statusCode, ok.body).toBe(201);
    const { prisma } = await import('../src/lib/db.js');
    const p = await prisma.payment.findFirstOrThrow({ where: { rentalId } });
    expect(p.grossTetri).toBe(32000);
    expect(p.feeTetri).toBe(480);
  });

  it('cash and transfers carry no fee, and the gross is what arrives', async () => {
    const { director, rentalId } = await activeRental();
    await call(director, 'POST', '/api/payments', { rentalId, channel: 'cash', grossTetri: 18000 });
    const { prisma } = await import('../src/lib/db.js');
    const p = await prisma.payment.findFirstOrThrow({ where: { rentalId } });
    expect(p.feeTetri).toBe(0);
    expect(p.netTetri).toBe(18000);
  });

  it('pays weeks from the oldest and moves "paid through" one week at a time (PAY-02, RNT-02)', async () => {
    // Picked up on 1 September. The hand-over creates every week up to
    // today, so the suite tops the rental up to exactly three — otherwise
    // this test would say something different each week it is run.
    const { director, rentalId, prisma } = await activeRental(14000, '2026-09-01');
    for (let seq = 1; seq <= 3; seq++) {
      const startsOn = new Date(Date.UTC(2026, 8, 1 + 7 * (seq - 1)));
      const endsOn = new Date(Date.UTC(2026, 8, 7 + 7 * (seq - 1)));
      await prisma.rentalPeriod.upsert({
        where: { rentalId_seq: { rentalId, seq } },
        update: {},
        create: { rentalId, seq, startsOn, endsOn, amountTetri: 14000 },
      });
    }
    await prisma.rentalPeriod.deleteMany({ where: { rentalId, seq: { gt: 3 } } });

    await call(director, 'POST', '/api/payments', { rentalId, channel: 'cash', grossTetri: 18000 }); // deposit only
    let c = card(await call(director, 'GET', `/api/rentals/${rentalId}`));
    expect(c.rental.paidThrough).toBeNull();

    await call(director, 'POST', '/api/payments', { rentalId, channel: 'cash', grossTetri: 14000 });
    c = card(await call(director, 'GET', `/api/rentals/${rentalId}`));
    expect(c.rental.paidThrough).toBe('2026-09-07');

    await call(director, 'POST', '/api/payments', { rentalId, channel: 'cash', grossTetri: 21000 }); // a week and a half
    c = card(await call(director, 'GET', `/api/rentals/${rentalId}`));
    expect(c.periods.map((p) => p.payStatus)).toEqual(['paid', 'paid', 'partial']);
    // A half-paid week does not move the date: the debt is that week.
    expect(c.rental.paidThrough).toBe('2026-09-14');
  });

  it('keeps what it cannot place as the customer’s credit (PAY-06)', async () => {
    const { director, rentalId, customer } = await activeRental();
    // How many weeks the hand-over opened depends on the day this runs, so
    // what is owed is read rather than assumed.
    const before = card(await call(director, 'GET', `/api/rentals/${rentalId}`));
    const owed = 18000 + before.periods.reduce((n, p) => n + p.amountTetri, 0);

    const res = await call(director, 'POST', '/api/payments', { rentalId, channel: 'cash', grossTetri: owed + 4000 });
    expect(json<{ leftover: number }>(res).leftover).toBe(4000);
    const balance = json<{ outstandingTetri: number; creditTetri: number; depositHeldTetri: number }>(
      await call(director, 'GET', `/api/customers/${customer.id}/balance`),
    );
    expect(balance.outstandingTetri).toBe(0);
    expect(balance.creditTetri).toBe(4000);
    expect(balance.depositHeldTetri).toBe(18000);
  });
});

describe.skipIf(!HAS_DB)('who may enter what', () => {
  it('a manager takes cash but does not enter bank payments (PAY-05, §3)', async () => {
    const { rentalId } = await activeRental();
    const manager = await loginAs('manager');
    expect((await call(manager, 'POST', '/api/payments', { rentalId, channel: 'cash', grossTetri: 14000 })).statusCode).toBe(201);
    const bank = await call(manager, 'POST', '/api/payments', { rentalId, channel: 'transfer', grossTetri: 14000 });
    expect(bank.statusCode).toBe(403);
    expect(json<{ error: string }>(bank).error).toBe('reconcile_required');
  });

  it('a mechanic touches no money at all', async () => {
    const { rentalId } = await activeRental();
    const mechanic = await loginAs('mechanic');
    expect((await call(mechanic, 'POST', '/api/payments', { rentalId, channel: 'cash', grossTetri: 100 })).statusCode).toBe(403);
  });
});

describe.skipIf(!HAS_DB)('voiding a payment', () => {
  it('needs a reason, keeps the row, and puts the rental back where it was', async () => {
    const { director, rentalId } = await activeRental();
    const { id } = json<{ id: string }>(
      await call(director, 'POST', '/api/payments', { rentalId, channel: 'cash', grossTetri: 32000 }),
    );
    let c = card(await call(director, 'GET', `/api/rentals/${rentalId}`));
    expect(c.rental.paidThrough).toBe('2026-09-07');

    expect((await call(director, 'POST', `/api/payments/${id}/void`, {})).statusCode).toBe(400);
    const manager = await loginAs('manager');
    expect((await call(manager, 'POST', `/api/payments/${id}/void`, { reason: 'oops' })).statusCode).toBe(403);

    expect((await call(director, 'POST', `/api/payments/${id}/void`, { reason: 'entered twice' })).statusCode).toBe(200);
    c = card(await call(director, 'GET', `/api/rentals/${rentalId}`));
    expect(c.rental.paidThrough).toBeNull();
    expect(c.deposit).toMatchObject({ paidTetri: 0 });
    expect(c.periods[0]).toMatchObject({ paidTetri: 0, payStatus: 'unpaid' });

    const { prisma } = await import('../src/lib/db.js');
    const p = await prisma.payment.findUniqueOrThrow({ where: { id } });
    expect(p.voidedAt).not.toBeNull();
    expect(p.voidReason).toBe('entered twice');
    expect(await prisma.paymentAllocation.count({ where: { paymentId: id } })).toBe(0);
    expect((await call(director, 'POST', `/api/payments/${id}/void`, { reason: 'again' })).statusCode).toBe(409);
  });
});
