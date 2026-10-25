import { describe, expect, it } from 'vitest';
import { actionsForRole, homePathForRole, menuSectionsForRole, phoneTabsForRole, sectionOfPath, sectionsForRole, tabsForRole } from './navigation-helpers.js';

describe('the structure each role sees (wave 1 §3.2)', () => {
  it('gives the owner Today · Rentals · + · Money · Fleet, and everything else in the avatar menu', () => {
    expect(phoneTabsForRole('owner')).toEqual(['today', 'rentals', 'money', 'fleet']);
    expect(menuSectionsForRole('owner')).toEqual(['customers', 'service', 'sales', 'purchases', 'reports', 'settings']);
  });

  it('gives the manager Today · Rentals · + · Fleet · Till, and only customers, service and sales in the menu', () => {
    expect(phoneTabsForRole('manager')).toEqual(['today', 'rentals', 'fleet', 'cash']);
    expect(menuSectionsForRole('manager')).toEqual(['customers', 'service', 'sales']);
  });

  it('keeps purchases, reports, settings and Money itself away from a manager everywhere', () => {
    const ids = sectionsForRole('manager').map((s) => s.id);
    for (const owners of ['money', 'purchases', 'reports', 'settings'] as const) expect(ids).not.toContain(owners);
    expect(sectionsForRole('owner').map((s) => s.id)).not.toContain('cash');
  });

  it('offers the owner seven actions under + and the manager six (wave 5 §3.7; issue #11)', () => {
    expect(actionsForRole('owner').map((a) => a.id)).toEqual(['pickup', 'return', 'takeMoney', 'newCustomer', 'openRepair', 'sell', 'sellGoods']);
    // A manager reports a breakdown; opening the repair itself is an owner's.
    // He sells a part or a charger over the counter, never a moped (ADR-0045).
    expect(actionsForRole('manager').map((a) => a.id)).toEqual(['pickup', 'return', 'takeCash', 'newCustomer', 'reportBreak', 'sellGoods']);
  });

  it('splits Sales into the mopeds and the goods, for both roles (issue #11)', () => {
    for (const role of ['owner', 'manager'] as const) {
      expect(tabsForRole('sales', role)).toEqual([
        { id: 'vehicles', path: '/sales', anyOf: ['fleet.view'] },
        { id: 'goods', path: '/sales/goods', anyOf: ['fleet.view'] },
      ]);
    }
    expect(sectionOfPath('/sales/goods/new')).toBe('sales');
    expect(tabsForRole('sales', 'mechanic')).toEqual([]);
  });

  it('shows the points tab and statements only to the owner', () => {
    expect(tabsForRole('fleet', 'owner').map((t) => t.id)).toEqual(['vehicles', 'models', 'points', 'batteries']);
    expect(tabsForRole('fleet', 'manager').map((t) => t.id)).toEqual(['vehicles', 'models', 'batteries']);
    expect(tabsForRole('money', 'owner').map((t) => t.id)).toEqual(['calendar', 'sort', 'payments', 'till', 'statements', 'deposits']);
    expect(tabsForRole('cash', 'manager').map((t) => t.id)).toEqual(['till', 'mine']);
  });

  // Mika, 11.10.2026: the payments calendar is the first tab of Money, and an
  // owner's only (docs/redesign/payments-calendar.md §3.0, crit. 29, 32).
  it('puts the payments calendar first in the owner\'s Money and nowhere for a manager', () => {
    expect(tabsForRole('money', 'owner')[0]).toMatchObject({ id: 'calendar', path: '/money/calendar' });
    expect(tabsForRole('money', 'manager')).toEqual([]);
    expect(tabsForRole('cash', 'manager').map((t) => t.id)).not.toContain('calendar');
    expect(sectionOfPath('/money/calendar', ['payments.view'])).toBe('money');
  });

  // Mika, 28.09.2026: the suppliers are a tab of Purchases, not a section.
  it('gives purchases two tabs, the orders and the suppliers, to the owner only', () => {
    expect(tabsForRole('purchases', 'owner').map((t) => t.path)).toEqual(['/purchases', '/purchases/suppliers']);
    expect(tabsForRole('purchases', 'manager')).toEqual([]);
    expect(sectionOfPath('/purchases/suppliers')).toBe('purchases');
  });

  // Wave 6 §3.4–3.9. Settings grew into tabs; the points did not move with
  // them — one list, one address (designer, 21.09.2026).
  // The expense categories joined them on 15.10.2026 (migration 0046).
  it('gives settings seven tabs, and its points stay in Settings (Mika, 29.09.2026)', () => {
    // «Поступления» beside «Расходы»: the categories of other income (issue #13, migration 0069).
    expect(tabsForRole('settings', 'owner').map((t) => t.id)).toEqual(['people', 'points', 'rental', 'repair', 'expenses', 'incoming', 'drive', 'journal', 'migration', 'login']);
    expect(tabsForRole('settings', 'owner').find((t) => t.id === 'points')?.path).toBe('/settings/points');
    expect(sectionOfPath('/settings/points')).toBe('settings');
    // Fleet keeps its own tab to the same page.
    expect(tabsForRole('fleet', 'owner').find((t) => t.id === 'points')?.path).toBe('/fleet/points');
    expect(tabsForRole('settings', 'manager')).toEqual([]);
  });

  // ADR-0033: a mechanic and a chief mechanic see the repairs and nothing else,
  // and land on them — "Today" is the front office's queue.
  it('gives a mechanic and a chief mechanic the repairs alone, as their first screen', () => {
    for (const role of ['mechanic', 'chief_mechanic'] as const) {
      expect(sectionsForRole(role).map((s) => s.id)).toEqual(['service']);
      expect(phoneTabsForRole(role)).toEqual(['service']);
      expect(menuSectionsForRole(role)).toEqual([]);
      expect(actionsForRole(role)).toEqual([]);
      expect(homePathForRole(role)).toBe('/service');
    }
    // The book of works is the chief mechanic's to keep, not the mechanic's (stage 2).
    // Each reads his own balance (stage 5); marking a mechanic paid is the owners' alone.
    expect(tabsForRole('service', 'mechanic').map((t) => t.id)).toEqual(['jobs', 'balance']);
    expect(tabsForRole('service', 'chief_mechanic').map((t) => t.id)).toEqual(['jobs', 'works', 'balance']);
    expect(tabsForRole('service', 'owner').map((t) => t.id)).toEqual(['jobs', 'stock', 'works', 'payouts']);
    expect(tabsForRole('service', 'manager').map((t) => t.id)).not.toContain('payouts');
    expect(homePathForRole('owner')).toBe('/');
    expect(homePathForRole('manager')).toBe('/');
  });

  it('knows which section an address belongs to', () => {
    expect(sectionOfPath('/')).toBe('today');
    expect(sectionOfPath('/fleet/models/abc')).toBe('fleet');
    expect(sectionOfPath('/service/stock/parts/x')).toBe('service');
    expect(sectionOfPath('/money/cash')).toBe('cash');
    expect(sectionOfPath('/money/cash', ['payments.view'])).toBe('money');
    expect(sectionOfPath('/money/statements')).toBe('money');
    expect(sectionOfPath('/rentals/abc/return')).toBe('rentals');
    expect(sectionOfPath('/settings/journal')).toBe('settings');
    expect(sectionOfPath('/settings/migration')).toBe('settings');
  });
});
