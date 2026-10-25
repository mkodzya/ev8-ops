// A remembered payer (migration 0069, ADR-0046 §4) and the two guards the
// review before 1.16.0 added (25.10.2026): the sender's account beside his
// name where the bank gives one, and a remembered payer that keeps quiet when
// the line names another customer. Pure: lines and the rules' context are
// built here, no database. Every name and account number is invented.
import { describe, expect, it } from 'vitest';
import { byPayerRule, decideWithPayers, namesAnother, payerByAccount, payerKey, payerLabel, senderAccount, type LivePayerRule } from '../src/lib/statements/payers.js';
import type { Ctx, Line } from '../src/lib/statements/reconcile.js';

const DAY = '2031-03-10';

/** A transfer coming in to the Bank of Georgia, stored as a row: day, document, the sender's account, debit, credit, the bank's words. */
const bog = (payer: string, opts: { account?: string; english?: boolean; amountTetri?: number } = {}): Line => {
  const account = opts.account ?? 'GE00TB0000000000000002';
  const amount = opts.amountTetri ?? 15000;
  const words =
    opts.english === false
      ? `Caricxva: gadmomricxavi: ${payer}; daniSnuleba: qira`
      : `Incoming Transfer - Amount: GEL${(amount / 100).toFixed(2)}; Sender: ${payer}; Account: ${account}GEL; Bank: TEST BANK; Details: rent`;
  return {
    occurredOn: DAY,
    direction: 'in',
    amountTetri: amount,
    grossTetri: null,
    feeTetri: null,
    payer,
    purpose: 'rent',
    raw: ['10.03.2031', '0042', account, '', (amount / 100).toFixed(2), words].join(' | '),
    channel: 'transfer',
    bank: 'bog',
  };
};

/** A TBC transfer: its row keeps the partner's name and no account. */
const tbc = (payer: string, amountTetri = 15000): Line => ({
  occurredOn: DAY,
  direction: 'in',
  amountTetri,
  grossTetri: null,
  feeTetri: null,
  payer,
  purpose: 'rent',
  raw: ['10/03/2031', 'rent', (amountTetri / 100).toFixed(2), payer, '20000000001.20'].join(' | '),
  channel: 'transfer',
  bank: 'tbc',
});

type Rental = Ctx['rentals'][number];
/** A running rental of a week of 150, owing what `owes` says now — `deposit` of it the deposit still open. */
const rental = (id: string, customerId: string, owes: number, deposit = 0): Rental => ({
  id,
  number: `R-${id}`,
  customerId,
  customer: customerId,
  names: [],
  status: 'active',
  pickedUpOn: '2031-03-01',
  transferredOn: null,
  weeklyRateTetri: 15000,
  openDepositTetri: deposit,
  openFirstPeriodTetri: owes > deposit ? 15000 : 0,
  firstOpenPeriod: null,
  owedNowTetri: owes,
  openTotalTetri: owes,
});

const ctxOf = (customers: { id: string; name: string }[], rentals: Rental[]): Ctx => ({
  today: DAY,
  rentals,
  sales: [],
  goods: [],
  customers: customers.map((c) => ({ id: c.id, name: c.name, names: [c.name, null, null] })),
  payments: [],
  bankDeposits: [],
});

const asCustomer = (customerId: string): LivePayerRule => ({ id: 'rule-1', kind: 'customer', customerId, categoryId: null });

describe('the payer a line is remembered by', () => {
  it('is the name and the sender’s account where the Bank of Georgia gives one; the name alone otherwise', () => {
    expect(senderAccount(bog('Exampla Payer', { account: 'GE00BG0000000000000009' }))).toBe('GE00BG0000000000000009');
    expect(payerKey(bog('Exampla Payer', { account: 'GE00BG0000000000000009' }))).toBe('exampla payer|GE00BG0000000000000009');
    // The older Georgian wording has no «Account:»: the row's column says it.
    expect(payerKey(bog('Exampla Payer', { english: false }))).toBe('exampla payer|GE00TB0000000000000002');
    // TBC keeps no account in its row.
    expect(senderAccount(tbc('Exampla Payer'))).toBeNull();
    expect(payerKey(tbc('Exampla Payer'))).toBe('exampla payer');
  });

  it('the same name from another account is another payer', () => {
    expect(payerKey(bog('Exampla Payer', { account: 'GE00BG0000000000000009' }))).not.toBe(payerKey(bog('Exampla Payer', { account: 'GE00BG0000000000000008' })));
  });

  it('is read on screen with the account’s last four characters where the key holds one, so «Запомнить для …» says which', () => {
    expect(payerLabel(bog('Exampla  Payer', { account: 'GE00BG0000000000000009' }))).toBe('Exampla Payer · …0009');
    expect(payerByAccount(bog('Exampla Payer', { account: 'GE00BG0000000000000009' }))).toBe(true);
    expect(payerLabel(tbc('Exampla Payer'))).toBe('Exampla Payer');
    expect(payerByAccount(tbc('Exampla Payer'))).toBe(false);
    // A card line has no payer: neither a label nor an account.
    expect(payerLabel({ ...bog('Exampla Payer'), channel: 'acquiring' })).toBeNull();
    expect(payerByAccount({ ...bog('Exampla Payer'), channel: 'acquiring' })).toBe(false);
  });

  it('a card line and cash paid in have none', () => {
    expect(payerKey({ ...bog('Exampla Payer'), channel: 'acquiring' })).toBeNull();
    expect(payerKey({ ...bog('Exampla Payer'), purpose: 'naRdi fulis Setana' })).toBeNull();
  });
});

