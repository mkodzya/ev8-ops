// A lower mileage only with its reason (stage 6; ADR-0038 §4): at the
// opening and the hand-over it already was; now at the closing of a repair
// and at the return of a rental too. A typo there would move the planned
// maintenance with nobody saying why. Mopeds, people and photos are invented.
import { todayISO } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, login, loginAs, makeUser, uniq } from './helpers.js';

const PHOTO = { mimeType: 'image/jpeg', dataBase64: Buffer.from(`test photo ${uniq()}`).toString('base64') };
const digits = () => uniq().replace(/\D/g, '');
const err = (res: { body: string }) => json<{ error: string; field?: string; lastKm?: number }>(res);

async function moped(odometerKm: number | null) {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Km ${uniq()}`, weeklyRateTetri: 15000, forRent: true } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TESTKM${digits().slice(-11).padStart(11, '0')}`, modelId: model.id, pool: 'rent', odometerKm } });
  return { prisma, vehicle };
}

async function point(): Promise<string> {
  const { prisma } = await import('../src/lib/db.js');
  const row = await prisma.location.findFirst({ where: { archived: false }, select: { id: true } });
  return (row ?? (await prisma.location.create({ data: { name: `ТЕСТ point ${uniq()}` }, select: { id: true } }))).id;
}

/** A chief mechanic opens it in work at once, so it closes without an approval step. */
async function openedInWork(vehicleId: string, odometerKm: number) {
  const { importWorkBook } = await import('../src/lib/workBook.js');
  await importWorkBook();
  const owner = await loginAs('owner');
  const made = await call(owner, 'POST', '/api/work-book/works', { category: 'OT', nameRu: `Тестовая работа ${uniq()}`, normMin: 30 });
  expect(made.statusCode, made.body).toBe(201);
  const u = await makeUser('chief_mechanic');
  const chief = await login(u.email);
  const res = await call(chief, 'POST', '/api/service/workshop', {
    vehicleId, reasonKind: 'wear', reason: 'test', odometerKm, odometerPhoto: PHOTO, photos: [PHOTO], works: [{ workTypeId: json<{ id: string }>(made).id, qty: 1 }],
  });
  expect(res.statusCode, res.body).toBe(201);
  return { chief, owner, id: json<{ id: string; status: string }>(res).id };
}

