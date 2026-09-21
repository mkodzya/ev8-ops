// Repair jobs (SRV-01, SRV-02).
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

async function freeVehicle() {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Model ${uniq()}`, forRent: true } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TESTR${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id } });
  return { prisma, vehicle };
}

async function rentedVehicle() {
  const { prisma, vehicle } = await freeVehicle();
  const customer = await prisma.customer.create({ data: { name: `Renter ${uniq()}` } });
  const otherOwner = await loginAs('owner');
  const { id } = json<{ id: string }>(
    await call(otherOwner, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, pickedUpOn: '2026-09-01' }),
  );
  return { prisma, vehicle, customer, otherOwner, rentalId: id };
}

/**
 * Closing a repair says what the odometer read and where the moped stands
 * (B5-06, wave 5 crit. 26), so every closing here names a point.
 */
async function point(): Promise<string> {
  const { prisma } = await import('../src/lib/db.js');
  const row = await prisma.location.findFirst({ where: { archived: false }, select: { id: true } });
  return (row ?? (await prisma.location.create({ data: { name: `ТЕСТ point ${uniq()}` }, select: { id: true } }))).id;
}

const CLOSED = async () => ({ odometerKm: 1312, locationId: await point() });

describe.skipIf(!HAS_DB)('opening a repair', () => {
  it('takes a moped standing in the yard into service and gives it back on closing (SRV-01, FLT-03)', async () => {
    const { prisma, vehicle } = await freeVehicle();
    const otherOwner = await loginAs('owner');
    const opened = await call(otherOwner, 'POST', '/api/service', { vehicleId: vehicle.id, reason: 'brake pads', openedOn: '2026-09-10' });
    expect(opened.statusCode, opened.body).toBe(201);
    const { id, number } = json<{ id: string; number: string }>(opened);
    expect(number).toMatch(/^SV-\d{5}$/);

    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).state).toBe('service');
    // A moped in service cannot be handed over (FLT-03).
    const customer = await prisma.customer.create({ data: { name: `Nope ${uniq()}` } });
    const manager = await loginAs('manager');
    expect(
      (await call(manager, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000 })).statusCode,
    ).toBe(409);

    const closed = await call(otherOwner, 'POST', `/api/service/${id}/close`, { closedOn: '2026-09-12', ...(await CLOSED()) });
    expect(closed.statusCode, closed.body).toBe(200);
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).state).toBe('available');

    const card = json<{ events: { kind: string }[] }>(await call(otherOwner, 'GET', `/api/fleet/${vehicle.id}`));
    expect(card.events.map((e) => e.kind)).toEqual(['service_in', 'service_out']);
  });

  it('leaves a moped that is out with somebody where it is, and remembers the rental', async () => {
    const { prisma, vehicle, rentalId } = await rentedVehicle();
    const otherOwner = await loginAs('owner');
    const { id } = json<{ id: string }>(
      await call(otherOwner, 'POST', '/api/service', { vehicleId: vehicle.id, reason: 'flat tyre', payer: 'customer' }),
    );
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).state).toBe('rented');
    const { job } = json<{ job: { rental: { id: string }; payer: string; movedVehicle: boolean } }>(
      await call(otherOwner, 'GET', `/api/service/${id}`),
    );
    expect(job.rental.id).toBe(rentalId);
    expect(job.payer).toBe('customer');
    expect(job.movedVehicle).toBe(false);

    await call(otherOwner, 'POST', `/api/service/${id}/close`, await CLOSED());
    // Closing did not take it out of the rental, because opening did not.
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).state).toBe('rented');
  });

  it('refuses a second open job on one moped, and a sold one', async () => {
    const { prisma, vehicle } = await freeVehicle();
    const otherOwner = await loginAs('owner');
    await call(otherOwner, 'POST', '/api/service', { vehicleId: vehicle.id, reason: 'first' });
    const second = await call(otherOwner, 'POST', '/api/service', { vehicleId: vehicle.id, reason: 'second' });
    expect(second.statusCode).toBe(409);
    expect(json<{ error: string }>(second).error).toBe('job_already_open');

    const { vehicle: other } = await freeVehicle();
    await prisma.vehicle.update({ where: { id: other.id }, data: { state: 'sold' } });
    const sold = await call(otherOwner, 'POST', '/api/service', { vehicleId: other.id, reason: 'x' });
    expect(sold.statusCode).toBe(409);
    expect(json<{ error: string }>(sold).error).toBe('vehicle_gone');
  });

  it('a repair can only be charged to somebody who actually has the moped', async () => {
    const { vehicle } = await freeVehicle();
    const otherOwner = await loginAs('owner');
    const res = await call(otherOwner, 'POST', '/api/service', { vehicleId: vehicle.id, reason: 'x', payer: 'customer' });
    expect(res.statusCode).toBe(409);
    expect(json<{ error: string }>(res).error).toBe('no_renter');
  });

  it('a cancelled job gives the moped back and leaves a reason', async () => {
    const { prisma, vehicle } = await freeVehicle();
    const otherOwner = await loginAs('owner');
    const { id } = json<{ id: string }>(await call(otherOwner, 'POST', '/api/service', { vehicleId: vehicle.id, reason: 'noise' }));
    expect((await call(otherOwner, 'POST', `/api/service/${id}/cancel`, {})).statusCode).toBe(400);
    expect((await call(otherOwner, 'POST', `/api/service/${id}/cancel`, { reason: 'opened on the wrong VIN' })).statusCode).toBe(200);
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).state).toBe('available');
  });
});

describe.skipIf(!HAS_DB)('what a repair costs', () => {
  it('adds up parts and labour, and stops changing once the job is closed', async () => {
    const { vehicle } = await freeVehicle();
    const otherOwner = await loginAs('owner');
    const { id } = json<{ id: string }>(
      await call(otherOwner, 'POST', '/api/service', { vehicleId: vehicle.id, reason: 'service', labourTetri: '30' }),
    );
    await call(otherOwner, 'POST', `/api/service/${id}/parts`, { name: 'Brake pads', qty: 2, unitPriceTetri: '17.50' });
    await call(otherOwner, 'POST', `/api/service/${id}/parts`, { name: 'Cable', unitPriceTetri: '8' });

    const { job } = json<{ job: { partsTetri: number; labourTetri: number; totalTetri: number } }>(
      await call(otherOwner, 'GET', `/api/service/${id}`),
    );
    expect(job.labourTetri).toBe(3000);
    expect(job.partsTetri).toBe(2 * 1750 + 800);
    expect(job.totalTetri).toBe(3000 + 4300);

    await call(otherOwner, 'POST', `/api/service/${id}/close`, await CLOSED());
    const late = await call(otherOwner, 'POST', `/api/service/${id}/parts`, { name: 'Late', unitPriceTetri: '5' });
    expect(late.statusCode).toBe(409);
    expect(json<{ error: string }>(late).error).toBe('job_closed');
  });
});

describe.skipIf(!HAS_DB)('charging the renter (SRV-02)', () => {
  it('keeping part of the deposit shows on the deposit and on the job', async () => {
    const { vehicle, otherOwner, rentalId } = await rentedVehicle();
    // The renter paid the deposit and the first week.
    await call(otherOwner, 'POST', '/api/payments', { rentalId, channel: 'cash', grossTetri: 33000, occurredOn: '2026-09-01' });

    const { id } = json<{ id: string }>(
      await call(otherOwner, 'POST', '/api/service', { vehicleId: vehicle.id, reason: 'broken mirror', payer: 'customer', labourTetri: '20' }),
    );
    await call(otherOwner, 'POST', `/api/service/${id}/parts`, { name: 'Mirror', unitPriceTetri: '35' });

    const closed = await call(otherOwner, 'POST', `/api/service/${id}/close`, { withheldTetri: '55', ...(await CLOSED()) });
    expect(closed.statusCode, closed.body).toBe(200);
    expect(json<{ totalTetri: number; withheldTetri: number }>(closed)).toEqual({ ok: true, totalTetri: 5500, withheldTetri: 5500 });

    const card = json<{ deposit: { withheldTetri: number; withheldReason: string; status: string; withheldGrounds: string[] } }>(
      await call(otherOwner, 'GET', `/api/rentals/${rentalId}`),
    );
    expect(card.deposit.withheldTetri).toBe(5500);
    // A repair's keeping is a line on the deposit; the deposit itself is decided at the return (wave 3 §3.6).
    expect(card.deposit.status).toBe('held');
    expect(card.deposit.withheldGrounds).toContain('moped_damage');
    expect(card.deposit.withheldReason).toMatch(/SV-\d{5}: broken mirror/);

    const { job } = json<{ job: { withheldTetri: number; status: string } }>(await call(otherOwner, 'GET', `/api/service/${id}`));
    expect(job.withheldTetri).toBe(5500);
    expect(job.status).toBe('done');
  });

  it('cannot keep more than the repair cost, more than the deposit holds, or without the right to decide', async () => {
    const { vehicle, otherOwner, rentalId } = await rentedVehicle();
    await call(otherOwner, 'POST', '/api/payments', { rentalId, channel: 'cash', grossTetri: 33000, occurredOn: '2026-09-01' });
    const { id } = json<{ id: string }>(
      await call(otherOwner, 'POST', '/api/service', { vehicleId: vehicle.id, reason: 'dent', payer: 'customer', labourTetri: '40' }),
    );

    const overRepair = await call(otherOwner, 'POST', `/api/service/${id}/close`, { withheldTetri: '60', ...(await CLOSED()) });
    expect(json<{ error: string }>(overRepair).error).toBe('withheld_over_total');

    // A manager neither closes repairs nor decides deposits.
    const manager = await loginAs('manager');
    const notAllowed = await call(manager, 'POST', `/api/service/${id}/close`, { withheldTetri: '10', ...(await CLOSED()) });
    expect(notAllowed.statusCode).toBe(403);

    // A repair dearer than the deposit: only what the deposit holds can go.
    const big = await call(otherOwner, 'PATCH', `/api/service/${id}`, { labourTetri: '400' });
    expect(big.statusCode).toBe(200);
    const overDeposit = await call(otherOwner, 'POST', `/api/service/${id}/close`, { withheldTetri: '300', ...(await CLOSED()) });
    expect(json<{ error: string; freeTetri: number }>(overDeposit).error).toBe('deposit_too_small');
    expect(json<{ freeTetri: number }>(overDeposit).freeTetri).toBe(18000);

    // Closing without keeping anything still works; the charge stands elsewhere.
    expect((await call(otherOwner, 'POST', `/api/service/${id}/close`, await CLOSED())).statusCode).toBe(200);
  });
});

describe.skipIf(!HAS_DB)('who may do what', () => {
  it('a manager reports a breakdown and it waits as a draft; closing is an owner’s (wave 5 §3.7)', async () => {
    const { vehicle } = await freeVehicle();
    const manager = await loginAs('manager');
    const reported = await call(manager, 'POST', '/api/service', { vehicleId: vehicle.id, reason: 'ТЕСТ does not start' });
    expect(reported.statusCode, reported.body).toBe(201);
    const { id } = json<{ id: string }>(reported);
    const owner = await loginAs('owner');
    const card = json<{ job: { status: string } }>(await call(owner, 'GET', `/api/service/${id}`));
    expect(card.job.status).toBe('draft');
    // A manager may say what broke, and no more than that.
    expect((await call(manager, 'POST', `/api/service/${id}/close`, await CLOSED())).statusCode).toBe(403);
    expect((await call(manager, 'GET', '/api/service')).statusCode).toBe(200);
    // The owner picks it up and it is a repair.
    expect((await call(owner, 'PATCH', `/api/service/${id}`, { open: true })).statusCode).toBe(200);
    expect(json<{ job: { status: string } }>(await call(owner, 'GET', `/api/service/${id}`)).job.status).toBe('open');
  });
});
