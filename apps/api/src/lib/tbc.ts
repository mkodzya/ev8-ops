// TBC, read through its Business Integration Services (B11-03; ADR-0026).
//
// The same as Bank of Georgia (ADR-0021, `bog.ts`): every five minutes the
// stand asks the bank for the movements of yesterday and today, and once a
// night it reads the whole of yesterday again and checks it against the
// bank's statement, so that nothing the day's pulls missed is lost. Both go into the queue a CSV
// upload feeds, through the same rules (`statements/import.ts`, `ingest`).
//
// What TBC's documentation says (developers.tbcbank.ge, read 15.10.2026):
//   * OAuth 2.0 Client Credentials: the keys as Basic, `scope=bab_accounts`,
//     a token for an hour, at `{base}/oauth/token`. The documentation names
//     that address for the test environment only; for production it is taken
//     to be the same path on the production base.
//   * `GET /bab/v1/accounts/movements` — the movements of an account for whole
//     days, in pages of at most 700, with the total.
//   * `GET /bab/v1/accounts/statements` — the statement, which at TBC is a
//     summary only: the balances and the sums of credits and debits for the
//     period. That is what the night checks its lines against.
//   * No request limit, no certificate and no address of ours to register
//     are named. Card payments one by one are not given (TBC: the merchant
//     portal only); the terminal's daily settlement comes as a movement, as
//     in the file, and is read the same way (`cardOf`).
//
// One operation must not come in twice: a movement's id and the file's
// "Transaction ID" are compared as numbers (`sameLine.ts`); where they do not
// meet, a line from the file is known by its day and sum.
//
// An account may be read in more than one currency (Mika, 29.10.2026: the
// company opened an account in dollars). `TBC_ACCOUNT` names each as
// `GE…TB…USD`, and bare for lari; each pair of account and currency is asked on
// its own, checked against the bank's sums in its own currency and keeps its
// own state, and a line not in lari is kept apart, outside every sum in lari
// (migration 0073; decision D1 of docs/spec/usd-accounts-plan.md).
//
// The keys are a server secret (CLAUDE.md rule 3): Mika or Kardu issue them
// in Business Internet Banking and put them on the stand with
// `deploy/set-tbc-keys.sh`. They are read from the environment and never
// logged, returned or written anywhere; neither is the token. The bank's
// answers carry names and account numbers, so none is logged: a failure is
// one of our words and a status code. Without the keys the link is off.
//
// It only reads: the token is asked for `bab_accounts` alone, and the API
// only by GET.

import { addDays, todayISO } from '@ev8/shared';
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
import { cardOf, type ParsedLine } from './statements/parse.js';

export interface TbcConfig {
  clientId: string;
  clientSecret: string;
  /**
   * The accounts named in the stand's env file, each with the currency it is
   * read in. Empty: the account of the statements uploaded from this bank, in lari.
   */
  accounts: AccountPair[];
  /** TBC_ACCOUNT is set and names something that is not a TBC account in GEL, USD or EUR: the link stops rather than guess. */
  badAccount: boolean;
  /** The bank has gone silent when it has not answered for this long. */
  staleMs: number;
  /** Production, or TBC's test environment for its test keys. */
  baseUrl: string;
}

const PRODUCTION = 'https://api.tbcbank.ge';
/** Only the bank's own hosts: the keys never go anywhere else. */
const TBC_HOST = /^https:\/\/[a-z0-9-]+\.tbcbank\.ge$/;
const SCOPE = 'bab_accounts';
/** How far back the nightly reading reaches when it has fallen behind. */
export const NIGHT_MAX_DAYS = 31;
const STALE_MINUTES = 20;

/** The name an API day carries in the list of statements: the bank's own name for the service. */
export const TBC_API_NAME = 'Business Integration Services';

