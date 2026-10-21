// Parts and trackers in the mechanic's repair (stage 4 of
// docs/spec/mechanic-in-erp-plan.md; ADR-0036). The "Сдан" points of the
// stage are tests here: the shelf's count and moving average after every kind
// of line, a receipt at nought among them; no two working trackers with one
// IMEI. Mopeds, parts, prices, people, IMEIs and SIMs are invented test values.
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, login, loginAs, makeUser, uniq } from './helpers.js';

const PHOTO = { mimeType: 'image/jpeg', dataBase64: Buffer.from(`test photo ${uniq()}`).toString('base64') };

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

async function person(role: 'mechanic' | 'chief_mechanic' | 'owner' | 'manager') {
  const u = await makeUser(role);
  return { id: u.id, cookie: await login(u.email) };
}

async function moped(state: 'available' | 'out' = 'available') {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Parts ${uniq()}`, forRent: true } });
  return prisma.vehicle.create({
    data: { vin: `TESTP${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id, state },
  });
}

/** A part of the test's own, with a shelf to start from. */
async function shelfPart(owner: string, opts: { qty?: number; unitCostTetri?: number; isTracker?: boolean } = {}) {
  const { prisma } = await import('../src/lib/db.js');
  const res = await call(owner, 'POST', '/api/parts', { name: `ТЕСТ деталь ${uniq()}`, isTracker: opts.isTracker === true, salePriceTetri: '35' });
  expect(res.statusCode, res.body).toBe(201);
  const { id } = json<{ id: string }>(res);
  if (opts.qty) {
    await prisma.stockMove.create({ data: { partId: id, kind: 'receipt', qty: opts.qty, unitCostTetri: opts.unitCostTetri ?? 2000, occurredOn: new Date('2026-04-01T00:00:00Z') } });
  }
  return id;
}

interface Shelf {
  onHand: number;
  valueTetri: number;
  avgCostTetri: number | null;
}
async function shelfOf(owner: string, partId: string): Promise<Shelf> {
  const res = await call(owner, 'GET', `/api/parts/${partId}`);
  expect(res.statusCode, res.body).toBe(200);
  const { part } = json<{ part: Shelf }>(res);
  return { onHand: part.onHand, valueTetri: part.valueTetri, avgCostTetri: part.avgCostTetri };
}

/** A mechanic's repair on a moped, approved by the chief mechanic: in work. */
async function repairInWork(owner: string, mech: string, chief: string, vehicleId: string) {
  const { importWorkBook } = await import('../src/lib/workBook.js');
  await importWorkBook();
  const w = await call(owner, 'POST', '/api/work-book/works', { category: 'OT', nameRu: `Тестовая работа ${uniq()}`, normMin: 30 });
  expect(w.statusCode, w.body).toBe(201);
  const opened = await call(mech, 'POST', '/api/service/workshop', {
    vehicleId,
    reasonKind: 'wear',
    reason: 'test repair',
    odometerKm: 1000,
    odometerPhoto: PHOTO,
    photos: [PHOTO],
    works: [{ workTypeId: json<{ id: string }>(w).id, qty: 1 }],
  });
  expect(opened.statusCode, opened.body).toBe(201);
  const { id } = json<{ id: string }>(opened);
  const ok = await call(chief, 'POST', `/api/service/${id}/approve`);
  expect(ok.statusCode, ok.body).toBe(200);
  return id;
}

interface PartLine {
  id: string;
  kind: string;
  qty: number;
  unitPriceTetri: number | null;
  lineTetri: number | null;
  paidTetri: number | null;
  state: string | null;
  donor: { number: string | null } | null;
  tracker: { imei: string | null; simPhone: string | null } | null;
}
interface Job {
  status: string;
  partsTetri: number | null;
  parts: PartLine[];
  batteries: { item: string; kind: string; qty: number }[];
  vehicle: { tracker: { imei: string | null; simPhone: string | null } | null };
  trackers: { fitted: { imei: string | null }[]; removed: { imei: string | null }[] };
}
async function jobOf(cookie: string, id: string): Promise<Job> {
  const res = await call(cookie, 'GET', `/api/service/${id}`);
  expect(res.statusCode, res.body).toBe(200);
  return json<{ job: Job }>(res).job;
}

