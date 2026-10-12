// The due day is not lateness — on every answer of the API (ADR-0017;
// docs/redesign/due-today.md §2, §6).
//
// The four cases of the note, each read from every endpoint that names a
// rental or prints its debt. Rate 150, deposit 180; T is today:
//   1 — the week began today, nothing older is unpaid        running(7)
//   2 — the week began yesterday                             running(8)
//   3 — two weeks unpaid, the newer began today              running(14)
//   4 — handed over today, nothing paid ("later")            running(0, later)
//
// The suites share one database and the real clock. So every date is counted
// from today, a figure of the suite's own rental is asserted as it is, and a
// total is asserted either as a difference before and after, or as an
// equality between two screens — never as an absolute number. "Today" shows
// three rows of a group and counts the rest: a row is checked whenever it is
// shown, and the group's count and sum always.
import { addDays, todayISO, weekOf, type PaymentsCalendarAnswer } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

type Cal = PaymentsCalendarAnswer;

const today = () => todayISO();
const digits = () => uniq().replace(/\D/g, '');

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
type Fixture = Awaited<ReturnType<typeof running>>;

/** Another moped for a customer who already rents. */
async function second(customerId: string, daysAgo: number, over: Record<string, unknown> = {}) {
  const f = await fixtures();
  const owner = await loginAs('owner');
  const res = await call(owner, 'POST', '/api/pickups', pickup(customerId, f.vehicle.id, { pickedUpOn: addDays(today(), -daysAgo), ...over }));
  if (res.statusCode !== 201) throw new Error(res.body);
  return { vehicle: f.vehicle, owner, id: json<{ id: string }>(res).id };
}

const LATER = { payment: { later: true } };
const items = () => ({ moped: { state: 'ok' }, key: { state: 'ok' }, battery_1: { state: 'ok' }, battery_2: { state: 'ok' }, charger_1: { state: 'ok' }, charger_2: { state: 'ok' } });

async function get<T>(who: string, url: string): Promise<T> {
  const res = await call(who, 'GET', url);
  if (res.statusCode !== 200) throw new Error(`${url}: ${res.statusCode} ${res.body}`);
  return json<T>(res);
}
const err = (res: { body: string }) => json<{ error: string; field?: string; permission?: string; owesTetri?: number }>(res);

// ---------------------------------------------------------------------------
// What each endpoint says about one rental
// ---------------------------------------------------------------------------

interface Row {
  id: string;
  status: string;
  overdueDays: number;
  debtTetri: number;
  dueTodayTetri: number;
  pickedUpOn: string | null;
  paidThrough: string | null;
}
interface Card {
  rental: { status: string; storedStatus: string; debtTetri: number; dueTodayTetri: number; paidThrough: string | null };
  periods: { seq: number; startsOn: string; amountTetri: number; paidTetri: number; payStatus: string }[];
}
interface Balance {
  owesTetri: number;
  dueTodayTetri: number;
  dueTodayRentTetri: number;
  dueTodayBy: Record<string, number>;
  creditTetri: number;
  depositHeldTetri: number;
  parts: { kind: string; id: string; owesTetri: number }[];
}
interface CustomerRow {
  id: string;
  debtTetri: number;
  dueTodayTetri: number;
  dueTodayRentTetri: number;
  openRentals: { id: string; status: string }[];
}
interface CustomerCard {
  debt: { owesTetri: number; dueTodayTetri: number };
  rentals: { id: string; status: string }[];
}
interface Found {
  groups: {
    customers: { items: { id: string; debtTetri: number; dueTodayTetri: number }[] };
    rentals: { items: { id: string; debtTetri: number; dueTodayTetri: number }[] };
  };
}

const list = async (who: string) => (await get<{ rentals: Row[] }>(who, '/api/rentals')).rentals;
const balanceOf = (who: string, customerId: string) => get<Balance>(who, `/api/customers/${customerId}/balance`);

/**
 * One rental as nine answers give it: the list, the card, the customers list,
 * the customer's card, the balance, the money form's targets (asked as a
 * manager — it is the manager's form too), the vehicle's card and the search.
 */
