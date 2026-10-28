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
  // Make the latest week longer or shorter, with a reason (ADR-0041): an
  // owner's from 21.10.2026, a manager's too since Mika's «А» of 23.10.2026
  // (issue #12) — the journal keeps who and why, and an owner takes it back.
  'rental.week.shift',
  'customer.create',
  'customer.documents.view', // ID and licence photos, the personal number (CST-03)
  'cash.record', // take cash from a customer (PAY-05)
  'payments.view', // every payment, not only the cash one took oneself
  'payments.reconcile', // statements, unmatched queue (PAY-01..03)
  // «Оплаты по графику» (issue #15, ADR-0048): who owes what and when, row by
  // row, with WhatsApp, a call and «Провести вручную» — the sums of a week, a
  // month or a day stay with `payments.view`.
  'payments.schedule',
  // «Разобрать» for the customers' money (issue #15, ADR-0048): a line coming
  // in linked to a rental, a deposit, a moped sale, goods or a repair, or
  // spread over those in «Несколько услуг». Every other answer stays with
  // `payments.reconcile` (`SORT_ANSWERS`, navigation of the queue).
  'payments.sort.customer',
  'cost.view', // unit cost, stock value, landed cost: the owners' numbers (redesign §2.1)
  'purchases.view', // orders and suppliers
  'purchases.manage', // place an order, pay a factory, receive a shipment (wave 5 §3.4–3.6)
  'service.report', // report a breakdown: a manager may say a moped is broken (wave 5 §3.7)
  'service.manage', // repair jobs (SRV-01), and the parts catalogue
  // The workshop (ADR-0033). Seeing a repair is not seeing the fleet: a
  // mechanic reads repairs and none of the customers, payments or cost.
  'service.view', // repair jobs without the customers' money
  'service.work', // carry one's own repair job from the workshop tablet
  'service.approve', // approve a repair before the work starts
  'service.norms', // the book of works and their norm times
  'service.payout', // mark a mechanic's work paid
  'stock.count', // correct a count by hand — a stock-take
  // Make a moped sale — today, from the sale park or none — print and sign its
  // paper, and take its money as the money form lets the role (issue #18 B8,
  // Mika's «Да, без отмены» of 28.10.2026): a manager's too.
  'sales.create',
  // Cancel a moped sale, buy the moped back, move its day or its schedule, edit
  // it after it is made (SAL-01..03); a goods sale dated back, cancelled or its
  // buyer edited — an owner's.
  'sales.manage',
  'goods.sell', // sell a part or a charger over the counter, print its invoice (issue #11, ADR-0045)
  // Return or keep a deposit. One owner decides; there is no second confirmation (D18).
  'deposit.decide',
  'reports.view',
  'settings.manage', // models, tariffs, points
  'users.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * A manager hands mopeds over and takes them back, opens a customer, takes
 * cash, says where a moped stands and sells goods over the counter (ADR-0045),
 * and moves a renter's latest week when his pay day moves (ADR-0041, addendum
 * of 23.10.2026). Since issue #15 (ADR-0048, Mika's «начинай» of 25.10.2026)
 * he also calls those who pay by the schedule and sorts the customers' money
 * coming in; since issue #18 (Mika's «Да, без отмены» of 28.10.2026) he sells
 * a moped too — cancelling it, buying it back and moving its day stay an
 * owner's. Deciding a deposit, repairs, money beyond that, cost, purchases,
 * reports and settings are the owners' (redesign blueprint §2.1, Mika
 * 17.09.2026).
 */
const MANAGER: Permission[] = [
  'fleet.view',
  'fleet.location.set',
  'fleet.state.manual',
  'rental.create',
  'rental.return',
  'rental.week.shift',
  'customer.create',
  'cash.record',
  'payments.schedule',
  'payments.sort.customer',
  'service.report',
  'service.view',
  'goods.sell',
  'sales.create',
];

/**
 * A mechanic opens, carries and closes their own repairs and sees no one
 * else's; the chief mechanic sees every repair, approves them and keeps the
 * norms. Neither sees the fleet, a customer, a payment, a deposit or what
 * anything cost (ADR-0033 §2). Marking a mechanic paid is the owners'.
 */
const MECHANIC: Permission[] = ['service.view', 'service.work'];
const CHIEF_MECHANIC: Permission[] = [...MECHANIC, 'service.approve', 'service.norms'];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  manager: MANAGER,
  mechanic: MECHANIC,
  chief_mechanic: CHIEF_MECHANIC,
};

export function roleCan(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/**
 * Every repair, or only one's own? Whoever sees the fleet or approves repairs
 * sees them all; a mechanic sees the jobs that are theirs (ADR-0033 §2). Asked
 * of the rights, not the role's name, like everything else here.
 */
export function seesEveryRepair(permissions: readonly Permission[]): boolean {
  return permissions.includes('fleet.view') || permissions.includes('service.approve');
}

/**
 * A sum of many customers' money or debt together — the overdue of all the
 * renters, what the sales or the goods still wait for, what came in over a
 * list of payments — is read by whoever reads Money (`payments.view`), as the
 * week's and the month's figures of «Оплаты по графику» are (ADR-0048). A
 * manager reads the rows: one customer's debt, one rental's, one sale's
 * (Mika's «да» of 25.10.2026, ADR-0048 addendum). Asked of the rights, so the
 * server cuts the sum before it is sent and the screen asks the same thing.
 */
export function seesTotals(permissions: readonly Permission[]): boolean {
  return permissions.includes('payments.view');
}

/** Roles that sign in with a PIN on the workshop tablet; nobody else has one (ADR-0033 §6). */
export const PIN_ROLES: readonly Role[] = ['mechanic', 'chief_mechanic'];

/**
 * What a session opened with a PIN on the workshop tablet may reach: the
 * repair screens and nothing else (ADR-0033 §7), whatever the role allows on
 * a phone. Paying a mechanic is not done from the workshop.
 */
export const PIN_SESSION_PERMISSIONS: readonly Permission[] = ['service.view', 'service.work', 'service.approve', 'service.norms'];

/** PIN rules — code, like the other sign-in rules (wave 6 §3.9, Q30; ADR-0033 §7). */
export const PIN_MIN_DIGITS = 4;
export const PIN_MAX_DIGITS = 6;
export const PIN_MAX_FAILURES = 5;
export const PIN_LOCK_MINUTES = 15;
export const PIN_IDLE_MINUTES = 10;
