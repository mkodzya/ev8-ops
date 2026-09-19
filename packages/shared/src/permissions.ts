import type { Role } from './types.js';

/**
 * What a role may do. Roles are fixed (spec §3) and permissions are code, so
 * a new right is a line here and a check in the route that guards it — there
 * is no roles screen to keep in sync.
 */
export const PERMISSIONS = [
  'fleet.view', // the fleet, rentals, sales, service and customers — without cost
  'fleet.state.manual', // move a VIN by hand, reason required (FLT-03)
  'fleet.location.set', // say which point a moped stands at; the list itself is settings
  'fleet.pool.set', // move a moped between the rental and the sale park (ADR-0005)
  'rental.create', // hand-over wizard (RNT-01)
  'rental.return', // return wizard (RNT-04)
  'customer.create',
  'customer.documents.view', // ID and licence photos, the personal number (CST-03)
  'cash.record', // take cash from a customer (PAY-05)
  'payments.view', // every payment, not only the cash one took oneself
  'payments.reconcile', // statements, unmatched queue (PAY-01..03)
  'cost.view', // unit cost, stock value, landed cost: the owners' numbers (redesign §2.1)
  'purchases.view', // orders and suppliers
  'service.manage', // repair jobs (SRV-01), and the parts catalogue
  'stock.count', // correct a count by hand — a stock-take
  'sales.manage', // sales and buy-backs (SAL-01..03)
  // Return or keep a deposit. One owner decides; there is no second confirmation (D18).
  'deposit.decide',
  'reports.view',
  'settings.manage', // models, tariffs, points
  'users.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * A manager hands mopeds over and takes them back, opens a customer, takes
 * cash and says where a moped stands. Deciding a deposit, repairs, money
 * beyond their own cash, cost, purchases, reports and settings are the
 * owners' (redesign blueprint §2.1, Mika 17.09.2026).
 */
const MANAGER: Permission[] = ['fleet.view', 'fleet.location.set', 'rental.create', 'rental.return', 'customer.create', 'cash.record'];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  manager: MANAGER,
};

export function roleCan(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
