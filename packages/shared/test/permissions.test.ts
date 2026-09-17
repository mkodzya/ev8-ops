import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLES, roleCan } from '../src/index.js';

describe('roles and permissions (redesign §2.1, Mika 17.09.2026)', () => {
  it('has two roles: the owners and the managers', () => {
    expect(ROLES).toEqual(['owner', 'manager']);
  });

  it('the owner may do everything', () => {
    for (const p of PERMISSIONS) expect(roleCan('owner', p), p).toBe(true);
  });

  it('a manager hands over, takes back, opens a customer, takes cash and says where a moped stands', () => {
    for (const p of ['fleet.view', 'fleet.location.set', 'rental.create', 'rental.return', 'customer.create', 'cash.record'] as const) {
      expect(roleCan('manager', p), p).toBe(true);
    }
  });

  it('a manager never sees cost, purchases, reports, documents or other people\'s money, and decides no deposit', () => {
    for (const p of ['cost.view', 'purchases.view', 'reports.view', 'customer.documents.view', 'payments.view', 'payments.reconcile', 'deposit.decide', 'deposit.confirm', 'service.manage', 'settings.manage', 'users.manage'] as const) {
      expect(roleCan('manager', p), p).toBe(false);
    }
  });
});
