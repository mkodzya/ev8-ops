// Selling a moped (SAL-01, SAL-02, SAL-03).
import { describe, expect, it } from 'vitest';
import { HAS_DB, byHand, call, json, loginAs, uniq } from './helpers.js';

async function fixtures(price = 320600) {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Model ${uniq()}`, salePriceTetri: price } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TESTL${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id } });
  const customer = await prisma.customer.create({ data: { name: `Buyer ${uniq()}` } });
  const owner = await loginAs('owner');
  return { prisma, model, vehicle, customer, owner };
}

function saleCard(res: { body: string }) {
  return json<{
    sale: {
      priceTetri: number;
      paidTetri: number;
      outstandingTetri: number;
      overdueTetri: number;
      status: string;
      warrantyUntil: string | null;
      vehicle: { id: string } | null;
      instalments: { seq: number; dueOn: string; amountTetri: number; paidTetri: number; payStatus: string; overdue: boolean }[];
    };
    payments: { direction: string; grossTetri: number }[];
  }>(res);
}

describe.skipIf(!HAS_DB)('selling (SAL-01)', () => {
  it('takes the VIN out of the fleet and gives twelve months of warranty', async () => {
    const { prisma, vehicle, customer, owner } = await fixtures();
    const res = await call(owner, 'POST', '/api/sales', {
      customerId: customer.id,
      vehicleId: vehicle.id,
      priceTetri: '2900',
      soldOn: '2026-05-19',
      extras: 'second battery',
    });
    expect(res.statusCode, res.body).toBe(201);
    const { id, number } = json<{ id: string; number: string }>(res);
    expect(number).toMatch(/^SL-\d{5}$/);

    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).state).toBe('sold');
    const card = saleCard(await call(owner, 'GET', `/api/sales/${id}`));
    expect(card.sale.warrantyUntil).toBe('2027-05-19');
    // Paid in one go is one instalment, due the day of the sale.
    expect(card.sale.instalments).toHaveLength(1);
    expect(card.sale.instalments[0]).toMatchObject({ seq: 1, dueOn: '2026-05-19', amountTetri: 290000 });
    expect(card.sale.outstandingTetri).toBe(290000);

    const fleet = json<{ events: { kind: string }[] }>(await call(owner, 'GET', `/api/fleet/${vehicle.id}`));
    expect(fleet.events.map((e) => e.kind)).toContain('sold');
  });

  it('refuses a moped that is out with somebody, and one already sold', async () => {
    const { prisma, vehicle, customer, owner } = await fixtures();
    await prisma.vehicle.update({ where: { id: vehicle.id }, data: { state: 'rented' } });
    const rented = await call(owner, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '2900' });
    expect(rented.statusCode).toBe(409);
    expect(json<{ error: string }>(rented).error).toBe('vehicle_rented_sale');

    await prisma.vehicle.update({ where: { id: vehicle.id }, data: { state: 'available' } });
    expect((await call(owner, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '2900' })).statusCode).toBe(201);
    const twice = await call(owner, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '2900' });
    expect(twice.statusCode).toBe(409);
  });

  it('a manager does not sell', async () => {
    const { vehicle, customer } = await fixtures();
    const manager = await loginAs('manager');
    expect((await call(manager, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '2900' })).statusCode).toBe(403);
    expect((await call(manager, 'GET', '/api/sales')).statusCode).toBe(200);
  });
});

describe.skipIf(!HAS_DB)('the schedule (SAL-02)', () => {
  it('builds the real one and shows what is behind: 900 down, nine of 300', async () => {
    const { vehicle, customer, owner } = await fixtures();
    const { id } = json<{ id: string }>(
      await call(owner, 'POST', '/api/sales', {
        customerId: customer.id,
        vehicleId: vehicle.id,
        priceTetri: '3600',
        downPaymentTetri: '900',
        months: 9,
        soldOn: '2025-05-27',
      }),
    );
    let card = saleCard(await call(owner, 'GET', `/api/sales/${id}`));
    expect(card.sale.instalments).toHaveLength(10);
    expect(card.sale.instalments[0].amountTetri).toBe(90000);
    expect(card.sale.instalments.slice(1).every((i) => i.amountTetri === 30000)).toBe(true);

    // Only the down payment arrived. Every monthly instalment is long past
    // due, so 2 700 is behind — the figure the company knows.
    await byHand(owner, `/api/sales/${id}/payments`, { channel: 'transfer', grossTetri: '900', occurredOn: '2025-05-27' });
    card = saleCard(await call(owner, 'GET', `/api/sales/${id}`));
    expect(card.sale.paidTetri).toBe(90000);
    expect(card.sale.outstandingTetri).toBe(270000);
    expect(card.sale.overdueTetri).toBe(270000);
    expect(card.sale.instalments[0].payStatus).toBe('paid');
    expect(card.sale.instalments[1].overdue).toBe(true);

    const summary = json<{ salesOverdueTetri: number }>(await call(owner, 'GET', '/api/summary'));
    expect(summary.salesOverdueTetri).toBeGreaterThanOrEqual(270000);
  });

  it('a payment fills instalments from the oldest, part-paying the one it runs out on', async () => {
    const { vehicle, customer, owner } = await fixtures();
    const { id } = json<{ id: string }>(
      await call(owner, 'POST', '/api/sales', {
        customerId: customer.id,
        vehicleId: vehicle.id,
        priceTetri: '1200',
        months: 4,
        soldOn: '2026-01-10',
      }),
    );
    await call(owner, 'POST', `/api/sales/${id}/payments`, { channel: 'cash', grossTetri: '450' });
    const card = saleCard(await call(owner, 'GET', `/api/sales/${id}`));
    expect(card.sale.instalments.map((i) => i.payStatus)).toEqual(['paid', 'partial', 'unpaid', 'unpaid']);
    expect(card.sale.instalments[1].paidTetri).toBe(15000);
  });

  it('counts a sale on the customer’s balance and takes it off when the payment is voided', async () => {
    const { vehicle, customer, owner } = await fixtures();
    const { id } = json<{ id: string }>(
      await call(owner, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '1000', months: 2, soldOn: '2026-01-10' }),
    );
    // Both instalments fell due in February and March: all of it is owed now (B7-02).
    let balance = json<{ owesTetri: number }>(await call(owner, 'GET', `/api/customers/${customer.id}/balance`));
    expect(balance.owesTetri).toBe(100000);

    const paid = json<{ id: string }>(await call(owner, 'POST', `/api/sales/${id}/payments`, { channel: 'cash', grossTetri: '1000' }));
    balance = json<{ owesTetri: number }>(await call(owner, 'GET', `/api/customers/${customer.id}/balance`));
    expect(balance.owesTetri).toBe(0);

    expect((await call(owner, 'POST', `/api/payments/${paid.id}/void`, { reason: 'wrong sale' })).statusCode).toBe(200);
    const card = saleCard(await call(owner, 'GET', `/api/sales/${id}`));
    expect(card.sale.paidTetri).toBe(0);
    expect(card.sale.instalments.every((i) => i.payStatus === 'unpaid')).toBe(true);
  });
});

describe.skipIf(!HAS_DB)('buying it back (SAL-03)', () => {
  it('money goes out, the VIN comes back, and the history holds both events', async () => {
    const { prisma, vehicle, customer, owner } = await fixtures();
    const { id } = json<{ id: string }>(
      await call(owner, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '2900', soldOn: '2026-05-19' }),
    );
    const back = await call(owner, 'POST', `/api/sales/${id}/buy-back`, { amountTetri: '2440', occurredOn: '2026-06-03', channel: 'cash' });
    expect(back.statusCode, back.body).toBe(200);

    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).state).toBe('available');
    const card = saleCard(await call(owner, 'GET', `/api/sales/${id}`));
    expect(card.sale.status).toBe('bought_back');
    expect(card.payments).toEqual([{ direction: 'out', grossTetri: 244000, occurredOn: '2026-06-03', channel: 'cash', id: expect.any(String) }]);

    const fleet = json<{ events: { kind: string; occurredOn: string }[] }>(await call(owner, 'GET', `/api/fleet/${vehicle.id}`));
    const kinds = fleet.events.map((e) => e.kind);
    expect(kinds).toContain('sold');
    expect(kinds).toContain('bought_back');
    expect(kinds.indexOf('sold')).toBeLessThan(kinds.indexOf('bought_back'));
  });

  it('can bring it back needing work instead of straight into the fleet', async () => {
    const { prisma, vehicle, customer, owner } = await fixtures();
    const { id } = json<{ id: string }>(
      await call(owner, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '2900', soldOn: '2026-05-19' }),
    );
    await call(owner, 'POST', `/api/sales/${id}/buy-back`, { amountTetri: '2000', occurredOn: '2026-06-03', toState: 'service' });
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).state).toBe('service');
  });

  it('refuses a buy-back dated before the sale, and a second one', async () => {
    const { vehicle, customer, owner } = await fixtures();
    const { id } = json<{ id: string }>(
      await call(owner, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '2900', soldOn: '2026-05-19' }),
    );
    const early = await call(owner, 'POST', `/api/sales/${id}/buy-back`, { amountTetri: '100', occurredOn: '2026-05-01' });
    expect(json<{ error: string }>(early).error).toBe('before_sale');
    expect((await call(owner, 'POST', `/api/sales/${id}/buy-back`, { amountTetri: '100', occurredOn: '2026-06-01' })).statusCode).toBe(200);
    expect((await call(owner, 'POST', `/api/sales/${id}/buy-back`, { amountTetri: '100', occurredOn: '2026-06-02' })).statusCode).toBe(409);
  });
});

describe.skipIf(!HAS_DB)('a sale entered by mistake', () => {
  it('is cancelled with a reason and gives the VIN back, but not while money hangs on it', async () => {
    const { prisma, vehicle, customer, owner } = await fixtures();
    const { id } = json<{ id: string }>(
      await call(owner, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '2900' }),
    );
    await call(owner, 'POST', `/api/sales/${id}/payments`, { channel: 'cash', grossTetri: '100' });
    const held = await call(owner, 'POST', `/api/sales/${id}/cancel`, { reason: 'wrong VIN' });
    expect(held.statusCode).toBe(409);
    expect(json<{ error: string }>(held).error).toBe('sale_has_payments');

    const { prisma: db } = await import('../src/lib/db.js');
    const payment = await db.payment.findFirstOrThrow({ where: { saleId: id } });
    await call(owner, 'POST', `/api/payments/${payment.id}/void`, { reason: 'wrong sale' });

    expect((await call(owner, 'POST', `/api/sales/${id}/cancel`, {})).statusCode).toBe(400);
    expect((await call(owner, 'POST', `/api/sales/${id}/cancel`, { reason: 'wrong VIN' })).statusCode).toBe(200);
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).state).toBe('available');
  });
});
