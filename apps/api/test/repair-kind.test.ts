// The kind of a repair from the office (Mika, 21.10.2026): «Открыть ремонт»
// and «Сообщить о поломке» may pick one of the tablet's five — Planned
// service, Accident, Wear, Renter's fault, Warranty — and need not; the owner
// sets, changes or takes it away on a repair under way, and the journal says
// what it was. A kind picked in the office sets going what it does from the
// tablet. Mopeds, people and words are invented.
import { suggestsCustomerPays, todayISO } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, login, loginAs, makeUser, uniq } from './helpers.js';

const digits = () => uniq().replace(/\D/g, '');

async function freeVehicle() {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Kind ${uniq()}`, weeklyRateTetri: 15000, forRent: true } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TESTK${digits().slice(-12).padStart(12, '0')}`, modelId: model.id, pool: 'rent' } });
  return { prisma, vehicle };
}

async function point(): Promise<string> {
  const { prisma } = await import('../src/lib/db.js');
  const row = await prisma.location.findFirst({ where: { archived: false }, select: { id: true } });
  return (row ?? (await prisma.location.create({ data: { name: `ТЕСТ point ${uniq()}` }, select: { id: true } }))).id;
}

interface Job {
  id: string;
  status: string;
  reasonKind: string | null;
  reason: string;
  payer: string;
  rental: { id: string; number: string } | null;
}

async function jobOf(cookie: string, id: string): Promise<Job> {
  const res = await call(cookie, 'GET', `/api/service/${id}`);
  expect(res.statusCode, res.body).toBe(200);
  return json<{ job: Job }>(res).job;
}

async function opened(cookie: string, body: Record<string, unknown>): Promise<string> {
  const res = await call(cookie, 'POST', '/api/service', body);
  expect(res.statusCode, res.body).toBe(201);
  return json<{ id: string }>(res).id;
}

interface Line {
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

/** The repair's own lines in the journal. */
async function journalOf(owner: string, id: string): Promise<Line[]> {
  const res = await call(owner, 'GET', `/api/journal?record=service_job:${id}`);
  expect(res.statusCode, res.body).toBe(200);
  return json<{ rows: Line[] }>(res).rows;
}

describe.skipIf(!HAS_DB)('the kind of a repair opened in the office', () => {
  it('an owner opens one as «Плановое ТО»: the kind is kept, and journaled with the opening', async () => {
    const { vehicle } = await freeVehicle();
    const owner = await loginAs('owner');
    const id = await opened(owner, { vehicleId: vehicle.id, reason: 'ТЕСТ the 5 000 km check', reasonKind: 'planned' });
    expect(await jobOf(owner, id)).toMatchObject({ status: 'open', reasonKind: 'planned', reason: 'ТЕСТ the 5 000 km check' });
    const open = (await journalOf(owner, id)).find((l) => l.action === 'service.open');
    expect(open?.after).toMatchObject({ reasonKind: 'planned', reason: 'ТЕСТ the 5 000 km check' });
    expect((await call(owner, 'POST', `/api/service/${id}/cancel`, { reason: 'ТЕСТ done' })).statusCode).toBe(200);
  });

  it('needs no kind — the words are what is required', async () => {
    const { prisma, vehicle } = await freeVehicle();
    const owner = await loginAs('owner');
    const noWords = await call(owner, 'POST', '/api/service', { vehicleId: vehicle.id, reasonKind: 'accident' });
    expect(noWords.statusCode).toBe(400);
    expect(json<{ error: string; field: string }>(noWords)).toMatchObject({ error: 'missing_field', field: 'reason' });
    expect(await prisma.serviceJob.count({ where: { vehicleId: vehicle.id } })).toBe(0);

    const id = await opened(owner, { vehicleId: vehicle.id, reason: 'ТЕСТ squeaks' });
    expect((await jobOf(owner, id)).reasonKind).toBeNull();
    expect((await call(owner, 'POST', `/api/service/${id}/cancel`, { reason: 'ТЕСТ done' })).statusCode).toBe(200);
  });

  it('refuses a kind that is not one of the five, and writes nothing', async () => {
    const { prisma, vehicle } = await freeVehicle();
    const owner = await loginAs('owner');
    const other = await call(owner, 'POST', '/api/service', { vehicleId: vehicle.id, reason: 'ТЕСТ something', reasonKind: 'other' });
    expect(other.statusCode).toBe(400);
    expect(json<{ error: string; field: string }>(other)).toMatchObject({ error: 'bad_field', field: 'reasonKind' });
    expect(await prisma.serviceJob.count({ where: { vehicleId: vehicle.id } })).toBe(0);
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).state).toBe('available');
  });

