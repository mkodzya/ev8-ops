import { parseGel } from './money.js';

/**
 * How the search in the header understands what was typed (wave 1 §3.5).
 * Pure, so the API and the tests read one rule.
 *
 * - Names: any spelling on the card — the main name, the Georgian one, the
 *   Latin one — a part anywhere, case ignored.
 * - Phones: the digits typed, anywhere in the digits of the number, spaces,
 *   dashes and the +995 prefix ignored.
 * - VIN: the last characters, from two.
 * - Numbers of records: R-00441, SL-…, PO-…, SV-… — or just the digits.
 * - Money: "150", "150.00", "150,5" — the exact amount.
 */

export const SEARCH_MIN = 2;
export const SEARCH_GROUP_LIMIT = 3;

export interface Query {
  text: string; // trimmed, lower case
  digits: string; // only the digits, +995 prefix dropped when the rest is a phone
  amountTetri: number | null;
}

export function readQuery(raw: string): Query | null {
  const text = raw.trim().toLowerCase();
  if (text.length < SEARCH_MIN) return null;
  let digits = text.replace(/\D/g, '');
  // +995 typed in front of a number is the country, not part of what to find.
  if (digits.startsWith('995') && digits.length >= 6) digits = digits.slice(3);
  const looksLikeMoney = /^\d+([.,]\d{1,2})?$/.test(text.replace(/\s/g, ''));
  return { text, digits, amountTetri: looksLikeMoney ? parseGel(text) : null };
}

const has = (value: string | null | undefined, text: string) => !!value && value.toLowerCase().includes(text);

export function spellingMatches(q: Query, spellings: (string | null | undefined)[]): boolean {
  return spellings.some((s) => has(s, q.text));
}

/** Digits of a phone number, typed any way, contain what was typed — three digits at least, so "15" is not every phone. */
export function phoneMatches(q: Query, phone: string | null | undefined): boolean {
  if (!phone || q.digits.length < 3) return false;
  return phone.replace(/\D/g, '').includes(q.digits);
}

/** The VIN ends with what was typed (two characters and more). */
export function vinMatches(q: Query, vin: string | null | undefined): boolean {
  if (!vin) return false;
  const tail = q.text.replace(/\s/g, '').toUpperCase();
  return tail.length >= SEARCH_MIN && vin.toUpperCase().endsWith(tail);
}

/** R-00441, r-441, 441 — the record number, prefix optional, zeros optional. */
export function numberMatches(q: Query, number: string): boolean {
  if (has(number, q.text)) return true;
  if (!q.digits) return false;
  const own = number.replace(/\D/g, '');
  return Number(own) === Number(q.digits) && q.digits.length >= 2;
}

/**
 * One payment against a query — the header search and the payments list use
 * this same rule, so "Ещё N" opens a list of exactly N (QA-W1-05): the amount,
 * whoever paid or recorded it, the bank's text and the note, the rental number.
 */
export function paymentMatches(
  q: Query,
  p: { grossTetri: number; customer?: string | null; bankText?: string | null; note?: string | null; createdBy?: string | null; rentalNumber?: string | null },
): boolean {
  return (
    (q.amountTetri != null && p.grossTetri === q.amountTetri) ||
    spellingMatches(q, [p.customer, p.bankText, p.note, p.createdBy]) ||
    (!!p.rentalNumber && numberMatches(q, p.rentalNumber))
  );
}
