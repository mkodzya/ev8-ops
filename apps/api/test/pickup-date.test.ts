// An open rental's pickup date put right, and its deposit marked received
// before EV8 Ops — or the mark taken off (issue #10 of the director, Mika's
// «А» of 23.10.2026; ADR-0044). The two cases of the issue, with made-up
// customers: a rental entered four days before its true hand-over, whose
// first rent went onto a deposit the customer had paid with an earlier moped;
// and a rental carried over whose deposit was marked received earlier though
// it came by the bank.
//
// The suites share one database and the real clock, so every date is counted
// from today and every assertion is about the suite's own made-up rental. A
// roll to a future day would open weeks for every rental in the database: the
// night's step for one rental (`openWeeks`, `settleCredit`) stands in for it.
import { addDays, dayQueue, isoWeekday, todayISO, weekOf, type PaymentsCalendarAnswer } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

const today = () => todayISO();
const digits = () => uniq().replace(/\D/g, '');
const date = (day: string) => new Date(`${day}T00:00:00Z`);

async function fixtures() {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Model ${uniq()}`, weeklyRateTetri: 15000, forRent: true } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TEST${digits().slice(0, 13).padStart(13, '0')}`, modelId: model.id, pool: 'rent' } });
  const customer = await prisma.customer.create({ data: { name: `Test Pickup Date ${uniq()}`, phone: `+9955${digits().slice(-8)}`, personalId: digits().slice(-11) } });
  return { prisma, model, vehicle, customer };
}

/** Handed over `daysAgo` days ago; by default the deposit and the first week paid in cash. */
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

/** Brought over by an owner: begun `daysAgo` days ago, weeks paid through `paidThrough`. */
async function carried(daysAgo: number, transfer: { paidThrough: string | null; depositReceivedTetri: number }) {
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
    transfer,
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
  extraDays: number;
  paidBeforeTransfer: boolean;
}
interface Card {
  rental: {
    status: string;
    pickedUpOn: string;
    paidThrough: string | null;
    dueOn: string | null;
    debtTetri: number;
    payWeekday: number | null;
    weekShiftDays: number;
    weeksFromOn: string | null;
  };
  deposit: { amountTetri: number; paidTetri: number; receivedBeforeTetri: number };
  periods: Week[];
  payments: { id: string; grossTetri: number }[];
  acts: { kind: string; occurredOn: string }[];
}
interface Change {
  weeks: { seq: number; was: { startsOn: string; endsOn: string } | null; now: { startsOn: string; endsOn: string } | null; paidWas: number; paidNow: number }[];
  moves: { paymentId: string; was: { kind: string; seq?: number; amountTetri: number }[]; now: { kind: string; seq?: number; amountTetri: number }[] }[];
  owes: { was: number; now: number };
  paidThrough: { was: string | null; now: string | null };
}
interface DatePreview {
  pickedUpOn: { was: string; now: string };
  refusal: { code: string; seq?: number } | null;
  transfer: { was: string | null; now: string | null; options: string[] } | null;
  payWeekday: { was: number | null; now: number | null };
  money: Change | null;
  payments: { id: string; grossTetri: number }[];
}
interface DepositPreview {
  receivedBefore: { was: number; now: number };
  freedTetri: number;
  money: Change;
  payments: { id: string; grossTetri: number }[];
}

const card = async (who: string, id: string) => json<Card>(await call(who, 'GET', `/api/rentals/${id}`));
const err = (res: { body: string }) => json<{ error: string; field?: string; seq?: number; options?: string[] }>(res);
const redate = (who: string, id: string, body: Record<string, unknown>) => call(who, 'POST', `/api/rentals/${id}/pickup-date`, body);
const redatePreview = async (who: string, id: string, body: Record<string, unknown>) => {
  const res = await call(who, 'POST', `/api/rentals/${id}/pickup-date/preview`, body);
  if (res.statusCode !== 200) throw new Error(res.body);
  return json<DatePreview>(res);
};
const markDeposit = (who: string, id: string, body: Record<string, unknown>) => call(who, 'POST', `/api/rentals/${id}/deposit/before`, body);
const pay = (who: string, id: string, grossTetri: number) => call(who, 'POST', '/api/payments', { rentalId: id, channel: 'cash', grossTetri });

const REASON = 'test: the moped went out four days later than entered';
const DEPOSIT_REASON = 'test: the deposit came with the previous moped';

