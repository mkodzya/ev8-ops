// "Деньги → Календарь" on live rows (docs/redesign/payments-calendar.md §6, ADR-0016).
//
// The suites share one database and the real clock, so every date here is
// counted from today, every request asks for the same five weeks around it,
// and every assertion is about the suite's own rental or about a difference
// before and after — never an absolute total.
//
// Which roll comes first (today's or tonight's) cannot be steered here: other
// suites leave rentals with begun weeks and no rows. Both branches are proven
// in the pure tests (`packages/shared/test/calendar.test.ts`); these use the
// one they can force, a deleted row of today.
import { addDays, calendarGrid, todayISO, weekOf, type PaymentsCalendarAnswer } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

type Cal = PaymentsCalendarAnswer;

const today = () => todayISO();
const digits = () => uniq().replace(/\D/g, '');
const date = (day: string) => new Date(`${day}T00:00:00Z`);

async function fixtures() {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Model ${uniq()}`, weeklyRateTetri: 16000, forRent: true } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TEST${digits().slice(0, 13).padStart(13, '0')}`, modelId: model.id, pool: 'rent' } });
  const customer = await prisma.customer.create({ data: { name: `Test Customer ${uniq()}`, phone: `+9955${digits().slice(-8)}`, personalId: digits().slice(-11) } });
  return { prisma, model, vehicle, customer };
}

/** Everything the wizard sends, for an existing customer, paid in cash. */
function pickup(customerId: string, vehicleId: string, over: Record<string, unknown> = {}) {
  return {
    customerId,
    vehicleId,
    weeklyRateTetri: 15000,
    depositTetri: 18000,
    pickedUpOn: today(),
    nightParkingAddress: 'Test street 1',
    batteries: 2,
    chargers: 2,
    odometerKm: 100,
    payment: { later: false, channel: 'cash', amountTetri: 33000 },
    ...over,
  };
}

/** A rental handed over `daysAgo` days ago with the first week and deposit paid. */
async function running(daysAgo: number, over: Record<string, unknown> = {}) {
  const f = await fixtures();
  const owner = await loginAs('owner');
  const res = await call(owner, 'POST', '/api/pickups', pickup(f.customer.id, f.vehicle.id, { pickedUpOn: addDays(today(), -daysAgo), ...over }));
  if (res.statusCode !== 201) throw new Error(res.body);
  return { ...f, owner, id: json<{ id: string }>(res).id };
}

/** Another moped for a customer who already rents. */
async function second(customerId: string, daysAgo: number, over: Record<string, unknown> = {}) {
  const f = await fixtures();
  const owner = await loginAs('owner');
  const res = await call(owner, 'POST', '/api/pickups', pickup(customerId, f.vehicle.id, { pickedUpOn: addDays(today(), -daysAgo), ...over }));
  if (res.statusCode !== 201) throw new Error(res.body);
  return { vehicle: f.vehicle, owner, id: json<{ id: string }>(res).id };
}

const items = () => ({ moped: { state: 'ok' }, key: { state: 'ok' }, battery_1: { state: 'ok' }, battery_2: { state: 'ok' }, charger_1: { state: 'ok' }, charger_2: { state: 'ok' } });

/** Five whole weeks: three back, this one, one ahead. */
const range = () => ({ from: weekOf(addDays(today(), -21)).from, to: weekOf(addDays(today(), 7)).to });

async function calendar(who: string, q: { from: string; to: string } = range()): Promise<Cal> {
  const res = await call(who, 'GET', `/api/money/calendar?from=${q.from}&to=${q.to}`);
  if (res.statusCode !== 200) throw new Error(res.body);
  return json<Cal>(res);
}

