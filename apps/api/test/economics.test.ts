// What one moped earned and cost (DSH-03).
import { describe, expect, it } from 'vitest';
import { HAS_DB, byHand, call, json, loginAs, uniq } from './helpers.js';

interface Row {
  id: string;
  vin: string;
  costTetri: number | null;
  rentalRevenueTetri: number;
  saleRevenueTetri: number;
  buyBackTetri: number;
  serviceCompanyTetri: number;
  serviceChargedTetri: number;
  marginTetri: number | null;
  idleDays: number;
  days: Record<string, number>;
}

async function moped(costTetri: number | null = 168929) {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Model ${uniq()}`, forRent: true } });
  const vehicle = await prisma.vehicle.create({
    data: { vin: `TESTE${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id, costTetri },
  });
  const customer = await prisma.customer.create({ data: { name: `Rider ${uniq()}` } });
  const otherOwner = await loginAs('owner');
  return { prisma, model, vehicle, customer, otherOwner };
}

const economics = async (cookie: string, id: string) =>
  json<{ economics: Row }>(await call(cookie, 'GET', `/api/fleet/${id}/economics`)).economics;

describe.skipIf(!HAS_DB)('what a moped earned', () => {
  it('counts rent that was actually paid, not rent that was billed', async () => {
    const { vehicle, customer, otherOwner } = await moped();
    const { id } = json<{ id: string }>(
      await call(otherOwner, 'POST', '/api/rentals', {
        customerId: customer.id,
        vehicleId: vehicle.id,
        weeklyRateTetri: 15000,
        depositTetri: 0,
        pickedUpOn: '2026-08-01',
      }),
    );
    // Three weeks stand open; two of them are paid.
    await call(otherOwner, 'POST', '/api/payments', { rentalId: id, channel: 'cash', grossTetri: '300', occurredOn: '2026-08-08' });
    const e = await economics(otherOwner, vehicle.id);
    expect(e.rentalRevenueTetri).toBe(30000);
    expect(e.marginTetri).toBe(30000 - 168929);
  });

  it('leaves the deposit out — it is the customer’s money, not income', async () => {
    const { vehicle, customer, otherOwner } = await moped();
    const { id } = json<{ id: string }>(
      await call(otherOwner, 'POST', '/api/rentals', {
        customerId: customer.id,
        vehicleId: vehicle.id,
        weeklyRateTetri: 15000,
        depositTetri: 18000,
        pickedUpOn: '2026-08-01',
      }),
    );
    await call(otherOwner, 'POST', '/api/payments', { rentalId: id, channel: 'cash', grossTetri: '330', occurredOn: '2026-08-01' });
    const e = await economics(otherOwner, vehicle.id);
    // 330 paid: 180 of deposit first, then 150 of the first week.
    expect(e.rentalRevenueTetri).toBe(15000);
  });

  it('forgets money that was voided', async () => {
    const { prisma, vehicle, customer, otherOwner } = await moped();
    const { id } = json<{ id: string }>(
      await call(otherOwner, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, depositTetri: 0, pickedUpOn: '2026-08-01' }),
    );
    const pay = json<{ id: string }>(await call(otherOwner, 'POST', '/api/payments', { rentalId: id, channel: 'cash', grossTetri: '150' }));
    expect((await economics(otherOwner, vehicle.id)).rentalRevenueTetri).toBe(15000);
    await call(otherOwner, 'POST', `/api/payments/${pay.id}/void`, { reason: 'entered twice' });
    expect((await economics(otherOwner, vehicle.id)).rentalRevenueTetri).toBe(0);
    expect(await prisma.payment.count({ where: { id: pay.id, voidedAt: { not: null } } })).toBe(1);
  });

  it('separates a repair the company paid from one the renter paid', async () => {
    const { vehicle, customer, otherOwner } = await moped();
    const { id } = json<{ id: string }>(
      await call(otherOwner, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, pickedUpOn: '2026-08-01' }),
    );
    expect(id).toBeTruthy();

    const opened = await call(otherOwner, 'POST', '/api/service', { vehicleId: vehicle.id, reason: 'brake pads', openedOn: '2026-08-02' });
    expect(opened.statusCode, opened.body).toBe(201);
    const ours = json<{ id: string }>(opened);
    await call(otherOwner, 'PATCH', `/api/service/${ours.id}`, { labourTetri: 4000 });
    await call(otherOwner, 'POST', `/api/service/${ours.id}/parts`, { name: 'pads', qty: 2, unitPriceTetri: 1500 });
    expect((await call(otherOwner, 'POST', `/api/service/${ours.id}/close`, { closedOn: '2026-08-03' })).statusCode).toBe(200);

    const second = await call(otherOwner, 'POST', '/api/service', { vehicleId: vehicle.id, reason: 'dropped it', openedOn: '2026-08-05' });
    expect(second.statusCode, second.body).toBe(201);
    const theirs = json<{ id: string }>(second);
    const charged = await call(otherOwner, 'PATCH', `/api/service/${theirs.id}`, { payer: 'customer', labourTetri: 9000 });
    expect(charged.statusCode, charged.body).toBe(200);

    const e = await economics(otherOwner, vehicle.id);
    expect(e.serviceCompanyTetri).toBe(7000); // 40 labour + 2 x 15 parts
    expect(e.serviceChargedTetri).toBe(9000);
    expect(e.marginTetri).toBe(-7000 - 168929); // only ours comes off the moped
  });

  it('counts a sale in and a buy-back out', async () => {
    const { vehicle, customer, otherOwner } = await moped(100000);
    const { id } = json<{ id: string }>(
      await call(otherOwner, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '2900', soldOn: '2026-05-19' }),
    );
    await byHand(otherOwner, `/api/sales/${id}/payments`, { channel: 'transfer', grossTetri: '2900', occurredOn: '2026-05-19' });
    await call(otherOwner, 'POST', `/api/sales/${id}/buy-back`, { amountTetri: '2440', occurredOn: '2026-06-03', channel: 'cash' });
    const e = await economics(otherOwner, vehicle.id);
    expect(e.saleRevenueTetri).toBe(290000);
    expect(e.buyBackTetri).toBe(244000);
    expect(e.marginTetri).toBe(290000 - 244000 - 100000);
  });

  it('says nothing about margin for a moped nobody priced', async () => {
    const { vehicle, otherOwner } = await moped(null);
    const e = await economics(otherOwner, vehicle.id);
    expect(e.costTetri).toBeNull();
    expect(e.marginTetri).toBeNull();
  });

  it('counts the days it stood idle against the days it was out', async () => {
    const { vehicle, customer, otherOwner } = await moped();
    const { id } = json<{ id: string }>(
      await call(otherOwner, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, pickedUpOn: '2026-08-01' }),
    );
    await call(otherOwner, 'POST', '/api/payments', { rentalId: id, channel: 'cash', grossTetri: '600' });
    await call(otherOwner, 'POST', `/api/rentals/${id}/return`, { returnedOn: '2026-08-15', odometerKm: 900 });
    const e = await economics(otherOwner, vehicle.id);
    expect(e.days.rented).toBe(14);
    expect(e.idleDays).toBeGreaterThan(0);
  });
});

