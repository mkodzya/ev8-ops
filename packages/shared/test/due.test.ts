// The due day is not lateness (ADR-0017; docs/redesign/due-today.md §2).
//
// The four cases of the design note on every central function. Rate 150,
// deposit 180; T is today:
//   1 — the week began today, nothing older is unpaid;
//   2 — the week began yesterday;
//   3 — two weeks unpaid, the newer began today;
//   4 — handed over today, nothing paid at all.
import { describe, expect, it } from 'vitest';
import {
  addDays,
  customerDebt,
  dayQueue,
  dueTodayOf,
  effectiveRentalStatus,
  handOverBlockTetri,
  overdueDays,
  queueCount,
  queueMore,
  rentDueOn,
  waOffered,
  waRentalOf,
  waTemplatesOf,
  weekDue,
  type DebtInput,
  type DebtRental,
  type DueWeek,
  type QueueInput,
  type QueueRental,
  type RentalStatus,
} from '../src/index.js';

const T = '2026-10-14';
const d = (n: number) => addDays(T, n);
const RATE = 15000;
const DEPOSIT = 18000;

describe('what a rental is called on and after its due day', () => {
  it('case 1: the week began today — due today, not overdue', () => {
    expect(rentDueOn(d(-1), d(-7))).toBe(T);
    expect(effectiveRentalStatus('active', d(-1), d(-7), T)).toBe('due_today');
    expect(overdueDays(d(-1), d(-7), T)).toBe(0);
  });

  it('case 2: the week began yesterday — overdue, day 1', () => {
    expect(effectiveRentalStatus('active', d(-2), d(-8), T)).toBe('overdue');
    expect(overdueDays(d(-2), d(-8), T)).toBe(1);
  });

  it('case 3: two weeks unpaid, the newer began today — overdue since the older one, 7 days', () => {
    expect(effectiveRentalStatus('active', d(-8), d(-14), T)).toBe('overdue');
    expect(overdueDays(d(-8), d(-14), T)).toBe(7);
  });

  it('case 4: handed over today, nothing paid — due today like any other due day', () => {
    expect(rentDueOn(null, T)).toBe(T);
    expect(effectiveRentalStatus('active', null, T, T)).toBe('due_today');
    expect(overdueDays(null, T, T)).toBe(0);
  });

  it('turns overdue at midnight: the same facts read a day later', () => {
    expect(effectiveRentalStatus('active', d(-1), d(-7), d(1))).toBe('overdue');
    expect(overdueDays(d(-1), d(-7), d(1))).toBe(1);
    expect(effectiveRentalStatus('active', null, T, d(1))).toBe('overdue');
  });

  it('is active while the due day is ahead', () => {
    expect(effectiveRentalStatus('active', d(6), d(-7), T)).toBe('active');
    // Paid through today: the next week is due tomorrow.
    expect(effectiveRentalStatus('active', T, d(-6), T)).toBe('active');
    // The three lines the old rule was pinned by (wave 3 §3.3), under the new one.
    expect(effectiveRentalStatus('active', null, '2026-09-18', '2026-09-18')).toBe('due_today');
    expect(effectiveRentalStatus('active', null, '2026-09-17', '2026-09-18')).toBe('overdue');
    expect(effectiveRentalStatus('active', '2026-09-24', '2026-09-18', '2026-09-18')).toBe('active');
  });

  it('never paid: late from the day after the pickup, counted from the pickup day', () => {
    expect(effectiveRentalStatus('active', null, d(-1), T)).toBe('overdue');
    expect(overdueDays(null, d(-1), T)).toBe(1);
    expect(overdueDays(null, d(-3), T)).toBe(3);
  });

  it('does not take a stored "overdue" for a fact', () => {
    expect(effectiveRentalStatus('overdue', d(-1), d(-7), T)).toBe('due_today');
    expect(effectiveRentalStatus('overdue', d(6), d(-7), T)).toBe('active');
  });

  it('leaves the decisions as stored, whatever the weeks say', () => {
    for (const stored of ['paused', 'disputed', 'returned', 'booked'] as const) {
      expect(effectiveRentalStatus(stored, d(-30), d(-37), T)).toBe(stored);
      // Not on its due day either.
      expect(effectiveRentalStatus(stored, d(-1), d(-7), T)).toBe(stored);
    }
  });

  it('a rental with no pickup day is a booking', () => {
    expect(effectiveRentalStatus('active', null, null, T)).toBe('booked');
  });
});

