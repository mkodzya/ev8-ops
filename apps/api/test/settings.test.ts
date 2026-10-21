// Rates, the deposit and what a point is (wave 6 §3.5, criteria 10, 11, 13).
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

describe.skipIf(!HAS_DB)('the rental settings', () => {
  it('starts at one rate of 150 ₾ and a deposit of 180 ₾ (crit. 11)', async () => {
    const owner = await loginAs('owner');
    const s = json<{ depositTetri: number; quickRates: { rateTetri: number }[] }>(await call(owner, 'GET', '/api/settings/rental'));
    expect(s.depositTetri).toBe(18000);
    // 140 and 170 are not created: the rentals that carry them keep their own
    // figure, which lives on the rental (Mika, 21.09.2026).
    expect(s.quickRates.map((r) => r.rateTetri)).toContain(15000);
    expect(s.quickRates.map((r) => r.rateTetri)).not.toContain(14000);
    expect(s.quickRates.map((r) => r.rateTetri)).not.toContain(17000);
  });

  it('changes the deposit and says so in the journal (crit. 10)', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const before = json<{ depositTetri: number }>(await call(owner, 'GET', '/api/settings/rental')).depositTetri;
    const changed = await call(owner, 'PATCH', '/api/settings/rental', { depositTetri: '200' });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(json<{ depositTetri: number }>(await call(owner, 'GET', '/api/settings/rental')).depositTetri).toBe(20000);

    const entry = await prisma.auditLog.findFirst({
      where: { action: 'settings.deposit', entityId: 'rental' },
      orderBy: { createdAt: 'desc' },
    });
    expect(entry?.before).toMatchObject({ depositTetri: before });
    expect(entry?.after).toMatchObject({ depositTetri: 20000 });

    await call(owner, 'PATCH', '/api/settings/rental', { depositTetri: '180' });
  });

  it('adds a rate to the buttons and takes it off without touching old rentals (crit. 11)', async () => {
    const owner = await loginAs('owner');
    const added = await call(owner, 'POST', '/api/settings/rates', { rateTetri: '160' });
    expect(added.statusCode, added.body).toBe(201);
    const id = json<{ id: string }>(added).id;
    expect(json<{ quickRates: { rateTetri: number }[] }>(await call(owner, 'GET', '/api/settings/rental')).quickRates.map((r) => r.rateTetri)).toContain(16000);

    // The same figure twice is one button, not two.
    expect((await call(owner, 'POST', '/api/settings/rates', { rateTetri: '160' })).statusCode).toBe(409);

    expect((await call(owner, 'DELETE', `/api/settings/rates/${id}`)).statusCode).toBe(200);
    expect(json<{ quickRates: { rateTetri: number }[] }>(await call(owner, 'GET', '/api/settings/rental')).quickRates.map((r) => r.rateTetri)).not.toContain(16000);
    // Archived, not deleted: a rental written at that rate still reads true.
    const { prisma } = await import('../src/lib/db.js');
    expect((await prisma.quickRate.findUniqueOrThrow({ where: { id } })).archived).toBe(true);
  });

  it('is an owner’s to change and a manager’s to read (crit. 12)', async () => {
    const manager = await loginAs('manager');
    // A manager hands mopeds over, so they need the figures.
    expect((await call(manager, 'GET', '/api/settings/rental')).statusCode).toBe(200);
    expect((await call(manager, 'PATCH', '/api/settings/rental', { depositTetri: '1' })).statusCode).toBe(403);
    expect((await call(manager, 'POST', '/api/settings/rates', { rateTetri: '99' })).statusCode).toBe(403);
  });
});

