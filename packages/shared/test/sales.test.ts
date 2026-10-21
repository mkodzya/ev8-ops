// The company's own credit (wave 5 §3.1–3.3, `sales.md`): what the schedule
// comes to, where it stands today, and what a buy-back closes.
import { describe, expect, it } from 'vitest';
import { addMonths, applyPaidBefore, buyback, instalmentSchedule, redateSale, saleState, scheduleGap, warrantyUntil } from '../src/index.js';

describe('the schedule of a sale', () => {
  it('is a down payment on the day and N months after it (SAL-02, crit. 1)', () => {
    const rows = instalmentSchedule({ soldOn: '2026-09-18', priceTetri: 520000, downPaymentTetri: 100000, months: 3 });
    expect(rows.map((r) => [r.dueOn, r.amountTetri])).toEqual([
      ['2026-09-18', 100000],
      ['2026-10-18', 140000],
      ['2026-11-18', 140000],
      ['2026-12-18', 140000],
    ]);
    expect(scheduleGap(520000, rows)).toBe(0);
  });

  it('takes the last day of a month too short for the day of the sale', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-08-31', 1)).toBe('2026-09-30');
  });

  it('runs the warranty for a year (`sales.md`)', () => {
    expect(warrantyUntil('2026-09-18')).toBe('2027-09-18');
  });

  it('says how far an edited schedule is from the price (crit. 4)', () => {
    const rows = [
      { seq: 1, dueOn: '2026-09-18', amountTetri: 100000 },
      { seq: 2, dueOn: '2026-10-18', amountTetri: 150000 },
    ];
    expect(scheduleGap(300000, rows)).toBe(-50000);
    expect(scheduleGap(200000, rows)).toBe(50000);
    // QA-W6-13: four lari over the price after a last instalment was rounded
    // by hand. Allowed, but the screens have to say it — the card and the
    // sheet both read this rule.
    expect(scheduleGap(518800, [{ amountTetri: 389400 }, { amountTetri: 140000 }])).toBe(10600);
    expect(scheduleGap(518800, [{ amountTetri: 378800 }, { amountTetri: 140000 }])).toBe(0);
  });
});

describe('where a sale stands', () => {
  const rows = [
    { seq: 1, dueOn: '2026-06-15', amountTetri: 100000, paidTetri: 100000 },
    { seq: 2, dueOn: '2026-07-15', amountTetri: 139600, paidTetri: 139600 },
    { seq: 3, dueOn: '2026-08-15', amountTetri: 139600, paidTetri: 0 },
    { seq: 4, dueOn: '2026-09-15', amountTetri: 139600, paidTetri: 0 },
  ];

  it('separates what is owed now from what is still ahead (Q21)', () => {
    const state = saleState({ today: '2026-09-01', status: 'active', instalments: rows });
    expect(state.owesTetri).toBe(139600);
    expect(state.aheadTetri).toBe(139600);
    expect(state.paidTetri).toBe(239600);
    expect(state.worstDays).toBe(17);
    expect(state.rows.map((r) => r.state)).toEqual(['paid', 'paid', 'overdue', 'ahead']);
  });

  it('owes nothing once the moped is bought back (M8, crit. 6)', () => {
    const state = saleState({ today: '2026-09-18', status: 'bought_back', instalments: rows });
    expect(state.owesTetri).toBe(0);
    expect(state.aheadTetri).toBe(0);
    // The head said "Долг 0 · Впереди 0" while the rows still read "впереди"
    // and "просрочен": a settled row is neither (QA-W5-07).
    expect(state.rows.map((r) => r.state)).toEqual(['paid', 'paid', 'closed', 'closed']);
    expect(state.worstDays).toBe(0);
  });

  it('an instalment due today is due, and nobody is late by nothing (QA-W5-05)', () => {
    const state = saleState({ today: '2026-08-15', status: 'active', instalments: rows });
    const today = state.rows.find((r) => r.seq === 3)!;
    expect(today.state).toBe('overdue');
    expect(today.days).toBe(0);
  });

  it('closes carried-over instalments from the oldest (B3-03, crit. 5)', () => {
    const schedule = instalmentSchedule({ soldOn: '2026-06-15', priceTetri: 518800, downPaymentTetri: 100000, months: 3 });
    const paid = applyPaidBefore(schedule, 239600);
    expect(paid.map((p) => p.paidTetri)).toEqual([100000, 139600, 0, 0]);
  });
});

