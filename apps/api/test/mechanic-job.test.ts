// The book of works and the repair a mechanic opens himself (stage 2 of
// docs/spec/mechanic-in-erp-plan.md). The "Сдан" points of the stage are tests
// here: the import gives the bot's 34 works in its categories with the bot's
// sum of norms, and a second run changes nothing; a repair without its
// mileage or its photos is not written; a norm changed in the book does not
// change a line already written; an old repair opens as it did. Mopeds,
// people and photos are invented test values.
import { JOB_PHOTOS_MAX, normSecFromMinutes, nextWorkCode, workLineTetri, worksTotal } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, login, loginAs, makeUser, uniq } from './helpers.js';

/** A photo as the tablet sends it; the server checks the type and that there are bytes. */
const PHOTO = { mimeType: 'image/jpeg', dataBase64: Buffer.from(`test photo ${uniq()}`).toString('base64') };

async function freeVehicle(odometerKm: number | null = null) {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Model ${uniq()}`, forRent: true } });
  const vehicle = await prisma.vehicle.create({
    data: { vin: `TESTM${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id, odometerKm },
  });
  return { prisma, vehicle };
}

/** A person of a role, signed in with a password, with their id. */
async function person(role: 'mechanic' | 'chief_mechanic' | 'owner' | 'manager') {
  const u = await makeUser(role);
  return { id: u.id, cookie: await login(u.email) };
}

/** A work of the test's own, so no test changes the bot's book that others read. */
async function ownWork(owner: string, minutes: number | string = 30) {
  const { importWorkBook } = await import('../src/lib/workBook.js');
  await importWorkBook();
  const res = await call(owner, 'POST', '/api/work-book/works', { category: 'OT', nameRu: `Тестовая работа ${uniq()}`, normMin: minutes });
  expect(res.statusCode, res.body).toBe(201);
  return json<{ id: string; code: string; normSec: number }>(res);
}

function opening(vehicleId: string, works: unknown[], extra: Record<string, unknown> = {}) {
  return {
    vehicleId,
    reasonKind: 'wear',
    reason: 'rear brake squeals',
    odometerKm: 5230,
    odometerPhoto: PHOTO,
    photos: [PHOTO],
    works,
    ...extra,
  };
}

describe('the book and its sums, without a database', () => {
  it('keeps a norm in seconds, so two and a half minutes stays two and a half', () => {
    expect(normSecFromMinutes(2.5)).toBe(150);
    expect(normSecFromMinutes('2,5')).toBe(150);
    expect(normSecFromMinutes('30')).toBe(1800);
    expect(normSecFromMinutes('0')).toBeNull();
    expect(normSecFromMinutes('-5')).toBeNull();
    expect(normSecFromMinutes('ten')).toBeNull();
  });

  it('gives a new work the next code of its category and never one that was used', () => {
    expect(nextWorkCode('BR', ['BR-01', 'BR-07', 'DG-09'])).toBe('BR-08');
    expect(nextWorkCode('XX', [])).toBe('XX-01');
  });

  it('pays quantity × norm × rate, and rounds the sum once — the bot’s control figure', () => {
    expect(workLineTetri({ qty: 2, normSec: 1800, rateTetri: 5000 })).toBe(5000);
    expect(workLineTetri({ qty: 1, normSec: null, rateTetri: 5000 })).toBeNull();
    // 282.5 minutes at 50 ₾ an hour is 235.42 ₾ (plan, stage 5): one line of 282.5 min, or many.
    expect(worksTotal([{ qty: 1, normSec: 282.5 * 60, rateTetri: 5000 }]).tetri).toBe(23542);
    const t = worksTotal([
      { qty: 1, normSec: 150, rateTetri: 5000 },
      { qty: 2, normSec: 1800, rateTetri: 5000 },
      { qty: 1, normSec: null, rateTetri: 5000 },
    ]);
    expect(t).toEqual({ seconds: 3750, tetri: Math.round((3750 * 5000) / 3600), unnormed: 1 });
  });
});

