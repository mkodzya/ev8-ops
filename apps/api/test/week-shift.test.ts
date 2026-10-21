// A rental week made longer (ADR-0041): the courier of the call of
// 21.10.2026 paid for his week three days late, with the three days on top —
// 150 + 64. An owner makes the running week three days longer for 64, with a
// reason; every later week and the pay day follow.
//
// The suites share one database and the real clock, so every date is counted
// from today and every assertion is about the suite's own made-up rental. A
// roll to a future day would open weeks for every rental in the database:
// the night's step for one rental (`openWeeks`) stands in for it.
import { addDays, isoWeekday, todayISO, weekOf, type PaymentsCalendarAnswer } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

const today = () => todayISO();
const digits = () => uniq().replace(/\D/g, '');
const date = (day: string) => new Date(`${day}T00:00:00Z`);

async function fixtures() {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Model ${uniq()}`, weeklyRateTetri: 15000, forRent: true } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TEST${digits().slice(0, 13).padStart(13, '0')}`, modelId: model.id, pool: 'rent' } });
  const customer = await prisma.customer.create({ data: { name: `Test Shift ${uniq()}`, phone: `+9955${digits().slice(-8)}`, personalId: digits().slice(-11) } });
  return { prisma, vehicle, customer };
}

/** Handed over `daysAgo` days ago, the deposit and the first week paid in cash. */
async function running(daysAgo: number, over: Record<string, unknown> = {}) {
  const f = await fixtures();
  const owner = await loginAs('owner');
  const res = await call(owner, 'POST', '/api/pickups', {
    customerId: f.customer.id,
    vehicleId: f.vehicle.id,
    weeklyRateTetri: 15000,
    depositTetri: 18000,
    pickedUpOn: addDays(today(), -daysAgo),
    nightParkingAddress: 'Test street 1',
    batteries: 2,
    chargers: 2,
    odometerKm: 100,
    payment: { later: false, channel: 'cash', amountTetri: 33000 },
    ...over,
  });
  if (res.statusCode !== 201) throw new Error(res.body);
  return { ...f, owner, id: json<{ id: string }>(res).id };
}

interface Week {
  seq: number;
  startsOn: string;
  endsOn: string;
  amountTetri: number;
  paidTetri: number;
  payStatus: string;
  extraDays: number;
  extraTetri: number;
  shiftReason: string | null;
}
interface Card {
  rental: {
    status: string;
    paidThrough: string | null;
    dueOn: string | null;
    debtTetri: number;
    payWeekday: number | null;
    payOffsetDays: number;
    weekShiftDays: number;
    weeksFromOn: string | null;
  };
  periods: Week[];
}

const card = async (who: string, id: string) => json<Card>(await call(who, 'GET', `/api/rentals/${id}`));
const weekNo = (c: Card, seq: number) => {
  const w = c.periods.find((p) => p.seq === seq);
  if (!w) throw new Error(`no week ${seq}`);
  return w;
};
const err = (res: { body: string }) => json<{ error: string; field?: string }>(res);
const shift = (who: string, id: string, seq: number, body: Record<string, unknown>) => call(who, 'POST', `/api/rentals/${id}/weeks/${seq}/shift`, body);
const pay = (who: string, id: string, grossTetri: number) => call(who, 'POST', '/api/payments', { rentalId: id, channel: 'cash', grossTetri });

const REASON = 'test: paid three days late, with the three days';

