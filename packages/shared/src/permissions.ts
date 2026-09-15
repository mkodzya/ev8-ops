import type { Role } from './types.js';

/**
 * What a role may do. Roles are fixed (spec §3) and permissions are code, so
 * a new right is a line here and a check in the route that guards it — there
 * is no roles screen to keep in sync.
 */
export const PERMISSIONS = [
  'fleet.view',
  'fleet.state.manual', // move a VIN by hand, reason required (FLT-03)
  'fleet.location.set', // say which point a moped stands at; the list itself is settings
  'rental.create', // hand-over wizard (RNT-01)
  'rental.return', // return wizard (RNT-04)
  'customer.create',
  'customer.documents.view', // ID and licence photos: director and owner only (CST-03)
  'cash.record', // take cash from a customer (PAY-05)
  'payments.reconcile', // statements, unmatched queue (PAY-01..03)
  'service.manage', // repair jobs (SRV-01), and the parts catalogue
  'stock.count', // correct a count by hand — a stock-take
  'sales.manage', // sales and buy-backs (SAL-01..03)
  'deposit.decide', // return / withhold on return (RNT-05)
  'deposit.confirm', // owner confirms withholding and third-party returns (RNT-05)
  'reports.view',
  'export.accounting', // Polaris export (DSH-02)
  'settings.manage', // tariffs, templates
  'users.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const MANAGER: Permission[] = [
  'fleet.view',
  'fleet.state.manual',
  'fleet.location.set',
  'rental.create',
  'rental.return',
  'customer.create',
  'cash.record',
];

const DIRECTOR: Permission[] = [
  ...MANAGER,
  'customer.documents.view',
  'payments.reconcile',
  'service.manage',
  'stock.count',
  'sales.manage',
  'deposit.decide',
  'reports.view',
  'export.accounting',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  director: DIRECTOR,
  manager: MANAGER,
  mechanic: ['fleet.view', 'fleet.state.manual', 'fleet.location.set', 'service.manage'],
  accountant: ['fleet.view', 'reports.view', 'export.accounting'],
};

export function roleCan(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
