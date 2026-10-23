// «Перенос дня оплаты» in «Разнести», a manager moving a week, and a week
// made shorter (issue #12 of the director, 23.10.2026; Mika's «А» the same
// day; ADR-0041, addendum of 23.10.2026). The director's case, with a
// made-up renter: a bank line of 170 is 150 for the week and 20 so that he
// pays a day later from now on — the week one day longer and dearer by the
// 20, paid whole by the line, no charge of «20» anywhere.
//
// The suites share one database and the real clock, so every date is counted
// from today and every assertion is about the suite's own made-up rental. The
// bank lines are written straight into the queue, as the pull leaves them,
// with a purpose no rule can read, so no rule takes them first.
import { addDays, isoWeekday, rotateWeekday, todayISO } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

const today = () => todayISO();
const digits = () => uniq().replace(/\D/g, '');

async function fixtures() {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Model ${uniq()}`, weeklyRateTetri: 15000, forRent: true } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TESTPD${digits().slice(-11).padStart(11, '0')}`, modelId: model.id, pool: 'rent' } });
  const customer = await prisma.customer.create({ data: { name: `Test Pay Day ${uniq()}`, phone: `+9955${digits().slice(-8)}`, personalId: digits().slice(-11) } });
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

/** A bank line in «Разобрать», today, as the pull leaves it. */
async function bankLine(amountTetri: number) {
  const { prisma } = await import('../src/lib/db.js');
  const statement = await prisma.statement.create({ data: { bank: 'tbc', fileName: `Test pay day ${uniq()}`, fileSha256: `test-${uniq()}`, source: 'api' } });
  return prisma.statementLine.create({
    data: {
      statementId: statement.id,
      bank: 'tbc',
      naturalKey: `pay-day-${uniq()}`,
      occurredOn: new Date(`${today()}T00:00:00Z`),
      direction: 'in',
      amountTetri,
      purpose: 'test transfer',
      raw: `Test transfer ${uniq()}`,
    },
  });
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
    vehicle: { id: string } | null;
  };
  periods: Week[];
}
interface Move {
  seq: number;
  startsOn: string;
  endsOn: string;
  payDay: number;
  payOffsetDays: number;
  closed: 'older_week_open' | 'week_moved' | null;
}

const card = async (who: string, id: string) => json<Card>(await call(who, 'GET', `/api/rentals/${id}`));
const weekNo = (c: Card, seq: number) => {
  const w = c.periods.find((p) => p.seq === seq);
  if (!w) throw new Error(`no week ${seq}`);
  return w;
};
const err = (res: { body: string }) => json<{ error: string; field?: string }>(res);
const split = (who: string, lineId: string, body: Record<string, unknown>) => call(who, 'POST', `/api/statement-lines/${lineId}/split`, body);
const shiftOnCard = (who: string, id: string, seq: number, body: Record<string, unknown>) => call(who, 'POST', `/api/rentals/${id}/weeks/${seq}/shift`, body);
const moveOf = async (who: string, customerId: string, rentalId: string) =>
  json<{ rentals: { id: string; payDayMove: Move | null }[] }>(await call(who, 'GET', `/api/customers/${customerId}/money-targets`)).rentals.find((r) => r.id === rentalId)!.payDayMove;
/** What of a payment nothing has taken: the customer's credit. */
const creditOf = async (prisma: Awaited<ReturnType<typeof fixtures>>['prisma'], paymentId: string) => {
  const p = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { allocations: { select: { amountTetri: true } } } });
  return p.grossTetri - p.allocations.reduce((n, a) => n + a.amountTetri, 0);
};

const REASON = 'test: pay day moved a day later, paid by the bank line';

