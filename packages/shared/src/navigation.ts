import { ROLE_PERMISSIONS, type Permission } from './permissions.js';
import { UTILISATION_PATH } from './utilisation.js';
import type { Role } from './types.js';

/**
 * The structure of the product: the sections in their groups, the tabs inside
 * them, the phone bar and the "+" actions of each role. Which of it a person
 * sees follows from their permissions, so the menu and the API cannot
 * disagree about a role.
 *
 * Since issue #15 of the director (25.10.2026; ADR-0048) the groups are the
 * day's work first: «Ежедневно» — Today, «Оплаты по графику», «Разобрать»
 * with their counters, the till; «Парк» — the mopeds, the rentals with their
 * customers, the repairs; «Продажи и закупки»; and the owners' «Управление»
 * — Money (the payments, the statements, the deposits), Reports, Settings.
 * Before it (wave 1 §3.2–3.4) the payments calendar and «Разобрать» were tabs
 * of Money and the customers sat in the avatar menu.
 *
 * Since issue #19 of the director (28.10.2026; ADR-0048, addendum) «Склад» is
 * a section of its own in «Продажи и закупки», before the orders: the parts
 * (was «Ремонты → Склад») and the batteries and chargers (was «Мопеды →
 * Батареи и зарядки»). The director looked for the shelf to sell a part from
 * and did not find it in either place.
 *
 * A section a role has no work in is not shown anywhere — not on the rail,
 * not on the bar, not under «Ещё» (B1-05). `anyOf` empty means everybody
 * signed in.
 */

export type SectionId =
  | 'today'
  | 'schedule'
  | 'sort'
  | 'cash'
  | 'fleet'
  | 'rentals'
  | 'service'
  | 'sales'
  | 'stock'
  | 'purchases'
  | 'money'
  | 'reports'
  | 'settings';

export type GroupId = 'daily' | 'fleet' | 'trade' | 'manage';

export interface Section {
  id: SectionId;
  path: string;
  group: GroupId;
  anyOf: readonly Permission[];
  /** Hidden from roles that have any of these. */
  noneOf?: readonly Permission[];
}

/** Who sees a section, a tab or an action: any of `anyOf` (none — everybody), all of `allOf`, none of `noneOf`. */
export interface NavRule {
  anyOf: readonly Permission[];
  allOf?: readonly Permission[];
  noneOf?: readonly Permission[];
}

export const SECTIONS: readonly Section[] = [
  // "Today" is the front office's queue — rentals, money, the yard. A mechanic
  // has none of it; their first screen is the repairs (ADR-0033).
  { id: 'today', path: '/', group: 'daily', anyOf: ['fleet.view'] },
  // Who pays by the schedule — today, late, the calendar (issue #15): the
  // manager calls them, the owner also reads the sums.
  { id: 'schedule', path: '/schedule', group: 'daily', anyOf: ['payments.schedule'] },
  // The bank lines nobody placed: the manager sorts the customers' money, the owner all of it.
  { id: 'sort', path: '/sort', group: 'daily', anyOf: ['payments.sort.customer'] },
  // The till by person and one's own payments — the owner's too since issue #15.
  { id: 'cash', path: '/money/cash', group: 'daily', anyOf: ['cash.record'] },
  { id: 'fleet', path: '/fleet', group: 'fleet', anyOf: ['fleet.view'] },
  // The rentals and the customers in one section (the customers were in the avatar menu).
  { id: 'rentals', path: '/rentals', group: 'fleet', anyOf: ['fleet.view'] },
  { id: 'service', path: '/service', group: 'fleet', anyOf: ['service.view'] },
  { id: 'sales', path: '/sales', group: 'trade', anyOf: ['fleet.view'] },
  // The shelf: parts, batteries and chargers — what is sold from it and what
  // the orders fill it with (issue #19). The rights its two tabs had before;
  // a mechanic takes parts inside the repair's card, as he did.
  { id: 'stock', path: '/stock', group: 'trade', anyOf: ['fleet.view'] },
  { id: 'purchases', path: '/purchases', group: 'trade', anyOf: ['purchases.view'] },
  // What is left of Money: the journal of payments, the statements, the deposits.
  { id: 'money', path: '/money/payments', group: 'manage', anyOf: ['payments.view'] },
  { id: 'reports', path: '/reports/week', group: 'manage', anyOf: ['reports.view'] },
  { id: 'settings', path: '/settings', group: 'manage', anyOf: ['users.manage'] },
];

export const GROUPS: readonly GroupId[] = ['daily', 'fleet', 'trade', 'manage'];