const entriesOf = (c: Cal, rentalId: string) => c.entries.filter((e) => e.rentalId === rentalId);
function entryOn(c: Cal, rentalId: string, dueOn: string) {
  const e = c.entries.find((x) => x.rentalId === rentalId && x.dueOn === dueOn);
  if (!e) throw new Error(`no entry of ${rentalId} due ${dueOn}`);
  return e;
}
const lateOf = (c: Cal, rentalId: string) => c.late.rentals.find((l) => l.rentalId === rentalId);
function dayOn(c: Cal, day: string) {
  const d = c.days.find((x) => x.date === day);
  if (!d) throw new Error(`no day ${day}`);
  return d;
}
function weekOn(c: Cal, day: string) {
  const w = c.weeks.find((x) => x.from <= day && day <= x.to);
  if (!w) throw new Error(`no week of ${day}`);
  return w;
}
const err = (res: { body: string }) => json<{ error: string; field?: string; permission?: string }>(res);

const AHEAD = { later: false, channel: 'cash', amountTetri: 48000 };

describe.skipIf(!HAS_DB)('payments calendar · who may ask, and for what', () => {
  it('is an owner’s: a manager gets 403 naming the permission, nobody gets 401 (crit. 29)', async () => {
    const manager = await loginAs('manager');
    const refused = await call(manager, 'GET', '/api/money/calendar');
    expect(refused.statusCode).toBe(403);
    expect(err(refused)).toMatchObject({ error: 'forbidden', permission: 'payments.view' });
    expect((await call(null, 'GET', '/api/money/calendar')).statusCode).toBe(401);
  });

  it('refuses a range it cannot answer, with the field at fault', async () => {
    const owner = await loginAs('owner');
    const t = today();
    const ask = async (q: string) => {
      const res = await call(owner, 'GET', `/api/money/calendar?${q}`);
      expect(res.statusCode, q).toBe(400);
      return err(res);
    };
    expect(await ask(`from=${t}&to=${addDays(t, -1)}`)).toMatchObject({ error: 'bad_period', field: 'from' });
    expect(await ask(`from=yesterday&to=${t}`)).toMatchObject({ error: 'bad_field', field: 'from' });
    expect(await ask(`from=${t}`)).toMatchObject({ error: 'missing_field', field: 'to' });
    expect(await ask(`to=${t}`)).toMatchObject({ error: 'missing_field', field: 'from' });
    // Six weeks hold any month; the forty-third day is one too many.
    expect((await call(owner, 'GET', `/api/money/calendar?from=${t}&to=${addDays(t, 41)}`)).statusCode).toBe(200);
    expect(await ask(`from=${t}&to=${addDays(t, 42)}`)).toMatchObject({ error: 'bad_period', field: 'to' });
    expect(await ask(`from=${addDays(t, 360)}&to=${addDays(t, 367)}`)).toMatchObject({ error: 'bad_period', field: 'to' });
  });

  it('with no range answers the grid of this month, in the shape the screen reads', async () => {
    const { owner } = await running(3);
    const t = today();
    const res = await call(owner, 'GET', '/api/money/calendar');
    expect(res.statusCode, res.body).toBe(200);
    const c = json<Cal>(res);
    const grid = calendarGrid(t);
    expect(c).toMatchObject({ today: t, from: grid.from, to: grid.to });
    expect(c.weeks.map((w) => w.from)).toContain(weekOf(t).from);
    expect(c.days[0].date).toBe(grid.from);
    expect(c.days[c.days.length - 1].date).toBe(addDays(grid.to, 1));

    const sum = { count: expect.any(Number), tetri: expect.any(Number) };
    for (const w of c.weeks) {
      // Exactly these keys: the two red-line sums live in `late`, not here.
      expect(w).toEqual({
        from: expect.any(String),
        to: expect.any(String),
        expected: sum,
        paid: sum,
        paidAhead: sum,
        partTetri: expect.any(Number),
        left: sum,
        overdue: sum,
        dueToday: sum,
        upcoming: sum,
        heaviest: w.heaviest === null ? null : { date: expect.any(String), tetri: expect.any(Number) },
        receivedTetri: expect.any(Number),
      });
    }
    expect(c.unsortedIn).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(c.unsortedIn)).toBe(true);
    // A rental handed over three days ago is running: the first pickup is that day or earlier.
    expect(c.firstPickupOn).not.toBeNull();
    expect(c.firstPickupOn! <= addDays(t, -3)).toBe(true);
    expect(c.late.thisWeekTetri + c.late.earlierTetri).toBe(c.late.debtTetri);
    expect(c.late.count).toBe(c.late.rentals.length);
  });
});

