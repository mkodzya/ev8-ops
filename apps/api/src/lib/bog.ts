// Bank of Georgia, read through its Business Online API (B11-03; ADR-0021).
//
// Mika, 14.10.2026 (book register, item 8): every five minutes the stand asks
// the bank for the day's operations — the bank allows 800 such requests a day
// per account and currency, and five minutes is 288 — and once a night it
// reads the full statement of the day before, so that nothing the day's pull
// missed is lost. Both go into the queue a CSV upload feeds, through the same
// rules (`statements/import.ts`, `ingest`): a line that is money entered by
// hand is linked to it (B2-03), one two signs agree on is attached, the rest
// wait in "Разобрать" for a person — an amount without a payer's name among
// them, as it always has.
//
// One operation must not come in twice. The CSV keys a line by a hash of its
// text, the day's pull by the bank's activity id, the statement by its entry
// id; what they share is the day, the sum and the bank's document number, and
// that is how a line from one source is known in another (`sameLine.ts`).
// A day a statement file Mika uploaded covers in full is not read again.
//
// An account may be read in more than one currency (Mika, 29.10.2026: the
// company opened an account in dollars). `BOG_ACCOUNT` names each as the bank
// writes an account in a file, `GE…BG…USD`, and bare for lari; each pair of
// account and currency is asked on its own and keeps its own state, and a line
// not in lari is kept apart, outside every sum in lari (migration 0073;
// decision D1 of docs/spec/usd-accounts-plan.md).
//
// The keys are a server secret (CLAUDE.md rule 3): Mika issued them in
// Business Online and put them on the stand with `deploy/set-bog-keys.sh`.
// They are read from the environment and never logged, returned or written
// anywhere; neither is the token they buy. The bank's answers carry names and
// account numbers, so no answer is logged either: a failure is one of our own
// words and a status code. The bank answers only this server's address, so
// nothing here can be tried against the real bank from a laptop. Without the
// keys the link is off, quietly, as the Kommo link is without its token.
//
// It only reads. The same keys could create payment orders — the bank gives
// them the rights of the internet-bank user they were issued for — and this
// file never sends anything to the bank but the request for a token.

import { addDays, localDateTime, parseBankAmount, todayISO } from '@ev8/shared';
import { dateFromISO, isoDate } from './dates.js';
import { prisma } from './db.js';
import { env } from './env.js';
import {
  accountOf,
  apiKey,
  bankDay,
  byDay,
  daysFrom,
  daysInFiles,
  keep as keepDay,
  lastFileDay,
  onceEach,
  pairOutcome,
  pairRows,
  pairsNamed,
  savePair,
  tally,
  type AccountPair,
  type BankCurrency,
  type PairOutcome,
  type Tally,
} from './statements/apiDays.js';
import { readBogText, type ParsedLine } from './statements/parse.js';

export { accountOf, bankDay };

export interface BogConfig {
  clientId: string;
  clientSecret: string;
  /**
   * The accounts named in the stand's env file, each with the currency it is
   * read in. Empty: the account of the statements uploaded from this bank, in lari.
   */
  accounts: AccountPair[];
  /** BOG_ACCOUNT is set and names something that is not an account in GEL, USD or EUR: the link stops rather than guess. */
  badAccount: boolean;
  /** The bank has gone silent when it has not answered for this long. */
  staleMs: number;
}

const TOKEN_URL = 'https://account.bog.ge/auth/realms/bog/protocol/openid-connect/token';
const API_BASE = 'https://api.businessonline.ge/api';
/** How far back the nightly reading reaches when it has fallen behind. */
export const NIGHT_MAX_DAYS = 31;
/**
 * The bank books part of an evening's money after midnight under the day
 * before (16.10.2026: a transfer of 140 and a fee of 10 dated 15.10 came after
 * the 00:17 reading of 15.10, and the day's list of 16.10 does not show them).
 * Yesterday counts as read only by a reading made at this hour or later.
 */
export const MORNING_HOUR = 6;
const STALE_MINUTES = 20;

/** The name an API day carries in the list of statements. */
export const BOG_API_NAME = 'Business Online';

