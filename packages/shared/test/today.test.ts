// The queue of "Today" (wave 4 §3.1, criteria 1–6, 10, 11).
import { describe, expect, it } from 'vitest';
import { dayQueue, queueCount, type QueueInput, type QueueRental } from '../src/index.js';

const TODAY = '2026-09-20';

const rental = (over: Partial<QueueRental> = {}): QueueRental => ({
  id: 'r1',
  number: 'R-00001',
  customer: { id: 'c1', name: 'ТЕСТ Клиент', phone: '+995555000001' },
  vin: 'TEST0000000000001',
  pickedUpOn: '2026-09-01',
  expectedReturnOn: null,
  paidThrough: '2026-09-17',
  status: 'overdue',
  debtTetri: 15000,
  dueTodayTetri: 0,
  depositUndecided: false,
  vinUnconfirmed: false,
  contractUnsigned: false,
  ...over,
});

const input = (over: Partial<QueueInput> = {}): QueueInput => ({
  today: TODAY,
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

// Wave 6 §3.7 — the answer to the tester's question of wave 3.
describe('deposits the transfer brought over', () => {
  it('stand in one row with their count and their money, not one row each (crit. 26)', () => {
    const q = dayQueue(input({ odooDeposits: { count: 23, amountTetri: 409000 } }));
    const decide = group(q, 'decide')!;
    expect(decide.rows).toHaveLength(1);
    expect(decide.rows[0]).toMatchObject({ action: 'sort_odoo_deposits', days: 23, amountTetri: 409000, href: '/settings/migration' });
  });

  it('leave the queue entirely once they are sorted', () => {
    expect(group(dayQueue(input({ odooDeposits: { count: 0, amountTetri: 0 } })), 'decide')).toBeUndefined();
  });

  it('stand before the deposits this week\'s own returns left, and a manager sees neither', () => {
    const left = rental({ depositUndecided: true });
    const q = dayQueue(input({ rentals: [left], odooDeposits: { count: 23, amountTetri: 409000 } }));
    expect(group(q, 'decide')!.rows.map((r) => r.action)).toEqual(['sort_odoo_deposits', 'decide_deposit']);
    expect(group(dayQueue(input({ owner: false, odooDeposits: { count: 23, amountTetri: 409000 } })), 'decide')).toBeUndefined();
  });
});

describe('the queue of “Today”', () => {
  it('puts an overdue rental in its group with the days and the debt, longest first (crit. 1)', () => {
    const q = dayQueue(input({ rentals: [rental(), rental({ id: 'r2', number: 'R-00002', paidThrough: '2026-09-10', debtTetri: 30000 })] }));
    const overdue = group(q, 'overdue')!;
    expect(overdue.rows.map((r) => r.number)).toEqual(['R-00002', 'R-00001']);
    // Paid through 10.09: the week was due on the 11th, and the 20th is its ninth late day (ADR-0017).
    expect(overdue.rows[0]).toMatchObject({ days: 9, amountTetri: 30000, action: 'take_money' });
    expect(overdue.rows[1]).toMatchObject({ days: 2, amountTetri: 15000 });
    expect(overdue.totalTetri).toBe(45000);
  });

  it('a rental due today stands in its own group, not in “overdue” (crit. 2; ADR-0017)', () => {
    const q = dayQueue(input({ rentals: [rental({ status: 'due_today', paidThrough: null, pickedUpOn: TODAY, debtTetri: 33000, dueTodayTetri: 33000 })] }));
    expect(group(q, 'overdue')).toBeUndefined();
    // Handed over today with nothing paid: the week and the deposit, awaited whole.
    expect(group(q, 'due_today')!.rows[0]).toMatchObject({ number: 'R-00001', amountTetri: 33000, dueTodayTetri: 33000, days: null, note: 'handed_today', action: 'take_money' });
  });

  it('gives an owner the deposit a manager’s return left, and a manager nothing of it (crit. 3)', () => {
    const left = rental({ status: 'returned', depositUndecided: true, debtTetri: 0 });
    expect(group(dayQueue(input({ rentals: [left] })), 'decide')!.rows[0]).toMatchObject({ action: 'decide_deposit', href: '/rentals/r1?decide=1' });
    expect(group(dayQueue(input({ owner: false, rentals: [left] })), 'decide')).toBeUndefined();
  });

  it('shows three rows and counts the rest (crit. 6, 11)', () => {
    const rentals = [1, 2, 3, 4, 5].map((n) => rental({ id: `r${n}`, number: `R-0000${n}`, paidThrough: `2026-09-1${n}`, debtTetri: 15000 }));
    const q = dayQueue(input({ rentals }));
    const overdue = group(q, 'overdue')!;
    expect(overdue.rows).toHaveLength(3);
    expect(overdue.total).toBe(5);
    expect(overdue.totalTetri).toBe(75000);
    expect(queueCount(q)).toBe(5);
  });

  it('leaves a manager without the owners’ groups, and gives them their own till (crit. 10)', () => {
    const q = dayQueue(
      input({
        owner: false,
        myTillTetri: 12000,
        unmatchedLines: 4,
        staleBanks: [{ bank: 'bog', days: 9 }],
        purchases: [{ id: 'p1', number: 'PO-00001', who: 'Factory', note: 'ordered' }],
        vehiclesWithoutPool: 2,
        rentals: [rental()],
      }),
    );
    // A manager has no "decide": their own cash is a group of its own, last (QA-W4-11).
    expect(q.map((g) => g.group)).toEqual(['overdue', 'till']);
    expect(group(q, 'till')!.rows[0]).toMatchObject({ action: 'hand_over_till', amountTetri: 12000 });
    expect(group(q, 'overdue')!.rows[0].action).toBe('take_cash');
  });

  it('puts a till handed over above the deposits an owner has not decided (crit. 4, QA-W4-12)', () => {
    const deposits = [1, 2, 3, 4].map((n) => rental({ id: `r${n}`, number: `R-0000${n}`, status: 'returned', depositUndecided: true, debtTetri: 0 }));
    const q = dayQueue(input({ rentals: deposits, tills: [{ id: 'h1', who: 'Demo Manager', amountTetri: 16000 }] }));
    const decide = group(q, 'decide')!;
    expect(decide.rows[0]).toMatchObject({ action: 'accept_till', who: 'Demo Manager', amountTetri: 16000, href: '/money/cash' });
    expect(decide.total).toBe(5);
    expect(decide.rows.slice(1).every((r) => r.action === 'decide_deposit')).toBe(true);
  });

  it('says the return is due, and how many days it is late (crit. 5)', () => {
    const q = dayQueue(input({ rentals: [rental({ expectedReturnOn: '2026-09-18', debtTetri: 0, status: 'active' })] }));
    expect(group(q, 'returns')!.rows[0]).toMatchObject({ days: 2, action: 'return' });
    const returned = dayQueue(input({ rentals: [rental({ status: 'returned', expectedReturnOn: '2026-09-18', debtTetri: 0 })] }));
    expect(group(returned, 'returns')).toBeUndefined();
  });

  it('asks for what is not filled in: an unsigned contract, a rental without a VIN, mopeds without a point (crit. 15)', () => {
    const q = dayQueue(input({ rentals: [rental({ contractUnsigned: true, debtTetri: 0, status: 'active' }), rental({ id: 'r2', number: 'R-00002', vinUnconfirmed: true, debtTetri: 0, status: 'active' })], vehiclesWithoutPoint: 3 }));
    const fill = group(q, 'fill')!;
    expect(fill.rows.map((r) => r.action)).toEqual(['sign', 'set_vin', 'set_point']);
    expect(fill.rows[2].note).toBe('3');
  });

  it('says the repairs in one line (В8, crit. 9)', () => {
    const q = dayQueue(input({ service: { open: 10, longerThanWeek: 4, longestDays: 21 } }));
    expect(group(q, 'service')!.rows[0]).toMatchObject({ note: '10/4', days: 21, action: 'open_service' });
  });

  it('is empty when nothing waits (crit. 13)', () => {
    expect(dayQueue(input())).toEqual([]);
    expect(queueCount([])).toBe(0);
  });
});

describe('the battery count (wave 4 §3.8, D16)', () => {
  it('takes the stocktake and moves it on: couriers from the acts, losses off the total (crit. 29, 31)', async () => {
    const { batteryCount } = await import('../src/index.js');
    const inventory = { countedOn: '2026-09-01', showroomQty: 7, repairQty: 1, couriersQty: 34, totalQty: 42 };
    expect(batteryCount({ inventory, movesSince: [], couriersNow: 34 })).toEqual({ total: 42, couriers: 34, repair: 1, showroom: 7 });
    // Two more went out with a hand-over, one was lost on a return.
    expect(batteryCount({ inventory, movesSince: [{ kind: 'lost', qty: 1 }], couriersNow: 36 })).toEqual({ total: 41, couriers: 36, repair: 1, showroom: 4 });
    // Two to repair and one back.
    expect(batteryCount({ inventory, movesSince: [{ kind: 'to_repair', qty: 2 }, { kind: 'from_repair', qty: 1 }], couriersNow: 34 })).toEqual({ total: 42, couriers: 34, repair: 2, showroom: 6 });
  });

  it('counts nothing until somebody counts (no stocktake yet)', async () => {
    const { batteryCount } = await import('../src/index.js');
    expect(batteryCount({ inventory: null, movesSince: [], couriersNow: 10 })).toEqual({ total: 0, couriers: 0, repair: 0, showroom: 0 });
  });
});