  it('a manager’s report carries the kind to the owners', async () => {
    const { vehicle } = await freeVehicle();
    const manager = await loginAs('manager');
    const id = await opened(manager, { vehicleId: vehicle.id, reason: 'ТЕСТ hit from behind', reasonKind: 'accident' });
    const owner = await loginAs('owner');
    expect(await jobOf(owner, id)).toMatchObject({ status: 'draft', reasonKind: 'accident' });
    expect((await journalOf(owner, id)).find((l) => l.action === 'service.report')?.after).toMatchObject({ reasonKind: 'accident', draft: true });
    // Not left waiting: «Сегодня» of the suites after this one reads the waiting repairs.
    expect((await call(owner, 'POST', `/api/service/${id}/cancel`, { reason: 'ТЕСТ done' })).statusCode).toBe(200);
  });

  it('«Вина арендатора» picked in the office offers the owner the customer’s expense, as from the tablet', async () => {
    const { vehicle } = await freeVehicle();
    const customer = await (await import('../src/lib/db.js')).prisma.customer.create({ data: { name: `ТЕСТ renter ${uniq()}` } });
    const owner = await loginAs('owner');
    const rented = await call(owner, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, pickedUpOn: '2026-10-01' });
    expect(rented.statusCode, rented.body).toBe(201);
    const id = await opened(owner, { vehicleId: vehicle.id, reason: 'ТЕСТ dropped it', reasonKind: 'renter_fault' });
    const job = await jobOf(owner, id);
    expect(job).toMatchObject({ reasonKind: 'renter_fault', payer: 'company' });
    expect(job.rental?.id).toBe(json<{ id: string }>(rented).id);
    expect(suggestsCustomerPays(job)).toBe(true);
    expect((await call(owner, 'POST', `/api/service/${id}/cancel`, { reason: 'ТЕСТ done' })).statusCode).toBe(200);
  });
});