describe('one stored week by the due-day rule', () => {
  const week = (seq: number, startsOn: string, paidTetri = 0, amountTetri = RATE): DueWeek => ({ seq, startsOn, amountTetri, paidTetri });

  it('case 1: began today with nothing older open — due today, part-paid or not', () => {
    const paid = week(1, d(-7), RATE);
    const today = week(2, T);
    expect(weekDue(paid, [paid, today], T)).toBe('paid');
    expect(weekDue(today, [paid, today], T)).toBe('due_today');
    const part = week(2, T, 5000);
    expect(weekDue(part, [paid, part], T)).toBe('due_today');
  });

  it('case 2: began yesterday — late', () => {
    const w = week(2, d(-1));
    expect(weekDue(w, [week(1, d(-8), RATE), w], T)).toBe('late');
  });

  it('case 3: an older week open makes today’s late too', () => {
    const older = week(2, d(-7));
    const today = week(3, T);
    const all = [week(1, d(-14), RATE), older, today];
    expect(weekDue(older, all, T)).toBe('late');
    expect(weekDue(today, all, T)).toBe('late');
    // Part-paid is still open.
    const part = week(2, d(-7), 5000);
    expect(weekDue(today, [part, today], T)).toBe('late');
  });

  it('case 4: the first week on the hand-over day — due today', () => {
    const w = week(1, T);
    expect(weekDue(w, [w], T)).toBe('due_today');
  });

  it('a week ahead is ahead; a week at nothing is none, and does not make the next one late', () => {
    const ahead = week(2, d(7));
    expect(weekDue(ahead, [ahead], T)).toBe('ahead');
    const nothing = week(2, d(-7), 0, 0);
    const today = week(3, T);
    expect(weekDue(nothing, [nothing, today], T)).toBe('none');
    expect(weekDue(today, [week(1, d(-14), RATE), nothing, today], T)).toBe('due_today');
  });
});

