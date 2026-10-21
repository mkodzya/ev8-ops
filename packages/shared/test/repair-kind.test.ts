// The kind of a repair picked in the office and changed by the owner (Mika,
// 21.10.2026): the tablet's five words, none of them required there, and a
// repair a mechanic carries never left without one.
import { describe, expect, it } from 'vitest';
import { SERVICE_REASONS, isServiceReason, reasonKindRefusal, suggestsCustomerPays } from '../src/index.js';

describe('a kind of repair', () => {
  it('is one of the tablet’s five, and nothing else', () => {
    for (const k of SERVICE_REASONS) expect(isServiceReason(k)).toBe(true);
    expect(isServiceReason('other')).toBe(false);
    expect(isServiceReason('')).toBe(false);
    expect(isServiceReason(null)).toBe(false);
    expect(isServiceReason(undefined)).toBe(false);
    expect(isServiceReason('PLANNED')).toBe(false);
    expect(isServiceReason(3)).toBe(false);
  });
});

describe('changing the kind of a repair', () => {
  const office = { byMechanic: false };
  const workshop = { byMechanic: true };

  it('is allowed while the repair waits or is in work: set, changed or taken away', () => {
    for (const status of ['open', 'draft']) {
      expect(reasonKindRefusal({ ...office, status }, 'accident')).toBeNull();
      expect(reasonKindRefusal({ ...office, status }, 'planned')).toBeNull();
      expect(reasonKindRefusal({ ...office, status }, null)).toBeNull();
    }
  });

  it('is refused on a repair that is closed, called off or refused: it is a record', () => {
    for (const status of ['done', 'cancelled']) {
      expect(reasonKindRefusal({ ...office, status }, 'wear')).toBe('job_closed');
      expect(reasonKindRefusal({ ...workshop, status }, 'wear')).toBe('job_closed');
      expect(reasonKindRefusal({ ...office, status }, null)).toBe('job_closed');
    }
  });

  it('changes a mechanic’s kind for another, and never takes it away', () => {
    expect(reasonKindRefusal({ ...workshop, status: 'open' }, 'warranty')).toBeNull();
    expect(reasonKindRefusal({ ...workshop, status: 'draft' }, 'renter_fault')).toBeNull();
    expect(reasonKindRefusal({ ...workshop, status: 'open' }, null)).toBe('reason_kind_kept');
    expect(reasonKindRefusal({ ...workshop, status: 'draft' }, null)).toBe('reason_kind_kept');
  });

  it('sets the same hint going whoever picked it: «Вина арендатора» offers the customer’s expense', () => {
    const rented = { payer: 'company', rental: { number: 'R-00000' }, status: 'open' };
    expect(suggestsCustomerPays({ ...rented, reasonKind: 'renter_fault' })).toBe(true);
    expect(suggestsCustomerPays({ ...rented, reasonKind: 'accident' })).toBe(false);
    expect(suggestsCustomerPays({ ...rented, reasonKind: null })).toBe(false);
  });
});
