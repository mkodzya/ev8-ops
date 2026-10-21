// The moped card's history after the QA walk of 21–22.10.2026: a journal row
// dated by the company's day and not the UTC one, events that say when they
// were written so the card can put both in one order, the two halves of a swap
// told apart from a plain hand-over and return, and the tracker's refusal that
// names the first day it would take. Needs a *_test database; every moped,
// person, point, IMEI and number here is made up.
import { todayISO } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

const digits = () => uniq().replace(/\D/g, '');

async function moped(opts: { arrivedOn?: string; odometerKm?: number } = {}) {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `History ${uniq()}`, weeklyRateTetri: 15000, forRent: true } });
  return prisma.vehicle.create({
    data: {
      vin: `TESTH${digits().slice(-12).padStart(12, '0')}`,
      modelId: model.id,
      pool: 'rent',
      arrivedOn: opts.arrivedOn ? new Date(`${opts.arrivedOn}T00:00:00Z`) : null,
      odometerKm: opts.odometerKm ?? null,
    },
  });
}

interface Card {
  events: { kind: string; occurredOn: string; at?: string; rentalId: string | null; swap?: 'in' | 'out' | null }[];
  journal: { id: string; at: string; occurredOn: string | null; action: string }[];
  maintenance: { readingSource: string | null; readingBySwap?: boolean } | null;
}
async function cardOf(cookie: string, id: string): Promise<Card> {
  const res = await call(cookie, 'GET', `/api/fleet/${id}`);
  expect(res.statusCode, res.body).toBe(200);
  return json<Card>(res);
}

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

describe.skipIf(!HAS_DB)('the moped card’s history (QA, 22.10.2026)', () => {
  it('dates a journal row by the Tbilisi day: written at 01:29 on the 22nd, it is the 22nd and not the UTC 21st', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const v = await moped();
    const late = await prisma.auditLog.create({ data: { action: 'vehicle.vin', entityType: 'vehicle', entityId: v.id, before: { vin: 'a' }, after: { vin: 'b' }, note: 'test' } });
    // 21:29 UTC on the 21st is 01:29 on the 22nd in Tbilisi.
    await prisma.auditLog.update({ where: { id: late.id }, data: { createdAt: new Date('2026-10-21T21:29:00.000Z') } });
    const evening = await prisma.auditLog.create({ data: { action: 'vehicle.vin', entityType: 'vehicle', entityId: v.id, before: { vin: 'b' }, after: { vin: 'c' }, note: 'test' } });
    // 19:59 UTC is 23:59 in Tbilisi: still the 21st.
    await prisma.auditLog.update({ where: { id: evening.id }, data: { createdAt: new Date('2026-10-21T19:59:00.000Z') } });

    const rows = (await cardOf(owner, v.id)).journal;
    expect(rows.find((r) => r.id === late.id)).toMatchObject({ at: '2026-10-21T21:29:00.000Z', occurredOn: '2026-10-22' });
    expect(rows.find((r) => r.id === evening.id)).toMatchObject({ occurredOn: '2026-10-21' });
  });

  it('says when each event was written, so the card can merge it with the journal, and leaves the events’ own order alone', async () => {
    const owner = await loginAs('owner');
    const v = await moped();
    expect((await call(owner, 'POST', `/api/fleet/${v.id}/state`, { toState: 'service', reason: 'invented: waits for a part' })).statusCode).toBe(200);
    expect((await call(owner, 'POST', `/api/fleet/${v.id}/state`, { toState: 'available', reason: 'invented: the part came' })).statusCode).toBe(200);

    const card = await cardOf(owner, v.id);
    expect(card.events.map((e) => e.kind)).toEqual(['manual', 'manual']);
    for (const e of card.events) expect(Number.isFinite(Date.parse(e.at ?? ''))).toBe(true);
    expect(Date.parse(card.events[0].at!) <= Date.parse(card.events[1].at!)).toBe(true);
    // The journal keeps both moves too, on today's company day.
    expect(card.journal.filter((l) => l.action === 'vehicle.state.manual').map((l) => l.occurredOn)).toEqual([todayISO(), todayISO()]);
  });
});