async function everywhere(f: { id: string; customer: { id: string; name: string }; vehicle: { id: string } }, owner: string, manager: string) {
  const row = (await list(owner)).find((r) => r.id === f.id)!;
  const card = await get<Card>(owner, `/api/rentals/${f.id}`);
  const customers = (await get<{ customers: CustomerRow[] }>(owner, '/api/customers')).customers.find((c) => c.id === f.customer.id)!;
  const customer = await get<CustomerCard>(owner, `/api/customers/${f.customer.id}`);
  const balance = await balanceOf(owner, f.customer.id);
  const targets = await get<{ debt: Balance }>(manager, `/api/customers/${f.customer.id}/money-targets`);
  const vehicle = await get<{ rentals: { id: string; status: string }[] }>(owner, `/api/fleet/${f.vehicle.id}`);
  // The customer's name is one of a kind: it finds the card and its rentals, nobody else's.
  const found = await get<Found>(owner, `/api/search?q=${encodeURIComponent(f.customer.name)}`);
  const pair = (x: { debtTetri: number; dueTodayTetri: number } | undefined) => (x ? { debtTetri: x.debtTetri, dueTodayTetri: x.dueTodayTetri } : null);
  return {
    list: { status: row.status, overdueDays: row.overdueDays, debtTetri: row.debtTetri, dueTodayTetri: row.dueTodayTetri },
    card: { status: card.rental.status, debtTetri: card.rental.debtTetri, dueTodayTetri: card.rental.dueTodayTetri },
    customers: { status: customers.openRentals.find((r) => r.id === f.id)?.status ?? null, debtTetri: customers.debtTetri, dueTodayTetri: customers.dueTodayTetri, dueTodayRentTetri: customers.dueTodayRentTetri },
    customer: { status: customer.rentals.find((r) => r.id === f.id)?.status ?? null, owesTetri: customer.debt.owesTetri, dueTodayTetri: customer.debt.dueTodayTetri },
    balance: { owesTetri: balance.owesTetri, dueTodayTetri: balance.dueTodayTetri, dueTodayRentTetri: balance.dueTodayRentTetri, dueTodayBy: balance.dueTodayBy },
    targets: { owesTetri: targets.debt.owesTetri, dueTodayTetri: targets.debt.dueTodayTetri, dueTodayBy: targets.debt.dueTodayBy },
    vehicle: vehicle.rentals.find((r) => r.id === f.id)?.status ?? null,
    search: { rental: pair(found.groups.rentals.items.find((r) => r.id === f.id)), customer: pair(found.groups.customers.items.find((c) => c.id === f.customer.id)) },
  };
}

/** The same status and the same pair on every answer: what a rental and its only renter read as. */
function everywhereIs(status: string, overdueDays: number, debtTetri: number, dueTodayTetri: number, dueTodayRentTetri: number, id: string) {
  const dueTodayBy = dueTodayTetri > 0 ? { [id]: dueTodayTetri } : {};
  return {
    list: { status, overdueDays, debtTetri, dueTodayTetri },
    card: { status, debtTetri, dueTodayTetri },
    customers: { status, debtTetri, dueTodayTetri, dueTodayRentTetri },
    customer: { status, owesTetri: debtTetri, dueTodayTetri },
    balance: { owesTetri: debtTetri, dueTodayTetri, dueTodayRentTetri, dueTodayBy },
    targets: { owesTetri: debtTetri, dueTodayTetri, dueTodayBy },
    vehicle: status,
    search: { rental: { debtTetri, dueTodayTetri }, customer: { debtTetri, dueTodayTetri } },
  };
}

// ---------------------------------------------------------------------------
// The calendar — the reference, read and never changed
// ---------------------------------------------------------------------------

async function calendar(who: string): Promise<Cal> {
  return get<Cal>(who, `/api/money/calendar?from=${weekOf(addDays(today(), -21)).from}&to=${weekOf(addDays(today(), 7)).to}`);
}
function entryOn(c: Cal, rentalId: string, dueOn: string) {
  const e = c.entries.find((x) => x.rentalId === rentalId && x.dueOn === dueOn);
  if (!e) throw new Error(`no entry of ${rentalId} due ${dueOn}`);
  return e;
}
const lateOf = (c: Cal, rentalId: string) => c.late.rentals.find((l) => l.rentalId === rentalId);

// ---------------------------------------------------------------------------
// The totals: "Today", the week, the summary, the list
// ---------------------------------------------------------------------------

interface TodayRow {
  id: string;
  group: string;
  action: string;
  number: string | null;
  days: number | null;
  amountTetri: number | null;
  dueTodayTetri?: number;
  note: string | null;
}
interface Today {
  today: string;
  queue: { group: string; rows: TodayRow[]; total: number; totalTetri: number }[];
  count: number;
  numbers: Record<string, unknown> & { overdueTetri: number | null };
}
interface Week {
  rentals: { overdueCount: number; overdueTetri: number };
}
interface Summary {
  rentals: { active: number; overdue: number };
  overdueList: { id: string; days: number; debtTetri: number }[];
  dueToday: { id: string }[];
}

const sum = (rows: { debtTetri: number }[]) => rows.reduce((n, r) => n + r.debtTetri, 0);
const groupOf = (t: Today, name: string) => t.queue.find((g) => g.group === name);