describe.skipIf(!HAS_DB)('the fleet as a whole', () => {
  it('totals what is priced and says how many are not', async () => {
    const { vehicle, otherOwner } = await moped(null);
    const list = json<{ rows: Row[]; totals: { unpriced: number; vehicles: number; costTetri: number } }>(
      await call(otherOwner, 'GET', '/api/economics'),
    );
    expect(list.rows.some((r) => r.id === vehicle.id)).toBe(true);
    expect(list.totals.unpriced).toBeGreaterThanOrEqual(1);
    expect(list.totals.vehicles).toBe(list.rows.length);
  });

  it('is not for a manager to see', async () => {
    const manager = await loginAs('manager');
    expect((await call(manager, 'GET', '/api/economics')).statusCode).toBe(403);
    const owner = await loginAs('owner');
    expect((await call(owner, 'GET', '/api/economics')).statusCode).toBe(200);
  });
});

/**
 * Wave 6 §3.3, criterion 8. The move of "Экономика" into "Отчёты" must not
 * lose the note wave 5 put on a cost that is still moving: a moped out of a
 * shipment nobody has settled is quoted with "себестоимость предварительная",
 * and the economics answer is where the screen reads that from.
 */
describe.skipIf(!HAS_DB)('a cost that has not stopped moving', () => {
  it('is marked preliminary in the economics of the moped, with the share paid', async () => {
    const owner = await loginAs('owner');
    const supplier = json<{ id: string }>(await call(owner, 'POST', '/api/suppliers', { name: `ТЕСТ Factory ${uniq()}`, country: 'China', contact: 'Alibaba' }));
    const { prisma } = await import('../src/lib/db.js');
    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Prelim ${uniq()}` } });
    const made = await call(owner, 'POST', '/api/purchases', {
      supplierId: supplier.id,
      currency: 'CNY',
      orderedOn: '2026-09-01',
      lines: [{ modelId: model.id, qty: 1, unitPrice: '2600' }],
    });
    expect(made.statusCode, made.body).toBe(201);
    const id = json<{ id: string }>(made).id;

    // Part paid, then received: the cost on the moped is worked out at the
    // rate of that one payment and will be written again when the rest goes.
    await call(owner, 'POST', `/api/purchases/${id}/payments`, { grossTetri: '423.57', foreignAmount: '1000', channel: 'transfer' });
    const line = json<{ purchase: { lines: { id: string }[] } }>(await call(owner, 'GET', `/api/purchases/${id}`)).purchase.lines[0]!;
    const received = await call(owner, 'POST', `/api/purchases/${id}/receive`, {
      receivedOn: '2026-09-10',
      color: 'red',
      year: 2026,
      pool: 'rent',
      vins: { [line.id]: [`TESTP${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`] },
    });
    expect(received.statusCode, received.body).toBe(200);

    const vehicleId = json<{ vehicles: { id: string }[] }>(await call(owner, 'GET', `/api/purchases/${id}`)).vehicles[0]!.id;
    const econ = json<{ economics: { costPreliminary: boolean; costPaidPercent: number | null; utilisation: number | null } }>(
      await call(owner, 'GET', `/api/fleet/${vehicleId}/economics`),
    );
    expect(econ.economics.costPreliminary).toBe(true);
    // 1 000 CNY paid of an order of 2 600.
    expect(econ.economics.costPaidPercent).toBe(38);
    // And the moved screen carries M-10 for it as well (§3.3).
    expect(econ.economics.utilisation).toBe(0);
  });
});
