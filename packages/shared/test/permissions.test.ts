import { describe, expect, it } from 'vitest';
import { PERMISSIONS, PIN_ROLES, PIN_SESSION_PERMISSIONS, ROLE_PERMISSIONS, ROLES, roleCan, seesEveryRepair } from '../src/index.js';

describe('roles and permissions (redesign §2.1, Mika 17.09.2026; ADR-0033, 20.10.2026)', () => {
  it('has four roles: the owners, the managers, the mechanics and the chief mechanics', () => {
    expect(ROLES).toEqual(['owner', 'manager', 'mechanic', 'chief_mechanic']);
    expect(PIN_ROLES).toEqual(['mechanic', 'chief_mechanic']);
  });

  it('gives a mechanic their own repairs and the chief mechanic every repair, the approval and the norms', () => {
    expect(ROLE_PERMISSIONS.mechanic).toEqual(['service.view', 'service.work']);
    expect(ROLE_PERMISSIONS.chief_mechanic).toEqual(['service.view', 'service.work', 'service.approve', 'service.norms']);
    expect(seesEveryRepair(ROLE_PERMISSIONS.mechanic)).toBe(false);
    for (const role of ['owner', 'manager', 'chief_mechanic'] as const) expect(seesEveryRepair(ROLE_PERMISSIONS[role]), role).toBe(true);
    // Marking a mechanic paid is the owners' alone.
    for (const role of ['manager', 'mechanic', 'chief_mechanic'] as const) expect(roleCan(role, 'service.payout'), role).toBe(false);
  });

  it('a manager reads the repairs, without their money (ADR-0033 §4)', () => {
    expect(roleCan('manager', 'service.view')).toBe(true);
    expect(roleCan('manager', 'service.approve')).toBe(false);
  });

  it('the owner may do everything', () => {
    for (const p of PERMISSIONS) expect(roleCan('owner', p), p).toBe(true);
  });

  it('a manager hands over, takes back, opens a customer, takes cash and says where a moped stands', () => {
    for (const p of ['fleet.view', 'fleet.location.set', 'rental.create', 'rental.return', 'customer.create', 'cash.record'] as const) {
      expect(roleCan('manager', p), p).toBe(true);
    }
  });

  it('a manager sells goods over the counter; dating one back, cancelling it and a mechanic selling are not his (ADR-0045)', () => {
    expect(roleCan('manager', 'goods.sell')).toBe(true);
    expect(roleCan('manager', 'sales.manage')).toBe(false);
    expect(roleCan('mechanic', 'goods.sell')).toBe(false);
    expect(roleCan('chief_mechanic', 'goods.sell')).toBe(false);
    expect(PIN_SESSION_PERMISSIONS).not.toContain('goods.sell');
  });

  it('a manager moves a renter’s latest week too; a mechanic does not (ADR-0041, addendum of 23.10.2026)', () => {
    expect(roleCan('owner', 'rental.week.shift')).toBe(true);
    expect(roleCan('manager', 'rental.week.shift')).toBe(true);
    for (const role of ['mechanic', 'chief_mechanic'] as const) expect(roleCan(role, 'rental.week.shift'), role).toBe(false);
    expect(PIN_SESSION_PERMISSIONS).not.toContain('rental.week.shift');
  });

  it('a manager calls those who pay by the schedule and sorts the customers’ money; a mechanic does neither (issue #15, ADR-0048)', () => {
    for (const p of ['payments.schedule', 'payments.sort.customer'] as const) {
      expect(roleCan('owner', p), p).toBe(true);
      expect(roleCan('manager', p), p).toBe(true);
      for (const role of ['mechanic', 'chief_mechanic'] as const) expect(roleCan(role, p), `${role} ${p}`).toBe(false);
      expect(PIN_SESSION_PERMISSIONS).not.toContain(p);
    }
  });

  it('a manager never sees cost, purchases, reports, documents or other people\'s money, and decides no deposit', () => {
    for (const p of ['cost.view', 'purchases.view', 'reports.view', 'customer.documents.view', 'payments.view', 'payments.reconcile', 'deposit.decide', 'service.manage', 'settings.manage', 'users.manage'] as const) {
      expect(roleCan('manager', p), p).toBe(false);
    }
  });
});
