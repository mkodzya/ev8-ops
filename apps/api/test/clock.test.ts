import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

// QA-W6-18 and QA-W6-19. A `timestamptz` is a moment, not a day. Slicing its
// ISO string names the UTC day, and between 20:00 UTC and midnight that is
// yesterday in Tbilisi — so a card's feed put a return on one day beside the
// act it produced on the next.
describe.skipIf(!HAS_DB)('a card feed dates by the company day', () => {
  /** 23:34 UTC on the 21st is 03:34 on the 22nd in Tbilisi. */
  const LATE = new Date('2026-09-21T23:34:03.000Z');

  it('puts a journal line written late at night on the Tbilisi day', async () => {
    const owner = await loginAs('owner');
    const { prisma } = await import('../src/lib/db.js');
    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Clock ${uniq()}`, weeklyRateTetri: 15000, forRent: true } });
    const vehicle = await prisma.vehicle.create({ data: { vin: `TESTCLOCK${uniq().replace(/\D/g, '').slice(-7)}`, modelId: model.id, pool: 'rent' } });
    const customer = await prisma.customer.create({ data: { name: `ТЕСТ Часы ${uniq()}` } });
    const rental = await prisma.rental.create({ data: { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, status: 'active', pickedUpOn: new Date('2026-09-01') } });
    const row = await prisma.auditLog.create({ data: { action: 'rental.update', entityType: 'rental', entityId: rental.id, before: { notes: 'a' }, after: { notes: 'b' } } });
    await prisma.auditLog.update({ where: { id: row.id }, data: { createdAt: LATE } });

    const feed = json<{ feed: { at: string; kind: string; text: string }[] }>(await call(owner, 'GET', `/api/rentals/${rental.id}`)).feed;
    const line = feed.find((f) => f.kind === 'log' && f.text === 'rental.update');
    expect(line?.at).toBe('2026-09-22'); // not 2026-09-21, which is what UTC would say
  });

  it("dates a customer's feed the same way", async () => {
    const owner = await loginAs('owner');
    const { prisma } = await import('../src/lib/db.js');
    const customer = await prisma.customer.create({ data: { name: `ТЕСТ Часы К ${uniq()}` } });
    const row = await prisma.auditLog.create({ data: { action: 'customer.update', entityType: 'customer', entityId: customer.id, before: { name: 'a' }, after: { name: 'b' } } });
    await prisma.auditLog.update({ where: { id: row.id }, data: { createdAt: LATE } });

    const feed = json<{ feed: { at: string; kind: string }[] }>(await call(owner, 'GET', `/api/customers/${customer.id}`)).feed;
    expect(feed.find((f) => f.kind === 'log')?.at).toBe('2026-09-22');
  });

  it('leaves a date column alone: it carries no time to get wrong', async () => {
    const owner = await loginAs('owner');
    const { prisma } = await import('../src/lib/db.js');
    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Clock2 ${uniq()}`, weeklyRateTetri: 15000, forRent: true } });
    const vehicle = await prisma.vehicle.create({ data: { vin: `TESTCLOCKB${uniq().replace(/\D/g, '').slice(-6)}`, modelId: model.id, pool: 'rent' } });
    const customer = await prisma.customer.create({ data: { name: `ТЕСТ Часы Д ${uniq()}` } });
    const rental = await prisma.rental.create({
      data: { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, status: 'active', pickedUpOn: new Date('2026-09-21') },
    });
    const card = json<{ rental: { pickedUpOn: string } }>(await call(owner, 'GET', `/api/rentals/${rental.id}`));
    expect(card.rental.pickedUpOn).toBe('2026-09-21');
  });
});
