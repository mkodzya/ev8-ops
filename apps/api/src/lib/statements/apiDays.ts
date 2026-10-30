import { addDays, todayISO } from '@ev8/shared';
import type { BankApiAccount } from '../../generated/prisma/client.js';
import { dateFromISO, isoDate } from '../dates.js';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { ingest, knownLines } from './import.js';
import type { ParsedLine } from './parse.js';

// What the two banks read by their APIs have in common (B11-03; ADR-0021 for
// Bank of Georgia, ADR-0026 for TBC): a day of an account becomes one
// statement in the list, its new lines go into the queue a CSV upload feeds,
// and the days an uploaded file covers in full are not read again.
//
// An account is read in each currency it is named in (docs/spec/usd-accounts-
// plan.md): every pair of account and currency on its own, with a row of its
// own in `bank_api_accounts` for when it last answered and how far its night
// has come, so that one the bank refuses keeps nothing of the others back.

export type ApiBank = 'bog' | 'tbc';

/**
 * A day as a bank writes it: `2026-10-14T00:00:00` is that day as written;
 * a moment with its zone is the day it was in Tbilisi; `14.10.2026` is read
 * too. An empty date of a .NET serializer (`0001-01-01`) is no date.
 */
export function bankDay(v: unknown, tz: string = env.TZ): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  const ms = /^\/Date\((-?\d+)/.exec(s);
  let day: string | null = null;
  if (ms) day = todayISO(new Date(Number(ms[1])), tz);
  const iso = /^(\d{4})-(\d{2})-(\d{2})(T[\d:.]+)?(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (iso) day = iso[4] && iso[5] ? todayISO(new Date(s), tz) : `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{2})[./](\d{2})[./](\d{4})/.exec(s);
  if (dmy) day = `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  if (!day || day < '2000-01-01' || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) return null;
  return day;
}


const IBAN = /^GE\d{2}[A-Z]{2}\d{16}$/;

/**
 * The currencies an account read by a bank's API may be in: lari, and the
 * dollars and euros kept apart from it (Mika, 29.10.2026, decision D1 of
 * docs/spec/usd-accounts-plan.md). The database takes any currency code; this
 * list is what the stand agrees to read.
 */
export const BANK_CURRENCIES = ['GEL', 'USD', 'EUR'] as const;
export type BankCurrency = (typeof BANK_CURRENCIES)[number];

/**
 * An account as a bank's API takes it: the IBAN, without the currency a
 * statement file may write after it (`GE…BG…GEL`). With a bank code, only an
 * account of that bank (`BG`, `TB`). Null when it is not one.
 */
export function accountOf(raw: string | null | undefined, bankCode?: string): string | null {
  const t = (raw ?? '').replace(/\s+/g, '').toUpperCase();
  const iban = t.slice(0, 22);
  if (!IBAN.test(iban) || !/^([A-Z]{3})?$/.test(t.slice(22))) return null;
  return !bankCode || iban.slice(4, 6) === bankCode ? iban : null;
}

/**
 * An account and the currency it is read in, written as Bank of Georgia writes
 * it in a statement file: `GE…BG…USD`. No currency after the IBAN is lari, as
 * every stand's env has it today. With a bank code, only an account of that
 * bank. Null when it is not one, or its currency is not one the stand reads.
 */
export function accountPairOf(raw: string | null | undefined, bankCode?: string): AccountPair | null {
  const iban = accountOf(raw, bankCode);
  if (!iban) return null;
  const currency = (raw ?? '').replace(/\s+/g, '').toUpperCase().slice(22) || 'GEL';
  return (BANK_CURRENCIES as readonly string[]).includes(currency) ? { iban, currency: currency as BankCurrency } : null;
}

/** An account and the currency a bank's API reads it in: what the stand reads, keeps the state of and logs, one by one. */
export interface AccountPair {
  iban: string;
  currency: BankCurrency;
}

/**
 * The pairs an env file names (`BOG_ACCOUNT`, `TBC_ACCOUNT`), apart by spaces,
 * commas or semicolons. A pair named twice is read once; the same IBAN in two
 * currencies is two pairs. `bad` when any of them is not a pair the stand
 * reads: the link then stops rather than guess.
 */
export function pairsNamed(raw: string | undefined, bankCode?: string): { pairs: AccountPair[]; bad: boolean } {
  const read = (raw ?? '')
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map((a) => accountPairOf(a, bankCode));
  const pairs = new Map<string, AccountPair>();
  for (const p of read) if (p) pairs.set(`${p.iban} ${p.currency}`, p);
  return { pairs: [...pairs.values()], bad: read.some((p) => p == null) };
}

/**
 * A pair as a keys script names it, the bare IBAN and the currency apart
 * (`POST /api/jobs/bank-probe`). Null when it is not an account — of that bank,
 * with a bank code — in a currency the stand reads.
 */
export function pairAsked(account: unknown, currency: unknown, bankCode?: string): AccountPair | null {
  if (typeof account !== 'string' || typeof currency !== 'string') return null;
  const iban = account.replace(/\s+/g, '').toUpperCase();
  const code = currency.trim().toUpperCase();
  if (accountOf(iban, bankCode) !== iban || !/^[A-Z]{3}$/.test(code)) return null;
  return accountPairOf(`${iban}${code}`, bankCode);
}

/**
 * What the bank said of one pair before a keys script writes it into the
 * stand's env file (`deploy/set-*-keys.sh --add-account`): `ok`, our word for
 * its refusal, or `no_currency` — it knows the account, in lari, but not in
 * this currency, so the account in that currency has a number of its own. The
 * status code goes with it; nothing of the bank's answer does.
 */
export interface PairProbe<F extends string> {
  code: 'ok' | 'no_currency' | F;
  httpStatus: number | null;
}

/**
 * Ask the bank about one pair; when it does not know an account in a currency
 * other than lari, ask about the same IBAN in lari too. That tells a number
 * the bank does not know from a currency the account does not have — the one
 * mistake Enter in the script can make, as it offers the number of the account
 * in lari. `ask` gives our word for a refusal, or null when the bank answered.
 */
export async function probePair<F extends string>(pair: AccountPair, ask: (pair: AccountPair) => Promise<{ failure: F; httpStatus: number | null } | null>): Promise<PairProbe<F>> {
  const refused = await ask(pair);
  if (!refused) return { code: 'ok', httpStatus: null };
  if (refused.failure === 'not_found' && pair.currency !== 'GEL' && (await ask({ iban: pair.iban, currency: 'GEL' })) === null) {
    return { code: 'no_currency', httpStatus: refused.httpStatus };
  }
  return { code: refused.failure, httpStatus: refused.httpStatus };
}

/**
 * A line's key from a bank's API: as it has always been for lari, and with the
 * currency in it for another (`api:today:USD:…`). Nothing says a bank's ids
 * are apart between the currencies of one IBAN; with the currency in the key
 * they never meet, and the keys of the lines in lari stay what they were.
 */
export function apiKey(kind: 'today' | 'entry' | 'mv', currency: BankCurrency, id: string): string {
  return currency === 'GEL' ? `api:${kind}:${id}` : `api:${kind}:${currency}:${id}`;
}

/** The last four digits of an account: all of it a job's outcome, and so the worker's log, ever carries. */
export const last4 = (iban: string): string => iban.slice(-4);

/** What one reading did for one pair, as the job says it. */
export interface PairOutcome<F extends string = string> {
  last4: string;
  currency: BankCurrency;
  /** Operations the bank listed for this pair. */
  listed: number;
  /** New lines of this pair: in the queue for lari, parked for another currency. */
  added: number;
  /** Our word for why the bank gave nothing for this pair; null when it answered. */
  failure: F | null;
  httpStatus: number | null;
  /** The nightly reading: the days it read for this pair; none when they were read already. */
  days?: string[];
  /** TBC's nightly reading: the days of this pair that did not add up to the bank's sums. */
  mismatched?: string[];
  /** Bank of Georgia's night on «Прочитать сейчас»: the pair has past days to read, and they wait for the worker's next night. */
  later?: boolean;
}

/** A pair as the job says it: nothing listed, nothing added and no failure, but what it is given. */
export const pairOutcome = <F extends string>(pair: AccountPair, o: Partial<PairOutcome<F>> = {}): PairOutcome<F> => ({
  last4: last4(pair.iban),
  currency: pair.currency,
  listed: 0,
  added: 0,
  failure: null,
  httpStatus: null,
  ...o,
});

/** What a reading writes of one pair's row in `bank_api_accounts`. */
export type PairState = Partial<
  Pick<BankApiAccount, 'lastOkAt' | 'lastTryAt' | 'lastFailure' | 'lastHttpStatus' | 'todayCount' | 'nightThrough' | 'nightAt' | 'nightFailure' | 'nightHttpStatus' | 'nightMismatchOn' | 'nightAdded'>
>;

const pairWhere = (bank: ApiBank, pair: AccountPair) => ({ bank_account_currency: { bank, account: pair.iban, currency: pair.currency } });

/** The rows of a bank's pairs the stand has read before, to look one up by its pair. */
export async function pairRows(bank: ApiBank): Promise<(pair: AccountPair) => BankApiAccount | null> {
  const rows = await prisma.bankApiAccount.findMany({ where: { bank } });
  return (pair) => rows.find((r) => r.account === pair.iban && r.currency === pair.currency) ?? null;
}

/**
 * Write what a reading found of one pair, making its row the first time. A
 * pair in another currency is new to the stand, and its row keeps the day it
 * is read back from (`readFrom`, a month at most); a pair in lari was read
 * before the table, and has none.
 */
export async function savePair(bank: ApiBank, pair: AccountPair, readFrom: string, state: PairState): Promise<void> {
  await prisma.bankApiAccount.upsert({
    where: pairWhere(bank, pair),
    update: state,
    create: { bank, account: pair.iban, currency: pair.currency, readFrom: pair.currency === 'GEL' ? null : dateFromISO(readFrom), ...state },
  });
}

/** What the stand keeps of a link: a bank's lari in `bog_sync` / `tbc_sync`, one pair in `bank_api_accounts`. */
type LinkKept = Pick<BankApiAccount, 'lastOkAt' | 'lastTryAt' | 'lastFailure' | 'nightThrough' | 'nightFailure'>;

/** How a link stands, for "Деньги → Выписки". */
export interface LinkStatus<F extends string> {
  /** 'ok' — the bank answered lately; 'silent' — it has not for a while, or never has; 'waiting' — not asked yet. */
  freshness: 'ok' | 'silent' | 'waiting';
  lastOkAt: string | null;
  failure: F | null;
  nightThrough: string | null;
  nightFailure: F | null;
}

/** The link has gone silent when the bank has not answered for `staleMs`. One rule for a bank's lari and for each pair. */
export function linkStatus<F extends string>(s: LinkKept | null, staleMs: number, now: Date): LinkStatus<F> {
  const lastOkAt = s?.lastOkAt ?? null;
  const freshness = !lastOkAt ? (s?.lastTryAt ? 'silent' : 'waiting') : now.getTime() - lastOkAt.getTime() > staleMs ? 'silent' : 'ok';
  return {
    freshness,
    lastOkAt: lastOkAt?.toISOString() ?? null,
    failure: (s?.lastFailure as F | null) ?? null,
    nightThrough: isoDate(s?.nightThrough ?? null),
    nightFailure: (s?.nightFailure as F | null) ?? null,
  };
}

/** A pair as «Выписки» shows it: by its last four digits, never more, with how its own link stands. */
export interface PairStatus<F extends string> {
  last4: string;
  currency: BankCurrency;
  api: LinkStatus<F> & {
    /** TBC: the first day of this pair whose movements did not add up to the bank's sums at its last nightly reading. */
    nightMismatchOn: string | null;
  };
}

/** How each of these pairs stands, from its row; a pair not read yet is waiting. */
export async function pairsStatus<F extends string>(bank: ApiBank, pairs: AccountPair[], staleMs: number, now: Date): Promise<PairStatus<F>[]> {
  if (pairs.length === 0) return [];
  const rowOf = await pairRows(bank);
  return pairs.map((pair) => {
    const row = rowOf(pair);
    return { last4: last4(pair.iban), currency: pair.currency, api: { ...linkStatus<F>(row, staleMs, now), nightMismatchOn: isoDate(row?.nightMismatchOn ?? null) } };
  });
}

/** What one reading did: listed by the bank, new in the queue, and of the new ones what the rules settled. */
export interface Tally {
  /** Operations the bank listed. */
  listed: number;
  /** New lines in the queue, and of them: linked to money entered by hand, attached by a rule. */
  added: number;
  recorded: number;
  matched: number;
  /**
   * Listed and already in: by their own key, by TBC's transaction id, by document number from another source, by day
   * and sum, and a Bank of Georgia card payment the bank listed again under its other number (issue #16).
   */
  known: { byKey: number; byId: number; byDoc: number; bySum: number; byCard: number };
}

export function tally(): Tally {
  return { listed: 0, added: 0, recorded: 0, matched: 0, known: { byKey: 0, byId: 0, byDoc: 0, bySum: 0, byCard: 0 } };
}

/** Each operation once, should the bank list one twice. */
export function onceEach(lines: (ParsedLine | null)[]): ParsedLine[] {
  const seen = new Set<string>();
  return lines.filter((l): l is ParsedLine => {
    if (!l || seen.has(l.naturalKey)) return false;
    seen.add(l.naturalKey);
    return true;
  });
}

export function byDay(lines: ParsedLine[]): Map<string, ParsedLine[]> {
  const days = new Map<string, ParsedLine[]>();
  for (const l of lines) days.set(l.occurredOn, [...(days.get(l.occurredOn) ?? []), l]);
  return days;
}

export function daysFrom(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

/** The last day a file of this bank in this currency reached, by its lines and by the period it states. */
export async function lastFileDay(bank: ApiBank, currency: BankCurrency = 'GEL'): Promise<string | null> {
  const [line, statement] = await Promise.all([
    prisma.statementLine.findFirst({ where: { bank, currency, statement: { source: 'file' } }, orderBy: { occurredOn: 'desc' }, select: { occurredOn: true } }),
    prisma.statement.findFirst({ where: { bank, currency, source: 'file', periodTo: { not: null } }, orderBy: { periodTo: 'desc' }, select: { periodTo: true } }),
  ]);
  return [isoDate(line?.occurredOn ?? null), isoDate(statement?.periodTo ?? null)].filter((d): d is string => d != null).sort().pop() ?? null;
}

/**
 * The days an uploaded statement of this account and currency covers in
 * full: every day of its period but the last, and the last too when the file
 * was uploaded after that day was over. A file covers only its own pair: a
 * file of the lari account says nothing of the dollars on the same IBAN. A
 * file of the same bank and currency that names no account is taken to be
 * this one — the company had one account at each bank until the accounts in
 * dollars (29.10.2026), and a file is read in lari only.
 */
export async function daysInFiles(bank: ApiBank, account: string, from: string, to: string, currency: BankCurrency = 'GEL'): Promise<Set<string>> {
  const files = await prisma.statement.findMany({
    where: { bank, currency, source: 'file', periodFrom: { lte: dateFromISO(to)! }, periodTo: { gte: dateFromISO(from)! } },
    select: { account: true, periodFrom: true, periodTo: true, createdAt: true },
  });
  const days = new Set<string>();
  for (const f of files) {
    if (f.account && accountOf(f.account) !== account) continue;
    const first = isoDate(f.periodFrom)!;
    const last = isoDate(f.periodTo)!;
    const lastIsWhole = todayISO(f.createdAt, env.TZ) > last;
    for (const d of daysFrom(first, last)) if (d < last || lastIsWhole) days.add(d);
  }
  return days;
}

/**
 * One day of one account in one currency: its new lines into the queue —
 * parked, when the currency is not lari (`ingest`) — under that day's
 * statement from the API, made the first time the day brings a new line and
 * added to as the day goes on. The same IBAN in two currencies keeps two
 * statements a day. `name` is what the list of statements calls it: the
 * bank's own name for its API.
 */
export async function keep(bank: ApiBank, name: string, account: string, day: string, lines: ParsedLine[], t: Tally, currency: BankCurrency = 'GEL'): Promise<void> {
  const sorted = await knownLines({ bank, currency, lines });
  t.known.byKey += sorted.byKey;
  t.known.byId += sorted.byId;
  t.known.byDoc += sorted.byDoc;
  t.known.bySum += sorted.bySum;
  t.known.byCard += sorted.byCard;
  const statement = await prisma.statement.findFirst({ where: { bank, source: 'api', account, currency, periodFrom: dateFromISO(day)! }, select: { id: true, lineCount: true } });
  if (sorted.fresh.length === 0) {
    if (statement && lines.length > statement.lineCount) await prisma.statement.update({ where: { id: statement.id }, data: { lineCount: lines.length } });
    return;
  }
  const id =
    statement?.id ??
    (
      await prisma.statement.create({
        data: { bank, source: 'api', fileName: name, fileSha256: 'api', account, currency, periodFrom: dateFromISO(day), periodTo: dateFromISO(day), uploadedById: null },
        select: { id: true },
      })
    ).id;
  const { recorded, matched } = await ingest({ statementId: id, bank, currency, actorId: null, lines: sorted.fresh });
  await prisma.statement.update({
    where: { id },
    data: { lineCount: Math.max(statement?.lineCount ?? 0, lines.length), newLines: { increment: sorted.fresh.length }, matched: { increment: recorded + matched } },
  });
  await prisma.auditLog.create({
    data: {
      actorId: null,
      action: 'statement.pull',
      entityType: 'statement',
      entityId: id,
      after: { bank, source: 'api', day, newLines: sorted.fresh.length, recorded, matched },
    },
  });
  t.added += sorted.fresh.length;
  t.recorded += recorded;
  t.matched += matched;
}
