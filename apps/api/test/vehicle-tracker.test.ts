// A tracker already on a moped, written and corrected by an owner on the
// moped's card without a repair (ADR-0036, addendum 21.10.2026). Mopeds,
// people, IMEIs and SIMs are invented test values: the IMEIs begin with 99 and
// are made valid by their check digit, never read off a tracker.
import { addDays, todayISO } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

/** An invented IMEI with a good check digit — never one off a real tracker. */
function imei(): string {
  const body = `99${String(Math.floor(Math.random() * 1e12)).padStart(12, '0')}`;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let d = Number(body[13 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return body + String((10 - (sum % 10)) % 10);
}

/** The same IMEI with its check digit wrong: a digit typed wrong. */
const misread = (x: string) => `${x.slice(0, 14)}${(Number(x[14]) + 1) % 10}`;

async function moped(opts: { state?: 'available' | 'sold' | 'out'; arrivedOn?: string } = {}) {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Tracker ${uniq()}`, forRent: true } });
  return prisma.vehicle.create({
    data: {
      vin: `TESTT${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`,
      modelId: model.id,
      state: opts.state ?? 'available',
      arrivedOn: opts.arrivedOn ? new Date(`${opts.arrivedOn}T00:00:00Z`) : null,
    },
  });
}

interface CardTracker {
  imei: string;
  simPhone: string | null;
  installedOn: string;
  removedOn: string | null;
  source: string | null;
  job: { id: string } | null;
}
interface Card {
  trackers: CardTracker[] | null;
  journal: { action: string; before: unknown; after: unknown }[];
}
async function cardOf(cookie: string, id: string): Promise<Card> {
  const res = await call(cookie, 'GET', `/api/fleet/${id}`);
  expect(res.statusCode, res.body).toBe(200);
  return json<Card>(res);
}

const errorOf = (res: { body: string }) => json<{ error: string }>(res).error;

/** What the moped's journal holds about its tracker. */
async function trackerLines(vehicleId: string) {
  const { prisma } = await import('../src/lib/db.js');
  return prisma.auditLog.findMany({
    where: { entityType: 'vehicle', entityId: vehicleId, action: { in: ['tracker.write', 'tracker.correct'] } },
    orderBy: { createdAt: 'asc' },
    select: { action: true, before: true, after: true },
  });
}

describe.skipIf(!HAS_DB)('an owner writes a tracker already on the moped (ADR-0036, addendum 21.10.2026)', () => {
  it('writes it from the card, with no repair, and «стоит с» today unless told otherwise', async () => {
    const owner = await loginAs('owner');
    const v = await moped();
    const x = imei();
    const res = await call(owner, 'POST', `/api/fleet/${v.id}/tracker`, { imei: x.replace(/(\d{3})/g, '$1 '), sim: '+995 555 01 03 01' });
    expect(res.statusCode, res.body).toBe(201);

    const card = await cardOf(owner, v.id);
    expect(card.trackers).toHaveLength(1);
    expect(card.trackers![0]).toMatchObject({ imei: x, simPhone: '+995555010301', installedOn: todayISO(), removedOn: null, source: 'card', job: null });

    // A day somebody knows is taken as it is.
    const w = await moped({ arrivedOn: '2026-06-01' });
    const y = imei();
    expect((await call(owner, 'POST', `/api/fleet/${w.id}/tracker`, { imei: y, sim: '555010302', installedOn: '2026-07-15' })).statusCode).toBe(201);
    expect((await cardOf(owner, w.id)).trackers![0]).toMatchObject({ imei: y, installedOn: '2026-07-15' });
  });

  it('refuses what is not a tracker, a day that cannot be, and a moped that left the fleet', async () => {
    const owner = await loginAs('owner');
    const v = await moped({ arrivedOn: '2026-09-01' });
    const x = imei();
    for (const [body, code] of [
      [{ sim: '555010303' }, 'missing_field'],
      [{ imei: misread(x), sim: '555010303' }, 'imei_bad'],
      [{ imei: x }, 'missing_field'],
      [{ imei: x, sim: 'none' }, 'sim_bad'],
      [{ imei: x, sim: '555010303', installedOn: addDays(todayISO(), 1) }, 'tracker_date_bad'],
      [{ imei: x, sim: '555010303', installedOn: '2026-08-31' }, 'tracker_date_bad'],
      [{ imei: x, sim: '555010303', installedOn: '31.08.2026' }, 'bad_field'],
    ] as const) {
      const res = await call(owner, 'POST', `/api/fleet/${v.id}/tracker`, body);
      expect(res.statusCode, `${code}: ${res.body}`).toBe(400);
      expect(errorOf(res)).toBe(code);
    }
    const dayRefused = json<{ field: string; fault: string }>(await call(owner, 'POST', `/api/fleet/${v.id}/tracker`, { imei: x, sim: '555010303', installedOn: '2026-08-31' }));
    expect(dayRefused).toMatchObject({ field: 'installedOn', fault: 'before_arrival' });
    expect((await cardOf(owner, v.id)).trackers).toEqual([]);

    for (const state of ['sold', 'out'] as const) {
      const gone = await moped({ state });
      const res = await call(owner, 'POST', `/api/fleet/${gone.id}/tracker`, { imei: x, sim: '555010303' });
      expect(res.statusCode, res.body).toBe(409);
      expect(errorOf(res)).toBe('vehicle_gone');
    }
    const nobody = await call(owner, 'POST', '/api/fleet/00000000-0000-4000-8000-000000000000/tracker', { imei: x, sim: '555010303' });
    expect(nobody.statusCode).toBe(404);
    expect(errorOf(nobody)).toBe('vehicle_not_found');
  });

  it('keeps one tracker on a moped and one moped to an IMEI, as a repair does', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const a = await moped();
    const b = await moped();
    const x = imei();
    expect((await call(owner, 'POST', `/api/fleet/${a.id}/tracker`, { imei: x, sim: '555010304' })).statusCode).toBe(201);

    const second = await call(owner, 'POST', `/api/fleet/${a.id}/tracker`, { imei: imei(), sim: '555010305' });
    expect(second.statusCode).toBe(409);
    expect(errorOf(second)).toBe('tracker_on_vehicle');

    const twice = await call(owner, 'POST', `/api/fleet/${b.id}/tracker`, { imei: x, sim: '555010306' });
    expect(twice.statusCode).toBe(409);
    expect(errorOf(twice)).toBe('tracker_imei_in_use');
    expect(await prisma.vehicleTracker.count({ where: { imei: x, removedOn: null } })).toBe(1);
    expect((await cardOf(owner, b.id)).trackers).toEqual([]);
  });

  it('is the owners’: a manager neither writes, corrects nor reads the numbers (ADR-0036 §7)', async () => {
    const owner = await loginAs('owner');
    const manager = await loginAs('manager');
    const v = await moped();
    const x = imei();
    expect((await call(manager, 'POST', `/api/fleet/${v.id}/tracker`, { imei: x, sim: '555010307' })).statusCode).toBe(403);
    expect((await call(owner, 'POST', `/api/fleet/${v.id}/tracker`, { imei: x, sim: '555010307' })).statusCode).toBe(201);
    expect((await call(manager, 'PATCH', `/api/fleet/${v.id}/tracker`, { sim: '555010308' })).statusCode).toBe(403);
    // The card a manager reads carries the history of the moped, and that
    // history says a tracker was written — not which one.
    const res = await call(manager, 'GET', `/api/fleet/${v.id}`);
    expect(res.statusCode).toBe(200);
    expect(json<Card>(res).trackers).toBeNull();
    expect(json<Card>(res).journal.map((l) => l.action)).toContain('tracker.write');
    expect(res.body).not.toContain(x);
    expect(res.body).not.toContain('555010307');
  });
});

describe.skipIf(!HAS_DB)('an owner corrects the tracker on the moped', () => {
  it('puts a SIM changed and a digit typed wrong right, and the journal keeps tails only', async () => {
    const owner = await loginAs('owner');
    const v = await moped();
    const x = imei();
    const y = imei();
    expect((await call(owner, 'POST', `/api/fleet/${v.id}/tracker`, { imei: x, sim: '555010309' })).statusCode).toBe(201);

    const sim = await call(owner, 'PATCH', `/api/fleet/${v.id}/tracker`, { imei: x, sim: '555010310' });
    expect(sim.statusCode, sim.body).toBe(200);
    expect(json<{ changed: boolean }>(sim).changed).toBe(true);
    const fixed = await call(owner, 'PATCH', `/api/fleet/${v.id}/tracker`, { imei: y.replace(/(\d{3})/g, '$1-') });
    expect(fixed.statusCode, fixed.body).toBe(200);
    expect((await cardOf(owner, v.id)).trackers![0]).toMatchObject({ imei: y, simPhone: '555010310', removedOn: null });

    const lines = await trackerLines(v.id);
    expect(lines.map((l) => l.action)).toEqual(['tracker.write', 'tracker.correct', 'tracker.correct']);
    expect(lines[1]).toMatchObject({ before: { sim: 'SIM ···0309' }, after: { sim: 'SIM ···0310' } });
    expect(lines[2]).toMatchObject({ before: { imei: `IMEI ···${x.slice(-4)}` }, after: { imei: `IMEI ···${y.slice(-4)}` } });
    const written = JSON.stringify(lines);
    for (const number of [x, y, '555010309', '555010310']) expect(written).not.toContain(number);
  });

  it('writes nothing when nothing changes — the same SIM written another way included', async () => {
    const owner = await loginAs('owner');
    const v = await moped();
    const x = imei();
    expect((await call(owner, 'POST', `/api/fleet/${v.id}/tracker`, { imei: x, sim: '555010311' })).statusCode).toBe(201);
    for (const body of [{ imei: x, sim: '555010311' }, { sim: '+995 555 01 03 11' }]) {
      const res = await call(owner, 'PATCH', `/api/fleet/${v.id}/tracker`, body);
      expect(res.statusCode, res.body).toBe(200);
      expect(json<{ changed: boolean }>(res).changed).toBe(false);
    }
    expect((await trackerLines(v.id)).map((l) => l.action)).toEqual(['tracker.write']);
    expect((await cardOf(owner, v.id)).trackers![0].simPhone).toBe('555010311');
  });

  it('refuses a moped with no tracker, an IMEI on another moped, a number misread and an empty request', async () => {
    const owner = await loginAs('owner');
    const a = await moped();
    const b = await moped();
    const x = imei();
    const y = imei();
    const none = await call(owner, 'PATCH', `/api/fleet/${a.id}/tracker`, { sim: '555010312' });
    expect(none.statusCode).toBe(404);
    expect(errorOf(none)).toBe('tracker_none');

    expect((await call(owner, 'POST', `/api/fleet/${a.id}/tracker`, { imei: x, sim: '555010312' })).statusCode).toBe(201);
    expect((await call(owner, 'POST', `/api/fleet/${b.id}/tracker`, { imei: y, sim: '555010313' })).statusCode).toBe(201);
    const taken = await call(owner, 'PATCH', `/api/fleet/${b.id}/tracker`, { imei: x });
    expect(taken.statusCode).toBe(409);
    expect(errorOf(taken)).toBe('tracker_imei_in_use');
    for (const [body, code] of [
      [{ imei: misread(y) }, 'imei_bad'],
      [{ sim: 'none' }, 'sim_bad'],
      [{}, 'missing_field'],
    ] as const) {
      const res = await call(owner, 'PATCH', `/api/fleet/${b.id}/tracker`, body);
      expect(res.statusCode, `${code}: ${res.body}`).toBe(400);
      expect(errorOf(res)).toBe(code);
    }
    expect((await cardOf(owner, b.id)).trackers![0]).toMatchObject({ imei: y, simPhone: '555010313' });
  });

  it('corrects a tracker fitted in a repair as well: a SIM changed is not a repair', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const v = await moped();
    const x = imei();
    const part = await call(owner, 'POST', '/api/parts', { name: `ТЕСТ трекер ${uniq()}`, isTracker: true, salePriceTetri: '35' });
    expect(part.statusCode, part.body).toBe(201);
    const opened = await call(owner, 'POST', '/api/service', { vehicleId: v.id, reason: 'ТЕСТ tracker' });
    expect(opened.statusCode, opened.body).toBe(201);
    const jobId = json<{ id: string }>(opened).id;
    const fitted = await call(owner, 'POST', `/api/service/${jobId}/parts`, { kind: 'stock', partId: json<{ id: string }>(part).id, qty: 1, unitPriceTetri: 0, imei: x, sim: '555010314' });
    expect(fitted.statusCode, fitted.body).toBe(201);

    const res = await call(owner, 'PATCH', `/api/fleet/${v.id}/tracker`, { sim: '555010315' });
    expect(res.statusCode, res.body).toBe(200);
    const kept = await prisma.vehicleTracker.findFirst({ where: { vehicleId: v.id, removedOn: null } });
    expect(kept).toMatchObject({ imei: x, simPhone: '555010315', serviceJobId: jobId, source: null });
    await call(owner, 'POST', `/api/service/${jobId}/cancel`, { reason: 'ТЕСТ done' });
  });
});

describe.skipIf(!HAS_DB)('a tracker written on the card and the repairs', () => {
  it('comes off in a repair, closed on the moped and not onto the shelf; the next one starts no earlier', async () => {
    const owner = await loginAs('owner');
    const v = await moped();
    const x = imei();
    expect((await call(owner, 'POST', `/api/fleet/${v.id}/tracker`, { imei: x, sim: '555010316' })).statusCode).toBe(201);
    const opened = await call(owner, 'POST', '/api/service', { vehicleId: v.id, reason: 'ТЕСТ tracker off' });
    expect(opened.statusCode, opened.body).toBe(201);
    const jobId = json<{ id: string }>(opened).id;
    // The repair says so before the mechanic answers, so the form does not promise a shelf.
    const before = await call(owner, 'GET', `/api/service/${jobId}`);
    expect(before.statusCode, before.body).toBe(200);
    expect(json<{ job: { vehicle: { tracker: unknown } } }>(before).job.vehicle.tracker).toMatchObject({ imei: x, fromShelf: false });

    const off = await call(owner, 'POST', `/api/service/${jobId}/tracker/remove`, { working: true });
    expect(off.statusCode, off.body).toBe(201);
    // No part was ever taken off a shelf for it, so there is no shelf to go back to.
    expect(json<{ toShelf: boolean }>(off).toShelf).toBe(false);
    const card = await cardOf(owner, v.id);
    expect(card.trackers![0]).toMatchObject({ imei: x, removedOn: todayISO() });

    // A new tracker may go on the same day the old came off, not before.
    const early = await call(owner, 'POST', `/api/fleet/${v.id}/tracker`, { imei: imei(), sim: '555010317', installedOn: addDays(todayISO(), -1) });
    expect(early.statusCode).toBe(400);
    expect(json<{ error: string; fault: string }>(early)).toMatchObject({ error: 'tracker_date_bad', fault: 'before_last_removed' });
    expect((await call(owner, 'POST', `/api/fleet/${v.id}/tracker`, { imei: imei(), sim: '555010317' })).statusCode).toBe(201);
    await call(owner, 'POST', `/api/service/${jobId}/cancel`, { reason: 'ТЕСТ done' });
  });

  it('stays on the moped when a repair on it is called off: that repair never fitted it', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const v = await moped();
    const x = imei();
    expect((await call(owner, 'POST', `/api/fleet/${v.id}/tracker`, { imei: x, sim: '555010318' })).statusCode).toBe(201);
    const opened = await call(owner, 'POST', '/api/service', { vehicleId: v.id, reason: 'ТЕСТ called off' });
    expect(opened.statusCode, opened.body).toBe(201);
    const cancelled = await call(owner, 'POST', `/api/service/${json<{ id: string }>(opened).id}/cancel`, { reason: 'ТЕСТ called off' });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(await prisma.vehicleTracker.count({ where: { vehicleId: v.id, imei: x, removedOn: null } })).toBe(1);
  });
});