async function totals(owner: string) {
  const t = await get<Today>(owner, '/api/today');
  const w = await get<Week>(owner, '/api/reports/week');
  const s = await get<Summary>(owner, '/api/summary');
  const rows = await list(owner);
  return { t, w, s, rows, late: rows.filter((r) => r.status === 'overdue'), due: rows.filter((r) => r.status === 'due_today') };
}
type Totals = Awaited<ReturnType<typeof totals>>;

/** What one more rental did to every total: [rentals, tetri] each. */
function moved(a: Totals, b: Totals) {
  const group = (x: Totals, name: string) => [groupOf(x.t, name)?.total ?? 0, groupOf(x.t, name)?.totalTetri ?? 0];
  const minus = (p: number[], q: number[]) => [p[0]! - q[0]!, p[1]! - q[1]!];
  return {
    dueTodayGroup: minus(group(b, 'due_today'), group(a, 'due_today')),
    overdueGroup: minus(group(b, 'overdue'), group(a, 'overdue')),
    tile: (b.t.numbers.overdueTetri ?? 0) - (a.t.numbers.overdueTetri ?? 0),
    week: [b.w.rentals.overdueCount - a.w.rentals.overdueCount, b.w.rentals.overdueTetri - a.w.rentals.overdueTetri],
    summary: [b.s.rentals.overdue - a.s.rentals.overdue, sum(b.s.overdueList) - sum(a.s.overdueList)],
    active: b.s.rentals.active - a.s.rentals.active,
    listLate: [b.late.length - a.late.length, sum(b.late) - sum(a.late)],
  };
}
const NOT_LATE = { overdueGroup: [0, 0], tile: 0, week: [0, 0], summary: [0, 0], listLate: [0, 0] };
const lateBy = (tetri: number) => ({ overdueGroup: [1, tetri], tile: tetri, week: [1, tetri], summary: [1, tetri], listLate: [1, tetri], dueTodayGroup: [0, 0], active: 0 });

/**
 * One set, whoever counts it. The tile of "Today", the week's report and the
 * summary are the list's "Просрочены" segment; each group of "Today" is its
 * segment of the list, less the rentals with nothing to take; and every row
 * "Today" shows carries the list's own numbers for that rental.
 */
function oneSet(x: Totals) {
  expect(x.t.numbers.overdueTetri).toBe(sum(x.late));
  expect(x.w.rentals.overdueTetri).toBe(sum(x.late));
  expect(x.w.rentals.overdueCount).toBe(x.late.length);
  expect(x.s.rentals.overdue).toBe(x.late.length);
  expect(sum(x.s.overdueList)).toBe(sum(x.late));
  expect(x.s.overdueList.map((o) => o.id).sort()).toEqual(x.late.map((r) => r.id).sort());
  expect(x.s.dueToday.map((r) => r.id).sort()).toEqual(x.due.map((r) => r.id).sort());

  expect([groupOf(x.t, 'overdue')?.total ?? 0, groupOf(x.t, 'overdue')?.totalTetri ?? 0]).toEqual([x.late.filter((r) => r.debtTetri > 0).length, sum(x.late)]);
  expect([groupOf(x.t, 'due_today')?.total ?? 0, groupOf(x.t, 'due_today')?.totalTetri ?? 0]).toEqual([x.due.filter((r) => r.debtTetri > 0).length, sum(x.due)]);

  const byId = new Map(x.rows.map((r) => [r.id, r]));
  const days = new Map(x.s.overdueList.map((o) => [o.id, o.days]));
  for (const row of groupOf(x.t, 'overdue')?.rows ?? []) {
    const r = byId.get(row.id.split(':')[1]!)!;
    expect(r.status).toBe('overdue');
    expect(row).toMatchObject({ days: r.overdueDays, amountTetri: r.debtTetri, note: null });
    expect(row.days).toBeGreaterThan(0);
    expect(row.days).toBe(days.get(r.id));
    expect(row).not.toHaveProperty('dueTodayTetri');
  }
  for (const row of groupOf(x.t, 'due_today')?.rows ?? []) {
    const r = byId.get(row.id.split(':')[1]!)!;
    expect(r.status).toBe('due_today');
    expect(r.overdueDays).toBe(0);
    expect(row).toMatchObject({ days: null, amountTetri: r.debtTetri, dueTodayTetri: r.dueTodayTetri, note: r.pickedUpOn === x.t.today ? 'handed_today' : null });
  }
}