describe.skipIf(!HAS_DB)('payments calendar · the states of a week', () => {
  it('a week not paid by the day after its first is overdue, with the debt the rentals list shows (crit. 4, 22)', async () => {
    const { owner, id } = await running(8);
    const t = today();
    const c = await calendar(owner);
    // The hand-over dates its payment today, whatever day the moped left.
    expect(entryOn(c, id, addDays(t, -8))).toMatchObject({ seq: 1, state: 'paid', paidOn: t, channel: 'cash', leftTetri: 0, projected: false });
    expect(entryOn(c, id, addDays(t, -1))).toMatchObject({ seq: 2, state: 'overdue', leftTetri: 15000, paidOn: null });
    expect(lateOf(c, id)).toEqual({ rentalId: id, debtTetri: 15000, overdueTetri: 15000, weeks: 1, sinceOn: addDays(t, -1), days: 1 });

    const card = json<{ rental: { debtTetri: number } }>(await call(owner, 'GET', `/api/rentals/${id}`));
    const list = json<{ rentals: { id: string; debtTetri: number }[] }>(await call(owner, 'GET', '/api/rentals'));
    expect(card.rental.debtTetri).toBe(15000);
    expect(list.rentals.find((r) => r.id === id)?.debtTetri).toBe(15000);
    expect(c.rentals.find((r) => r.id === id)?.debtTetri).toBe(15000);
  });

  it('on its first day a week is due today, and the rental is not late (crit. 3)', async () => {
    const { owner, id } = await running(7);
    const c = await calendar(owner);
    expect(entryOn(c, id, today())).toMatchObject({ seq: 2, state: 'due_today', amountTetri: 15000, leftTetri: 15000, projected: false });
    expect(lateOf(c, id)).toBeUndefined();
  });

  it('today’s week is overdue too when an older one is unpaid: 7 days, 2 weeks, 300 (crit. 5)', async () => {
    const { owner, id } = await running(14);
    const t = today();
    const c = await calendar(owner);
    expect(entryOn(c, id, addDays(t, -7)).state).toBe('overdue');
    expect(entryOn(c, id, t).state).toBe('overdue');
    expect(lateOf(c, id)).toEqual({ rentalId: id, debtTetri: 30000, overdueTetri: 30000, weeks: 2, sinceOn: addDays(t, -7), days: 7 });
  });

  it('a week closed by money dated before its first day is paid ahead (crit. 8)', async () => {
    const { owner, id } = await running(10, { payment: { later: true } });
    const t = today();
    const paid = await call(owner, 'POST', '/api/money', {
      kind: 'rent',
      rentalId: id,
      amountTetri: 48000,
      channel: 'cash',
      occurredOn: addDays(t, -5),
      backdateReason: 'test: paid on the day, entered later',
    });
    expect(paid.statusCode, paid.body).toBe(201);
    const c = await calendar(owner);
    expect(entryOn(c, id, addDays(t, -3))).toMatchObject({ seq: 2, state: 'paid_ahead', paidOn: addDays(t, -5), channel: 'cash', projected: false, creditTetri: 0 });
    // The same money, dated after the first week began: paid, not ahead.
    expect(entryOn(c, id, addDays(t, -10))).toMatchObject({ seq: 1, state: 'paid', paidOn: addDays(t, -5) });
    expect(lateOf(c, id)).toBeUndefined();
  });

  it('money paid ahead closes a week that has no row yet — and the night changes nothing the calendar said (crit. 9, 15)', async () => {
    const { prisma, owner, id } = await running(3, { payment: AHEAD });
    const t = today();
    const dueOn = addDays(t, 4);
    const before = entryOn(await calendar(owner), id, dueOn);
    expect(before).toMatchObject({
      seq: 2,
      state: 'paid_ahead',
      projected: true,
      amountTetri: 15000,
      paidTetri: 15000,
      leftTetri: 0,
      creditTetri: 15000,
      paidOn: t,
      channel: 'cash',
    });

    // What that night will do, for this one rental: open the week and settle
    // the credit. A roll to a future day would open weeks for every rental in
    // the shared database.
    await prisma.rentalPeriod.create({ data: { rentalId: id, seq: 2, startsOn: date(dueOn), endsOn: date(addDays(dueOn, 6)), amountTetri: 15000 } });
    const { settleCredit } = await import('../src/lib/periods.js');
    expect(await settleCredit(id)).toBe(15000);

    const after = entryOn(await calendar(owner), id, dueOn);
    expect(after).toEqual({ ...before, projected: false, creditTetri: 0 });
  });

  it('money that covers part of a week ahead leaves it expected, with the part on it', async () => {
    const { owner, id } = await running(3, { payment: { later: false, channel: 'cash', amountTetri: 40000 } });
    const c = await calendar(owner);
    expect(entryOn(c, id, addDays(today(), 4))).toMatchObject({
      state: 'expected',
      projected: true,
      amountTetri: 15000,
      paidTetri: 7000,
      leftTetri: 8000,
      creditTetri: 7000,
      paidOn: null,
      channel: null,
      paymentId: null,
    });
  });

  it('the customer’s money goes to an unpaid deposit before a week (crit. 11)', async () => {
    const f = await fixtures();
    const owner = await loginAs('owner');
    const money = await call(owner, 'POST', '/api/payments', { customerId: f.customer.id, channel: 'cash', grossTetri: 15000 });
    expect(money.statusCode, money.body).toBe(201);
    const res = await call(owner, 'POST', '/api/pickups', pickup(f.customer.id, f.vehicle.id, { payment: { later: true } }));
    expect(res.statusCode, res.body).toBe(201);
    const { id } = json<{ id: string }>(res);
    const t = today();

    const before = entryOn(await calendar(owner), id, t);
    expect(before).toMatchObject({ seq: 1, state: 'due_today', amountTetri: 15000, leftTetri: 15000, creditTetri: 0 });

    const { settleCredit } = await import('../src/lib/periods.js');
    expect(await settleCredit(id)).toBe(15000);
    expect((await f.prisma.deposit.findUniqueOrThrow({ where: { rentalId: id } })).paidTetri).toBe(15000);
    expect(entryOn(await calendar(owner), id, t)).toEqual(before);
  });

  it('a week marked paid before the transfer is paid with no date and no channel (crit. 2)', async () => {
    const f = await fixtures();
    const owner = await loginAs('owner');
    const t = today();
    const pickedUpOn = addDays(t, -20);
    const res = await call(
      owner,
      'POST',
      '/api/pickups',
      pickup(f.customer.id, f.vehicle.id, { pickedUpOn, odometerKm: undefined, payment: undefined, transfer: { paidThrough: addDays(pickedUpOn, 6), depositReceivedTetri: 18000 } }),
    );
    expect(res.statusCode, res.body).toBe(201);
    const { id } = json<{ id: string }>(res);
    const c = await calendar(owner);
    expect(entryOn(c, id, pickedUpOn)).toMatchObject({ seq: 1, state: 'paid', paidOn: null, channel: null, paymentId: null, leftTetri: 0 });
    expect(entryOn(c, id, addDays(t, -13)).state).toBe('overdue');
    expect(entryOn(c, id, addDays(t, -6)).state).toBe('overdue');
    expect(lateOf(c, id)).toEqual({ rentalId: id, debtTetri: 30000, overdueTetri: 30000, weeks: 2, sinceOn: addDays(t, -13), days: 13 });
  });

  it('today’s week with no row yet is due today at the rate, and the roll changes nothing but the row (crit. 15)', async () => {
    const { prisma, owner, id } = await running(7);
    const t = today();
    await prisma.rentalPeriod.deleteMany({ where: { rentalId: id, seq: 2 } });
    const before = entryOn(await calendar(owner), id, t);
    expect(before).toMatchObject({ seq: 2, state: 'due_today', projected: true, amountTetri: 15000, leftTetri: 15000, endsOn: addDays(t, 6) });

    const { rollPeriods } = await import('../src/lib/periods.js');
    await rollPeriods(t);
    expect(entryOn(await calendar(owner), id, t)).toEqual({ ...before, projected: false });
  });
});

