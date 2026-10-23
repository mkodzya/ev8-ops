// The pickup date of an open rental put right, and a deposit marked received
// before EV8 Ops (issue #10, ADR-0044). Made-up rentals with literal dates:
// entered as handed over on Sunday 11.10.2026, truly handed over on Thursday
// 15.10.2026; today is Friday 23.10.2026. The rate is 150 a week, the deposit 180.
import { describe, expect, it } from 'vitest';
import {
  DEPOSIT_EARLIER_ASK_DAYS,
  addDays,
  depositBeforePlan,
  depositEarlierAsks,
  isoWeekday,
  moneyChange,
  moneyPaidThrough,
  pickupDateMoney,
  pickupDatePlan,
  rentalOwesTetri,
  settleCreditPlan,
  settleMoney,
  spreadRentalOwed,
  transferPaidThrough,
  weekPaidTetri,
  type MoneyPart,
  type MoneyWeek,
  type RedateWeek,
  type RentalMoney,
} from '../src/index.js';

const ENTERED = '2026-10-11';
const TRUE_DAY = '2026-10-15';
const TODAY = '2026-10-23';

const row = (seq: number, startsOn: string, over: Partial<RedateWeek> = {}): RedateWeek => ({
  seq,
  startsOn,
  endsOn: addDays(startsOn, 6 + (over.extraDays ?? 0)),
  extraDays: 0,
  discountTetri: 0,
  paidBeforeTransfer: false,
  ...over,
});

const week = (seq: number, startsOn: string, parts: MoneyPart[] = [], over: Partial<MoneyWeek> = {}): MoneyWeek => ({
  id: `w${seq}`,
  seq,
  startsOn,
  endsOn: addDays(startsOn, 6),
  amountTetri: 15000,
  paidBeforeTransfer: false,
  parts,
  ...over,
});

const plan = (over: Partial<Parameters<typeof pickupDatePlan>[0]> = {}) =>
  pickupDatePlan({ pickedUpOn: ENTERED, to: TRUE_DAY, today: TODAY, weeks: [row(1, '2026-10-11'), row(2, '2026-10-18')], payWeekday: null, running: true, ...over });

