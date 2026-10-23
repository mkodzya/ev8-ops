// Typed text in the reader's language (ADR-0042; Mika, 21.10.2026).
//
// What a person types — why a moped went to service, what broke, what a
// mechanic did — is written in whatever language that person writes in, and
// read by somebody who may read another. Mika answered two questions on
// 21.10.2026: the texts are translated by Claude (Haiku 5.5), and only the
// texts about mopeds and repairs ever leave EV8 Ops for it — answer A:
// «Тексты о клиентах, арендах, платежах, залогах, банке, продажах и закупках
// не отправляются никогда».
//
// The original stays the record (CLAUDE.md rule 1): a translation is a view of
// it, marked on screen as one, and a tap shows what was typed. Search, CSV,
// PDFs and Telegram keep the original.
//
// Here are the rules the API, the worker's job and the screens must agree on:
// which texts may go out at all, which are worth a request, how a stock
// movement's reason reads on a screen, and which words a reader is shown.

import type { Locale } from './types.js';

/** The language a typed text was written in; `other` is none of the three. */
export const TEXT_LANGS = ['ka', 'ru', 'en', 'other'] as const;
export type TextLang = (typeof TEXT_LANGS)[number];

/**
 * A ready translation: the language the text was written in, and the text in
 * each of the three. Its own language is empty — the original is shown for it.
 */
export interface TextTranslation {
  lang: TextLang;
  ka: string | null;
  ru: string | null;
  en: string | null;
}

/**
 * Every column whose words may be sent to the translator, and nothing else
 * (answer A). Each is a person's words about a moped or a repair: why its
 * state changed, what happened, the mechanic's works, notes and refusals,
 * why a part or a battery moved, the notes on a moped, a point, a workshop —
 * and the journal lines that carry those same reasons.
 *
 * The API reads the texts by this list and by nothing else: its sources are
 * keyed by these names, so a source missing here does not compile. A rental's
 * notes are one line away (Mika was told so) — and only Mika adds that line.
 *
 * A point's note and a closed repair's odometer reason are allowed by the
 * answer too, but no screen shows them as text yet (a point's note is only
 * the input it is edited in), so sending them would pay for words nobody
 * reads. Each comes back here with the screen that shows it.
 */
export const TRANSLATED_SOURCES = [
  'vehicle_events.reason',
  'vehicles.notes',
  'service_jobs.reason',
  'service_jobs.notes',
  'service_jobs.reject_reason',
  'service_jobs.odometer_reason',
  'service_works.free_text',
  'service_works.reject_reason',
  'service_parts.reject_reason',
  'stock_moves.reason',
  'battery_moves.reason',
  'battery_inventories.reason',
  'workshops.note',
  'audit_log.note',
] as const;
export type TranslatedSource = (typeof TRANSLATED_SOURCES)[number];

/**
 * The tables whose words never leave EV8 Ops: customers and people, rentals,
 * money of every kind, the bank, sales and purchases. A test holds the list
 * above apart from this one.
 */
export const NEVER_TRANSLATED_TABLES = [
  'users',
  'customers',
  'rentals',
  'rental_periods',
  'rental_charges',
  'acts',
  'deposits',
  'deposit_withholdings',
  'payments',
  'payment_allocations',
  'statements',
  'statement_lines',
  'statement_line_expense_parts',
  'expense_categories',
  'expense_rules',
  'cash_handovers',
  'bank_cash_deposits',
  'mechanic_payouts',
  'sales',
  'sale_instalments',
  'purchases',
  'purchase_lines',
  'files',
] as const;

/**
 * The state changes whose reason is a person's words about the moped. A
 * pickup and a return are a rental's, a sale and a buy-back a sale's, an
 * arrival a purchase's or the import's: their reasons stay here.
 */
export const TRANSLATED_EVENT_KINDS = ['manual', 'service_in', 'service_out', 'written_off', 'to_rent', 'to_sale'] as const;

/**
 * The journal lines whose note is the reason a person typed for a moped, a
 * repair or a battery count — the same words the record keeps, so most of
 * them are one translation with it. A repair paid or unpaid is money; a
 * customer's file is a customer's: neither is here.
 */
