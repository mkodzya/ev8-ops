// The payments calendar ("Деньги → Календарь", docs/redesign/payments-calendar.md,
// ADR-0016) — the schedule of weekly rent, with no database, no clock and no
// locale in it, so the screen and the API answer with one arithmetic and a
// test can put rows in and read states out.
//
// Three rules live here and nowhere else:
//
//   * **The schedule is computed, never stored.** A week that has begun takes
//     its sum and what was paid from its row; a week with no row yet — one
//     ahead, or today's before the 00:10 roll — is projected at the rental's
//     weekly rate. The screen is not told which is which.
//   * **Money nothing has taken yet is shown where the night will put it.**
//     The credit is replayed roll by roll in the order `rollPeriods` works in
//     (`apps/api/src/lib/periods.ts`): rental by rental, the deposit, the
//     weeks that exist that night, the charges. So a week the customer has
//     already paid for is never shown as expected or as a debt.
//   * **On its first day a week is "due today"**, and overdue from the next
//     morning — unless the rental already carries an older unpaid week.
//
// The debt beside a late rental is not worked out here: it is the product's
// one figure (`debt.ts`), passed in and passed through.
//
// Since issue #18 (B4; Mika's «Одно правило календаря» of 28.10.2026) the
// lists ask here too: «Сегодня», «Аренды», «Клиенты», the week's report and
// the summary call a running rental late or awaited today by what this
// schedule says of it (`schedulePayOf`, `statusBySchedule`, `customerOwing`),
// not by its stored "paid through", which knows nothing of money the night
// has not placed yet.
import { periodBounds, periodSeqOf, shiftsOf, weekDueOn } from './periods.js';
import { addDays, daysBetween } from './time.js';
import { inPeriod, monthOf, paymentInRow, weekOf, type Period, type WeekPayment } from './week.js';
import type { Tetri } from './money.js';
import type { ISODate, RentalStatus } from './types.js';
import type { DebtPart } from './debt.js';

export const CALENDAR_STATES = ['paid', 'paid_ahead', 'due_today', 'overdue', 'expected'] as const;
export type CalendarState = (typeof CALENDAR_STATES)[number];
/** The database's payment_channel. */
export type CalendarChannel = 'cash' | 'acquiring' | 'transfer' | 'deposit' | 'offset';
/** Six Monday–Sunday weeks hold any month. */
export const CALENDAR_MAX_DAYS = 42;
/** How far ahead a schedule is drawn. */
export const CALENDAR_HORIZON_DAYS = 366;
/**
 * The earliest day a range may start. Not a date of the business — a floor
 * for the day arithmetic: year 0000 passes for a date, the Monday of its first
 * week lies in the year before, which `addDays` cannot write, and the walk
 * over the weeks would then never end.
 */
export const CALENDAR_FIRST_DAY: ISODate = '2000-01-01';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface CalendarPayment {
  paymentId: string;
  occurredOn: ISODate;
  /** ISO instant: the tie-break of `settleCredit`. */
  createdAt: string;
  channel: CalendarChannel;
}

export interface CalendarPeriodRow {
  seq: number;
  startsOn: ISODate;
  endsOn: ISODate;
  amountTetri: Tetri;
  /** `rental_periods.paid_tetri` as stored — what the debt figure reads. */
  paidTetri: Tetri;
  paidBeforeTransfer: boolean;
  /** Days this week was made longer — below nought, shorter (ADR-0041): every later week starts as many days later or earlier. Absent — none. */
  extraDays?: number;
  /**
   * The latest live payment allocated to this week, by (occurredOn, createdAt).
   * Null: none — unpaid, or paid before the transfer. May be left null for
   * rows outside the days shown.
   */
  lastPayment: CalendarPayment | null;
}

export interface CalendarRental {
  id: string;
  number: string;
  customerId: string;
  /** Stored status. Only active | overdue are scheduled — the roll's own filter. */
  status: RentalStatus;
  pickedUpOn: ISODate | null;
  returnedOn: ISODate | null;
  weeklyRateTetri: Tetri;
  /** Days after a week's first day its rent is due — the rental's pay day (ADR-0022). 0 when absent. */
  payOffsetDays?: number;
  /** EVERY row of the rental, not a window: a missing seq means "no row", i.e. projected. */
  periods: CalendarPeriodRow[];
  /** max(0, deposit.amount − deposit.paid): credit goes here first while the rental runs. */
  depositShortTetri: Tetri;
  /** Open return charges. 0 for a running rental in practice; carried so the order is `settleCredit`'s. */
  chargesOpenTetri: Tetri;
  /** The product's one debt figure for this rental, passed in — never recomputed here. */
  debtTetri: Tetri;
}

/** Money paid in that nothing has taken: one payment's gross − Σ all its allocations, > 0. */
export interface CalendarCredit extends CalendarPayment {
  creditTetri: Tetri;
  customerId: string;
  /** The rental the payment names; null = the customer's money tied to no rental, shared by their running rentals. */
  rentalId: string | null;
}