describe('how much of the one figure is awaited today', () => {
  const paidWeek = (startsOn: string) => ({ startsOn, amountTetri: RATE, paidTetri: RATE });
  const openWeek = (startsOn: string, paidTetri = 0) => ({ startsOn, amountTetri: RATE, paidTetri });
  const rental = (id: string, periods: DebtRental['periods'], depositPaid = DEPOSIT, open = true): DebtRental => ({
    id,
    number: `R-${id}`,
    open,
    periods,
    deposit: { amountTetri: DEPOSIT, paidTetri: depositPaid },
  });
  const debtOf = (over: Partial<DebtInput>) => customerDebt({ today: T, rentals: [], sales: [], repairs: [], unplacedTetri: 0, depositHeldTetri: 0, ...over });
  const due = (id: string, status: RentalStatus, pickedUpOn: string) => ({ id, status, pickedUpOn });

  const case1 = rental('1', [paidWeek(d(-7)), openWeek(T)]);
  const case2 = rental('2', [paidWeek(d(-8)), openWeek(d(-1))]);
  const case3 = rental('3', [paidWeek(d(-14)), openWeek(d(-7)), openWeek(T)]);
  const case4 = rental('4', [openWeek(T)], 0);

  it('case 1: the whole figure is the week that began today', () => {
    const debt = debtOf({ rentals: [case1] });
    expect(debt.owesTetri).toBe(15000);
    expect(dueTodayOf(debt, [due('1', 'due_today', d(-7))], T)).toEqual({ tetri: 15000, rentTetri: 15000, byRental: { '1': 15000 } });
  });

  it('cases 2 and 3: nothing of a late rental is awaited, today’s week included', () => {
    const two = debtOf({ rentals: [case2] });
    expect(two.owesTetri).toBe(15000);
    expect(dueTodayOf(two, [due('2', 'overdue', d(-8))], T)).toEqual({ tetri: 0, rentTetri: 0, byRental: {} });
    const three = debtOf({ rentals: [case3] });
    expect(three.owesTetri).toBe(30000);
    expect(dueTodayOf(three, [due('3', 'overdue', d(-14))], T)).toEqual({ tetri: 0, rentTetri: 0, byRental: {} });
  });

  it('case 4: on the hand-over day the deposit not yet received is awaited with the week', () => {
    const debt = debtOf({ rentals: [case4] });
    expect(debt.owesTetri).toBe(33000);
    expect(dueTodayOf(debt, [due('4', 'due_today', T)], T)).toEqual({ tetri: 33000, rentTetri: 15000, byRental: { '4': 33000 } });
  });

  it('a deposit short since an earlier day is debt, on a due day too', () => {
    const short = rental('5', [paidWeek(d(-14)), paidWeek(d(-7)), openWeek(T)], 10000);
    const debt = debtOf({ rentals: [short] });
    expect(debt.owesTetri).toBe(23000);
    expect(dueTodayOf(debt, [due('5', 'due_today', d(-14))], T)).toEqual({ tetri: 15000, rentTetri: 15000, byRental: { '5': 15000 } });
  });

  it('a week part-paid on its first day: what is left of it is awaited', () => {
    const debt = debtOf({ rentals: [rental('6', [paidWeek(d(-7)), openWeek(T, 5000)])] });
    expect(debt.owesTetri).toBe(10000);
    expect(dueTodayOf(debt, [due('6', 'due_today', d(-7))], T)).toEqual({ tetri: 10000, rentTetri: 10000, byRental: { '6': 10000 } });
  });

  it('two rentals, one late and one due today: only the second is awaited; credit is never taken to have cleared the older debt', () => {
    const rentals = [due('2', 'overdue', d(-8)), due('1', 'due_today', d(-7))];
    const none = debtOf({ rentals: [case2, case1] });
    expect(none.owesTetri).toBe(30000);
    expect(dueTodayOf(none, rentals, T)).toEqual({ tetri: 15000, rentTetri: 15000, byRental: { '1': 15000 } });

    // Money on account may name the other rental, and then the roll never
    // puts it on the late one: while a late part is listed the figure is not
    // wholly awaited, whatever the credit.
    for (const [unplacedTetri, owesTetri, tetri] of [
      [10000, 20000, 5000],
      [15000, 15000, 0],
      [20000, 10000, 0],
      [30000, 0, 0],
    ] as const) {
      const debt = debtOf({ rentals: [case2, case1], unplacedTetri });
      expect(debt.owesTetri).toBe(owesTetri);
      const awaited = dueTodayOf(debt, rentals, T);
      expect(awaited).toMatchObject({ tetri, rentTetri: tetri });
      // Red on every screen: the awaited part never reaches the figure.
      if (owesTetri > 0) expect(awaited.tetri).toBeLessThan(debt.owesTetri);
    }
  });

  it('credit does not clear a sale or a repair: with one of them in the figure a hand-over day is still a debt', () => {
    // An instalment of 200 overdue and 200 on account: the figure nets to
    // nought, so the hand-over is not stopped. Handed over today with "later".
    const sale = { id: 's', number: 'S-1', status: 'active' as const, instalments: [{ dueOn: d(-3), amountTetri: 20000, paidTetri: 0 }] };
    const withSale = debtOf({ rentals: [case4], sales: [sale], unplacedTetri: 20000 });
    expect(withSale.owesTetri).toBe(33000);
    // Tonight the roll puts the 200 on this rental's deposit and week — never
    // on the instalment. What is left awaited is 130; the other 200 is the sale's.
    expect(dueTodayOf(withSale, [due('4', 'due_today', T)], T)).toEqual({ tetri: 13000, rentTetri: 13000, byRental: { '4': 33000 } });

    const repair = { id: 'j', number: 'SV-1', chargedTetri: 20000, paidTetri: 0 };
    const withRepair = debtOf({ rentals: [case1], repairs: [repair], unplacedTetri: 20000 });
    expect(withRepair.owesTetri).toBe(15000);
    expect(dueTodayOf(withRepair, [due('1', 'due_today', d(-7))], T)).toMatchObject({ tetri: 0, rentTetri: 0 });
  });

  it('is never above the figure and never below nought, whatever is on account', () => {
    const sale = { id: 's', number: 'S-1', status: 'active' as const, instalments: [{ dueOn: d(-3), amountTetri: 20000, paidTetri: 0 }] };
    for (const unplacedTetri of [0, 5000, 18000, 20000, 33000, 40000, 53000, 60000]) {
      for (const sales of [[], [sale]]) {
        const debt = debtOf({ rentals: [case4], sales, unplacedTetri });
        const awaited = dueTodayOf(debt, [due('4', 'due_today', T)], T);
        expect(awaited.tetri).toBeGreaterThanOrEqual(0);
        expect(awaited.tetri).toBeLessThanOrEqual(debt.owesTetri);
        expect(awaited.rentTetri).toBeLessThanOrEqual(awaited.tetri);
        // Wholly awaited only with nothing older listed.
        if (debt.owesTetri > 0) expect(awaited.tetri === debt.owesTetri).toBe(sales.length === 0);
      }
    }
  });

  it('case 4 with credit: it comes off the deposit first, the rent is still awaited whole', () => {
    const debt = debtOf({ rentals: [case4], unplacedTetri: 10000 });
    expect(debt.owesTetri).toBe(23000);
    expect(dueTodayOf(debt, [due('4', 'due_today', T)], T)).toMatchObject({ tetri: 23000, rentTetri: 15000 });
  });

  it('a sale and a repair are never awaited, and a rental that is not running awaits nothing', () => {
    const sale = { id: 's', number: 'S-1', status: 'active' as const, instalments: [{ dueOn: T, amountTetri: 20000, paidTetri: 0 }] };
    const repair = { id: 'j', number: 'SV-1', chargedTetri: 5000, paidTetri: 0 };
    const mixed = debtOf({ rentals: [case1], sales: [sale], repairs: [repair] });
    expect(mixed.owesTetri).toBe(40000);
    expect(dueTodayOf(mixed, [due('1', 'due_today', d(-7))], T)).toEqual({ tetri: 15000, rentTetri: 15000, byRental: { '1': 15000 } });
    expect(dueTodayOf(debtOf({ sales: [sale], repairs: [repair] }), [], T)).toEqual({ tetri: 0, rentTetri: 0, byRental: {} });

    // The same week on a rental returned, paused or disputed today: debt, not awaited.
    const debt = debtOf({ rentals: [case1] });
    for (const status of ['returned', 'paused', 'disputed', 'active', 'booked'] as const) {
      expect(dueTodayOf(debt, [due('1', status, d(-7))], T)).toEqual({ tetri: 0, rentTetri: 0, byRental: {} });
    }
  });

  it('the figure itself is never touched', () => {
    const input: DebtInput = { today: T, rentals: [case1, case2, case3, case4], sales: [], repairs: [], unplacedTetri: 0, depositHeldTetri: 0 };
    const before = customerDebt(input);
    const copy = JSON.parse(JSON.stringify(before));
    dueTodayOf(before, [due('1', 'due_today', d(-7)), due('2', 'overdue', d(-8)), due('3', 'overdue', d(-14)), due('4', 'due_today', T)], T);
    expect(before).toEqual(copy);
    // 150 + 150 + 300 + 330: the four figures of the note's table.
    expect(before.owesTetri).toBe(93000);
  });
});

