// Goods sold over the counter (issue #11, ADR-0045; Mika 23.10.2026 «А»):
// the price is final with VAT inside, and the session's defaults of
// docs/spec/goods-sales.md §1 are rules a test can put a number into.
import { describe, expect, it } from 'vitest';
import {
  GOODS_MAX_LINES,
  SELLABLE_COUNTED,
  cancelPlan,
  countedName,
  customerDebt,
  dueTodayOf,
  goodsEconomics,
  goodsLineNets,
  goodsSaleState,
  goodsTotals,
  needsCountAnswer,
  paymentProblem,
  priceEdited,
  stockDecision,
  type GoodsEconomicsLine,
} from '../src/index.js';

describe('the VAT inside a goods price (Mika «А», 23.10.2026)', () => {
  it('takes 18 % out of the total once: 100 ₾ = 84.75 + 15.25', () => {
    expect(goodsTotals([{ qty: 1, unitPriceTetri: 100_00 }])).toEqual({ grossTetri: 100_00, netTetri: 84_75, vatTetri: 15_25 });
  });

  it('35 ₾ = 29.66 + 5.34, and three at 33.33 are taken from 99.99 whole', () => {
    expect(goodsTotals([{ qty: 1, unitPriceTetri: 35_00 }])).toEqual({ grossTetri: 35_00, netTetri: 29_66, vatTetri: 5_34 });
    expect(goodsTotals([{ qty: 3, unitPriceTetri: 33_33 }])).toEqual({ grossTetri: 99_99, netTetri: 84_74, vatTetri: 15_25 });
  });

  it('is nought for nothing', () => {
    expect(goodsTotals([])).toEqual({ grossTetri: 0, netTetri: 0, vatTetri: 0 });
  });

  it('never loses a tetri between the net and the VAT', () => {
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    for (let k = 0; k < 1000; k++) {
      const lines = Array.from({ length: 1 + rnd(5) }, () => ({ qty: 1 + rnd(9), unitPriceTetri: 1 + rnd(50_000) }));
      const t = goodsTotals(lines);
      expect(t.netTetri + t.vatTetri).toBe(t.grossTetri);
      const nets = goodsLineNets(lines);
      expect(nets.reduce((n, x) => n + x, 0)).toBe(t.netTetri);
    }
  });

  it('shares the net over the lines by the largest remainder, adding up to the sale', () => {
    const three = [33_33, 33_33, 33_33].map((p) => ({ qty: 1, unitPriceTetri: p }));
    expect(goodsLineNets(three)).toEqual([28_25, 28_25, 28_24]);
    expect(goodsLineNets([{ qty: 1, unitPriceTetri: 100_00 }])).toEqual([84_75]);
  });
});

describe('where a sale\'s money stands', () => {
  const s = (over: Partial<Parameters<typeof goodsSaleState>[0]>) => goodsSaleState({ status: 'active', totalTetri: 100_00, paidTetri: 0, promisedChannel: null, retail: false, ...over });

  it('is paid when nothing is open', () => {
    expect(s({ paidTetri: 100_00 })).toEqual({ state: 'paid', openTetri: 0 });
  });

  it('waits for the bank when the rest was promised by card or transfer', () => {
    expect(s({ retail: true, promisedChannel: 'acquiring' })).toEqual({ state: 'waiting_bank', openTetri: 100_00 });
  });

  it('is an own customer\'s debt when nobody promised the bank', () => {
    expect(s({ paidTetri: 55_00 })).toEqual({ state: 'owes', openTetri: 45_00 });
  });

  it('owes nothing once cancelled', () => {
    expect(s({ status: 'cancelled' })).toEqual({ state: 'cancelled', openTetri: 0 });
  });
});

describe('a sale dated before the last stocktake (§1 п. 9)', () => {
  it('asks only for a day in the past on or before the count', () => {
    expect(needsCountAnswer('2026-10-23', '2026-10-23', '2026-10-23')).toBe(false);
    expect(needsCountAnswer('2026-10-08', '2026-10-15', '2026-10-23')).toBe(true);
    expect(needsCountAnswer('2026-10-16', '2026-10-15', '2026-10-23')).toBe(false);
    expect(needsCountAnswer('2026-10-08', null, '2026-10-23')).toBe(false);
    expect(needsCountAnswer('2026-10-15', '2026-10-15', '2026-10-23')).toBe(true);
  });
});