describe.skipIf(!HAS_DB)('the pickup date of an open rental put right (ADR-0044 §1)', () => {
  it('the first case: the weeks follow the true day; the deposit marked received earlier frees the first rent onto week 1', async () => {
    // Entered twelve days ago, really handed over eight days ago; the 150 paid
    // that day went onto the deposit, the order's first place.
    const r = await running(12, { payment: { later: false, channel: 'cash', amountTetri: 15000 } });
    const t = today();
    let c = await card(r.owner, r.id);
    expect(c.periods.map((p) => [p.seq, p.startsOn, p.endsOn])).toEqual([
      [1, addDays(t, -12), addDays(t, -6)],
      [2, addDays(t, -5), addDays(t, 1)],
    ]);
    expect(c.deposit).toMatchObject({ paidTetri: 15000, receivedBeforeTetri: 0 });
    expect(c.rental.debtTetri).toBe(33000);
    const paymentId = c.payments[0].id;

    // The preview: the weeks four days later, no money moved, the debt as it was.
    const preview = await redatePreview(r.owner, r.id, { pickedUpOn: addDays(t, -8) });
    expect(preview.refusal).toBeNull();
    expect(preview.pickedUpOn).toEqual({ was: addDays(t, -12), now: addDays(t, -8) });
    expect(preview.money?.weeks.map((w) => [w.seq, w.was?.startsOn, w.now?.startsOn, w.now?.endsOn])).toEqual([
      [1, addDays(t, -12), addDays(t, -8), addDays(t, -2)],
      [2, addDays(t, -5), addDays(t, -1), addDays(t, 5)],
    ]);
    expect(preview.money?.moves).toEqual([]);
    expect(preview.money?.owes).toEqual({ was: 33000, now: 33000 });
    // Nothing was written by the preview.
    expect((await card(r.owner, r.id)).rental.pickedUpOn).toBe(addDays(t, -12));

    const res = await redate(r.owner, r.id, { pickedUpOn: addDays(t, -8), reason: REASON });
    expect(res.statusCode, res.body).toBe(200);
    expect(json(res)).toMatchObject({ ok: true, pickedUpOn: addDays(t, -8), debtTetri: 33000, paidThrough: null });
    c = await card(r.owner, r.id);
    expect(c.rental).toMatchObject({ pickedUpOn: addDays(t, -8), weeksFromOn: addDays(t, -8), debtTetri: preview.money!.owes.now });
    expect(c.periods.map((p) => [p.seq, p.startsOn, p.endsOn, p.paidTetri])).toEqual([
      [1, addDays(t, -8), addDays(t, -2), 0],
      [2, addDays(t, -1), addDays(t, 5), 0],
    ]);
    // The hand-over act and the moped's own hand-over event read the new day.
    expect(c.acts.find((a) => a.kind === 'pickup')?.occurredOn).toBe(addDays(t, -8));
    const event = await r.prisma.vehicleEvent.findFirstOrThrow({ where: { vehicleId: r.vehicle.id, kind: 'pickup', rentalId: r.id } });
    expect(event.occurredOn).toEqual(date(addDays(t, -8)));

    // The journal: was → became, each figure by its name, and why.
    const log = await r.prisma.auditLog.findFirstOrThrow({ where: { entityType: 'rental', entityId: r.id, action: 'rental.pickup.date' } });
    expect(log.note).toBe(REASON);
    expect(log.before).toMatchObject({ pickedUpOn: addDays(t, -12), weeks: 2, debtTetri: 33000, paidThrough: null, payDay: isoWeekday(addDays(t, -12)) });
    expect(log.after).toMatchObject({ pickedUpOn: addDays(t, -8), weeks: 2, debtTetri: 33000, paidThrough: null, payDay: isoWeekday(addDays(t, -8)) });

    // The deposit came before EV8 Ops: the 150 on it is freed and closes week 1.
    const dp = await call(r.owner, 'POST', `/api/rentals/${r.id}/deposit/before/preview`, { receivedBeforeTetri: 18000 });
    expect(dp.statusCode, dp.body).toBe(200);
    const depositPreview = json<DepositPreview>(dp);
    expect(depositPreview).toMatchObject({ receivedBefore: { was: 0, now: 18000 }, freedTetri: 15000 });
    expect(depositPreview.money.moves).toEqual([{ paymentId, was: [{ kind: 'deposit', amountTetri: 15000 }], now: [{ kind: 'week', seq: 1, amountTetri: 15000 }] }]);
    expect(depositPreview.money.owes).toEqual({ was: 33000, now: 15000 });
    expect(depositPreview.payments).toMatchObject([{ id: paymentId, grossTetri: 15000 }]);

    const marked = await markDeposit(r.owner, r.id, { receivedBeforeTetri: '180', reason: DEPOSIT_REASON });
    expect(marked.statusCode, marked.body).toBe(200);
    expect(json(marked)).toMatchObject({ ok: true, receivedBeforeTetri: 18000, freedTetri: 15000, debtTetri: 15000 });
    c = await card(r.owner, r.id);
    expect(c.deposit).toMatchObject({ paidTetri: 18000, receivedBeforeTetri: 18000 });
    expect(c.periods.map((p) => p.paidTetri)).toEqual([15000, 0]);
    expect(c.rental).toMatchObject({ debtTetri: depositPreview.money.owes.now, paidThrough: addDays(t, -2) });
    // No money came: the one payment is still the one payment.
    expect(c.payments).toHaveLength(1);
    const deposit = await r.prisma.deposit.findUniqueOrThrow({ where: { rentalId: r.id } });
    const line = await r.prisma.auditLog.findFirstOrThrow({ where: { entityType: 'deposit', entityId: deposit.id, action: 'deposit.before' } });
    expect(line.note).toBe(DEPOSIT_REASON);
    expect(line.before).toMatchObject({ receivedBeforeTetri: 0, paidTetri: 15000, debtTetri: 33000 });
    expect(line.after).toMatchObject({ receivedBeforeTetri: 18000, paidTetri: 18000, debtTetri: 15000, freedTetri: 15000 });

    // The return counts it received: the whole deposit is held and goes back.
    const back = await call(r.owner, 'POST', `/api/rentals/${r.id}/return/preview`, { returnedOn: t });
    expect(json<{ deposit: { receivedTetri: number; heldTetri: number } }>(back).deposit).toMatchObject({ receivedTetri: 18000, heldTetri: 18000 });
  });

  it('a week that has not begun by the new day goes; its money waits as the customer’s and the night lays it on the week', async () => {
    // Handed over nine days ago and paid, week 2 (begun two days ago) paid too; the pay day agreed on another weekday.
    const r = await running(9);
    const t = today();
    const second = await pay(r.owner, r.id, 15000);
    expect(second.statusCode, second.body).toBe(201);
    const paymentId = json<{ id: string }>(second).id;
    expect((await call(r.owner, 'PATCH', `/api/rentals/${r.id}`, { payWeekday: isoWeekday(addDays(t, -5)), reason: 'test: pays on another day' })).statusCode).toBe(200);

    const preview = await redatePreview(r.owner, r.id, { pickedUpOn: addDays(t, -5) });
    expect(preview.refusal).toBeNull();
    expect(preview.money?.weeks.map((w) => [w.seq, w.now?.startsOn ?? null])).toEqual([
      [1, addDays(t, -5)],
      [2, null],
    ]);
    expect(preview.money?.moves).toEqual([{ paymentId, was: [{ kind: 'week', seq: 2, amountTetri: 15000 }], now: [{ kind: 'credit', amountTetri: 15000 }] }]);
    // The pay day is now the weeks' own weekday: kept as none, as the pay-day form keeps it.
    expect(preview.payWeekday).toEqual({ was: isoWeekday(addDays(t, -5)), now: null });

    expect((await redate(r.owner, r.id, { pickedUpOn: addDays(t, -5), reason: REASON })).statusCode).toBe(200);
    const c = await card(r.owner, r.id);
    expect(c.periods.map((p) => [p.seq, p.startsOn, p.paidTetri])).toEqual([[1, addDays(t, -5), 15000]]);
    expect(c.rental).toMatchObject({ payWeekday: null, debtTetri: 0, paidThrough: addDays(t, 1) });
    expect(await r.prisma.paymentAllocation.count({ where: { paymentId } })).toBe(0);

    // The night of the day week 2 begins on the new dates: it opens and the 150 closes it.
    const { openWeeks, settleCredit } = await import('../src/lib/periods.js');
    expect(await openWeeks(r.id, addDays(t, 1))).toBe(0);
    expect(await openWeeks(r.id, addDays(t, 2))).toBe(1);
    expect(await settleCredit(r.id)).toBe(15000);
    const after = await card(r.owner, r.id);
    expect(after.periods.find((p) => p.seq === 2)).toMatchObject({ startsOn: addDays(t, 2), paidTetri: 15000 });
  });

  it('a date changed and changed back: the weeks, their money and the moped’s history are as they were', async () => {
    const r = await running(12);
    const t = today();
    expect((await pay(r.owner, r.id, 15000)).statusCode).toBe(201);
    const before = await card(r.owner, r.id);
    expect(before.periods.map((p) => [p.seq, p.startsOn, p.paidTetri])).toEqual([
      [1, addDays(t, -12), 15000],
      [2, addDays(t, -5), 15000],
    ]);

    // Four days later: each week keeps its number and what was paid on it.
    expect((await redate(r.owner, r.id, { pickedUpOn: addDays(t, -8), reason: REASON })).statusCode).toBe(200);
    const moved = await card(r.owner, r.id);
    expect(moved.periods.map((p) => [p.seq, p.startsOn, p.paidTetri])).toEqual([
      [1, addDays(t, -8), 15000],
      [2, addDays(t, -1), 15000],
    ]);
    expect(moved.rental).toMatchObject({ paidThrough: addDays(t, 5), debtTetri: 0 });

    // Taken back the same way, with a reason.
    expect((await redate(r.owner, r.id, { pickedUpOn: addDays(t, -12), reason: 'test: entered by mistake' })).statusCode).toBe(200);
    const back = await card(r.owner, r.id);
    expect(back.periods).toEqual(before.periods);
    expect(back.rental).toMatchObject({ pickedUpOn: addDays(t, -12), paidThrough: before.rental.paidThrough, debtTetri: before.rental.debtTetri, payWeekday: before.rental.payWeekday });
    expect(back.acts.find((a) => a.kind === 'pickup')?.occurredOn).toBe(addDays(t, -12));
    const event = await r.prisma.vehicleEvent.findFirstOrThrow({ where: { vehicleId: r.vehicle.id, kind: 'pickup', rentalId: r.id } });
    expect(event.occurredOn).toEqual(date(addDays(t, -12)));
    const lines = await r.prisma.auditLog.findMany({ where: { entityType: 'rental', entityId: r.id, action: 'rental.pickup.date' }, orderBy: { createdAt: 'asc' }, select: { note: true } });
    expect(lines.map((l) => l.note)).toEqual([REASON, 'test: entered by mistake']);
  });

  it('an earlier day opens the weeks begun since, at once', async () => {
    const r = await running(3);
    const t = today();
    expect((await redate(r.owner, r.id, { pickedUpOn: addDays(t, -10), reason: REASON })).statusCode).toBe(200);
    const c = await card(r.owner, r.id);
    expect(c.periods.map((p) => [p.seq, p.startsOn, p.endsOn, p.amountTetri, p.paidTetri])).toEqual([
      [1, addDays(t, -10), addDays(t, -4), 15000, 15000],
      [2, addDays(t, -3), addDays(t, 3), 15000, 0],
    ]);
    expect(c.rental).toMatchObject({ status: 'overdue', debtTetri: 15000, paidThrough: addDays(t, -4) });
  });

  it('a rental carried over keeps «оплачено по» as a date, and asks it again when it is no week’s end', async () => {
    // Begun ten days ago, week 1 paid before the transfer.
    const r = await carried(10, { paidThrough: addDays(today(), -4), depositReceivedTetri: 18000 });
    const t = today();
    expect((await card(r.owner, r.id)).periods.map((p) => p.paidBeforeTransfer)).toEqual([true, false]);

    // Two days later: the week ends on -2 now, and -4 is nobody's end.
    const preview = await redatePreview(r.owner, r.id, { pickedUpOn: addDays(t, -8) });
    expect(preview.refusal).toEqual({ code: 'transfer_paid_through_week_end' });
    expect(preview.transfer).toEqual({ was: addDays(t, -4), now: addDays(t, -4), options: [addDays(t, -2), addDays(t, 5)] });
    expect(preview.money).toBeNull();
    const refused = await redate(r.owner, r.id, { pickedUpOn: addDays(t, -8), reason: REASON });
    expect(refused.statusCode).toBe(400);
    expect(err(refused)).toMatchObject({ error: 'transfer_paid_through_week_end', field: 'paidBeforeThrough', options: [addDays(t, -2), addDays(t, 5)] });

    // Said again: week 1 is still paid before the transfer, on its new days.
    const again = await redatePreview(r.owner, r.id, { pickedUpOn: addDays(t, -8), paidBeforeThrough: addDays(t, -2) });
    expect(again.refusal).toBeNull();
    expect(again.transfer).toMatchObject({ was: addDays(t, -4), now: addDays(t, -2) });
    const res = await redate(r.owner, r.id, { pickedUpOn: addDays(t, -8), paidBeforeThrough: addDays(t, -2), reason: REASON });
    expect(res.statusCode, res.body).toBe(200);
    const c = await card(r.owner, r.id);
    expect(c.periods.map((p) => [p.seq, p.startsOn, p.paidBeforeTransfer, p.paidTetri])).toEqual([
      [1, addDays(t, -8), true, 15000],
      [2, addDays(t, -1), false, 0],
    ]);
    expect(c.rental).toMatchObject({ paidThrough: addDays(t, -2), debtTetri: 15000 });
    const log = await r.prisma.auditLog.findFirstOrThrow({ where: { entityType: 'rental', entityId: r.id, action: 'rental.pickup.date' } });
    expect(log.before).toMatchObject({ paidBeforeThrough: addDays(t, -4) });
    expect(log.after).toMatchObject({ paidBeforeThrough: addDays(t, -2) });
  });

  it('a week made longer moves with its number; one that would not have begun is refused until its move is taken back', async () => {
    const r = await running(10);
    const t = today();
    await pay(r.owner, r.id, 21400);
    const shifted = await call(r.owner, 'POST', `/api/rentals/${r.id}/weeks/2/shift`, { days: 3, extraTetri: '64', reason: 'test: paid three days late' });
    expect(shifted.statusCode, shifted.body).toBe(200);

    expect((await redate(r.owner, r.id, { pickedUpOn: addDays(t, -8), reason: REASON })).statusCode).toBe(200);
    const c = await card(r.owner, r.id);
    expect(c.periods.find((p) => p.seq === 2)).toMatchObject({ startsOn: addDays(t, -1), endsOn: addDays(t, 8), extraDays: 3, amountTetri: 21400, paidTetri: 21400 });
    expect(c.rental).toMatchObject({ weekShiftDays: 3, weeksFromOn: addDays(t, -5), paidThrough: addDays(t, 8) });

    // Three days later still, week 2 would begin tomorrow: its move goes first.
    const refused = await redate(r.owner, r.id, { pickedUpOn: addDays(t, -5), reason: REASON });
    expect(refused.statusCode).toBe(409);
    expect(err(refused)).toMatchObject({ error: 'pickup_date_week_shifted', seq: 2 });
    expect((await card(r.owner, r.id)).rental.pickedUpOn).toBe(addDays(t, -8));
  });

  it('after a swap the hand-over stays before it, and the first moped’s history moves with the day', async () => {
    const r = await running(10);
    const t = today();
    const point = await r.prisma.location.create({ data: { name: `ТЕСТ point ${uniq()}` }, select: { id: true } });
    const fresh = await r.prisma.vehicle.create({ data: { vin: `TESTPD${digits().slice(-11).padStart(11, '0')}`, modelId: r.model.id, pool: 'rent' } });
    const swapped = await call(r.owner, 'POST', `/api/rentals/${r.id}/swap`, {
      swappedOn: addDays(t, -2),
      reason: 'test: the battery went',
      outOdometerKm: 150,
      items: { moped: { state: 'ok' }, key: { state: 'ok' } },
      toService: false,
      locationId: point.id,
      vehicleId: fresh.id,
      inOdometerKm: 10,
    });
    expect(swapped.statusCode, swapped.body).toBe(200);

    const late = await redate(r.owner, r.id, { pickedUpOn: addDays(t, -1), reason: REASON });
    expect(late.statusCode).toBe(409);
    expect(err(late)).toMatchObject({ error: 'pickup_after_swap', field: 'pickedUpOn' });

    expect((await redate(r.owner, r.id, { pickedUpOn: addDays(t, -9), reason: REASON })).statusCode).toBe(200);
    const c = await card(r.owner, r.id);
    expect(c.acts.map((a) => [a.kind, a.occurredOn])).toEqual([
      ['pickup', addDays(t, -9)],
      ['swap_out', addDays(t, -2)],
      ['swap_in', addDays(t, -2)],
    ]);
    const first = await r.prisma.vehicleEvent.findFirstOrThrow({ where: { vehicleId: r.vehicle.id, kind: 'pickup', rentalId: r.id } });
    expect(first.occurredOn).toEqual(date(addDays(t, -9)));
    // The new moped's events are the swap's, untouched.
    const second = await r.prisma.vehicleEvent.findFirstOrThrow({ where: { vehicleId: fresh.id, kind: 'pickup', rentalId: r.id } });
    expect(second.occurredOn).toEqual(date(addDays(t, -2)));
  });

  it('«Today» and the calendar read the new days: a rental late by the old weeks is due today by the true ones', async () => {
    // Deposit and week 1 paid; by the entered day week 2 began three days ago.
    const r = await running(10);
    const t = today();
    let c = await card(r.owner, r.id);
    expect(c.rental).toMatchObject({ status: 'overdue', debtTetri: 15000 });
    expect(await todayRowOf(r.id, 'overdue')).not.toBeNull();

    // Handed over seven days ago in truth: week 2 begins today.
    expect((await redate(r.owner, r.id, { pickedUpOn: addDays(t, -7), reason: REASON })).statusCode).toBe(200);
    c = await card(r.owner, r.id);
    expect(c.rental).toMatchObject({ status: 'due_today', debtTetri: 15000, dueOn: t, paidThrough: addDays(t, -1) });
    expect(await todayRowOf(r.id, 'overdue')).toBeNull();
    expect(await todayRowOf(r.id, 'due_today')).toMatchObject({ amountTetri: 15000, dueTodayTetri: 15000 });

    const range = { from: weekOf(addDays(t, -21)).from, to: weekOf(addDays(t, 14)).to };
    const res = await call(r.owner, 'GET', `/api/money/calendar?from=${range.from}&to=${range.to}`);
    expect(res.statusCode, res.body).toBe(200);
    const entries = json<PaymentsCalendarAnswer>(res).entries.filter((e) => e.rentalId === r.id);
    expect(entries.find((e) => e.seq === 1)).toMatchObject({ dueOn: addDays(t, -7), state: 'paid' });
    expect(entries.find((e) => e.seq === 2)).toMatchObject({ dueOn: t, endsOn: addDays(t, 6) });
    expect(entries.find((e) => e.seq === 3)).toMatchObject({ dueOn: addDays(t, 7), projected: true });
    // Nothing on the days of the entered weeks.
    expect(entries.some((e) => e.dueOn === addDays(t, -3))).toBe(false);
  });

  it('refuses: a manager, no reason, a day after today or the same day, before the moped came, across its history, a closed rental', async () => {
    const r = await running(10);
    const t = today();
    const manager = await loginAs('manager');
    expect((await redate(manager, r.id, { pickedUpOn: addDays(t, -8), reason: REASON })).statusCode).toBe(403);
    expect((await call(manager, 'POST', `/api/rentals/${r.id}/pickup-date/preview`, { pickedUpOn: addDays(t, -8) })).statusCode).toBe(403);
    expect(err(await redate(r.owner, r.id, { pickedUpOn: addDays(t, -8) }))).toMatchObject({ error: 'missing_field', field: 'reason' });
    expect(err(await redate(r.owner, r.id, { reason: REASON }))).toMatchObject({ error: 'missing_field', field: 'pickedUpOn' });
    expect(err(await redate(r.owner, r.id, { pickedUpOn: addDays(t, 1), reason: REASON }))).toMatchObject({ error: 'pickup_date_future', field: 'pickedUpOn' });
    expect(err(await redate(r.owner, r.id, { pickedUpOn: addDays(t, -10), reason: REASON }))).toMatchObject({ error: 'pickup_date_same', field: 'pickedUpOn' });
    // The preview says the day's refusal in its answer, for the sheet to show by the date.
    expect((await redatePreview(r.owner, r.id, { pickedUpOn: addDays(t, 1) })).refusal).toEqual({ code: 'pickup_date_future' });

    await r.prisma.vehicle.update({ where: { id: r.vehicle.id }, data: { arrivedOn: date(addDays(t, -11)) } });
    expect(err(await redate(r.owner, r.id, { pickedUpOn: addDays(t, -12), reason: REASON }))).toMatchObject({ error: 'pickup_before_arrival', field: 'pickedUpOn' });

    // The moped came back from an earlier rental eleven days ago (made up): the hand-over is not before that.
    await r.prisma.vehicle.update({ where: { id: r.vehicle.id }, data: { arrivedOn: null } });
    await r.prisma.vehicleEvent.create({ data: { vehicleId: r.vehicle.id, kind: 'return', occurredOn: date(addDays(t, -11)), fromState: 'rented', toState: 'available' } });
    expect(err(await redate(r.owner, r.id, { pickedUpOn: addDays(t, -12), reason: REASON }))).toMatchObject({ error: 'pickup_date_history', field: 'pickedUpOn' });
    expect((await redate(r.owner, r.id, { pickedUpOn: addDays(t, -11), reason: REASON })).statusCode).toBe(200);

    // Nothing but the one move was written.
    expect(await r.prisma.auditLog.count({ where: { entityType: 'rental', entityId: r.id, action: 'rental.pickup.date' } })).toBe(1);

    const closed = await running(10);
    await closed.prisma.rental.update({ where: { id: closed.id }, data: { status: 'returned', returnedOn: date(t) } });
    expect(err(await redate(closed.owner, closed.id, { pickedUpOn: addDays(t, -8), reason: REASON })).error).toBe('already_returned');
  });
});