describe.skipIf(!HAS_DB)('payments calendar · what is not on it', () => {
  it('a paused rental and a returned one are nowhere: no week, no late row, no card (crit. 14)', async () => {
    const paused = await running(8);
    const status = await call(paused.owner, 'POST', `/api/rentals/${paused.id}/status`, { status: 'paused', reason: 'test: the moped stands' });
    expect(status.statusCode, status.body).toBe(200);
    const returned = await running(8);
    const back = await call(returned.owner, 'POST', `/api/rentals/${returned.id}/return`, { odometerKm: 150, items: items() });
    expect(back.statusCode, back.body).toBe(200);

    const c = await calendar(paused.owner);
    for (const id of [paused.id, returned.id]) {
      expect(entriesOf(c, id)).toEqual([]);
      expect(lateOf(c, id)).toBeUndefined();
      expect(c.rentals.find((r) => r.id === id)).toBeUndefined();
    }
  });

  it('a week at nothing, left by a lifted pause, is skipped and does not make the rental late (crit. 14)', async () => {
    const { prisma, owner, id } = await running(8);
    const t = today();
    await prisma.rentalPeriod.deleteMany({ where: { rentalId: id, seq: 2 } });
    for (const body of [
      { status: 'paused', reason: 'test: the moped stands' },
      { status: 'active', reason: 'test: back on the road' },
    ]) {
      const res = await call(owner, 'POST', `/api/rentals/${id}/status`, body);
      expect(res.statusCode, res.body).toBe(200);
    }
    // Resuming opened the missed week at nothing.
    expect((await prisma.rentalPeriod.findFirstOrThrow({ where: { rentalId: id, seq: 2 } })).amountTetri).toBe(0);

    const c = await calendar(owner);
    expect(entriesOf(c, id).map((e) => e.seq)).not.toContain(2);
    expect(lateOf(c, id)).toBeUndefined();
    // The week after it is at the rate again.
    expect(entryOn(c, id, addDays(t, 6))).toMatchObject({ seq: 3, state: 'expected', amountTetri: 15000 });
  });

  it('names a renter and a moped, and never a personal number', async () => {
    const { owner, id, customer, vehicle, model } = await running(8);
    const res = await call(owner, 'GET', `/api/money/calendar?from=${range().from}&to=${range().to}`);
    const c = json<Cal>(res);
    expect(c.rentals.find((r) => r.id === id)).toEqual({
      id,
      number: expect.stringMatching(/^R-\d+$/),
      customer: { id: customer.id, name: customer.name, nameKa: null, nameLat: null, phone: customer.phone },
      vehicle: { id: vehicle.id, vin: vehicle.vin, model: `Test ${model.name}` },
      weeklyRateTetri: 15000,
      paidThrough: addDays(today(), -2),
      debtTetri: 15000,
    });
    expect(customer.personalId).toBeTruthy();
    expect(res.body).not.toContain(customer.personalId!);
    expect(res.body).not.toContain('personalId');
    // Every rental the answer names has a card, and no card is there for nothing.
    const named = new Set([...c.entries.map((e) => e.rentalId), ...c.late.rentals.map((l) => l.rentalId)]);
    expect(new Set(c.rentals.map((r) => r.id))).toEqual(named);
  });
});