describe.skipIf(!HAS_DB)('a point has a kind', () => {
  it('is created as a swap station and chosen like any other point (crit. 13)', async () => {
    const owner = await loginAs('owner');
    const made = await call(owner, 'POST', '/api/locations', { name: `ТЕСТ станция ${uniq()}`, kind: 'swap' });
    expect(made.statusCode, made.body).toBe(201);
    const id = json<{ id: string }>(made).id;

    const list = json<{ locations: { id: string; kind: string }[] }>(await call(owner, 'GET', '/api/locations'));
    expect(list.locations.find((l) => l.id === id)?.kind).toBe('swap');

    // Nothing behaves differently by kind yet: a station takes mopeds like
    // a showroom does, which is what closing a repair at one proves.
    const { prisma } = await import('../src/lib/db.js');
    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Swap ${uniq()}` } });
    const vehicle = await prisma.vehicle.create({
      data: { vin: `TESTSWAP${uniq().replace(/\D/g, '').slice(-9).padStart(9, '0')}`, modelId: model.id },
    });
    const { id: jobId } = json<{ id: string }>(await call(owner, 'POST', '/api/service', { vehicleId: vehicle.id, reason: 'ТЕСТ' }));
    const closed = await call(owner, 'POST', `/api/service/${jobId}/close`, { odometerKm: 10, locationId: id });
    expect(closed.statusCode, closed.body).toBe(200);
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).locationId).toBe(id);

    // And the kind is corrected on the screen like a name.
    expect((await call(owner, 'PATCH', `/api/locations/${id}`, { kind: 'workshop' })).statusCode).toBe(200);
    expect((await call(owner, 'PATCH', `/api/locations/${id}`, { kind: 'garage' })).statusCode).toBe(400);
  });

  // §8 of wave 6: the figures live in the settings, and the code's old
  // constant survives only as what migration 0029 wrote there. A hand-over
  // that forgets to send the deposit must still get the owner's figure.
  it('a hand-over with no deposit in it takes the one the owner set, not the one the code used to hold', async () => {
    const owner = await loginAs('owner');
    const { prisma } = await import('../src/lib/db.js');
    const { DEFAULT_DEPOSIT_TETRI } = await import('@ev8/shared');
    // Put it back whatever happens: a run that fails halfway used to leave
    // 200 ₾ in the one settings row and fail the next run too — the shared
    // database is the point of these suites and also their trap.
    const before = json<{ depositTetri: number }>(await call(owner, 'GET', '/api/settings/rental')).depositTetri;
    try {
      const set = await call(owner, 'PATCH', '/api/settings/rental', { depositTetri: 20000 });
      expect(set.statusCode).toBe(200);

      const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Deposit ${uniq()}`, weeklyRateTetri: 15000, forRent: true } });
      const vehicle = await prisma.vehicle.create({ data: { vin: `TESTDEP${uniq().replace(/\D/g, '').slice(-9)}`, modelId: model.id, pool: 'rent', state: 'available' } });
      const customer = await prisma.customer.create({ data: { name: `ТЕСТ Залог ${uniq()}` } });

      // `/api/rentals` is the plain hand-over: no payment, no deposit named.
      const res = await call(owner, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000 });
      expect(res.statusCode, res.body).toBe(201);
      const rental = await prisma.rental.findFirst({ where: { vehicleId: vehicle.id }, orderBy: { createdAt: 'desc' } });
      expect(rental?.depositTetri).toBe(20000);
      expect(rental?.depositTetri).not.toBe(DEFAULT_DEPOSIT_TETRI);
    } finally {
      await call(owner, 'PATCH', '/api/settings/rental', { depositTetri: before });
    }
  });
});

