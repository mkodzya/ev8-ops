// Kommo against the rentals here (ADR-0012): the comparison, without a
// network or a database around it.
import { describe, expect, it } from 'vitest';
import { dayQueue, kommoFreshness, kommoLeadId, phoneAsOnCard, phoneKey, reconcileKommo, unenteredSales, type KommoRunningRental, type QueueInput } from '../src/index.js';

const rental = (over: Partial<KommoRunningRental> & { customerRef?: string | null } = {}): KommoRunningRental => {
  const { customerRef = null, ...rest } = over;
  return { id: 'r1', number: 'R-00001', kommoRef: null, vin: 'TEST0000000000001', customer: { id: 'c1', name: 'ТЕСТ Клиент', kommoRef: customerRef }, ...rest };
};
const lead = (id: string, name = `ТЕСТ Сделка ${id}`) => ({ id, name, contactName: null });

describe('the deal a Kommo field names', () => {
  it('is read from a pasted link or a bare number, and from nothing else', () => {
    expect(kommoLeadId('https://ev8mopeds.kommo.com/leads/detail/19912345')).toBe('19912345');
    expect(kommoLeadId(' https://ev8mopeds.kommo.com/leads/detail/19912345?tab=notes ')).toBe('19912345');
    expect(kommoLeadId('19912345')).toBe('19912345');
    expect(kommoLeadId('#19912345')).toBe('19912345');
    expect(kommoLeadId('the deal of Monday')).toBeNull();
    expect(kommoLeadId('https://ev8mopeds.kommo.com/contacts/detail/777')).toBeNull();
    expect(kommoLeadId('')).toBeNull();
    expect(kommoLeadId(null)).toBeNull();
  });
});

describe('Kommo beside the rentals here', () => {
  it('matches a deal by the link on the rental', () => {
    const r = reconcileKommo([lead('101')], [rental({ kommoRef: 'https://ev8mopeds.kommo.com/leads/detail/101' })], []);
    expect(r).toEqual({ rentedThere: [], rentedHere: [], matched: 1 });
  });

  it('falls back to the link on the rental’s customer', () => {
    const r = reconcileKommo([lead('102')], [rental({ customerRef: '102' })], []);
    expect(r).toEqual({ rentedThere: [], rentedHere: [], matched: 1 });
  });

  it('lets the rental’s own link win over its customer’s: one customer, two mopeds, two deals', () => {
    const rentals = [rental({ id: 'r1', number: 'R-00001', kommoRef: '201', customerRef: '202' }), rental({ id: 'r2', number: 'R-00002', customerRef: '202' })];
    expect(reconcileKommo([lead('201'), lead('202')], rentals, [])).toEqual({ rentedThere: [], rentedHere: [], matched: 2 });
  });

  it('names a deal that is rented in Kommo with no rental here, and the card it belongs to', () => {
    const r = reconcileKommo([{ id: '301', name: 'ТЕСТ Сделка', contactName: 'ТЕСТ Контакт' }, lead('302')], [], [{ id: 'c9', name: 'ТЕСТ Карточка', kommoRef: 'https://ev8mopeds.kommo.com/leads/detail/301' }]);
    expect(r.matched).toBe(0);
    expect(r.rentedHere).toEqual([]);
    expect(r.rentedThere).toEqual([
      { leadId: '301', leadName: 'ТЕСТ Сделка', contactName: 'ТЕСТ Контакт', customer: { id: 'c9', name: 'ТЕСТ Карточка' } },
      { leadId: '302', leadName: 'ТЕСТ Сделка 302', contactName: null, customer: null },
    ]);
  });

  it('names a rental here whose deal is not in the rented stage, and one with no Kommo link at all', () => {
    const rentals = [rental({ id: 'r1', number: 'R-00002', kommoRef: '401' }), rental({ id: 'r2', number: 'R-00001', kommoRef: 'ask Kardu' })];
    const r = reconcileKommo([lead('999')], rentals, []);
    expect(r.rentedHere).toEqual([
      { rentalId: 'r2', number: 'R-00001', vin: 'TEST0000000000001', customer: { id: 'c1', name: 'ТЕСТ Клиент' }, leadId: null, reason: 'no_link' },
      { rentalId: 'r1', number: 'R-00002', vin: 'TEST0000000000001', customer: { id: 'c1', name: 'ТЕСТ Клиент' }, leadId: '401', reason: 'not_rented' },
    ]);
    expect(r.rentedThere.map((x) => x.leadId)).toEqual(['999']);
  });

  it('reports all seventeen when no rental has been entered yet', () => {
    const leads = Array.from({ length: 17 }, (_, i) => lead(String(500 + i)));
    const cards = leads.map((l, i) => ({ id: `c${i}`, name: `ТЕСТ ${i}`, kommoRef: `https://ev8mopeds.kommo.com/leads/detail/${l.id}` }));
    const r = reconcileKommo(leads, [], cards);
    expect(r.rentedThere).toHaveLength(17);
    expect(r.rentedThere.every((x) => x.customer != null)).toBe(true);
    expect(r.matched).toBe(0);
  });
});