describe.skipIf(!HAS_DB)('payments calendar · the sums', () => {
  it('"received" equals the list of payments and the week report it links to (crit. 21)', async () => {
    const { owner, id } = await running(7);
    const t = today();
    const week = weekOf(t);
    const paid = await call(owner, 'POST', '/api/money', { kind: 'rent', rentalId: id, amountTetri: 15000, channel: 'cash' });
    expect(paid.statusCode, paid.body).toBe(201);

    const c = await calendar(owner);
    const rowOf = async (from: string, to: string) =>
      json<{ totals: { rowTetri: number } }>(await call(owner, 'GET', `/api/payments?from=${from}&to=${to}&row=rent`)).totals.rowTetri;
    const report = json<{ money: { rentTetri: number } }>(await call(owner, 'GET', `/api/reports/week?from=${week.from}&to=${week.to}`));
    // The hand-over's week and the week just paid, both dated today.
    expect(weekOn(c, t).receivedTetri).toBeGreaterThanOrEqual(30000);
    expect(await rowOf(week.from, week.to)).toBe(weekOn(c, t).receivedTetri);
    expect(report.money.rentTetri).toBe(weekOn(c, t).receivedTetri);
    expect(await rowOf(t, t)).toBe(dayOn(c, t).receivedTetri);
  });

  it('every identity of the totals holds on live rows, other suites’ rows included (crit. 20)', async () => {
    const { owner } = await running(14);
    const c = await calendar(owner);
    expect(c.weeks).toHaveLength(5);
    for (const w of c.weeks) {
      const days = c.days.filter((d) => d.date >= w.from && d.date <= w.to);
      expect(days).toHaveLength(7);
      expect(w.expected.count).toBe(w.paid.count + w.left.count);
      expect(w.expected.tetri).toBe(w.paid.tetri + w.left.tetri);
      expect(w.left.count).toBe(w.overdue.count + w.dueToday.count + w.upcoming.count);
      expect(w.left.tetri).toBe(w.overdue.tetri + w.dueToday.tetri + w.upcoming.tetri);
      expect(days.reduce((n, d) => n + d.due.count, 0)).toBe(w.expected.count);
      expect(days.reduce((n, d) => n + d.due.tetri, 0)).toBe(w.expected.tetri);
      expect(days.reduce((n, d) => n + d.paidCount, 0)).toBe(w.paid.count);
      expect(days.reduce((n, d) => n + d.leftTetri, 0)).toBe(w.left.tetri);
      expect(days.reduce((n, d) => n + d.receivedTetri, 0)).toBe(w.receivedTetri);
    }
    expect(c.late.count).toBe(c.late.rentals.length);
    expect(c.late.thisWeekTetri + c.late.earlierTetri).toBe(c.late.debtTetri);
    expect(c.late.thisWeekTetri).toBeGreaterThanOrEqual(0);
    expect(c.late.earlierTetri).toBeGreaterThanOrEqual(0);
    expect(c.late.rentals.reduce((n, l) => n + l.debtTetri, 0)).toBe(c.late.debtTetri);
    // This is the test that meets a row paid above its amount, if a suite left one.
    const broken = c.entries.filter((e) => e.amountTetri !== e.paidTetri + e.leftTetri || e.creditTetri < 0 || e.creditTetri > e.paidTetri || e.paidTetri > e.amountTetri);
    expect(broken).toEqual([]);
  });

  it('counts incoming unsorted lines only, the number "Разобрать" shows for them', async () => {
    const owner = await loginAs('owner');
    const { prisma } = await import('../src/lib/db.js');
    const u = (await calendar(owner)).unsortedIn;
    const statement = await prisma.statement.create({ data: { bank: 'bog', fileName: `calendar-${uniq()}.csv`, fileSha256: `test-${uniq()}` } });
    try {
      const line = (direction: 'in' | 'out') =>
        prisma.statementLine.create({
          data: { statementId: statement.id, bank: 'bog', naturalKey: `calendar-${uniq()}`, occurredOn: date(today()), direction, amountTetri: 15000, raw: 'calendar test line' },
        });
      await line('in');
      expect((await calendar(owner)).unsortedIn).toBe(u + 1);
      await line('out');
      const c = await calendar(owner);
      expect(c.unsortedIn).toBe(u + 1);
      const queue = json<{ counts: { in: number; out: number } }>(await call(owner, 'GET', '/api/statement-lines?direction=in'));
      expect(queue.counts.in).toBe(c.unsortedIn);
    } finally {
      // The lines go with it: the queue of the other suites is as it was.
      await prisma.statement.delete({ where: { id: statement.id } });
    }
  });
});

