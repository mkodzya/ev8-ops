// Bank of Georgia, read through its Business Online API (B11-03; ADR-0020).
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

import { addDays, parseBankAmount, todayISO } from '@ev8/shared';
import { dateFromISO, isoDate } from './dates.js';
import { prisma } from './db.js';
import { env } from './env.js';
import { ingest, knownLines } from './statements/import.js';
import { readBogText, type ParsedLine } from './statements/parse.js';

export interface BogConfig {
  clientId: string;
  clientSecret: string;
  /** Accounts named in the stand's env file. Empty: the account of the statements uploaded from this bank. */
  accounts: string[];
  /** BOG_ACCOUNT is set and is not an account: the link stops rather than guess. */
  badAccount: boolean;
  /** The bank has gone silent when it has not answered for this long. */
  staleMs: number;
}

const TOKEN_URL = 'https://account.bog.ge/auth/realms/bog/protocol/openid-connect/token';
const API_BASE = 'https://api.businessonline.ge/api';
/** One currency, as for TBC: the company's money is in lari. */
export const BOG_CURRENCY = 'GEL';
/** How far back the nightly reading reaches when it has fallen behind. */
export const NIGHT_MAX_DAYS = 31;
const STALE_MINUTES = 20;

/** The name an API day carries in the list of statements. */
export const BOG_API_NAME = 'Business Online';

const IBAN = /^GE\d{2}[A-Z]{2}\d{16}$/;

/**
 * An account as the bank's API takes it: the IBAN, without the currency a
 * statement file writes after it (`GE…BG…GEL`). Null when it is not one.
 */
export function accountOf(raw: string | null | undefined): string | null {
  const t = (raw ?? '').replace(/\s+/g, '').toUpperCase();
  const iban = t.slice(0, 22);
  return IBAN.test(iban) && /^([A-Z]{3})?$/.test(t.slice(22)) ? iban : null;
}

/** Null without both keys: the link is then off. */
export function bogConfig(e: NodeJS.ProcessEnv = process.env): BogConfig | null {
  const clientId = (e.BOG_CLIENT_ID ?? '').trim();
  const clientSecret = (e.BOG_CLIENT_SECRET ?? '').trim();
  if (!clientId || !clientSecret) return null;
  const named = (e.BOG_ACCOUNT ?? '').split(/[\s,;]+/).filter(Boolean);
  const accounts = named.map(accountOf);
  const minutes = parseInt(e.BOG_STALE_MINUTES ?? '', 10);
  return {
    clientId,
    clientSecret,
    accounts: [...new Set(accounts.filter((a): a is string => a != null))],
    badAccount: accounts.some((a) => a == null),
    staleMs: (Number.isFinite(minutes) && minutes > 0 ? minutes : STALE_MINUTES) * 60_000,
  };
}

// ── The client ──────────────────────────────────────────────────────────

/** Why the bank gave nothing: our word for it, never its answer. */
export type BogFailure = 'unauthorized' | 'forbidden' | 'not_found' | 'rate_limited' | 'http' | 'network' | 'bad_answer' | 'no_account';