describe.skipIf(!HAS_DB)('«Перенос дня оплаты» in «Разнести» (issue #12)', () => {
  it('the director’s case: 170 = rent 150 + 20 for a day later — the week a day longer and paid, the next rent a week after the new day, no charge', async () => {
    // Handed over eight days ago: week 2 began yesterday and is owed.
    const r = await running(8);
    const t = today();
    const payDay = isoWeekday(addDays(t, -1));
    expect(weekNo(await card(r.owner, r.id), 2)).toMatchObject({ startsOn: addDays(t, -1), endsOn: addDays(t, 5), amountTetri: 15000, paidTetri: 0 });
    // «Разнести» offers the move on the latest week, from the day the rent falls due now.
    expect(await moveOf(r.owner, r.customer.id, r.id)).toMatchObject({ seq: 2, startsOn: addDays(t, -1), endsOn: addDays(t, 5), payDay, payOffsetDays: 0, closed: null });

    const line = await bankLine(17000);
    const res = await split(r.owner, line.id, { parts: [{ rentalId: r.id, grossTetri: '150' }], shift: { rentalId: r.id, seq: 2, days: 1, extraTetri: '20', reason: REASON } });
    expect(res.statusCode, res.body).toBe(200);
    const answer = json<{ ids: string[]; shift: { rentalId: string; seq: number } }>(res);
    expect(answer.ids).toHaveLength(2);
    expect(answer.shift).toEqual({ rentalId: r.id, seq: 2 });

    const c = await card(r.owner, r.id);
    expect(weekNo(c, 2)).toMatchObject({ startsOn: addDays(t, -1), endsOn: addDays(t, 6), amountTetri: 17000, paidTetri: 17000, payStatus: 'paid', extraDays: 1, extraTetri: 2000, shiftReason: REASON });
    expect(c.rental).toMatchObject({ status: 'active', paidThrough: addDays(t, 6), dueOn: addDays(t, 7), debtTetri: 0, weekShiftDays: 1, payWeekday: null });
    // The next rent falls on the day after the old pay day — the day chosen.
    expect(isoWeekday(c.rental.dueOn!)).toBe(rotateWeekday(payDay, 1));

    // Two payments of the line, both rent of this rental; the second is the move's, with its reason.
    const made = await r.prisma.payment.findMany({ where: { statementLineId: line.id, voidedAt: null }, orderBy: { statementPart: 'asc' } });
    expect(made.map((p) => [p.statementPart, p.kind, p.grossTetri, p.rentalId, p.note])).toEqual([
      [1, 'rent', 15000, r.id, null],
      [2, 'rent', 2000, r.id, REASON],
    ]);
    // No charge of «20»: the move is the week's price, not a fine.
    expect(await r.prisma.rentalCharge.count({ where: { rentalId: r.id } })).toBe(0);
    // The line left the queue.
    expect((await r.prisma.statementLine.findUniqueOrThrow({ where: { id: line.id } })).status).toBe('matched');

    // The journal: the move by the owner with its reason, and the line's split naming it.
    const moved = await r.prisma.auditLog.findFirstOrThrow({ where: { entityType: 'rental', entityId: r.id, action: 'rental.week.shift' } });
    expect(moved.note).toBe(REASON);
    expect(moved.after).toMatchObject({ seq: 2, endsOn: addDays(t, 6), amountTetri: 17000, extraDays: 1, extraTetri: 2000, payDay: rotateWeekday(payDay, 1) });
    const splitLog = await r.prisma.auditLog.findFirstOrThrow({ where: { entityType: 'statement_line', entityId: line.id, action: 'statement.line.split' } });
    expect(splitLog.after).toMatchObject({ shift: { rentalId: r.id, seq: 2, days: 1, extraTetri: 2000 } });
    // Done: the week is moved already — «Разнести» shows the move closed.
    expect((await moveOf(r.owner, r.customer.id, r.id))?.closed).toBe('week_moved');
  });

  it('a line that pays an older week: the move is shown closed, and the server refuses it — nothing written', async () => {
    // Handed over fifteen days ago: week 2 is late and unpaid, week 3 began yesterday.
    const r = await running(15);
    expect(await moveOf(r.owner, r.customer.id, r.id)).toMatchObject({ seq: 3, closed: 'older_week_open' });
    const line = await bankLine(17000);
    const res = await split(r.owner, line.id, { parts: [{ rentalId: r.id, grossTetri: 15000 }], shift: { rentalId: r.id, seq: 3, days: 1, extraTetri: 2000, reason: REASON } });
    expect(res.statusCode).toBe(409);
    expect(err(res)).toMatchObject({ error: 'shift_older_week_open', field: 'days' });
    expect((await r.prisma.statementLine.findUniqueOrThrow({ where: { id: line.id } })).status).toBe('unmatched');
    expect(weekNo(await card(r.owner, r.id), 3)).toMatchObject({ extraDays: 0, amountTetri: 15000 });
    expect(await r.prisma.payment.count({ where: { statementLineId: line.id } })).toBe(0);
  });

  it('refuses a move that does not add up or cannot be: the money left out, a week moved already, no days, no reason', async () => {
    const r = await running(8);
    const line = await bankLine(17000);
    const body = (shift: Record<string, unknown>, rent = 15000) => ({ parts: [{ rentalId: r.id, grossTetri: rent }], shift: { rentalId: r.id, seq: 2, ...shift } });
    // A longer week's extra is money of the line: 150 + 20 is the line, 150 alone is not.
    expect(err(await split(r.owner, line.id, body({ days: 1, extraTetri: 0, reason: REASON })))).toMatchObject({ error: 'split_sum' });
    // A shorter week's discount is not money of the line.
    expect(err(await split(r.owner, line.id, body({ days: -1, extraTetri: 2000, reason: REASON }, 15000)))).toMatchObject({ error: 'split_sum' });
    expect(err(await split(r.owner, line.id, body({ days: 0, extraTetri: 2000, reason: REASON })))).toMatchObject({ error: 'shift_days_range', field: 'days' });
    expect(err(await split(r.owner, line.id, body({ days: 7, extraTetri: 2000, reason: REASON })))).toMatchObject({ error: 'shift_days_range', field: 'days' });
    expect(err(await split(r.owner, line.id, body({ days: 1, extraTetri: 2000 })))).toMatchObject({ error: 'missing_field', field: 'reason' });
    expect(err(await split(r.owner, line.id, body({ days: 1, reason: REASON })))).toMatchObject({ error: 'missing_field', field: 'extraTetri' });
    // A move with nothing else and no money of its own writes nothing either.
    expect(err(await split(r.owner, line.id, { parts: [], shift: { rentalId: r.id, seq: 2, days: -1, extraTetri: 2100, reason: REASON } }))).toMatchObject({ error: 'split_sum' });

    // Moved on its card already: «Разнести» counts from the week as it is, and leaves the move to the card.
    expect((await shiftOnCard(r.owner, r.id, 2, { days: 2, extraTetri: '43', reason: 'test: two days' })).statusCode).toBe(200);
    expect(err(await split(r.owner, line.id, body({ days: 1, extraTetri: 2000, reason: REASON })))).toMatchObject({ error: 'week_moved_already', field: 'days' });
    // A manager does not allocate bank lines.
    const manager = await loginAs('manager');
    expect((await split(manager, line.id, body({ days: 1, extraTetri: 2000, reason: REASON }))).statusCode).toBe(403);
    expect((await r.prisma.statementLine.findUniqueOrThrow({ where: { id: line.id } })).status).toBe('unmatched');
  });

  it('a line that is the move’s money alone: the week paid earlier, 20 more make it a day longer', async () => {
    const r = await running(8);
    const t = today();
    expect((await call(r.owner, 'POST', '/api/payments', { rentalId: r.id, channel: 'cash', grossTetri: 15000 })).statusCode).toBe(201);
    const line = await bankLine(2000);
    const res = await split(r.owner, line.id, { parts: [], shift: { rentalId: r.id, seq: 2, days: 1, extraTetri: 2000, reason: REASON } });
    expect(res.statusCode, res.body).toBe(200);
    expect(json<{ ids: string[] }>(res).ids).toHaveLength(1);
    expect(weekNo(await card(r.owner, r.id), 2)).toMatchObject({ endsOn: addDays(t, 6), amountTetri: 17000, paidTetri: 17000, payStatus: 'paid' });
  });

  it('a rental with its own pay day: the pay day moves to the day chosen and keeps its place in the week', async () => {
    const r = await running(8);
    const t = today();
    // Week 2 began yesterday; this renter pays a day into a week — today.
    expect((await call(r.owner, 'PATCH', `/api/rentals/${r.id}`, { payWeekday: isoWeekday(t), reason: 'test: pays a day into the week' })).statusCode).toBe(200);
    expect(await moveOf(r.owner, r.customer.id, r.id)).toMatchObject({ payDay: isoWeekday(t), payOffsetDays: 1, closed: null });

    const line = await bankLine(17000);
    const res = await split(r.owner, line.id, { parts: [{ rentalId: r.id, grossTetri: 15000 }], shift: { rentalId: r.id, seq: 2, days: 1, extraTetri: 2000, reason: REASON } });
    expect(res.statusCode, res.body).toBe(200);
    const c = await card(r.owner, r.id);
    // The next week from a week after today, due a day into it: on the weekday after today's.
    expect(c.rental).toMatchObject({ payWeekday: isoWeekday(addDays(t, 1)), payOffsetDays: 1, dueOn: addDays(t, 8), debtTetri: 0, paidThrough: addDays(t, 6) });
  });

  it('a swapped rental keeps its weeks, and its latest week is moved from a bank line all the same', async () => {
    const r = await running(8);
    const t = today();
    const point = await r.prisma.location.create({ data: { name: `ТЕСТ point ${uniq()}` }, select: { id: true } });
    const model = await r.prisma.vehicleModel.create({ data: { brand: 'Test', name: `Model ${uniq()}`, weeklyRateTetri: 15000, forRent: true } });
    const fresh = await r.prisma.vehicle.create({ data: { vin: `TESTPS${digits().slice(-11).padStart(11, '0')}`, modelId: model.id, pool: 'rent' } });
    const swapped = await call(r.owner, 'POST', `/api/rentals/${r.id}/swap`, {
      swappedOn: t,
      reason: 'test: the battery went',
      outOdometerKm: 150,
      items: { moped: { state: 'ok' }, key: { state: 'ok' } },
      toService: false,
      locationId: point.id,
      vehicleId: fresh.id,
      inOdometerKm: 10,
    });
    expect(swapped.statusCode, swapped.body).toBe(200);

    const line = await bankLine(17000);
    const res = await split(r.owner, line.id, { parts: [{ rentalId: r.id, grossTetri: 15000 }], shift: { rentalId: r.id, seq: 2, days: 1, extraTetri: 2000, reason: REASON } });
    expect(res.statusCode, res.body).toBe(200);
    const c = await card(r.owner, r.id);
    expect(c.rental).toMatchObject({ vehicle: { id: fresh.id }, paidThrough: addDays(t, 6), debtTetri: 0, weekShiftDays: 1 });
    expect(weekNo(c, 2)).toMatchObject({ amountTetri: 17000, paidTetri: 17000 });
  });

  it('a rental carried over: its week after the transfer is moved; one paid before the transfer is not offered', async () => {
    const f = await fixtures();
    const owner = await loginAs('owner');
    const t = today();
    const pickedUpOn = addDays(t, -8);
    const carry = async (paidThrough: string) => {
      const res = await call(owner, 'POST', '/api/pickups', {
        customerId: f.customer.id,
        vehicleId: (await f.prisma.vehicle.create({ data: { vin: `TESTPT${digits().slice(-11).padStart(11, '0')}`, modelId: f.vehicle.modelId, pool: 'rent' } })).id,
        weeklyRateTetri: 15000,
        depositTetri: 18000,
        pickedUpOn,
        nightParkingAddress: 'Test street 1',
        batteries: 2,
        chargers: 2,
        transfer: { paidThrough, depositReceivedTetri: 18000 },
      });
      expect(res.statusCode, res.body).toBe(201);
      return json<{ id: string }>(res).id;
    };
    // Week 1 paid before the transfer, week 2 — begun yesterday — owed in EV8 Ops.
    const id = await carry(addDays(pickedUpOn, 6));
    expect(await moveOf(owner, f.customer.id, id)).toMatchObject({ seq: 2, closed: null });
    const line = await bankLine(17000);
    const res = await split(owner, line.id, { parts: [{ rentalId: id, grossTetri: 15000 }], shift: { rentalId: id, seq: 2, days: 1, extraTetri: 2000, reason: REASON } });
    expect(res.statusCode, res.body).toBe(200);
    expect(weekNo(await card(owner, id), 2)).toMatchObject({ endsOn: addDays(t, 6), amountTetri: 17000, paidTetri: 17000 });

    // Both weeks paid before the transfer: nothing to move from a bank line.
    const both = await carry(addDays(pickedUpOn, 13));
    expect(await moveOf(owner, f.customer.id, both)).toBeNull();
  });

  it('the move taken back on the card: the payments stay, the week is 150 again, the 20 are credit for the next week', async () => {
    const r = await running(8);
    const t = today();
    const line = await bankLine(17000);
    const { ids } = json<{ ids: string[] }>(
      await split(r.owner, line.id, { parts: [{ rentalId: r.id, grossTetri: 15000 }], shift: { rentalId: r.id, seq: 2, days: 1, extraTetri: 2000, reason: REASON } }),
    );
    const back = await shiftOnCard(r.owner, r.id, 2, { days: 0, reason: 'test: he pays on the old day after all' });
    expect(back.statusCode, back.body).toBe(200);
    expect(json(back)).toMatchObject({ amountTetri: 15000, freedTetri: 2000 });
    const c = await card(r.owner, r.id);
    expect(weekNo(c, 2)).toMatchObject({ endsOn: addDays(t, 5), amountTetri: 15000, paidTetri: 15000, payStatus: 'paid', extraDays: 0, extraTetri: 0 });
    expect(c.rental).toMatchObject({ paidThrough: addDays(t, 5), debtTetri: 0, weekShiftDays: 0 });
    // Neither payment is voided; the move's 20 wait as credit — the newest money on the week is the one freed.
    expect(await r.prisma.payment.count({ where: { id: { in: ids }, voidedAt: null } })).toBe(2);
    expect(await creditOf(r.prisma, ids[1])).toBe(2000);
    expect(await creditOf(r.prisma, ids[0])).toBe(0);

    // The night the next week begins, the 20 go onto it.
    const { openWeeks, settleCredit } = await import('../src/lib/periods.js');
    expect(await openWeeks(r.id, addDays(t, 6))).toBe(1);
    await settleCredit(r.id);
    expect(weekNo(await card(r.owner, r.id), 3)).toMatchObject({ startsOn: addDays(t, 6), paidTetri: 2000, payStatus: 'partial' });
    expect(await creditOf(r.prisma, ids[1])).toBe(0);
  });

  it('«Отменить» right after: the line’s payments undone and the move taken back leave the week as it was and the line in the queue', async () => {
    const r = await running(8);
    const t = today();
    const line = await bankLine(17000);
    const res = await split(r.owner, line.id, { parts: [{ rentalId: r.id, grossTetri: 15000 }], shift: { rentalId: r.id, seq: 2, days: 1, extraTetri: 2000, reason: REASON } });
    const { ids, shift } = json<{ ids: string[]; shift: { rentalId: string; seq: number } }>(res);
    // What the message's «Отменить» sends, one after the other.
    expect((await call(r.owner, 'POST', `/api/payments/${ids[0]}/undo`)).statusCode).toBe(200);
    expect((await shiftOnCard(r.owner, shift.rentalId, shift.seq, { days: 0, reason: 'test: undone at once' })).statusCode).toBe(200);
    expect(weekNo(await card(r.owner, r.id), 2)).toMatchObject({ endsOn: addDays(t, 5), amountTetri: 15000, paidTetri: 0, extraDays: 0 });
    expect(await r.prisma.payment.count({ where: { statementLineId: line.id, voidedAt: null } })).toBe(0);
    expect((await r.prisma.statementLine.findUniqueOrThrow({ where: { id: line.id } })).status).toBe('unmatched');
  });
});