/** Null without both keys: the link is then off. */
export function bogConfig(e: NodeJS.ProcessEnv = process.env): BogConfig | null {
  const clientId = (e.BOG_CLIENT_ID ?? '').trim();
  const clientSecret = (e.BOG_CLIENT_SECRET ?? '').trim();
  if (!clientId || !clientSecret) return null;
  // As the bank writes an account in a statement file: `GE…BG…USD`, and bare for lari.
  const named = pairsNamed(e.BOG_ACCOUNT);
  const minutes = parseInt(e.BOG_STALE_MINUTES ?? '', 10);
  return {
    clientId,
    clientSecret,
    accounts: named.pairs,
    badAccount: named.bad,
    staleMs: (Number.isFinite(minutes) && minutes > 0 ? minutes : STALE_MINUTES) * 60_000,
  };
}

// ── The client ──────────────────────────────────────────────────────────

/** Why the bank gave nothing: our word for it, never its answer. */
export type BogFailure = 'unauthorized' | 'forbidden' | 'not_found' | 'rate_limited' | 'http' | 'network' | 'bad_answer' | 'no_account';

/** Where it failed: buying the token, or asking the API with it. */
export type BogStage = 'token' | 'api';

export class BogError extends Error {
  constructor(
    readonly failure: BogFailure,
    readonly httpStatus: number | null = null,
    readonly stage: BogStage | null = null,
  ) {
    super(`bog: ${failure}${httpStatus ? ` (${httpStatus})` : ''}${stage ? ` at ${stage}` : ''}`);
  }
}

export interface BogResponse {
  status: number;
  headers: { get(name: string): string | null };
  json: () => Promise<unknown>;
}