export class BogError extends Error {
  constructor(
    readonly failure: BogFailure,
    readonly httpStatus: number | null = null,
  ) {
    super(`bog: ${failure}${httpStatus ? ` (${httpStatus})` : ''}`);
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
  private send(url: string, init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string }): Promise<BogResponse> {
    const run = async (): Promise<BogResponse> => {
      const wait = this.lastStart + this.gapMs - this.now();
      if (wait > 0) await this.sleep(wait);
      this.lastStart = this.now();
      try {
        return await this.fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch {
        // The cause is dropped on purpose: a fetch error can quote the request.
        throw new BogError('network');
      }
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
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
    const res = await this.send(TOKEN_URL, {
      method: 'POST',
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
    });
    if (res.status === 400 || res.status === 401 || res.status === 403) throw new BogError('unauthorized', res.status);
    if (res.status === 429) throw new BogError('rate_limited', res.status);
    if (res.status < 200 || res.status >= 300) throw new BogError('http', res.status);
    let answer: Record<string, unknown>;
    try {
      answer = obj(await res.json());
    } catch {
      throw new BogError('bad_answer', res.status);
    }
    const value = typeof answer.access_token === 'string' ? answer.access_token : '';
    if (!value) throw new BogError('bad_answer', res.status);
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
      const res = await this.send(`${API_BASE}${path}`, { method: 'GET', headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
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
      if (res.status === 401) throw new BogError('unauthorized', res.status);
      if (res.status === 403) throw new BogError('forbidden', res.status);
      if (res.status === 404) throw new BogError('not_found', res.status);
      if (res.status === 429) throw new BogError('rate_limited', res.status);
      if (res.status < 200 || res.status >= 300) throw new BogError('http', res.status);
      if (res.status === 204) return null;
      try {
        return await res.json();
      } catch {
        throw new BogError('bad_answer', res.status);
      }
    }
  }

  /** The day's operations on one account: `api/v2/documents/todayactivities/{account}/{currency}`. */
  async today(account: string): Promise<unknown[]> {
    const body = await this.get(`/v2/documents/todayactivities/${encodeURIComponent(account)}/${BOG_CURRENCY}`);
    if (body === null) return [];
    if (Array.isArray(body)) return body;
    const rows = pick(obj(body), 'Records');
    if (Array.isArray(rows)) return rows;
    throw new BogError('bad_answer');
  }

  /**
   * The statement of one account for whole days, page by page:
   * `api/v2/statement/{account}/{currency}/{from}/{to}`, then
   * `…/{account}/{currency}/{id}/{page}` while the bank says there is more.
   */
  async statement(account: string, from: string, to: string): Promise<unknown[]> {
    const acc = encodeURIComponent(account);
    const first = obj(await this.get(`/v2/statement/${acc}/${BOG_CURRENCY}/${from}/${to}`));
    const rows = pick(first, 'Records');
    if (rows == null) return [];
    if (!Array.isArray(rows)) throw new BogError('bad_answer');
    const records = [...rows];
    const total = Number(pick(first, 'TotalCount'));
    const id = pick(first, 'Id');
    for (let page = 2; Number.isFinite(total) && records.length < total; page++) {
      if (page > MAX_PAGES || (typeof id !== 'number' && typeof id !== 'string')) throw new BogError('bad_answer');
      const more = pick(obj(await this.get(`/v2/statement/${acc}/${BOG_CURRENCY}/${encodeURIComponent(String(id))}/${page}`)), 'Records');
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

/**
 * A day as the bank writes it: `2026-10-14T00:00:00` is that day as written;
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

const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const money = (t: number) => (t / 100).toFixed(2);

interface Read {
  key: string;
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
  };
}

/**
 * One row of the day's operations (`todayactivities`). Its day is today: the
 * bank lists what moved on the account today, and its PostDate is the day
 * the document was made — a transfer sent last night and credited this
 * morning carries yesterday's.
 */
export function lineFromToday(row: unknown, today: string): ParsedLine | null {
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
  return lineOf({
    key: `api:today:${id}`,
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
  });
}

/** One entry of the statement (`statement`). */
export function lineFromEntry(row: unknown): ParsedLine | null {
  const o = obj(row);
  const id = text(pick(o, 'EntryId'));
  const day = bankDay(pick(o, 'EntryDate')) ?? bankDay(pick(o, 'DocumentValueDate'));
  if (!id || !day) throw new BogError('bad_answer');
  const sender = obj(pick(o, 'SenderDetails'));
  const beneficiary = obj(pick(o, 'BeneficiaryDetails'));
  return lineOf({
    key: `api:entry:${id}`,
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
  });
}

/** Each operation once, should the bank list one twice. */
function onceEach(lines: (ParsedLine | null)[]): ParsedLine[] {
  const seen = new Set<string>();
  return lines.filter((l): l is ParsedLine => {
    if (!l || seen.has(l.naturalKey)) return false;
    seen.add(l.naturalKey);
    return true;
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
  | {
      status: 'ok';
      /** Operations the bank listed. */
      listed: number;
      /** New lines in the queue, and of them: linked to money entered by hand, attached by a rule. */
      added: number;
      recorded: number;
      matched: number;
      /** Listed and already in: by their own key, by document number from another source, by day and sum. */
      known: { byKey: number; byDoc: number; bySum: number };
      /** The days read (the nightly reading); a day a file covers in full is not read. */
      days: string[];
    }
  | { status: 'failed'; failure: BogFailure; httpStatus: number | null };

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
 * when it has already reached yesterday — so the worker can ask on every
 * start as well, and a night the stand was down is caught up the next time.
 */
export function reconcileBogNight(now: Date = new Date()): Promise<BogOutcome> {
  const cfg = bogConfig();
  if (!cfg) return Promise.resolve({ status: 'off' });
  return serial(() => readNights(cfg, now));
}

function client(cfg: BogConfig): BogClient {
  return new BogClient(cfg, { ...clientOptsForTests, ...(fetchForTests ? { fetch: fetchForTests } : {}) });
}

/** The accounts to ask about: those the env file names, or the one the uploaded statements came from. */
async function accountsFor(cfg: BogConfig): Promise<string[]> {
  if (cfg.badAccount) return [];
  if (cfg.accounts.length > 0) return cfg.accounts;
  const last = await prisma.statement.findFirst({ where: { bank: 'bog', source: 'file', account: { not: null } }, orderBy: { createdAt: 'desc' }, select: { account: true } });
  const account = accountOf(last?.account);
  return account ? [account] : [];
}

const SYNC = { id: true } as const;

async function pullToday(cfg: BogConfig, now: Date): Promise<BogOutcome> {
  const today = todayISO(now, env.TZ);
  const lists: { account: string; lines: ParsedLine[]; listed: number }[] = [];
  try {
    const accounts = await accountsFor(cfg);
    if (accounts.length === 0) throw new BogError('no_account');
    const bank = client(cfg);
    for (const account of accounts) {
      const rows = await bank.today(account);
      lists.push({ account, lines: onceEach(rows.map((r) => lineFromToday(r, today))), listed: rows.length });
    }
  } catch (err) {
    if (!(err instanceof BogError)) throw err;
    const failed = { lastTryAt: now, lastFailure: err.failure, lastHttpStatus: err.httpStatus };
    await prisma.bogSync.upsert({ where: SYNC, update: failed, create: { ...SYNC, ...failed } });
    return { status: 'failed', failure: err.failure, httpStatus: err.httpStatus };
  }

  const outcome = blank();
  for (const { account, lines, listed } of lists) {
    outcome.listed += listed;
    for (const [day, ofDay] of byDay(lines)) await keep(account, day, ofDay, outcome);
  }
  const ok = { lastOkAt: now, lastTryAt: now, lastFailure: null, lastHttpStatus: null, todayCount: outcome.listed };
  await prisma.bogSync.upsert({ where: SYNC, update: ok, create: { ...SYNC, ...ok } });
  return outcome;
}

async function readNights(cfg: BogConfig, now: Date): Promise<BogOutcome> {
  const yesterday = addDays(todayISO(now, env.TZ), -1);
  const sync = await prisma.bogSync.findUnique({ where: SYNC });
  const reached = isoDate(sync?.nightThrough ?? null);
  if (reached && reached >= yesterday) return blank();

  // The first night starts at the last day the uploaded files reached: the
  // days between that file and the first pull are read too.
  const start = reached ?? (await lastFileDay()) ?? yesterday;
  const from = [[start, addDays(yesterday, -(NIGHT_MAX_DAYS - 1))].sort().pop()!, yesterday].sort()[0]!;
  const outcome = blank();
  try {
    const accounts = await accountsFor(cfg);
    if (accounts.length === 0) throw new BogError('no_account');
    const bank = client(cfg);
    for (const account of accounts) {
      const covered = await daysInFiles(account, from, yesterday);
      const open = daysFrom(from, yesterday).filter((d) => !covered.has(d));
      if (open.length === 0) continue;
      const rows = await bank.statement(account, open[0]!, yesterday);
      outcome.listed += rows.length;
      const lines = onceEach(rows.map(lineFromEntry)).filter((l) => !covered.has(l.occurredOn));
      outcome.days.push(...open.filter((d) => !outcome.days.includes(d)));
      for (const [day, ofDay] of byDay(lines)) await keep(account, day, ofDay, outcome);
    }
  } catch (err) {
    if (!(err instanceof BogError)) throw err;
    const failed = { nightAt: now, nightFailure: err.failure, nightHttpStatus: err.httpStatus };
    await prisma.bogSync.upsert({ where: SYNC, update: failed, create: { ...SYNC, ...failed } });
    return { status: 'failed', failure: err.failure, httpStatus: err.httpStatus };
  }
  const ok = { nightThrough: dateFromISO(yesterday), nightAt: now, nightFailure: null, nightHttpStatus: null, nightAdded: outcome.added };
  await prisma.bogSync.upsert({ where: SYNC, update: ok, create: { ...SYNC, ...ok } });
  outcome.days.sort();
  return outcome;
}

function blank(): Ok {
  return { status: 'ok', listed: 0, added: 0, recorded: 0, matched: 0, known: { byKey: 0, byDoc: 0, bySum: 0 }, days: [] };
}

function byDay(lines: ParsedLine[]): Map<string, ParsedLine[]> {
  const days = new Map<string, ParsedLine[]>();
  for (const l of lines) days.set(l.occurredOn, [...(days.get(l.occurredOn) ?? []), l]);
  return days;
}

function daysFrom(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

/** The last day a Bank of Georgia file reached, by its lines and by the period it states. */
async function lastFileDay(): Promise<string | null> {
  const [line, statement] = await Promise.all([
    prisma.statementLine.findFirst({ where: { bank: 'bog', statement: { source: 'file' } }, orderBy: { occurredOn: 'desc' }, select: { occurredOn: true } }),
    prisma.statement.findFirst({ where: { bank: 'bog', source: 'file', periodTo: { not: null } }, orderBy: { periodTo: 'desc' }, select: { periodTo: true } }),
  ]);
  return [isoDate(line?.occurredOn ?? null), isoDate(statement?.periodTo ?? null)].filter((d): d is string => d != null).sort().pop() ?? null;
}

/**
 * The days an uploaded statement of this account covers in full: every day
 * of its period but the last, and the last too when the file was uploaded
 * after that day was over. A file of the same bank that names no account is
 * taken to be this one — the company has one account at Bank of Georgia.
 */
async function daysInFiles(account: string, from: string, to: string): Promise<Set<string>> {
  const files = await prisma.statement.findMany({
    where: { bank: 'bog', source: 'file', periodFrom: { lte: dateFromISO(to)! }, periodTo: { gte: dateFromISO(from)! } },
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
 * One day of one account: its new lines into the queue, under that day's
 * statement from the API — made the first time the day brings a new line,
 * and added to as the day goes on.
 */
async function keep(account: string, day: string, lines: ParsedLine[], outcome: Ok): Promise<void> {
  const sorted = await knownLines({ bank: 'bog', lines });
  outcome.known.byKey += sorted.byKey;
  outcome.known.byDoc += sorted.byDoc;
  outcome.known.bySum += sorted.bySum;
  const statement = await prisma.statement.findFirst({ where: { bank: 'bog', source: 'api', account, periodFrom: dateFromISO(day)! }, select: { id: true, lineCount: true } });
  if (sorted.fresh.length === 0) {
    if (statement && lines.length > statement.lineCount) await prisma.statement.update({ where: { id: statement.id }, data: { lineCount: lines.length } });
    return;
  }
  const id =
    statement?.id ??
    (
      await prisma.statement.create({
        data: { bank: 'bog', source: 'api', fileName: BOG_API_NAME, fileSha256: 'api', account, periodFrom: dateFromISO(day), periodTo: dateFromISO(day), uploadedById: null },
        select: { id: true },
      })
    ).id;
  const { recorded, matched } = await ingest({ statementId: id, bank: 'bog', actorId: null, lines: sorted.fresh });
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
      after: { bank: 'bog', source: 'api', day, newLines: sorted.fresh.length, recorded, matched },
    },
  });
  outcome.added += sorted.fresh.length;
  outcome.recorded += recorded;
  outcome.matched += matched;
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
