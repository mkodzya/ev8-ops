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

  it('offers the owner five actions under + and the manager three', () => {
    expect(actionsForRole('owner').map((a) => a.id)).toEqual(['pickup', 'return', 'newCustomer', 'openRepair', 'sell']);
    expect(actionsForRole('manager').map((a) => a.id)).toEqual(['pickup', 'return', 'newCustomer']);
  });

  it('shows the points tab and statements only to the owner', () => {
    expect(tabsForRole('fleet', 'owner').map((t) => t.id)).toEqual(['vehicles', 'models', 'points']);
    expect(tabsForRole('fleet', 'manager').map((t) => t.id)).toEqual(['vehicles', 'models']);
    expect(tabsForRole('money', 'owner').map((t) => t.id)).toEqual(['payments', 'statements']);
  });

  it('knows which section an address belongs to', () => {
    expect(sectionOfPath('/')).toBe('today');
    expect(sectionOfPath('/fleet/models/abc')).toBe('fleet');
    expect(sectionOfPath('/service/stock/parts/x')).toBe('service');
    expect(sectionOfPath('/money/cash')).toBe('cash');
    expect(sectionOfPath('/money/statements')).toBe('money');
    expect(sectionOfPath('/rentals/abc/return')).toBe('rentals');
  });
});
