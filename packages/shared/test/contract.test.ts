// A contract signed or not, and who still asks for it (ADR-0039): one rule
// for the list's "Не подписан" chip and the "Fill in" group of "Today".
import { describe, expect, it } from 'vitest';
import { asksForSignature, contractSignedOf, contractState, dayQueue, type ContractFacts, type QueueInput, type QueueRental } from '../src/index.js';

const facts = (over: Partial<ContractFacts> = {}): ContractFacts => ({ signedHere: false, signedElsewhereAt: null, transferredAt: null, returned: false, ...over });

describe('the state of a contract', () => {
  it('is unsigned when it was made here and nobody signed or marked it', () => {
    expect(contractState(facts())).toBe('unsigned');
    expect(contractSignedOf('unsigned')).toBe(false);
  });

  it('is signed here once the customer signed on the screen (D17)', () => {
    expect(contractState(facts({ signedHere: true }))).toBe('signed_here');
    expect(contractSignedOf('signed_here')).toBe(true);
  });

  it('is signed elsewhere once a person marked it signed in Signify', () => {
    expect(contractState(facts({ signedElsewhereAt: '2026-10-21T08:00:00.000Z' }))).toBe('signed_elsewhere');
    expect(contractState(facts({ signedElsewhereAt: new Date('2026-10-21T08:00:00.000Z') }))).toBe('signed_elsewhere');
    expect(contractSignedOf('signed_elsewhere')).toBe(true);
  });

  it('is not asked of a rental brought over, nor of one returned (Mika, 08.10.2026)', () => {
    expect(contractState(facts({ transferredAt: '2026-10-08T09:00:00.000Z' }))).toBe('not_asked');
    expect(contractState(facts({ returned: true }))).toBe('not_asked');
    expect(contractSignedOf('not_asked')).toBeNull();
  });

  it('puts a signature here above the mark, and the mark above "not asked"', () => {
    expect(contractState(facts({ signedHere: true, signedElsewhereAt: '2026-10-21T08:00:00.000Z' }))).toBe('signed_here');
    expect(contractState(facts({ signedElsewhereAt: '2026-10-21T08:00:00.000Z', transferredAt: '2026-10-08T09:00:00.000Z' }))).toBe('signed_elsewhere');
    expect(contractState(facts({ signedHere: true, returned: true }))).toBe('signed_here');
  });
});

describe('“Today” asks for a signature', () => {
  it('only of an unsigned contract, and only from the day after the hand-over (wave 3)', () => {
    expect(asksForSignature('unsigned', 0)).toBe(false);
    expect(asksForSignature('unsigned', 1)).toBe(true);
    expect(asksForSignature('unsigned', 21)).toBe(true);
    for (const s of ['signed_here', 'signed_elsewhere', 'not_asked'] as const) expect(asksForSignature(s, 21), s).toBe(false);
  });

  it('draws the "sign" row for that rental and for no other', () => {
    const rental = (id: string, state: ReturnType<typeof contractState>, ago: number): QueueRental => ({
      id,
      number: `R-0000${id}`,
      customer: { id: `c${id}`, name: 'ТЕСТ Клиент', phone: null },
      vin: null,
      pickedUpOn: '2026-10-01',
      expectedReturnOn: null,
      paidThrough: null,
      payOffsetDays: 0,
      status: 'active',
      debtTetri: 0,
      dueTodayTetri: 0,
      depositUndecided: false,
      vinUnconfirmed: false,
      contractUnsigned: asksForSignature(state, ago),
    });
    const input: QueueInput = {
      today: '2026-10-21',
      owner: true,
      rentals: [rental('1', 'unsigned', 20), rental('2', 'signed_elsewhere', 20), rental('3', 'not_asked', 20), rental('4', 'unsigned', 0)],
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
    };
    const fill = dayQueue(input).find((g) => g.group === 'fill')!;
    expect(fill.rows.filter((r) => r.action === 'sign').map((r) => r.id)).toEqual(['sign:1']);
  });
});