export const TRANSLATED_JOURNAL_LINES: readonly { action: string; entityType: string }[] = [
  { action: 'vehicle.state.manual', entityType: 'vehicle' },
  { action: 'vehicle.pool', entityType: 'vehicle' },
  { action: 'vehicle.vin', entityType: 'vehicle' },
  { action: 'service.reject', entityType: 'service_job' },
  { action: 'service.cancel', entityType: 'service_job' },
  { action: 'file.archive', entityType: 'service_job' },
  { action: 'battery.inventory', entityType: 'battery' },
  { action: 'battery.move', entityType: 'battery' },
  { action: 'charger.inventory', entityType: 'charger' },
  { action: 'charger.move', entityType: 'charger' },
];

/**
 * Reasons the code writes into a moped's or a repair's record with a rental's
 * or a sale's words inside. They sit in sources above and still never go out:
 * - a return undone carries the rental's reason, a sale called off the sale's,
 *   a buy-back the sale's number;
 * - a moped handed to a renter for the first time, or into a rental by a swap,
 *   joins the rental park «hand-over R-00012» / «swap R-00012»;
 * - a repair a return or a swap opens says what the act found, behind the
 *   rental's number — «R-00012: …»: the act's words are the rental's
 *   (`acts` never leaves), and so is the swap's reason it falls back on. The
 *   same words reach the moped's history when the repair takes it out;
 * - a goods sale (ADR-0045) writes on the part's or the charger's movement the
 *   owner's words for calling it off — «TS-00004 cancelled: …»
 *   (`goodsCancelReason`) — and for selling a charger beyond the count,
 *   «TS-00004: …»: a sale's words, not a repair's (amendment of 23.10.2026).
 */
const NEVER_STARTS = [/^return undone:/, /^sale SL-/, /^bought back under SL-/, /^hand-over R-\d/, /^swap R-\d/, /^R-\d+: /, /^TS-\d+ cancelled: /, /^TS-\d+: /];

/** Longer than this is not a note; it stays as typed rather than run up a bill. */
export const MAX_TRANSLATED_CHARS = 2000;

/** Three letters in a row, in any script: a word. */
const A_WORD = /\p{L}{3}/u;
const SPACE = /\s/;
const DIGIT = /\d/;

/**
 * Is this text worth a translation? It has a word in it, is not one lone code
 * — a VIN, an IMEI, `SV-00012`, `EV-0012` — and does not carry a rental's or a
 * sale's words. The screens ask only for these, and the job sends only these.
 */
export function translatable(text: string | null | undefined): boolean {
  const s = (text ?? '').trim();
  if (s.length < 3 || s.length > MAX_TRANSLATED_CHARS) return false;
  if (NEVER_STARTS.some((p) => p.test(s))) return false;
  if (!A_WORD.test(s)) return false;
  if (!SPACE.test(s) && DIGIT.test(s)) return false;
  return true;
}

/**
 * A stock movement's reason as the part's card shows it, when it says
 * anything: `initial` is the shelf's own code for an opening balance, a
 * receipt carries its order's number (linked beside it), and a movement of a
 * repair starts with the repair's number, linked beside it too. The card and
 * the translator read the same words through this, or the card would ask for
 * a text nobody translated.
 */
export function stockReasonText(reason: string | null | undefined, refs: { job?: string | null; purchase?: string | null } = {}): string | null {
  const s = (reason ?? '').trim();
  if (!s || s === 'initial') return null;
  if (refs.purchase && s === refs.purchase) return null;
  if (refs.job && s.startsWith(`${refs.job}: `)) return s.slice(refs.job.length + 2) || null;
  return s;
}

/**
 * The words a reader in `locale` is shown instead of the original, or null
 * when the original is what they read: written in their language, not
 * translated yet, or translated into everything but theirs.
 */
export function translationFor(t: TextTranslation | null | undefined, locale: Locale): string | null {
  if (!t || t.lang === locale) return null;
  const words = t[locale]?.trim();
  return words ? words : null;
}
