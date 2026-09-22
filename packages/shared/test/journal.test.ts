import { describe, expect, it } from 'vitest';
import { collapseViews, inJournalFilter, journalGroups, journalKind, looksLikeNumber, type JournalRow } from '../src/journal.js';

const row = (over: Partial<JournalRow>): JournalRow => ({
  id: Math.random().toString(36).slice(2),
  at: '2026-09-17T19:02:00.000Z',
  action: 'customer.personalId.view',
  actorId: 'kardu',
  actorName: 'Kardu',
  entityType: 'customer',
  entityId: 'c1',
  number: 'Клиент Пример Б',
  before: null,
  after: null,
  note: null,
  ...over,
});

describe('which filter a line answers to', () => {
  it('files a deposit withheld under deposits, and a return under both deposits and states', () => {
    expect(journalGroups('deposit.decide')).toEqual(['deposits']);
    expect(journalGroups('rental.return')).toContain('deposits');
    expect(journalGroups('rental.return')).toContain('states');
  });

  it('files money where money moved, and a moped where it moved', () => {
    expect(journalGroups('payment.record')).toEqual(['money']);
    expect(journalGroups('till.handover')).toEqual(['money']);
    expect(journalGroups('vehicle.state.manual')).toEqual(['states']);
    expect(journalGroups('vehicle.cost')).toEqual(['money', 'states']);
  });

  it('files sign-ins, roles and views under "входы и просмотры"', () => {
    for (const a of ['auth.login', 'auth.login.failed', 'auth.logout', 'user.update', 'user.sessions.closed', 'customer.personalId.view', 'customer.document.open']) {
      expect(journalGroups(a), a).toContain('logins');
    }
  });

  it('"всё" keeps every line, including one no group claims', () => {
    expect(inJournalFilter('battery.move', 'all')).toBe(true);
    expect(journalGroups('battery.move')).toEqual([]);
    expect(inJournalFilter('battery.move', 'money')).toBe(false);
  });
});

describe('two kinds of line', () => {
  it('a sign-in, a view and a record created have no "было"', () => {
    for (const a of ['auth.login', 'auth.login.failed', 'customer.personalId.view', 'sale.create']) expect(journalKind(a), a).toBe('event');
  });

  it('a price, a state and a role are changes', () => {
    for (const a of ['sale.update', 'vehicle.state.manual', 'user.update', 'settings.deposit']) expect(journalKind(a), a).toBe('change');
  });
});

describe('three looks at one personal number', () => {
  it('fold into one line with a counter and the latest time (crit. 19)', () => {
    const rows = [
      row({ at: '2026-09-17T19:02:00.000Z' }),
      row({ at: '2026-09-17T14:30:00.000Z' }),
      row({ at: '2026-09-17T09:10:00.000Z' }),
    ];
    const lines = collapseViews(rows);
    expect(lines).toHaveLength(1);
    expect(lines[0].times).toBe(3);
    expect(lines[0].at).toBe('2026-09-17T19:02:00.000Z');
  });

  it('do not fold across people, records or days', () => {
    const rows = [
      row({ at: '2026-09-17T19:02:00.000Z' }),
      row({ at: '2026-09-17T18:00:00.000Z', actorId: 'mika' }),
      row({ at: '2026-09-17T17:00:00.000Z', entityId: 'c2' }),
      row({ at: '2026-09-16T17:00:00.000Z' }),
    ];
    expect(collapseViews(rows)).toHaveLength(4);
  });

  it('leave changes alone — two edits of one sale are two lines', () => {
    const rows = [
      row({ action: 'sale.update', at: '2026-09-18T12:03:00.000Z', entityId: 's1', before: { priceTetri: 518800 }, after: { priceTetri: 500000 } }),
      row({ action: 'sale.update', at: '2026-09-18T11:00:00.000Z', entityId: 's1', before: { priceTetri: 520000 }, after: { priceTetri: 518800 } }),
    ];
    const lines = collapseViews(rows);
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.times === 1)).toBe(true);
  });
});

describe('the search box', () => {
  it('knows a record number from a name', () => {
    expect(looksLikeNumber('R-00488')).toBe(true);
    expect(looksLikeNumber('sl-00169')).toBe(true);
    expect(looksLikeNumber('PO-00118')).toBe(true);
    expect(looksLikeNumber('Клиент Пример Б')).toBe(false);
    expect(looksLikeNumber('TESTW5CHECK000002')).toBe(false);
  });
});