describe('a payer remembered as a customer keeps quiet when the line names another (review of 25.10.2026)', () => {
  const A = { id: 'cust-a', name: 'Tamro Exampleshvili' };
  const B = { id: 'cust-b', name: 'Lasha Invented' };

  it('a sender the cards do not name: the remembered customer’s rental takes the week', () => {
    const ctx = ctxOf([A, B], [rental('a1', A.id, 30000)]);
    expect(byPayerRule(bog('Lasha Relativo'), ctx, asCustomer(A.id))).toMatchObject({ type: 'rule', rule: 'payer_rule', target: { rentalId: 'a1' }, customerId: A.id });
  });

  it('a namesake: the line names another customer, and waits for a person', () => {
    // Remembered for A; another customer's card holds the very name the bank writes.
    // The namesake owes his deposit and his first week: 330, not this 150.
    const ctx = ctxOf([A, B, { id: 'cust-c', name: 'Lasha Relativo' }], [rental('a1', A.id, 30000), rental('c1', 'cust-c', 33000, 18000)]);
    const line = bog('Lasha Relativo');
    expect(byPayerRule(line, ctx, asCustomer(A.id))).toBeNull();
    // The name rule has no debt of exactly this sum on the namesake's rental: a person decides.
    expect(decideWithPayers(line, ctx, new Map([[payerKey(line)!, asCustomer(A.id)]]))).toEqual({ type: 'queue' });
  });

  it('the relative remembered for A who now rents himself as B: his own week, by his name', () => {
    const ctx = ctxOf([A, { id: B.id, name: 'Lasha Relativo' }], [rental('a1', A.id, 30000), rental('b1', B.id, 15000)]);
    const line = bog('Lasha Relativo');
    const d = decideWithPayers(line, ctx, new Map([[payerKey(line)!, asCustomer(A.id)]]));
    expect(d).toMatchObject({ type: 'rule', rule: 'payer_name', target: { rentalId: 'b1' }, customerId: B.id });
  });

  it('the screen reads the same guard: another customer named, or only the one remembered', () => {
    const ctx = ctxOf([A, { id: B.id, name: 'Lasha Relativo' }], []);
    expect(namesAnother(bog('Lasha Relativo'), ctx, { customerId: A.id })).toBe(true);
    expect(namesAnother(bog('Lasha Relativo'), ctx, { customerId: B.id })).toBe(false);
    expect(namesAnother(bog('Nobody Invented'), ctx, { customerId: A.id })).toBe(false);
  });

  it('the remembered customer named on the line is no other: the rule still places it', () => {
    const ctx = ctxOf([{ id: A.id, name: 'Lasha Relativo' }, B], [rental('a1', A.id, 30000)]);
    expect(byPayerRule(bog('Lasha Relativo'), ctx, asCustomer(A.id))).toMatchObject({ type: 'rule', target: { rentalId: 'a1' } });
  });

  it('an answer that is nobody’s money — a founder’s, between own accounts — keeps quiet when the line names any customer', () => {
    const founder: LivePayerRule = { id: 'rule-2', kind: 'founder_equity', customerId: null, categoryId: null };
    expect(byPayerRule(bog('Founder Invented'), ctxOf([A, B], []), founder)).toMatchObject({ type: 'aside', resolution: 'founder_equity' });
    expect(byPayerRule(bog('Lasha Invented'), ctxOf([A, B], []), founder)).toBeNull();
  });
});