describe.skipIf(!HAS_DB)('a swap in each moped’s history (ADR-0040; QA, 22.10.2026)', () => {
  it('marks the old moped’s return as given back in a swap, and the new one’s hand-over as brought by it — the first hand-over stays plain', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const old = await moped();
    const fresh = await moped({ odometerKm: 300 });
    const point = await prisma.location.create({ data: { name: `ТЕСТ point ${uniq()}` }, select: { id: true } });
    const customer = await prisma.customer.create({ data: { name: `Test Swapper ${uniq()}`, phone: `+9955${digits().slice(-8)}`, personalId: digits().slice(-11) } });
    const picked = await call(owner, 'POST', '/api/pickups', {
      customerId: customer.id,
      vehicleId: old.id,
      weeklyRateTetri: 15000,
      depositTetri: 18000,
      pickedUpOn: todayISO(),
      nightParkingAddress: 'Test street 1',
      batteries: 2,
      chargers: 2,
      odometerKm: 1000,
      payment: { later: false, channel: 'cash', amountTetri: 33000 },
    });
    expect(picked.statusCode, picked.body).toBe(201);
    const rentalId = json<{ id: string }>(picked).id;
    const swapped = await call(owner, 'POST', `/api/rentals/${rentalId}/swap`, {
      swappedOn: todayISO(),
      reason: 'invented: the customer asked for a bigger battery',
      outOdometerKm: 1150,
      items: { moped: { state: 'ok' }, key: { state: 'ok' } },
      toService: false,
      locationId: point.id,
      vehicleId: fresh.id,
      inOdometerKm: 320,
    });
    expect(swapped.statusCode, swapped.body).toBe(200);

    const oldCard = await cardOf(owner, old.id);
    expect(oldCard.events.filter((e) => e.rentalId === rentalId).map((e) => [e.kind, e.swap])).toEqual([
      ['pickup', null],
      ['return', 'out'],
    ]);
    const freshCard = await cardOf(owner, fresh.id);
    expect(freshCard.events.filter((e) => e.rentalId === rentalId).map((e) => [e.kind, e.swap])).toEqual([['pickup', 'in']]);
    // An event that is not a rental's is never a swap.
    expect(freshCard.events.filter((e) => e.rentalId == null).every((e) => e.swap === null)).toBe(true);

    // The mileage each card shows was read at the swap, and says so; it still counts as the return and the hand-over it is.
    expect(oldCard.maintenance).toMatchObject({ readingSource: 'return', readingBySwap: true });
    expect(freshCard.maintenance).toMatchObject({ readingSource: 'pickup', readingBySwap: true });
  });

  it('leaves a plain hand-over plain, its mileage too', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const v = await moped();
    const customer = await prisma.customer.create({ data: { name: `Test Renter ${uniq()}`, phone: `+9955${digits().slice(-8)}`, personalId: digits().slice(-11) } });
    const picked = await call(owner, 'POST', '/api/pickups', {
      customerId: customer.id,
      vehicleId: v.id,
      weeklyRateTetri: 15000,
      depositTetri: 18000,
      pickedUpOn: todayISO(),
      nightParkingAddress: 'Test street 1',
      batteries: 2,
      chargers: 2,
      odometerKm: 1000,
      payment: { later: false, channel: 'cash', amountTetri: 33000 },
    });
    expect(picked.statusCode, picked.body).toBe(201);
    const card = await cardOf(owner, v.id);
    expect(card.events.filter((e) => e.kind === 'pickup').map((e) => e.swap)).toEqual([null]);
    expect(card.maintenance).toMatchObject({ readingSource: 'pickup', readingBySwap: false });
  });
});

describe.skipIf(!HAS_DB)('the tracker’s refusal names the first day it would take (QA, 22.10.2026)', () => {
  it('names the day the last tracker came off, or the day the moped came', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const v = await moped({ arrivedOn: '2026-09-01' });

    const beforeArrival = await call(owner, 'POST', `/api/fleet/${v.id}/tracker`, { imei: imei(), sim: '555010311', installedOn: '2026-08-31' });
    expect(beforeArrival.statusCode).toBe(400);
    expect(json(beforeArrival)).toMatchObject({ error: 'tracker_date_bad', field: 'installedOn', fault: 'before_arrival', earliest: '2026-09-01', earliestBy: 'arrival' });

    // A tracker it had, taken off on the 20th of October (written straight in: taking one off is a repair's).
    await prisma.vehicleTracker.create({
      data: { vehicleId: v.id, imei: imei(), simPhone: '555010312', installedOn: new Date('2026-09-02T00:00:00Z'), removedOn: new Date('2026-10-20T00:00:00Z') },
    });
    const beforeOff = await call(owner, 'POST', `/api/fleet/${v.id}/tracker`, { imei: imei(), sim: '555010313', installedOn: '2026-10-01' });
    expect(beforeOff.statusCode).toBe(400);
    expect(json(beforeOff)).toMatchObject({ error: 'tracker_date_bad', fault: 'before_last_removed', earliest: '2026-10-20', earliestBy: 'last_removed' });

    // The day it names is a day it takes.
    expect((await call(owner, 'POST', `/api/fleet/${v.id}/tracker`, { imei: imei(), sim: '555010314', installedOn: '2026-10-20' })).statusCode).toBe(201);
  });
});