describe.skipIf(!HAS_DB)('a rental week made longer (ADR-0041)', () => {
  it('the courier’s case: 214 paid, the week three days longer for 64 — paid through its new end, the next week from a week after today', async () => {
    // Handed over ten days ago: week 2 began three days ago and is not paid.
    const r = await running(10);
    const t = today();
    expect(weekNo(await card(r.owner, r.id), 2)).toMatchObject({ startsOn: addDays(t, -3), endsOn: addDays(t, 3), amountTetri: 15000, paidTetri: 0 });

    // 150 + 64 in one go: the week takes 150, 64 is the customer's money on no week yet.
    const paid = await pay(r.owner, r.id, 21400);
    expect(paid.statusCode, paid.body).toBe(201);
    expect(weekNo(await card(r.owner, r.id), 2)).toMatchObject({ amountTetri: 15000, paidTetri: 15000, payStatus: 'paid' });

    const res = await shift(r.owner, r.id, 2, { days: 3, extraTetri: '64', reason: REASON });
    expect(res.statusCode, res.body).toBe(200);
    expect(json(res)).toMatchObject({ endsOn: addDays(t, 6), amountTetri: 21400, payWeekday: null });

    const c = await card(r.owner, r.id);
    expect(weekNo(c, 1)).toMatchObject({ startsOn: addDays(t, -10), endsOn: addDays(t, -4), amountTetri: 15000, extraDays: 0 });
    expect(weekNo(c, 2)).toMatchObject({
      startsOn: addDays(t, -3),
      endsOn: addDays(t, 6),
      amountTetri: 21400,
      paidTetri: 21400,
      payStatus: 'paid',
      extraDays: 3,
      extraTetri: 6400,
      shiftReason: REASON,
    });
    // The 64 went onto the week at once, not at 00:10.
    expect(c.rental).toMatchObject({
      status: 'active',
      paidThrough: addDays(t, 6),
      dueOn: addDays(t, 7),
      debtTetri: 0,
      weekShiftDays: 3,
      weeksFromOn: addDays(t, -7),
      payOffsetDays: 0,
    });

    // The journal: was → became, and why.
    const log = await r.prisma.auditLog.findFirst({ where: { entityType: 'rental', entityId: r.id, action: 'rental.week.shift' }, orderBy: { createdAt: 'desc' } });
    expect(log?.note).toBe(REASON);
    expect(log?.before).toMatchObject({ seq: 2, endsOn: addDays(t, 3), amountTetri: 15000, extraDays: 0, extraTetri: 0 });
    expect(log?.after).toMatchObject({ seq: 2, endsOn: addDays(t, 6), amountTetri: 21400, extraDays: 3, extraTetri: 6400 });
  });

  it('the other order — the week moved first, the money after — comes out the same', async () => {
    const r = await running(10);
    const t = today();
    expect((await shift(r.owner, r.id, 2, { days: 3, extraTetri: 6400, reason: REASON })).statusCode).toBe(200);
    // Moved and not yet paid: the whole longer week is owed, from its own first day.
    expect((await card(r.owner, r.id)).rental).toMatchObject({ status: 'overdue', debtTetri: 21400, paidThrough: addDays(t, -4) });

    expect((await pay(r.owner, r.id, 21400)).statusCode).toBe(201);
    const c = await card(r.owner, r.id);
    expect(weekNo(c, 2)).toMatchObject({ endsOn: addDays(t, 6), amountTetri: 21400, paidTetri: 21400, payStatus: 'paid' });
    expect(c.rental).toMatchObject({ status: 'active', paidThrough: addDays(t, 6), dueOn: addDays(t, 7), debtTetri: 0 });
  });

  it('the calendar shows the next week on its moved day, and the night opens it there', async () => {
    const r = await running(10);
    const t = today();
    await pay(r.owner, r.id, 21400);
    await shift(r.owner, r.id, 2, { days: 3, extraTetri: 6400, reason: REASON });

    const range = { from: weekOf(addDays(t, -21)).from, to: weekOf(addDays(t, 14)).to };
    const calendar = async () => {
      const res = await call(r.owner, 'GET', `/api/money/calendar?from=${range.from}&to=${range.to}`);
      if (res.statusCode !== 200) throw new Error(res.body);
      return json<PaymentsCalendarAnswer>(res).entries.filter((e) => e.rentalId === r.id);
    };
    const before = await calendar();
    expect(before.find((e) => e.seq === 2)).toMatchObject({ dueOn: addDays(t, -3), endsOn: addDays(t, 6), amountTetri: 21400, state: 'paid' });
    const next = before.find((e) => e.seq === 3);
    expect(next).toMatchObject({ dueOn: addDays(t, 7), endsOn: addDays(t, 13), amountTetri: 15000, projected: true, state: 'expected' });
    // Nothing on the day the week would have begun unmoved.
    expect(before.some((e) => e.dueOn === addDays(t, 4))).toBe(false);

    // The night of that day opens it where the calendar said, once.
    const { openWeeks } = await import('../src/lib/periods.js');
    expect(await openWeeks(r.id, addDays(t, 6))).toBe(0);
    expect(await openWeeks(r.id, addDays(t, 7))).toBe(1);
    expect(await openWeeks(r.id, addDays(t, 7))).toBe(0);
    const week3 = weekNo(await card(r.owner, r.id), 3);
    expect(week3).toMatchObject({ startsOn: addDays(t, 7), endsOn: addDays(t, 13), amountTetri: 15000, extraDays: 0 });
    expect((await calendar()).find((e) => e.seq === 3)).toEqual({ ...next, projected: false });

    // Week 2 is no longer the last one: its dates stay.
    const late = await shift(r.owner, r.id, 2, { days: 4, extraTetri: 8600, reason: REASON });
    expect(late.statusCode).toBe(409);
    expect(err(late).error).toBe('week_not_last');

    // The database itself keeps a week to 7 days plus the days it gained.
    await expect(r.prisma.rentalPeriod.update({ where: { rentalId_seq: { rentalId: r.id, seq: 3 } }, data: { endsOn: date(addDays(t, 14)) } })).rejects.toThrow();
    await expect(r.prisma.rentalPeriod.update({ where: { rentalId_seq: { rentalId: r.id, seq: 3 } }, data: { extraDays: 2 } })).rejects.toThrow();
  });

  it('a move is set, not added: a second replaces the first, and 0 days takes it back', async () => {
    const r = await running(10);
    const t = today();
    expect((await shift(r.owner, r.id, 2, { days: 3, extraTetri: '64', reason: REASON })).statusCode).toBe(200);
    expect((await shift(r.owner, r.id, 2, { days: 2, extraTetri: '43', reason: 'test: two days, not three' })).statusCode).toBe(200);
    let c = await card(r.owner, r.id);
    expect(weekNo(c, 2)).toMatchObject({ endsOn: addDays(t, 5), amountTetri: 19300, extraDays: 2, extraTetri: 4300 });
    expect(c.rental.weekShiftDays).toBe(2);

    expect((await shift(r.owner, r.id, 2, { days: 0, reason: 'test: entered by mistake' })).statusCode).toBe(200);
    c = await card(r.owner, r.id);
    expect(weekNo(c, 2)).toMatchObject({ endsOn: addDays(t, 3), amountTetri: 15000, extraDays: 0, extraTetri: 0, shiftReason: null });
    expect(c.rental).toMatchObject({ weekShiftDays: 0, weeksFromOn: addDays(t, -10) });
    expect(await r.prisma.auditLog.count({ where: { entityType: 'rental', entityId: r.id, action: 'rental.week.shift' } })).toBe(3);

    // Nothing to take back any more.
    const again = await shift(r.owner, r.id, 2, { days: 0, reason: 'test: again' });
    expect(again.statusCode).toBe(400);
    expect(err(again)).toMatchObject({ error: 'shift_days_range', field: 'days' });
  });

  it('refuses: a manager, no reason, days out of range, no price, a week not there or not the last', async () => {
    const r = await running(10);
    const manager = await loginAs('manager');
    expect((await shift(manager, r.id, 2, { days: 3, extraTetri: '64', reason: REASON })).statusCode).toBe(403);

    const noReason = await shift(r.owner, r.id, 2, { days: 3, extraTetri: '64' });
    expect(noReason.statusCode).toBe(400);
    expect(err(noReason)).toMatchObject({ error: 'missing_field', field: 'reason' });

    for (const days of [7, -1]) {
      const res = await shift(r.owner, r.id, 2, { days, extraTetri: '64', reason: REASON });
      expect(res.statusCode, String(days)).toBe(400);
      expect(err(res)).toMatchObject({ error: 'shift_days_range', field: 'days' });
    }
    expect(err(await shift(r.owner, r.id, 2, { extraTetri: '64', reason: REASON }))).toMatchObject({ error: 'missing_field', field: 'days' });
    expect(err(await shift(r.owner, r.id, 2, { days: 3, reason: REASON }))).toMatchObject({ error: 'missing_field', field: 'extraTetri' });

    const none = await shift(r.owner, r.id, 99, { days: 3, extraTetri: '64', reason: REASON });
    expect(none.statusCode).toBe(404);
    expect(err(none).error).toBe('week_not_found');
    const first = await shift(r.owner, r.id, 1, { days: 3, extraTetri: '64', reason: REASON });
    expect(first.statusCode).toBe(409);
    expect(err(first).error).toBe('week_not_last');

    // Nothing was written by any of them.
    expect(weekNo(await card(r.owner, r.id), 2)).toMatchObject({ extraDays: 0, amountTetri: 15000 });
    expect(await r.prisma.auditLog.count({ where: { entityType: 'rental', entityId: r.id, action: 'rental.week.shift' } })).toBe(0);
  });

  it('refuses to make a week cheaper than what is paid on it', async () => {
    const r = await running(10);
    await pay(r.owner, r.id, 21400);
    expect((await shift(r.owner, r.id, 2, { days: 3, extraTetri: '64', reason: REASON })).statusCode).toBe(200);
    for (const body of [{ days: 3, extraTetri: 0 }, { days: 0 }]) {
      const res = await shift(r.owner, r.id, 2, { ...body, reason: REASON });
      expect(res.statusCode).toBe(409);
      expect(err(res).error).toBe('shift_over_paid');
    }
  });

  it('only a running rental: not paused, disputed or returned; not a week at nothing; not a week paid before the transfer', async () => {
    for (const status of ['paused', 'disputed'] as const) {
      const r = await running(10);
      expect((await call(r.owner, 'POST', `/api/rentals/${r.id}/status`, { status, reason: 'test: the moped stands' })).statusCode).toBe(200);
      const res = await shift(r.owner, r.id, 2, { days: 3, extraTetri: '64', reason: REASON });
      expect(res.statusCode, status).toBe(409);
      expect(err(res).error).toBe('rental_not_running');
    }

    const back = await running(10);
    await back.prisma.rental.update({ where: { id: back.id }, data: { status: 'returned', returnedOn: date(today()) } });
    expect(err(await shift(back.owner, back.id, 2, { days: 3, extraTetri: '64', reason: REASON })).error).toBe('rental_not_running');

    const free = await running(10);
    expect((await call(free.owner, 'POST', `/api/rentals/${free.id}/weeks/2/discount`, { discountTetri: '150', reason: 'test: the moped never ran' })).statusCode).toBe(200);
    const nothing = await shift(free.owner, free.id, 2, { days: 3, extraTetri: '64', reason: REASON });
    expect(nothing.statusCode).toBe(409);
    expect(err(nothing).error).toBe('week_at_nothing');

    // Brought over with both weeks paid before the transfer.
    const f = await fixtures();
    const owner = await loginAs('owner');
    const pickedUpOn = addDays(today(), -10);
    const res = await call(owner, 'POST', '/api/pickups', {
      customerId: f.customer.id,
      vehicleId: f.vehicle.id,
      weeklyRateTetri: 15000,
      depositTetri: 18000,
      pickedUpOn,
      nightParkingAddress: 'Test street 1',
      batteries: 2,
      chargers: 2,
      transfer: { paidThrough: addDays(pickedUpOn, 13), depositReceivedTetri: 18000 },
    });
    expect(res.statusCode, res.body).toBe(201);
    const carried = await shift(owner, json<{ id: string }>(res).id, 2, { days: 3, extraTetri: '64', reason: REASON });
    expect(carried.statusCode).toBe(409);
    expect(err(carried).error).toBe('week_paid_before_transfer');
  });

  it('a moved week whose end is past lets the next one begin at once; a pause lifted opens weeks at nothing on the moved grid', async () => {
    // Handed over twenty days ago: week 3 began six days ago. Take it away,
    // as if the night had not run, so that week 2 is the last.
    const r = await running(20);
    const t = today();
    await r.prisma.rentalPeriod.deleteMany({ where: { rentalId: r.id, seq: 3 } });

    // Three days longer: week 2 ends four days ago, and week 3 — begun three days ago — is opened right away.
    expect((await shift(r.owner, r.id, 2, { days: 3, extraTetri: '64', reason: REASON })).statusCode).toBe(200);
    let c = await card(r.owner, r.id);
    expect(weekNo(c, 2)).toMatchObject({ startsOn: addDays(t, -13), endsOn: addDays(t, -4), amountTetri: 21400 });
    expect(weekNo(c, 3)).toMatchObject({ startsOn: addDays(t, -3), endsOn: addDays(t, 3), amountTetri: 15000 });

    // Stood and running again: the week that began meanwhile exists at nothing, on its moved days.
    await r.prisma.rentalPeriod.deleteMany({ where: { rentalId: r.id, seq: 3 } });
    for (const body of [
      { status: 'paused', reason: 'test: the moped stands' },
      { status: 'active', reason: 'test: back on the road' },
    ]) {
      expect((await call(r.owner, 'POST', `/api/rentals/${r.id}/status`, body)).statusCode).toBe(200);
    }
    c = await card(r.owner, r.id);
    expect(weekNo(c, 3)).toMatchObject({ startsOn: addDays(t, -3), endsOn: addDays(t, 3), amountTetri: 0 });
  });

  it('the return counts the weeks on the moved grid', async () => {
    const r = await running(10);
    const t = today();
    await pay(r.owner, r.id, 21400);
    await shift(r.owner, r.id, 2, { days: 3, extraTetri: '64', reason: REASON });
    type Preview = { settlement: { weeks: { seq: number; startsOn: string; endsOn: string; owesTetri: number }[] } };
    const preview = async (returnedOn: string) => json<Preview>(await call(r.owner, 'POST', `/api/rentals/${r.id}/return/preview`, { returnedOn })).settlement.weeks;
    // Unmoved, week 3 would have begun four days from now and be owed.
    expect(await preview(addDays(t, 5))).toEqual([]);
    expect(await preview(addDays(t, 7))).toMatchObject([{ seq: 3, startsOn: addDays(t, 7), endsOn: addDays(t, 13), owesTetri: 15000 }]);
  });

  it('the pay day moves with the weeks and keeps its place in a week; the weeks’ new weekday is kept as no pay day', async () => {
    const r = await running(10);
    const t = today();
    // Week 2 began three days ago; this renter pays a day into a week.
    expect((await call(r.owner, 'PATCH', `/api/rentals/${r.id}`, { payWeekday: isoWeekday(addDays(t, -2)), reason: 'test: pays a day later' })).statusCode).toBe(200);
    expect((await card(r.owner, r.id)).rental.payOffsetDays).toBe(1);

    await pay(r.owner, r.id, 21400);
    const res = await shift(r.owner, r.id, 2, { days: 3, extraTetri: '64', reason: REASON });
    expect(res.statusCode, res.body).toBe(200);
    expect(json(res)).toMatchObject({ payWeekday: isoWeekday(addDays(t, 1)) });
    let c = await card(r.owner, r.id);
    // Week 3 runs from a week after today and is due a day into it.
    expect(c.rental).toMatchObject({ payWeekday: isoWeekday(addDays(t, 1)), payOffsetDays: 1, dueOn: addDays(t, 8), status: 'active' });
    const log = await r.prisma.auditLog.findFirst({ where: { entityType: 'rental', entityId: r.id, action: 'rental.week.shift' }, orderBy: { createdAt: 'desc' } });
    expect(log?.before).toMatchObject({ payWeekday: isoWeekday(addDays(t, -2)) });
    expect(log?.after).toMatchObject({ payWeekday: isoWeekday(addDays(t, 1)) });

    // The weekday the weeks now start on is no pay day of its own — not the pickup's weekday any more.
    expect((await call(r.owner, 'PATCH', `/api/rentals/${r.id}`, { payWeekday: isoWeekday(t), reason: 'test: back to the week’s first day' })).statusCode).toBe(200);
    c = await card(r.owner, r.id);
    expect(c.rental).toMatchObject({ payWeekday: null, payOffsetDays: 0, dueOn: addDays(t, 7) });
    expect((await call(r.owner, 'PATCH', `/api/rentals/${r.id}`, { payWeekday: isoWeekday(addDays(t, -10)), reason: 'test: the pickup’s weekday' })).statusCode).toBe(200);
    expect((await card(r.owner, r.id)).rental).toMatchObject({ payWeekday: isoWeekday(addDays(t, -10)), payOffsetDays: 4 });
  });
});