/** A repair left open would sit in the owners' «Сегодня»; the suite closes what it opened. */
async function settle(...ids: string[]) {
  const owner = await loginAs('owner');
  for (const id of ids) await call(owner, 'POST', `/api/service/${id}/cancel`, { reason: 'ТЕСТ done' });
}

describe.skipIf(!HAS_DB)('the shelf after every kind of repair line (stage 4 «Сдан»)', () => {
  it('off the shelf, taken off at nought, bought, off a donor — the count and the average after each', async () => {
    const owner = await loginAs('owner');
    const mech = await person('mechanic');
    const chief = await person('chief_mechanic');
    const vehicle = await moped();
    const donor = await moped('out');
    // Four on the shelf at 20.00 ₾.
    const partId = await shelfPart(owner, { qty: 4, unitCostTetri: 2000 });
    const jobId = await repairInWork(owner, mech.cookie, chief.cookie, vehicle.id);

    // Off the shelf: two out, the average stays.
    const stock = await call(mech.cookie, 'POST', `/api/service/${jobId}/parts`, { kind: 'stock', partId, qty: 2 });
    expect(stock.statusCode, stock.body).toBe(201);
    expect(await shelfOf(owner, partId)).toEqual({ onHand: 2, valueTetri: 4000, avgCostTetri: 2000 });

    // Taken off this moped, working: two in at nought, and the average falls.
    const removed = await call(mech.cookie, 'POST', `/api/service/${jobId}/parts`, { kind: 'removed', partId, qty: 2 });
    expect(removed.statusCode, removed.body).toBe(201);
    expect(await shelfOf(owner, partId)).toEqual({ onHand: 4, valueTetri: 4000, avgCostTetri: 1000 });

    // Bought by the mechanic: it waits, and the shelf does not move until it is approved…
    const bought = await call(mech.cookie, 'POST', `/api/service/${jobId}/parts`, { kind: 'bought', partId, qty: 1, paidTetri: '18,00', receiptPhoto: PHOTO });
    expect(bought.statusCode, bought.body).toBe(201);
    expect(json<{ status: string }>(bought).status).toBe('draft');
    let job = await jobOf(mech.cookie, jobId);
    expect(job.status).toBe('draft');
    expect(job.parts.find((p) => p.kind === 'bought')).toMatchObject({ state: 'waiting', paidTetri: 1800, unitPriceTetri: null });
    expect(await shelfOf(owner, partId)).toEqual({ onHand: 4, valueTetri: 4000, avgCostTetri: 1000 });
    // …and once approved it passes through at its receipt: the shelf as it was.
    expect((await call(chief.cookie, 'POST', `/api/service/${jobId}/approve`)).statusCode).toBe(200);
    expect(await shelfOf(owner, partId)).toEqual({ onHand: 4, valueTetri: 4000, avgCostTetri: 1000 });
    job = await jobOf(mech.cookie, jobId);
    expect(job.status).toBe('open');
    expect(job.parts.find((p) => p.kind === 'bought')!.state).toBe('approved');

    // Off a donor: passes through at nought, the shelf as it was; the donor's card says what went.
    const fromDonor = await call(mech.cookie, 'POST', `/api/service/${jobId}/parts`, { kind: 'donor', partId, qty: 1, donorVehicleId: donor.id });
    expect(fromDonor.statusCode, fromDonor.body).toBe(201);
    expect(await shelfOf(owner, partId)).toEqual({ onHand: 4, valueTetri: 4000, avgCostTetri: 1000 });
    const card = json<{ donated: { qty: number; job: { id: string } }[] }>(await call(owner, 'GET', `/api/fleet/${donor.id}`));
    expect(card.donated).toEqual([expect.objectContaining({ qty: 1, job: expect.objectContaining({ id: jobId }) })]);

    // What the repair cost: the shelf's two at 20.00, the receipt, nought for the rest.
    job = await jobOf(owner, jobId);
    expect(job.partsTetri).toBe(2 * 2000 + 1800);
    expect(job.parts.map((p) => [p.kind, p.lineTetri])).toEqual([
      ['stock', 4000],
      ['removed', 0],
      ['bought', 1800],
      ['donor', 0],
    ]);
    // The shelf's prices are not the mechanic's to see; his own receipt is.
    const his = await jobOf(mech.cookie, jobId);
    expect(his.parts.every((p) => p.unitPriceTetri == null && p.lineTetri == null)).toBe(true);

    // The line taken off by mistake goes off the shelf again at the nought it came in at.
    const removedId = json<{ id: string }>(removed).id;
    expect((await call(mech.cookie, 'DELETE', `/api/service/${jobId}/parts/${removedId}`)).statusCode).toBe(200);
    expect(await shelfOf(owner, partId)).toEqual({ onHand: 2, valueTetri: 4000, avgCostTetri: 2000 });
    await settle(jobId);
  });

  it('a bought part goes in only with its receipt, and refused it is struck through and costs nothing', async () => {
    const owner = await loginAs('owner');
    const mech = await person('mechanic');
    const chief = await person('chief_mechanic');
    const vehicle = await moped();
    const jobId = await repairInWork(owner, mech.cookie, chief.cookie, vehicle.id);
    const before = (await jobOf(owner, jobId)).parts.length;

    const bare = await call(mech.cookie, 'POST', `/api/service/${jobId}/parts`, { kind: 'bought', name: 'cable from the shop', paidTetri: '18' });
    expect(bare.statusCode).toBe(400);
    expect(json<{ error: string }>(bare).error).toBe('receipt_photo_missing');
    expect((await jobOf(owner, jobId)).parts).toHaveLength(before);
    expect((await jobOf(owner, jobId)).status).toBe('open');

    // No limit on the sum (register #111): a large receipt is written and waits.
    const big = await call(mech.cookie, 'POST', `/api/service/${jobId}/parts`, { kind: 'bought', name: 'controller from the shop', paidTetri: '950', receiptPhoto: PHOTO });
    expect(big.statusCode, big.body).toBe(201);
    const refused = await call(chief.cookie, 'POST', `/api/service/${jobId}/reject`, { reason: 'too dear, ask first' });
    expect(refused.statusCode, refused.body).toBe(200);
    const job = await jobOf(owner, jobId);
    expect(job.status).toBe('open');
    expect(job.parts.find((p) => p.kind === 'bought')).toMatchObject({ state: 'rejected', lineTetri: 0 });
    expect(job.partsTetri).toBe(0);
    await settle(jobId);
  });

  it('writes into his own repair only, and not into a closed one', async () => {
    const owner = await loginAs('owner');
    const mech = await person('mechanic');
    const other = await person('mechanic');
    const chief = await person('chief_mechanic');
    const vehicle = await moped();
    const partId = await shelfPart(owner, { qty: 1 });
    const jobId = await repairInWork(owner, mech.cookie, chief.cookie, vehicle.id);
    const theirs = await call(other.cookie, 'POST', `/api/service/${jobId}/parts`, { kind: 'stock', partId, qty: 1 });
    expect(theirs.statusCode).toBe(404);
    await settle(jobId);
    const closed = await call(mech.cookie, 'POST', `/api/service/${jobId}/parts`, { kind: 'stock', partId, qty: 1 });
    expect(closed.statusCode).toBe(409);
    expect(json<{ error: string }>(closed).error).toBe('job_closed');
    // A manager reports breakdowns and writes no parts.
    const manager = await loginAs('manager');
    expect((await call(manager, 'POST', `/api/service/${jobId}/parts`, { kind: 'stock', partId, qty: 1 })).statusCode).toBe(403);
  });
});