describe.skipIf(!HAS_DB)('payments calendar · a payment taken back', () => {
  it('pay, then "Отменить": the week, the cell’s sums and "received" go back (crit. 24)', async () => {
    const { owner, id } = await running(7);
    const t = today();
    const read = async () => {
      const c = await calendar(owner);
      return { entry: entryOn(c, id, t), receivedTetri: dayOn(c, t).receivedTetri, paid: weekOn(c, t).paid, paidCount: dayOn(c, t).paidCount };
    };
    const before = await read();
    expect(before.entry).toMatchObject({ state: 'due_today', paidOn: null, channel: null, paymentId: null });

    const res = await call(owner, 'POST', '/api/money', { kind: 'rent', rentalId: id, amountTetri: 15000, channel: 'cash' });
    expect(res.statusCode, res.body).toBe(201);
    const paymentId = json<{ id: string }>(res).id;
    const paid = await read();
    expect(paid.entry).toMatchObject({ state: 'paid', paidOn: t, channel: 'cash', paymentId, leftTetri: 0 });
    expect(paid.receivedTetri - before.receivedTetri).toBe(15000);
    expect(paid.paid.count - before.paid.count).toBe(1);
    expect(paid.paid.tetri - before.paid.tetri).toBe(15000);
    expect(paid.paidCount - before.paidCount).toBe(1);

    // The same person, at once, no reason asked.
    const undo = await call(owner, 'POST', `/api/payments/${paymentId}/undo`);
    expect(undo.statusCode, undo.body).toBe(200);
    expect(await read()).toEqual(before);
  });

  it('an annulled payment is nobody’s credit: the week it paid ahead is expected again (crit. 43, 34)', async () => {
    const { prisma, owner, id } = await running(3, { payment: AHEAD });
    const t = today();
    const ahead = addDays(t, 4);
    expect(entryOn(await calendar(owner), id, ahead).state).toBe('paid_ahead');

    const payment = await prisma.payment.findFirstOrThrow({ where: { rentalId: id } });
    const voided = await call(owner, 'POST', `/api/payments/${payment.id}/void`, { reason: 'test: entered on the wrong rental' });
    expect(voided.statusCode, voided.body).toBe(200);

    const c = await calendar(owner);
    expect(entryOn(c, id, ahead)).toMatchObject({ state: 'expected', creditTetri: 0, paidTetri: 0, leftTetri: 15000, paidOn: null, paymentId: null });
    expect(entryOn(c, id, addDays(t, -3))).toMatchObject({ seq: 1, state: 'overdue', paidTetri: 0, leftTetri: 15000 });
    expect(entriesOf(c, id).map((e) => e.paymentId)).not.toContain(payment.id);
    // The debt is the week and the deposit; the overdue weeks beside it are the week alone.
    expect(lateOf(c, id)).toEqual({ rentalId: id, debtTetri: 33000, overdueTetri: 15000, weeks: 1, sinceOn: addDays(t, -3), days: 3 });
  });
});