/** The part of `fetch` this needs, so a test can stand in for the bank. */
export type BogFetch = (url: string, init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<BogResponse>;

// The bank allows five requests a second. One at a time with this gap
// between starts keeps under it with room to spare.
const MIN_GAP_MS = 250;
const TIMEOUT_MS = 20_000;
/** A 429 asking to wait longer than this fails the pull; the next one is five minutes away. */
const MAX_RETRY_AFTER_S = 30;
/** The statement comes in pages of a thousand entries. */
const MAX_PAGES = 20;
// The bank's gateway answers 502–504 now and then and the same request a
// moment later goes through (test stand, 15.10.2026: 503, then 200 five
// minutes on, then 503). Such an answer is asked again once, after this pause.
const GATEWAY_RETRY_MS = 3_000;
const GATEWAY = new Set([502, 503, 504]);

export interface BogClientOptions {
  fetch?: BogFetch;
  gapMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** A field by its name in any case: the bank's documentation writes `DocNo`, a serializer may write `docNo`. */
function pick(o: Record<string, unknown>, name: string): unknown {
  if (name in o) return o[name];
  const lower = name.toLowerCase();
  const key = Object.keys(o).find((k) => k.toLowerCase() === lower);
  return key === undefined ? undefined : o[key];
}

export class BogClient {
  private readonly fetchFn: BogFetch;
  private readonly gapMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private queue: Promise<unknown> = Promise.resolve();
  private lastStart = 0;
  private token: { value: string; until: number } | null = null;

  constructor(
    private readonly cfg: BogConfig,
    opts: BogClientOptions = {},
  ) {
    this.fetchFn = opts.fetch ?? (fetch as unknown as BogFetch);
    this.gapMs = opts.gapMs ?? MIN_GAP_MS;
    this.sleep = opts.sleep ?? realSleep;
    this.now = opts.now ?? Date.now;
  }

  /** One request, one at a time, with the gap kept; a network error becomes our word. */
  private sendOnce(stage: BogStage, url: string, init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string }): Promise<BogResponse> {
    const run = async (): Promise<BogResponse> => {
      const wait = this.lastStart + this.gapMs - this.now();
      if (wait > 0) await this.sleep(wait);
      this.lastStart = this.now();
      try {
        return await this.fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch {
        // The cause is dropped on purpose: a fetch error can quote the request.
        throw new BogError('network', null, stage);
      }
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** The same, asked once more after a pause when the bank's gateway was busy. */
  private async send(stage: BogStage, url: string, init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string }): Promise<BogResponse> {
    const res = await this.sendOnce(stage, url, init);
    if (!GATEWAY.has(res.status)) return res;
    await this.sleep(GATEWAY_RETRY_MS);
    return this.sendOnce(stage, url, init);
  }

  /**
   * A token for the client credentials, kept until shortly before it runs
   * out. The keys go both as Basic and in the body, as the bank's own example
   * has them.
   */
  private async accessToken(): Promise<string> {
    if (this.token && this.token.until > this.now()) return this.token.value;
    const basic = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString('base64');
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret }).toString();
    const res = await this.send('token', TOKEN_URL, {
      method: 'POST',
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
    });
    if (res.status === 400 || res.status === 401 || res.status === 403) throw new BogError('unauthorized', res.status, 'token');
    if (res.status === 429) throw new BogError('rate_limited', res.status, 'token');
    if (res.status < 200 || res.status >= 300) throw new BogError('http', res.status, 'token');
    let answer: Record<string, unknown>;
    try {
      answer = obj(await res.json());
    } catch {
      throw new BogError('bad_answer', res.status, 'token');
    }
    const value = typeof answer.access_token === 'string' ? answer.access_token : '';
    if (!value) throw new BogError('bad_answer', res.status, 'token');
    const ttl = typeof answer.expires_in === 'number' && answer.expires_in > 0 ? answer.expires_in : 300;
    this.token = { value, until: this.now() + Math.max(0, ttl - 30) * 1000 };
    return value;
  }

  /**
   * The one door to the API: the token goes on here and a refusal becomes one
   * of our words here. A token the bank no longer takes is bought again once;
   * a 429 that asks for a short wait is waited out once.
   */
  private async get(path: string): Promise<unknown | null> {
    for (let attempt = 0; ; attempt++) {
      const token = await this.accessToken();
      const res = await this.send('api', `${API_BASE}${path}`, { method: 'GET', headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
      if (res.status === 401 && attempt === 0) {
        this.token = null;
        continue;
      }
      if (res.status === 429 && attempt === 0) {
        const wait = Number(res.headers.get('retry-after'));
        if (Number.isFinite(wait) && wait >= 0 && wait <= MAX_RETRY_AFTER_S) {
          await this.sleep(wait * 1000);
          continue;
        }
      }
      if (res.status === 401) throw new BogError('unauthorized', res.status, 'api');
      if (res.status === 403) throw new BogError('forbidden', res.status, 'api');
      if (res.status === 404) throw new BogError('not_found', res.status, 'api');
      if (res.status === 429) throw new BogError('rate_limited', res.status, 'api');
      if (res.status < 200 || res.status >= 300) throw new BogError('http', res.status, 'api');
      if (res.status === 204) return null;
      try {
        return await res.json();
      } catch {
        throw new BogError('bad_answer', res.status, 'api');
      }
    }
  }

  /** The day's operations on one account in one currency: `api/v2/documents/todayactivities/{account}/{currency}`. */
  async today(pair: AccountPair): Promise<unknown[]> {
    const body = await this.get(`/v2/documents/todayactivities/${encodeURIComponent(pair.iban)}/${pair.currency}`);
    if (body === null) return [];
    if (Array.isArray(body)) return body;
    const rows = pick(obj(body), 'Records');
    if (Array.isArray(rows)) return rows;
    throw new BogError('bad_answer');
  }

  /**
   * The statement of one account in one currency for whole days, page by page:
   * `api/v2/statement/{account}/{currency}/{from}/{to}`, then
   * `…/{account}/{currency}/{id}/{page}` while the bank says there is more.
   */
  async statement(pair: AccountPair, from: string, to: string): Promise<unknown[]> {
    const acc = `${encodeURIComponent(pair.iban)}/${pair.currency}`;
    const first = obj(await this.get(`/v2/statement/${acc}/${from}/${to}`));
    const rows = pick(first, 'Records');
    if (rows == null) return [];
    if (!Array.isArray(rows)) throw new BogError('bad_answer');
    const records = [...rows];
    const total = Number(pick(first, 'TotalCount'));
    const id = pick(first, 'Id');
    for (let page = 2; Number.isFinite(total) && records.length < total; page++) {
      if (page > MAX_PAGES || (typeof id !== 'number' && typeof id !== 'string')) throw new BogError('bad_answer');
      const more = pick(obj(await this.get(`/v2/statement/${acc}/${encodeURIComponent(String(id))}/${page}`)), 'Records');
      // The bank said there is more and gave none: what it did give is not the whole day.
      if (!Array.isArray(more) || more.length === 0) throw new BogError('bad_answer');
      records.push(...more);
    }
    return records;
  }
}

// ── Reading an answer ───────────────────────────────────────────────────

const text = (v: unknown): string | null => {
  if (typeof v === 'string') return v.replace(/\s+/g, ' ').trim() || null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
};

/** A sum as tetri, sign dropped: the field it came in says which way it went. */
function tetri(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(Math.abs(v) * 100);
  if (typeof v === 'string') {
    const t = parseBankAmount(v);
    return t == null ? null : Math.abs(t);
  }
  return null;
}

const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const money = (t: number) => (t / 100).toFixed(2);

interface Read {
  key: string;
  currency: BankCurrency;
  day: string;
  docNo: string | null;
  credit: number | null;
  debit: number | null;
  texts: (string | null)[];
  nomination: string | null;
  senderName: string | null;
  senderAccount: string | null;
  beneficiaryName: string | null;
  beneficiaryAccount: string | null;
  /** The bank's own lari for the money in and out, where it gives them. */
  creditBase: number | null;
  debitBase: number | null;
}

/**
 * One operation as a statement line. The stored text has the shape of a CSV
 * row — day, document, the other side's account, debit, credit, the bank's
 * words — so a line reads the same in the queue whichever way it came, and a
 * card payment is told by the same words (`cardOf`).
 */
function lineOf(r: Read): ParsedLine | null {
  const credit = r.credit ?? 0;
  const debit = r.debit ?? 0;
  if (credit <= 0 && debit <= 0) return null; // nothing moved
  const direction: 'in' | 'out' = credit > 0 ? 'in' : 'out';
  const amountTetri = direction === 'in' ? credit : debit;
  const content = [...new Set(r.texts.filter((t): t is string => t != null))].join(' / ');
  const said = readBogText(content, direction);
  // A card payment's sender is the acquirer, not the customer: as in the file, it has no payer.
  const named = direction === 'in' ? r.senderName : r.beneficiaryName;
  const payer = said.card ? said.payer : (named ?? said.payer);
  return {
    naturalKey: r.key,
    docNo: r.docNo,
    occurredOn: r.day,
    direction,
    amountTetri,
    grossTetri: said.grossTetri,
    feeTetri: said.feeTetri,
    payer,
    purpose: r.nomination ?? said.purpose ?? (content.slice(0, 200) || null),
    raw: [dmy(r.day), r.docNo ?? '', (direction === 'in' ? r.senderAccount : r.beneficiaryAccount) ?? '', direction === 'out' ? money(amountTetri) : '', direction === 'in' ? money(amountTetri) : '', content].join(' | '),
    channel: said.card ? 'acquiring' : 'transfer',
    // Beside a line in another currency, what the bank says it is in lari: for
    // reference only, never summed (migration 0073). A line in lari has none.
    ...(r.currency === 'GEL' ? {} : { bankGelTetri: (direction === 'in' ? r.creditBase : r.debitBase) || null }),
  };
}

/**
 * One row of the day's operations (`todayactivities`) of an account in one
 * currency. Its day is today: the bank lists what moved on the account today,
 * and its PostDate is the day the document was made — a transfer sent last
 * night and credited this morning carries yesterday's. Its sums are in the
 * account's currency; `AmountBase` is the bank's lari for them.
 */
export function lineFromToday(row: unknown, today: string, currency: BankCurrency): ParsedLine | null {
  const o = obj(row);
  const id = text(pick(o, 'Id'));
  if (!id) throw new BogError('bad_answer');
  const sender = obj(pick(o, 'Sender'));
  const beneficiary = obj(pick(o, 'Beneficiary'));
  let credit = tetri(pick(o, 'Credit'));
  let debit = tetri(pick(o, 'Debit'));
  if (!credit && !debit) {
    // Only the signed amount: what leaves the account is the negative one.
    const amount = pick(o, 'Amount');
    const signed = typeof amount === 'number' ? amount : typeof amount === 'string' ? Number(amount) : NaN;
    if (Number.isFinite(signed) && signed !== 0) {
      if (signed > 0) credit = Math.round(signed * 100);
      else debit = Math.round(-signed * 100);
    }
  }
  const base = tetri(pick(o, 'AmountBase'));
  return lineOf({
    key: apiKey('today', currency, id),
    currency,
    day: today,
    docNo: text(pick(o, 'DocNo')),
    credit,
    debit,
    texts: [text(pick(o, 'EntryComment')), text(pick(o, 'EntryCommentEn'))],
    nomination: text(pick(o, 'Nomination')),
    senderName: text(pick(sender, 'Name')) ?? text(pick(o, 'PayerName')),
    senderAccount: text(pick(sender, 'AccountNumber')),
    beneficiaryName: text(pick(beneficiary, 'Name')),
    beneficiaryAccount: text(pick(beneficiary, 'AccountNumber')),
    creditBase: base,
    debitBase: base,
  });
}

/** One entry of the statement (`statement`) of an account in one currency; `EntryAmount…Base` is the bank's lari. */
export function lineFromEntry(row: unknown, currency: BankCurrency): ParsedLine | null {
  const o = obj(row);
  const id = text(pick(o, 'EntryId'));
  const day = bankDay(pick(o, 'EntryDate')) ?? bankDay(pick(o, 'DocumentValueDate'));
  if (!id || !day) throw new BogError('bad_answer');
  const sender = obj(pick(o, 'SenderDetails'));
  const beneficiary = obj(pick(o, 'BeneficiaryDetails'));
  const base = tetri(pick(o, 'EntryAmountBase'));
  return lineOf({
    key: apiKey('entry', currency, id),
    currency,
    day,
    docNo: text(pick(o, 'EntryDocumentNumber')),
    credit: tetri(pick(o, 'EntryAmountCredit')),
    debit: tetri(pick(o, 'EntryAmountDebit')),
    texts: [text(pick(o, 'EntryComment')), text(pick(o, 'DocComment'))],
    nomination: text(pick(o, 'DocumentNomination')),
    senderName: text(pick(sender, 'Name')) ?? text(pick(o, 'DocumentPayerName')),
    senderAccount: text(pick(sender, 'AccountNumber')),
    beneficiaryName: text(pick(beneficiary, 'Name')),
    beneficiaryAccount: text(pick(beneficiary, 'AccountNumber')),
    creditBase: tetri(pick(o, 'EntryAmountCreditBase')) || base,
    debitBase: tetri(pick(o, 'EntryAmountDebitBase')) || base,
  });
}

// ── The pull ────────────────────────────────────────────────────────────

let fetchForTests: BogFetch | null = null;
let clientOptsForTests: BogClientOptions = {};

/** Tests stand in for the bank: no request leaves the machine. */
export function setBogFetchForTests(fn: BogFetch | null, opts: BogClientOptions = {}): void {
  fetchForTests = fn;
  clientOptsForTests = opts;
}

export type BogOutcome =
  | { status: 'off' }
  | { status: 'busy' }
  | (Tally & {
      status: 'ok';
      /** The days read (the nightly reading); a day a file covers in full is not read. */
      days: string[];
      /** The day's operations came from today's statement: the list of the day's operations did not answer. */
      fromStatement: boolean;
      /** Each account and currency read, by its last four digits: what it listed and added, or why the bank gave nothing for it. */
      accounts: PairOutcome<BogFailure>[];
    })
  // Nothing came: no account to ask, or the bank refused every one — the first refusal says why.
  | { status: 'failed'; failure: BogFailure; httpStatus: number | null; stage: BogStage | null };

type Ok = Extract<BogOutcome, { status: 'ok' }>;

// One job at a time: the pull and the nightly reading both add to the same
// day. A pull that finds another job running or waiting skips its turn —
// the next is five minutes away; the nightly reading waits for its turn.
let chain: Promise<unknown> = Promise.resolve();
let waiting = 0;

function serial<T>(job: () => Promise<T>): Promise<T> {
  waiting++;
  const run = chain.then(job).finally(() => {
    waiting--;
  });
  chain = run.catch(() => undefined);
  return run;
}

/** Ask the bank for the day's operations and put the new ones in the queue. Never throws for the bank's sake. */
export function syncBogToday(now: Date = new Date()): Promise<BogOutcome> {
  const cfg = bogConfig();
  if (!cfg) return Promise.resolve({ status: 'off' });
  if (waiting > 0) return Promise.resolve({ status: 'busy' });
  return serial(() => pullToday(cfg, now));
}

/**
 * Read the full statement from the last day the nightly reading reached up
 * to yesterday, and add what the day's pulls did not bring. Nothing to do
 * when it has already reached yesterday — so the worker asks every hour and
 * on every start: a night the bank or the stand was down is caught up within
 * the hour, and the bank is asked only once a day when all goes well.
 */
export function reconcileBogNight(now: Date = new Date()): Promise<BogOutcome> {
  const cfg = bogConfig();
  if (!cfg) return Promise.resolve({ status: 'off' });
  return serial(() => readNights(cfg, now));
}

function client(cfg: BogConfig): BogClient {
  return new BogClient(cfg, { ...clientOptsForTests, ...(fetchForTests ? { fetch: fetchForTests } : {}) });
}

/** The accounts to ask about: those the env file names, or the one the uploaded statements came from — in lari, as a file is read. */
async function accountsFor(cfg: BogConfig): Promise<AccountPair[]> {
  if (cfg.badAccount) return [];
  if (cfg.accounts.length > 0) return cfg.accounts;
  const last = await prisma.statement.findFirst({ where: { bank: 'bog', source: 'file', currency: 'GEL', account: { not: null } }, orderBy: { createdAt: 'desc' }, select: { account: true } });
  const iban = accountOf(last?.account);
  return iban ? [{ iban, currency: 'GEL' }] : [];
}

const SYNC = { id: true } as const;

/**
 * The day's operations on one account in one currency. The list of the day's
 * operations is down now and then while the statement is not (test stand,
 * 15.10.2026: `todayactivities` 503 again and again, the statement of the 14th
 * read at once). Today's statement holds the same operations, keyed as the
 * night will key them.
 */
async function todayOf(bank: BogClient, pair: AccountPair, today: string): Promise<{ lines: ParsedLine[]; listed: number; fromStatement: boolean }> {
  try {
    const rows = await bank.today(pair);
    return { lines: onceEach(rows.map((r) => lineFromToday(r, today, pair.currency))), listed: rows.length, fromStatement: false };
  } catch (err) {
    if (!(err instanceof BogError && err.stage === 'api' && err.httpStatus != null && err.httpStatus >= 500)) throw err;
    const rows = await bank.statement(pair, today, today);
    return { lines: onceEach(rows.map((r) => lineFromEntry(r, pair.currency))), listed: rows.length, fromStatement: true };
  }
}

type Asked<T> = { pair: AccountPair; got: T; failure: null } | { pair: AccountPair; got: null; failure: BogError };

/**
 * Each account and currency is asked on its own. One the bank refuses — an
 * account it does not let these keys read, or does not know in that currency
 * — keeps nothing of the others out of the queue and stops none of them: what
 * they listed goes in, and the refusal is that pair's to say. A refused token
 * is the keys themselves: the pairs after it are not asked, and are refused
 * the same.
 */
async function eachPair<T>(pairs: AccountPair[], read: (pair: AccountPair) => Promise<T>): Promise<Asked<T>[]> {
  const asked: Asked<T>[] = [];
  let keys: BogError | null = null;
  for (const pair of pairs) {
    try {
      if (keys) throw keys;
      asked.push({ pair, got: await read(pair), failure: null });
    } catch (err) {
      if (!(err instanceof BogError)) throw err;
      if (err.stage === 'token') keys = err;
      asked.push({ pair, got: null, failure: err });
    }
  }
  return asked;
}

const failedWith = (err: BogError): BogOutcome => ({ status: 'failed', failure: err.failure, httpStatus: err.httpStatus, stage: err.stage });

/** What the job says of a pair the bank refused. */
const refusal = (err: BogError) => ({ failure: err.failure, httpStatus: err.httpStatus });

// bog_sync stays the lari link's: its card on «Выписки» and «Сегодня» read it,
// as before the dollars. It says what the pairs in lari did — the first of them
// the bank refused, or that all answered — and nothing of another currency.
const inLari = <T>(asked: Asked<T>[]) => asked.filter((a) => a.pair.currency === 'GEL');

async function pullToday(cfg: BogConfig, now: Date): Promise<BogOutcome> {
  const today = todayISO(now, env.TZ);
  const bank = client(cfg);
  const outcome = blank();
  const asked = await eachPair(await accountsFor(cfg), async (pair) => {
    const read = await todayOf(bank, pair, today);
    const before = outcome.added;
    for (const [day, ofDay] of byDay(read.lines)) await keep(pair, day, ofDay, outcome);
    outcome.listed += read.listed;
    outcome.fromStatement ||= read.fromStatement;
    return { listed: read.listed, added: outcome.added - before };
  });

  for (const a of asked) {
    const state = a.failure
      ? { lastTryAt: now, lastFailure: a.failure.failure, lastHttpStatus: a.failure.httpStatus }
      : { lastOkAt: now, lastTryAt: now, lastFailure: null, lastHttpStatus: null, todayCount: a.got.listed };
    await savePair('bog', a.pair, addDays(today, -NIGHT_MAX_DAYS), state);
    outcome.accounts.push(pairOutcome<BogFailure>(a.pair, a.failure ? refusal(a.failure) : a.got));
  }
  const lari = inLari(asked);
  const refused = asked.length === 0 ? new BogError('no_account') : (lari.find((a) => a.failure)?.failure ?? null);
  if (refused) {
    const failed = { lastTryAt: now, lastFailure: refused.failure, lastHttpStatus: refused.httpStatus };
    await prisma.bogSync.upsert({ where: SYNC, update: failed, create: { ...SYNC, ...failed } });
  } else if (lari.length > 0) {
    const ok = { lastOkAt: now, lastTryAt: now, lastFailure: null, lastHttpStatus: null, todayCount: lari.reduce((n, a) => n + (a.got?.listed ?? 0), 0) };
    await prisma.bogSync.upsert({ where: SYNC, update: ok, create: { ...SYNC, ...ok } });
  }
  if (asked.length === 0) return failedWith(refused!);
  return asked.every((a) => a.failure) ? failedWith(asked[0]!.failure!) : outcome;
}

/** Hour of the day in Tbilisi. */
const hourAt = (at: Date) => Number(localDateTime(at, env.TZ).time.slice(0, 2));

/**
 * Yesterday is read already, but before the morning: once the morning has
 * come it is read once more, for what the bank booked after midnight under
 * yesterday's date. A reading that failed does not count as made.
 */
export function readAgain(sync: { nightAt: Date | null; nightFailure: string | null } | null, now: Date): boolean {
  if (hourAt(now) < MORNING_HOUR) return false;
  const at = sync?.nightAt;
  if (!at || sync?.nightFailure) return true;
  return todayISO(at, env.TZ) < todayISO(now, env.TZ) || hourAt(at) < MORNING_HOUR;
}

async function readNights(cfg: BogConfig, now: Date): Promise<BogOutcome> {
  const yesterday = addDays(todayISO(now, env.TZ), -1);
  const back = addDays(yesterday, -(NIGHT_MAX_DAYS - 1));
  const sync = await prisma.bogSync.findUnique({ where: SYNC });
  const pairs = await accountsFor(cfg);
  if (pairs.length === 0) {
    // No account to read: said once the night is due, as before.
    const reached = isoDate(sync?.nightThrough ?? null);
    if (reached && reached >= yesterday && !readAgain(sync, now)) return blank();
    const failed = { nightAt: now, nightFailure: 'no_account', nightHttpStatus: null };
    await prisma.bogSync.upsert({ where: SYNC, update: failed, create: { ...SYNC, ...failed } });
    return failedWith(new BogError('no_account'));
  }
  const rowOf = await pairRows('bog');
  // Each pair's night is its own. A pair in lari was read before it had a row:
  // until its own night has run, the night bog_sync kept is its night.
  const nightOf = (pair: AccountPair) => {
    const row = rowOf(pair);
    return row?.nightAt || pair.currency !== 'GEL' ? row : sync;
  };

  const outcome = blank();
  const bank = client(cfg);
  const asked = await eachPair(pairs, async (pair) => {
    const night = nightOf(pair);
    const reached = isoDate(night?.nightThrough ?? null);
    if (reached && reached >= yesterday && !readAgain(night, now)) return null;
    // The first night of a pair in lari starts at the last day the uploaded
    // files reached: the days between that file and the first pull are read
    // too. A pair in another currency is new to the stand, and reads back once,
    // a month at most, from the day its row keeps.
    const start = reached ?? (await lastFileDay('bog', pair.currency)) ?? (pair.currency === 'GEL' ? yesterday : (isoDate(rowOf(pair)?.readFrom ?? null) ?? back));
    const from = [[start, back].sort().pop()!, yesterday].sort()[0]!;
    const covered = await daysInFiles('bog', pair.iban, from, yesterday, pair.currency);
    const open = daysFrom(from, yesterday).filter((d) => !covered.has(d));
    if (open.length === 0) return { listed: 0, added: 0, days: [] };
    const rows = await bank.statement(pair, open[0]!, yesterday);
    const lines = onceEach(rows.map((r) => lineFromEntry(r, pair.currency))).filter((l) => !covered.has(l.occurredOn));
    const before = outcome.added;
    outcome.listed += rows.length;
    outcome.days.push(...open.filter((d) => !outcome.days.includes(d)));
    for (const [day, ofDay] of byDay(lines)) await keep(pair, day, ofDay, outcome);
    return { listed: rows.length, added: outcome.added - before, days: open };
  });

  // A pair has read up to yesterday once its statement is read. One that
  // failed keeps the day it had reached and is read again from there; the
  // lines the others brought meanwhile are known then by their keys.
  for (const a of asked) {
    if (a.failure) {
      await savePair('bog', a.pair, back, { nightThrough: nightOf(a.pair)?.nightThrough ?? null, nightAt: now, nightFailure: a.failure.failure, nightHttpStatus: a.failure.httpStatus });
    } else if (a.got) {
      await savePair('bog', a.pair, back, { nightThrough: dateFromISO(yesterday), nightAt: now, nightFailure: null, nightHttpStatus: null, nightAdded: a.got.added });
    }
    outcome.accounts.push(pairOutcome<BogFailure>(a.pair, a.failure ? refusal(a.failure) : (a.got ?? { days: [] })));
  }
  // The lari link has read up to yesterday once every pair in lari it read has.
  const lari = inLari(asked).filter((a) => a.failure || a.got);
  const refused = lari.find((a) => a.failure)?.failure;
  if (refused) {
    const failed = { nightAt: now, nightFailure: refused.failure, nightHttpStatus: refused.httpStatus };
    await prisma.bogSync.upsert({ where: SYNC, update: failed, create: { ...SYNC, ...failed } });
  } else if (lari.length > 0) {
    const ok = { nightThrough: dateFromISO(yesterday), nightAt: now, nightFailure: null, nightHttpStatus: null, nightAdded: lari.reduce((n, a) => n + (a.got?.added ?? 0), 0) };
    await prisma.bogSync.upsert({ where: SYNC, update: ok, create: { ...SYNC, ...ok } });
  }
  if (asked.every((a) => a.failure)) return failedWith(asked[0]!.failure!);
  outcome.days.sort();
  return outcome;
}

function blank(): Ok {
  return { status: 'ok', ...tally(), days: [], fromStatement: false, accounts: [] };
}

/** One day of one account in one currency into the queue — parked, when it is not lari — under its "Business Online" statement. */
function keep(pair: AccountPair, day: string, lines: ParsedLine[], outcome: Ok): Promise<void> {
  return keepDay('bog', BOG_API_NAME, pair.iban, day, lines, outcome, pair.currency);
}

// ── For the screen ──────────────────────────────────────────────────────

export interface BogApiStatus {
  /** 'ok' — the bank answered lately; 'silent' — it has not for a while, or never has; 'waiting' — not asked yet. */
  freshness: 'ok' | 'silent' | 'waiting';
  lastOkAt: string | null;
  failure: BogFailure | null;
  nightThrough: string | null;
  nightFailure: BogFailure | null;
}

/** How the link stands, for "Деньги → Выписки". Null when it is off. */
export async function bogApiStatus(now: Date = new Date()): Promise<BogApiStatus | null> {
  const cfg = bogConfig();
  if (!cfg) return null;
  const s = await prisma.bogSync.findUnique({ where: SYNC });
  const lastOkAt = s?.lastOkAt ?? null;
  const freshness = !lastOkAt ? (s?.lastTryAt ? 'silent' : 'waiting') : now.getTime() - lastOkAt.getTime() > cfg.staleMs ? 'silent' : 'ok';
  return {
    freshness,
    lastOkAt: lastOkAt?.toISOString() ?? null,
    failure: (s?.lastFailure as BogFailure | null) ?? null,
    nightThrough: isoDate(s?.nightThrough ?? null),
    nightFailure: (s?.nightFailure as BogFailure | null) ?? null,
  };
}