describe('selling more than there is (§1 п. 3, 5)', () => {
  const d = (over: Partial<Parameters<typeof stockDecision>[0]>) => stockDecision({ asked: 1, available: 1, counted: false, owner: false, shortReason: null, countedAlready: false, ...over });

  it('takes nothing that a stocktake already saw gone', () => {
    expect(d({ countedAlready: true, available: 0 })).toBe('already_counted');
  });

  it('takes what there is', () => {
    expect(d({})).toBe('ok');
  });

  it('refuses a manager more than there is', () => {
    expect(d({ available: 0 })).toBe('refuse');
  });

  it('asks an owner why', () => {
    expect(d({ available: 0, owner: true, shortReason: '  ' })).toBe('need_reason');
  });

  it('lets a part go below nought on an owner\'s word', () => {
    expect(d({ available: 0, owner: true, shortReason: 'found on the counter' })).toBe('minus');
  });

  it('finds a charger first and then sells it, so the count is not clamped out of sight', () => {
    expect(d({ available: 0, owner: true, counted: true, shortReason: 'not counted yet' })).toBe('found_then_sold');
  });
});

describe('the money at the counter (§1 п. 7)', () => {
  it('a retail buyer pays now or waits for the bank', () => {
    expect(paymentProblem({ retail: true, totalTetri: 100_00, paidNowTetri: 0, promisedChannel: null })).toBe('retail_must_pay');
    expect(paymentProblem({ retail: true, totalTetri: 100_00, paidNowTetri: 0, promisedChannel: 'acquiring' })).toBeNull();
    expect(paymentProblem({ retail: true, totalTetri: 100_00, paidNowTetri: 100_00, promisedChannel: null })).toBeNull();
  });

  it('nobody pays more than the sale', () => {
    expect(paymentProblem({ retail: false, totalTetri: 100_00, paidNowTetri: 120_00, promisedChannel: null })).toBe('goods_paid_over');
  });

  it('an own customer may pay part, or nothing', () => {
    expect(paymentProblem({ retail: false, totalTetri: 100_00, paidNowTetri: 55_00, promisedChannel: null })).toBeNull();
    expect(paymentProblem({ retail: false, totalTetri: 100_00, paidNowTetri: 0, promisedChannel: null })).toBeNull();
  });
});

describe('a price edited at the counter', () => {
  it('is an edit only when the shelf named another price', () => {
    expect(priceEdited(130_00, 100_00)).toBe(true);
    expect(priceEdited(100_00, 100_00)).toBe(false);
    expect(priceEdited(null, 100_00)).toBe(false);
    expect(priceEdited(0, 100_00)).toBe(false);
  });
});

describe('what a cancellation does with the money (§1 п. 4, 11, 13)', () => {
  const pays = [{ id: 'p1', inSplit: false }];

  it('makes an own customer\'s money his credit', () => {
    expect(cancelPlan({ retail: false, mode: 'cancel', payments: pays })).toEqual({ fates: [{ id: 'p1', fate: 'credit' }] });
  });

  it('voids a retail buyer\'s', () => {
    expect(cancelPlan({ retail: true, mode: 'cancel', payments: pays })).toEqual({ fates: [{ id: 'p1', fate: 'void' }] });
  });

  it('voids everything on the seller\'s own undo', () => {
    expect(cancelPlan({ retail: false, mode: 'undo', payments: pays })).toEqual({ fates: [{ id: 'p1', fate: 'void' }] });
  });

  it('refuses to void a payment that is one part of a split bank line', () => {
    expect(cancelPlan({ retail: true, mode: 'cancel', payments: [{ id: 'p1', inSplit: true }] })).toEqual({ refuse: 'goods_payment_in_split', paymentId: 'p1' });
    // Credit leaves the line as it is.
    expect(cancelPlan({ retail: false, mode: 'cancel', payments: [{ id: 'p1', inSplit: true }] })).toEqual({ fates: [{ id: 'p1', fate: 'credit' }] });
  });
});

