import { describe, expect, it } from 'vitest';
import { grossOf, matchLine, type MatchCandidate, type StatementLine } from '../src/index.js';

const candidate = (over: Partial<MatchCandidate> = {}): MatchCandidate => ({
  rentalId: 'r1',
  customerId: 'c1',
  names: ['ვაჟა ჯაფარიძე', 'Vaja Jafaridze'],
  pickedUpOn: '2026-09-01',
  openDepositTetri: 18000,
  openFirstPeriodTetri: 14000,
  openTotalTetri: 32000,
  ...over,
});

const line = (over: Partial<StatementLine> = {}): StatementLine => ({
  amountTetri: 32000,
  occurredOn: '2026-09-01',
  channel: 'transfer',
  ...over,
});

describe('what a statement line is worth (PAY-04)', () => {
  it('uses the gross the bank states for a card line, not what it credited', () => {
    // A real BOG line: credited 3152.00, "Tanxa:GEL 3200; sakomisio: GEL 48".
    expect(grossOf(line({ channel: 'acquiring', amountTetri: 315200, grossTetri: 320000 }))).toBe(320000);
  });

  it('recovers the gross when the bank states only the credit', () => {
    expect(grossOf(line({ channel: 'acquiring', amountTetri: 31520 }))).toBe(32000);
    expect(grossOf(line({ channel: 'acquiring', amountTetri: 32505 }))).toBe(33000);
  });

  it('a transfer is worth exactly what arrived', () => {
    expect(grossOf(line({ amountTetri: 14000 }))).toBe(14000);
  });
});

describe('rule 1: the payer’s name', () => {
  it('matches however the bank spelled it, and says which rental', () => {
    const hit = matchLine(line({ payer: 'jafariZe vaJa' }), [candidate(), candidate({ rentalId: 'r2', customerId: 'c2', names: ['სხვა კაცი'] })]);
    expect(hit).toMatchObject({ rentalId: 'r1', customerId: 'c1', rule: 'payer_name', grossTetri: 32000 });
  });

  it('with two rentals of the same customer, the older one takes it', () => {
    const hit = matchLine(line({ payer: 'Vaja Jafaridze' }), [
      candidate({ rentalId: 'newer', pickedUpOn: '2026-09-01' }),
      candidate({ rentalId: 'older', pickedUpOn: '2026-05-01' }),
    ]);
    expect(hit?.rentalId).toBe('older');
  });

  it('two different customers in one line is a question, not a match', () => {
    const hit = matchLine(line({ payer: 'Vaja Jafaridze', purpose: 'Nino Beridze' }), [
      candidate(),
      candidate({ rentalId: 'r2', customerId: 'c2', names: ['Nino Beridze'] }),
    ]);
    // Falls through to the amount rule, which both candidates answer — so no match.
    expect(hit).toBeNull();
  });
});

describe('rule 2: the amount is exactly what one rental has open', () => {
  it('deposit plus the first week', () => {
    const hit = matchLine(line({ amountTetri: 32000 }), [candidate({ names: [] })]);
    expect(hit).toMatchObject({ rule: 'exact_amount', rentalId: 'r1' });
  });

  it('a week on its own', () => {
    const hit = matchLine(line({ amountTetri: 14000 }), [candidate({ names: [], openDepositTetri: 0, openTotalTetri: 14000 })]);
    expect(hit?.rule).toBe('exact_amount');
  });

  it('refuses when two rentals owe the same amount', () => {
    const hit = matchLine(line({ amountTetri: 14000 }), [
      candidate({ names: [], openDepositTetri: 0, openFirstPeriodTetri: 14000, openTotalTetri: 14000 }),
      candidate({ rentalId: 'r2', customerId: 'c2', names: [], openDepositTetri: 0, openFirstPeriodTetri: 14000, openTotalTetri: 14000 }),
    ]);
    expect(hit).toBeNull();
  });
});

describe('rule 3: a card payment on the day a moped went out', () => {
  it('315.20 credited on the pickup day is that renter’s 320', () => {
    const hit = matchLine(
      line({ channel: 'acquiring', amountTetri: 31520, occurredOn: '2026-09-01', payer: null }),
      [
        candidate({ names: [], openFirstPeriodTetri: 14000, openDepositTetri: 18000, openTotalTetri: 46000 }),
        candidate({ rentalId: 'r2', customerId: 'c2', names: [], pickedUpOn: '2026-08-01', openFirstPeriodTetri: 14000, openDepositTetri: 18000, openTotalTetri: 46000 }),
      ],
    );
    expect(hit).toMatchObject({ rentalId: 'r1', rule: 'acquiring_pickup_day', grossTetri: 32000 });
  });

  it('two mopeds handed out the same day for the same money is a question', () => {
    const hit = matchLine(line({ channel: 'acquiring', amountTetri: 31520, occurredOn: '2026-09-01' }), [
      candidate({ names: [], openTotalTetri: 46000 }),
      candidate({ rentalId: 'r2', customerId: 'c2', names: [], openTotalTetri: 46000 }),
    ]);
    expect(hit).toBeNull();
  });

  it('an anonymous card line with nothing to hold on to stays unmatched', () => {
    // No name, a day nobody was handed a moped, and an amount that is not
    // what this rental has open. This is the queue's case (PAY-03).
    const hit = matchLine(line({ channel: 'acquiring', amountTetri: 31520, occurredOn: '2026-09-20', payer: 'Wallet/domestic MC cards' }), [
      candidate({ names: [], openDepositTetri: 18000, openFirstPeriodTetri: 15000, openTotalTetri: 50000 }),
    ]);
    expect(hit).toBeNull();
  });
});
