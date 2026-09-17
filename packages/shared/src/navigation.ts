import { ROLE_PERMISSIONS, type Permission } from './permissions.js';
import type { Role } from './types.js';

/**
 * The structure of the product (redesign blueprint §2.1–2.2, wave 1 §3.2–3.4):
 * nine sections in three groups, the tabs inside them, the phone bar and the
 * "+" actions of each role. Which of it a person sees follows from their
 * permissions, so the menu and the API cannot disagree about a role.
 *
 * A section a role has no work in is not shown anywhere — not on the rail,
 * not on the bar, not in the avatar menu (B1-05). `anyOf` empty means
 * everybody signed in.
 */

export type SectionId =
  | 'today'
  | 'rentals'
  | 'fleet'
  | 'service'
  | 'money'
  | 'cash'
  | 'sales'
  | 'purchases'
  | 'reports'
  | 'settings'
  | 'customers';

export type GroupId = 'work' | 'money' | 'manage';

export interface Section {
  id: SectionId;
  path: string;
  group: GroupId | null; // null: not on the rail — reached from the avatar menu
  anyOf: readonly Permission[];
  /** Hidden from roles that have any of these: the till is the manager's view of money, the owner has Money. */
  noneOf?: readonly Permission[];
}

export const SECTIONS: readonly Section[] = [
  { id: 'today', path: '/', group: 'work', anyOf: [] },
  { id: 'rentals', path: '/rentals', group: 'work', anyOf: ['fleet.view'] },
  { id: 'fleet', path: '/fleet', group: 'work', anyOf: ['fleet.view'] },
  { id: 'service', path: '/service', group: 'work', anyOf: ['fleet.view'] },
  { id: 'money', path: '/money/payments', group: 'money', anyOf: ['payments.view'] },
  { id: 'cash', path: '/money/cash', group: 'money', anyOf: ['cash.record'], noneOf: ['payments.view'] },
  { id: 'sales', path: '/sales', group: 'money', anyOf: ['fleet.view'] },
  { id: 'purchases', path: '/purchases', group: 'money', anyOf: ['purchases.view'] },
  { id: 'reports', path: '/reports/economics', group: 'manage', anyOf: ['reports.view'] },
  { id: 'settings', path: '/settings', group: 'manage', anyOf: ['users.manage'] },
  { id: 'customers', path: '/customers', group: null, anyOf: ['fleet.view'] },
];

export const GROUPS: readonly GroupId[] = ['work', 'money', 'manage'];

const allowed = (s: { anyOf: readonly Permission[]; noneOf?: readonly Permission[] }, permissions: readonly Permission[]) =>
  (s.anyOf.length === 0 || s.anyOf.some((p) => permissions.includes(p))) && !(s.noneOf ?? []).some((p) => permissions.includes(p));

export function sectionsFor(permissions: readonly Permission[]): Section[] {
  return SECTIONS.filter((s) => allowed(s, permissions));
}

/**
 * The phone bar: four sections around the "+" (wave 1 §3.2). An owner has
 * Money where a manager has the till.
 *   owner:   Today · Rentals · + · Money · Fleet
 *   manager: Today · Rentals · + · Fleet · Till
 */
export function phoneTabsFor(permissions: readonly Permission[]): SectionId[] {
  const mine = new Set(sectionsFor(permissions).map((s) => s.id));
  const order: SectionId[] = mine.has('money') ? ['today', 'rentals', 'money', 'fleet'] : ['today', 'rentals', 'fleet', 'cash'];
  return order.filter((id) => mine.has(id));
}

/** Everything a role has that is not on its bar, for the avatar menu — in rail order, customers first. */
export function menuSectionsFor(permissions: readonly Permission[]): SectionId[] {
  const tabs = new Set(phoneTabsFor(permissions));
  const rest = sectionsFor(permissions)
    .map((s) => s.id)
    .filter((id) => !tabs.has(id));
  return [...rest.filter((id) => id === 'customers'), ...rest.filter((id) => id !== 'customers')];
}