describe.skipIf(!HAS_DB)('a lower reading at the closing of a repair (ADR-0038 §4)', () => {
  it('below the opening’s asks why, keeps the reason and lets the moped’s reading go down with it', async () => {
    const { prisma, vehicle } = await moped(4812);
    const { chief, id } = await openedInWork(vehicle.id, 5230);
    const where = await point();

    const refused = await call(chief, 'POST', `/api/service/${id}/close`, { odometerKm: 5200, locationId: where, photos: [PHOTO] });
    expect(refused.statusCode, refused.body).toBe(400);
    expect(err(refused)).toMatchObject({ error: 'odometer_below', field: 'odometerReason', lastKm: 5230 });
    // Refused means nothing was written: the repair is still in work.
    expect((await prisma.serviceJob.findUniqueOrThrow({ where: { id } })).status).toBe('open');

    const closed = await call(chief, 'POST', `/api/service/${id}/close`, { odometerKm: 5200, odometerReason: 'The last one was written wrong', locationId: where, photos: [PHOTO] });
    expect(closed.statusCode, closed.body).toBe(200);
    const job = await prisma.serviceJob.findUniqueOrThrow({ where: { id } });
    expect(job).toMatchObject({ status: 'done', odometerKm: 5200, closedOdometerReason: 'The last one was written wrong' });
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).odometerKm).toBe(5200);
    const seen = json<{ job: { closedOdometerReason: string | null; vehicle: { odometerKm: number | null } } }>(await call(chief, 'GET', `/api/service/${id}`)).job;
    expect(seen.closedOdometerReason).toBe('The last one was written wrong');
    expect(seen.vehicle.odometerKm).toBe(5200);
    const entry = await prisma.auditLog.findFirst({ where: { action: 'service.close', entityId: id } });
    expect(entry?.after).toMatchObject({ odometerKm: 5200, odometerReason: 'The last one was written wrong' });
  });

  it('below the moped’s last reading asks why too, even when the opening had none', async () => {
    const { vehicle } = await moped(9000);
    const owner = await loginAs('owner');
    const opened = await call(owner, 'POST', '/api/service', { vehicleId: vehicle.id, reason: 'ТЕСТ' });
    expect(opened.statusCode, opened.body).toBe(201);
    const { id } = json<{ id: string }>(opened);
    const refused = await call(owner, 'POST', `/api/service/${id}/close`, { odometerKm: 8000, locationId: await point() });
    expect(err(refused)).toMatchObject({ error: 'odometer_below', field: 'odometerReason', lastKm: 9000 });
    // Spaces are no reason.
    expect(err(await call(owner, 'POST', `/api/service/${id}/close`, { odometerKm: 8000, odometerReason: '   ', locationId: await point() })).error).toBe('odometer_below');
    expect((await call(owner, 'POST', `/api/service/${id}/close`, { odometerKm: 8000, odometerReason: 'The odometer was replaced', locationId: await point() })).statusCode).toBe(200);
  });

  it('at or above the last reading needs none, and a reason sent anyway is not kept', async () => {
    const { prisma, vehicle } = await moped(null);
    const { chief, id } = await openedInWork(vehicle.id, 300);
    const closed = await call(chief, 'POST', `/api/service/${id}/close`, { odometerKm: 300, odometerReason: 'nothing to explain', locationId: await point(), photos: [PHOTO] });
    expect(closed.statusCode, closed.body).toBe(200);
    expect((await prisma.serviceJob.findUniqueOrThrow({ where: { id } })).closedOdometerReason).toBeNull();
  });
});