describe('how fresh Kommo’s answer is', () => {
  const now = new Date('2026-10-07T12:00:00Z');
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);
  const STALE = 20 * 60_000;

  it('is waiting before the first asking, and silent once an asking has failed with no answer ever', () => {
    expect(kommoFreshness(null, null, now, STALE)).toBe('waiting');
    expect(kommoFreshness(null, ago(1), now, STALE)).toBe('silent');
  });

  it('is fine while the last answer is recent, and silent when it is older than it should be', () => {
    expect(kommoFreshness(ago(5), ago(0), now, STALE)).toBe('ok');
    expect(kommoFreshness(ago(21), ago(1), now, STALE)).toBe('silent');
  });
});

describe('the Kommo row in “Today”', () => {
  const input = (over: Partial<QueueInput> = {}): QueueInput => ({
    today: '2026-10-07',
    owner: true,
    rentals: [],
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
    ...over,
  });
  const at = '2026-10-07T08:40:00.000Z';

  it('is one row for every rental Kommo does not call rented, with the time of Kommo’s answer', () => {
    // The other half — rented there, nothing here — is a task each, not this row (ADR-0015).
    const q = dayQueue(input({ kommo: { rentedThere: 17, rentedHere: 2, silent: false, lastOkAt: at } }));
    expect(q).toHaveLength(1);
    expect(q[0]!.rows).toEqual([expect.objectContaining({ id: 'kommo', group: 'decisions', action: 'reconcile_kommo', href: '/settings/kommo', note: `2|ok|${at}` })]);
  });

  it('is not there when nothing here disagrees, when the link is off, or for a manager', () => {
    expect(dayQueue(input({ kommo: { rentedThere: 0, rentedHere: 0, silent: false, lastOkAt: at } }))).toEqual([]);
    expect(dayQueue(input({ kommo: { rentedThere: 17, rentedHere: 0, silent: false, lastOkAt: at } }))).toEqual([]);
    expect(dayQueue(input({ kommo: null }))).toEqual([]);
    expect(dayQueue(input({ owner: false, kommo: { rentedThere: 0, rentedHere: 3, silent: false, lastOkAt: at } }))).toEqual([]);
  });

  it('is there when Kommo has gone silent, even with nothing disagreeing: no row must not read as “all agree”', () => {
    const q = dayQueue(input({ kommo: { rentedThere: 0, rentedHere: 0, silent: true, lastOkAt: null } }));
    expect(q[0]!.rows[0]).toMatchObject({ id: 'kommo', note: '0|silent|' });
  });
});

// ADR-0015: what Kommo has won comes in as a card and a task.
describe('a phone, to find a card by', () => {
  it('is the same key however the number is written', () => {
    const key = phoneKey('+995 595 12 34 56');
    expect(key).toBe('995595123456');
    for (const written of ['595123456', '995595123456', '00995 595 12-34-56', '+995(595)123456', ' 595 12 34 56 ']) expect(phoneKey(written)).toBe(key);
    expect(phoneKey('+971 50 123 4567')).toBe('971501234567');
  });

  it('is nothing for what is not a number', () => {
    expect(phoneKey(null)).toBeNull();
    expect(phoneKey('')).toBeNull();
    expect(phoneKey('no phone')).toBeNull();
    expect(phoneKey('12345')).toBeNull();
  });

  it('goes onto a card the way the hand-over writes it, and a foreign number as it came', () => {
    expect(phoneAsOnCard('995595123456')).toBe('+995 595 12 34 56');
    expect(phoneAsOnCard('595 123456')).toBe('+995 595 12 34 56');
    expect(phoneAsOnCard(' +971 50 123 4567 ')).toBe('+971 50 123 4567');
  });
});

