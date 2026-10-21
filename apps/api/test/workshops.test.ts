// The workshops list in Settings → Repair (task #1 of 21.10.2026; its shape is
// the session's default, not yet confirmed by Mika): the owner adds, renames, takes off the list and puts back; nothing is
// deleted, and a repair keeps the workshop it had. Every name and the phone
// here are invented — the two real workshops are in migration 0023 and stay there.
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

interface Listed {
  id: string;
  name: string;
  phone: string | null;
  note: string | null;
  sortOrder: number;
  archived: boolean;
  jobs: number;
  openJobs: number;
}

const live = async (cookie: string) => json<{ workshops: { id: string; name: string }[] }>(await call(cookie, 'GET', '/api/workshops')).workshops;
const all = async (cookie: string) => json<{ workshops: Listed[] }>(await call(cookie, 'GET', '/api/workshops?all=1')).workshops;

async function add(cookie: string, name = `ТЕСТ мастерская ${uniq()}`): Promise<{ id: string; name: string }> {
  const res = await call(cookie, 'POST', '/api/workshops', { name, phone: '+995 000 000 000', note: 'ТЕСТ' });
  expect(res.statusCode, res.body).toBe(201);
  return json<{ id: string; name: string }>(res);
}

async function freeVehicle() {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Workshop ${uniq()}` } });
  return prisma.vehicle.create({ data: { vin: `TESTW${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id } });
}

async function openRepair(cookie: string, workshopId: string | null): Promise<string> {
  const vehicle = await freeVehicle();
  const res = await call(cookie, 'POST', '/api/service', { vehicleId: vehicle.id, reason: 'ТЕСТ тормоза', workshopId });
  expect(res.statusCode, res.body).toBe(201);
  return json<{ id: string }>(res).id;
}

const jobWorkshop = async (cookie: string, id: string) =>
  json<{ job: { workshop: { id: string; name: string } | null } }>(await call(cookie, 'GET', `/api/service/${id}`)).job.workshop;

describe.skipIf(!HAS_DB)('the owner keeps the list of workshops', () => {
  it('adds a new one at the end of the list, not ahead of the others', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const before = (await prisma.workshop.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? 0;
    const first = await add(owner);
    const second = await add(owner);

    const rows = await all(owner);
    const a = rows.find((w) => w.id === first.id)!;
    const b = rows.find((w) => w.id === second.id)!;
    expect(a.sortOrder).toBeGreaterThan(before);
    expect(b.sortOrder).toBeGreaterThan(a.sortOrder);
    expect(a).toMatchObject({ archived: false, jobs: 0, openJobs: 0, phone: '+995 000 000 000' });

    const ids = (await live(owner)).map((w) => w.id);
    expect(ids.indexOf(second.id)).toBeGreaterThan(ids.indexOf(first.id));
  });

  it('refuses a rename onto another workshop’s name with 409, not 500', async () => {
    const owner = await loginAs('owner');
    const taken = await add(owner, `TEST workshop ${uniq()}`);
    const other = await add(owner);

    const same = await call(owner, 'PATCH', `/api/workshops/${other.id}`, { name: taken.name });
    expect(same.statusCode, same.body).toBe(409);
    expect(json(same)).toMatchObject({ error: 'workshop_exists', field: 'name' });
    // One name in another case is still the same name (the index is on lower(name)).
    const shouted = await call(owner, 'PATCH', `/api/workshops/${other.id}`, { name: taken.name.toUpperCase() });
    expect(shouted.statusCode, shouted.body).toBe(409);
    // And adding it again is the same refusal.
    expect(json(await call(owner, 'POST', '/api/workshops', { name: taken.name }))).toMatchObject({ error: 'workshop_exists' });
  });

  it('renames one, and every repair of it reads the new name', async () => {
    const owner = await loginAs('owner');
    const w = await add(owner);
    const jobId = await openRepair(owner, w.id);
    const renamed = `ТЕСТ мастерская новое имя ${uniq()}`;
    const res = await call(owner, 'PATCH', `/api/workshops/${w.id}`, { name: renamed });
    expect(res.statusCode, res.body).toBe(200);
    expect(await jobWorkshop(owner, jobId)).toEqual({ id: w.id, name: renamed });
  });

  it('takes one off the list and puts it back; its repairs keep it', async () => {
    const owner = await loginAs('owner');
    const w = await add(owner);
    const jobId = await openRepair(owner, w.id);

    const off = await call(owner, 'PATCH', `/api/workshops/${w.id}`, { archived: true });
    expect(off.statusCode, off.body).toBe(200);
    // The answer says how many repairs under way stay with it.
    expect(json(off)).toMatchObject({ ok: true, openJobs: 1 });

    expect((await live(owner)).map((x) => x.id)).not.toContain(w.id);
    const kept = (await all(owner)).find((x) => x.id === w.id);
    expect(kept).toMatchObject({ archived: true, jobs: 1, openJobs: 1 });
    // Those taken off the list come last.
    const flags = (await all(owner)).map((x) => x.archived);
    expect(flags.indexOf(true)).toBeGreaterThan(flags.lastIndexOf(false));
    expect(await jobWorkshop(owner, jobId)).toMatchObject({ id: w.id, name: w.name });

    // A flag is a flag.
    const yes = await call(owner, 'PATCH', `/api/workshops/${w.id}`, { archived: 'yes' });
    expect(yes.statusCode, yes.body).toBe(400);
    expect(json(yes)).toMatchObject({ error: 'bad_field', field: 'archived' });

    const back = await call(owner, 'PATCH', `/api/workshops/${w.id}`, { archived: false });
    expect(back.statusCode, back.body).toBe(200);
    expect((await live(owner)).map((x) => x.id)).toContain(w.id);
  });

  it('says to put back a workshop taken off the list rather than add it again', async () => {
    const owner = await loginAs('owner');
    const w = await add(owner);
    await call(owner, 'PATCH', `/api/workshops/${w.id}`, { archived: true });

    const again = await call(owner, 'POST', '/api/workshops', { name: w.name });
    expect(again.statusCode, again.body).toBe(409);
    expect(json(again)).toMatchObject({ error: 'workshop_archived_exists', field: 'name', id: w.id });

    const other = await add(owner);
    const onto = await call(owner, 'PATCH', `/api/workshops/${other.id}`, { name: w.name });
    expect(onto.statusCode, onto.body).toBe(409);
    expect(json(onto)).toMatchObject({ error: 'workshop_archived_exists', id: w.id });
  });

  it('is the owner’s to change', async () => {
    const owner = await loginAs('owner');
    const manager = await loginAs('manager');
    const w = await add(owner);
    expect((await call(manager, 'POST', '/api/workshops', { name: `ТЕСТ мастерская ${uniq()}` })).statusCode).toBe(403);
    expect((await call(manager, 'PATCH', `/api/workshops/${w.id}`, { archived: true })).statusCode).toBe(403);
    expect((await call(owner, 'PATCH', '/api/workshops/00000000-0000-4000-8000-000000000000', { name: 'x' })).statusCode).toBe(404);
  });

  it('writes the change into the journal, from what to what, under the workshop’s name', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const w = await add(owner);
    await call(owner, 'PATCH', `/api/workshops/${w.id}`, { archived: true });

    const entry = await prisma.auditLog.findFirst({ where: { action: 'workshop.update', entityId: w.id }, orderBy: { createdAt: 'desc' } });
    expect(entry?.before).toMatchObject({ name: w.name, archived: false });
    expect(entry?.after).toMatchObject({ archived: true });

    const lines = json<{ rows: { action: string; number: string | null }[] }>(await call(owner, 'GET', `/api/journal?q=${encodeURIComponent(w.name)}`)).rows;
    expect(lines.map((l) => l.action)).toEqual(expect.arrayContaining(['workshop.create', 'workshop.update']));
    expect(lines.every((l) => l.number === w.name)).toBe(true);
  });
});

