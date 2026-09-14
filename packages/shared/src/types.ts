// Vocabulary shared by every part of EV8 Ops. Strings here are what the
// database stores (enums in migration 0001); the words a person reads come
// from the web dictionaries, never from these values.

/** Five roles, fixed in code (spec §3): rights come from the role, not the person. */
export const ROLES = ['owner', 'director', 'manager', 'mechanic', 'accountant'] as const;
export type Role = (typeof ROLES)[number];

/** Vehicle state, derived from events (spec FLT-03); brand.md fixes colour + label per state. */
export const VEHICLE_STATES = ['available', 'rented', 'service', 'out', 'sold'] as const;
export type VehicleState = (typeof VEHICLE_STATES)[number];

/** What moves a vehicle between states. `manual` always carries a reason. */
export const VEHICLE_EVENT_KINDS = [
  'arrived',
  'pickup',
  'return',
  'service_in',
  'service_out',
  'sold',
  'bought_back',
  'written_off',
  'manual',
] as const;
export type VehicleEventKind = (typeof VEHICLE_EVENT_KINDS)[number];

export const RENTAL_STATUSES = ['booked', 'active', 'overdue', 'paused', 'returned', 'disputed'] as const;
export type RentalStatus = (typeof RENTAL_STATUSES)[number];

export const PERIOD_PAY_STATUSES = ['unpaid', 'partial', 'paid'] as const;
export type PeriodPayStatus = (typeof PERIOD_PAY_STATUSES)[number];

export const DEPOSIT_STATUSES = ['held', 'returned', 'withheld', 'partial'] as const;
export type DepositStatus = (typeof DEPOSIT_STATUSES)[number];

export const ACT_KINDS = ['pickup', 'return'] as const;
export type ActKind = (typeof ACT_KINDS)[number];

export const CUSTOMER_KINDS = ['person', 'sole_trader', 'company'] as const;
export type CustomerKind = (typeof CUSTOMER_KINDS)[number];

/** Interface languages. Georgian first: it is the team's language (spec §8). */
export const LOCALES = ['ka', 'ru', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'ka';

/** The company clock. Rental periods are calendar days in this zone. */
export const ORG_TZ = 'Asia/Tbilisi';

/** YYYY-MM-DD. Dates in this system are calendar dates, not instants. */
export type ISODate = string;