describe('the pickup date put right: the weeks (ADR-0044 §1)', () => {
  it('counts the weeks again from the true day: each keeps its number, and none goes that has begun', () => {
    const p = plan();
    expect(p.refusal).toBeNull();
    expect(p.weeks.map((w) => [w.seq, w.from.startsOn, w.to?.startsOn, w.to?.endsOn])).toEqual([
      [1, '2026-10-11', '2026-10-15', '2026-10-21'],
      [2, '2026-10-18', '2026-10-22', '2026-10-28'],
    ]);
    expect(p.opened).toEqual([]);
    expect(p.weekEnds).toEqual(['2026-10-21', '2026-10-28']);
  });

  it('a week not begun by the new day goes; a day earlier opens the weeks begun since — for a running rental only', () => {
    const later = plan({ to: '2026-10-17' });
    expect(later.weeks.map((w) => w.to?.startsOn ?? null)).toEqual(['2026-10-17', null]);
    const earlier = plan({ to: '2026-10-04' });
    expect(earlier.weeks.map((w) => w.to?.startsOn)).toEqual(['2026-10-04', '2026-10-11']);
    expect(earlier.opened).toEqual([{ seq: 3, startsOn: '2026-10-18', endsOn: '2026-10-24', paidBeforeTransfer: false }]);
    // Paused or disputed: the weeks begun meanwhile wait for «running again», at nothing (Q11).
    expect(plan({ to: '2026-10-04', running: false }).opened).toEqual([]);
  });

  it('refuses a day after today and the day it has', () => {
    expect(plan({ to: '2026-10-24' }).refusal).toEqual({ code: 'pickup_date_future' });
    expect(plan({ to: ENTERED }).refusal).toEqual({ code: 'pickup_date_same' });
  });

  it('a week made longer keeps its days with its number; one that would go is refused until its move is taken back', () => {
    const weeks = [row(1, '2026-10-11'), row(2, '2026-10-18', { extraDays: 3 })];
    const p = plan({ weeks });
    expect(p.refusal).toBeNull();
    expect(p.weeks[1].to).toEqual({ seq: 2, startsOn: '2026-10-22', endsOn: '2026-10-31' });
    expect(p.shiftDays).toBe(3);
    expect(plan({ weeks, to: '2026-10-17' }).refusal).toEqual({ code: 'pickup_date_week_shifted', seq: 2 });
    // A discount on a week that would go is refused the same way.
    expect(plan({ weeks: [row(1, '2026-10-11'), row(2, '2026-10-18', { discountTetri: 2000 })], to: '2026-10-17' }).refusal).toEqual({ code: 'pickup_date_week_discounted', seq: 2 });
  });

  it('the pay day stays a weekday; on the weeks’ new weekday it is none, as the pay-day form keeps it', () => {
    // Paid on Thursdays by agreement, for weeks from Sunday: from Thursday that is the weeks’ own day.
    expect(isoWeekday(TRUE_DAY)).toBe(4);
    expect(plan({ payWeekday: 4 }).payWeekday).toBeNull();
    expect(plan({ payWeekday: 6 }).payWeekday).toBe(6);
    expect(plan({ payWeekday: null }).payWeekday).toBeNull();
  });

  it('a rental carried over keeps «оплачено по» as a date: kept while it is a week’s end, asked again when not', () => {
    const weeks = [row(1, '2026-10-11', { paidBeforeTransfer: true }), row(2, '2026-10-18')];
    expect(transferPaidThrough(weeks)).toBe('2026-10-17');
    // 17.10 is no week’s end from Thursday 15.10.
    expect(plan({ weeks }).refusal).toEqual({ code: 'transfer_paid_through_week_end' });
    const again = plan({ weeks, paidBeforeThrough: '2026-10-21' });
    expect(again.refusal).toBeNull();
    expect(again.paidBeforeThrough).toEqual({ was: '2026-10-17', now: '2026-10-21' });
    expect(again.weeks.map((w) => w.paidBeforeTransfer)).toEqual([true, false]);
    expect(plan({ weeks, paidBeforeThrough: null }).weeks.map((w) => w.paidBeforeTransfer)).toEqual([false, false]);
    // A week earlier: 17.10 is still a week’s end, and the week now ending on it is paid before the transfer too.
    const back = plan({ weeks, to: '2026-10-04' });
    expect(back.refusal).toBeNull();
    expect(back.weeks.map((w) => w.paidBeforeTransfer)).toEqual([true, true]);
    expect(back.opened.map((b) => b.paidBeforeTransfer)).toEqual([false]);
  });
});