const allowed = (s: NavRule, permissions: readonly Permission[]) =>
  (s.anyOf.length === 0 || s.anyOf.some((p) => permissions.includes(p))) &&
  (s.allOf ?? []).every((p) => permissions.includes(p)) &&
  !(s.noneOf ?? []).some((p) => permissions.includes(p));

export function sectionsFor(permissions: readonly Permission[]): Section[] {
  return SECTIONS.filter((s) => allowed(s, permissions));
}

/**
 * What a group's heading says: its own name, or — for «Продажи и закупки» read
 * without the purchases — «Продажи и склад», or «Продажи» where there is no shelf either.
 */
export type GroupHeading = GroupId | 'sales' | 'salesStock';

/**
 * A group's heading names what the reader finds under it (QA of #15,
 * 25.10.2026; the director's mockup): «Продажи и закупки» holds «Продажи» and
 * «Склад» for a manager (issue #19), and his heading says «Продажи и склад».
 * The other groups' names say what each holds for every role that sees them.
 */
export function groupHeadingFor(group: GroupId, permissions: readonly Permission[]): GroupHeading {
  if (group !== 'trade') return group;
  const ids = new Set(sectionsFor(permissions).map((s) => s.id));
  if (ids.has('purchases')) return 'trade';
  return ids.has('stock') ? 'salesStock' : 'sales';
}

/**
 * The phone bar (issue #15): four sections and «Ещё». The day's work — Today,
 * the schedule, «Разобрать» — and the mopeds; the "+" is a round button of
 * its own above the bar. A mechanic has one section, the repairs (ADR-0033).
 *   owner and manager: Today · Оплаты · Разобрать · Мопеды · Ещё
 */
export const PHONE_BAR: readonly SectionId[] = ['today', 'schedule', 'sort', 'fleet'];

export function phoneTabsFor(permissions: readonly Permission[]): SectionId[] {
  const mine = new Set(sectionsFor(permissions).map((s) => s.id));
  if (!mine.has('today')) return [...mine];
  return PHONE_BAR.filter((id) => mine.has(id));
}

/** Where a person lands: "Today" for the front office, the repairs for a mechanic. */
export function homePathFor(permissions: readonly Permission[]): string {
  return sectionsFor(permissions)[0]?.path ?? '/';
}

/** «Ещё» on the phone: every section of the role that is not on its bar, in the rail's order. */
export function menuSectionsFor(permissions: readonly Permission[]): SectionId[] {
  const tabs = new Set(phoneTabsFor(permissions));
  return sectionsFor(permissions)
    .map((s) => s.id)
    .filter((id) => !tabs.has(id));
}

/**
 * The numbers beside the sections (issue #15), one request for the rail, the
 * bar and the tabs (`GET /api/nav/counts`). Null where the person has no such
 * section: nothing is counted for him.
 */
export interface NavCounts {
  /** «Оплаты по графику»: rentals late (red) and weeks awaited today (grey). */
  schedule: { late: number; dueToday: number } | null;
  /** «Разобрать»: lines waiting, coming in — and going out, for whoever sorts those. */
  sort: { in: number; out: number | null } | null;
  /** Cash handed over and waiting for an owner. */
  till: number | null;
  /**
   * What «Настройки → До EV8 Ops» still asks: deposits brought over with no
   * decision and rentals brought over with no VIN (issue #18, B6). Nought
   * hides the tab (`tabsShown`); null — not counted for this person.
   */
  migration: number | null;
}

export type TabId =
  | 'calendar'
  | 'vehicles'
  | 'models'
  | 'points'
  | 'batteries'
  | 'jobs'
  | 'works'
  | 'parts'
  | 'sort'
  | 'payments'
  | 'till'
  | 'statements'
  | 'deposits'
  | 'mine'
  | 'week'
  | 'utilisation'
  | 'economics'
  | 'people'
  | 'rental'
  | 'journal'
  | 'migration'
  | 'login'
  | 'expenses'
  // Settings' «Статьи расходов» and «Статьи доходов» (issue #18, B5): the
  // reports' «Расходы» and «Поступления» are other screens with other words.
  | 'expenseItems'
  | 'incomeItems'
  | 'drive'
  | 'orders'
  | 'suppliers'
  | 'payouts'
  | 'balance'
  | 'repair'
  | 'goods'
  | 'incoming'
  // «Оплаты по графику» (issue #15).
  | 'due'
  | 'late'
  | 'month'
  // «Разобрать» (issue #15): money coming in, going out, sorted by the rules, removed from the queue.
  | 'sortIn'
  | 'sortOut'
  | 'byRules'
  | 'aside'
  // «Аренды и клиенты» (issue #15).
  | 'rentals'
  | 'customers';

