import { describe, expect, it } from 'vitest';
import { actionsForRole, menuSectionsForRole, phoneTabsForRole, sectionOfPath, sectionsForRole, tabsForRole } from './navigation-helpers.js';

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

  it('offers the owner six actions under + and the manager five (wave 5 §3.7)', () => {
    expect(actionsForRole('owner').map((a) => a.id)).toEqual(['pickup', 'return', 'takeMoney', 'newCustomer', 'openRepair', 'sell']);
    // A manager reports a breakdown; opening the repair itself is an owner's.
    expect(actionsForRole('manager').map((a) => a.id)).toEqual(['pickup', 'return', 'takeCash', 'newCustomer', 'reportBreak']);
  });

  it('shows the points tab and statements only to the owner', () => {
    expect(tabsForRole('fleet', 'owner').map((t) => t.id)).toEqual(['vehicles', 'models', 'points', 'batteries']);
    expect(tabsForRole('fleet', 'manager').map((t) => t.id)).toEqual(['vehicles', 'models', 'batteries']);
    expect(tabsForRole('money', 'owner').map((t) => t.id)).toEqual(['sort', 'payments', 'till', 'statements', 'deposits']);
    expect(tabsForRole('cash', 'manager').map((t) => t.id)).toEqual(['till', 'mine']);
  });

  // Wave 6 §3.4–3.9. Settings grew into tabs; the points did not move with
  // them — one list, one address (designer, 21.09.2026).
  it('gives settings six tabs, and its points row leads to the fleet', () => {
    expect(tabsForRole('settings', 'owner').map((t) => t.id)).toEqual(['people', 'points', 'rental', 'journal', 'migration', 'login']);
    expect(tabsForRole('settings', 'owner').find((t) => t.id === 'points')?.path).toBe('/fleet/points');
    // The fleet's own tab is the same address, so neither list is a copy.
    expect(tabsForRole('fleet', 'owner').find((t) => t.id === 'points')?.path).toBe('/fleet/points');
    expect(tabsForRole('settings', 'manager')).toEqual([]);
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