describe('goods in «Экономика»', () => {
  const line = (over: Partial<GoodsEconomicsLine>): GoodsEconomicsLine => ({
    saleId: 's1',
    soldOn: '2026-10-08',
    status: 'active',
    key: 'charger',
    name: 'Charger 73V6A (example)',
    qty: 1,
    unitPriceTetri: 100_00,
    unitCostTetri: null,
    ...over,
  });
  const october = { from: '2026-10-01', to: '2026-10-31' };

  it('counts revenue, VAT, net, cost and margin of the lines whose cost is known', () => {
    const e = goodsEconomics([line({}), line({ saleId: 's2', key: 'part:a', name: 'Brake pad (example)', unitPriceTetri: 35_00, unitCostTetri: 20_00 })], october);
    expect(e).toMatchObject({ sales: 2, qty: 2, grossTetri: 135_00, vatTetri: 15_25 + 5_34, netTetri: 84_75 + 29_66, costTetri: 20_00, marginTetri: 29_66 - 20_00 });
    // A charger nobody priced is not a cost of nought: it stays out of the margin.
    expect(e.unknownCost).toEqual({ lines: 1, netTetri: 84_75 });
  });

  it('leaves out what was cancelled and what was sold outside the period', () => {
    const e = goodsEconomics([line({ status: 'cancelled' }), line({ saleId: 's3', soldOn: '2026-09-30' })], october);
    expect(e).toMatchObject({ sales: 0, grossTetri: 0, netTetri: 0 });
  });

  it('lets the rows by item add up to the total', () => {
    const e = goodsEconomics(
      [line({ qty: 3, unitPriceTetri: 33_33, unitCostTetri: 10_00 }), line({ key: 'part:b', name: 'Mirror (example)', unitPriceTetri: 12_50, unitCostTetri: 5_00 })],
      null,
    );
    const sum = (k: 'grossTetri' | 'netTetri' | 'costTetri' | 'marginTetri') => e.byItem.reduce((n, r) => n + r[k], 0);
    expect(sum('grossTetri')).toBe(e.grossTetri);
    expect(sum('netTetri')).toBe(e.netTetri);
    expect(sum('costTetri')).toBe(e.costTetri);
    expect(sum('marginTetri')).toBe(e.marginTetri);
  });
});

describe('a counted item\'s name', () => {
  it('names the model when one is given', () => {
    expect(countedName('charger', '73V6A')).toEqual({ ru: 'Зарядка 73V6A', ka: 'დამტენი 73V6A', en: 'Charger 73V6A' });
    expect(countedName('charger', ' ')).toEqual({ ru: 'Зарядка', ka: 'დამტენი', en: 'Charger' });
  });

  it('sells chargers; a battery waits for Mika\'s word (§1 п. 17)', () => {
    expect(SELLABLE_COUNTED).toEqual(['charger']);
    expect(GOODS_MAX_LINES).toBe(20);
  });
});

describe('goods in the customer\'s one debt figure (B7-02)', () => {
  const base = { today: '2026-10-23', rentals: [], sales: [], repairs: [], unplacedTetri: 0, depositHeldTetri: 0 };

  it('owes an open goods sale as a part of its own', () => {
    const d = customerDebt({ ...base, goods: [{ id: 'g1', number: 'TS-00001', chargedTetri: 100_00, paidTetri: 55_00 }] });
    expect(d.owesTetri).toBe(45_00);
    expect(d.parts).toEqual([{ kind: 'goods', id: 'g1', number: 'TS-00001', owesTetri: 45_00 }]);
  });

  it('takes the customer\'s credit off it', () => {
    const d = customerDebt({ ...base, unplacedTetri: 45_00, goods: [{ id: 'g1', number: 'TS-00001', chargedTetri: 100_00, paidTetri: 55_00 }] });
    expect(d.owesTetri).toBe(0);
  });

  it('is an older debt, never money awaited today', () => {
    const d = customerDebt({ ...base, goods: [{ id: 'g1', number: 'TS-00001', chargedTetri: 100_00, paidTetri: 0 }] });
    expect(dueTodayOf(d, [], base.today).tetri).toBe(0);
  });
});
