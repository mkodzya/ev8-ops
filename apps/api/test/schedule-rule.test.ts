// One rule for overdue and due today, on every answer (issue #18 of the
// director, B4; Mika's «Одно правило календаря» of 28.10.2026).
//
// The case of 25.10.2026, invented: a rental whose second week has a row and
// no money on it, while 150 the customer sent lies unplaced until the night's
// roll. «Аренды» said «Просрочена» by its stored "paid through"; «Оплаты по
// графику» showed the week paid by the advance. Now «Сегодня», «Аренды»,
// «Клиенты», the summary and the week's report say what the schedule says.
//
// The suites share one database and the real clock: the suite's own rental is
// asserted as it is, and the totals as equalities between two answers.
import { addDays, todayISO, weekOf, type PaymentsCalendarAnswer } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

const today = () => todayISO();
const digits = () => uniq().replace(/\D/g, '');

async function get<T>(who: string, url: string): Promise<T> {
  const res = await call(who, 'GET', url);
  if (res.statusCode !== 200) throw new Error(`${url}: ${res.statusCode} ${res.body}`);
  return json<T>(res);
}

/** Handed over nine days ago with the deposit and the first week paid; the second week, opened two days ago, has nothing on it. */
async function runningLate() {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Rule ${uniq()}`, weeklyRateTetri: 15000, forRent: true } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TESTS${digits().slice(0, 12).padStart(12, '0')}`, modelId: model.id, pool: 'rent' } });
  const customer = await prisma.customer.create({ data: { name: `ТЕСТ Правило ${uniq()}`, phone: `+9955${digits().slice(-8)}`, personalId: digits().slice(-11) } });
  const owner = await loginAs('owner');
  const res = await call(owner, 'POST', '/api/pickups', {
    customerId: customer.id,
    vehicleId: vehicle.id,
    weeklyRateTetri: 15000,
    depositTetri: 18000,
    pickedUpOn: addDays(today(), -9),
    nightParkingAddress: 'Test street 1',
    batteries: 2,
    chargers: 2,
    odometerKm: 100,
    payment: { later: false, channel: 'cash', amountTetri: 33000 },
  });
  if (res.statusCode !== 201) throw new Error(res.body);
  return { prisma, owner, customer, id: json<{ id: string }>(res).id };
}

interface Row {
  id: string;
  status: string;
  overdueDays: number;
}
interface Today {
  queue: { group: string; rows: { note: string | null }[] }[];
  numbers: { overdueTetri: number | null };
}
const lineOf = (t: Today): [number, number] => {
  const [late, due] = (t.queue.find((g) => g.group === 'schedule')?.rows[0]?.note ?? '0|0').split('|').map(Number);
  return [late ?? 0, due ?? 0];
};