describe.skipIf(!HAS_DB)('a tracker belongs to a moped (stage 4 «Сдан», ADR-0036)', () => {
  it('two working trackers with one IMEI are impossible — on the screen and in the database', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const mech = await person('mechanic');
    const chief = await person('chief_mechanic');
    const a = await moped();
    const b = await moped();
    const trackerPart = await shelfPart(owner, { qty: 3, unitCostTetri: 9500, isTracker: true });
    const jobA = await repairInWork(owner, mech.cookie, chief.cookie, a.id);
    const jobB = await repairInWork(owner, mech.cookie, chief.cookie, b.id);
    const x = imei();

    // Asked for: the IMEI and the SIM, one tracker a line, the check digit right.
    for (const [body, code] of [
      [{ sim: '555010203' }, 'missing_field'],
      [{ imei: `${x.slice(0, 14)}${(Number(x[14]) + 1) % 10}`, sim: '555010203' }, 'imei_bad'],
      [{ imei: x, sim: 'none' }, 'sim_bad'],
      [{ imei: x, sim: '555010203', qty: 2 }, 'bad_field'],
    ] as const) {
      const res = await call(mech.cookie, 'POST', `/api/service/${jobA}/parts`, { kind: 'stock', partId: trackerPart, qty: 1, ...body });
      expect(res.statusCode, `${code}: ${res.body}`).toBe(400);
      expect(json<{ error: string }>(res).error).toBe(code);
    }
    expect((await shelfOf(owner, trackerPart)).onHand).toBe(3);

    const fitted = await call(mech.cookie, 'POST', `/api/service/${jobA}/parts`, { kind: 'stock', partId: trackerPart, qty: 1, imei: x.replace(/(\d{3})/g, '$1 '), sim: '+995 555 01 02 03' });
    expect(fitted.statusCode, fitted.body).toBe(201);
    expect((await jobOf(mech.cookie, jobA)).vehicle.tracker).toMatchObject({ imei: x, simPhone: '+995555010203' });
    expect((await shelfOf(owner, trackerPart)).onHand).toBe(2);

    // The same IMEI on another moped is refused, and nothing is written.
    const twice = await call(mech.cookie, 'POST', `/api/service/${jobB}/parts`, { kind: 'stock', partId: trackerPart, qty: 1, imei: x, sim: '555010204' });
    expect(twice.statusCode).toBe(409);
    expect(json<{ error: string }>(twice).error).toBe('tracker_imei_in_use');
    expect((await shelfOf(owner, trackerPart)).onHand).toBe(2);
    expect((await jobOf(mech.cookie, jobB)).parts).toHaveLength(0);
    // A second tracker on the same moped too.
    const second = await call(mech.cookie, 'POST', `/api/service/${jobA}/parts`, { kind: 'stock', partId: trackerPart, qty: 1, imei: imei(), sim: '555010205' });
    expect(json<{ error: string }>(second).error).toBe('tracker_on_vehicle');
    // And the database refuses it whatever the API says.
    await expect(prisma.vehicleTracker.create({ data: { vehicleId: b.id, imei: x, installedOn: new Date('2026-10-20T00:00:00Z') } })).rejects.toThrow();

    // Taken off, working: closed on the moped and back on the shelf at nought.
    const off = await call(mech.cookie, 'POST', `/api/service/${jobA}/tracker/remove`, { working: true });
    expect(off.statusCode, off.body).toBe(201);
    const jobAfter = await jobOf(mech.cookie, jobA);
    expect(jobAfter.vehicle.tracker).toBeNull();
    expect(jobAfter.trackers.removed).toEqual([expect.objectContaining({ imei: x })]);
    expect(await shelfOf(owner, trackerPart)).toEqual({ onHand: 3, valueTetri: 2 * 9500, avgCostTetri: Math.round((2 * 9500) / 3) });
    // Now it may go on the other moped.
    const moved = await call(mech.cookie, 'POST', `/api/service/${jobB}/parts`, { kind: 'stock', partId: trackerPart, qty: 1, imei: x, sim: '555010204' });
    expect(moved.statusCode, moved.body).toBe(201);
    expect(await prisma.vehicleTracker.count({ where: { imei: x, removedOn: null } })).toBe(1);

    // The IMEI and the SIM are the owners' and the workshop's, not a manager's.
    const manager = await loginAs('manager');
    expect((await jobOf(manager, jobB)).vehicle.tracker).toEqual(expect.objectContaining({ imei: null, simPhone: null }));
    const card = json<{ trackers: unknown }>(await call(manager, 'GET', `/api/fleet/${b.id}`));
    expect(card.trackers).toBeNull();
    const ownersCard = json<{ trackers: { imei: string; removedOn: string | null }[] }>(await call(owner, 'GET', `/api/fleet/${b.id}`));
    expect(ownersCard.trackers[0]).toMatchObject({ imei: x, removedOn: null });
    await settle(jobA, jobB);
  });

  it('a tracker off a donor moves with the part: closed on the donor, open here', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const mech = await person('mechanic');
    const chief = await person('chief_mechanic');
    const donor = await moped();
    const target = await moped();
    const trackerPart = await shelfPart(owner, { qty: 1, unitCostTetri: 9500, isTracker: true });
    const x = imei();
    const onDonor = await repairInWork(owner, mech.cookie, chief.cookie, donor.id);
    expect((await call(mech.cookie, 'POST', `/api/service/${onDonor}/parts`, { kind: 'stock', partId: trackerPart, qty: 1, imei: x, sim: '555010206' })).statusCode).toBe(201);
    const jobId = await repairInWork(owner, mech.cookie, chief.cookie, target.id);
    const res = await call(mech.cookie, 'POST', `/api/service/${jobId}/parts`, { kind: 'donor', partId: trackerPart, qty: 1, donorVehicleId: donor.id, imei: x, sim: '555010206' });
    expect(res.statusCode, res.body).toBe(201);
    const open = await prisma.vehicleTracker.findMany({ where: { imei: x, removedOn: null }, select: { vehicleId: true } });
    expect(open).toEqual([{ vehicleId: target.id }]);
    // Called off, the donor's repair gives its tracker's part back — but this
    // tracker has moved on, and stays where it is now.
    await settle(onDonor, jobId);
    expect(await prisma.vehicleTracker.count({ where: { imei: x, vehicleId: target.id } })).toBe(1);
  });

  it('a repair called off gives the tracker back to the shelf, unfitted', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const mech = await person('mechanic');
    const chief = await person('chief_mechanic');
    const vehicle = await moped();
    const trackerPart = await shelfPart(owner, { qty: 1, isTracker: true });
    const x = imei();
    const jobId = await repairInWork(owner, mech.cookie, chief.cookie, vehicle.id);
    expect((await call(mech.cookie, 'POST', `/api/service/${jobId}/parts`, { kind: 'stock', partId: trackerPart, qty: 1, imei: x, sim: '555010207' })).statusCode).toBe(201);
    await settle(jobId);
    expect(await prisma.vehicleTracker.count({ where: { imei: x } })).toBe(0);
    expect((await shelfOf(owner, trackerPart)).onHand).toBe(1);
  });

  it('a tracker comes off by «снять трекер», not as a part taken off', async () => {
    const owner = await loginAs('owner');
    const mech = await person('mechanic');
    const chief = await person('chief_mechanic');
    const vehicle = await moped();
    const trackerPart = await shelfPart(owner, { qty: 1, isTracker: true });
    const jobId = await repairInWork(owner, mech.cookie, chief.cookie, vehicle.id);
    const res = await call(mech.cookie, 'POST', `/api/service/${jobId}/parts`, { kind: 'removed', partId: trackerPart, qty: 1 });
    expect(json<{ error: string }>(res).error).toBe('tracker_remove_apart');
    const none = await call(mech.cookie, 'POST', `/api/service/${jobId}/tracker/remove`, { working: false });
    expect(none.statusCode).toBe(404);
    expect(json<{ error: string }>(none).error).toBe('tracker_none');
    await settle(jobId);
  });
});