describe('what stops a new hand-over (В2, unchanged)', () => {
  it('is the whole figure: money awaited today stops it like any other', () => {
    expect(handOverBlockTetri(15000, 15000)).toBe(15000);
    expect(handOverBlockTetri(33000, 15000)).toBe(33000);
    expect(handOverBlockTetri(30000, 15000)).toBe(30000);
    expect(handOverBlockTetri(0, 0)).toBe(0);
  });
});

describe('is there a ready WhatsApp message for a rental today', () => {
  it('none on the hand-over day: the customer has just stood at the desk, and no approved text is true of it', () => {
    // Case 4: handed over today, nothing paid.
    expect(waOffered('due_today', T, T)).toBe(false);
  });

  it('an ordinary due day has one — «Сегодня оплата», read by the owner on 12.10.2026', () => {
    // Case 1.
    expect(waOffered('due_today', d(-7), T)).toBe(true);
    // A rental brought over with its weeks: the pickup day is long past or not known.
    expect(waOffered('due_today', d(-70), T)).toBe(true);
    expect(waOffered('due_today', null, T)).toBe(true);
  });

  it('every other state has one, as before', () => {
    for (const status of ['overdue', 'active', 'returned', 'paused', 'disputed', 'booked'] as const) {
      expect(waOffered(status, d(-7), T)).toBe(true);
      expect(waOffered(status, T, T)).toBe(true);
    }
  });
});

