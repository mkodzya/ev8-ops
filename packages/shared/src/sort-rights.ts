import type { Permission } from './permissions.js';

// Who may give which answer in «Разобрать» (issue #15 of the director,
// 25.10.2026; ADR-0048). The manager works at a laptop on the spot and sorts
// the customers' money coming in: a line linked to a rental, a deposit, a
// moped sale, goods or a repair, and «Несколько услуг» made of those. What is
// no customer's — «Не наше», a company expense, «Между счетами», «Взнос
// учредителя», other income — taking a line out of the queue, putting one
// back, and letting go of a link somebody else made stay the owners'
// (`payments.reconcile`). One rule for the server, which refuses, and for the
// screen, which shows only the answers a person may give.

/** The answers under a line coming in (issue #13, ADR-0046), as the panel names them. */
export const INCOME_ANSWERS = [
  'rental',
  'deposit',
  'sale',
  'goods',
  'repair',
  'customer',
  'bank_deposit',
  'several',
  'own_transfer',
  'founder_equity',
  'other_income',
  'not_ours',
] as const;
export type IncomeAnswer = (typeof INCOME_ANSWERS)[number];

/**
 * The customers' money, in the director's words: «аренда, залог, продажа
 * мопеда, товары, ремонт» and «Несколько услуг» of the same. An advance on a
 * customer's account and cash an owner took to the bank are not in his list.
 */
export const CUSTOMER_ANSWERS: readonly IncomeAnswer[] = ['rental', 'deposit', 'sale', 'goods', 'repair', 'several'];

/** The answers this person may give to a line coming in, in the panel's order. */
export function incomeAnswersFor(permissions: readonly Permission[]): IncomeAnswer[] {
  if (permissions.includes('payments.reconcile')) return [...INCOME_ANSWERS];
  if (permissions.includes('payments.sort.customer')) return [...CUSTOMER_ANSWERS];
  return [];
}

/**
 * What a line, or one part of it, pays — the fields of «assign» and of a part
 * of «split» (`LineTarget` and `NewFine` in the API).
 */
export const LINE_TARGETS = ['rentalId', 'depositRentalId', 'saleId', 'goodsSaleId', 'serviceJobId', 'chargeId', 'carriedPeriodId', 'customerId', 'fineRentalId'] as const;
export type LineTargetField = (typeof LINE_TARGETS)[number];

/**
 * The records `payments.sort.customer` may put money on: a rental (its weeks,
 * or a week carried over as paid), its deposit, a moped sale, a goods sale, a
 * repair or a charge already on a rental. Money on the customer's account
 * (`customerId`) is no record of his list, and a new fine is a charge decided
 * (`deposit.decide`): both the owners'.
 */
export const CUSTOMER_TARGETS: readonly LineTargetField[] = ['rentalId', 'depositRentalId', 'saleId', 'goodsSaleId', 'serviceJobId', 'chargeId', 'carriedPeriodId'];

const named = (target: Partial<Record<string, unknown>>): LineTargetField[] =>
  LINE_TARGETS.filter((f) => {
    const v = target[f];
    return v != null && v !== '' && v !== false;
  });

/**
 * May this person write this part? An owner anything; whoever sorts the
 * customers' money only a part that names his kind of record and nothing else.
 * A part that names nothing is no record of anybody's — the server's own rules
 * refuse it with their words, this says only who.
 */
export function maySortTo(permissions: readonly Permission[], target: Partial<Record<string, unknown>>): boolean {
  if (permissions.includes('payments.reconcile')) return true;
  if (!permissions.includes('payments.sort.customer')) return false;
  const fields = named(target);
  return fields.length > 0 && fields.every((f) => CUSTOMER_TARGETS.includes(f));
}

/**
 * The kinds of a payment entered by hand that a line coming in may be linked
 * to by whoever sorts the customers' money («Похоже, уже записан»): rent, a
 * sale, a repair, goods. An advance stays with the owners, as above.
 */
export const CUSTOMER_PAYMENT_KINDS = ['rent', 'sale', 'service', 'goods'] as const;

export function mayLinkPayment(permissions: readonly Permission[], kind: string): boolean {
  if (permissions.includes('payments.reconcile')) return true;
  return permissions.includes('payments.sort.customer') && (CUSTOMER_PAYMENT_KINDS as readonly string[]).includes(kind);
}

/**
 * «Отвязать»: an owner lets go of any line; whoever sorts the customers' money
 * only of one whose every payment he wrote himself from the line — not a rule's
 * link, not a link to money somebody entered by hand, not a colleague's.
 */
export function mayUnlink(permissions: readonly Permission[], payments: readonly { source: string; createdById: string | null }[], me: string): boolean {
  if (permissions.includes('payments.reconcile')) return true;
  if (!permissions.includes('payments.sort.customer')) return false;
  return payments.length > 0 && payments.every((p) => p.source === 'statement' && p.createdById === me);
}

/** «Запомнить для „…“» sorts the payer's next lines by itself: a standing rule, the owners' to set (ADR-0048). */
export function mayRemember(permissions: readonly Permission[]): boolean {
  return permissions.includes('payments.reconcile');
}