describe('the bot’s book, as it is copied', () => {
  it('holds 34 works in 9 categories, 1 477.5 minutes of norm in all (code check §3: nine, not ten)', async () => {
    const { CATALOG_SEED } = await import('../src/lib/workBook.js');
    expect(CATALOG_SEED).toHaveLength(34);
    expect(new Set(CATALOG_SEED.map((r) => r[0].split('-')[0])).size).toBe(9);
    expect(CATALOG_SEED.reduce((n, r) => n + r[4], 0)).toBe(1477.5);
    expect(new Set(CATALOG_SEED.map((r) => r[0])).size).toBe(34);
  });
});

describe.skipIf(!HAS_DB)('importing the book of works', () => {
  it('writes the bot’s 34 works with its norms, and a second run writes nothing', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { BOT_SOURCE, CATALOG_SEED, importWorkBook } = await import('../src/lib/workBook.js');
    await importWorkBook();
    const codes = CATALOG_SEED.map((r) => r[0]);
    const read = () => prisma.workType.findMany({ where: { code: { in: codes } }, orderBy: { code: 'asc' } });
    const first = await read();
    expect(first).toHaveLength(34);
    expect(first.every((w) => w.source === BOT_SOURCE)).toBe(true);
    expect(new Set(first.map((w) => w.category)).size).toBe(9);
    expect(first.reduce((n, w) => n + w.normSec, 0)).toBe(1477.5 * 60);
    expect(first.find((w) => w.code === 'OT-01')!.normSec).toBe(150);
    // What the bot does not have stays empty: no English names anywhere.
    expect(first.every((w) => w.nameEn == null)).toBe(true);

    const again = await importWorkBook();
    expect(again.added).toEqual([]);
    expect(again.same).toBe(34);
    expect(again.differs).toEqual([]);
    expect(await read()).toEqual(first);
    expect(await prisma.workCategory.count({ where: { code: { in: [...new Set(codes.map((c) => c.split('-')[0]))] } } })).toBe(9);
  });

  it('never takes back an edit made on the book’s screen, and says the row differs', async () => {
    const { importWorkBook } = await import('../src/lib/workBook.js');
    const owner = await loginAs('owner');
    const w = await ownWork(owner, 20);
    // A row of the test's own, imported under its own source as the bot's would be.
    const rows = [[w.code, 'სხვა', 'ტესტი', 'Тест', 20, ''] as const];
    expect((await importWorkBook(rows, 'test')).differs).toEqual([{ code: w.code, fields: ['nameKa', 'nameRu'] }]);
    await call(owner, 'PATCH', `/api/work-book/works/${w.id}`, { normMin: 25 });
    const report = await importWorkBook(rows, 'test');
    expect(report.added).toEqual([]);
    expect(report.differs[0].fields).toContain('normSec');
    const { prisma } = await import('../src/lib/db.js');
    expect((await prisma.workType.findUniqueOrThrow({ where: { id: w.id } })).normSec).toBe(1500);
  });
});

describe.skipIf(!HAS_DB)('the book’s screen', () => {
  it('is kept by the chief mechanic and the owners; a mechanic reads it and changes nothing', async () => {
    const owner = await loginAs('owner');
    const w = await ownWork(owner);
    const mech = await person('mechanic');
    const chief = await person('chief_mechanic');
    const manager = await person('manager');

    expect((await call(mech.cookie, 'GET', '/api/work-book')).statusCode).toBe(200);
    expect((await call(manager.cookie, 'GET', '/api/work-book')).statusCode).toBe(403);
    expect((await call(mech.cookie, 'PATCH', `/api/work-book/works/${w.id}`, { normMin: 5 })).statusCode).toBe(403);
    expect((await call(mech.cookie, 'POST', '/api/work-book/works', { category: 'OT', nameRu: 'x', normMin: 5 })).statusCode).toBe(403);

    const edited = await call(chief.cookie, 'PATCH', `/api/work-book/works/${w.id}`, { normMin: '2,5', nameEn: 'Test work', active: false });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(json<{ work: { normSec: number; nameEn: string; active: boolean; code: string } }>(edited).work).toMatchObject({ normSec: 150, nameEn: 'Test work', active: false, code: w.code });
    // No door to delete a work: a code is never given twice.
    expect((await call(owner, 'DELETE', `/api/work-book/works/${w.id}`)).statusCode).toBe(404);
  });

  it('gives a new work the next code of its category, and refuses one without a name or a norm', async () => {
    const owner = await loginAs('owner');
    const a = await ownWork(owner);
    const b = await ownWork(owner);
    expect(Number(b.code.slice(3))).toBe(Number(a.code.slice(3)) + 1);
    const noName = await call(owner, 'POST', '/api/work-book/works', { category: 'OT', normMin: 5 });
    expect(noName.statusCode).toBe(400);
    const noNorm = await call(owner, 'POST', '/api/work-book/works', { category: 'OT', nameRu: 'x' });
    expect(json<{ field: string }>(noNorm).field).toBe('normMin');
    expect((await call(owner, 'POST', '/api/work-book/works', { category: 'ZZ', nameRu: 'x', normMin: 5 })).statusCode).toBe(404);
  });
});