/** Null without both keys: the link is then off. */
export function tbcConfig(e: NodeJS.ProcessEnv = process.env): TbcConfig | null {
  const clientId = (e.TBC_CLIENT_ID ?? '').trim();
  const clientSecret = (e.TBC_CLIENT_SECRET ?? '').trim();
  if (!clientId || !clientSecret) return null;
  const named = pairsNamed(e.TBC_ACCOUNT, 'TB');
  const minutes = parseInt(e.TBC_STALE_MINUTES ?? '', 10);
  const base = (e.TBC_BASE_URL ?? '').trim().replace(/\/+$/, '');
  return {
    clientId,
    clientSecret,
    accounts: named.pairs,
    badAccount: named.bad,
    staleMs: (Number.isFinite(minutes) && minutes > 0 ? minutes : STALE_MINUTES) * 60_000,
    baseUrl: TBC_HOST.test(base) ? base : PRODUCTION,
  };
}

// ── The client ──────────────────────────────────────────────────────────

/** Why the bank gave nothing: our word for it, never its answer. */
export type TbcFailure = 'unauthorized' | 'forbidden' | 'not_found' | 'user_inactive' | 'rate_limited' | 'http' | 'network' | 'bad_answer' | 'no_account' | 'mismatch';

/** Where it failed: buying the token, or asking the API with it. */
export type TbcStage = 'token' | 'api';

export class TbcError extends Error {
  constructor(
    readonly failure: TbcFailure,
    readonly httpStatus: number | null = null,
    readonly stage: TbcStage | null = null,
  ) {
    super(`tbc: ${failure}${httpStatus ? ` (${httpStatus})` : ''}${stage ? ` at ${stage}` : ''}`);
  }
}

export interface TbcResponse {
  status: number;
  headers: { get(name: string): string | null };
  json: () => Promise<unknown>;
}