/** Tabs inside a section, in the address (wave 1 §3.2). */
export const SECTION_TABS: Partial<Record<SectionId, readonly ({ id: TabId; path: string } & NavRule)[]>> = {
  fleet: [
    { id: 'vehicles', path: '/fleet', anyOf: ['fleet.view'] },
    { id: 'models', path: '/fleet/models', anyOf: ['fleet.view'] },
    // The one place of the points since issue #18 (B6): Settings had a tab to the same page.
    { id: 'points', path: '/fleet/points', anyOf: ['settings.manage'] },
  ],
  service: [
    { id: 'jobs', path: '/service', anyOf: ['service.view'] },
    // The book of works and its norms (stage 2 of the mechanic plan).
    { id: 'works', path: '/service/works', anyOf: ['service.norms'] },
    // Paying the mechanic (stage 5, ADR-0037): the owners mark it, the mechanics
    // read their own balance. An owner carries no repairs of his own, so he has
    // no balance tab — the same test the repairs screen makes for the workshop.
    { id: 'payouts', path: '/service/payouts', anyOf: ['service.payout'] },
    { id: 'balance', path: '/service/balance', anyOf: ['service.work'], noneOf: ['service.manage'] },
  ],
  // «Оплаты по графику» (issue #15 of the director, ADR-0048; was «Деньги →
  // Календарь»): who pays today and who is late, as lists to call from, then
  // the calendar; the month's figures are an owner's tab of their own.
  schedule: [
    { id: 'due', path: '/schedule', anyOf: ['payments.schedule'] },
    { id: 'late', path: '/schedule/late', anyOf: ['payments.schedule'] },
    { id: 'calendar', path: '/schedule/calendar', anyOf: ['payments.schedule'] },
    { id: 'month', path: '/schedule/month', anyOf: ['payments.view'] },
  ],
  // «Разобрать» (issue #15; was a tab of Money): a manager sorts the money
  // coming in; going out, the rules' work and the lines taken out are an owner's.
  sort: [
    { id: 'sortIn', path: '/sort', anyOf: ['payments.sort.customer'] },
    { id: 'sortOut', path: '/sort/out', anyOf: ['payments.reconcile'] },
    { id: 'byRules', path: '/sort/rules', anyOf: ['payments.reconcile'] },
    { id: 'aside', path: '/sort/aside', anyOf: ['payments.reconcile'] },
  ],
  // The till by person and one's own payments: a manager's money, and since
  // issue #15 an owner's daily section too — he accepts the cash handed over.
  // «Мои платежи» is not an owner's tab since issue #18 (B6): whoever reads
  // «Деньги → Платежи» has his own payments there, filtered, and a second
  // list of the same money was a duplicate (the director's audit, 25.10.2026).
  cash: [
    { id: 'till', path: '/money/cash', anyOf: ['cash.record'] },
    { id: 'mine', path: '/money/mine', anyOf: ['cash.record'], noneOf: ['payments.view'] },
  ],
  // The customers beside the rentals (issue #15): they were in the avatar menu.
  rentals: [
    { id: 'rentals', path: '/rentals', anyOf: ['fleet.view'] },
    { id: 'customers', path: '/customers', anyOf: ['fleet.view'] },
  ],
  // What is left of Money (wave 2 §3.0, issue #15): the journal of payments,
  // the statements, the deposits — an owner's.
  money: [
    { id: 'payments', path: '/money/payments', anyOf: ['payments.view'] },
    { id: 'statements', path: '/money/statements', anyOf: ['payments.reconcile'] },
    { id: 'deposits', path: '/money/deposits', anyOf: ['payments.view'] },
  ],
  // Settings grew from one page to six tabs in wave 6 (§3.4–3.9): the people,
  // what a hand-over proposes, the journal, what the move from Odoo left, and
  // the rules of signing in. The points were a tab here too (Mika, 29.09.2026)
  // — one page on two addresses; since issue #18 (B6) they live in «Мопеды →
  // Точки» alone, and `/settings/points` leads there.
  settings: [
    { id: 'people', path: '/settings', anyOf: ['users.manage'] },
    { id: 'rental', path: '/settings/rental', anyOf: ['settings.manage'] },
    // The workshop's rate and the planned-maintenance interval (stage 6, ADR-0038),
    // and the workshops that do the repairs (task #1 of 21.10.2026).
    { id: 'repair', path: '/settings/repair', anyOf: ['settings.manage'] },
    // What money going out was for (migration 0046) — «Статьи расходов».
    { id: 'expenseItems', path: '/settings/expenses', anyOf: ['settings.manage'] },
    // What money coming in that is no customer's was: «Прочий доход» (migration 0069) — «Статьи доходов».
    { id: 'incomeItems', path: '/settings/incoming', anyOf: ['settings.manage'] },
    // The rentals folders in Google Drive beside the rentals here (ADR-0031).
    { id: 'drive', path: '/settings/drive', anyOf: ['users.manage'] },
    { id: 'journal', path: '/settings/journal', anyOf: ['users.manage'] },
    { id: 'migration', path: '/settings/migration', anyOf: ['users.manage'] },
    { id: 'login', path: '/settings/login', anyOf: ['users.manage'] },
  ],
  // The orders, and the factories they go to (Mika, 28.09.2026): a supplier
  // is looked up where it is ordered from and paid, not in a menu of its own.
  purchases: [
    { id: 'orders', path: '/purchases', anyOf: ['purchases.view'] },
    { id: 'suppliers', path: '/purchases/suppliers', anyOf: ['purchases.view'] },
  ],
  // Mopeds and goods (issue #11, ADR-0045): a part or a charger sold over the
  // counter is a sale of its own, beside the mopeds.
  sales: [
    { id: 'vehicles', path: '/sales', anyOf: ['fleet.view'] },
    { id: 'goods', path: '/sales/goods', anyOf: ['fleet.view'] },
  ],
  // «Склад» (issue #19): the parts — were «Ремонты → Склад» — and the
  // batteries and chargers — were «Мопеды → Батареи и зарядки».
  stock: [
    { id: 'parts', path: '/stock', anyOf: ['fleet.view'] },
    { id: 'batteries', path: '/stock/batteries', anyOf: ['fleet.view'] },
  ],
  // The week first: it is what an owner opens Reports for (wave 6 §3.1).
  reports: [
    { id: 'week', path: '/reports/week', anyOf: ['reports.view'] },
    { id: 'utilisation', path: UTILISATION_PATH, anyOf: ['reports.view'] },
    { id: 'economics', path: '/reports/economics', anyOf: ['reports.view'] },
    // What left the accounts, by category (migration 0046).
    { id: 'expenses', path: '/reports/expenses', anyOf: ['reports.view'] },
    // What came into them, by what it was (migration 0069).
    { id: 'incoming', path: '/reports/incoming', anyOf: ['reports.view'] },
  ],
};