describe.skipIf(!HAS_DB)('a manager moves a week (ADR-0041, addendum of 23.10.2026)', () => {
  it('a manager moves the latest week on the card; the journal says who and why; an owner takes it back', async () => {
    const r = await running(8);
    const t = today();
    const manager = await loginAs('manager');
    const res = await shiftOnCard(manager, r.id, 2, { days: 1, extraTetri: '20', reason: 'test: the manager agreed a day later' });
    expect(res.statusCode, res.body).toBe(200);
    expect(weekNo(await card(manager, r.id), 2)).toMatchObject({ endsOn: addDays(t, 6), amountTetri: 17000, extraDays: 1 });
    const log = await r.prisma.auditLog.findFirstOrThrow({ where: { entityType: 'rental', entityId: r.id, action: 'rental.week.shift' } });
    expect(log.note).toBe('test: the manager agreed a day later');
    expect((await r.prisma.user.findUniqueOrThrow({ where: { id: log.actorId! } })).role).toBe('manager');

    const back = await shiftOnCard(r.owner, r.id, 2, { days: 0, reason: 'test: not agreed' });
    expect(back.statusCode, back.body).toBe(200);
    const undo = await r.prisma.auditLog.findFirstOrThrow({ where: { entityType: 'rental', entityId: r.id, action: 'rental.week.shift.undo' } });
    expect((await r.prisma.user.findUniqueOrThrow({ where: { id: undo.actorId! } })).role).toBe('owner');
    expect(weekNo(await card(r.owner, r.id), 2)).toMatchObject({ endsOn: addDays(t, 5), amountTetri: 15000, extraDays: 0 });
  });
});

