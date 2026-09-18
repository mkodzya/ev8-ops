import { describe, expect, it } from 'vitest';
import { customerDebt, depositState } from '../src/index.js';

// The one debt figure (B7-02, wave 2 §3.7).
const base = { today: '2026-09-18', rentals: [], sales: [], repairs: [], unplacedTetri: 0, depositHeldTetri: 0 };
const rental = (over: Partial<Parameters<typeof customerDebt>[0]['rentals'][number]> = {}) => ({
  id: 'r1',
  number: 'R-1',
  open: true,
  periods: [
    { startsOn: '2026-09-11', amountTetri: 15000, paidTetri: 15000 },
    { startsOn: '2026-09-18', amountTetri: 15000, paidTetri: 0 },
    { startsOn: '2026-09-25', amountTetri: 15000, paidTetri: 0 },
  ],
  deposit: { amountTetri: 18000, paidTetri: 10000 },
  ...over,
});

describe('customerDebt', () => {
  it('owes the weeks begun and an unpaid deposit, not a week still ahead', () => {
    const d = customerDebt({ ...base, rentals: [rental()] });
    expect(d.owesTetri).toBe(15000 + 8000);
    expect(d.parts.map((p) => p.kind)).toEqual(['rent', 'deposit']);
  });

  it('keeps future instalments apart, and a bought-back sale owes nothing (Q21, M8)', () => {
    const sale = (status: 'active' | 'bought_back') => ({
      id: 's1',
      number: 'SL-1',
      status,
      instalments: [
        { dueOn: '2026-09-01', amountTetri: 139600, paidTetri: 0 },
        { dueOn: '2026-10-01', amountTetri: 139600, paidTetri: 0 },
      ],
    });
    const active = customerDebt({ ...base, sales: [sale('active')] });
    expect(active).toMatchObject({ owesTetri: 139600, aheadTetri: 139600 });
    expect(customerDebt({ ...base, sales: [sale('bought_back')] }).owesTetri).toBe(0);
  });

  it('takes money on account off the figure, and shows what is left over as credit', () => {
    expect(customerDebt({ ...base, rentals: [rental()], unplacedTetri: 3000 }).owesTetri).toBe(20000);
    expect(customerDebt({ ...base, rentals: [rental()], unplacedTetri: 25000 })).toMatchObject({ owesTetri: 0, creditTetri: 2000 });
  });

  it('a returned rental owes its unpaid weeks, and its deposit is the decision’s, not a debt', () => {
    expect(customerDebt({ ...base, rentals: [rental({ open: false })] }).owesTetri).toBe(15000);
  });
});

describe('depositState', () => {
  it('holds what came in less what was kept and handed back', () => {
    expect(depositState({ amountTetri: 18000, paidTetri: 18000, returnedTetri: 18000, withheldTetri: 0, paidOutTetri: 0 })).toEqual({ heldTetri: 18000, toHandBackTetri: 18000, shortTetri: 0 });
    expect(depositState({ amountTetri: 18000, paidTetri: 10000, returnedTetri: 0, withheldTetri: 0, paidOutTetri: 0 })).toMatchObject({ heldTetri: 10000, shortTetri: 8000 });
  });
});