describe.skipIf(!HAS_DB)('batteries and chargers in a repair are their own count (ADR-0025, ADR-0036)', () => {
  it('to repair and back, named after the repair, never on the shelf of parts', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const mech = await person('mechanic');
    const chief = await person('chief_mechanic');
    const vehicle = await moped();
    const jobId = await repairInWork(owner, mech.cookie, chief.cookie, vehicle.id);
    const res = await call(mech.cookie, 'POST', `/api/service/${jobId}/batteries`, { item: 'battery', kind: 'to_repair', qty: 1 });
    expect(res.statusCode, res.body).toBe(201);
    expect((await call(mech.cookie, 'POST', `/api/service/${jobId}/batteries`, { item: 'charger', kind: 'from_repair', qty: 2 })).statusCode).toBe(201);
    expect((await jobOf(mech.cookie, jobId)).batteries).toEqual([
      expect.objectContaining({ item: 'battery', kind: 'to_repair', qty: 1 }),
      expect.objectContaining({ item: 'charger', kind: 'from_repair', qty: 2 }),
    ]);
    expect(await prisma.batteryMove.count({ where: { serviceJobId: jobId } })).toBe(2);
    expect((await call(mech.cookie, 'POST', `/api/service/${jobId}/batteries`, { item: 'battery', kind: 'lost', qty: 1 })).statusCode).toBe(400);
    await settle(jobId);
  });
});
