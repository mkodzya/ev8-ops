// The planned maintenance on live rows (stage 6; ADR-0038 §1–3): only the
// mileage EV8 Ops recorded counts, a closed planned repair moves the mark, a
// refused or called-off one does not, a return taken back is no reading.
// The suites share one database, so «Пора на ТО» is read for this file's own
// mopeds only. Mopeds, people and photos are invented.
import { todayISO } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, login, loginAs, makeUser, uniq } from './helpers.js';

const PHOTO = { mimeType: 'image/jpeg', dataBase64: Buffer.from(`test photo ${uniq()}`).toString('base64') };
const digits = () => uniq().replace(/\D/g, '');

interface Maintenance {
  vehicleId: string;
  state: string;
  currentKm: number | null;
  currentAt: string | null;
  readingSource: string | null;
  dueKm: number | null;
  leftKm: number | null;
  lastPlanned: { jobId: string; number: string; km: number; closedOn: string | null } | null;
  openPlanned: { jobId: string; number: string; status: string } | null;
}
interface Overview {
  intervalKm: number;
  warnKm: number;
  due: Maintenance[];
  unknownCount: number;
  knownCount: number;
}

async function moped(odometerKm: number | null = null) {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `TO ${uniq()}`, weeklyRateTetri: 15000, forRent: true } });
  return prisma.vehicle.create({ data: { vin: `TESTTO${digits().slice(-11).padStart(11, '0')}`, modelId: model.id, pool: 'rent', odometerKm } });
}

async function card(cookie: string, vehicleId: string): Promise<Maintenance | null> {
  const res = await call(cookie, 'GET', `/api/fleet/${vehicleId}`);
  expect(res.statusCode, res.body).toBe(200);
  return json<{ maintenance: Maintenance | null }>(res).maintenance;
}

async function overview(cookie: string): Promise<Overview> {
  const res = await call(cookie, 'GET', '/api/service/maintenance');
  expect(res.statusCode, res.body).toBe(200);
  return json<Overview>(res);
}

async function pickedUp(vehicleId: string, odometerKm: number) {
  const { prisma } = await import('../src/lib/db.js');
  const customer = await prisma.customer.create({ data: { name: `ТЕСТ ТО ${uniq()}`, phone: `+9955${digits().slice(-8)}`, personalId: digits().slice(-11) } });
  const owner = await loginAs('owner');
  const res = await call(owner, 'POST', '/api/pickups', {
    customerId: customer.id, vehicleId, weeklyRateTetri: 15000, depositTetri: 18000, pickedUpOn: todayISO(),
    nightParkingAddress: 'Test street 1', batteries: 2, chargers: 2, odometerKm, payment: { later: true },
  });
  expect(res.statusCode, res.body).toBe(201);
  return { owner, rentalId: json<{ id: string }>(res).id };
}

const ITEMS = { moped: { state: 'ok' }, key: { state: 'ok' }, battery_1: { state: 'ok' }, battery_2: { state: 'ok' }, charger_1: { state: 'ok' }, charger_2: { state: 'ok' } };

/** A planned repair the chief mechanic opens in work at once. */
async function planned(vehicleId: string, odometerKm: number) {
  const { importWorkBook } = await import('../src/lib/workBook.js');
  await importWorkBook();
  const owner = await loginAs('owner');
  const work = await call(owner, 'POST', '/api/work-book/works', { category: 'OT', nameRu: `Тестовое ТО ${uniq()}`, normMin: 75 });
  expect(work.statusCode, work.body).toBe(201);
  const u = await makeUser('chief_mechanic');
  const chief = await login(u.email);
  const res = await call(chief, 'POST', '/api/service/workshop', {
    vehicleId, reasonKind: 'planned', reason: 'planned maintenance', odometerKm, odometerPhoto: PHOTO, photos: [PHOTO],
    works: [{ workTypeId: json<{ id: string }>(work).id, qty: 1 }],
  });
  expect(res.statusCode, res.body).toBe(201);
  return { owner, chief, id: json<{ id: string }>(res).id };
}

async function point(): Promise<string> {
  const { prisma } = await import('../src/lib/db.js');
  const row = await prisma.location.findFirst({ where: { archived: false }, select: { id: true } });
  return (row ?? (await prisma.location.create({ data: { name: `ТЕСТ point ${uniq()}` }, select: { id: true } }))).id;
}