describe.skipIf(!HAS_DB)('a deposit marked received before EV8 Ops on an open rental (ADR-0044 §2)', () => {
  it('the second case: taken off, the deposit is owed again, and the bank money closes it first — 250 is the deposit and 70 of the week', async () => {
    // Carried over six days ago with the deposit marked received earlier, though it came by the bank.
    const r = await carried(6, { paidThrough: null, depositReceivedTetri: 18000 });
    const t = today();
    let c = await card(r.owner, r.id);
    expect(c.deposit).toMatchObject({ paidTetri: 18000, receivedBeforeTetri: 18000 });
    expect(c.rental.debtTetri).toBe(15000);

    const preview = json<DepositPreview>(await call(r.owner, 'POST', `/api/rentals/${r.id}/deposit/before/preview`, { receivedBeforeTetri: 0 }));
    expect(preview).toMatchObject({ receivedBefore: { was: 18000, now: 0 }, freedTetri: 0 });
    expect(preview.money.owes).toEqual({ was: 15000, now: 33000 });

    const off = await markDeposit(r.owner, r.id, { receivedBeforeTetri: 0, reason: 'test: it came by the bank' });
    expect(off.statusCode, off.body).toBe(200);
    c = await card(r.owner, r.id);
    expect(c.deposit).toMatchObject({ paidTetri: 0, receivedBeforeTetri: 0 });
    expect(c.rental.debtTetri).toBe(33000);
    const deposit = await r.prisma.deposit.findUniqueOrThrow({ where: { rentalId: r.id } });
    const line = await r.prisma.auditLog.findFirstOrThrow({ where: { entityType: 'deposit', entityId: deposit.id, action: 'deposit.before.undo' } });
    expect(line.note).toBe('test: it came by the bank');
    expect(line.before).toMatchObject({ receivedBeforeTetri: 18000 });
    expect(line.after).toMatchObject({ receivedBeforeTetri: 0, debtTetri: 33000 });

    expect((await pay(r.owner, r.id, 25000)).statusCode).toBe(201);
    expect((await pay(r.owner, r.id, 7000)).statusCode).toBe(201);
    c = await card(r.owner, r.id);
    expect(c.deposit.paidTetri).toBe(18000);
    expect(c.periods[0]).toMatchObject({ startsOn: addDays(t, -6), paidTetri: 14000 });
    expect(c.rental.debtTetri).toBe(1000);
  });

  it('a mark set and changed and taken off: what was freed stays where the order put it, and nothing is money', async () => {
    // Paid 330 at the hand-over: the deposit and week 1.
    const r = await running(3);
    let c = await card(r.owner, r.id);
    const paymentId = c.payments[0].id;
    // 100 of the deposit came earlier: 100 of the 180 the payment put on it goes to week 2 when it opens, and waits now.
    expect((await markDeposit(r.owner, r.id, { receivedBeforeTetri: 10000, reason: DEPOSIT_REASON })).statusCode).toBe(200);
    c = await card(r.owner, r.id);
    expect(c.deposit).toMatchObject({ paidTetri: 18000, receivedBeforeTetri: 10000 });
    const parts = await r.prisma.paymentAllocation.findMany({ where: { paymentId }, select: { target: true, amountTetri: true } });
    expect(parts.filter((p) => p.target === 'deposit').reduce((n, p) => n + p.amountTetri, 0)).toBe(8000);
    expect(c.rental.debtTetri).toBe(0);

    // Taken off again: the deposit is owed 100, and the payment's money not placed closes it first.
    expect((await markDeposit(r.owner, r.id, { receivedBeforeTetri: 0, reason: 'test: entered by mistake' })).statusCode).toBe(200);
    c = await card(r.owner, r.id);
    expect(c.deposit).toMatchObject({ paidTetri: 18000, receivedBeforeTetri: 0 });
    expect(c.rental.debtTetri).toBe(0);
    expect(c.payments).toHaveLength(1);
    const deposit = await r.prisma.deposit.findUniqueOrThrow({ where: { rentalId: r.id } });
    const lines = await r.prisma.auditLog.findMany({ where: { entityType: 'deposit', entityId: deposit.id }, orderBy: { createdAt: 'asc' }, select: { action: true, note: true } });
    expect(lines).toEqual([
      { action: 'deposit.before', note: DEPOSIT_REASON },
      { action: 'deposit.before.undo', note: 'test: entered by mistake' },
    ]);
  });

  it('refuses: a manager, no reason, more than the deposit, the same mark, a closed rental, less than a repair kept', async () => {
    const r = await running(3);
    const manager = await loginAs('manager');
    expect((await markDeposit(manager, r.id, { receivedBeforeTetri: 18000, reason: DEPOSIT_REASON })).statusCode).toBe(403);
    expect(err(await markDeposit(r.owner, r.id, { receivedBeforeTetri: 18000 }))).toMatchObject({ error: 'missing_field', field: 'reason' });
    expect(err(await markDeposit(r.owner, r.id, { reason: DEPOSIT_REASON }))).toMatchObject({ error: 'missing_field', field: 'receivedBeforeTetri' });
    expect(err(await markDeposit(r.owner, r.id, { receivedBeforeTetri: 18100, reason: DEPOSIT_REASON }))).toMatchObject({ error: 'deposit_before_over', field: 'receivedBeforeTetri' });
    expect(err(await markDeposit(r.owner, r.id, { receivedBeforeTetri: 0, reason: DEPOSIT_REASON }))).toMatchObject({ error: 'deposit_before_same' });

    // A repair kept 150 of it while the rental ran (made up): a mark that would leave it holding less is refused.
    const kept = await carried(5, { paidThrough: null, depositReceivedTetri: 18000 });
    const deposit = await kept.prisma.deposit.findUniqueOrThrow({ where: { rentalId: kept.id } });
    await kept.prisma.depositWithholding.create({ data: { depositId: deposit.id, source: 'service', rentalId: kept.id, amountTetri: 15000, reason: 'test: a broken mirror' } });
    const less = await markDeposit(kept.owner, kept.id, { receivedBeforeTetri: 0, reason: 'test: it came by the bank' });
    expect(less.statusCode).toBe(409);
    expect(err(less).error).toBe('deposit_before_held');

    const closed = await running(3);
    await closed.prisma.rental.update({ where: { id: closed.id }, data: { status: 'returned', returnedOn: date(today()) } });
    expect(err(await markDeposit(closed.owner, closed.id, { receivedBeforeTetri: 18000, reason: DEPOSIT_REASON })).error).toBe('already_returned');
  });
});

