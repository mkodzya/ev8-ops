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
    // A group shows three rows and counts the rest, so this deposit is either
    // among them or behind the "more" line — both mean an owner is asked.
    const decide = ownerSees.queue.find((g) => g.group === 'decide')!;
    expect(decide.rows.some((r) => r.id === `deposit:${id}`) || decide.total > decide.rows.length).toBe(true);
    const managerSees = json<Today>(await call(manager, 'GET', '/api/today'));
    expect(managerSees.queue.some((g) => g.group === 'decide' && g.rows.some((r) => r.action === 'decide_deposit'))).toBe(false);
  });

  it('asks for a signature on a contract made here, never on a rental brought over (Mika, 08.10.2026)', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const fill = async () => json<Today>(await call(owner, 'GET', '/api/today')).queue.find((g) => g.group === 'fill')?.total ?? 0;
    const listed = async (id: string) => json<{ rentals: { id: string; contractSigned: boolean | null }[] }>(await call(owner, 'GET', '/api/rentals')).rentals.find((r) => r.id === id)!;
    const before = await fill();

    // Brought over: handed over three weeks ago, its contract from before EV8 Ops.
    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Today ${uniq()}`, weeklyRateTetri: 15000, forRent: true } });
    const vehicle = await prisma.vehicle.create({ data: { vin: `TESTT${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id, pool: 'rent' } });
    const customer = await prisma.customer.create({ data: { name: `ТЕСТ Сегодня ${uniq()}`, phone: `+9955${uniq().replace(/\D/g, '').slice(-8)}` } });
    const res = await call(owner, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, pickedUpOn: addDays(todayISO(), -21), transfer: { paidThrough: null, depositReceivedTetri: 0 } });
    expect(res.statusCode, res.body).toBe(201);
    const over = json<{ id: string }>(res).id;
    expect(await fill()).toBe(before);
    expect((await listed(over)).contractSigned).toBeNull();

    // Handed over here three weeks ago and still unsigned: that one is asked for.
    const { id } = await overdueRental();
    expect(await fill()).toBe(before + 1);
    expect((await listed(id)).contractSigned).toBe(false);
  });

  it('stops asking once the contract is marked signed in Signify, and asks again when an owner takes the mark back (ADR-0039)', async () => {
    const owner = await loginAs('owner');
    const manager = await loginAs('manager');
    const fill = async () => json<Today>(await call(owner, 'GET', '/api/today')).queue.find((g) => g.group === 'fill')?.total ?? 0;
    const listed = async (id: string) => json<{ rentals: { id: string; contractSigned: boolean | null }[] }>(await call(owner, 'GET', '/api/rentals')).rentals.find((r) => r.id === id)!;
    const { id } = await overdueRental();
    const asked = await fill();
    expect((await listed(id)).contractSigned).toBe(false);

    // Whoever hands a moped over marks it: the list and "Today" both let it go.
    const marked = await call(manager, 'POST', `/api/rentals/${id}/contract/signed-elsewhere`, { note: 'ТЕСТ: подписан в Signify' });
    expect(marked.statusCode, marked.body).toBe(201);
    expect(await fill()).toBe(asked - 1);
    expect((await listed(id)).contractSigned).toBe(true);

    // Taking it back is an owner's, and only with a reason.
    expect((await call(manager, 'POST', `/api/rentals/${id}/contract/signed-elsewhere/undo`, { reason: 'ТЕСТ' })).statusCode).toBe(403);
    const bare = await call(owner, 'POST', `/api/rentals/${id}/contract/signed-elsewhere/undo`, {});
    expect(bare.statusCode).toBe(400);
    expect(json<{ error: string }>(bare).error).toBe('missing_field');
    const undone = await call(owner, 'POST', `/api/rentals/${id}/contract/signed-elsewhere/undo`, { reason: 'ТЕСТ: отмечена не та аренда' });
    expect(undone.statusCode, undone.body).toBe(200);
    expect(await fill()).toBe(asked);
    expect((await listed(id)).contractSigned).toBe(false);

    // Nothing to take back twice.
    const again = await call(owner, 'POST', `/api/rentals/${id}/contract/signed-elsewhere/undo`, { reason: 'ТЕСТ' });
    expect(again.statusCode).toBe(409);
    expect(json<{ error: string }>(again).error).toBe('contract_not_marked');
  });

  it('asks an owner to take a till in before the deposits, and names a manager’s own cash for what it is (crit. 4)', async () => {
    const { id } = await overdueRental();
    const manager = await loginAs('manager');
    expect((await call(manager, 'POST', '/api/payments', { rentalId: id, channel: 'cash', grossTetri: 16000 })).statusCode).toBe(201);
    // A manager's own cash is a group of its own, "Касса" — never "Решить" (QA-W4-11).
    const withCash = json<Today>(await call(manager, 'GET', '/api/today'));
    expect(withCash.queue.some((g) => g.group === 'decide')).toBe(false);
    expect(withCash.queue.find((g) => g.group === 'till')!.rows[0]).toMatchObject({ action: 'hand_over_till' });
    const h = json<{ id: string }>(await call(manager, 'POST', '/api/till/handovers', { amountTetri: '160' }));
    // Deposits nobody has decided pile up; a till handed over today stands
    // above them, or an owner never sees it behind the "more" line (QA-W4-12).
    const owner = await loginAs('owner');
    const decide = json<Today>(await call(owner, 'GET', '/api/today')).queue.find((g) => g.group === 'decide')!;
    expect(decide.rows[0].action).toBe('accept_till');
    expect(decide.rows.some((r) => r.id === `till:${h.id}`)).toBe(true);
    expect((await call(owner, 'POST', `/api/till/handovers/${h.id}/accept`)).statusCode).toBe(200);
    const after = json<Today>(await call(owner, 'GET', '/api/today')).queue.find((g) => g.group === 'decide');
    expect(after?.rows.some((r) => r.id === `till:${h.id}`) ?? false).toBe(false);
  });
});
