// Kommo against the rentals here (ADR-0012): the comparison, without a
// network or a database around it.
import { describe, expect, it } from 'vitest';
import { dayQueue, kommoFreshness, kommoLeadId, kommoMayWriteTo, kommoWriteMode, paymentNoteText, paymentVoidNoteText, reconcileKommo, type KommoRunningRental, type QueueInput } from '../src/index.js';

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
    ...over,
  });
  const at = '2026-10-07T08:40:00.000Z';

  it('is one row for every disagreement, with the time of Kommo’s answer', () => {
    const q = dayQueue(input({ kommo: { rentedThere: 17, rentedHere: 2, silent: false, lastOkAt: at } }));
    expect(q).toHaveLength(1);
    expect(q[0]!.rows).toEqual([expect.objectContaining({ id: 'kommo', group: 'decisions', action: 'reconcile_kommo', href: '/settings/kommo', note: `19|ok|${at}` })]);
  });

  it('is not there when nothing disagrees, when the link is off, or for a manager', () => {
    expect(dayQueue(input({ kommo: { rentedThere: 0, rentedHere: 0, silent: false, lastOkAt: at } }))).toEqual([]);
    expect(dayQueue(input({ kommo: null }))).toEqual([]);
    expect(dayQueue(input({ owner: false, kommo: { rentedThere: 17, rentedHere: 0, silent: false, lastOkAt: at } }))).toEqual([]);
  });

  it('is there when Kommo has gone silent, even with nothing disagreeing: no row must not read as “all agree”', () => {
    const q = dayQueue(input({ kommo: { rentedThere: 0, rentedHere: 0, silent: true, lastOkAt: null } }));
    expect(q[0]!.rows[0]).toMatchObject({ id: 'kommo', note: '0|silent|' });
  });
});

// Step 2 (ADR-0013): the note a payment leaves in the deal, and the switch.
describe('whether a stand writes to Kommo', () => {
  it('is off unless told, and off again for anything it does not understand', () => {
    expect(kommoWriteMode(undefined)).toEqual({ kind: 'off' });
    expect(kommoWriteMode('')).toEqual({ kind: 'off' });
    expect(kommoWriteMode('off')).toEqual({ kind: 'off' });
    expect(kommoWriteMode('yes')).toEqual({ kind: 'off' });
    expect(kommoWriteMode('only:')).toEqual({ kind: 'off' });
    expect(kommoWriteMode('only:abc')).toEqual({ kind: 'off' });
  });

  it('writes to every deal when on, and to the named deals alone when told which', () => {
    expect(kommoWriteMode(' ON ')).toEqual({ kind: 'all' });
    const only = kommoWriteMode('only:101, 202');
    expect(only).toEqual({ kind: 'only', leads: ['101', '202'] });
    expect(kommoMayWriteTo(only, '202')).toBe(true);
    expect(kommoMayWriteTo(only, '303')).toBe(false);
    expect(kommoMayWriteTo({ kind: 'all' }, '303')).toBe(true);
    expect(kommoMayWriteTo({ kind: 'off' }, '101')).toBe(false);
  });
});

describe('the note a payment leaves in the deal', () => {
  const facts = { rentalNumber: 'R-00012', occurredOn: '2026-10-08', channel: 'cash' as const, grossTetri: 15000, rentTetri: 15000, depositTetri: 0, chargesTetri: 0, paidThrough: '2026-10-14', takenBy: 'ТЕСТ Менеджер' };

  it('says what came, when, how, what it closed and where the rental stands — on one line', () => {
    expect(paymentNoteText(facts, 'ru')).toBe('EV8 Ops · оплата 150 ₾ · 08.10.2026 · наличные · аренда · оплачено по 14.10.2026 · R-00012 · принял(а) ТЕСТ Менеджер');
  });

  it('splits a first payment into the week and the deposit, and names what stayed as credit', () => {
    expect(paymentNoteText({ ...facts, grossTetri: 33000, rentTetri: 15000, depositTetri: 18000, channel: 'acquiring' }, 'ru')).toContain('карта · аренда 150 ₾, залог 180 ₾ · оплачено по');
    expect(paymentNoteText({ ...facts, grossTetri: 20050, rentTetri: 15000 }, 'ru')).toContain('оплата 200.50 ₾ · 08.10.2026 · наличные · аренда 150 ₾, на счёт клиента 50.50 ₾');
  });

  it('says so when no whole week is paid, and leaves out a name nobody gave', () => {
    const text = paymentNoteText({ ...facts, grossTetri: 5000, rentTetri: 5000, paidThrough: null, takenBy: null }, 'ru');
    expect(text).toBe('EV8 Ops · оплата 50 ₾ · 08.10.2026 · наличные · аренда · оплаченных недель нет · R-00012');
  });

  it('is written in the language the staff read Kommo in', () => {
    expect(paymentNoteText(facts, 'en')).toBe('EV8 Ops · payment 150 ₾ · 08.10.2026 · cash · rent · paid through 14.10.2026 · R-00012 · taken by ТЕСТ Менеджер');
    expect(paymentNoteText(facts, 'ka')).toContain('გადახდა 150 ₾ · 08.10.2026 · ნაღდი · ქირა · გადახდილია 14.10.2026-მდე · R-00012');
  });

  it('takes a note back when the payment is voided, with the reason on one line', () => {
    const text = paymentVoidNoteText({ rentalNumber: 'R-00012', occurredOn: '2026-10-08', grossTetri: 15000, reason: 'не тот\nклиент', paidThrough: '2026-10-07', voidedBy: 'ТЕСТ Владелец' }, 'ru');
    expect(text).toBe('EV8 Ops · ОТМЕНЕНА оплата 150 ₾ от 08.10.2026 · причина: не тот клиент · оплачено по 07.10.2026 · R-00012 · отменил(а) ТЕСТ Владелец');
  });
});

describe('the Kommo row in “Today”, once notes are written', () => {
  const base: QueueInput = {
    today: '2026-10-08',
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
  };
  const at = '2026-10-08T08:40:00.000Z';

  it('appears for a note Kommo refused even when nothing else disagrees, and carries the count', () => {
    const q = dayQueue({ ...base, kommo: { rentedThere: 0, rentedHere: 0, silent: false, lastOkAt: at, notesRefused: 2 } });
    expect(q[0]!.rows[0]).toMatchObject({ id: 'kommo', note: `0|ok|${at}|2` });
  });

  it('keeps its old shape while no note is refused', () => {
    const q = dayQueue({ ...base, kommo: { rentedThere: 7, rentedHere: 0, silent: false, lastOkAt: at, notesRefused: 0 } });
    expect(q[0]!.rows[0]!.note).toBe(`7|ok|${at}`);
    expect(dayQueue({ ...base, kommo: { rentedThere: 0, rentedHere: 0, silent: false, lastOkAt: at, notesRefused: 0 } })).toEqual([]);
  });
});
