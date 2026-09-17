import { ROLE_PERMISSIONS, type Permission } from './permissions.js';
import type { Role } from './types.js';

/**
 * The sections of the app and who has something to do in each. A section a
 * role has no work in is not shown anywhere — not on the rail, not on the
 * phone bar, not under More (B1-05). This decides what a person sees; what
 * the API lets them read is the route's own scope, and the two are brought
 * together by the rights table (spec B9-02).
 *
 * `anyOf` empty means everybody signed in.
 */
export const SECTIONS = [
  { path: '/', anyOf: [] },
  { path: '/fleet', anyOf: ['fleet.view'] },
  { path: '/models', anyOf: ['fleet.view'] },
  { path: '/rentals', anyOf: ['rental.create', 'rental.return', 'cash.record', 'reports.view'] },
  { path: '/sales', anyOf: ['sales.manage', 'cash.record', 'reports.view'] },
  { path: '/purchases', anyOf: ['settings.manage'] },
  { path: '/service', anyOf: ['service.manage', 'fleet.state.manual'] },
  { path: '/stock', anyOf: ['fleet.view'] },
  { path: '/payments', anyOf: ['cash.record', 'payments.reconcile', 'reports.view'] },
  { path: '/statements', anyOf: ['payments.reconcile'] },
  { path: '/economics', anyOf: ['reports.view'] },
  { path: '/customers', anyOf: ['fleet.view'] },
  { path: '/settings', anyOf: ['users.manage'] },
  { path: '/design', anyOf: ['users.manage'] },
] as const satisfies readonly { path: string; anyOf: readonly Permission[] }[];

export type SectionPath = (typeof SECTIONS)[number]['path'];

/**
 * What a thumb reaches first, in order. The phone bar takes the first four a
 * role actually has; everything else is under More. A manager gets Today,
 * Fleet, Rentals, Payments; a mechanic, who has no rentals or payments, gets
 * Service and Stock in their place.
 */
const PHONE_PRIORITY: readonly SectionPath[] = ['/', '/fleet', '/rentals', '/payments', '/service', '/stock', '/sales', '/customers'];
export const PHONE_TAB_COUNT = 4;

export function sectionsFor(permissions: readonly Permission[]): SectionPath[] {
  return SECTIONS.filter((s) => s.anyOf.length === 0 || s.anyOf.some((p: Permission) => permissions.includes(p))).map((s) => s.path);
}

export function phoneTabsFor(permissions: readonly Permission[]): SectionPath[] {
  const mine = new Set(sectionsFor(permissions));
  return PHONE_PRIORITY.filter((p) => mine.has(p)).slice(0, PHONE_TAB_COUNT);
}

export const sectionsForRole = (role: Role): SectionPath[] => sectionsFor(ROLE_PERMISSIONS[role]);
export const phoneTabsForRole = (role: Role): SectionPath[] => phoneTabsFor(ROLE_PERMISSIONS[role]);