/** A second moped for this customer, asked by a manager and by an owner with no reason. */
async function secondHandOver(customerId: string) {
  const f = await fixtures();
  const body = pickup(customerId, f.vehicle.id);
  const asManager = await call(await loginAs('manager'), 'POST', '/api/pickups', body);
  const asOwner = await call(await loginAs('owner'), 'POST', '/api/pickups', body);
  return { manager: { status: asManager.statusCode, ...err(asManager) }, owner: { status: asOwner.statusCode, ...err(asOwner) } };
}
/** В2 as it stands: any open figure stops a manager and asks an owner for a reason. */
const refused = (owesTetri: number) => ({
  manager: { status: 403, error: 'customer_in_debt', owesTetri },
  owner: { status: 400, error: 'missing_field', field: 'debtOverrideReason', owesTetri },
});

describe.skipIf(!HAS_DB)('the due day · the four cases on every answer', () => {
  it('case 1 — the week began today: due today everywhere, awaited whole, in no overdue total', async () => {
    const owner = await loginAs('owner');
    const manager = await loginAs('manager');
    const before = await totals(owner);
    const f = await running(7);
    const t = today();

    expect(await everywhere(f, owner, manager)).toEqual(everywhereIs('due_today', 0, 15000, 15000, 15000, f.id));

    // The calendar said so already, and says it still.
    const c = await calendar(owner);
    expect(entryOn(c, f.id, t)).toMatchObject({ seq: 2, state: 'due_today', amountTetri: 15000, leftTetri: 15000 });
    expect(lateOf(c, f.id)).toBeUndefined();
    expect(c.rentals.find((r) => r.id === f.id)?.debtTetri).toBe(15000);

    const after = await totals(owner);
    expect(moved(before, after)).toEqual({ ...NOT_LATE, dueTodayGroup: [1, 15000], active: 1 });
    expect(after.s.dueToday.map((r) => r.id)).toContain(f.id);
    expect(after.s.overdueList.map((o) => o.id)).not.toContain(f.id);
    oneSet(after);

    // The right to a second moped is В2, unchanged: the awaited week stops it like any debt.
    expect(await secondHandOver(f.customer.id)).toMatchObject(refused(15000));
  });

  it('case 2 — the week began yesterday: overdue, 1 day, the same day count as the calendar', async () => {
    const owner = await loginAs('owner');
    const manager = await loginAs('manager');
    const before = await totals(owner);
    const f = await running(8);
    const t = today();

    expect(await everywhere(f, owner, manager)).toEqual(everywhereIs('overdue', 1, 15000, 0, 0, f.id));

    const c = await calendar(owner);
    expect(lateOf(c, f.id)).toEqual({ rentalId: f.id, debtTetri: 15000, overdueTetri: 15000, weeks: 1, sinceOn: addDays(t, -1), days: 1 });
    expect(c.rentals.find((r) => r.id === f.id)?.debtTetri).toBe(15000);

    const after = await totals(owner);
    expect(moved(before, after)).toEqual(lateBy(15000));
    expect(after.s.overdueList.find((o) => o.id === f.id)).toMatchObject({ days: 1, debtTetri: 15000 });
    expect(after.s.dueToday.map((r) => r.id)).not.toContain(f.id);
    oneSet(after);

    expect(await secondHandOver(f.customer.id)).toMatchObject(refused(15000));
  });

  it('case 3 — two weeks unpaid, the newer began today: overdue, 7 days, 300 — today’s week is not awaited', async () => {
    const owner = await loginAs('owner');
    const manager = await loginAs('manager');
    const before = await totals(owner);
    const f = await running(14);
    const t = today();

    expect(await everywhere(f, owner, manager)).toEqual(everywhereIs('overdue', 7, 30000, 0, 0, f.id));

    const c = await calendar(owner);
    expect(entryOn(c, f.id, t).state).toBe('overdue');
    expect(lateOf(c, f.id)).toEqual({ rentalId: f.id, debtTetri: 30000, overdueTetri: 30000, weeks: 2, sinceOn: addDays(t, -7), days: 7 });
    expect(c.rentals.find((r) => r.id === f.id)?.debtTetri).toBe(30000);

    const after = await totals(owner);
    expect(moved(before, after)).toEqual(lateBy(30000));
    expect(after.s.overdueList.find((o) => o.id === f.id)).toMatchObject({ days: 7, debtTetri: 30000 });
    oneSet(after);

    expect(await secondHandOver(f.customer.id)).toMatchObject(refused(30000));
  });

  it('case 4 — handed over today, nothing paid: due today like any due day, the deposit awaited with the week', async () => {
    const owner = await loginAs('owner');
    const manager = await loginAs('manager');
    const before = await totals(owner);
    const f = await running(0, LATER);
    const t = today();

    // 330 awaited, 150 of it rent: the deposit of a hand-over day is awaited too, and is not rent.
    expect(await everywhere(f, owner, manager)).toEqual(everywhereIs('due_today', 0, 33000, 33000, 15000, f.id));

    // The calendar holds weeks, never a deposit.
    const c = await calendar(owner);
    expect(entryOn(c, f.id, t)).toMatchObject({ seq: 1, state: 'due_today', amountTetri: 15000, leftTetri: 15000 });
    expect(lateOf(c, f.id)).toBeUndefined();

    const after = await totals(owner);
    expect(moved(before, after)).toEqual({ ...NOT_LATE, dueTodayGroup: [1, 33000], active: 1 });
    expect(after.s.dueToday.map((r) => r.id)).toContain(f.id);
    oneSet(after);
    // When "Today" shows the row, it says the moped left today.
    const row = groupOf(after.t, 'due_today')!.rows.find((r) => r.id === `due_today:${f.id}`);
    if (row) expect(row).toMatchObject({ days: null, amountTetri: 33000, dueTodayTetri: 33000, note: 'handed_today', action: 'take_money' });

    expect(await secondHandOver(f.customer.id)).toMatchObject(refused(33000));
  });

  it('no debt figure moved: the four figures and what they are made of are the ones customerDebt gives', async () => {
    const owner = await loginAs('owner');
    const figure = async (f: Fixture) => {
      const b = await balanceOf(owner, f.customer.id);
      return { owesTetri: b.owesTetri, creditTetri: b.creditTetri, depositHeldTetri: b.depositHeldTetri, parts: b.parts.map((p) => [p.kind, p.id, p.owesTetri]) };
    };
    const one = await running(7);
    expect(await figure(one)).toEqual({ owesTetri: 15000, creditTetri: 0, depositHeldTetri: 18000, parts: [['rent', one.id, 15000]] });
    const two = await running(8);
    expect(await figure(two)).toEqual({ owesTetri: 15000, creditTetri: 0, depositHeldTetri: 18000, parts: [['rent', two.id, 15000]] });
    const three = await running(14);
    expect(await figure(three)).toEqual({ owesTetri: 30000, creditTetri: 0, depositHeldTetri: 18000, parts: [['rent', three.id, 30000]] });
    const four = await running(0, LATER);
    expect(await figure(four)).toEqual({
      owesTetri: 33000,
      creditTetri: 0,
      depositHeldTetri: 0,
      parts: [
        ['rent', four.id, 15000],
        ['deposit', four.id, 18000],
      ],
    });
  });
});