describe('the templates the sheet offers, and the one it opens on', () => {
  it('due today: «Сегодня оплата» alone, whatever else the figure holds', () => {
    expect(waTemplatesOf('due_today', 15000)).toEqual({ all: ['today'], first: 'today' });
    // A deposit short since an earlier day is in the figure; the week is still the one that began today.
    expect(waTemplatesOf('due_today', 33000)).toEqual({ all: ['today'], first: 'today' });
    expect(waTemplatesOf('due_today', 0)).toEqual({ all: ['today'], first: 'today' });
  });

  it('late: the two older ones, open on «Просрочка»', () => {
    expect(waTemplatesOf('overdue', 15000)).toEqual({ all: ['overdue', 'tomorrow'], first: 'overdue' });
    // Late with nothing in the figure (the roll stood still): the state answers.
    expect(waTemplatesOf('overdue', 0)).toEqual({ all: ['overdue', 'tomorrow'], first: 'overdue' });
  });

  it('any other rental: the debt chooses, as before, and «Сегодня оплата» is never offered', () => {
    for (const status of ['active', 'returned', 'paused', 'disputed', 'booked', null] as const) {
      expect(waTemplatesOf(status, 30000)).toEqual({ all: ['overdue', 'tomorrow'], first: 'overdue' });
      expect(waTemplatesOf(status, 0)).toEqual({ all: ['overdue', 'tomorrow'], first: 'tomorrow' });
    }
  });
});

describe('the one rental a message from a customer’s card is about', () => {
  const r = (id: string, status: RentalStatus, pickedUpOn: string | null = d(-7)) => ({ id, status, pickedUpOn });
  const owes =
    (...ids: string[]) =>
    (id: string) =>
      ids.includes(id);

  it('the most urgent: overdue, then due today, then any not returned', () => {
    const late = r('late', 'overdue');
    const today = r('today', 'due_today');
    const fine = r('fine', 'active');
    const back = r('back', 'returned');
    expect(waRentalOf([back, fine, today, late], owes(), T)).toEqual({ rental: late, offered: true });
    expect(waRentalOf([back, fine, today], owes('today'), T)).toEqual({ rental: today, offered: true });
    expect(waRentalOf([back, fine], owes(), T)).toEqual({ rental: fine, offered: true });
    expect(waRentalOf([back, r('p', 'paused')], owes(), T)).toMatchObject({ rental: { id: 'p' }, offered: true });
  });

  it('nothing running: the card writes as before, about no rental in particular', () => {
    expect(waRentalOf([], owes(), T)).toEqual({ rental: null, offered: true });
    expect(waRentalOf([r('back', 'returned')], owes('back'), T)).toEqual({ rental: null, offered: true });
  });

  it('due today on an ordinary day: the message is about that rental, older debt on another or not', () => {
    const today = r('today', 'due_today');
    expect(waRentalOf([today], owes('today'), T)).toEqual({ rental: today, offered: true });
    // A returned rental with a debt does not take its place: the running one is the more urgent.
    expect(waRentalOf([today, r('back', 'returned')], owes('today', 'back'), T)).toEqual({ rental: today, offered: true });
  });

  it('the most urgent was handed over today and nothing else owes: no message today', () => {
    const fresh = r('new', 'due_today', T);
    expect(waRentalOf([fresh], owes('new'), T)).toEqual({ rental: fresh, offered: false });
    // Another rental that runs and owes nothing is not a reason to write.
    expect(waRentalOf([fresh, r('fine', 'active')], owes('new'), T)).toEqual({ rental: fresh, offered: false });
    // Its own older part has no text either: it is the same rental.
    expect(waRentalOf([fresh, r('back', 'returned')], owes('new'), T)).toEqual({ rental: fresh, offered: false });
    // Two handed over today: neither has a text.
    expect(waRentalOf([fresh, r('too', 'due_today', T)], owes('new', 'too'), T)).toMatchObject({ rental: fresh, offered: false });
  });

  it('handed over today beside an older debt on another rental: the message is about the one that owes', () => {
    const fresh = r('new', 'due_today', T);
    // Returned with unpaid weeks or charges.
    const back = r('back', 'returned');
    expect(waRentalOf([fresh, back], owes('new', 'back'), T)).toEqual({ rental: back, offered: true });
    // Running with a deposit short; paused or disputed with a week unpaid.
    for (const status of ['active', 'paused', 'disputed'] as const) {
      const other = r('other', status);
      expect(waRentalOf([fresh, other], owes('new', 'other'), T)).toEqual({ rental: other, offered: true });
    }
  });
});