describe.skipIf(!HAS_DB)('a week made shorter (ADR-0041, addendum of 23.10.2026)', () => {
  it('a day earlier: the week a day shorter for 21 off, what was paid above it becomes credit, and the next week takes it', async () => {
    const r = await running(8);
    const t = today();
    const paid = json<{ id: string }>(await call(r.owner, 'POST', '/api/payments', { rentalId: r.id, channel: 'cash', grossTetri: 15000 }));
    const res = await shiftOnCard(r.owner, r.id, 2, { days: -1, extraTetri: '21', reason: 'test: pays a day earlier from now on' });
    expect(res.statusCode, res.body).toBe(200);
    expect(json(res)).toMatchObject({ endsOn: addDays(t, 4), amountTetri: 12900, freedTetri: 2100 });
    const c = await card(r.owner, r.id);
    // Stored with the days' sign: a day lost, 21 off.
    expect(weekNo(c, 2)).toMatchObject({ startsOn: addDays(t, -1), endsOn: addDays(t, 4), amountTetri: 12900, paidTetri: 12900, payStatus: 'paid', extraDays: -1, extraTetri: -2100 });
    expect(c.rental).toMatchObject({ paidThrough: addDays(t, 4), dueOn: addDays(t, 5), weekShiftDays: -1, weeksFromOn: addDays(t, -9), debtTetri: 0 });
    expect(await creditOf(r.prisma, paid.id)).toBe(2100);
    const log = await r.prisma.auditLog.findFirstOrThrow({ where: { entityType: 'rental', entityId: r.id, action: 'rental.week.shift' } });
    expect(log.after).toMatchObject({ extraDays: -1, extraTetri: -2100, amountTetri: 12900, freedTetri: 2100, payDay: rotateWeekday(isoWeekday(addDays(t, -1)), -1) });

    // The next week begins a day earlier than it would have, and takes the 21.
    const { openWeeks, settleCredit } = await import('../src/lib/periods.js');
    expect(await openWeeks(r.id, addDays(t, 4))).toBe(0);
    expect(await openWeeks(r.id, addDays(t, 5))).toBe(1);
    await settleCredit(r.id);
    expect(weekNo(await card(r.owner, r.id), 3)).toMatchObject({ startsOn: addDays(t, 5), endsOn: addDays(t, 11), paidTetri: 2100 });
  });

  it('never ending before today, never a discount above the week; from a bank line the discount is no money of it', async () => {
    const r = await running(8);
    const t = today();
    // Week 2 began yesterday: six days off would end it yesterday.
    const early = await shiftOnCard(r.owner, r.id, 2, { days: -6, extraTetri: '129', reason: 'test: too early' });
    expect(early.statusCode).toBe(409);
    expect(err(early)).toMatchObject({ error: 'week_ends_before_today', field: 'days' });
    const over = await shiftOnCard(r.owner, r.id, 2, { days: -1, extraTetri: '151', reason: 'test: more off than the week' });
    expect(over.statusCode).toBe(409);
    expect(err(over)).toMatchObject({ error: 'discount_over_week', field: 'extraTetri' });

    // From «Разнести»: 129 for a week a day shorter at 21 off — the line closes it whole.
    const line = await bankLine(12900);
    const res = await split(r.owner, line.id, { parts: [{ rentalId: r.id, grossTetri: 12900 }], shift: { rentalId: r.id, seq: 2, days: -1, extraTetri: 2100, reason: 'test: a day earlier, paid by the bank line' } });
    expect(res.statusCode, res.body).toBe(200);
    expect(json<{ ids: string[] }>(res).ids).toHaveLength(1);
    const c = await card(r.owner, r.id);
    expect(weekNo(c, 2)).toMatchObject({ endsOn: addDays(t, 4), amountTetri: 12900, paidTetri: 12900, payStatus: 'paid' });
    expect(c.rental).toMatchObject({ debtTetri: 0, paidThrough: addDays(t, 4) });
  });
});
