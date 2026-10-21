// Approving, refusing and closing a mechanic's repair (stage 3 of
// docs/spec/mechanic-in-erp-plan.md; ADR-0035). The "Сдан" points of the
// stage are tests here, one for each move and for where the moped stands
// after it: waiting → approved → closed; refused; a work found later → waiting
// again. Mopeds, people and photos are invented test values.
import { AFTER_PHOTOS_MAX, suggestsCustomerPays, workLineState } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, login, loginAs, makeUser, uniq } from './helpers.js';

/** A photo as the tablet sends it; the server checks the type and that there are bytes. */
const PHOTO = { mimeType: 'image/jpeg', dataBase64: Buffer.from(`test photo ${uniq()}`).toString('base64') };

async function freeVehicle(odometerKm: number | null = null) {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Model ${uniq()}`, forRent: true } });
  const vehicle = await prisma.vehicle.create({
    data: { vin: `TESTA${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id, odometerKm },
  });
  return { prisma, vehicle };
}

async function rentedVehicle() {
  const { prisma, vehicle } = await freeVehicle();
  const customer = await prisma.customer.create({ data: { name: `ТЕСТ Арендатор ${uniq()}` } });
  const owner = await loginAs('owner');
  const res = await call(owner, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, pickedUpOn: '2026-09-01' });
  expect(res.statusCode, res.body).toBe(201);
  return { prisma, vehicle, rentalId: json<{ id: string }>(res).id };
}

/** A person of a role, signed in with a password, with their id. */
async function person(role: 'mechanic' | 'chief_mechanic' | 'owner') {
  const u = await makeUser(role);
  return { id: u.id, cookie: await login(u.email) };
}

/** A work of the test's own, so no test changes the bot's book that others read. */
async function ownWork(owner: string, minutes = 30) {
  const { importWorkBook } = await import('../src/lib/workBook.js');
  await importWorkBook();
  const res = await call(owner, 'POST', '/api/work-book/works', { category: 'OT', nameRu: `Тестовая работа ${uniq()}`, normMin: minutes });
  expect(res.statusCode, res.body).toBe(201);
  return json<{ id: string; code: string; normSec: number }>(res);
}

/** A point to leave the moped at when the repair closes. */
async function point(): Promise<string> {
  const { prisma } = await import('../src/lib/db.js');
  const row = await prisma.location.findFirst({ where: { archived: false }, select: { id: true } });
  return (row ?? (await prisma.location.create({ data: { name: `ТЕСТ point ${uniq()}` }, select: { id: true } }))).id;
}

function opening(vehicleId: string, works: unknown[], extra: Record<string, unknown> = {}) {
  return { vehicleId, reasonKind: 'wear', reason: 'rear brake squeals', odometerKm: 5230, odometerPhoto: PHOTO, photos: [PHOTO], works, ...extra };
}

interface Line {
  id: string;
  code: string | null;
  freeText: string | null;
  normSec: number | null;
  state: string;
  rejectReason: string | null;
}
interface Job {
  status: string;
  approved: { at: string; by: string | null } | null;
  rejected: { at: string; by: string | null; reason: string } | null;
  closedAt: string | null;
  works: Line[];
  worksTotal: { seconds: number; unnormed: number };
  photos: { tag: string | null }[];
  totalTetri: number | null;
}

async function jobOf(cookie: string, id: string): Promise<Job> {
  const res = await call(cookie, 'GET', `/api/service/${id}`);
  expect(res.statusCode, res.body).toBe(200);
  return json<{ job: Job }>(res).job;
}

async function stateOf(vehicleId: string) {
  const { prisma } = await import('../src/lib/db.js');
  return prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId }, select: { state: true, odometerKm: true, locationId: true } });
}

/**
 * A repair waiting for approval is a row on the owners' «Сегодня», which shows
 * the oldest few: one left lying would crowd out another suite's.
 */
async function settle(...ids: string[]) {
  const owner = await loginAs('owner');
  for (const id of ids) await call(owner, 'POST', `/api/service/${id}/cancel`, { reason: 'ТЕСТ done' });
}