describe('the due day on «Сегодня»: one line of the schedule (issue #18, B4)', () => {
  const rental = (over: Partial<QueueRental> = {}): QueueRental => ({
    id: 'r1',
    number: 'R-00001',
    customer: { id: 'c1', name: 'ТЕСТ Клиент', phone: '+995555000001' },
    vin: 'TEST0000000000001',
    pickedUpOn: d(-7),
    expectedReturnOn: null,
    paidThrough: d(-1),
    payOffsetDays: 0,
    status: 'due_today',
    debtTetri: 15000,
    dueTodayTetri: 15000,
    depositUndecided: false,
    vinUnconfirmed: false,
    contractUnsigned: false,
    ...over,
  });
  const input = (over: Partial<QueueInput> = {}): QueueInput => ({
    today: T,
    owner: true,
    rentals: [],
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
    ...over,
  });
  const group = (g: ReturnType<typeof dayQueue>, name: string) => g.find((x) => x.group === name);

  const case1 = rental();
  const case2 = rental({ id: 'r2', number: 'R-00002', status: 'overdue', pickedUpOn: d(-8), paidThrough: d(-2), dueTodayTetri: 0 });
  const case3 = rental({ id: 'r3', number: 'R-00003', status: 'overdue', pickedUpOn: d(-14), paidThrough: d(-8), debtTetri: 30000, dueTodayTetri: 0 });
  const case4 = rental({ id: 'r4', number: 'R-00004', pickedUpOn: T, paidThrough: null, debtTetri: 33000, dueTodayTetri: 33000 });

  // The groups «Просрочены» and «Ждём сегодня» listed these rentals a second
  // time, counted by "paid through"; «Оплаты по графику» lists them, by weeks.
  it('the four cases are rows of the schedule, not of «Сегодня»: no group lists a rental by its debt', () => {
    expect(dayQueue(input({ rentals: [case4, case3, case2, case1] }))).toEqual([]);
  });

  it('one line says the schedule’s two numbers and opens it; noughts say nothing', () => {
    const q = dayQueue(input({ rentals: [case4, case3, case2, case1], schedule: { late: 2, dueToday: 2 } }));
    expect(q.map((g) => g.group)).toEqual(['schedule']);
    expect(q[0]!.rows).toEqual([
      { id: 'schedule', group: 'schedule', action: 'open_schedule', who: null, number: null, vin: null, days: null, amountTetri: null, href: '/schedule', phone: null, note: '2|2' },
    ]);
    // One line, one thing to do: «Сегодня»'s badge counts it once — the schedule's own badge counts the rentals.
    expect(queueCount(q)).toBe(1);
    expect(dayQueue(input({ schedule: { late: 3, dueToday: 0 } }))[0]!.rows[0]!.note).toBe('3|0');
    expect(dayQueue(input({ schedule: { late: 0, dueToday: 4 } }))[0]!.rows[0]!.note).toBe('0|4');
    expect(dayQueue(input({ schedule: { late: 0, dueToday: 0 } }))).toEqual([]);
    expect(dayQueue(input({ schedule: null }))).toEqual([]);
  });

  it('stands where the two groups stood, right after the returns', () => {
    const q = dayQueue(input({ rentals: [rental({ expectedReturnOn: d(-1) })], schedule: { late: 1, dueToday: 1 }, unmatchedLines: 2 }));
    expect(q.map((g) => g.group)).toEqual(['returns', 'schedule', 'money']);
  });

  it('a manager gets the same line; no sum is in it for anybody (ADR-0048, addendum of 25.10.2026)', () => {
    const mine = dayQueue(input({ owner: false, schedule: { late: 1, dueToday: 1 } }));
    const theirs = dayQueue(input({ schedule: { late: 1, dueToday: 1 } }));
    expect(mine.map((g) => g.rows)).toEqual(theirs.map((g) => g.rows));
    expect(mine[0]!.totalTetri).toBeNull();
    expect(theirs[0]!.totalTetri).toBe(0);
  });

  it('the line under a group says one set: all its rows and their sum for an owner, the rows left without a sum (QA of #15)', () => {
    const instalments = [1, 2, 3, 4, 5].map((i) => ({ id: `i${i}`, saleId: `s${i}`, number: `SL-0000${i}`, who: 'ТЕСТ Покупатель', phone: null, days: i, amountTetri: 10000 * i }));
    const theirs = group(dayQueue(input({ instalments })), 'instalments')!;
    expect([theirs.total, theirs.rows.length]).toEqual([5, 3]);
    // «Все 5 · 1 500 ₾»: the five and their sum — not «Ещё 2» beside the sum of all five.
    expect(queueMore(theirs)).toEqual({ kind: 'all', count: 5, tetri: 150000 });
    // A group that carries no sum — a manager's (ADR-0048, addendum): «Ещё 2», the rows left.
    expect(queueMore({ ...theirs, totalTetri: null })).toEqual({ kind: 'left', count: 2 });
    // A group that shows all it has: no line under it.
    expect(queueMore(group(dayQueue(input({ instalments: instalments.slice(0, 3) })), 'instalments')!)).toBeNull();
  });

  it('every row of a rental handed over today says there is no ready WhatsApp message — in “returns” and “fill in”', () => {
    const fresh = rental({ pickedUpOn: T, paidThrough: null, debtTetri: 33000, dueTodayTetri: 33000, expectedReturnOn: T, contractUnsigned: true, vinUnconfirmed: true });
    // The usual weekly case: the planned return is the day the paid week ends. It has «Сегодня оплата».
    const due = rental({ id: 'r2', number: 'R-00002', expectedReturnOn: T, vinUnconfirmed: true });
    const late = rental({ id: 'r3', number: 'R-00003', status: 'overdue', pickedUpOn: d(-8), paidThrough: d(-2), dueTodayTetri: 0, expectedReturnOn: d(-1) });
    const rows = dayQueue(input({ rentals: [fresh, due, late] })).flatMap((g) => g.rows);
    const of = (id: string) => rows.filter((x) => x.id.endsWith(`:${id}`));
    expect(of('r1').map((x) => x.id).sort()).toEqual(['return:r1', 'sign:r1', 'vin:r1']);
    expect(of('r1').every((x) => x.whatsapp === false)).toBe(true);
    // Due today on an ordinary day, and late: their rows carry no such mark.
    expect(of('r2').map((x) => x.id).sort()).toEqual(['return:r2', 'vin:r2']);
    expect(of('r2').every((x) => !('whatsapp' in x))).toBe(true);
    expect(of('r3').map((x) => x.id).sort()).toEqual(['return:r3']);
    expect(of('r3').every((x) => !('whatsapp' in x))).toBe(true);
  });

  it('a returned, paused or disputed rental makes no row', () => {
    for (const status of ['returned', 'paused', 'disputed'] as const) {
      expect(dayQueue(input({ rentals: [rental({ status, dueTodayTetri: 0 })] }))).toEqual([]);
    }
  });
});