/** The part of `fetch` this needs, so a test can stand in for the bank. */
export type TbcFetch = (url: string, init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<TbcResponse>;

// TBC names no limit. One request at a time, with a gap, all the same.
const MIN_GAP_MS = 250;
const TIMEOUT_MS = 20_000;
const MAX_RETRY_AFTER_S = 30;
/** The most a page holds (the documentation: "Maximum 700"). */
export const PAGE_SIZE = 700;
const MAX_PAGES = 20;
// A busy gateway (502–504) is asked once more after a pause, as at Bank of Georgia.
const GATEWAY_RETRY_MS = 3_000;
const GATEWAY = new Set([502, 503, 504]);

// The bank's error codes (application/problem+json, `title`), read against
// this list and nothing else: the word is ours, the rest of the answer is dropped.
const INACTIVE = new Set(['USER_IS_DELETED', 'USER_IS_NOT_ACTIVE', 'USER_IS_BLOCKED']);

export interface TbcClientOptions {
  fetch?: TbcFetch;
  gapMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** A field by its name in any case: the documentation writes `movementId`, a serializer may write `MovementId`. */
function pick(o: Record<string, unknown>, name: string): unknown {
  if (name in o) return o[name];
  const lower = name.toLowerCase();
  const key = Object.keys(o).find((k) => k.toLowerCase() === lower);
  return key === undefined ? undefined : o[key];
}

/** The code of a refusal, when it is one of those this link knows. */
async function codeOf(res: TbcResponse): Promise<string | null> {
  try {
    const body = obj(await res.json());
    for (const field of ['title', 'code', 'error']) {
      const v = pick(body, field);
      if (typeof v === 'string' && /^[A-Za-z_]{3,40}$/.test(v)) return v.toUpperCase();
    }
  } catch {
    /* no body, or not JSON */
  }
  return null;
}

export class TbcClient {
  private readonly fetchFn: TbcFetch;
  private readonly gapMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private queue: Promise<unknown> = Promise.resolve();
  private lastStart = 0;
  private token: { value: string; until: number } | null = null;

  constructor(
    private readonly cfg: TbcConfig,
    opts: TbcClientOptions = {},
  ) {
    this.fetchFn = opts.fetch ?? (fetch as unknown as TbcFetch);
    this.gapMs = opts.gapMs ?? MIN_GAP_MS;
    this.sleep = opts.sleep ?? realSleep;
    this.now = opts.now ?? Date.now;
  }

  private sendOnce(stage: TbcStage, url: string, init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string }): Promise<TbcResponse> {
    const run = async (): Promise<TbcResponse> => {
      const wait = this.lastStart + this.gapMs - this.now();
      if (wait > 0) await this.sleep(wait);
      this.lastStart = this.now();
      try {
        return await this.fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch {
        // The cause is dropped on purpose: a fetch error can quote the request.
        throw new TbcError('network', null, stage);
      }
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async send(stage: TbcStage, url: string, init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string }): Promise<TbcResponse> {
    const res = await this.sendOnce(stage, url, init);
    if (!GATEWAY.has(res.status)) return res;
    await this.sleep(GATEWAY_RETRY_MS);
    return this.sendOnce(stage, url, init);
  }

  /** A token for the account services, kept until shortly before its hour is up. */
  private async accessToken(): Promise<string> {
    if (this.token && this.token.until > this.now()) return this.token.value;
    const basic = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString('base64');
    const res = await this.send('token', `${this.cfg.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: SCOPE }).toString(),
    });
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      const code = await codeOf(res);
      // Keys whose integration lacks the permission to read are refused the scope.
      if (code === 'INVALID_SCOPE') throw new TbcError('forbidden', res.status, 'token');
      if (code && INACTIVE.has(code)) throw new TbcError('user_inactive', res.status, 'token');
      throw new TbcError('unauthorized', res.status, 'token');
    }
    if (res.status === 429) throw new TbcError('rate_limited', res.status, 'token');
    if (res.status < 200 || res.status >= 300) throw new TbcError('http', res.status, 'token');
    let answer: Record<string, unknown>;
    try {
      answer = obj(await res.json());
    } catch {
      throw new TbcError('bad_answer', res.status, 'token');
    }
    const value = typeof answer.access_token === 'string' ? answer.access_token : '';
    if (!value) throw new TbcError('bad_answer', res.status, 'token');
    const ttl = Number(answer.expires_in);
    this.token = { value, until: this.now() + Math.max(0, (Number.isFinite(ttl) && ttl > 0 ? ttl : 3600) - 60) * 1000 };
    return value;
  }

  /**
   * The one door to the API: the token goes on here and a refusal becomes one
   * of our words here. A token the bank no longer takes is bought again once;
   * a 429 that asks for a short wait is waited out once.
   */
  private async get(path: string, query: Record<string, string>): Promise<unknown | null> {
    const url = `${this.cfg.baseUrl}${path}${Object.keys(query).length ? `?${new URLSearchParams(query).toString()}` : ''}`;
    for (let attempt = 0; ; attempt++) {
      const token = await this.accessToken();
      const res = await this.send('api', url, { method: 'GET', headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
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
      if (res.status === 400) {
        const code = await codeOf(res);
        if (code === 'INVALID_ACCOUNT') throw new TbcError('not_found', res.status, 'api');
        if (code && INACTIVE.has(code)) throw new TbcError('user_inactive', res.status, 'api');
        throw new TbcError('http', res.status, 'api');
      }
      if (res.status === 401) throw new TbcError('unauthorized', res.status, 'api');
      if (res.status === 403) throw new TbcError('forbidden', res.status, 'api');
      if (res.status === 404) throw new TbcError('not_found', res.status, 'api');
      if (res.status === 429) throw new TbcError('rate_limited', res.status, 'api');
      if (res.status < 200 || res.status >= 300) throw new TbcError('http', res.status, 'api');
      if (res.status === 204) return null;
      try {
        return await res.json();
      } catch {
        throw new TbcError('bad_answer', res.status, 'api');
      }
    }
  }

  /** The movements of one account in one currency for whole days, page by page: `GET /bab/v1/accounts/movements`. */
  async movements(pair: AccountPair, from: string, to: string): Promise<unknown[]> {
    const rows: unknown[] = [];
    for (let page = 0; ; page++) {
      if (page >= MAX_PAGES) throw new TbcError('bad_answer');
      const answer = await this.get('/bab/v1/accounts/movements', {
        AccountNumber: pair.iban,
        AccountCurrencyCode: pair.currency,
        PeriodFrom: from,
        PeriodTo: to,
        PageIndex: String(page),
        PageSize: String(PAGE_SIZE),
      });
      if (answer === null) return rows; // 204: nothing
      const body = obj(answer);
      const list = pick(body, 'transactions') ?? [];
      if (!Array.isArray(list)) throw new TbcError('bad_answer');
      rows.push(...list);
      const total = Number(pick(body, 'total') ?? NaN);
      if (Number.isFinite(total)) {
        if (rows.length >= total) return rows;
        // The bank said there is more and gave none: what it did give is not the whole period.
        if (list.length === 0) throw new TbcError('bad_answer');
      } else if (list.length < PAGE_SIZE) return rows;
    }
  }

  /** The statement of one account in one currency for whole days — at TBC a summary: the sums of credits and debits, in its minor units. */
  async statement(pair: AccountPair, from: string, to: string): Promise<{ creditTetri: number; debitTetri: number }> {
    const body = obj(await this.get('/bab/v1/accounts/statements', { AccountNumber: pair.iban, AccountCurrencyCode: pair.currency, PeriodFrom: from, PeriodTo: to }));
    // A sum the answer does not carry is not a zero: the check is then not made, and says why.
    const sum = (name: string) => {
      const v = pick(body, name);
      return v === null ? 0 : typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
    };
    const credit = sum('creditSum');
    const debit = sum('debitSum');
    if (!Number.isFinite(credit) || !Number.isFinite(debit)) throw new TbcError('bad_answer');
    return { creditTetri: Math.round(Math.abs(credit) * 100), debitTetri: Math.round(Math.abs(debit) * 100) };
  }
}

// ── Reading an answer ───────────────────────────────────────────────────

const text = (v: unknown): string | null => {
  if (typeof v === 'string') return v.replace(/\s+/g, ' ').trim() || null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
};

/** The movement's day: its value date (the file's "Date"), else the document's. */
function movementDay(o: Record<string, unknown>): string | null {
  return bankDay(pick(o, 'date')) ?? bankDay(pick(o, 'documentDate'));
}

const dmySlash = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/**
 * One movement of an account in one currency as a statement line. The stored
 * text has the shape of a row of TBC's CSV — day, description, signed sum,
 * partner, transaction id — so a line reads the same in the queue whichever
 * way it came, and the terminal's settlement is told by the same words
 * (`cardOf`).
 *
 * A movement not yet authorized (`statusCode` 1 or 2: a payment order
 * waiting for its signatures) has moved no money and is not a line yet; it
 * comes when it is done. A movement in another currency than the one asked
 * for is not this pair's, and is not read, as in the file. TBC gives no lari
 * for a sum in another currency.
 */
export function lineFromMovement(row: unknown, currency: BankCurrency): ParsedLine | null {
  const o = obj(row);
  const id = text(pick(o, 'movementId'));
  const day = movementDay(o);
  if (!id || !day) throw new TbcError('bad_answer');
  const its = text(pick(o, 'currency'));
  if (its && its.toUpperCase() !== currency) return null;
  const status = pick(o, 'statusCode');
  if (typeof status === 'number' && status !== 0) return null;
  const raw = pick(o, 'amount');
  const amount = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(amount)) throw new TbcError('bad_answer');
  const amountTetri = Math.round(Math.abs(amount) * 100);
  if (amountTetri === 0) return null; // nothing moved
  const isDebit = pick(o, 'isDebit');
  const direction: 'in' | 'out' = (typeof isDebit === 'boolean' ? isDebit : amount < 0) ? 'out' : 'in';
  const partner = text(pick(obj(pick(o, 'partnerAccountInfo')), 'partnerName'));
  const purpose = text(pick(o, 'purpose'));
  const signed = `${direction === 'out' ? '-' : ''}${(amountTetri / 100).toFixed(2)}`;
  const line = [dmySlash(day), purpose ?? '', signed, partner ?? '', id].join(' | ');
  // The terminal's settlement is a card payment, with the customer's sum stated in it — as in the file.
  const card = direction === 'in' ? cardOf({ amountTetri, grossTetri: null, feeTetri: null, raw: line }) : null;
  return {
    naturalKey: apiKey('mv', currency, id),
    docNo: text(pick(o, 'documentNumber')),
    occurredOn: day,
    direction,
    amountTetri,
    grossTetri: card?.grossTetri ?? null,
    feeTetri: card?.feeTetri ?? null,
    payer: partner,
    purpose: purpose?.slice(0, 300) ?? null,
    raw: line,
    channel: card ? 'acquiring' : 'transfer',
  };
}

// ── The pull ────────────────────────────────────────────────────────────

let fetchForTests: TbcFetch | null = null;
let clientOptsForTests: TbcClientOptions = {};

/** Tests stand in for the bank: no request leaves the machine. */
export function setTbcFetchForTests(fn: TbcFetch | null, opts: TbcClientOptions = {}): void {
  fetchForTests = fn;
  clientOptsForTests = opts;
}

export type TbcOutcome =
  | { status: 'off' }
  | { status: 'busy' }
  | (Tally & {
      status: 'ok';
      /** The days read (the nightly reading); a day a file covers in full is not read. */
      days: string[];
      /** Days whose movements do not add up to the bank's own sums for them: read again within the hour. */
      mismatched: string[];
      /** Each account and currency read, by its last four digits: what it listed and added, or why the bank gave nothing for it. */
      accounts: PairOutcome<TbcFailure>[];
    })
  // Nothing came: no account to ask, or the bank refused every one — the first refusal says why.
  | { status: 'failed'; failure: TbcFailure; httpStatus: number | null; stage: TbcStage | null };

type Ok = Extract<TbcOutcome, { status: 'ok' }>;

// One job at a time, as at Bank of Georgia: a pull that finds another job
// running or waiting skips its turn; the nightly reading waits for its turn.
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

/**
 * Ask the bank for the movements of yesterday and today and put the new ones
 * in the queue. Yesterday too: a movement the bank books under yesterday after
 * the night has read it would otherwise come by no road. It costs no request
 * more, and what is in already is known by its key. Never throws for the
 * bank's sake.
 */
export function syncTbcToday(now: Date = new Date()): Promise<TbcOutcome> {
  const cfg = tbcConfig();
  if (!cfg) return Promise.resolve({ status: 'off' });
  if (waiting > 0) return Promise.resolve({ status: 'busy' });
  return serial(() => pullToday(cfg, now));
}

/**
 * Read every movement from the last day the nightly reading reached up to
 * yesterday, add what the day's pulls did not bring, and check each day
 * against the bank's statement for it. Nothing to do once yesterday is read
 * and adds up — so the worker asks every hour and on every start.
 */
export function reconcileTbcNight(now: Date = new Date()): Promise<TbcOutcome> {
  const cfg = tbcConfig();
  if (!cfg) return Promise.resolve({ status: 'off' });
  return serial(() => readNights(cfg, now));
}

function client(cfg: TbcConfig): TbcClient {
  return new TbcClient(cfg, { ...clientOptsForTests, ...(fetchForTests ? { fetch: fetchForTests } : {}) });
}

/** The accounts to ask about: those the env file names, or the one the uploaded statements came from — in lari, as a file is read. */
async function accountsFor(cfg: TbcConfig): Promise<AccountPair[]> {
  if (cfg.badAccount) return [];
  if (cfg.accounts.length > 0) return cfg.accounts;
  const last = await prisma.statement.findFirst({ where: { bank: 'tbc', source: 'file', currency: 'GEL', account: { not: null } }, orderBy: { createdAt: 'desc' }, select: { account: true } });
  const iban = accountOf(last?.account, 'TB');
  return iban ? [{ iban, currency: 'GEL' }] : [];
}

const SYNC = { id: true } as const;

function blank(): Ok {
  return { status: 'ok', ...tally(), days: [], mismatched: [], accounts: [] };
}

/** One day of one account in one currency into the queue — parked, when it is not lari — under its statement from the API. */
function keep(pair: AccountPair, day: string, lines: ParsedLine[], outcome: Ok): Promise<void> {
  return keepDay('tbc', TBC_API_NAME, pair.iban, day, lines, outcome, pair.currency);
}

type Asked<T> = { pair: AccountPair; got: T; failure: null } | { pair: AccountPair; got: null; failure: TbcError };

/**
 * Each account and currency is asked on its own, as at Bank of Georgia
 * (`bog.ts`): one the bank refuses keeps nothing of the others out of the
 * queue and stops none of them, and the refusal is that pair's to say. A
 * refused token is the keys themselves: the pairs after it are not asked, and
 * are refused the same.
 */
async function eachPair<T>(pairs: AccountPair[], read: (pair: AccountPair) => Promise<T>): Promise<Asked<T>[]> {
  const asked: Asked<T>[] = [];
  let keys: TbcError | null = null;
  for (const pair of pairs) {
    try {
      if (keys) throw keys;
      asked.push({ pair, got: await read(pair), failure: null });
    } catch (err) {
      if (!(err instanceof TbcError)) throw err;
      if (err.stage === 'token') keys = err;
      asked.push({ pair, got: null, failure: err });
    }
  }
  return asked;
}

const failedWith = (err: TbcError): TbcOutcome => ({ status: 'failed', failure: err.failure, httpStatus: err.httpStatus, stage: err.stage });

/** What the job says of a pair the bank refused. */
const refusal = (err: TbcError) => ({ failure: err.failure, httpStatus: err.httpStatus });

// tbc_sync stays the lari link's: its card on «Выписки» and «Сегодня» read it,
// as before the dollars. It says what the pairs in lari did, and nothing of
// another currency — a day of dollars that does not add up holds no lari back.
const inLari = <T>(asked: Asked<T>[]) => asked.filter((a) => a.pair.currency === 'GEL');

async function pullToday(cfg: TbcConfig, now: Date): Promise<TbcOutcome> {
  const today = todayISO(now, env.TZ);
  const bank = client(cfg);
  const outcome = blank();
  const asked = await eachPair(await accountsFor(cfg), async (pair) => {
    const rows = await bank.movements(pair, addDays(today, -1), today);
    const lines = onceEach(rows.map((r) => lineFromMovement(r, pair.currency)));
    // What the screen and the log call "today's": the movements dated today.
    const listed = rows.filter((r) => movementDay(obj(r)) === today).length;
    const before = outcome.added;
    for (const [day, ofDay] of byDay(lines)) await keep(pair, day, ofDay, outcome);
    outcome.listed += listed;
    return { listed, added: outcome.added - before };
  });

  for (const a of asked) {
    const state = a.failure
      ? { lastTryAt: now, lastFailure: a.failure.failure, lastHttpStatus: a.failure.httpStatus }
      : { lastOkAt: now, lastTryAt: now, lastFailure: null, lastHttpStatus: null, todayCount: a.got.listed };
    await savePair('tbc', a.pair, addDays(today, -NIGHT_MAX_DAYS), state);
    outcome.accounts.push(pairOutcome<TbcFailure>(a.pair, a.failure ? refusal(a.failure) : a.got));
  }
  const lari = inLari(asked);
  const refused = asked.length === 0 ? new TbcError('no_account') : (lari.find((a) => a.failure)?.failure ?? null);
  if (refused) {
    const failed = { lastTryAt: now, lastFailure: refused.failure, lastHttpStatus: refused.httpStatus };
    await prisma.tbcSync.upsert({ where: SYNC, update: failed, create: { ...SYNC, ...failed } });
  } else if (lari.length > 0) {
    const ok = { lastOkAt: now, lastTryAt: now, lastFailure: null, lastHttpStatus: null, todayCount: lari.reduce((n, a) => n + (a.got?.listed ?? 0), 0) };
    await prisma.tbcSync.upsert({ where: SYNC, update: ok, create: { ...SYNC, ...ok } });
  }
  if (asked.length === 0) return failedWith(refused!);
  return asked.every((a) => a.failure) ? failedWith(asked[0]!.failure!) : outcome;
}

/**
 * Where a night leaves a pair, or the lari link: through yesterday when every
 * day it read adds up; else through the day before the first that did not,
 * read again from there within the hour — a movement the bank lists late
 * comes then. What was read is in the queue meanwhile, and stays.
 */
function nightAfter(mismatched: string[], yesterday: string) {
  const first = [...mismatched].sort()[0];
  return first
    ? { nightThrough: dateFromISO(addDays(first, -1)), nightFailure: 'mismatch', nightHttpStatus: null, nightMismatchOn: dateFromISO(first) }
    : { nightThrough: dateFromISO(yesterday), nightFailure: null, nightHttpStatus: null, nightMismatchOn: null };
}

async function readNights(cfg: TbcConfig, now: Date): Promise<TbcOutcome> {
  const yesterday = addDays(todayISO(now, env.TZ), -1);
  const back = addDays(yesterday, -(NIGHT_MAX_DAYS - 1));
  const sync = await prisma.tbcSync.findUnique({ where: SYNC });
  const pairs = await accountsFor(cfg);
  if (pairs.length === 0) {
    // No account to read: said once the night is due, as before.
    const reached = isoDate(sync?.nightThrough ?? null);
    if (reached && reached >= yesterday) return blank();
    const failed = { nightAt: now, nightFailure: 'no_account', nightHttpStatus: null };
    await prisma.tbcSync.upsert({ where: SYNC, update: failed, create: { ...SYNC, ...failed } });
    return failedWith(new TbcError('no_account'));
  }
  const rowOf = await pairRows('tbc');
  // Each pair's night is its own. A pair in lari was read before it had a row:
  // until its own night has run, the night tbc_sync kept is its night.
  const nightOf = (pair: AccountPair) => {
    const row = rowOf(pair);
    return row?.nightAt || pair.currency !== 'GEL' ? row : sync;
  };

  const outcome = blank();
  const bank = client(cfg);
  const asked = await eachPair(pairs, async (pair) => {
    const reached = isoDate(nightOf(pair)?.nightThrough ?? null);
    if (reached && reached >= yesterday) return null;
    // The first night of a pair in lari starts at the last day the uploaded
    // files reached: the days between that file and the first pull are read
    // too. A pair in another currency is new to the stand, and reads back once,
    // a month at most, from the day its row keeps.
    const start = reached ?? (await lastFileDay('tbc', pair.currency)) ?? (pair.currency === 'GEL' ? yesterday : (isoDate(rowOf(pair)?.readFrom ?? null) ?? back));
    const from = [[start, back].sort().pop()!, yesterday].sort()[0]!;
    const covered = await daysInFiles('tbc', pair.iban, from, yesterday, pair.currency);
    const open = daysFrom(from, yesterday).filter((d) => !covered.has(d));
    if (open.length === 0) return { listed: 0, added: 0, days: [], mismatched: [] };
    const rows = await bank.movements(pair, open[0]!, yesterday);
    const lines = onceEach(rows.map((r) => lineFromMovement(r, pair.currency))).filter((l) => !covered.has(l.occurredOn));
    const before = outcome.added;
    outcome.listed += rows.length;
    outcome.days.push(...open.filter((d) => !outcome.days.includes(d)));
    const days = byDay(lines);
    for (const [day, ofDay] of days) await keep(pair, day, ofDay, outcome);
    // The check: what the movements of a day add up to, against the bank's own sums for it, in the pair's currency.
    const mismatched: string[] = [];
    for (const day of open) {
      const sums = await bank.statement(pair, day, day);
      const ofDay = days.get(day) ?? [];
      const credit = ofDay.filter((l) => l.direction === 'in').reduce((s, l) => s + l.amountTetri, 0);
      const debit = ofDay.filter((l) => l.direction === 'out').reduce((s, l) => s + l.amountTetri, 0);
      if (credit !== sums.creditTetri || debit !== sums.debitTetri) mismatched.push(day);
    }
    outcome.mismatched.push(...mismatched);
    return { listed: rows.length, added: outcome.added - before, days: open, mismatched };
  });

  // A pair has read up to yesterday once its movements are read and add up.
  // One that failed keeps the day it had reached and is read again from there.
  for (const a of asked) {
    if (a.failure) {
      await savePair('tbc', a.pair, back, { nightThrough: nightOf(a.pair)?.nightThrough ?? null, nightAt: now, nightFailure: a.failure.failure, nightHttpStatus: a.failure.httpStatus });
    } else if (a.got) {
      await savePair('tbc', a.pair, back, { ...nightAfter(a.got.mismatched, yesterday), nightAt: now, nightAdded: a.got.added });
    }
    outcome.accounts.push(pairOutcome<TbcFailure>(a.pair, a.failure ? refusal(a.failure) : (a.got ?? { days: [] })));
  }
  // The lari link has read up to yesterday once every pair in lari it read has, and adds up.
  const lari = inLari(asked).filter((a) => a.failure || a.got);
  const refused = lari.find((a) => a.failure)?.failure;
  if (refused) {
    const failed = { nightAt: now, nightFailure: refused.failure, nightHttpStatus: refused.httpStatus };
    await prisma.tbcSync.upsert({ where: SYNC, update: failed, create: { ...SYNC, ...failed } });
  } else if (lari.length > 0) {
    const night = { ...nightAfter(lari.flatMap((a) => a.got?.mismatched ?? []), yesterday), nightAt: now, nightAdded: lari.reduce((n, a) => n + (a.got?.added ?? 0), 0) };
    await prisma.tbcSync.upsert({ where: SYNC, update: night, create: { ...SYNC, ...night } });
  }
  if (asked.every((a) => a.failure)) return failedWith(asked[0]!.failure!);
  outcome.days.sort();
  outcome.mismatched = [...new Set(outcome.mismatched)].sort();
  return outcome;
}

// ── For the screen ──────────────────────────────────────────────────────

export interface TbcApiStatus {
  /** 'ok' — the bank answered lately; 'silent' — it has not for a while, or never has; 'waiting' — not asked yet. */
  freshness: 'ok' | 'silent' | 'waiting';
  lastOkAt: string | null;
  failure: TbcFailure | null;
  nightThrough: string | null;
  nightFailure: TbcFailure | null;
  /** The first day whose movements did not add up to the bank's sums at the last nightly reading. */
  nightMismatchOn: string | null;
}

/** How the link stands, for "Деньги → Выписки". Null when it is off. */
export async function tbcApiStatus(now: Date = new Date()): Promise<TbcApiStatus | null> {
  const cfg = tbcConfig();
  if (!cfg) return null;
  const s = await prisma.tbcSync.findUnique({ where: SYNC });
  const lastOkAt = s?.lastOkAt ?? null;
  const freshness = !lastOkAt ? (s?.lastTryAt ? 'silent' : 'waiting') : now.getTime() - lastOkAt.getTime() > cfg.staleMs ? 'silent' : 'ok';
  return {
    freshness,
    lastOkAt: lastOkAt?.toISOString() ?? null,
    failure: (s?.lastFailure as TbcFailure | null) ?? null,
    nightThrough: isoDate(s?.nightThrough ?? null),
    nightFailure: (s?.nightFailure as TbcFailure | null) ?? null,
    nightMismatchOn: isoDate(s?.nightMismatchOn ?? null),
  };
}