/** The row «Today» makes of one rental, through the route's own select and mapper (as in due-today.test.ts). */
async function todayRowOf(rentalId: string, group: 'overdue' | 'due_today') {
  const { prisma } = await import('../src/lib/db.js');
  const { debtsOf } = await import('../src/lib/debt.js');
  const { QUEUE_RENTAL, queueRental } = await import('../src/routes/today.js');
  const t = today();
  const r = await prisma.rental.findUniqueOrThrow({ where: { id: rentalId }, select: QUEUE_RENTAL });
  const groups = dayQueue({
    today: t,
    owner: true,
    rentals: [queueRental(r, t, await debtsOf([r.customer.id], t))],
    tills: [],
    myTillTetri: 0,
    unmatchedLines: 0,
    staleBanks: [],
    instalments: [],
    service: { open: 0, longerThanWeek: 0, longestDays: 0 },
    reports: [],
    lowParts: { count: 0, note: '' },
    purchases: [],
    vehiclesWithoutPool: 0,
    vehiclesWithoutPoint: 0,
    odooDeposits: { count: 0, amountTetri: 0 },
    kommo: null,
    kommoDeals: [],
  });
  return groups.flatMap((g) => g.rows).find((row) => row.id === `${group}:${rentalId}`) ?? null;
}