export interface CalendarInput {
  today: ISODate;
  from: ISODate;
  to: ISODate;
  rentals: CalendarRental[];
  credits: CalendarCredit[];
  /** Live payments by their own date, covering the days shown — for "Пришло денег". */
  payments: readonly WeekPayment[];
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface CalendarEntry {
  rentalId: string;
  seq: number;
  /** The week's first day — the day it is due. */
  dueOn: ISODate;
  endsOn: ISODate;
  amountTetri: Tetri;
  /** What is already on it: the row's paid sum plus the credit that will pay it. */
  paidTetri: Tetri;
  leftTetri: Tetri;
  state: CalendarState;
  /**
   * paid / paid_ahead: the date of the payment that completed the week; null
   * when it was paid before the transfer. Null for every other state.
   */
  paidOn: ISODate | null;
  channel: CalendarChannel | null;
  paymentId: string | null;
  /** No row in rental_periods yet: a week ahead, or today's before the 00:10 roll. */
  projected: boolean;
  /** The part of paidTetri that is credit no allocation has placed yet. */
  creditTetri: Tetri;
}

export interface CalendarSum {
  count: number;
  tetri: Tetri;
}

export interface CalendarDay {
  date: ISODate;
  /** Weeks due this day and their full rent — what should come in for the day. */
  due: CalendarSum;
  /** Of them fully paid, paid ahead included ("2 из 3"). */
  paidCount: number;
  leftTetri: Tetri;
  states: Record<CalendarState, number>;
  /** Rent money dated this day — `paymentInRow(p, 'rent')` summed. */
  receivedTetri: Tetri;
}

export interface CalendarWeek {
  /** Monday. */
  from: ISODate;
  /** Sunday. */
  to: ISODate;
  /** Weeks due in it; Σ amountTetri. */
  expected: CalendarSum;
  /** count: weeks fully paid; tetri: Σ paidTetri of ALL its weeks, so paid + left = expected. */
  paid: CalendarSum;
  /** Of paid: state paid_ahead; Σ amountTetri. */
  paidAhead: CalendarSum;
  /** Of paid.tetri: what sits on weeks not complete yet (0 as a rule). */
  partTetri: Tetri;
  /** count: weeks not complete; tetri: Σ leftTetri. */
  left: CalendarSum;
  /** left, by state … */
  overdue: CalendarSum;
  dueToday: CalendarSum;
  /** … state 'expected'. */
  upcoming: CalendarSum;
  /** The day with the largest due.tetri; the earliest on a tie; null when nothing is due. */
  heaviest: { date: ISODate; tetri: Tetri } | null;
  /** Σ receivedTetri of its seven days = `weekIncome(payments, week).rentTetri`. */
  receivedTetri: Tetri;
}

export interface CalendarLate {
  rentalId: string;
  /** The one figure, passed through — rent, an unpaid deposit and return charges, before credit. */
  debtTetri: Tetri;
  /** Σ leftTetri of its overdue weeks (rent only, after credit). */
  overdueTetri: Tetri;
  /** How many weeks count as overdue. */
  weeks: number;
  /** First day of the oldest of them. */
  sinceOn: ISODate;
  /** daysBetween(sinceOn, today). */
  days: number;
}

export interface CalendarLateList {
  count: number;
  /** Σ rentals[].debtTetri. */
  debtTetri: Tetri;
  /**
   * Of debtTetri: what sits on overdue weeks that have a row and began in the
   * Monday–Sunday week of TODAY — min(debtTetri, their Σ leftTetri). A week by
   * calculation is not counted: the debt does not hold it either.
   */
  thisWeekTetri: Tetri;
  /** debtTetri − thisWeekTetri: older weeks, an unpaid deposit, charges. */
  earlierTetri: Tetri;
  /** Order: days desc, then debtTetri desc, then rental number. The screen draws this order as it is. */
  rentals: CalendarLate[];
}

export interface PaymentsCalendar {
  today: ISODate;
  from: ISODate;
  to: ISODate;
  /** The earliest pickup day among the running rentals; null = no rental is running. As of today, whatever range was asked. */
  firstPickupOn: ISODate | null;
  /** Every Monday–Sunday week that touches from…to, and the week of today if it is not among them. Ascending. */
  weeks: CalendarWeek[];
  /** Every day of those weeks and the Monday after each. Ascending, no gaps inside a week, zero-days included. */
  days: CalendarDay[];
  /** The weeks due on those days. Order: dueOn, then overdue · due_today · expected · paid/paid_ahead, then paidOn, then rental number. */
  entries: CalendarEntry[];
  /** As of today, whatever range was asked. */
  late: CalendarLateList;
}

/** What the screen needs to name a rental — only what the rentals list already gives an owner. */
export interface CalendarRentalCard {
  id: string;
  /** R-00491 */
  number: string;
  customer: { id: string; name: string; nameKa: string | null; nameLat: string | null; phone: string | null };
  /** As GET /api/rentals returns it: the full VIN, model = `${brand} ${name}`. */
  vehicle: { id: string; vin: string; model: string } | null;
  weeklyRateTetri: Tetri;
  /** The pickup day: a rental handed over today has no WhatsApp message that day (`waOffered`). */
  pickedUpOn: ISODate | null;
  /** Stored paid-through, for the WhatsApp sheet. */
  paidThrough: ISODate | null;
  /** The one figure — the same number as GET /api/rentals `debtTetri`. */
  debtTetri: Tetri;
}

/** What GET /api/money/calendar answers. Declared here so the web imports the type instead of re-declaring it. */
export type PaymentsCalendarAnswer = PaymentsCalendar & {
  /** One card per rental named in `entries` or `late.rentals`. */
  rentals: CalendarRentalCard[];
  /** Statement lines nobody has sorted yet, INCOMING only. As of now, whatever range was asked. */
  unsortedIn: number;
};

/** A day of «Оплаты по графику» without its money: how many weeks fall due on it, and in what state (issue #15). */
export type ScheduleDay = Omit<CalendarDay, 'due' | 'leftTetri' | 'receivedTetri'> & { due: { count: number } };

/**
 * «Оплаты по графику» as a manager reads it (issue #15 of the director,
 * ADR-0048): who owes what and when, row by row — a week of a rental with its
 * rent and what is left of it, a late rental with its debt — and no sum of
 * several rows: no week's or month's figures, no day's total, no money
 * received, no debt of everybody together. Those stay with `payments.view`.
 */
export interface ScheduleAnswer {
  totals: false;
  today: ISODate;
  from: ISODate;
  to: ISODate;
  firstPickupOn: ISODate | null;
  /** The Monday–Sunday weeks the answer covers — their days, not their sums. */
  weeks: Period[];
  days: ScheduleDay[];
  entries: CalendarEntry[];
  late: { count: number; rentals: CalendarLate[] };
  rentals: CalendarRentalCard[];
  unsortedIn: number;
}

/** What GET /api/money/calendar answers: every sum to whoever has `payments.view`, the rows alone to anybody else. */
export type CalendarAnswer = (PaymentsCalendarAnswer & { totals: true }) | ScheduleAnswer;

/**
 * The answer without its sums. Named field by field, never spread: a figure
 * added to the calendar later reaches a manager only once somebody writes it
 * here — the default is that it does not.
 */
export function scheduleOf(a: PaymentsCalendarAnswer): ScheduleAnswer {
  return {
    totals: false,
    today: a.today,
    from: a.from,
    to: a.to,
    firstPickupOn: a.firstPickupOn,
    weeks: a.weeks.map((w) => ({ from: w.from, to: w.to })),
    days: a.days.map((d) => ({ date: d.date, due: { count: d.due.count }, paidCount: d.paidCount, states: { ...d.states } })),
    entries: a.entries.map((e) => ({
      rentalId: e.rentalId,
      seq: e.seq,
      dueOn: e.dueOn,
      endsOn: e.endsOn,
      amountTetri: e.amountTetri,
      paidTetri: e.paidTetri,
      leftTetri: e.leftTetri,
      state: e.state,
      paidOn: e.paidOn,
      channel: e.channel,
      paymentId: e.paymentId,
      projected: e.projected,
      creditTetri: e.creditTetri,
    })),
    late: {
      count: a.late.count,
      rentals: a.late.rentals.map((l) => ({ rentalId: l.rentalId, debtTetri: l.debtTetri, overdueTetri: l.overdueTetri, weeks: l.weeks, sinceOn: l.sinceOn, days: l.days })),
    },
    rentals: a.rentals.map((r) => ({
      id: r.id,
      number: r.number,
      customer: { id: r.customer.id, name: r.customer.name, nameKa: r.customer.nameKa, nameLat: r.customer.nameLat, phone: r.customer.phone },
      vehicle: r.vehicle ? { id: r.vehicle.id, vin: r.vehicle.vin, model: r.vehicle.model } : null,
      weeklyRateTetri: r.weeklyRateTetri,
      pickedUpOn: r.pickedUpOn,
      paidThrough: r.paidThrough,
      debtTetri: r.debtTetri,
    })),
    unsortedIn: a.unsortedIn,
  };
}

/** A day's rent in money — or nothing, for an answer without sums. */
export const dayDueTetri = (day: CalendarDay | ScheduleDay): Tetri | null => ('tetri' in day.due ? day.due.tetri : null);

/**
 * The two numbers beside «Оплаты по графику» in the menu (issue #15): the
 * rentals late, and the weeks awaited today and not paid yet — the rows of the
 * screen's «Просрочки» and «Сегодня», counted from the same answer.
 */
export function scheduleCounts(a: Pick<PaymentsCalendar, 'today' | 'entries'> & { late: { count: number } }): { late: number; dueToday: number } {
  return { late: a.late.count, dueToday: a.entries.filter((e) => e.dueOn === a.today && e.state === 'due_today').length };
}

// ---------------------------------------------------------------------------
// The days an answer covers
// ---------------------------------------------------------------------------

/** The grid of a month: Monday of the week its 1st falls in … Sunday of the week its last day falls in. */
export function calendarGrid(day: ISODate): Period {
  const month = monthOf(day);
  return { from: weekOf(month.from).from, to: weekOf(month.to).to };
}

// Plain code-unit order: dates, instants and rental numbers sort the same on
// every device, which a locale's collation does not promise.
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Every Monday–Sunday week that touches from…to, and the week of today. */
function weeksShown(from: ISODate, to: ISODate, today: ISODate): Period[] {
  const out: Period[] = [];
  for (let w = weekOf(from); w.from <= to; w = weekOf(addDays(w.to, 1))) out.push(w);
  const cur = weekOf(today);
  if (!out.some((w) => w.from === cur.from)) out.push(cur);
  return out.sort((a, b) => cmp(a.from, b.from));
}

/**
 * Their days, and the Monday after each: "the day after" any day a person can
 * choose is then in the answer too — the phone's line «Завтра», the laptop's
 * third list.
 */
function daysShown(weeks: Period[]): ISODate[] {
  const days = new Set<ISODate>();
  for (const w of weeks) for (let i = 0; i <= 7; i++) days.add(addDays(w.from, i));
  return [...days].sort(cmp);
}

/** The first and last day an answer for from…to covers. */
export function calendarSpan(from: ISODate, to: ISODate, today: ISODate): Period {
  const days = daysShown(weeksShown(from, to, today));
  return { from: days[0], to: days[days.length - 1] };
}

/**
 * The same days as unbroken stretches — the API reads payments for exactly
 * these. One as a rule; two when the weeks asked for stand apart from the
 * week of today, so that a month paged far back does not read every payment
 * between it and now.
 */
export function calendarSpans(from: ISODate, to: ISODate, today: ISODate): Period[] {
  const out: Period[] = [];
  for (const day of daysShown(weeksShown(from, to, today))) {
    const last = out[out.length - 1];
    if (last && addDays(last.to, 1) === day) last.to = day;
    else out.push({ from: day, to: day });
  }
  return out;
}

/** The totals a screen shows for a chosen day: its week, or the week of today when that day is outside the answer. */
export function calendarWeekOf(cal: PaymentsCalendar, day: ISODate): CalendarWeek {
  // The week of today is always among them.
  return cal.weeks.find((w) => inPeriod(w, day)) ?? cal.weeks.find((w) => inPeriod(w, cal.today))!;
}

export function calendarEntriesOn(cal: { entries: readonly CalendarEntry[] }, day: ISODate): CalendarEntry[] {
  return cal.entries.filter((e) => e.dueOn === day);
}

/**
 * A stretch's rent counted by the day each week is due (director, 22.10.2026):
 * what should come in, what of it is paid, what is short on days already
 * gone, and what is still awaited from today on. short + waiting is what is
 * left, so due = paid + short + waiting, in money and in weeks alike.
 */
export interface CalendarTotals {
  due: CalendarSum;
  /** count: weeks fully paid; tetri: Σ paidTetri of every week, part-paid ones included. */
  paid: CalendarSum;
  /** Weeks due before today and not paid in full; Σ leftTetri. */
  short: CalendarSum;
  /** Weeks due today or later and not paid in full; Σ leftTetri. */
  waiting: CalendarSum;
}

export interface CalendarMonthTotals {
  /** The month's first and last day. */
  month: Period;
  total: CalendarTotals;
  /**
   * Its Monday–Sunday weeks cut to the month: the first may start on a
   * Wednesday, the last end on a Friday. `part` marks a week cut so: its row
   * holds only the month's days, while the week it opens holds all seven.
   */
  weeks: (Period & CalendarTotals & { part: boolean })[];
}

function totalsOf(entries: readonly CalendarEntry[], today: ISODate): CalendarTotals {
  const open = entries.filter((e) => e.leftTetri > 0);
  const short = open.filter((e) => e.dueOn < today);
  const waiting = open.filter((e) => e.dueOn >= today);
  return {
    due: sumOf(entries, (e) => e.amountTetri),
    paid: { count: entries.length - open.length, tetri: entries.reduce((n, e) => n + e.paidTetri, 0) },
    short: sumOf(short, (e) => e.leftTetri),
    waiting: sumOf(waiting, (e) => e.leftTetri),
  };
}

/**
 * The month of `day`, whole and week by week, from the answer already on the
 * screen: its entries cover every day of the month's grid, so nothing is asked
 * of the server. A week on the edge of two months is counted in each month
 * only for its own days, so two months' totals never hold one week twice.
 */
export function calendarMonthTotals(cal: Pick<PaymentsCalendar, 'entries' | 'weeks'>, day: ISODate, today: ISODate): CalendarMonthTotals {
  const first = `${day.slice(0, 8)}01`;
  const last = addDays(`${addDays(first, 31).slice(0, 8)}01`, -1);
  const mine = cal.entries.filter((e) => e.dueOn >= first && e.dueOn <= last);
  const weeks = cal.weeks
    .filter((w) => w.to >= first && w.from <= last)
    .map((w) => {
      const from = w.from < first ? first : w.from;
      const to = w.to > last ? last : w.to;
      return { from, to, part: from !== w.from || to !== w.to, ...totalsOf(mine.filter((e) => e.dueOn >= from && e.dueOn <= to), today) };
    });
  return { month: { from: first, to: last }, total: totalsOf(mine, today), weeks };
}

// ---------------------------------------------------------------------------
// The schedule
// ---------------------------------------------------------------------------

/** One week of one rental, as the walk sees it. */
interface Slot {
  seq: number;
  /** The week's first day: the night its row comes into being and can take credit. */
  startsOn: ISODate;
  /** The day its rent is due: the first day, or the pay day within the week (ADR-0022). */
  dueOn: ISODate;
  endsOn: ISODate;
  amount: Tetri;
  /** The row's stored sum; 0 for a projected week. */
  paid: Tetri;
  /** Null: no row yet — projected. */
  row: CalendarPeriodRow | null;
  /** What the replay drew for it, and the last payment it drew from. */
  credit: Tetri;
  purse: CalendarPayment | null;
}

interface Walk {
  rental: CalendarRental;
  pickedUpOn: ISODate;
  slots: Slot[];
  depositLeft: Tetri;
  chargesLeft: Tetri;
}

interface Purse extends CalendarPayment {
  left: Tetri;
}

/** The order money is spent in — `settleCredit`'s; the id only makes a tie repeatable. */
const older = (a: CalendarPayment, b: CalendarPayment): number =>
  cmp(a.occurredOn, b.occurredOn) || cmp(a.createdAt, b.createdAt) || cmp(a.paymentId, b.paymentId);

/**
 * A rental the schedule runs — literally the roll's filter (`rollPeriods`):
 * active or overdue as stored, handed over, not returned. Paused, disputed,
 * returned and booked ones have no week, no late row and take no credit.
 */
export function runsOnSchedule(r: { status: string; pickedUpOn: ISODate | null; returnedOn: ISODate | null }): boolean {
  return (r.status === 'active' || r.status === 'overdue') && r.pickedUpOn != null && r.returnedOn == null;
}

/** The order the roll takes the open rentals in (ADR-0016). */
const rollOrder = (a: Walk, b: Walk): number =>
  cmp(a.pickedUpOn, b.pickedUpOn) || cmp(a.rental.number, b.rental.number) || cmp(a.rental.id, b.rental.id);

const fromRow = (row: CalendarPeriodRow, offsetDays: number): Slot => ({
  seq: row.seq,
  startsOn: row.startsOn,
  dueOn: weekDueOn(row.startsOn, offsetDays),
  endsOn: row.endsOn,
  amount: row.amountTetri,
  paid: row.paidTetri,
  row,
  credit: 0,
  purse: null,
});

/**
 * A rental's weeks from the first to the horizon. The walk always starts at
 * seq 1 and always reaches today, whatever range was asked: an unpaid week
 * before the range still makes the rental late, and still makes today's week
 * overdue rather than due.
 */
function walkOf(rental: CalendarRental, pickedUpOn: ISODate, horizon: ISODate): Walk {
  const rows = new Map(rental.periods.map((p) => [p.seq, p]));
  const offset = rental.payOffsetDays ?? 0;
  // A week made longer moves every week after it (ADR-0041): the projected
  // ones are placed where the roll will open them.
  const shifts = shiftsOf(rental.periods);
  const last = periodSeqOf(pickedUpOn, horizon, shifts);
  const slots: Slot[] = [];
  for (let seq = 1; seq <= last; seq++) {
    const row = rows.get(seq);
    if (row) slots.push(fromRow(row, offset));
    else {
      const b = periodBounds(pickedUpOn, seq, shifts);
      slots.push({ seq, startsOn: b.startsOn, dueOn: weekDueOn(b.startsOn, offset), endsOn: b.endsOn, amount: rental.weeklyRateTetri, paid: 0, row: null, credit: 0, purse: null });
    }
  }
  // A row past the horizon — only a roll run by hand for a later day makes
  // one — is not shown, but it exists every night and takes credit in its turn.
  for (const row of rental.periods) if (row.seq > last) slots.push(fromRow(row, offset));
  slots.sort((a, b) => a.seq - b.seq);
  return { rental, pickedUpOn, slots, depositLeft: Math.max(0, rental.depositShortTetri), chargesLeft: Math.max(0, rental.chargesOpenTetri) };
}

function pursesBy(credits: readonly CalendarCredit[], key: (c: CalendarCredit) => string | null): Map<string, Purse[]> {
  const out = new Map<string, Purse[]>();
  for (const c of credits) {
    const k = key(c);
    if (k === null || c.creditTetri <= 0) continue;
    // A copy: the replay spends it, and the input is not ours to spend.
    const purse: Purse = { paymentId: c.paymentId, occurredOn: c.occurredOn, createdAt: c.createdAt, channel: c.channel, left: c.creditTetri };
    out.set(k, [...(out.get(k) ?? []), purse]);
  }
  for (const list of out.values()) list.sort(older);
  return out;
}

/**
 * Take up to `need` from the older head of the two purses — the merged
 * oldest-first list of `settleCredit` — and say which payment gave last.
 */
function draw(own: Purse[], shared: Purse[], need: Tetri): { took: Tetri; last: Purse | null } {
  let took = 0;
  let last: Purse | null = null;
  while (took < need) {
    const a = own[0];
    const b = shared[0];
    const p = !a ? b : !b ? a : older(a, b) <= 0 ? a : b;
    if (!p) break;
    const take = Math.min(p.left, need - took);
    p.left -= take;
    took += take;
    last = p;
    if (p.left <= 0) (p === a ? own : shared).shift();
  }
  return { took, last };
}

/**
 * Replay the rolls over the credit — literally what `rollPeriods` will do:
 * one rental completely, then the next; for each, the deposit, the weeks that
 * exist that night by seq, the charges.
 */
function replay(walks: Walk[], credits: readonly CalendarCredit[], today: ISODate): void {
  const ownBy = pursesBy(credits, (c) => c.rentalId);
  const sharedBy = pursesBy(credits, (c) => (c.rentalId === null ? c.customerId : null));

  // A begun week with no row says today's roll has not run yet (00:00–00:10,
  // or the worker is down): it is the next one. Otherwise the next is tonight's.
  // The roll is one pass over every rental, so any customer's week tells.
  const first = walks.some((w) => w.slots.some((s) => s.row === null && s.startsOn <= today)) ? today : addDays(today, 1);

  const byCustomer = new Map<string, Walk[]>();
  for (const w of walks) byCustomer.set(w.rental.customerId, [...(byCustomer.get(w.rental.customerId) ?? []), w]);

  for (const [customerId, mine] of byCustomer) {
    const shared = sharedBy.get(customerId) ?? [];
    const own = (w: Walk): Purse[] => ownBy.get(w.rental.id) ?? [];
    const spent = (): boolean => shared.length === 0 && mine.every((w) => own(w).length === 0);
    if (spent()) continue;

    // The first roll, then every later night on which one of the customer's
    // weeks comes into being.
    const nights = new Set<ISODate>([first]);
    for (const w of mine) for (const s of w.slots) if (s.row === null && s.startsOn > first) nights.add(s.startsOn);

    for (const night of [...nights].sort(cmp)) {
      for (const w of mine) {
        const take = (need: Tetri) => draw(own(w), shared, need);
        w.depositLeft -= take(w.depositLeft).took;
        for (const s of w.slots) {
          if (s.row === null && s.startsOn > night) continue;
          // Never negative: a row may hold more than its amount.
          const need = Math.max(0, s.amount - s.paid - s.credit);
          if (need === 0) continue;
          const got = take(need);
          s.credit += got.took;
          if (got.last) s.purse = got.last;
        }
        w.chargesLeft -= take(w.chargesLeft).took;
      }
      if (spent()) break;
    }
  }
}

const RANK: Record<CalendarState, number> = { overdue: 0, due_today: 1, expected: 2, paid: 3, paid_ahead: 3 };

const sumOf = (rows: readonly CalendarEntry[], of: (e: CalendarEntry) => Tetri): CalendarSum => ({
  count: rows.length,
  tetri: rows.reduce((n, e) => n + of(e), 0),
});

export function paymentsCalendar(input: CalendarInput): PaymentsCalendar {
  const { today } = input;
  const weeks = weeksShown(input.from, input.to, today);
  const shown = daysShown(weeks);
  // Never before today: the week of today is always in.
  const horizon = shown[shown.length - 1];

  // Literally the roll's filter. Paused, disputed, returned, booked: no week,
  // no late row, and no credit taken.
  const walks: Walk[] = [];
  for (const r of input.rentals) {
    if (!runsOnSchedule(r) || r.pickedUpOn == null) continue;
    walks.push(walkOf(r, r.pickedUpOn, horizon));
  }
  walks.sort(rollOrder);
  replay(walks, input.credits, today);

  const numberOf = new Map(walks.map((w) => [w.rental.id, w.rental.number]));
  const all: CalendarEntry[] = [];
  const late: CalendarLate[] = [];
  for (const w of walks) {
    const overdue: CalendarEntry[] = [];
    // Read off the rental's whole walk, never off the days shown.
    let openBefore = false;
    for (const s of w.slots) {
      // A week at nothing (a pause lifted) is not a week to pay: not shown,
      // not counted, and it does not make the next one overdue.
      if (s.amount <= 0) continue;
      // The clamp: nothing forbids a row whose paid sum is above its amount,
      // and paid + left must still be the amount.
      const paidTetri = Math.min(s.amount, s.paid + s.credit);
      const leftTetri = s.amount - paidTetri;
      let state: CalendarState;
      let by: CalendarPayment | null = null;
      if (leftTetri === 0) {
        // The payment that completed the week: the later of the row's own and
        // the last purse drawn from. A week paid before the transfer has none.
        const stored = s.row && !s.row.paidBeforeTransfer ? s.row.lastPayment : null;
        by = stored && s.purse ? (older(stored, s.purse) >= 0 ? stored : s.purse) : (stored ?? s.purse);
        state = by !== null && by.occurredOn < s.dueOn ? 'paid_ahead' : 'paid';
      } else {
        state = s.dueOn > today ? 'expected' : s.dueOn < today || openBefore ? 'overdue' : 'due_today';
        openBefore = true;
      }
      const entry: CalendarEntry = {
        rentalId: w.rental.id,
        seq: s.seq,
        dueOn: s.dueOn,
        endsOn: s.endsOn,
        amountTetri: s.amount,
        paidTetri,
        leftTetri,
        state,
        paidOn: by?.occurredOn ?? null,
        channel: by?.channel ?? null,
        paymentId: by?.paymentId ?? null,
        projected: s.row === null,
        creditTetri: s.credit,
      };
      all.push(entry);
      if (state === 'overdue') overdue.push(entry);
    }
    if (overdue.length === 0) continue;
    const sinceOn = overdue.reduce((d, e) => (e.dueOn < d ? e.dueOn : d), overdue[0].dueOn);
    late.push({
      rentalId: w.rental.id,
      debtTetri: w.rental.debtTetri,
      overdueTetri: overdue.reduce((n, e) => n + e.leftTetri, 0),
      weeks: overdue.length,
      sinceOn,
      days: daysBetween(sinceOn, today),
    });
  }
  const byNumber = (a: string, b: string): number => cmp(numberOf.get(a) ?? '', numberOf.get(b) ?? '') || cmp(a, b);
  late.sort((a, b) => b.days - a.days || b.debtTetri - a.debtTetri || byNumber(a.rentalId, b.rentalId));

  const cur = weekOf(today);
  const debtTetri = late.reduce((n, l) => n + l.debtTetri, 0);
  // Only weeks that have a row: a week by calculation is overdue here and not
  // yet in the debt (`customerDebt` reads rows), so counting it would name
  // older debt, or an unpaid deposit, "this week". What a stored overdue week
  // has left is always inside its rental's debt; the clamp is a guard.
  const thisWeekTetri = Math.min(
    debtTetri,
    all.filter((e) => e.state === 'overdue' && !e.projected && inPeriod(cur, e.dueOn)).reduce((n, e) => n + e.leftTetri, 0),
  );

  const inShown = new Set(shown);
  const entries = all
    .filter((e) => inShown.has(e.dueOn))
    .sort(
      (a, b) =>
        cmp(a.dueOn, b.dueOn) ||
        RANK[a.state] - RANK[b.state] ||
        // Paid with no payment — before the transfer — goes last.
        Number(a.paidOn === null) - Number(b.paidOn === null) ||
        cmp(a.paidOn ?? '', b.paidOn ?? '') ||
        byNumber(a.rentalId, b.rentalId) ||
        a.seq - b.seq,
    );

  const days: CalendarDay[] = shown.map((date) => ({
    date,
    due: { count: 0, tetri: 0 },
    paidCount: 0,
    leftTetri: 0,
    states: { paid: 0, paid_ahead: 0, due_today: 0, overdue: 0, expected: 0 },
    receivedTetri: 0,
  }));
  const dayOn = new Map(days.map((d) => [d.date, d]));
  for (const e of entries) {
    const d = dayOn.get(e.dueOn)!;
    d.due.count++;
    d.due.tetri += e.amountTetri;
    if (e.leftTetri === 0) d.paidCount++;
    d.leftTetri += e.leftTetri;
    d.states[e.state]++;
  }
  // Money by its own date — the rule of the week's report, the same function.
  for (const p of input.payments) {
    const d = dayOn.get(p.occurredOn);
    if (d) d.receivedTetri += paymentInRow(p, 'rent');
  }

  return {
    today,
    from: input.from,
    to: input.to,
    firstPickupOn: walks.length > 0 ? walks[0].pickedUpOn : null,
    weeks: weeks.map((w) => {
      const mine = entries.filter((e) => inPeriod(w, e.dueOn));
      const open = mine.filter((e) => e.leftTetri > 0);
      const left = (state: CalendarState): CalendarSum => sumOf(open.filter((e) => e.state === state), (e) => e.leftTetri);
      let heaviest: CalendarWeek['heaviest'] = null;
      let receivedTetri = 0;
      for (const d of days) {
        if (!inPeriod(w, d.date)) continue;
        receivedTetri += d.receivedTetri;
        // Strictly larger: on a tie the earlier day stays.
        if (d.due.tetri > (heaviest?.tetri ?? 0)) heaviest = { date: d.date, tetri: d.due.tetri };
      }
      return {
        from: w.from,
        to: w.to,
        expected: sumOf(mine, (e) => e.amountTetri),
        paid: { count: mine.length - open.length, tetri: mine.reduce((n, e) => n + e.paidTetri, 0) },
        paidAhead: sumOf(mine.filter((e) => e.state === 'paid_ahead'), (e) => e.amountTetri),
        partTetri: open.reduce((n, e) => n + e.paidTetri, 0),
        left: sumOf(open, (e) => e.leftTetri),
        overdue: left('overdue'),
        dueToday: left('due_today'),
        upcoming: left('expected'),
        heaviest,
        receivedTetri,
      };
    }),
    days,
    entries,
    late: { count: late.length, debtTetri, thisWeekTetri, earlierTetri: debtTetri - thisWeekTetri, rentals: late },
  };
}

// ---------------------------------------------------------------------------
// One rule for the lists (issue #18, B4)
// ---------------------------------------------------------------------------

/** What «Оплаты по графику» says of a running rental today: late, or awaited today. */
export interface SchedulePay {
  state: 'overdue' | 'due_today';
  /** Days since its oldest late week was due — `CalendarLate.days`; 0 for a rental awaited today. */
  days: number;
}

/**
 * The schedule's verdict on each running rental, as of its `today`: a rental in
 * «Просрочки» is late, with its days; one with a week awaited today and nothing
 * older unpaid is due today; any other running rental is absent — paid up, the
 * credit the night will place counted (Mika's «Одно правило календаря» of
 * 28.10.2026). The rows the menu's two numbers count (`scheduleCounts`).
 */
export function schedulePayOf(a: {
  today: ISODate;
  entries: readonly Pick<CalendarEntry, 'rentalId' | 'dueOn' | 'state'>[];
  late: { rentals: readonly Pick<CalendarLate, 'rentalId' | 'days'>[] };
}): Map<string, SchedulePay> {
  const out = new Map<string, SchedulePay>();
  for (const e of a.entries) if (e.dueOn === a.today && e.state === 'due_today') out.set(e.rentalId, { state: 'due_today', days: 0 });
  for (const l of a.late.rentals) out.set(l.rentalId, { state: 'overdue', days: l.days });
  return out;
}

/**
 * A rental's status as the lists show it (issue #18, B4): a running one —
 * `active`, `due_today` or `overdue` as `effectiveRentalStatus` reads its
 * stored "paid through" — is what the schedule says of it; any other, as it
 * was. Before, «Аренды» said «Просрочена» of a rental whose week an advance
 * already paid, because the advance lies on the week only at night (R-00002,
 * 25.10.2026).
 */
export function statusBySchedule(status: RentalStatus, pay: SchedulePay | undefined): RentalStatus {
  if (status !== 'active' && status !== 'due_today' && status !== 'overdue') return status;
  return pay?.state ?? 'active';
}

/** «Клиенты»: under «Должны» (red), awaited today (ink with the calendar's word), or neither. */
export type CustomerOwing = 'debtor' | 'awaited' | null;

/**
 * A customer by the same rule (issue #18, B4): a debtor when one of his
 * rentals is late in «Оплаты по графику», or when he owes, older than today,
 * something the schedule does not judge — a deposit short, a return's charge,
 * a sale's instalment, a repair, goods, the weeks of a rental it does not run
 * (paused, disputed, returned); awaited when one of his rentals is due today
 * and nothing makes him a debtor. The figure itself stays the one figure
 * (`customerDebt`).
 */
export function customerOwing(input: {
  owesTetri: Tetri;
  /** Of owesTetri: awaited today and not late (`dueTodayOf`). */
  dueTodayTetri: Tetri;
  parts: readonly Pick<DebtPart, 'kind' | 'id' | 'owesTetri'>[];
  /** His rentals the schedule runs (`runsOnSchedule`), each with what it says of them. */
  rentals: readonly { id: string; pay: SchedulePay | undefined }[];
}): CustomerOwing {
  const runs = new Set(input.rentals.map((r) => r.id));
  if (input.rentals.some((r) => r.pay?.state === 'overdue')) return 'debtor';
  const other = input.parts.filter((p) => !(p.kind === 'rent' && runs.has(p.id))).reduce((n, p) => n + p.owesTetri, 0);
  if (other > 0 && input.owesTetri > input.dueTodayTetri) return 'debtor';
  return input.owesTetri > 0 && input.rentals.some((r) => r.pay?.state === 'due_today') ? 'awaited' : null;
}
