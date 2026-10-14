// A discount on one rental week (meeting of Mika and Kardu, 14.10.2026): the
// moped stood a day in the workshop and the customer paid 125 for a 150 week.
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

async function rentalPaying(paidTetri: number) {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Model ${uniq()}`, forRent: true } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TESTD${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id } });
  const customer = await prisma.customer.create({ data: { name: `Discount ${uniq()}` } });
  const owner = await loginAs('owner');
  const { id } = json<{ id: string }>(await call(owner, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, pickedUpOn: '2026-09-01' }));
  // The deposit takes the first 180, the week what is left.
  const paid = await call(owner, 'POST', '/api/payments', { rentalId: id, channel: 'cash', grossTetri: 18000 + paidTetri, occurredOn: '2026-09-01' });
  expect(paid.statusCode, paid.body).toBe(201);
  return { owner, rentalId: id };
}

type Week = { seq: number; amountTetri: number; paidTetri: number; payStatus: string; discountTetri: number; discountReason: string | null };
const week1 = async (owner: Awaited<ReturnType<typeof loginAs>>, id: string) =>
  json<{ periods: Week[] }>(await call(owner, 'GET', `/api/rentals/${id}`)).periods.find((p) => p.seq === 1)!;

describe.skipIf(!HAS_DB)('a discount on a rental week', () => {
  it('125 paid for a 150 week: 25 off with a reason, and the week is paid', async () => {
    const { owner, rentalId } = await rentalPaying(12500);
    expect(await week1(owner, rentalId)).toMatchObject({ amountTetri: 15000, paidTetri: 12500, discountTetri: 0 });

    const noReason = await call(owner, 'POST', `/api/rentals/${rentalId}/weeks/1/discount`, { discountTetri: '25' });
    expect(noReason.statusCode).toBe(400);

    const res = await call(owner, 'POST', `/api/rentals/${rentalId}/weeks/1/discount`, { discountTetri: '25', reason: 'a day in the workshop, brake cable' });
    expect(res.statusCode, res.body).toBe(200);
    expect(await week1(owner, rentalId)).toMatchObject({ amountTetri: 12500, paidTetri: 12500, payStatus: 'paid', discountTetri: 2500, discountReason: 'a day in the workshop, brake cable' });

    // Only the unpaid part can go: 125 is paid, so the week cannot be 120.
    const over = await call(owner, 'POST', `/api/rentals/${rentalId}/weeks/1/discount`, { discountTetri: '30', reason: 'two days' });
    expect(over.statusCode).toBe(409);
    expect(json<{ error: string }>(over).error).toBe('discount_over_paid');

    // Nought takes it away: the week is 150 again and 25 is owed.
    expect((await call(owner, 'POST', `/api/rentals/${rentalId}/weeks/1/discount`, { discountTetri: 0 })).statusCode).toBe(200);
    expect(await week1(owner, rentalId)).toMatchObject({ amountTetri: 15000, paidTetri: 12500, discountTetri: 0, discountReason: null });
  });

  it('a manager may not, and a week that does not exist is not found', async () => {
    const { owner, rentalId } = await rentalPaying(0);
    const manager = await loginAs('manager');
    expect((await call(manager, 'POST', `/api/rentals/${rentalId}/weeks/1/discount`, { discountTetri: '10', reason: 'x' })).statusCode).toBe(403);
    expect((await call(owner, 'POST', `/api/rentals/${rentalId}/weeks/99/discount`, { discountTetri: '10', reason: 'x' })).statusCode).toBe(404);
    const tooMuch = await call(owner, 'POST', `/api/rentals/${rentalId}/weeks/1/discount`, { discountTetri: '151', reason: 'x' });
    expect(json<{ error: string }>(tooMuch).error).toBe('discount_over_week');
    // The whole week may go: a week at nothing is paid.
    expect((await call(owner, 'POST', `/api/rentals/${rentalId}/weeks/1/discount`, { discountTetri: '150', reason: 'the moped never ran' })).statusCode).toBe(200);
    expect(await week1(owner, rentalId)).toMatchObject({ amountTetri: 0, payStatus: 'paid' });
  });
});
