// Paying the mechanic (stage 5 of docs/spec/mechanic-in-erp-plan.md; ADR-0037):
// the money of a repair's work, rounded once per repair; what a repair cost;
// where a repair stands for paying. The figures are the bot's control and
// invented lines, at the company's rate of 50 ₾ an hour.
import { describe, expect, it } from 'vitest';
import {
  LABOUR_RATE_TETRI,
  approvedWorksTetri,
  jobPayState,
  repairTotalTetri,
  workLineTetri,
  worksTotal,
  type WorkMoneyLine,
} from '../src/index.js';

const NOW = new Date('2026-10-20T10:00:00Z');

/** An approved line of work at the company's rate. */
function line(normSec: number | null, qty = 1, extra: Partial<WorkMoneyLine> = {}): WorkMoneyLine {
  return { qty, normSec, rateTetri: LABOUR_RATE_TETRI, approvedAt: NOW, rejectedAt: null, ...extra };
}

/** The bot's control week: seven repairs, 282.5 minutes in all. */
const CONTROL: WorkMoneyLine[][] = [
  [line(1800)],
  [line(1200)],
  [line(1200)],
  [line(150, 3)],
  [line(3600)],
  [line(1800)],
  [line(900), line(1200), line(1200), line(2400), line(1200)],
];

describe('the work of a repair, rounded once per repair (ADR-0037 §8)', () => {
  it('gives the bot’s control figure: seven repairs, 235.42 ₾', () => {
    const perJob = CONTROL.map((works) => approvedWorksTetri(works));
    expect(perJob).toEqual([2500, 1667, 1667, 625, 5000, 2500, 9583]);
    expect(perJob.reduce((a, b) => a + b, 0)).toBe(23542);
    expect(worksTotal(CONTROL.flat()).seconds).toBe(282.5 * 60);
  });

  it('is not the sum of lines rounded one by one, which comes a tetri over', () => {
    const perLine = CONTROL.flat().reduce((n, l) => n + (workLineTetri(l) ?? 0), 0);
    expect(perLine).toBe(23543);
  });

  it('may part from the bot’s one rounding by a tetri, and that is reported, not adjusted', () => {
    // Two repairs of one OT-01 (2.5 min) each: 208.33 → 208 twice; the bot rounds 416.67 once.
    const twoJobs = [[line(150)], [line(150)]].map((works) => approvedWorksTetri(works));
    expect(twoJobs).toEqual([208, 208]);
    expect(twoJobs[0]! + twoJobs[1]!).toBe(416);
    expect(worksTotal([line(150), line(150)]).tetri).toBe(417);
  });

  it('counts only approved lines with a norm', () => {
    const works = [
      line(1800),
      line(1800, 1, { approvedAt: null }), // waiting
      line(1800, 1, { approvedAt: null, rejectedAt: NOW }), // refused
      line(null), // approved, no norm yet
    ];
    expect(approvedWorksTetri(works)).toBe(2500);
    expect(approvedWorksTetri([])).toBe(0);
  });
});

describe('what a repair cost (ADR-0037 §6)', () => {
  const parts = [
    { kind: 'stock', qty: 2, unitPriceTetri: 1200 },
    // A receipt is already the repair's through its line: not added a second time.
    { kind: 'bought', qty: 1, unitPriceTetri: 0, paidTetri: 1800, rejectedAt: null },
  ];
  const works = [line(1800), line(1200)];

  it('the company’s repair: the hours, the parts and the approved work', () => {
    expect(repairTotalTetri({ status: 'done', payer: 'company', labourTetri: 1000, parts, works })).toBe(1000 + 2400 + 1800 + 4167);
    expect(repairTotalTetri({ status: 'open', payer: 'company', labourTetri: 0, parts: [], works })).toBe(4167);
  });

  it('the customer’s repair: what the owner typed and the parts, never the mechanic’s work', () => {
    expect(repairTotalTetri({ status: 'done', payer: 'customer', labourTetri: 1000, parts, works })).toBe(1000 + 2400 + 1800);
  });

  it('a repair called off cost no work', () => {
    expect(repairTotalTetri({ status: 'cancelled', payer: 'company', labourTetri: 0, parts, works })).toBe(2400 + 1800);
  });

  it('work waiting, refused or without a norm adds nothing', () => {
    const none = [line(1800, 1, { approvedAt: null }), line(1800, 1, { approvedAt: null, rejectedAt: NOW }), line(null)];
    expect(repairTotalTetri({ status: 'done', payer: 'company', labourTetri: 0, parts: [], works: none })).toBe(0);
  });
});

describe('where a repair stands for paying its mechanic (ADR-0037 §2)', () => {
  const approved = { normSec: 1800, approvedAt: NOW, rejectedAt: null };
  const bought = { kind: 'bought', approvedAt: NOW, rejectedAt: null };
  const base = { status: 'done', paidInPayoutId: null, works: [approved], parts: [bought] };

  it('closed, every line decided and normed: payable', () => {
    expect(jobPayState(base)).toBe('payable');
    // A refused line, or a part off the shelf, does not hold it back.
    expect(jobPayState({ ...base, works: [approved, { normSec: null, approvedAt: null, rejectedAt: NOW }], parts: [{ kind: 'stock', approvedAt: null, rejectedAt: null }] })).toBe('payable');
  });

  it('paid once it names its payout', () => {
    expect(jobPayState({ ...base, paidInPayoutId: 'payout-1' })).toBe('paid');
  });

  it('called off: never paid, whatever it carries', () => {
    expect(jobPayState({ ...base, status: 'cancelled' })).toBe('cancelled');
    expect(jobPayState({ ...base, status: 'cancelled', paidInPayoutId: 'payout-1' })).toBe('cancelled');
  });

  it('waiting: a draft, a work or a bought part with no decision', () => {
    expect(jobPayState({ ...base, status: 'draft' })).toBe('waiting');
    expect(jobPayState({ ...base, status: 'open', works: [approved, { normSec: 600, approvedAt: null, rejectedAt: null }] })).toBe('waiting');
    expect(jobPayState({ ...base, parts: [{ kind: 'bought', approvedAt: null, rejectedAt: null }] })).toBe('waiting');
  });

  it('in work: open', () => {
    expect(jobPayState({ ...base, status: 'open' })).toBe('open');
  });

  it('closed with an approved work that has no norm: not payable until it has one', () => {
    expect(jobPayState({ ...base, works: [approved, { normSec: null, approvedAt: NOW, rejectedAt: null }] })).toBe('unnormed');
  });
});