// Stage 6 (ADR-0038 §3): the company rate for an hour of norm and the planned
// maintenance are settings an owner sets, not constants of the code. Every
// change here is put back in `finally`: the suites share one settings row.
describe.skipIf(!HAS_DB)('the repair settings (stage 6)', () => {
  type ServiceSettings = { defaultRateTetri: number | null; maintenanceIntervalKm: number; maintenanceWarnKm: number; updatedBy: string | null };
  const read = async (cookie: string) => json<ServiceSettings>(await call(cookie, 'GET', '/api/settings/service'));
  const PHOTO = { mimeType: 'image/jpeg', dataBase64: Buffer.from(`test photo ${uniq()}`).toString('base64') };

  it('starts where the spec does: 50 ₾ an hour, every 5 000 km, called at 300 km left', async () => {
    const { LABOUR_RATE_TETRI, MAINTENANCE_INTERVAL_KM, MAINTENANCE_WARN_KM } = await import('@ev8/shared');
    const { prisma } = await import('../src/lib/db.js');
    const row = await prisma.serviceSettings.findUniqueOrThrow({ where: { id: true } });
    expect(MAINTENANCE_INTERVAL_KM).toBe(5000);
    expect(MAINTENANCE_WARN_KM).toBe(300);
    // What migration 0060 wrote, unless a run of this suite is changing it.
    expect([row.defaultRateTetri, row.maintenanceIntervalKm, row.maintenanceWarnKm]).toEqual([LABOUR_RATE_TETRI, MAINTENANCE_INTERVAL_KM, MAINTENANCE_WARN_KM]);
  });

  it('an owner changes them, and the journal says from what to what', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const before = await read(owner);
    try {
      const changed = await call(owner, 'PATCH', '/api/settings/service', { defaultRateTetri: '55', maintenanceIntervalKm: 6000, maintenanceWarnKm: '400' });
      expect(changed.statusCode, changed.body).toBe(200);
      expect(await read(owner)).toMatchObject({ defaultRateTetri: 5500, maintenanceIntervalKm: 6000, maintenanceWarnKm: 400, updatedBy: 'Test owner' });
      const entry = await prisma.auditLog.findFirst({ where: { action: 'settings.service', entityId: 'service' }, orderBy: { createdAt: 'desc' } });
      expect(entry?.before).toEqual({ defaultRateTetri: before.defaultRateTetri, maintenanceIntervalKm: before.maintenanceIntervalKm, maintenanceWarnKm: before.maintenanceWarnKm });
      expect(entry?.after).toEqual({ defaultRateTetri: 5500, maintenanceIntervalKm: 6000, maintenanceWarnKm: 400 });

      // The same figures again change nothing and write nothing.
      const count = await prisma.auditLog.count({ where: { action: 'settings.service' } });
      expect((await call(owner, 'PATCH', '/api/settings/service', { maintenanceIntervalKm: 6000 })).statusCode).toBe(200);
      expect(await prisma.auditLog.count({ where: { action: 'settings.service' } })).toBe(count);

      // Only what was given changes; the journal names only that.
      expect((await call(owner, 'PATCH', '/api/settings/service', { maintenanceWarnKm: 0 })).statusCode).toBe(200);
      const last = await prisma.auditLog.findFirst({ where: { action: 'settings.service', entityId: 'service' }, orderBy: { createdAt: 'desc' } });
      expect(last?.before).toEqual({ maintenanceWarnKm: 400 });
      expect(last?.after).toEqual({ maintenanceWarnKm: 0 });
    } finally {
      await call(owner, 'PATCH', '/api/settings/service', before);
    }
  });

  it('refuses a warning not shorter than the interval, and an interval out of its bounds', async () => {
    const owner = await loginAs('owner');
    const before = await read(owner);
    const refused = async (body: Record<string, unknown>, field: string) => {
      const res = await call(owner, 'PATCH', '/api/settings/service', body);
      expect(res.statusCode, res.body).toBe(400);
      expect(json<{ error: string; field: string }>(res)).toMatchObject({ error: 'bad_field', field });
    };
    await refused({ maintenanceWarnKm: before.maintenanceIntervalKm }, 'maintenanceWarnKm');
    await refused({ maintenanceIntervalKm: 1000, maintenanceWarnKm: 1000 }, 'maintenanceWarnKm');
    await refused({ maintenanceIntervalKm: 499 }, 'maintenanceIntervalKm');
    await refused({ maintenanceIntervalKm: 100_001 }, 'maintenanceIntervalKm');
    await refused({ maintenanceIntervalKm: 5000.5 }, 'maintenanceIntervalKm');
    await refused({ maintenanceWarnKm: -1 }, 'maintenanceWarnKm');
    await refused({ defaultRateTetri: 0 }, 'defaultRateTetri');
    // Nothing of a refused change was kept.
    expect(await read(owner)).toEqual(before);
  });

  it('a mechanic reads them, a manager reads them without the rate, and only an owner changes them', async () => {
    const mechanic = await loginAs('mechanic');
    const manager = await loginAs('manager');
    expect((await read(mechanic)).defaultRateTetri).toEqual(expect.any(Number));
    const seen = await read(manager);
    expect(seen.defaultRateTetri).toBeNull();
    expect(seen.maintenanceIntervalKm).toEqual(expect.any(Number));
    expect((await call(mechanic, 'PATCH', '/api/settings/service', { defaultRateTetri: 1 })).statusCode).toBe(403);
    expect((await call(manager, 'PATCH', '/api/settings/service', { maintenanceIntervalKm: 1000 })).statusCode).toBe(403);
    expect((await call(null, 'GET', '/api/settings/service')).statusCode).toBe(401);
  });

  it('a mechanic without a rate of his own is paid the company rate on his lines; one with his own keeps his', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { importWorkBook } = await import('../src/lib/workBook.js');
    const { makeUser, login } = await import('./helpers.js');
    const owner = await loginAs('owner');
    const before = await read(owner);
    await importWorkBook();
    const made = await call(owner, 'POST', '/api/work-book/works', { category: 'OT', nameRu: `Тестовая работа ${uniq()}`, normMin: 30 });
    expect(made.statusCode, made.body).toBe(201);
    const work = json<{ id: string }>(made);
    const opened = async (labourRateTetri: number | null) => {
      const u = await makeUser('mechanic');
      if (labourRateTetri != null) await prisma.user.update({ where: { id: u.id }, data: { labourRateTetri } });
      const cookie = await login(u.email);
      const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Rate ${uniq()}` } });
      const vehicle = await prisma.vehicle.create({ data: { vin: `TESTRATE${uniq().replace(/\D/g, '').slice(-9).padStart(9, '0')}`, modelId: model.id } });
      const res = await call(cookie, 'POST', '/api/service/workshop', {
        vehicleId: vehicle.id, reasonKind: 'wear', reason: 'test', odometerKm: 100, odometerPhoto: PHOTO, photos: [PHOTO], works: [{ workTypeId: work.id, qty: 1 }],
      });
      expect(res.statusCode, res.body).toBe(201);
      const job = json<{ id: string }>(res);
      const lines = await prisma.serviceWork.findMany({ where: { jobId: job.id }, select: { rateTetri: true } });
      const book = json<{ rateTetri: number }>(await call(cookie, 'GET', '/api/work-book'));
      await call(owner, 'POST', `/api/service/${job.id}/cancel`, { reason: 'ТЕСТ done' });
      return { lines: lines.map((l) => l.rateTetri), book: book.rateTetri };
    };
    try {
      expect((await call(owner, 'PATCH', '/api/settings/service', { defaultRateTetri: 6000 })).statusCode).toBe(200);
      expect(await opened(null)).toEqual({ lines: [6000], book: 6000 });
      expect(await opened(7000)).toEqual({ lines: [7000], book: 7000 });
    } finally {
      await call(owner, 'PATCH', '/api/settings/service', before);
    }
  });
});