describe.skipIf(!HAS_DB)('the due day · the edges of the rule', () => {
  it('handed over today with the deposit in and the week not: due today, not "overdue · 1 day" on the day it left', async () => {
    const owner = await loginAs('owner');
    const manager = await loginAs('manager');
    const before = await totals(owner);
    const f = await running(0, { payment: { later: false, channel: 'cash', amountTetri: 18000 } });

    expect(await everywhere(f, owner, manager)).toEqual(everywhereIs('due_today', 0, 15000, 15000, 15000, f.id));
    expect(entryOn(await calendar(owner), f.id, today())).toMatchObject({ seq: 1, state: 'due_today', leftTetri: 15000 });
    const after = await totals(owner);
    expect(moved(before, after)).toEqual({ ...NOT_LATE, dueTodayGroup: [1, 15000], active: 1 });
    oneSet(after);
  });

  it('a week part-paid on its first day: due today, and what is left of it is what is awaited', async () => {
    const owner = await loginAs('owner');
    const manager = await loginAs('manager');
    const f = await running(7);
    const paid = await call(owner, 'POST', '/api/payments', { rentalId: f.id, channel: 'cash', grossTetri: 5000 });
    expect(paid.statusCode, paid.body).toBe(201);

    expect(await everywhere(f, owner, manager)).toEqual(everywhereIs('due_today', 0, 10000, 10000, 10000, f.id));
    const c = await calendar(owner);
    expect(entryOn(c, f.id, today())).toMatchObject({ seq: 2, state: 'due_today', paidTetri: 5000, leftTetri: 10000 });
    expect(lateOf(c, f.id)).toBeUndefined();
    oneSet(await totals(owner));
  });

  it('before the night’s roll (today’s week has no row yet): due today with nothing to take, in no group; the roll brings the 150', async () => {
    const owner = await loginAs('owner');
    const manager = await loginAs('manager');
    const before = await totals(owner);
    const f = await running(7);
    await f.prisma.rentalPeriod.deleteMany({ where: { rentalId: f.id, seq: 2 } });
    const t = today();

    // Nothing is owed yet, and nothing reads overdue: the list by "paid through", the calendar by projection.
    expect(await everywhere(f, owner, manager)).toEqual(everywhereIs('due_today', 0, 0, 0, 0, f.id));
    expect(entryOn(await calendar(owner), f.id, t)).toMatchObject({ seq: 2, state: 'due_today', projected: true, amountTetri: 15000 });
    const waiting = await totals(owner);
    expect(moved(before, waiting)).toEqual({ ...NOT_LATE, dueTodayGroup: [0, 0], active: 1 });
    oneSet(waiting);

    const { rollPeriods } = await import('../src/lib/periods.js');
    await rollPeriods(t);
    expect(await everywhere(f, owner, manager)).toEqual(everywhereIs('due_today', 0, 15000, 15000, 15000, f.id));
    // The roll opens weeks for every rental in the shared database, so nothing
    // here is a difference: the row is counted because the sets are one.
    oneSet(await totals(owner));
  });

  it('a rental brought over, due today: the same status, and its row does not say "handed over today"', async () => {
    const owner = await loginAs('owner');
    const manager = await loginAs('manager');
    const before = await totals(owner);
    const t = today();
    const f = await running(7, { odometerKm: undefined, payment: undefined, transfer: { paidThrough: addDays(t, -1), depositReceivedTetri: 18000 } });

    expect(await everywhere(f, owner, manager)).toEqual(everywhereIs('due_today', 0, 15000, 15000, 15000, f.id));
    const after = await totals(owner);
    expect(moved(before, after)).toEqual({ ...NOT_LATE, dueTodayGroup: [1, 15000], active: 1 });
    oneSet(after);
    const row = groupOf(after.t, 'due_today')!.rows.find((r) => r.id === `due_today:${f.id}`);
    if (row) expect(row.note).toBeNull();
  });

  it('never paid, handed over three days ago: 3 days on the list, in the summary and on the calendar', async () => {
    const owner = await loginAs('owner');
    const manager = await loginAs('manager');
    const f = await running(3, LATER);

    expect(await everywhere(f, owner, manager)).toEqual(everywhereIs('overdue', 3, 33000, 0, 0, f.id));
    expect(lateOf(await calendar(owner), f.id)).toMatchObject({ days: 3, sinceOn: addDays(today(), -3) });
    const x = await totals(owner);
    expect(x.s.overdueList.find((o) => o.id === f.id)).toMatchObject({ days: 3, debtTetri: 33000 });
    oneSet(x);
  });

  /**
   * The one known difference from the calendar (note §8.2), pinned so that it
   * is not taken for a defect: a hand-over records only its own payment, and
   * money a customer already has on account is placed by the night's roll
   * alone. Until then the lists say "due today" with the whole sum, while the
   * customer's own figure is already nought and the calendar shows the week
   * paid. It was so under the old names too.
   */
  it('money on account on a hand-over day: the lists wait for the roll, the customer’s figure and the calendar do not', async () => {
    const f = await fixtures();
    const owner = await loginAs('owner');
    const onAccount = await call(owner, 'POST', '/api/payments', { customerId: f.customer.id, channel: 'cash', grossTetri: 33000 });
    expect(onAccount.statusCode, onAccount.body).toBe(201);
    const res = await call(owner, 'POST', '/api/pickups', pickup(f.customer.id, f.vehicle.id, LATER));
    expect(res.statusCode, res.body).toBe(201);
    const { id } = json<{ id: string }>(res);
    const t = today();

    const row = async () => (await list(owner)).find((r) => r.id === id)!;
    expect(await row()).toMatchObject({ status: 'due_today', overdueDays: 0, debtTetri: 33000, dueTodayTetri: 33000 });
    expect(await balanceOf(owner, f.customer.id)).toMatchObject({ owesTetri: 0, dueTodayTetri: 0, dueTodayRentTetri: 0, creditTetri: 0 });
    const entry = entryOn(await calendar(owner), id, t);
    expect(['paid', 'paid_ahead']).toContain(entry.state);
    expect(entry.leftTetri).toBe(0);
    oneSet(await totals(owner));

    const { rollPeriods } = await import('../src/lib/periods.js');
    await rollPeriods(t);
    expect(await row()).toMatchObject({ status: 'active', overdueDays: 0, debtTetri: 0, dueTodayTetri: 0, paidThrough: addDays(t, 6) });
    oneSet(await totals(owner));
  });
});