describe('the pickup date put right: the money follows the week’s number', () => {
  const deposit = (parts: MoneyPart[] = [], receivedBeforeTetri = 0) => ({ id: 'd', amountTetri: 18000, receivedBeforeTetri, parts });

  it('a payment on a week that goes is the customer’s money again, placed by the one order', () => {
    // 330 on the day it was entered — the deposit and week 1 — and 150 for week 2 a week later.
    const m: RentalMoney = {
      weeks: [week(1, '2026-10-11', [{ paymentId: 'p1', amountTetri: 15000 }]), week(2, '2026-10-18', [{ paymentId: 'p2', amountTetri: 15000 }])],
      deposit: deposit([{ paymentId: 'p1', amountTetri: 18000 }]),
      charges: [],
      credit: [
        { id: 'p1', creditTetri: 0 },
        { id: 'p2', creditTetri: 0 },
      ],
    };
    const p = plan({ to: '2026-10-17' });
    const moved = pickupDateMoney(m, p, 15000);
    expect(moved.freed).toEqual([{ paymentId: 'p2', amountTetri: 15000 }]);
    const after = settleMoney(moved.money);
    // Week 2 begins on 24.10 now: nothing owed takes the 150, which waits for it.
    expect(after.weeks.map((w) => [w.seq, w.startsOn, weekPaidTetri(w)])).toEqual([[1, '2026-10-17', 15000]]);
    expect(after.credit).toEqual([
      { id: 'p1', creditTetri: 0 },
      { id: 'p2', creditTetri: 15000 },
    ]);
    const change = moneyChange(m, after, { today: TODAY, payOffsetWas: 0, payOffsetNow: 0 });
    expect(change.moves).toEqual([{ paymentId: 'p2', was: [{ kind: 'week', seq: 2, amountTetri: 15000 }], now: [{ kind: 'credit', amountTetri: 15000 }] }]);
    expect(change.owes).toEqual({ was: 0, now: 0 });
    expect(change.paidThrough).toEqual({ was: '2026-10-24', now: '2026-10-23' });
    expect(change.weeks[1]).toEqual({ seq: 2, was: { startsOn: '2026-10-18', endsOn: '2026-10-24' }, now: null, amountTetri: 15000, paidWas: 15000, paidNow: 0 });
  });

  it('a week opened by an earlier day takes the customer’s credit at once', () => {
    const m: RentalMoney = {
      weeks: [week(1, '2026-10-11', [{ paymentId: 'p1', amountTetri: 15000 }]), week(2, '2026-10-18')],
      deposit: deposit([{ paymentId: 'p1', amountTetri: 18000 }]),
      charges: [],
      credit: [{ id: 'p3', creditTetri: 5000 }],
    };
    const after = settleMoney(pickupDateMoney(m, plan({ to: '2026-10-04' }), 15000).money);
    expect(after.weeks.map((w) => [w.seq, w.id, w.startsOn, weekPaidTetri(w)])).toEqual([
      [1, 'w1', '2026-10-04', 15000],
      [2, 'w2', '2026-10-11', 5000],
      [3, 'new-3', '2026-10-18', 0],
    ]);
    expect(rentalOwesTetri(after, { today: TODAY, payOffsetDays: 0 })).toBe(25000);
  });

  it('a week now paid before the transfer frees what payments put on it', () => {
    const weeks = [week(1, '2026-10-11', [], { paidBeforeTransfer: true }), week(2, '2026-10-18', [{ paymentId: 'p2', amountTetri: 15000 }])];
    const m: RentalMoney = { weeks, deposit: deposit([], 18000), charges: [], credit: [{ id: 'p2', creditTetri: 0 }] };
    const p = plan({ weeks: weeks.map((w) => row(w.seq, w.startsOn, { paidBeforeTransfer: w.paidBeforeTransfer })), to: '2026-10-04' });
    const after = settleMoney(pickupDateMoney(m, p, 15000).money);
    // Weeks 1 and 2 end by 17.10, paid before the transfer; the 150 goes onto the week opened.
    expect(after.weeks.map((w) => [w.seq, w.paidBeforeTransfer, weekPaidTetri(w)])).toEqual([
      [1, true, 15000],
      [2, true, 15000],
      [3, false, 15000],
    ]);
    expect(after.weeks[2].parts).toEqual([{ paymentId: 'p2', amountTetri: 15000 }]);
  });
});