describe.skipIf(!HAS_DB)('the planned maintenance (stage 6)', () => {
  it('counts no mileage that EV8 Ops did not record: a figure from Odoo alone is «unknown», not on the list', async () => {
    const odoo = await moped(23_456);
    const owner = await loginAs('owner');
    expect(await card(owner, odoo.id)).toMatchObject({ state: 'unknown', currentKm: null, dueKm: null, leftKm: null, readingSource: null, lastPlanned: null });
    const o = await overview(owner);
    expect(o.due.some((m) => m.vehicleId === odoo.id)).toBe(false);
    expect(o.unknownCount).toBeGreaterThanOrEqual(1);
  });

  it('a hand-over at 4 820 km puts the moped on «Пора на ТО» at 5 000, the most urgent first', async () => {
    const a = await moped();
    const b = await moped();
    await pickedUp(a.id, 4820);
    await pickedUp(b.id, 4950);
    const owner = await loginAs('owner');
    expect(await card(owner, a.id)).toMatchObject({ state: 'soon', currentKm: 4820, readingSource: 'pickup', dueKm: 5000, leftKm: 180, lastPlanned: null });
    const o = await overview(owner);
    expect(o).toMatchObject({ intervalKm: expect.any(Number), warnKm: expect.any(Number) });
    const mine = o.due.filter((m) => m.vehicleId === a.id || m.vehicleId === b.id).map((m) => [m.vehicleId, m.leftKm]);
    expect(mine).toEqual([
      [b.id, 50],
      [a.id, 180],
    ]);
    // Sorted through the whole list, not only among this file's mopeds.
    expect(o.due.map((m) => m.leftKm)).toEqual([...o.due.map((m) => m.leftKm!)].sort((x, y) => x - y));
  });

  it('a closed planned repair moves the next maintenance: closed at 4 980, next at 9 980', async () => {
    const v = await moped();
    await pickedUp(v.id, 4100);
    const { prisma } = await import('../src/lib/db.js');
    // Back from the rental: the moped is in the yard for its maintenance.
    const rental = await prisma.rental.findFirstOrThrow({ where: { vehicleId: v.id } });
    const owner = await loginAs('owner');
    expect((await call(owner, 'POST', `/api/rentals/${rental.id}/return`, { odometerKm: 4970, items: ITEMS })).statusCode).toBe(200);
    expect(await card(owner, v.id)).toMatchObject({ state: 'soon', currentKm: 4970, readingSource: 'return', dueKm: 5000 });

    const { chief, id } = await planned(v.id, 4975);
    // Under way: it says so, and the moped is still due until the repair closes.
    expect(await card(owner, v.id)).toMatchObject({ state: 'soon', readingSource: 'repair_open', openPlanned: { jobId: id, status: 'open' } });
    const closed = await call(chief, 'POST', `/api/service/${id}/close`, { odometerKm: 4980, locationId: await point(), photos: [PHOTO] });
    expect(closed.statusCode, closed.body).toBe(200);

    const m = await card(owner, v.id);
    expect(m).toMatchObject({ state: 'ok', currentKm: 4980, readingSource: 'repair_close', dueKm: 9980, leftKm: 5000, openPlanned: null });
    expect(m?.lastPlanned).toMatchObject({ jobId: id, km: 4980, closedOn: todayISO() });
    expect((await overview(owner)).due.some((x) => x.vehicleId === v.id)).toBe(false);
  });

  it('a planned repair called off or refused moves nothing — but the reading at its opening still counts', async () => {
    const v = await moped();
    const { owner, id } = await planned(v.id, 4980);
    expect((await call(owner, 'POST', `/api/service/${id}/cancel`, { reason: 'ТЕСТ opened by mistake' })).statusCode).toBe(200);
    expect(await card(owner, v.id)).toMatchObject({ state: 'soon', currentKm: 4980, readingSource: 'repair_open', dueKm: 5000, lastPlanned: null, openPlanned: null });
  });

  it('a return taken back is no reading', async () => {
    const v = await moped();
    const { owner, rentalId } = await pickedUp(v.id, 100);
    expect((await call(owner, 'POST', `/api/rentals/${rentalId}/return`, { odometerKm: 5100, items: ITEMS })).statusCode).toBe(200);
    expect(await card(owner, v.id)).toMatchObject({ state: 'overdue', currentKm: 5100, leftKm: -100 });
    const undone = await call(owner, 'POST', `/api/rentals/${rentalId}/return/undo`, { reason: 'ТЕСТ returned by mistake' });
    expect(undone.statusCode, undone.body).toBe(200);
    expect(await card(owner, v.id)).toMatchObject({ state: 'ok', currentKm: 100, readingSource: 'pickup', dueKm: 5000 });
  });

  it('a moped that left the fleet has no maintenance', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const v = await moped();
    await pickedUp(v.id, 4900);
    const rental = await prisma.rental.findFirstOrThrow({ where: { vehicleId: v.id } });
    const owner = await loginAs('owner');
    await call(owner, 'POST', `/api/rentals/${rental.id}/return`, { odometerKm: 4950, items: ITEMS });
    await prisma.vehicle.update({ where: { id: v.id }, data: { state: 'sold' } });
    expect(await card(owner, v.id)).toBeNull();
    expect((await overview(owner)).due.some((m) => m.vehicleId === v.id)).toBe(false);
  });

  it('follows the interval and the warning the owner set', async () => {
    const owner = await loginAs('owner');
    const v = await moped();
    await pickedUp(v.id, 4820);
    const before = json<{ maintenanceIntervalKm: number; maintenanceWarnKm: number }>(await call(owner, 'GET', '/api/settings/service'));
    try {
      expect((await call(owner, 'PATCH', '/api/settings/service', { maintenanceIntervalKm: 6000, maintenanceWarnKm: 100 })).statusCode).toBe(200);
      const o = await overview(owner);
      expect(o).toMatchObject({ intervalKm: 6000, warnKm: 100 });
      expect(await card(owner, v.id)).toMatchObject({ state: 'ok', dueKm: 6000, leftKm: 1180 });
    } finally {
      await call(owner, 'PATCH', '/api/settings/service', { maintenanceIntervalKm: before.maintenanceIntervalKm, maintenanceWarnKm: before.maintenanceWarnKm });
    }
  });

  it('is read by whoever works on repairs, not without a session', async () => {
    for (const role of ['mechanic', 'chief_mechanic', 'manager'] as const) {
      expect((await call(await loginAs(role), 'GET', '/api/service/maintenance')).statusCode, role).toBe(200);
    }
    expect((await call(null, 'GET', '/api/service/maintenance')).statusCode).toBe(401);
  });
});
