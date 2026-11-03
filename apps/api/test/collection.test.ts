// «Взыскание» (ADR-0054; migration 0077): the ladder after the reminders —
// a call on the 3rd day late, the block on the next day with no contact, the
// pick-up, the block taken off once paid. Every customer here is invented.
// The ladder counts days as the reminders do: the tests that need the 3rd day
// stand aside on a Georgian Orthodox holiday and the days after one.
import { addDays, isReminderHoliday, todayISO } from '@ev8/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

const today = () => todayISO(new Date(), 'Asia/Tbilisi');
const quiet = Array.from({ length: 5 }, (_, i) => addDays(today(), -i)).every((d) => !isReminderHoliday(d));

type Row = { id: string; note: string | null; amountTetri: number | null; days: number | null; href: string };
type Queue = { queue: { group: string; rows: Row[] }[] };

beforeEach(async () => {
  if (!HAS_DB) return;
  const { prisma } = await import('../src/lib/db.js');
  await prisma.rental.updateMany({ where: { status: { not: 'returned' } }, data: { status: 'returned' } });
});

/** Ten days ago, the deposit and the first week paid: the second week fell due three days ago. */
async function lateRental() {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Collect ${uniq()}`, forRent: true } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TESTC${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id } });
  const customer = await prisma.customer.create({ data: { name: `ТЕСТ Должник ${uniq()}`, phone: '+995 555 00 00 07' } });
  const owner = await loginAs('owner');
  const { id } = json<{ id: string }>(await call(owner, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, pickedUpOn: addDays(today(), -10) }));
  await call(owner, 'POST', '/api/money', { kind: 'rent', rentalId: id, amountTetri: '330', channel: 'cash' });
  return { prisma, owner, rentalId: id };
}

async function rowOf(cookie: string, rentalId: string): Promise<Row | undefined> {
  const q = json<Queue>(await call(cookie, 'GET', '/api/today'));
  return q.queue?.find((g) => g.group === 'collection')?.rows.find((r) => r.id === `collection:${rentalId}`);
}

/** What was written yesterday: the ladder counts days, and a test cannot wait for one. */
async function yesterday(rentalId: string) {
  const { prisma } = await import('../src/lib/db.js');
  const { dateFromISO } = await import('../src/lib/dates.js');
  await prisma.collectionEvent.updateMany({ where: { rentalId }, data: { day: dateFromISO(addDays(today(), -1))! } });
}

describe.skipIf(!HAS_DB)('«Взыскание» (ADR-0054)', () => {
  it.skipIf(!quiet)('the 3rd day late: «Сегодня» asks for the call — the owner and the manager, not the mechanic', async () => {
    const { owner, rentalId } = await lateRental();
    expect(await rowOf(owner, rentalId)).toMatchObject({ note: 'call|', amountTetri: 15000, days: 3, href: `/rentals/${rentalId}#collection` });
    expect((await rowOf(await loginAs('manager'), rentalId))?.note).toBe('call|');
    expect(await rowOf(await loginAs('mechanic'), rentalId)).toBeUndefined();
  });

  it.skipIf(!quiet)('no answer: still the call today, the block tomorrow; blocked — the pick-up; paid — take the block off', async () => {
    const { prisma, owner, rentalId } = await lateRental();
    const manager = await loginAs('manager');
    expect((await call(manager, 'POST', `/api/rentals/${rentalId}/collection/call`, { outcome: 'no_answer', gps: 'still' })).statusCode).toBe(201);
    expect((await rowOf(manager, rentalId))?.note).toBe('call|');
    await yesterday(rentalId);
    expect((await rowOf(manager, rentalId))?.note).toBe('block|');

    expect((await call(manager, 'POST', `/api/rentals/${rentalId}/collection/block`, { place: 'by the market, a map link' })).statusCode).toBe(201);
    expect((await rowOf(manager, rentalId))?.note).toBe(`pickup|${today()}`);
    expect(json<{ error: string }>(await call(manager, 'POST', `/api/rentals/${rentalId}/collection/block`, {})).error).toBe('already_blocked');

    // He pays the week: the moped is still blocked, and that is what is left to do.
    await call(owner, 'POST', '/api/money', { kind: 'rent', rentalId, amountTetri: '150', channel: 'cash' });
    expect((await rowOf(manager, rentalId))?.note).toBe(`unblock|${today()}`);
    expect((await call(manager, 'POST', `/api/rentals/${rentalId}/collection/unblock`, { note: 'paid in cash' })).statusCode).toBe(201);
    expect(await rowOf(manager, rentalId)).toBeUndefined();
    expect(json<{ error: string }>(await call(manager, 'POST', `/api/rentals/${rentalId}/collection/unblock`, {})).error).toBe('not_blocked');

    expect(await prisma.auditLog.count({ where: { entityId: rentalId, action: { startsWith: 'rental.collection.' } } })).toBe(3);
  });

  it.skipIf(!quiet)('a promise is waited for: off «Сегодня» until its day, on the card as «waiting»', async () => {
    const { owner, rentalId } = await lateRental();
    const by = addDays(today(), 2);
    expect((await call(owner, 'POST', `/api/rentals/${rentalId}/collection/call`, { outcome: 'promised', promisedOn: by, note: 'salary on Friday' })).statusCode).toBe(201);
    expect(await rowOf(owner, rentalId)).toBeUndefined();
    const card = json<{ rental: { collection: { state: { step: string; until?: string } | null; lateDays: number; events: { kind: string; outcome: string; promisedOn: string; by: string | null; note: string }[]; tracker: unknown } } }>(
      await call(owner, 'GET', `/api/rentals/${rentalId}`),
    );
    expect(card.rental.collection.state).toMatchObject({ step: 'waiting', until: by });
    expect(card.rental.collection.lateDays).toBe(3);
    expect(card.rental.collection.events).toEqual([expect.objectContaining({ kind: 'call', outcome: 'promised', promisedOn: by, note: 'salary on Friday' })]);
    expect(card.rental.collection.events[0]!.by).toBeTruthy();
    expect(card.rental.collection.tracker).toBeNull();
  });

  it('what a call may say, and of which rental', async () => {
    const { owner, rentalId } = await lateRental();
    const post = (body: unknown) => call(owner, 'POST', `/api/rentals/${rentalId}/collection/call`, body);
    expect(json<{ error: string }>(await post({})).error).toBe('missing_field');
    expect(json<{ error: string }>(await post({ outcome: 'maybe' })).error).toBe('bad_field');
    expect(json<{ error: string }>(await post({ outcome: 'promised' })).error).toBe('missing_field');
    expect(json<{ error: string; field?: string }>(await post({ outcome: 'promised', promisedOn: addDays(today(), -1) }))).toMatchObject({ error: 'bad_field', field: 'promisedOn' });
    expect(json<{ error: string }>(await post({ outcome: 'no_answer', gps: 'flying' })).error).toBe('bad_field');
    const mechanic = await loginAs('mechanic');
    expect((await call(mechanic, 'POST', `/api/rentals/${rentalId}/collection/call`, { outcome: 'no_answer' })).statusCode).toBe(403);
    const { prisma } = await import('../src/lib/db.js');
    await prisma.rental.update({ where: { id: rentalId }, data: { status: 'returned' } });
    expect(json<{ error: string }>(await post({ outcome: 'no_answer' })).error).toBe('collection_not_running');
    expect(json<{ error: string }>(await call(owner, 'POST', '/api/rentals/00000000-0000-4000-8000-000000000000/collection/block', {})).error).toBe('rental_not_found');
  });

  it('a rental not on the ladder, with nothing written, says nothing under «Взыскание»', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Collect ${uniq()}`, forRent: true } });
    const vehicle = await prisma.vehicle.create({ data: { vin: `TESTD${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id } });
    const customer = await prisma.customer.create({ data: { name: `ТЕСТ Платит ${uniq()}`, phone: '+995 555 00 00 06' } });
    const owner = await loginAs('owner');
    const { id } = json<{ id: string }>(await call(owner, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, pickedUpOn: today() }));
    expect(json<{ rental: { collection: unknown } }>(await call(owner, 'GET', `/api/rentals/${id}`)).rental.collection).toBeNull();
  });
});