describe('the deposit received before EV8 Ops (ADR-0044 §2)', () => {
  // The first case of the issue, made up: the first rent went onto the deposit by the order's rule.
  const entered = (): RentalMoney => ({
    weeks: [week(1, TRUE_DAY), week(2, '2026-10-22')],
    deposit: { id: 'd', amountTetri: 18000, receivedBeforeTetri: 0, parts: [{ id: 'a1', paymentId: 'p1', amountTetri: 15000 }] },
    charges: [],
    credit: [{ id: 'p1', creditTetri: 0 }],
  });

  it('marked received earlier, it frees what the payments put on it and the weeks take it, oldest first', () => {
    const m = entered();
    expect(rentalOwesTetri(m, { today: TODAY, payOffsetDays: 0 })).toBe(33000);
    const p = depositBeforePlan(m, 18000);
    expect(p.freedTetri).toBe(15000);
    expect(p.freed).toEqual([{ id: 'a1', paymentId: 'p1', amountTetri: 15000 }]);
    const after = settleMoney(p.money);
    expect(after.deposit).toMatchObject({ receivedBeforeTetri: 18000, parts: [] });
    expect(after.weeks.map(weekPaidTetri)).toEqual([15000, 0]);
    const change = moneyChange(m, after, { today: TODAY, payOffsetWas: 0, payOffsetNow: 0 });
    expect(change.owes).toEqual({ was: 33000, now: 15000 });
    expect(change.deposit).toEqual({ amountTetri: 18000, paidWas: 15000, paidNow: 18000, receivedBeforeWas: 0, receivedBeforeNow: 18000 });
    expect(change.moves).toEqual([{ paymentId: 'p1', was: [{ kind: 'deposit', amountTetri: 15000 }], now: [{ kind: 'week', seq: 1, amountTetri: 15000 }] }]);
    expect(change.paidThrough).toEqual({ was: null, now: '2026-10-21' });
  });

  it('frees only what is beyond the deposit’s sum, the oldest payment first', () => {
    const m: RentalMoney = {
      ...entered(),
      deposit: {
        id: 'd',
        amountTetri: 18000,
        receivedBeforeTetri: 0,
        parts: [
          { id: 'a1', paymentId: 'p1', amountTetri: 10000 },
          { id: 'a2', paymentId: 'p2', amountTetri: 8000 },
        ],
      },
      credit: [
        { id: 'p1', creditTetri: 0 },
        { id: 'p2', creditTetri: 0 },
      ],
    };
    const p = depositBeforePlan(m, 12000);
    expect(p.freed).toEqual([
      { id: 'a1', paymentId: 'p1', amountTetri: 10000 },
      { id: 'a2', paymentId: 'p2', amountTetri: 2000 },
    ]);
    expect(p.money.deposit?.parts).toEqual([{ id: 'a2', paymentId: 'p2', amountTetri: 6000 }]);
    // Within the sum nothing is freed.
    expect(depositBeforePlan(m, 0).freedTetri).toBe(0);
    expect(() => depositBeforePlan(m, 18001)).toThrow();
  });

  it('money that lands on a charge names the charge by its id, not by its place in the list', () => {
    // The card names a charge by its kind and note and never numbers it.
    const m: RentalMoney = {
      weeks: [week(1, TRUE_DAY, [{ paymentId: 'p0', amountTetri: 15000 }])],
      deposit: { id: 'd', amountTetri: 18000, receivedBeforeTetri: 0, parts: [{ id: 'a1', paymentId: 'p1', amountTetri: 18000 }] },
      charges: [
        { id: 'c-key', amountTetri: 5000, parts: [{ paymentId: 'p0', amountTetri: 5000 }] },
        { id: 'c-fine', amountTetri: 7000, parts: [] },
      ],
      credit: [
        { id: 'p0', creditTetri: 0 },
        { id: 'p1', creditTetri: 0 },
      ],
    };
    const after = settleMoney(depositBeforePlan(m, 18000).money);
    const change = moneyChange(m, after, { today: TODAY, payOffsetWas: 0, payOffsetNow: 0 });
    expect(change.moves).toEqual([
      {
        paymentId: 'p1',
        was: [{ kind: 'deposit', amountTetri: 18000 }],
        now: [
          { kind: 'charge', chargeId: 'c-fine', amountTetri: 7000 },
          { kind: 'credit', amountTetri: 11000 },
        ],
      },
    ]);
  });

  it('taken off, the deposit is owed again and closes first: a bank line of 250 is the deposit and 70 of the week', () => {
    // The second case of the issue, made up: marked received earlier, though it came by the bank.
    const m: RentalMoney = {
      weeks: [week(1, '2026-10-17')],
      deposit: { id: 'd', amountTetri: 18000, receivedBeforeTetri: 18000, parts: [] },
      charges: [],
      credit: [],
    };
    const off = depositBeforePlan(m, 0);
    expect(off.freedTetri).toBe(0);
    expect(rentalOwesTetri(off.money, { today: TODAY, payOffsetDays: 0 })).toBe(33000);
    // The lines of 250 and 70 attached after: the order puts the deposit first.
    const paid = settleMoney({ ...off.money, credit: [{ id: 'b250', creditTetri: 25000 }, { id: 'b70', creditTetri: 7000 }] });
    expect(paid.deposit?.parts).toEqual([{ paymentId: 'b250', amountTetri: 18000 }]);
    expect(paid.weeks[0].parts).toEqual([
      { paymentId: 'b250', amountTetri: 7000 },
      { paymentId: 'b70', amountTetri: 7000 },
    ]);
    expect(rentalOwesTetri(paid, { today: TODAY, payOffsetDays: 0 })).toBe(1000);
    expect(moneyPaidThrough(paid)).toBeNull();
  });

  it('the wizard asks about a deposit marked received earlier only for a hand-over of the last three weeks', () => {
    expect(DEPOSIT_EARLIER_ASK_DAYS).toBe(21);
    expect(depositEarlierAsks(addDays(TODAY, -21), TODAY)).toBe(true);
    expect(depositEarlierAsks(addDays(TODAY, -22), TODAY)).toBe(false);
    expect(depositEarlierAsks(addDays(TODAY, -2), TODAY)).toBe(true);
  });
});