describe.skipIf(!HAS_DB)('the owner sets or changes the kind of a repair under way', () => {
  it('sets it on a repair opened without one, changes it, takes it away — each «было → стало» in the journal', async () => {
    const { vehicle } = await freeVehicle();
    const owner = await loginAs('owner');
    const id = await opened(owner, { vehicleId: vehicle.id, reason: 'ТЕСТ rear brake' });
    for (const kind of ['accident', 'wear', null]) {
      const res = await call(owner, 'PATCH', `/api/service/${id}`, { reasonKind: kind });
      expect(res.statusCode, res.body).toBe(200);
      expect((await jobOf(owner, id)).reasonKind).toBe(kind);
    }
    // Three lines, each with what the kind was and what it became; read as a
    // set, so two written within one millisecond do not make the test flaky.
    const changes = (await journalOf(owner, id)).filter((l) => l.action === 'service.update').map((l) => [l.before, l.after]);
    expect(changes).toHaveLength(3);
    expect(changes).toEqual(
      expect.arrayContaining([
        [{ reasonKind: null }, { reasonKind: 'accident' }],
        [{ reasonKind: 'accident' }, { reasonKind: 'wear' }],
        [{ reasonKind: 'wear' }, { reasonKind: null }],
      ]),
    );
    expect((await call(owner, 'POST', `/api/service/${id}/cancel`, { reason: 'ТЕСТ done' })).statusCode).toBe(200);
  });

  it('on a reported breakdown that waits for the owners as well', async () => {
    const { vehicle } = await freeVehicle();
    const id = await opened(await loginAs('manager'), { vehicleId: vehicle.id, reason: 'ТЕСТ does not start' });
    const owner = await loginAs('owner');
    expect((await call(owner, 'PATCH', `/api/service/${id}`, { reasonKind: 'warranty' })).statusCode).toBe(200);
    expect(await jobOf(owner, id)).toMatchObject({ status: 'draft', reasonKind: 'warranty' });
    expect((await call(owner, 'POST', `/api/service/${id}/cancel`, { reason: 'ТЕСТ done' })).statusCode).toBe(200);
  });

  it('not on a closed repair, not with a word outside the five, and not by a manager', async () => {
    const { vehicle } = await freeVehicle();
    const owner = await loginAs('owner');
    const id = await opened(owner, { vehicleId: vehicle.id, reason: 'ТЕСТ chain', reasonKind: 'wear' });

    const manager = await loginAs('manager');
    expect((await call(manager, 'PATCH', `/api/service/${id}`, { reasonKind: 'accident' })).statusCode).toBe(403);
    const other = await call(owner, 'PATCH', `/api/service/${id}`, { reasonKind: 'other' });
    expect(other.statusCode).toBe(400);
    expect(json<{ error: string; field: string }>(other)).toMatchObject({ error: 'bad_field', field: 'reasonKind' });
    expect((await jobOf(owner, id)).reasonKind).toBe('wear');

    const closed = await call(owner, 'POST', `/api/service/${id}/close`, { odometerKm: 1200, locationId: await point() });
    expect(closed.statusCode, closed.body).toBe(200);
    const late = await call(owner, 'PATCH', `/api/service/${id}`, { reasonKind: 'accident' });
    expect(late.statusCode).toBe(409);
    expect(json<{ error: string }>(late).error).toBe('job_closed');
    expect((await jobOf(owner, id)).reasonKind).toBe('wear');
  });

  it('a mechanic’s repair is changed for another kind, never left without one', async () => {
    const { prisma, vehicle } = await freeVehicle();
    const mechanic = await makeUser('mechanic');
    const job = await prisma.serviceJob.create({
      data: { vehicleId: vehicle.id, reason: 'ТЕСТ worn pads', reasonKind: 'wear', openedOn: new Date(`${todayISO()}T00:00:00Z`), status: 'open', mechanicId: mechanic.id },
      select: { id: true },
    });
    const owner = await loginAs('owner');
    const none = await call(owner, 'PATCH', `/api/service/${job.id}`, { reasonKind: null });
    expect(none.statusCode).toBe(400);
    expect(json<{ error: string; field: string }>(none)).toMatchObject({ error: 'reason_kind_kept', field: 'reasonKind' });
    expect((await jobOf(owner, job.id)).reasonKind).toBe('wear');
    expect((await call(owner, 'PATCH', `/api/service/${job.id}`, { reasonKind: 'warranty' })).statusCode).toBe(200);
    expect((await jobOf(owner, job.id)).reasonKind).toBe('warranty');
    expect((await call(owner, 'POST', `/api/service/${job.id}/cancel`, { reason: 'ТЕСТ done' })).statusCode).toBe(200);
  });

  it('any field the owner corrects says what it held before', async () => {
    const { vehicle } = await freeVehicle();
    const owner = await loginAs('owner');
    const id = await opened(owner, { vehicleId: vehicle.id, reason: 'ТЕСТ mirror' });
    expect((await call(owner, 'PATCH', `/api/service/${id}`, { reason: 'ТЕСТ left mirror', notes: 'ТЕСТ a note' })).statusCode).toBe(200);
    const change = (await journalOf(owner, id)).find((l) => l.action === 'service.update');
    expect(change?.before).toEqual({ reason: 'ТЕСТ mirror', notes: null });
    expect(change?.after).toEqual({ reason: 'ТЕСТ left mirror', notes: 'ТЕСТ a note' });
    expect((await call(owner, 'POST', `/api/service/${id}/cancel`, { reason: 'ТЕСТ done' })).statusCode).toBe(200);
  });

  it('labour corrected says what its money was, not a bare count of minutes', async () => {
    const { vehicle } = await freeVehicle();
    const owner = await loginAs('owner');
    const id = await opened(owner, { vehicleId: vehicle.id, reason: 'ТЕСТ headlight' });
    expect((await call(owner, 'PATCH', `/api/service/${id}`, { labourHours: 1.5 })).statusCode).toBe(200);
    const change = (await journalOf(owner, id)).find((l) => l.action === 'service.update');
    expect(change?.before).toEqual({ labourTetri: 0 });
    expect(change?.after).toMatchObject({ labourMinutes: 90 });
    expect((await call(owner, 'POST', `/api/service/${id}/cancel`, { reason: 'ТЕСТ done' })).statusCode).toBe(200);
  });
});

/** A photo as the tablet sends it; the server checks the type and that there are bytes. */
const PHOTO = { mimeType: 'image/jpeg', dataBase64: Buffer.from(`test photo ${uniq()}`).toString('base64') };