describe('buying a moped back', () => {
  it('writes off what is left of the schedule and pays out separately (Q20, B7-01)', () => {
    const result = buyback({
      instalments: [
        { amountTetri: 100000, paidTetri: 100000 },
        { amountTetri: 139600, paidTetri: 0 },
        { amountTetri: 139600, paidTetri: 0 },
      ],
      buybackTetri: 80000,
    });
    expect(result).toEqual({ paidTetri: 100000, writeOffTetri: 279200, payoutTetri: 80000 });
  });
});

// A sale entered on the wrong day (call of 21.10.2026: the date could not be
// edited, so the sale was cancelled and entered again). What was worked out
// from the day follows it; what a person set by hand keeps its own logic.
describe('a sale dated wrong, put right', () => {
  const lines = (soldOn: string) =>
    instalmentSchedule({ soldOn, priceTetri: 400000, downPaymentTetri: 100000, months: 3 }).map((r) => ({ seq: r.seq, dueOn: r.dueOn }));

  it('builds the schedule the right day would have built, month ends included', () => {
    // Sold on the 31st: February has no 31st, so the first instalment was the
    // 28th. Moved to the 28th, a shift of three days would put it on the 25th;
    // the schedule of a sale made on the 28th is the 28th of every month.
    const plan = redateSale({ soldOn: '2026-01-31', warrantyUntil: '2027-01-31', transferred: false, instalments: lines('2026-01-31') }, '2026-01-28');
    expect(plan.instalments).toEqual([
      { seq: 1, from: '2026-01-31', to: '2026-01-28' },
      { seq: 3, from: '2026-03-31', to: '2026-03-28' },
      { seq: 4, from: '2026-04-30', to: '2026-04-28' },
    ]);
    // The 28th of February stays where it was, and is not listed as a move.
    const after = lines('2026-01-31').map((l) => plan.instalments.find((m) => m.seq === l.seq)?.to ?? l.dueOn);
    expect(after).toEqual(lines('2026-01-28').map((l) => l.dueOn));
  });

  it('moves a line set by hand by the same number of days, and a paid line like any other', () => {
    const plan = redateSale(
      {
        soldOn: '2026-05-19',
        warrantyUntil: '2027-05-19',
        transferred: false,
        // The second line was moved to the 25th by hand; the first is paid —
        // which this rule is not even told, because money is not the date.
        instalments: [
          { seq: 1, dueOn: '2026-05-19' },
          { seq: 2, dueOn: '2026-06-25' },
          { seq: 3, dueOn: '2026-07-19' },
        ],
      },
      '2026-05-16',
    );
    expect(plan.instalments).toEqual([
      { seq: 1, from: '2026-05-19', to: '2026-05-16' },
      { seq: 2, from: '2026-06-25', to: '2026-06-22' },
      { seq: 3, from: '2026-07-19', to: '2026-07-16' },
    ]);
  });

  it('keeps the schedule of a sale carried over from paper (B3-03)', () => {
    const plan = redateSale({ soldOn: '2026-03-10', warrantyUntil: '2027-03-10', transferred: true, instalments: lines('2026-03-10') }, '2026-03-08');
    expect(plan.instalments).toEqual([]);
    expect(plan.warrantyUntil).toBe('2027-03-08');
  });

  it('moves the twelve months of warranty with the date, and leaves one set by hand (`sales.md`)', () => {
    expect(redateSale({ soldOn: '2026-10-14', warrantyUntil: warrantyUntil('2026-10-14'), transferred: false, instalments: [] }, '2026-10-12').warrantyUntil).toBe('2027-10-12');
    expect(redateSale({ soldOn: '2026-10-14', warrantyUntil: '2027-04-14', transferred: false, instalments: [] }, '2026-10-12').warrantyUntil).toBe('2027-04-14');
    expect(redateSale({ soldOn: '2026-10-14', warrantyUntil: null, transferred: false, instalments: [] }, '2026-10-12').warrantyUntil).toBeNull();
  });

  it('moves nothing when the day is the same, and works forwards as well as back', () => {
    expect(redateSale({ soldOn: '2026-10-14', warrantyUntil: '2027-10-14', transferred: false, instalments: lines('2026-10-14') }, '2026-10-14')).toEqual({
      warrantyUntil: '2027-10-14',
      instalments: [],
    });
    const later = redateSale({ soldOn: '2026-10-12', warrantyUntil: '2027-10-12', transferred: false, instalments: [{ seq: 1, dueOn: '2026-10-12' }] }, '2026-10-14');
    expect(later).toEqual({ warrantyUntil: '2027-10-14', instalments: [{ seq: 1, from: '2026-10-12', to: '2026-10-14' }] });
  });
});