describe.skipIf(!HAS_DB)('the due day · one customer, two rentals', () => {
  it('one late and one due today: the figure is debt, the awaited part is the second rental’s alone', async () => {
    const owner = await loginAs('owner');
    const manager = await loginAs('manager');
    const a = await running(8);
    // The customer is late, so the second moped is an owner's decision with a reason.
    const b = await second(a.customer.id, 7, { debtOverrideReason: 'test: a second moped' });

    const rows = await list(owner);
    expect(rows.find((r) => r.id === a.id)).toMatchObject({ status: 'overdue', overdueDays: 1, debtTetri: 15000, dueTodayTetri: 0 });
    expect(rows.find((r) => r.id === b.id)).toMatchObject({ status: 'due_today', overdueDays: 0, debtTetri: 15000, dueTodayTetri: 15000 });

    const customers = (await get<{ customers: CustomerRow[] }>(owner, '/api/customers')).customers.find((c) => c.id === a.customer.id)!;
    expect(customers).toMatchObject({ debtTetri: 30000, dueTodayTetri: 15000, dueTodayRentTetri: 15000 });
    expect(Object.fromEntries(customers.openRentals.map((r) => [r.id, r.status]))).toEqual({ [a.id]: 'overdue', [b.id]: 'due_today' });

    const card = await get<CustomerCard>(owner, `/api/customers/${a.customer.id}`);
    expect(card.debt).toMatchObject({ owesTetri: 30000, dueTodayTetri: 15000 });
    expect(Object.fromEntries(card.rentals.map((r) => [r.id, r.status]))).toEqual({ [a.id]: 'overdue', [b.id]: 'due_today' });

    expect(await balanceOf(owner, a.customer.id)).toMatchObject({ owesTetri: 30000, dueTodayTetri: 15000, dueTodayRentTetri: 15000, dueTodayBy: { [b.id]: 15000 } });
    const targets = await get<{ debt: Balance }>(manager, `/api/customers/${a.customer.id}/money-targets`);
    expect(targets.debt.dueTodayBy).toEqual({ [b.id]: 15000 });

    const found = await get<Found>(owner, `/api/search?q=${encodeURIComponent(a.customer.name)}`);
    expect(found.groups.customers.items.find((c) => c.id === a.customer.id)).toMatchObject({ debtTetri: 30000, dueTodayTetri: 15000 });
    expect(found.groups.rentals.items.find((r) => r.id === a.id)).toMatchObject({ debtTetri: 15000, dueTodayTetri: 0 });
    expect(found.groups.rentals.items.find((r) => r.id === b.id)).toMatchObject({ debtTetri: 15000, dueTodayTetri: 15000 });

    expect(await secondHandOver(a.customer.id)).toMatchObject(refused(30000));
    oneSet(await totals(owner));
  });
});