describe.skipIf(!HAS_DB)('a mechanic takes over a repair the office named', () => {
  it('the tablet is told the kind, and his pick is journaled «было → стало», never a silent overwrite', async () => {
    const { prisma, vehicle } = await freeVehicle();
    const owner = await loginAs('owner');
    const id = await opened(owner, { vehicleId: vehicle.id, reason: 'ТЕСТ dropped it', reasonKind: 'renter_fault' });

    const mechanic = await makeUser('mechanic');
    const cookie = await login(mechanic.email);
    const found = await call(cookie, 'GET', `/api/service/vehicles?q=${vehicle.vin.slice(-6)}`);
    expect(found.statusCode, found.body).toBe(200);
    const row = json<{ vehicles: { id: string; openJob: { id: string; reasonKind: string | null; takeable: boolean } | null }[] }>(found).vehicles.find((v) => v.id === vehicle.id);
    expect(row?.openJob).toMatchObject({ id, reasonKind: 'renter_fault', takeable: true });

    const taken = await call(cookie, 'POST', '/api/service/workshop', {
      vehicleId: vehicle.id, jobId: id, reasonKind: 'wear', reason: 'ТЕСТ dropped it', odometerKm: 3210,
      odometerPhoto: PHOTO, photos: [PHOTO], works: [{ freeText: 'ТЕСТ new lever', qty: 1 }],
    });
    expect(taken.statusCode, taken.body).toBe(200);
    expect((await prisma.serviceJob.findUniqueOrThrow({ where: { id } })).reasonKind).toBe('wear');
    const take = (await journalOf(owner, id)).find((l) => l.action === 'service.take');
    expect(take?.before).toMatchObject({ reasonKind: 'renter_fault' });
    expect(take?.after).toMatchObject({ reasonKind: 'wear' });
    expect((await call(owner, 'POST', `/api/service/${id}/cancel`, { reason: 'ТЕСТ done' })).statusCode).toBe(200);
  });
});

// «Плановое ТО» picked in the office counts for the next maintenance as the
// tablet's does (ADR-0038 §2): the reading of the closed repair is the mark.

const ITEMS = { moped: { state: 'ok' }, key: { state: 'ok' }, battery_1: { state: 'ok' }, battery_2: { state: 'ok' }, charger_1: { state: 'ok' }, charger_2: { state: 'ok' } };

interface Maintenance {
  readingSource: string | null;
  currentKm: number | null;
  dueKm: number | null;
  lastPlanned: { jobId: string; km: number } | null;
  openPlanned: { jobId: string; status: string } | null;
}

async function maintenance(cookie: string, vehicleId: string): Promise<Maintenance | null> {
  const res = await call(cookie, 'GET', `/api/fleet/${vehicleId}`);
  expect(res.statusCode, res.body).toBe(200);
  return json<{ maintenance: Maintenance | null }>(res).maintenance;
}

/** Out on a hand-over at `outKm` and back at `backKm`: two readings EV8 Ops wrote down. */
async function backFromRental(vehicleId: string, outKm: number, backKm: number) {
  const { prisma } = await import('../src/lib/db.js');
  const customer = await prisma.customer.create({ data: { name: `ТЕСТ kind ${uniq()}`, phone: `+9955${digits().slice(-8)}`, personalId: digits().slice(-11) } });
  const owner = await loginAs('owner');
  const res = await call(owner, 'POST', '/api/pickups', {
    customerId: customer.id, vehicleId, weeklyRateTetri: 15000, depositTetri: 18000, pickedUpOn: todayISO(),
    nightParkingAddress: 'Test street 1', batteries: 2, chargers: 2, odometerKm: outKm, payment: { later: true },
  });
  expect(res.statusCode, res.body).toBe(201);
  const back = await call(owner, 'POST', `/api/rentals/${json<{ id: string }>(res).id}/return`, { odometerKm: backKm, items: ITEMS });
  expect(back.statusCode, back.body).toBe(200);
  return owner;
}

async function intervalKm(owner: string): Promise<number> {
  const res = await call(owner, 'GET', '/api/service/maintenance');
  expect(res.statusCode, res.body).toBe(200);
  return json<{ intervalKm: number }>(res).intervalKm;
}

