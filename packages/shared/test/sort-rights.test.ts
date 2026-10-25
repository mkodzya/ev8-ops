// Who may give which answer in «Разобрать» (issue #15 of the director,
// 25.10.2026; ADR-0048): the customers' money is a manager's to sort too,
// everything else stays the owners'.
import { describe, expect, it } from 'vitest';
import { CUSTOMER_ANSWERS, INCOME_ANSWERS, ROLE_PERMISSIONS, incomeAnswersFor, mayLinkPayment, mayRemember, maySortTo, mayUnlink } from '../src/index.js';

const owner = ROLE_PERMISSIONS.owner;
const manager = ROLE_PERMISSIONS.manager;
const mechanic = ROLE_PERMISSIONS.mechanic;

describe('the answers under a line coming in (issue #15)', () => {
  it('gives an owner every answer and a manager the customers’ money alone, in the panel’s order', () => {
    expect(incomeAnswersFor(owner)).toEqual([...INCOME_ANSWERS]);
    expect(incomeAnswersFor(manager)).toEqual(['rental', 'deposit', 'sale', 'goods', 'repair', 'several']);
    expect(incomeAnswersFor(mechanic)).toEqual([]);
  });

  it('keeps «Не наше», between accounts, a founder’s money, other income, an advance and cash to the bank from a manager', () => {
    for (const a of ['not_ours', 'own_transfer', 'founder_equity', 'other_income', 'customer', 'bank_deposit'] as const) {
      expect(CUSTOMER_ANSWERS, a).not.toContain(a);
      expect(incomeAnswersFor(owner), a).toContain(a);
    }
  });
});

describe('what a part of a line may pay, by who writes it', () => {
  it('lets a manager put money on a rental, its deposit, a carried week, a moped sale, goods, a repair or a charge', () => {
    for (const target of [{ rentalId: 'r' }, { rentalId: 'r', rentOnly: true }, { depositRentalId: 'r' }, { carriedPeriodId: 'w' }, { saleId: 's' }, { goodsSaleId: 'g' }, { serviceJobId: 'j' }, { chargeId: 'c' }]) {
      expect(maySortTo(manager, target), JSON.stringify(target)).toBe(true);
    }
  });

  it('keeps an advance on the account and a new fine from a manager, and gives the owner both', () => {
    for (const target of [{ customerId: 'c' }, { fineRentalId: 'r', fineReason: 'invented reason' }, { rentalId: 'r', customerId: 'c' }]) {
      expect(maySortTo(manager, target), JSON.stringify(target)).toBe(false);
      expect(maySortTo(owner, target), JSON.stringify(target)).toBe(true);
    }
  });

  it('a part that names no record is nobody’s to write by this rule, and a mechanic writes none', () => {
    expect(maySortTo(manager, {})).toBe(false);
    expect(maySortTo(manager, { rentalId: '' })).toBe(false);
    expect(maySortTo(mechanic, { rentalId: 'r' })).toBe(false);
  });

  it('lets a manager link a line to rent, a sale, a repair or goods entered by hand, not to an advance or a payout', () => {
    for (const kind of ['rent', 'sale', 'service', 'goods']) expect(mayLinkPayment(manager, kind), kind).toBe(true);
    for (const kind of ['on_account', 'deposit_payout', 'supplier', 'buyback']) {
      expect(mayLinkPayment(manager, kind), kind).toBe(false);
      expect(mayLinkPayment(owner, kind), kind).toBe(true);
    }
  });

  it('lets a manager let go only of a link he made himself from the line', () => {
    const mine = [{ source: 'statement', createdById: 'me' }];
    expect(mayUnlink(manager, mine, 'me')).toBe(true);
    expect(mayUnlink(manager, [...mine, { source: 'statement', createdById: 'me' }], 'me')).toBe(true);
    // A colleague's, a rule's, money entered by hand, nothing at all.
    expect(mayUnlink(manager, [{ source: 'statement', createdById: 'other' }], 'me')).toBe(false);
    expect(mayUnlink(manager, [{ source: 'statement', createdById: null }], 'me')).toBe(false);
    expect(mayUnlink(manager, [{ source: 'manual', createdById: 'me' }], 'me')).toBe(false);
    expect(mayUnlink(manager, [], 'me')).toBe(false);
    expect(mayUnlink(owner, [{ source: 'statement', createdById: 'other' }], 'me')).toBe(true);
  });

  it('keeps «Запомнить для …» — a standing rule — the owners’', () => {
    expect(mayRemember(owner)).toBe(true);
    expect(mayRemember(manager)).toBe(false);
  });
});
