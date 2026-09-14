import { describe, expect, it } from 'vitest';
import { daysInStates, stateSpans, vehicleEconomics } from '../src/index.js';

const life = [
  { occurredOn: '2025-03-14', toState: 'available' as const },
  { occurredOn: '2025-04-01', toState: 'rented' as const },
  { occurredOn: '2025-05-01', toState: 'available' as const },
  { occurredOn: '2025-05-10', toState: 'service' as const },
  { occurredOn: '2025-05-20', toState: 'available' as const },
];

describe('how long a moped spent where', () => {
  it('counts each stretch up to the next event, and the last one up to today', () => {
    const spans = stateSpans(life, '2025-06-01');
    expect(spans.map((s) => [s.state, s.days])).toEqual([
      ['available', 18],
      ['rented', 30],
      ['available', 9],
      ['service', 10],
      ['available', 12],
    ]);
    expect(daysInStates(life, '2025-06-01')).toEqual({ available: 39, rented: 30, service: 10, out: 0, sold: 0 });
  });

  it('two events on one day means the first lasted no time', () => {
    const spans = stateSpans(
      [
        { occurredOn: '2025-04-01', toState: 'available' },
        { occurredOn: '2025-04-01', toState: 'rented' },
      ],
      '2025-04-10',
    );
    expect(spans.map((s) => s.days)).toEqual([0, 9]);
  });

  it('stops at the day the count ends, and ignores what has not happened yet', () => {
    expect(daysInStates(life, '2025-04-15').rented).toBe(14);
    expect(daysInStates(life, '2025-04-15').service).toBe(0);
  });

  it('a moped with no events has nothing to say', () => {
    expect(stateSpans([], '2025-06-01')).toEqual([]);
  });
});

describe('what a moped was worth', () => {
  it('adds up the money and subtracts what it cost to land', () => {
    const e = vehicleEconomics({
      costTetri: 168929,
      rentalRevenueTetri: 420000,
      saleRevenueTetri: 0,
      buyBackTetri: 0,
      serviceCompanyTetri: 6500,
      serviceChargedTetri: 5500,
      events: life,
      until: '2025-06-01',
    });
    expect(e.marginTetri).toBe(420000 - 6500 - 168929);
    // A repair the renter paid for is not a cost this moped bore.
    expect(e.serviceChargedTetri).toBe(5500);
    expect(e.idleDays).toBe(49); // free 39 plus 10 in service
    expect(e.days.rented).toBe(30);
  });

  it('counts a sale in and a buy-back out', () => {
    const e = vehicleEconomics({
      costTetri: 100000,
      rentalRevenueTetri: 0,
      saleRevenueTetri: 290000,
      buyBackTetri: 244000,
      serviceCompanyTetri: 0,
      serviceChargedTetri: 0,
      events: life,
      until: '2025-06-01',
    });
    expect(e.marginTetri).toBe(290000 - 244000 - 100000);
  });

  it('says nothing about margin when nobody knows what it cost', () => {
    const e = vehicleEconomics({
      costTetri: null,
      rentalRevenueTetri: 100000,
      saleRevenueTetri: 0,
      buyBackTetri: 0,
      serviceCompanyTetri: 0,
      serviceChargedTetri: 0,
      events: life,
      until: '2025-06-01',
    });
    expect(e.marginTetri).toBeNull();
  });
});