describe('the one order, without a database', () => {
  it('the deposit first while the rental runs, then the weeks from the oldest, then the charges', () => {
    const owed = {
      deposit: { id: 'd', amountTetri: 18000, paidTetri: 10000 },
      periods: [
        { id: 'w2', seq: 2, amountTetri: 15000, paidTetri: 0 },
        { id: 'w1', seq: 1, amountTetri: 15000, paidTetri: 5000 },
      ],
      charges: [{ id: 'c1', seq: 1, amountTetri: 20000, paidTetri: 0 }],
    };
    expect(spreadRentalOwed(40000, owed)).toEqual({
      allocations: [
        { target: 'deposit', id: 'd', amountTetri: 8000 },
        { target: 'period', id: 'w1', amountTetri: 10000 },
        { target: 'period', id: 'w2', amountTetri: 15000 },
        { target: 'charge', id: 'c1', amountTetri: 7000 },
      ],
      leftoverTetri: 0,
    });
    expect(spreadRentalOwed(5000, owed, { deposit: false }).allocations).toEqual([{ target: 'period', id: 'w1', amountTetri: 5000 }]);
  });

  it('settles payment after payment, each on what the ones before it left', () => {
    const owed = { deposit: null, periods: [{ id: 'w1', seq: 1, amountTetri: 15000, paidTetri: 0 }], charges: [] };
    const { placed, owed: left } = settleCreditPlan(
      [
        { id: 'a', creditTetri: 10000 },
        { id: 'b', creditTetri: 0 },
        { id: 'c', creditTetri: 10000 },
      ],
      owed,
    );
    expect(placed).toEqual([
      { paymentId: 'a', allocations: [{ target: 'period', id: 'w1', amountTetri: 10000 }] },
      { paymentId: 'c', allocations: [{ target: 'period', id: 'w1', amountTetri: 5000 }] },
    ]);
    expect(left.periods[0].paidTetri).toBe(15000);
    // What it was given is left as it was.
    expect(owed.periods[0].paidTetri).toBe(0);
  });
});