describe.skipIf(!HAS_DB)('a repair is given a workshop from the list', () => {
  it('refuses one taken off the list and one that does not exist — no more 500', async () => {
    const owner = await loginAs('owner');
    const w = await add(owner);
    await call(owner, 'PATCH', `/api/workshops/${w.id}`, { archived: true });

    const vehicle = await freeVehicle();
    const archived = await call(owner, 'POST', '/api/service', { vehicleId: vehicle.id, reason: 'ТЕСТ', workshopId: w.id });
    expect(archived.statusCode, archived.body).toBe(409);
    expect(json(archived)).toMatchObject({ error: 'workshop_archived', field: 'workshopId' });

    const unknown = await call(owner, 'POST', '/api/service', { vehicleId: vehicle.id, reason: 'ТЕСТ', workshopId: '00000000-0000-4000-8000-000000000000' });
    expect(unknown.statusCode, unknown.body).toBe(404);
    expect(json(unknown)).toMatchObject({ error: 'workshop_not_found' });

    const garbled = await call(owner, 'POST', '/api/service', { vehicleId: vehicle.id, reason: 'ТЕСТ', workshopId: 'not-a-workshop' });
    expect(garbled.statusCode, garbled.body).toBe(404);
    expect(json(garbled)).toMatchObject({ error: 'workshop_not_found' });

    // Nothing was opened by the refusals: the same moped still takes a repair.
    const opened = await call(owner, 'POST', '/api/service', { vehicleId: vehicle.id, reason: 'ТЕСТ', workshopId: null });
    expect(opened.statusCode, opened.body).toBe(201);
  });

  it('lets a repair keep the workshop it has after it is taken off the list, but not move to another such', async () => {
    const owner = await loginAs('owner');
    const kept = await add(owner);
    const gone = await add(owner);
    const jobId = await openRepair(owner, kept.id);
    await call(owner, 'PATCH', `/api/workshops/${kept.id}`, { archived: true });
    await call(owner, 'PATCH', `/api/workshops/${gone.id}`, { archived: true });

    // The card saved again with the same workshop is not a refusal.
    const same = await call(owner, 'PATCH', `/api/service/${jobId}`, { workshopId: kept.id, notes: 'ТЕСТ заметка' });
    expect(same.statusCode, same.body).toBe(200);
    expect(await jobWorkshop(owner, jobId)).toMatchObject({ id: kept.id });

    const moved = await call(owner, 'PATCH', `/api/service/${jobId}`, { workshopId: gone.id });
    expect(moved.statusCode, moved.body).toBe(409);
    expect(json(moved)).toMatchObject({ error: 'workshop_archived' });

    const unknown = await call(owner, 'PATCH', `/api/service/${jobId}`, { workshopId: '00000000-0000-4000-8000-000000000000' });
    expect(unknown.statusCode, unknown.body).toBe(404);

    // Moving to a live one, or to none, is as before.
    const fresh = await add(owner);
    expect((await call(owner, 'PATCH', `/api/service/${jobId}`, { workshopId: fresh.id })).statusCode).toBe(200);
    expect((await call(owner, 'PATCH', `/api/service/${jobId}`, { workshopId: null })).statusCode).toBe(200);
    expect(await jobWorkshop(owner, jobId)).toBeNull();
  });
});