describe('where a line stands, and when the owner is offered «за счёт клиента», without a database', () => {
  it('reads a line as approved, refused or waiting', () => {
    expect(workLineState({ approvedAt: new Date(), rejectedAt: null })).toBe('approved');
    expect(workLineState({ approvedAt: null, rejectedAt: new Date() })).toBe('rejected');
    expect(workLineState({ approvedAt: null, rejectedAt: null })).toBe('waiting');
  });

  it('offers it on a renter’s fault while the moped is out with them — not on an accident (register #110)', () => {
    const base = { reasonKind: 'renter_fault', payer: 'company', rental: { id: 'r' }, status: 'draft' };
    expect(suggestsCustomerPays(base)).toBe(true);
    expect(suggestsCustomerPays({ ...base, status: 'open' })).toBe(true);
    expect(suggestsCustomerPays({ ...base, reasonKind: 'accident' })).toBe(false);
    expect(suggestsCustomerPays({ ...base, payer: 'customer' })).toBe(false);
    expect(suggestsCustomerPays({ ...base, rental: null })).toBe(false);
    expect(suggestsCustomerPays({ ...base, status: 'done' })).toBe(false);
  });
});

describe.skipIf(!HAS_DB)('a mechanic’s repair from waiting to closed (stage 3)', () => {
  it('waits → approved → closed, and the moped goes into service, stays there, and comes back', async () => {
    const { vehicle } = await freeVehicle(4812);
    const owner = await loginAs('owner');
    const w = await ownWork(owner, 30);
    const mech = await person('mechanic');
    const chief = await person('chief_mechanic');
    const opened = await call(mech.cookie, 'POST', '/api/service/workshop', opening(vehicle.id, [{ workTypeId: w.id, qty: 2 }, { freeText: 'bleed the rear brake' }]));
    expect(opened.statusCode, opened.body).toBe(201);
    const { id } = json<{ id: string }>(opened);
    expect((await stateOf(vehicle.id)).state).toBe('service');

    // Waiting, it does not close.
    const early = await call(mech.cookie, 'POST', `/api/service/${id}/close`, { odometerKm: 5300, locationId: await point(), photos: [PHOTO] });
    expect(early.statusCode).toBe(409);
    expect(json<{ error: string }>(early).error).toBe('job_waits_approval');

    // The chief mechanic approves, and gives the work not in the book its norm as he does.
    const free = (await jobOf(chief.cookie, id)).works.find((l) => l.freeText)!;
    const approved = await call(chief.cookie, 'POST', `/api/service/${id}/approve`, { norms: [{ workId: free.id, normMin: '25' }] });
    expect(approved.statusCode, approved.body).toBe(200);
    let job = await jobOf(mech.cookie, id);
    expect(job.status).toBe('open');
    expect(job.approved?.by).toBe('Test chief_mechanic');
    expect(job.works.map((l) => l.state)).toEqual(['approved', 'approved']);
    expect(job.works.find((l) => l.freeText)!.normSec).toBe(1500);
    expect(job.worksTotal).toMatchObject({ seconds: 2 * 1800 + 1500, unnormed: 0 });
    expect((await stateOf(vehicle.id)).state).toBe('service');

    // Without a photo after the repair it does not close, and nothing changes.
    const bare = await call(mech.cookie, 'POST', `/api/service/${id}/close`, { odometerKm: 5300, locationId: await point() });
    expect(bare.statusCode).toBe(400);
    expect(json<{ error: string; field: string }>(bare)).toMatchObject({ error: 'after_photo_missing', field: 'photos' });
    const tooMany = await call(mech.cookie, 'POST', `/api/service/${id}/close`, { odometerKm: 5300, locationId: await point(), photos: Array.from({ length: AFTER_PHOTOS_MAX + 1 }, () => PHOTO) });
    expect(tooMany.statusCode).toBe(400);
    expect((await jobOf(mech.cookie, id)).status).toBe('open');
    expect((await stateOf(vehicle.id)).state).toBe('service');

    const where = await point();
    const closed = await call(mech.cookie, 'POST', `/api/service/${id}/close`, { odometerKm: 5300, locationId: where, photos: [PHOTO, PHOTO] });
    expect(closed.statusCode, closed.body).toBe(200);
    // What the repair came to is the owners' to read, not the mechanic's.
    expect(json<Record<string, unknown>>(closed)).toEqual({ ok: true });
    job = await jobOf(mech.cookie, id);
    expect(job.status).toBe('done');
    expect(job.closedAt).not.toBeNull();
    expect(job.photos.filter((p) => p.tag === 'after')).toHaveLength(2);
    expect(await stateOf(vehicle.id)).toEqual({ state: 'available', odometerKm: 5300, locationId: where });
  });

  it('is refused the first time: cancelled with its reason, the moped back in the fleet, nobody paid', async () => {
    const { vehicle } = await freeVehicle();
    const owner = await loginAs('owner');
    const w = await ownWork(owner);
    const mech = await person('mechanic');
    const chief = await person('chief_mechanic');
    const { id } = json<{ id: string }>(await call(mech.cookie, 'POST', '/api/service/workshop', opening(vehicle.id, [{ workTypeId: w.id }])));
    expect((await stateOf(vehicle.id)).state).toBe('service');

    // A mechanic refuses nothing, and nobody refuses without a reason.
    expect((await call(mech.cookie, 'POST', `/api/service/${id}/reject`, { reason: 'no' })).statusCode).toBe(403);
    const silent = await call(chief.cookie, 'POST', `/api/service/${id}/reject`, { reason: '  ' });
    expect(silent.statusCode).toBe(400);
    expect(json<{ field: string }>(silent).field).toBe('reason');

    const refused = await call(chief.cookie, 'POST', `/api/service/${id}/reject`, { reason: 'pads were changed on 10.10 — check the cable first' });
    expect(refused.statusCode, refused.body).toBe(200);
    const job = await jobOf(mech.cookie, id);
    expect(job.status).toBe('cancelled');
    expect(job.rejected).toMatchObject({ by: 'Test chief_mechanic', reason: 'pads were changed on 10.10 — check the cable first' });
    expect(job.approved).toBeNull();
    expect(job.closedAt).not.toBeNull();
    expect((await stateOf(vehicle.id)).state).toBe('available');

    // Decided once: neither approved nor refused again, nor closed.
    expect(json<{ error: string }>(await call(chief.cookie, 'POST', `/api/service/${id}/approve`)).error).toBe('job_not_waiting');
    expect(json<{ error: string }>(await call(chief.cookie, 'POST', `/api/service/${id}/reject`, { reason: 'again' })).error).toBe('job_not_waiting');
    expect((await call(mech.cookie, 'POST', `/api/service/${id}/close`, { photos: [PHOTO] })).statusCode).toBe(409);
  });

  it('sends a work found later to approval on its own; refusing it leaves the rest in work', async () => {
    const { vehicle } = await freeVehicle();
    const owner = await loginAs('owner');
    const a = await ownWork(owner, 30);
    const b = await ownWork(owner, 20);
    const mech = await person('mechanic');
    const chief = await person('chief_mechanic');
    const { id } = json<{ id: string }>(await call(mech.cookie, 'POST', '/api/service/workshop', opening(vehicle.id, [{ workTypeId: a.id }])));
    expect((await call(chief.cookie, 'POST', `/api/service/${id}/approve`)).statusCode).toBe(200);

    // A second work: the repair waits again, for it alone.
    const added = await call(mech.cookie, 'POST', `/api/service/${id}/works`, { works: [{ workTypeId: b.id, qty: 1 }] });
    expect(added.statusCode, added.body).toBe(201);
    expect(json<{ status: string }>(added).status).toBe('draft');
    let job = await jobOf(mech.cookie, id);
    expect(job.status).toBe('draft');
    expect(job.approved).not.toBeNull();
    expect(job.works.map((l) => [l.code, l.state])).toEqual([
      [a.code, 'approved'],
      [b.code, 'waiting'],
    ]);
    expect((await stateOf(vehicle.id)).state).toBe('service');
    const waiting = await call(mech.cookie, 'POST', `/api/service/${id}/close`, { odometerKm: 5300, locationId: await point(), photos: [PHOTO] });
    expect(json<{ error: string }>(waiting).error).toBe('job_waits_approval');

    // Refused: that work is struck through with its reason; the repair is in work again.
    const refused = await call(chief.cookie, 'POST', `/api/service/${id}/reject`, { reason: 'not needed now' });
    expect(refused.statusCode, refused.body).toBe(200);
    expect(json<{ status: string; works: number }>(refused)).toMatchObject({ status: 'open', works: 1 });
    job = await jobOf(mech.cookie, id);
    expect(job.status).toBe('open');
    expect(job.rejected).toBeNull();
    expect(job.works.map((l) => [l.code, l.state, l.rejectReason])).toEqual([
      [a.code, 'approved', null],
      [b.code, 'rejected', 'not needed now'],
    ]);
    // A refused line is not work done.
    expect(job.worksTotal.seconds).toBe(1800);
    expect((await stateOf(vehicle.id)).state).toBe('service');

    // Another, approved this time: only the new line changes.
    expect((await call(mech.cookie, 'POST', `/api/service/${id}/works`, { works: [{ freeText: 'replace the mirror bolt' }] })).statusCode).toBe(201);
    expect((await call(chief.cookie, 'POST', `/api/service/${id}/approve`)).statusCode).toBe(200);
    job = await jobOf(mech.cookie, id);
    expect(job.status).toBe('open');
    expect(job.works.map((l) => l.state)).toEqual(['approved', 'rejected', 'approved']);
    expect(job.worksTotal).toMatchObject({ seconds: 1800, unnormed: 1 });

    const closed = await call(mech.cookie, 'POST', `/api/service/${id}/close`, { odometerKm: 5300, locationId: await point(), photos: [PHOTO] });
    expect(closed.statusCode, closed.body).toBe(200);
    expect((await stateOf(vehicle.id)).state).toBe('available');
  });

  it('writes a work the chief mechanic adds to a repair in work as approved', async () => {
    const { vehicle } = await freeVehicle();
    const owner = await loginAs('owner');
    const w = await ownWork(owner);
    const chief = await person('chief_mechanic');
    const opened = await call(chief.cookie, 'POST', '/api/service/workshop', opening(vehicle.id, [{ workTypeId: w.id }]));
    expect(json<{ status: string }>(opened).status).toBe('open');
    const { id } = json<{ id: string }>(opened);
    // Opened by whoever may approve, it was approved by them as it was opened.
    expect((await jobOf(chief.cookie, id)).approved?.by).toBe('Test chief_mechanic');
    const added = await call(chief.cookie, 'POST', `/api/service/${id}/works`, { works: [{ workTypeId: w.id, qty: 2 }] });
    expect(json<{ status: string }>(added).status).toBe('open');
    expect((await jobOf(chief.cookie, id)).works.map((l) => l.state)).toEqual(['approved', 'approved']);
    await settle(id);
  });

  it('gives a norm to a work not in the book, after closing too — never to one from the book', async () => {
    const { vehicle } = await freeVehicle();
    const owner = await loginAs('owner');
    const w = await ownWork(owner);
    const mech = await person('mechanic');
    const chief = await person('chief_mechanic');
    const { id } = json<{ id: string }>(await call(mech.cookie, 'POST', '/api/service/workshop', opening(vehicle.id, [{ workTypeId: w.id }, { freeText: 'straighten the stand' }])));
    await call(chief.cookie, 'POST', `/api/service/${id}/approve`);
    await call(mech.cookie, 'POST', `/api/service/${id}/close`, { odometerKm: 5300, locationId: await point(), photos: [PHOTO] });
    const lines = (await jobOf(chief.cookie, id)).works;
    const free = lines.find((l) => l.freeText)!;
    const book = lines.find((l) => l.code)!;

    expect((await call(mech.cookie, 'PATCH', `/api/service/${id}/works/${free.id}`, { normMin: 10 })).statusCode).toBe(403);
    expect(json<{ error: string }>(await call(chief.cookie, 'PATCH', `/api/service/${id}/works/${book.id}`, { normMin: 10 })).error).toBe('norm_from_book');
    expect(json<{ field: string }>(await call(chief.cookie, 'PATCH', `/api/service/${id}/works/${free.id}`, { normMin: 0 })).field).toBe('normMin');
    const given = await call(chief.cookie, 'PATCH', `/api/service/${id}/works/${free.id}`, { normMin: '7,5' });
    expect(given.statusCode, given.body).toBe(200);
    const job = await jobOf(chief.cookie, id);
    expect(job.status).toBe('done');
    expect(job.works.find((l) => l.id === free.id)!.normSec).toBe(450);
    expect(job.worksTotal.unnormed).toBe(0);
  });

  it('is closed by an owner when the customer pays — the mechanic leaves the photos after it', async () => {
    const { vehicle } = await rentedVehicle();
    const owner = await loginAs('owner');
    const w = await ownWork(owner);
    const mech = await person('mechanic');
    const chief = await person('chief_mechanic');
    const opened = await call(mech.cookie, 'POST', '/api/service/workshop', opening(vehicle.id, [{ workTypeId: w.id }], { reasonKind: 'renter_fault' }));
    expect(opened.statusCode, opened.body).toBe(201);
    const { id } = json<{ id: string }>(opened);
    // Out with the renter, it stays out: the repair goes around the rental.
    expect((await stateOf(vehicle.id)).state).toBe('rented');
    await call(chief.cookie, 'POST', `/api/service/${id}/approve`);
    expect((await call(owner, 'PATCH', `/api/service/${id}`, { payer: 'customer' })).statusCode).toBe(200);

    const mine = await call(mech.cookie, 'POST', `/api/service/${id}/close`, { photos: [PHOTO] });
    expect(mine.statusCode).toBe(409);
    expect(json<{ error: string }>(mine).error).toBe('close_is_owners');
    const left = await call(mech.cookie, 'POST', `/api/service/${id}/photos/after`, { photos: [PHOTO] });
    expect(left.statusCode, left.body).toBe(201);

    const closed = await call(owner, 'POST', `/api/service/${id}/close`, {});
    expect(closed.statusCode, closed.body).toBe(200);
    expect((await jobOf(owner, id)).status).toBe('done');
    expect((await stateOf(vehicle.id)).state).toBe('rented');
  });

  it('lets a mechanic carry only his own repair', async () => {
    const { vehicle } = await freeVehicle();
    const owner = await loginAs('owner');
    const w = await ownWork(owner);
    const mine = await person('mechanic');
    const other = await person('mechanic');
    const { id } = json<{ id: string }>(await call(mine.cookie, 'POST', '/api/service/workshop', opening(vehicle.id, [{ workTypeId: w.id }])));
    expect((await call(other.cookie, 'POST', `/api/service/${id}/works`, { works: [{ workTypeId: w.id }] })).statusCode).toBe(404);
    expect((await call(other.cookie, 'POST', `/api/service/${id}/photos/after`, { photos: [PHOTO] })).statusCode).toBe(404);
    expect((await call(other.cookie, 'POST', `/api/service/${id}/close`, { photos: [PHOTO] })).statusCode).toBe(404);
    await settle(id);
  });

  it('closes an owner’s old repair as before, with no photo and no mechanic', async () => {
    const { vehicle } = await freeVehicle();
    const owner = await loginAs('owner');
    const { id } = json<{ id: string }>(await call(owner, 'POST', '/api/service', { vehicleId: vehicle.id, reason: 'brake pads' }));
    const mech = await person('mechanic');
    const chief = await person('chief_mechanic');
    // Not the workshop's to close, nor to add works to.
    expect((await call(chief.cookie, 'POST', `/api/service/${id}/close`, { odometerKm: 10, locationId: await point() })).statusCode).toBe(403);
    expect(json<{ error: string }>(await call(chief.cookie, 'POST', `/api/service/${id}/works`, { works: [{ freeText: 'x' }] })).error).toBe('job_no_mechanic');
    expect((await call(mech.cookie, 'POST', `/api/service/${id}/close`, {})).statusCode).toBe(404);
    const closed = await call(owner, 'POST', `/api/service/${id}/close`, { odometerKm: 10, locationId: await point() });
    expect(closed.statusCode, closed.body).toBe(200);
    expect(json<{ totalTetri: number }>(closed).totalTetri).toBe(0);
    expect((await stateOf(vehicle.id)).state).toBe('available');
  });
});