describe.skipIf(!HAS_DB)('the due day · rentals that are not running', () => {
  it.each(['paused', 'disputed'] as const)('%s: called as stored on every answer, in neither group, nothing awaited — late or on its due day', async (how) => {
    const owner = await loginAs('owner');
    const manager = await loginAs('manager');
    const lateOne = await running(8);
    const dueOne = await running(7);
    const before = await totals(owner);
    for (const f of [lateOne, dueOne]) {
      const res = await call(owner, 'POST', `/api/rentals/${f.id}/status`, { status: how, reason: 'test: the moped stands' });
      expect(res.statusCode, res.body).toBe(200);
    }

    // The week that began is still owed — 150 each — and none of it is "awaited today".
    expect(await everywhere(lateOne, owner, manager)).toEqual(everywhereIs(how, 0, 15000, 0, 0, lateOne.id));
    expect(await everywhere(dueOne, owner, manager)).toEqual(everywhereIs(how, 0, 15000, 0, 0, dueOne.id));

    const after = await totals(owner);
    expect(moved(before, after)).toEqual({ overdueGroup: [-1, -15000], tile: -15000, week: [-1, -15000], summary: [-1, -15000], listLate: [-1, -15000], dueTodayGroup: [-1, -15000], active: -1 });
    oneSet(after);
  });

  it('returned — yesterday’s week or today’s: "returned" everywhere, nothing awaited whatever the return leaves owed', async () => {
    const owner = await loginAs('owner');
    const lateOne = await running(8);
    const dueOne = await running(7);
    const before = await totals(owner);
    for (const f of [lateOne, dueOne]) {
      const back = await call(owner, 'POST', `/api/rentals/${f.id}/return`, { odometerKm: 150, items: items() });
      expect(back.statusCode, back.body).toBe(200);
    }

    for (const f of [lateOne, dueOne]) {
      const row = (await list(owner)).find((r) => r.id === f.id)!;
      expect(row).toMatchObject({ status: 'returned', overdueDays: 0, dueTodayTetri: 0 });
      const card = await get<Card>(owner, `/api/rentals/${f.id}`);
      expect(card.rental).toMatchObject({ status: 'returned', dueTodayTetri: 0, debtTetri: row.debtTetri });
      const customer = await get<CustomerCard>(owner, `/api/customers/${f.customer.id}`);
      expect(customer.rentals.find((r) => r.id === f.id)?.status).toBe('returned');
      expect(customer.debt.dueTodayTetri).toBe(0);
      const customers = (await get<{ customers: CustomerRow[] }>(owner, '/api/customers')).customers.find((c) => c.id === f.customer.id)!;
      expect(customers).toMatchObject({ dueTodayTetri: 0, dueTodayRentTetri: 0, openRentals: [] });
      const vehicle = await get<{ rentals: { id: string; status: string }[] }>(owner, `/api/fleet/${f.vehicle.id}`);
      expect(vehicle.rentals.find((r) => r.id === f.id)?.status).toBe('returned');
      expect(await balanceOf(owner, f.customer.id)).toMatchObject({ dueTodayTetri: 0, dueTodayRentTetri: 0, dueTodayBy: {} });
    }
    // Returned on its due day: the week that began today is still on the card, unpaid — debt, not awaited.
    const card = await get<Card>(owner, `/api/rentals/${dueOne.id}`);
    expect(card.periods.find((p) => p.startsOn === today())).toMatchObject({ seq: 2, amountTetri: 15000, paidTetri: 0 });

    const after = await totals(owner);
    expect(moved(before, after)).toMatchObject({ overdueGroup: [-1, -15000], tile: -15000, week: [-1, -15000], summary: [-1, -15000], listLate: [-1, -15000], dueTodayGroup: [-1, -15000] });
    oneSet(after);
  });
});