describe.skipIf(!HAS_DB)('payments calendar · whose money it is', () => {
  it('card money is credit at what the customer paid, not at what the bank credited', async () => {
    const t = today();
    const before = dayOn(await calendar(await loginAs('owner')), t).receivedTetri;
    const { owner, id } = await running(3, { payment: { later: false, channel: 'acquiring', amountTetri: 48000 } });
    const c = await calendar(owner);
    // Read at net, the 150 left over would be 147.75 and the week 2.25 short.
    expect(entryOn(c, id, addDays(t, 4))).toMatchObject({ state: 'paid_ahead', creditTetri: 15000, leftTetri: 0, channel: 'acquiring', paidOn: t });
    // The first week and the 150 not placed yet, both at gross; the deposit is not rent.
    expect(dayOn(c, t).receivedTetri - before).toBe(30000);
  });

  it('money that names one rental does not pay another, and the late debt is the rental’s, not the customer’s balance', async () => {
    const a = await running(3, { payment: AHEAD });
    const b = await second(a.customer.id, 8);
    const t = today();
    const c = await calendar(a.owner);
    expect(entryOn(c, b.id, addDays(t, -1))).toMatchObject({ seq: 2, state: 'overdue', leftTetri: 15000, creditTetri: 0 });
    expect(entryOn(c, a.id, addDays(t, 4))).toMatchObject({ seq: 2, state: 'paid_ahead', creditTetri: 15000 });
    expect(lateOf(c, a.id)).toBeUndefined();
    expect(lateOf(c, b.id)).toEqual({ rentalId: b.id, debtTetri: 15000, overdueTetri: 15000, weeks: 1, sinceOn: addDays(t, -1), days: 1 });

    const list = json<{ rentals: { id: string; debtTetri: number }[] }>(await call(a.owner, 'GET', '/api/rentals'));
    expect(list.rentals.find((r) => r.id === b.id)?.debtTetri).toBe(15000);
    // The customer's one figure nets the 150 waiting on the other rental; the calendar shows the rental's.
    const balance = json<{ owesTetri: number }>(await call(a.owner, 'GET', `/api/customers/${a.customer.id}/balance`));
    expect(balance.owesTetri).toBe(0);
  });

  it('two rentals of one customer: the rental the calendar gives the money to is the one the roll gives it to', async () => {
    const r1 = await running(14, { payment: AHEAD });
    // Week 3 of the first rental is due today and unpaid, so an owner says why.
    const r2 = await second(r1.customer.id, 7, { debtOverrideReason: 'test: a second moped' });
    const t = today();
    // Today's roll has not run for either: their weeks of today have no row.
    await r1.prisma.rentalPeriod.deleteMany({ where: { rentalId: { in: [r1.id, r2.id] }, startsOn: date(t) } });
    // Nothing is open, so this stays as money tied to no rental.
    const money = await call(r1.owner, 'POST', '/api/payments', { customerId: r1.customer.id, channel: 'cash', grossTetri: 15000 });
    expect(money.statusCode, money.body).toBe(201);
    const { id: paymentId, leftover } = json<{ id: string; leftover: number }>(money);
    expect(leftover).toBe(15000);

    const before = await calendar(r1.owner);
    expect(entryOn(before, r1.id, t)).toMatchObject({ seq: 3, state: 'paid', projected: true, creditTetri: 15000, leftTetri: 0, paymentId });
    expect(entryOn(before, r2.id, t)).toMatchObject({ seq: 2, state: 'due_today', projected: true, creditTetri: 0, leftTetri: 15000 });

    const { rollPeriods } = await import('../src/lib/periods.js');
    await rollPeriods(t);

    const after = await calendar(r1.owner);
    expect(entryOn(after, r1.id, t)).toMatchObject({ seq: 3, state: 'paid', projected: false, creditTetri: 0, leftTetri: 0, paymentId });
    expect(entryOn(after, r2.id, t)).toMatchObject({ seq: 2, state: 'due_today', projected: false, creditTetri: 0, leftTetri: 15000 });
  });
});