describe.skipIf(!HAS_DB)('a lower reading at the return of a rental (ADR-0038 §4)', () => {
  const items = { moped: { state: 'ok' }, key: { state: 'ok' }, battery_1: { state: 'ok' }, battery_2: { state: 'ok' }, charger_1: { state: 'ok' }, charger_2: { state: 'ok' } };

  it('below the moped’s last reading asks why; below the hand-over’s is still refused', async () => {
    const { prisma, vehicle } = await moped(null);
    const customer = await prisma.customer.create({ data: { name: `ТЕСТ Пробег ${uniq()}`, phone: `+9955${digits().slice(-8)}`, personalId: digits().slice(-11) } });
    const owner = await loginAs('owner');
    const res = await call(owner, 'POST', '/api/pickups', {
      customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, depositTetri: 18000, pickedUpOn: todayISO(),
      nightParkingAddress: 'Test street 1', batteries: 2, chargers: 2, odometerKm: 100, payment: { later: true },
    });
    expect(res.statusCode, res.body).toBe(201);
    const { id } = json<{ id: string }>(res);
    // A repair during the rental read it higher than the hand-over did.
    await prisma.vehicle.update({ where: { id: vehicle.id }, data: { odometerKm: 150 } });

    const preview = json<{ pickupKm: number | null; vehicleKm: number | null }>(await call(owner, 'POST', `/api/rentals/${id}/return/preview`, { returnedOn: todayISO() }));
    expect(preview).toMatchObject({ pickupKm: 100, vehicleKm: 150 });

    const manager = await loginAs('manager');
    expect(err(await call(manager, 'POST', `/api/rentals/${id}/return`, { odometerKm: 90, items })).error).toBe('odometer_below_pickup');
    const lower = await call(manager, 'POST', `/api/rentals/${id}/return`, { odometerKm: 120, items });
    expect(lower.statusCode, lower.body).toBe(400);
    expect(err(lower)).toMatchObject({ error: 'odometer_below', field: 'odometerReason', lastKm: 150 });
    // Refused means nothing was written: the rental still runs.
    expect((await prisma.rental.findUniqueOrThrow({ where: { id } })).status).not.toBe('returned');

    const back = await call(manager, 'POST', `/api/rentals/${id}/return`, { odometerKm: 120, odometerReason: 'The last one was written wrong', items });
    expect(back.statusCode, back.body).toBe(200);
    const act = await prisma.act.findFirstOrThrow({ where: { rentalId: id, kind: 'return' } });
    expect(act).toMatchObject({ odometerKm: 120, odometerReason: 'The last one was written wrong' });
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).odometerKm).toBe(120);
  });

  it('a return taken back leaves no figure behind to explain: the next return is checked against what stood before', async () => {
    const { prisma, vehicle } = await moped(null);
    const customer = await prisma.customer.create({ data: { name: `ТЕСТ Пробег ${uniq()}`, phone: `+9955${digits().slice(-8)}`, personalId: digits().slice(-11) } });
    const owner = await loginAs('owner');
    const res = await call(owner, 'POST', '/api/pickups', {
      customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, depositTetri: 18000, pickedUpOn: todayISO(),
      nightParkingAddress: 'Test street 1', batteries: 2, chargers: 2, odometerKm: 5000, payment: { later: true },
    });
    expect(res.statusCode, res.body).toBe(201);
    const { id } = json<{ id: string }>(res);
    // 51 000 typed for 5 100, and the return taken back.
    expect((await call(owner, 'POST', `/api/rentals/${id}/return`, { odometerKm: 51_000, items })).statusCode).toBe(200);
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).odometerKm).toBe(51_000);
    const undone = await call(owner, 'POST', `/api/rentals/${id}/return/undo`, { reason: 'ТЕСТ typo in the mileage' });
    expect(undone.statusCode, undone.body).toBe(200);
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).odometerKm).toBe(5000);
    const again = await call(await loginAs('manager'), 'POST', `/api/rentals/${id}/return`, { odometerKm: 5100, items });
    expect(again.statusCode, again.body).toBe(200);
  });

  it('a figure written since the return is left as it is when the return is taken back', async () => {
    const { prisma, vehicle } = await moped(null);
    const customer = await prisma.customer.create({ data: { name: `ТЕСТ Пробег ${uniq()}`, phone: `+9955${digits().slice(-8)}`, personalId: digits().slice(-11) } });
    const owner = await loginAs('owner');
    const res = await call(owner, 'POST', '/api/pickups', {
      customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, depositTetri: 18000, pickedUpOn: todayISO(),
      nightParkingAddress: 'Test street 1', batteries: 2, chargers: 2, odometerKm: 200, payment: { later: true },
    });
    const { id } = json<{ id: string }>(res);
    expect((await call(owner, 'POST', `/api/rentals/${id}/return`, { odometerKm: 300, items })).statusCode).toBe(200);
    // Something else read the moped after the return.
    await prisma.vehicle.update({ where: { id: vehicle.id }, data: { odometerKm: 320 } });
    expect((await call(owner, 'POST', `/api/rentals/${id}/return/undo`, { reason: 'ТЕСТ returned by mistake' })).statusCode).toBe(200);
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).odometerKm).toBe(320);
  });

  it('at the moped’s reading or above needs no reason and keeps none', async () => {
    const { prisma, vehicle } = await moped(null);
    const customer = await prisma.customer.create({ data: { name: `ТЕСТ Пробег ${uniq()}`, phone: `+9955${digits().slice(-8)}`, personalId: digits().slice(-11) } });
    const owner = await loginAs('owner');
    const res = await call(owner, 'POST', '/api/pickups', {
      customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, depositTetri: 18000, pickedUpOn: todayISO(),
      nightParkingAddress: 'Test street 1', batteries: 2, chargers: 2, odometerKm: 100, payment: { later: true },
    });
    const { id } = json<{ id: string }>(res);
    const back = await call(owner, 'POST', `/api/rentals/${id}/return`, { odometerKm: 100, odometerReason: 'nothing to explain', items });
    expect(back.statusCode, back.body).toBe(200);
    expect((await prisma.act.findFirstOrThrow({ where: { rentalId: id, kind: 'return' } })).odometerReason).toBeNull();
  });
});
