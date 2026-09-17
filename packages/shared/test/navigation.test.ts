import { describe, expect, it } from 'vitest';
import { ROLES, phoneTabsForRole, sectionsForRole } from '../src/index.js';

describe('what each role sees in the menu (B1-05)', () => {
  it('gives the mechanic Service and Stock on the phone bar, and no money at all', () => {
    expect(phoneTabsForRole('mechanic')).toEqual(['/', '/fleet', '/service', '/stock']);
    const all = sectionsForRole('mechanic');
    expect(all).not.toContain('/payments');
    expect(all).not.toContain('/statements');
    expect(all).not.toContain('/rentals');
  });

  it('keeps the bar a manager and a director already know', () => {
    expect(phoneTabsForRole('manager')).toEqual(['/', '/fleet', '/rentals', '/payments']);
    expect(phoneTabsForRole('director')).toEqual(['/', '/fleet', '/rentals', '/payments']);
  });

  it('shows the owner every section, and nobody a section twice', () => {
    expect(sectionsForRole('owner')).toContain('/settings');
    for (const role of ROLES) {
      const tabs = phoneTabsForRole(role);
      expect(tabs.length).toBeLessThanOrEqual(4);
      expect(new Set(tabs).size).toBe(tabs.length);
      for (const tab of tabs) expect(sectionsForRole(role)).toContain(tab);
    }
  });
});