export type TabId = 'vehicles' | 'models' | 'points' | 'jobs' | 'stock' | 'payments' | 'statements' | 'economics';

/** Tabs inside a section, in the address (wave 1 §3.2). */
export const SECTION_TABS: Partial<Record<SectionId, readonly { id: TabId; path: string; anyOf: readonly Permission[] }[]>> = {
  fleet: [
    { id: 'vehicles', path: '/fleet', anyOf: ['fleet.view'] },
    { id: 'models', path: '/fleet/models', anyOf: ['fleet.view'] },
    { id: 'points', path: '/fleet/points', anyOf: ['settings.manage'] },
  ],
  service: [
    { id: 'jobs', path: '/service', anyOf: ['fleet.view'] },
    { id: 'stock', path: '/service/stock', anyOf: ['fleet.view'] },
  ],
  money: [
    { id: 'payments', path: '/money/payments', anyOf: ['payments.view'] },
    { id: 'statements', path: '/money/statements', anyOf: ['payments.reconcile'] },
  ],
  reports: [{ id: 'economics', path: '/reports/economics', anyOf: ['reports.view'] }],
};

export function tabsFor(section: SectionId, permissions: readonly Permission[]) {
  return (SECTION_TABS[section] ?? []).filter((t) => allowed(t, permissions));
}

export type ActionId = 'pickup' | 'return' | 'newCustomer' | 'openRepair' | 'sell';

/** What the "+" offers, most frequent first (wave 1 §3.2). */
export const ACTIONS: readonly { id: ActionId; path: string; anyOf: readonly Permission[] }[] = [
  { id: 'pickup', path: '/rentals/new', anyOf: ['rental.create'] },
  { id: 'return', path: '/rentals/return', anyOf: ['rental.return'] },
  { id: 'newCustomer', path: '/customers/new', anyOf: ['customer.create'] },
  { id: 'openRepair', path: '/service?new=1', anyOf: ['service.manage'] },
  { id: 'sell', path: '/sales?new=1', anyOf: ['sales.manage'] },
];

export function actionsFor(permissions: readonly Permission[]) {
  return ACTIONS.filter((a) => allowed(a, permissions));
}

/** Which section an address belongs to, for the lit item and the header title. */
export function sectionOfPath(pathname: string): SectionId {
  const first = pathname.split('/')[1] ?? '';
  if (first === '') return 'today';
  if (first === 'money') return pathname.startsWith('/money/cash') ? 'cash' : 'money';
  if (first === 'reports') return 'reports';
  const known: Record<string, SectionId> = {
    rentals: 'rentals',
    fleet: 'fleet',
    service: 'service',
    sales: 'sales',
    purchases: 'purchases',
    settings: 'settings',
    customers: 'customers',
  };
  return known[first] ?? 'today';
}

/**
 * Old addresses and where they live now (build plan Р8, wave 1 §3.4). A
 * bookmark on the old one still arrives.
 */
export const REDIRECTS: readonly { from: string; to: string }[] = [
  { from: '/models', to: '/fleet/models' },
  { from: '/models/:id', to: '/fleet/models/:id' },
  { from: '/stock', to: '/service/stock' },
  { from: '/stock/parts/:id', to: '/service/stock/parts/:id' },
  { from: '/payments', to: '/money/payments' },
  { from: '/statements', to: '/money/statements' },
  { from: '/economics', to: '/reports/economics' },
  { from: '/profile', to: '/me' },
];

export const sectionsForRole = (role: Role) => sectionsFor(ROLE_PERMISSIONS[role]);
export const phoneTabsForRole = (role: Role) => phoneTabsFor(ROLE_PERMISSIONS[role]);
export const menuSectionsForRole = (role: Role) => menuSectionsFor(ROLE_PERMISSIONS[role]);