export function tabsFor(section: SectionId, permissions: readonly Permission[]) {
  return (SECTION_TABS[section] ?? []).filter((t) => allowed(t, permissions));
}

/**
 * The tabs drawn: a section's tabs, less one with nothing left in it —
 * «До EV8 Ops» once its lists are empty (issue #18, B6; the director's audit
 * read 0 deposits and 0 rentals without a VIN on 25.10.2026). It stays while
 * the counts have not come, and while it is the address open: a strip whose
 * open tab vanished under the reader would be worse than the tab.
 */
export function tabsShown(section: SectionId, permissions: readonly Permission[], counts: NavCounts | null | undefined, pathname: string) {
  return tabsFor(section, permissions).filter((t) => t.id !== 'migration' || t.path === pathname || counts?.migration == null || counts.migration > 0);
}

export type ActionId = 'pickup' | 'return' | 'swap' | 'takeMoney' | 'takeCash' | 'newCustomer' | 'openRepair' | 'reportBreak' | 'sell' | 'sellGoods';

/**
 * What the "+" offers, most frequent first (wave 1 §3.2). Since issue #18
 * (B2) the hand-over, the return and the swap say one set of words —
 * «Выдать мопед», «Вернуть мопед», «Заменить мопед» — wherever they stand.
 */
