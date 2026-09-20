// "Today" as the API hands it over (wave 4 §3.1): the queue a role sees and
// the numbers beside it.
import { addDays, todayISO } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

interface Today {
  today: string;
  owner: boolean;
  queue: { group: string; rows: { id: string; action: string; number: string | null; amountTetri: number | null }[]; total: number; totalTetri: number }[];
  count: number;
  numbers: { fleet: Record<string, number>; overdueTetri: number | null; depositsHeldTetri: number | null; week: { rentTetri: number; depositTetri: number; feeTetri: number } | null; myTillTetri: number | null };
}

async function overdueRental() {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Today ${uniq()}`, weeklyRateTetri: 15000, forRent: true } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TESTT${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id, pool: 'rent' } });
  const customer = await prisma.customer.create({ data: { name: `ТЕСТ Сегодня ${uniq()}`, phone: `+9955${uniq().replace(/\D/g, '').slice(-8)}` } });
  const owner = await loginAs('owner');
  const res = await call(owner, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, pickedUpOn: addDays(todayISO(), -21) });
  if (res.statusCode !== 201) throw new Error(res.body);
  return { owner, id: json<{ id: string }>(res).id, number: json<{ number: string }>(res).number };
}

describe.skipIf(!HAS_DB)('“Today” (wave 4)', () => {
  it('lists an overdue rental with its debt, and counts the rows in the badge', async () => {
    const { owner, number } = await overdueRental();
    const t = json<Today>(await call(owner, 'GET', '/api/today'));
    const overdue = t.queue.find((g) => g.group === 'overdue')!;
    expect(overdue.rows.length).toBeGreaterThan(0);
    expect(overdue.total).toBeGreaterThanOrEqual(1);
    expect(t.count).toBe(t.queue.reduce((n, g) => n + g.total, 0));
    // The rental is somewhere in the group, shown or counted.
    expect(overdue.total >= 1 && (overdue.rows.some((r) => r.number === number) || overdue.total > overdue.rows.length)).toBe(true);
    expect(t.numbers.overdueTetri).toBeGreaterThan(0);
    expect(t.numbers.week).not.toBeNull();
  });

  it('gives a manager neither the deposits nor the week’s money, but their own till', async () => {
    const manager = await loginAs('manager');
    const t = json<Today>(await call(manager, 'GET', '/api/today'));
    expect(t.owner).toBe(false);
    expect(t.queue.some((g) => ['money', 'purchases', 'decisions', 'instalments'].includes(g.group))).toBe(false);
    expect(t.numbers.overdueTetri).toBeNull();
    expect(t.numbers.week).toBeNull();
    expect(t.numbers.myTillTetri).toBe(0);
    expect(Object.keys(t.numbers.fleet)).toContain('available');
  });

  it('puts a deposit a manager left undecided in front of an owner only', async () => {
    const { id } = await overdueRental();
    const manager = await loginAs('manager');
    // The deposit has to have been received for there to be anything to decide.
    await call(manager, 'POST', '/api/payments', { rentalId: id, channel: 'cash', grossTetri: 18000 });
    const ret = await call(manager, 'POST', `/api/rentals/${id}/return`, { odometerKm: 10, items: { moped: { state: 'ok' }, key: { state: 'ok' } } });
    expect(ret.statusCode, ret.body).toBe(200);
    const ownerSees = json<Today>(await call(await loginAs('owner'), 'GET', '/api/today'));
    expect(ownerSees.queue.find((g) => g.group === 'decide')?.rows.some((r) => r.id === `deposit:${id}`) ?? false).toBe(true);
    const managerSees = json<Today>(await call(manager, 'GET', '/api/today'));
    expect(managerSees.queue.some((g) => g.group === 'decide' && g.rows.some((r) => r.action === 'decide_deposit'))).toBe(false);
  });
});