describe.skipIf(!HAS_DB)('«Плановое ТО» from the office moves the next maintenance (ADR-0038 §2)', () => {
  it('opened as planned and closed at 4 990: the next mark is 4 990 + the interval', async () => {
    const { vehicle } = await freeVehicle();
    const owner = await backFromRental(vehicle.id, 4100, 4970);
    const id = await opened(owner, { vehicleId: vehicle.id, reason: 'ТЕСТ maintenance', reasonKind: 'planned' });
    expect((await maintenance(owner, vehicle.id))?.openPlanned).toMatchObject({ jobId: id, status: 'open' });

    const closed = await call(owner, 'POST', `/api/service/${id}/close`, { odometerKm: 4990, locationId: await point() });
    expect(closed.statusCode, closed.body).toBe(200);
    const m = await maintenance(owner, vehicle.id);
    expect(m).toMatchObject({ readingSource: 'repair_close', currentKm: 4990, dueKm: 4990 + (await intervalKm(owner)), openPlanned: null });
    expect(m?.lastPlanned).toMatchObject({ jobId: id, km: 4990 });
  });

  it('a kind the owner sets later counts the same, and one taken away does not count', async () => {
    const { vehicle } = await freeVehicle();
    const owner = await backFromRental(vehicle.id, 4200, 4960);
    const id = await opened(owner, { vehicleId: vehicle.id, reason: 'ТЕСТ maintenance' });
    expect((await maintenance(owner, vehicle.id))?.openPlanned).toBeNull();
    expect((await call(owner, 'PATCH', `/api/service/${id}`, { reasonKind: 'planned' })).statusCode).toBe(200);
    expect((await call(owner, 'POST', `/api/service/${id}/close`, { odometerKm: 4985, locationId: await point() })).statusCode).toBe(200);
    expect((await maintenance(owner, vehicle.id))?.lastPlanned).toMatchObject({ jobId: id, km: 4985 });

    // A second one opened as planned by a wrong tap and put right before closing.
    const second = await opened(owner, { vehicleId: vehicle.id, reason: 'ТЕСТ puncture', reasonKind: 'planned' });
    expect((await call(owner, 'PATCH', `/api/service/${second}`, { reasonKind: 'wear' })).statusCode).toBe(200);
    expect((await call(owner, 'POST', `/api/service/${second}/close`, { odometerKm: 5100, locationId: await point() })).statusCode).toBe(200);
    expect((await maintenance(owner, vehicle.id))?.lastPlanned).toMatchObject({ jobId: id, km: 4985 });
  });

  it('one at the renter’s, with no reading of its opening, is closed with one — or it would never count', async () => {
    const { prisma, vehicle } = await freeVehicle();
    const owner = await loginAs('owner');
    const customer = await prisma.customer.create({ data: { name: `ТЕСТ renter ${uniq()}` } });
    const rented = await call(owner, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, pickedUpOn: '2026-10-01' });
    expect(rented.statusCode, rented.body).toBe(201);
    const id = await opened(owner, { vehicleId: vehicle.id, reason: 'ТЕСТ maintenance at the renter’s', reasonKind: 'planned' });

    const bare = await call(owner, 'POST', `/api/service/${id}/close`, {});
    expect(bare.statusCode).toBe(400);
    expect(json<{ error: string; field: string }>(bare)).toMatchObject({ error: 'missing_field', field: 'odometerKm' });
    expect((await jobOf(owner, id)).status).toBe('open');

    const closed = await call(owner, 'POST', `/api/service/${id}/close`, { odometerKm: 4990 });
    expect(closed.statusCode, closed.body).toBe(200);
    expect((await maintenance(owner, vehicle.id))?.lastPlanned).toMatchObject({ jobId: id, km: 4990 });
  });

  it('any other kind at the renter’s still closes without a reading, as before', async () => {
    const { prisma, vehicle } = await freeVehicle();
    const owner = await loginAs('owner');
    const customer = await prisma.customer.create({ data: { name: `ТЕСТ renter ${uniq()}` } });
    const rented = await call(owner, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, pickedUpOn: '2026-10-01' });
    expect(rented.statusCode, rented.body).toBe(201);
    const id = await opened(owner, { vehicleId: vehicle.id, reason: 'ТЕСТ loose mirror', reasonKind: 'wear' });
    const closed = await call(owner, 'POST', `/api/service/${id}/close`, {});
    expect(closed.statusCode, closed.body).toBe(200);
  });
});
