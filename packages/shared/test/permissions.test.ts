import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLES, ROLE_PERMISSIONS, roleCan } from '../src/index.js';

describe('roles and permissions (spec §3)', () => {
  it('the owner may do everything; every permission is granted to somebody', () => {
    for (const p of PERMISSIONS) expect(roleCan('owner', p), p).toBe(true);
  });

  it('a manager hands over and takes back mopeds but never reconciles money or sees documents', () => {
    expect(roleCan('manager', 'rental.create')).toBe(true);
    expect(roleCan('manager', 'rental.return')).toBe(true);
    expect(roleCan('manager', 'cash.record')).toBe(true);
    expect(roleCan('manager', 'payments.reconcile')).toBe(false);
    expect(roleCan('manager', 'customer.documents.view')).toBe(false);
    expect(roleCan('manager', 'deposit.decide')).toBe(false);
  });

  it('the director does everything a manager does, plus reconciliation, repairs, sales and deposit decisions', () => {
    for (const p of ROLE_PERMISSIONS.manager) expect(roleCan('director', p), p).toBe(true);
    expect(roleCan('director', 'payments.reconcile')).toBe(true);
    expect(roleCan('director', 'deposit.decide')).toBe(true);
    // Withholding and returning to a third party are confirmed by the owner.
    expect(roleCan('director', 'deposit.confirm')).toBe(false);
    expect(roleCan('director', 'settings.manage')).toBe(false);
  });

  it('the accountant only reads and exports', () => {
    expect(roleCan('accountant', 'export.accounting')).toBe(true);
    expect(roleCan('accountant', 'reports.view')).toBe(true);
    for (const p of PERMISSIONS) {
      if (p === 'export.accounting' || p === 'reports.view' || p === 'fleet.view') continue;
      expect(roleCan('accountant', p), p).toBe(false);
    }
  });

  it('the mechanic moves VINs to service and back and nothing about money', () => {
    expect(roleCan('mechanic', 'service.manage')).toBe(true);
    expect(roleCan('mechanic', 'fleet.state.manual')).toBe(true);
    expect(roleCan('mechanic', 'cash.record')).toBe(false);
  });

  it('lists the five roles from the spec, in the order the UI shows them', () => {
    expect(ROLES).toEqual(['owner', 'director', 'manager', 'mechanic', 'accountant']);
  });
});