describe.skipIf(!HAS_DB)('one rule for overdue and due today (issue #18, B4)', () => {
  it('an advance the night has not placed yet: the schedule shows the week paid, and so do «Аренды», «Клиенты» and «Сегодня»', async () => {
    const f = await runningLate();
    const t = today();
    const manager = await loginAs('manager');
    const list = async (who: string) => (await get<{ rentals: Row[] }>(who, '/api/rentals')).rentals;

    // Without the advance it is late, everywhere alike: the schedule, the list, the customer.
    expect((await list(f.owner)).find((r) => r.id === f.id)).toMatchObject({ status: 'overdue', overdueDays: 2 });

    // 150 on the customer and on no rental, written as the night finds it: placed by nobody yet.
    const { dateFromISO } = await import('../src/lib/dates.js');
    await f.prisma.payment.create({
      data: { occurredOn: dateFromISO(t)!, direction: 'in', channel: 'cash', grossTetri: 15000, netTetri: 15000, customerId: f.customer.id, kind: 'on_account' },
    });

    // «Оплаты по графику»: the week of two days ago is paid — by the advance.
    const cal = await get<PaymentsCalendarAnswer>(f.owner, `/api/money/calendar?from=${weekOf(addDays(t, -14)).from}&to=${weekOf(t).to}`);
    const week2 = cal.entries.find((e) => e.rentalId === f.id && e.seq === 2);
    expect(week2).toMatchObject({ dueOn: addDays(t, -2), leftTetri: 0, creditTetri: 15000 });
    expect(['paid', 'paid_ahead']).toContain(week2?.state);
    expect(cal.late.rentals.some((l) => l.rentalId === f.id)).toBe(false);

    // «Аренды»: not «Просрочена», for the owner and the manager; the card says the same.
    for (const who of [f.owner, manager]) expect((await list(who)).find((r) => r.id === f.id)).toMatchObject({ status: 'active', overdueDays: 0 });
    expect((await get<{ rental: { status: string; storedStatus: string } }>(f.owner, `/api/rentals/${f.id}`)).rental.status).toBe('active');

    // «Клиенты»: not under «Должны»; his rental is «Активна» there too.
    type Customer = { id: string; owing: string | null; openRentals: { id: string; status: string }[] };
    const customer = (await get<{ customers: Customer[] }>(f.owner, '/api/customers')).customers.find((c) => c.id === f.customer.id)!;
    expect(customer.owing).toBeNull();
    expect(customer.openRentals.find((r) => r.id === f.id)?.status).toBe('active');
    const card = await get<{ rentals: { id: string; status: string }[] }>(f.owner, `/api/customers/${f.customer.id}`);
    expect(card.rentals.find((r) => r.id === f.id)?.status).toBe('active');

    // «Сегодня», the summary and the week's report count the set the list counts.
    const rows = await list(f.owner);
    const lateRows = rows.filter((r) => r.status === 'overdue');
    const todayAnswer = await get<Today>(f.owner, '/api/today');
    const summary = await get<{ overdueList: { id: string }[] }>(f.owner, '/api/summary');
    expect(lineOf(todayAnswer)[0]).toBe(lateRows.length);
    expect(lineOf(todayAnswer)).toEqual([cal.late.count, (await get<{ schedule: { late: number; dueToday: number } }>(f.owner, '/api/nav/counts')).schedule.dueToday]);
    expect(summary.overdueList.map((o) => o.id)).not.toContain(f.id);
    expect(summary.overdueList.map((o) => o.id).sort()).toEqual(lateRows.map((r) => r.id).sort());

    // The night lays the advance on the week: the stored "paid through" agrees now too, and nothing moves.
    const { rollPeriods } = await import('../src/lib/periods.js');
    await rollPeriods(t);
    expect((await list(f.owner)).find((r) => r.id === f.id)).toMatchObject({ status: 'active', overdueDays: 0 });
    expect((await get<{ rental: { paidThrough: string } }>(f.owner, `/api/rentals/${f.id}`)).rental.paidThrough).toBe(addDays(t, 4));
  });

  it('a rental late by the schedule is late on every answer, with the schedule’s days, and its customer is under «Должны»', async () => {
    const f = await runningLate();
    const cal = await get<PaymentsCalendarAnswer>(f.owner, `/api/money/calendar?from=${weekOf(addDays(today(), -14)).from}&to=${weekOf(today()).to}`);
    expect(cal.late.rentals.find((l) => l.rentalId === f.id)).toMatchObject({ days: 2 });
    const row = (await get<{ rentals: Row[] }>(f.owner, '/api/rentals')).rentals.find((r) => r.id === f.id);
    expect(row).toMatchObject({ status: 'overdue', overdueDays: 2 });
    const customer = (await get<{ customers: { id: string; owing: string | null }[] }>(f.owner, '/api/customers')).customers.find((c) => c.id === f.customer.id);
    expect(customer?.owing).toBe('debtor');
    const summary = await get<{ overdueList: { id: string; days: number }[] }>(f.owner, '/api/summary');
    expect(summary.overdueList.find((o) => o.id === f.id)).toMatchObject({ days: 2 });
  });
});