export const ACTIONS: readonly ({ id: ActionId; path: string } & NavRule)[] = [
  { id: 'pickup', path: '/rentals/new', anyOf: ['rental.create'] },
  { id: 'return', path: '/rentals/return', anyOf: ['rental.return'] },
  // «Заменить мопед» (issue #18, B2): pick the rental, then the swap wizard
  // of ADR-0040 — a return and a hand-over in one, so both rights, as the
  // rental card's «⋯» asks them.
  { id: 'swap', path: '/rentals/swap', anyOf: [], allOf: ['rental.create', 'rental.return'] },
  // Third on the "+" (wave 2 §3.0): the one money form, opened over the money section.
  { id: 'takeMoney', path: '/money/payments?take=1', anyOf: ['payments.reconcile'] },
  { id: 'takeCash', path: '/money/cash?take=1', anyOf: ['cash.record'], noneOf: ['payments.reconcile'] },
  { id: 'newCustomer', path: '/customers/new', anyOf: ['customer.create'] },
  { id: 'openRepair', path: '/service?new=1', anyOf: ['service.manage'] },
  // A manager says a moped is broken and no more than that (wave 5 §3.7);
  // an owner opens the repair itself, so they see the other one.
  { id: 'reportBreak', path: '/service?report=1', anyOf: ['service.report'], noneOf: ['service.manage'] },
  // A moped sold by the owner and, since issue #18 (B8), by the manager too.
  { id: 'sell', path: '/sales/new', anyOf: ['sales.create'] },
  // A part or a charger over the counter: the owner and the manager (ADR-0045).
  { id: 'sellGoods', path: '/sales/goods/new', anyOf: ['goods.sell'] },
];

export function actionsFor(permissions: readonly Permission[]) {
  return ACTIONS.filter((a) => allowed(a, permissions));
}

/** Which section an address belongs to, for the lit item and the header title. */
export function sectionOfPath(pathname: string, permissions?: readonly Permission[]): SectionId {
  const first = pathname.split('/')[1] ?? '';
  if (first === '') return 'today';
  if (first === 'money') {
    // The till and one's own payments are the till's section, for everybody
    // since issue #15. A payment's page is Money's — or, for whoever does not
    // read Money, the till's: it is reached from «Мои платежи».
    if (pathname.startsWith('/money/cash') || pathname.startsWith('/money/mine')) return 'cash';
    const owner = permissions ? permissions.includes('payments.view') : true;
    return !owner && pathname.startsWith('/money/payments/') ? 'cash' : 'money';
  }
  const known: Record<string, SectionId> = {
    schedule: 'schedule',
    sort: 'sort',
    rentals: 'rentals',
    customers: 'rentals',
    fleet: 'fleet',
    service: 'service',
    sales: 'sales',
    stock: 'stock',
    purchases: 'purchases',
    reports: 'reports',
    settings: 'settings',
  };
  return known[first] ?? 'today';
}

/**
 * Old addresses and where they live now (build plan Р8, wave 1 §3.4; issue
 * #15 moved the calendar and «Разобрать» out of Money, issue #19 the shelf
 * out of the repairs and the mopeds). A bookmark on the old one still
 * arrives; the query goes along. `/stock` was itself an old address of the
 * repairs' shelf until #19 made it the section's own.
 */
export const REDIRECTS: readonly { from: string; to: string }[] = [
  { from: '/models', to: '/fleet/models' },
  { from: '/models/:id', to: '/fleet/models/:id' },
  { from: '/service/stock', to: '/stock' },
  { from: '/service/stock/parts/:id', to: '/stock/parts/:id' },
  { from: '/fleet/batteries', to: '/stock/batteries' },
  { from: '/payments', to: '/money/payments' },
  { from: '/statements', to: '/money/statements' },
  { from: '/economics', to: '/reports/economics' },
  { from: '/profile', to: '/me' },
  { from: '/money', to: '/money/payments' },
  { from: '/money/calendar', to: '/schedule/calendar' },
  { from: '/money/sort', to: '/sort' },
  { from: '/money/sort/rules', to: '/sort/rules' },
  { from: '/money/sort/aside', to: '/sort/aside' },
  // The points in one place (issue #18, B6).
  { from: '/settings/points', to: '/fleet/points' },
];

/**
 * Where an old address with its query goes. One case is not a path's: the
 * money going out was `/money/sort?d=out` and is a tab of its own now.
 */
export function movedTo(from: string, search: string): string {
  const rule = REDIRECTS.find((r) => r.from === from);
  const to = rule?.to ?? from;
  const q = new URLSearchParams(search);
  if (to === '/sort' && q.get('d') === 'out') {
    q.delete('d');
    const rest = q.toString();
    return `/sort/out${rest ? `?${rest}` : ''}`;
  }
  return to + search;
}

export const sectionsForRole = (role: Role) => sectionsFor(ROLE_PERMISSIONS[role]);
export const groupHeadingForRole = (group: GroupId, role: Role) => groupHeadingFor(group, ROLE_PERMISSIONS[role]);
export const phoneTabsForRole = (role: Role) => phoneTabsFor(ROLE_PERMISSIONS[role]);
export const menuSectionsForRole = (role: Role) => menuSectionsFor(ROLE_PERMISSIONS[role]);
