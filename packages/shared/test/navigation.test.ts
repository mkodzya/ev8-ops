import { describe, expect, it } from 'vitest';
import { ROLES, phoneTabsForRole, sectionsForRole } from '../src/index.js';

describe('what each role sees in the menu', () => {
  it('hides purchases, statements, reports and settings from a manager', () => {
    const all = sectionsForRole('manager');
    for (const owners of ['/purchases', '/statements', '/economics', '/settings', '/design'] as const) expect(all).not.toContain(owners);
  });

  it('shows the owner every section', () => {
    expect(sectionsForRole('owner')).toContain('/settings');
    expect(sectionsForRole('owner')).toContain('/purchases');
  });

  it('never puts a section on the phone bar twice or one the role cannot open', () => {
    for (const role of ROLES) {
      const tabs = phoneTabsForRole(role);
      expect(tabs.length).toBeLessThanOrEqual(4);
      expect(new Set(tabs).size).toBe(tabs.length);
      for (const tab of tabs) expect(sectionsForRole(role)).toContain(tab);
    }
  });
});