describe.skipIf(!HAS_DB)('a repair the mechanic opens (stage 2)', () => {
  it('is not written without the mileage, its photo, a photo of the damage or a planned work', async () => {
    const { prisma, vehicle } = await freeVehicle();
    const owner = await loginAs('owner');
    const w = await ownWork(owner);
    const mech = await person('mechanic');
    const line = [{ workTypeId: w.id, qty: 1 }];
    const tries: [Record<string, unknown>, string][] = [
      [{ odometerKm: undefined }, 'odometerKm'],
      [{ odometerPhoto: undefined }, 'odometerPhoto'],
      [{ photos: [] }, 'photos'],
      [{ photos: Array.from({ length: JOB_PHOTOS_MAX + 1 }, () => PHOTO) }, 'photos'],
      [{ works: [] }, 'works'],
      [{ reasonKind: undefined }, 'reasonKind'],
      [{ reasonKind: 'lightning' }, 'reasonKind'],
    ];
    for (const [extra, field] of tries) {
      const res = await call(mech.cookie, 'POST', '/api/service/workshop', opening(vehicle.id, line, extra));
      expect(res.statusCode, `${field}: ${res.body}`).toBe(400);
      expect(json<{ field: string }>(res).field).toBe(field);
    }
    // Nothing was written, not even half: no repair, the moped still in the yard.
    expect(await prisma.serviceJob.count({ where: { vehicleId: vehicle.id } })).toBe(0);
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).state).toBe('available');
  });

  it('waits for approval when a mechanic opens it, takes the moped into service and writes the mileage on it', async () => {
    const { prisma, vehicle } = await freeVehicle(4812);
    const owner = await loginAs('owner');
    const w = await ownWork(owner, 30);
    const mech = await person('mechanic');
    const res = await call(mech.cookie, 'POST', '/api/service/workshop', opening(vehicle.id, [{ workTypeId: w.id, qty: 2 }, { freeText: 'bleed the rear brake' }]));
    expect(res.statusCode, res.body).toBe(201);
    const { id, status } = json<{ id: string; status: string }>(res);
    expect(status).toBe('draft');

    const v = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(v.state).toBe('service');
    expect(v.odometerKm).toBe(5230);

    const got = json<{ job: { mechanic: { id: string }; reasonKind: string; openedOdometerKm: number; openedAt: string; works: { code: string | null; freeText: string | null; qty: number; normSec: number | null; amountTetri: number | null }[]; worksTotal: { seconds: number; tetri: number; unnormed: number }; photos: { tag: string }[] } }>(
      await call(mech.cookie, 'GET', `/api/service/${id}`),
    ).job;
    expect(got.mechanic.id).toBe(mech.id);
    expect(got.reasonKind).toBe('wear');
    expect(got.openedOdometerKm).toBe(5230);
    expect(got.openedAt).not.toBeNull();
    expect(got.photos.map((p) => p.tag).sort()).toEqual(['before', 'odometer']);
    expect(got.works).toMatchObject([
      { code: w.code, qty: 2, normSec: 1800, amountTetri: 5000 },
      { code: null, freeText: 'bleed the rear brake', normSec: null, amountTetri: null },
    ]);
    // His own sum he sees; the customers' money he does not.
    expect(got.worksTotal).toEqual({ seconds: 3600, tetri: 5000, unnormed: 1 });
  });

  it('is in work at once when the chief mechanic opens it', async () => {
    const { vehicle } = await freeVehicle();
    const owner = await loginAs('owner');
    const w = await ownWork(owner);
    const chief = await person('chief_mechanic');
    const res = await call(chief.cookie, 'POST', '/api/service/workshop', opening(vehicle.id, [{ workTypeId: w.id }]));
    expect(res.statusCode, res.body).toBe(201);
    expect(json<{ status: string }>(res).status).toBe('open');
  });

  it('asks why when the odometer reads less than the moped’s last reading', async () => {
    const { prisma, vehicle } = await freeVehicle(9000);
    const owner = await loginAs('owner');
    const w = await ownWork(owner);
    const mech = await person('mechanic');
    const lower = await call(mech.cookie, 'POST', '/api/service/workshop', opening(vehicle.id, [{ workTypeId: w.id }], { odometerKm: 1230 }));
    expect(lower.statusCode).toBe(400);
    expect(json<{ error: string; field: string; lastKm: number }>(lower)).toMatchObject({ error: 'odometer_below', field: 'odometerReason', lastKm: 9000 });
    const said = await call(mech.cookie, 'POST', '/api/service/workshop', opening(vehicle.id, [{ workTypeId: w.id }], { odometerKm: 1230, odometerReason: 'odometer replaced' }));
    expect(said.statusCode, said.body).toBe(201);
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).odometerKm).toBe(1230);
  });

  it('keeps the norm a line was written with when the book’s norm changes', async () => {
    const { prisma, vehicle } = await freeVehicle();
    const owner = await loginAs('owner');
    const w = await ownWork(owner, 30);
    const mech = await person('mechanic');
    const opened = await call(mech.cookie, 'POST', '/api/service/workshop', opening(vehicle.id, [{ workTypeId: w.id, qty: 1 }]));
    expect(opened.statusCode, opened.body).toBe(201);
    const { id } = json<{ id: string }>(opened);

    expect((await call(owner, 'PATCH', `/api/work-book/works/${w.id}`, { normMin: 45 })).statusCode).toBe(200);
    const line = await prisma.serviceWork.findFirstOrThrow({ where: { jobId: id } });
    expect(line.normSec).toBe(1800);
    const job = json<{ job: { works: { normSec: number; amountTetri: number }[] } }>(await call(mech.cookie, 'GET', `/api/service/${id}`)).job;
    expect(job.works[0]).toMatchObject({ normSec: 1800, amountTetri: 2500 });
  });

  it('refuses a work switched off in the book', async () => {
    const { vehicle } = await freeVehicle();
    const owner = await loginAs('owner');
    const w = await ownWork(owner);
    await call(owner, 'PATCH', `/api/work-book/works/${w.id}`, { active: false });
    const mech = await person('mechanic');
    const res = await call(mech.cookie, 'POST', '/api/service/workshop', opening(vehicle.id, [{ workTypeId: w.id }]));
    expect(res.statusCode).toBe(409);
    expect(json<{ error: string }>(res).error).toBe('work_type_off');
  });

  it('shows a mechanic the repairs he carries and no one else’s', async () => {
    const { vehicle } = await freeVehicle();
    const owner = await loginAs('owner');
    const w = await ownWork(owner);
    const a = await person('mechanic');
    const b = await person('mechanic');
    const chief = await person('chief_mechanic');
    const { id } = json<{ id: string }>(await call(a.cookie, 'POST', '/api/service/workshop', opening(vehicle.id, [{ workTypeId: w.id }])));
    expect((await call(a.cookie, 'GET', `/api/service/${id}`)).statusCode).toBe(200);
    expect((await call(b.cookie, 'GET', `/api/service/${id}`)).statusCode).toBe(404);
    expect(json<{ jobs: { id: string }[] }>(await call(b.cookie, 'GET', '/api/service')).jobs.some((j) => j.id === id)).toBe(false);
    expect((await call(chief.cookie, 'GET', `/api/service/${id}`)).statusCode).toBe(200);
    // The manager sees the repair, not what the mechanic is paid for it.
    const manager = await person('manager');
    const seen = json<{ job: { works: { amountTetri: number | null; rateTetri: number | null }[]; worksTotal: { tetri: number | null } } }>(await call(manager.cookie, 'GET', `/api/service/${id}`)).job;
    expect(seen.works[0]).toMatchObject({ amountTetri: null, rateTetri: null });
    expect(seen.worksTotal.tetri).toBeNull();
  });

  it('carries on a repair already open on the moped instead of opening a second one', async () => {
    const { prisma, vehicle } = await freeVehicle();
    const owner = await loginAs('owner');
    const w = await ownWork(owner);
    const manager = await person('manager');
    const reported = await call(manager.cookie, 'POST', '/api/service', { vehicleId: vehicle.id, reason: 'does not start' });
    expect(reported.statusCode, reported.body).toBe(201);
    const { id } = json<{ id: string }>(reported);

    const a = await person('mechanic');
    const found = json<{ vehicles: { id: string; openJob: { id: string; takeable: boolean } | null }[] }>(
      await call(a.cookie, 'GET', `/api/service/vehicles?q=${vehicle.vin.slice(-6)}`),
    ).vehicles;
    expect(found.find((v) => v.id === vehicle.id)?.openJob).toMatchObject({ id, takeable: true });

    expect((await call(a.cookie, 'POST', '/api/service/workshop', opening(vehicle.id, [{ workTypeId: w.id }]))).statusCode).toBe(409);
    const taken = await call(a.cookie, 'POST', '/api/service/workshop', opening(vehicle.id, [{ workTypeId: w.id }], { jobId: id }));
    expect(taken.statusCode, taken.body).toBe(200);
    expect(json<{ id: string; status: string }>(taken)).toMatchObject({ id, status: 'draft' });
    expect(await prisma.serviceJob.count({ where: { vehicleId: vehicle.id } })).toBe(1);

    // Once he carries it, another mechanic may not take it from him.
    const b = await person('mechanic');
    const again = await call(b.cookie, 'POST', '/api/service/workshop', opening(vehicle.id, [{ workTypeId: w.id }], { jobId: id }));
    expect(again.statusCode).toBe(409);
    expect(json<{ error: string }>(again).error).toBe('job_has_mechanic');
  });

  it('finds the moped by the sticker’s number and tells the mechanic nothing about the customer', async () => {
    const { prisma, vehicle } = await freeVehicle(700);
    const v = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id }, select: { fleetNo: true } });
    const mech = await person('mechanic');
    const res = await call(mech.cookie, 'GET', `/api/service/vehicles?q=EV-${v.fleetNo}`);
    expect(res.statusCode).toBe(200);
    const hit = json<{ vehicles: Record<string, unknown>[] }>(res).vehicles[0];
    expect(hit).toMatchObject({ id: vehicle.id, odometerKm: 700, state: 'available' });
    expect(Object.keys(hit).sort()).toEqual(['color', 'id', 'model', 'number', 'odometerKm', 'openJob', 'state', 'vin']);
  });
});

describe.skipIf(!HAS_DB)('an old repair', () => {
  it('opens as it did: no works, no mechanic, no tags, nothing refused', async () => {
    const { vehicle } = await freeVehicle();
    const owner = await loginAs('owner');
    const opened = await call(owner, 'POST', '/api/service', { vehicleId: vehicle.id, reason: 'brake pads', openedOn: '2026-09-10' });
    expect(opened.statusCode, opened.body).toBe(201);
    const { id } = json<{ id: string }>(opened);
    const { prisma } = await import('../src/lib/db.js');
    // As a repair from before 0056 is: no minute of opening.
    await prisma.serviceJob.update({ where: { id }, data: { openedAt: null } });
    const res = await call(owner, 'GET', `/api/service/${id}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(json<{ job: Record<string, unknown> }>(res).job).toMatchObject({
      reason: 'brake pads',
      status: 'open',
      mechanic: null,
      reasonKind: null,
      openedOdometerKm: null,
      openedAt: null,
      works: [],
      worksTotal: { seconds: 0, tetri: 0, unnormed: 0 },
    });
    expect((await call(owner, 'GET', '/api/service')).statusCode).toBe(200);
  });
});