describe.skipIf(!HAS_DB)('the due day · who sees what', () => {
  it('a manager gets both groups with their sums and cash as the action, and no figure more than before', async () => {
    const owner = await loginAs('owner');
    const manager = await loginAs('manager');
    await running(7);
    await running(8);

    const mine = await get<Today>(manager, '/api/today');
    const theirs = await get<Today>(owner, '/api/today');
    for (const name of ['overdue', 'due_today']) {
      const g = groupOf(mine, name)!;
      // The same rentals and the same money an owner sees in the group.
      expect([g.total, g.totalTetri]).toEqual([groupOf(theirs, name)!.total, groupOf(theirs, name)!.totalTetri]);
      expect(g.rows.length).toBeGreaterThan(0);
      expect(g.rows.every((r) => r.action === 'take_cash')).toBe(true);
    }
    expect(groupOf(theirs, 'due_today')!.rows.every((r) => r.action === 'take_money')).toBe(true);
    // "Due today" stands right after "overdue".
    const order = mine.queue.map((g) => g.group);
    expect(order.indexOf('due_today')).toBe(order.indexOf('overdue') + 1);

    // The overdue total stays an owner's, and "Today" has no new number for anybody.
    expect(mine.numbers.overdueTetri).toBeNull();
    expect(Object.keys(mine.numbers).sort()).toEqual(['batteries', 'depositsHeldTetri', 'fleet', 'myTillTetri', 'overdueTetri', 'week']);
    expect(Object.keys(theirs.numbers).sort()).toEqual(['batteries', 'depositsHeldTetri', 'fleet', 'myTillTetri', 'overdueTetri', 'week']);

    // The calendar and the week's report stay behind their permissions.
    expect(err(await call(manager, 'GET', '/api/money/calendar'))).toMatchObject({ error: 'forbidden', permission: 'payments.view' });
    expect((await call(manager, 'GET', '/api/reports/week')).statusCode).toBe(403);
  });

  it('the week’s report prints, with a rental due today present and not in its overdue line', async () => {
    const owner = await loginAs('owner');
    const before = await get<Week>(owner, '/api/reports/week');
    await running(7);
    const after = await get<Week>(owner, '/api/reports/week');
    expect([after.rentals.overdueCount, after.rentals.overdueTetri]).toEqual([before.rentals.overdueCount, before.rentals.overdueTetri]);
    const pdf = await call(owner, 'GET', '/api/reports/week.pdf');
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('no third WhatsApp text is taken: the approved two, and nothing for "today" until the owner has read it', async () => {
    const f = await running(7);
    const said = (template: string) => call(f.owner, 'POST', `/api/rentals/${f.id}/whatsapp`, { template, lang: 'ka' });
    const refusedText = await said('today');
    expect(refusedText.statusCode).toBe(400);
    expect(err(refusedText)).toMatchObject({ error: 'bad_field', field: 'template' });
    expect((await said('overdue')).statusCode).toBe(200);
    expect((await said('tomorrow')).statusCode).toBe(200);
    const logged = await f.prisma.auditLog.findMany({ where: { entityId: f.id, action: 'rental.whatsapp' } });
    expect(logged.map((l) => (l.after as { template: string }).template).sort()).toEqual(['overdue', 'tomorrow']);
  });
});