describe('a deal and its card', () => {
  it('is the card that names the deal, and failing that the card the deal was tied to by its phone', () => {
    const named = { id: 'c1', name: 'ТЕСТ По ссылке', kommoRef: '301' };
    const tied = { id: 'c2', name: 'ТЕСТ По телефону', kommoRef: 'https://ev8mopeds.kommo.com/leads/detail/999' };
    const r = reconcileKommo([lead('301'), { ...lead('302'), customerId: 'c2' }, { ...lead('303'), customerId: 'gone' }, lead('304')], [], [named, tied]);
    expect(r.rentedThere.map((x) => x.customer)).toEqual([{ id: 'c1', name: 'ТЕСТ По ссылке' }, { id: 'c2', name: 'ТЕСТ По телефону' }, null, null]);
  });
});

describe('sales Kommo has won beside the sales here', () => {
  const sale = (kommoRef: string | null, customerRef: string | null = null) => ({ kommoRef, customer: { kommoRef: customerRef } });

  it('asks for a sale that nothing here answers to, with the card to start from', () => {
    const cards = [{ id: 'c1', name: 'ТЕСТ Покупатель', kommoRef: '401' }];
    expect(unenteredSales([lead('401')], [], cards)).toEqual([{ leadId: '401', leadName: 'ТЕСТ Сделка 401', contactName: null, customer: { id: 'c1', name: 'ТЕСТ Покупатель' } }]);
  });

  it('is answered by a sale’s own link, and failing that by its buyer’s — as a rental is', () => {
    expect(unenteredSales([lead('402')], [sale('https://ev8mopeds.kommo.com/leads/detail/402')], [])).toEqual([]);
    expect(unenteredSales([lead('403')], [sale(null, '403')], [])).toEqual([]);
    // The sale's own link wins: this one is for another deal, whatever its buyer's card says.
    expect(unenteredSales([lead('404')], [sale('405', '404')], []).map((x) => x.leadId)).toEqual(['404']);
  });
});

describe('deals from Kommo in “Today”', () => {
  const input = (over: Partial<QueueInput> = {}): QueueInput => ({
    today: '2026-10-08',
    owner: false,
    rentals: [],
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
    ...over,
  });

  it('are a task each, for a manager too: the hand-over opens on the customer’s card and carries the deal', () => {
    const q = dayQueue(input({ kommoDeals: [{ leadId: '501', kind: 'rent', who: 'ТЕСТ Арендатор', customerId: 'c1', phone: '+995 595 12 34 56' }] }));
    expect(q.map((g) => g.group)).toEqual(['intake']);
    expect(q[0]!.rows).toEqual([
      { id: 'kommo-rent:501', group: 'intake', action: 'hand_over_from_kommo', who: 'ТЕСТ Арендатор', number: null, vin: null, days: null, amountTetri: null, href: '/rentals/new?customer=c1&lead=501', phone: '+995 595 12 34 56', note: '501' },
    ]);
  });

  it('open the sale for a won sale, and the wizard without a card when no card could be told', () => {
    const q = dayQueue(input({ owner: true, kommoDeals: [{ leadId: '502', kind: 'sale', who: 'ТЕСТ Покупатель', customerId: 'c2', phone: null }, { leadId: '503', kind: 'rent', who: 'ТЕСТ Сделка 503', customerId: null, phone: null }] }));
    expect(q[0]!.rows.map((r) => [r.action, r.href])).toEqual([
      ['sell_from_kommo', '/sales/new?customer=c2&lead=502'],
      ['hand_over_from_kommo', '/rentals/new?lead=503'],
    ]);
  });

  it('are all shown, not three and “more”: there is no list to open the rest in', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ leadId: String(600 + i), kind: 'rent' as const, who: `ТЕСТ ${i}`, customerId: `c${i}`, phone: null }));
    const g = dayQueue(input({ kommoDeals: many }))[0]!;
    expect(g.rows).toHaveLength(7);
    expect(g.total).toBe(7);
  });

  it('stand after the rentals’ own groups and before the money', () => {
    const r = { id: 'r1', number: 'R-00001', customer: { id: 'c1', name: 'ТЕСТ', phone: null }, vin: null, pickedUpOn: '2026-09-01', expectedReturnOn: null, paidThrough: '2026-09-07', status: 'overdue', debtTetri: 15000, awaitingPayment: false, depositUndecided: false, vinUnconfirmed: false, contractUnsigned: false };
    const q = dayQueue(input({ owner: true, rentals: [r], unmatchedLines: 2, kommoDeals: [{ leadId: '701', kind: 'rent', who: 'ТЕСТ', customerId: null, phone: null }] }));
    expect(q.map((g) => g.group)).toEqual(['overdue', 'intake', 'money']);
  });
});
