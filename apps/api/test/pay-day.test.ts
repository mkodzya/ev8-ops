// The pay day of a rental through the API (ADR-0020): an owner's, with a
// reason, in the journal; it moves the day the rental is called due and late.
// Needs a *_test database. Every name is made up.
import { addDays, isoWeekday, todayISO } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

const TZ = 'Asia/Tbilisi';

async function rentalPickedUp(pickedUpOn: string) {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Model ${uniq()}`, weeklyRateTetri: 15000, forRent: true } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TEST${uniq().replace(/\D/g, '').slice(0, 13).padStart(13, '0')}`, modelId: model.id } });
  const customer = await prisma.customer.create({ data: { name: `Test Payday ${uniq()}`, phone: `+9955${uniq().replace(/\D/g, '').slice(-8)}` } });
  const manager = await loginAs('manager');
  const res = await call(manager, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: '150', pickedUpOn, odometerKm: 1 });
  expect(res.statusCode, res.body).toBe(201);
  return { prisma, id: json<{ id: string }>(res).id };
}

type Card = { rental: { status: string; payWeekday: number | null; payOffsetDays: number; dueOn: string | null } };

describe.skipIf(!HAS_DB)('the pay day of a rental (ADR-0020)', () => {
  it('is an owner’s decision with a reason, and goes to the journal', async () => {
    const today = todayISO(new Date(), TZ);
    const { prisma, id } = await rentalPickedUp(addDays(today, -1));
    const manager = await loginAs('manager');
    const owner = await loginAs('owner');
    const day = isoWeekday(today);

    const byManager = await call(manager, 'PATCH', `/api/rentals/${id}`, { payWeekday: day, reason: 'agreed' });
    expect(byManager.statusCode).toBe(403);
    expect(json<{ error: string }>(byManager).error).toBe('owner_only');

    const noReason = await call(owner, 'PATCH', `/api/rentals/${id}`, { payWeekday: day });
    expect(noReason.statusCode).toBe(400);
    expect(json<{ field: string }>(noReason)).toMatchObject({ field: 'reason' });

    const bad = await call(owner, 'PATCH', `/api/rentals/${id}`, { payWeekday: 8, reason: 'agreed' });
    expect(bad.statusCode).toBe(400);

    const ok = await call(owner, 'PATCH', `/api/rentals/${id}`, { payWeekday: day, reason: 'agreed with the customer' });
    expect(ok.statusCode, ok.body).toBe(200);
    const card = json<Card>(await call(owner, 'GET', `/api/rentals/${id}`));
    expect(card.rental).toMatchObject({ payWeekday: day, payOffsetDays: 1 });

    const log = await prisma.auditLog.findFirst({ where: { entityType: 'rental', entityId: id, action: 'rental.update' }, orderBy: { createdAt: 'desc' } });
    expect(log?.note).toBe('agreed with the customer');
    expect(log?.after).toMatchObject({ payWeekday: day });
    expect(log?.before).toMatchObject({ payWeekday: null });
  });

  it('moves the day the rental is due: late without it, due today with it, ahead with a later day', async () => {
    const today = todayISO(new Date(), TZ);
    // Picked up yesterday, nothing paid: the first week was due yesterday.
    const { id } = await rentalPickedUp(addDays(today, -1));
    const owner = await loginAs('owner');
    const status = async () => json<Card>(await call(owner, 'GET', `/api/rentals/${id}`)).rental;

    expect((await status()).status).toBe('overdue');

    await call(owner, 'PATCH', `/api/rentals/${id}`, { payWeekday: isoWeekday(today), reason: 'pays a day later' });
    expect(await status()).toMatchObject({ status: 'due_today', dueOn: today });

    await call(owner, 'PATCH', `/api/rentals/${id}`, { payWeekday: isoWeekday(addDays(today, 1)), reason: 'pays two days later' });
    expect(await status()).toMatchObject({ status: 'active', dueOn: addDays(today, 1) });

    // The pickup's own weekday is the rule of every rental: kept as no pay day at all.
    await call(owner, 'PATCH', `/api/rentals/${id}`, { payWeekday: isoWeekday(addDays(today, -1)), reason: 'back to the pickup day' });
    expect(await status()).toMatchObject({ status: 'overdue', payWeekday: null, payOffsetDays: 0 });
  });
});
