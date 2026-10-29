// Bank of Georgia through its Business Online API (B11-03, ADR-0021). The
// bank itself is never called from here — a function stands in for it, so
// these run with no network and no key that opens anything. The bank answers
// only the server's address anyway.
//
// Every account number, document number, name and sum below is invented for
// the test. The account is not a real one; the dates are in 2031 so that no
// line another suite loaded can be taken for one of these.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BogClient, BogError, accountOf, bankDay, bogConfig, lineFromEntry, lineFromToday, reconcileBogNight, setBogFetchForTests, syncBogToday, type BogConfig, type BogFetch } from '../src/lib/bog.js';
import type { AccountPair } from '../src/lib/statements/apiDays.js';
import { alreadyIn, bogCardOf, cardRepeats, sameCardPayment, type SameLineCandidate } from '../src/lib/statements/sameLine.js';
import { HAS_DB, call, getApp, json, loginAs, uniq } from './helpers.js';

const ID = 'test-client-id';
const SECRET = 'test-client-secret-that-opens-nothing';
const ACCOUNT = 'GE00BG0000000000000001'; // invented
/** A second account of the company, invented too. */
const OTHER = 'GE00BG0000000000000003';
/** The account as the bank's API reads it: in lari, and in dollars on the same IBAN. */
const GEL: AccountPair = { iban: ACCOUNT, currency: 'GEL' };
const USD: AccountPair = { iban: ACCOUNT, currency: 'USD' };
const TOKEN_URL = 'https://account.bog.ge/auth/realms/bog/protocol/openid-connect/token';
const API = 'https://api.businessonline.ge/api';

const cfg = (over: Partial<BogConfig> = {}): BogConfig => ({ clientId: ID, clientSecret: SECRET, accounts: [GEL], badAccount: false, staleMs: 20 * 60_000, ...over });
const quick = { gapMs: 0, sleep: async () => {} };

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** The bank as far as this link knows it: a token, the day's operations, the statement in pages — of each currency apart. */
function fakeBank(state: {
  today?: unknown[];
  entries?: unknown[];
  /** The day's operations and the statement of the account in another currency, by its code. */
  other?: Record<string, { today?: unknown[]; entries?: unknown[] }>;
  pageSize?: number;
  tokenStatus?: number;
  tokenStatuses?: number[];
  apiStatus?: number[];
  retryAfter?: string;
  /** Accounts the bank refuses these keys — an IBAN, or an IBAN in one currency as `IBAN/USD` — with the status it answers about them. */
  refused?: Record<string, number>;
}) {
  const calls: Call[] = [];
  let tokens = 0;
  // The days of the last statement asked for: its pages hold those days.
  let range: [string, string] | null = null;
  const apiStatus = [...(state.apiStatus ?? [])];
  const tokenStatuses = [...(state.tokenStatuses ?? [])];
  const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
    status,
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    json: async () => body,
  });
  const fetchFn: BogFetch = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    if (url === TOKEN_URL) {
      const once = tokenStatuses.shift();
      if (once) return reply(once, { error: 'busy' });
      if (state.tokenStatus) return reply(state.tokenStatus, { error: 'invalid_client', error_description: 'ТЕСТ Тайна' });
      tokens++;
      return reply(200, { access_token: `token-${tokens}`, expires_in: 300, token_type: 'Bearer' });
    }
    const forced = apiStatus.shift();
    if (forced) return reply(forced, { message: 'ТЕСТ Тайна' }, state.retryAfter ? { 'retry-after': state.retryAfter } : {});
    const path = url.slice(API.length);
    const refusal = Object.entries(state.refused ?? {}).find(([account]) => `${path}/`.includes(`/${account}/`));
    if (refusal) return reply(refusal[1], { message: 'ТЕСТ Тайна' });
    // The currency is the part of the address after the account.
    const currency = /^\/v2\/(?:documents\/todayactivities|statement)\/[^/]+\/([A-Z]{3})(?:\/|$)/.exec(path)?.[1];
    const book = currency === 'GEL' ? state : (state.other?.[currency ?? ''] ?? {});
    if (path.startsWith('/v2/documents/todayactivities/')) return reply(200, book.today ?? []);
    const paged = /^\/v2\/statement\/[^/]+\/[A-Z]{3}\/(\d+)\/(\d+)$/.exec(path);
    const size = state.pageSize ?? 1000;
    // Like the bank, the statement holds the days asked for and no others.
    const dayOf = (e: unknown) => String((e as { EntryDate?: string }).EntryDate ?? '').slice(0, 10);
    const ranged = /^\/v2\/statement\/[^/]+\/[A-Z]{3}\/(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})$/.exec(path);
    if (ranged) range = [ranged[1]!, ranged[2]!];
    const all = (book.entries ?? []).filter((e) => !range || (dayOf(e) >= range[0] && dayOf(e) <= range[1]));
    if (paged) {
      const page = Number(paged[2]);
      return reply(200, { Id: Number(paged[1]), Count: 0, TotalCount: all.length, Records: all.slice((page - 1) * size, page * size) });
    }
    if (ranged) {
      return reply(200, { Id: 777, Count: Math.min(size, all.length), TotalCount: all.length, Records: all.slice(0, size) });
    }
    return reply(404, {});
  };
  /** An entry the bank books later, under a day already read. */
  const addEntry = (e: unknown) => {
    state.entries = [...(state.entries ?? []), e];
  };
  return { fetchFn, calls, tokens: () => tokens, addEntry };
}

/** The two sides of an operation: money in comes from someone to the company, money out the other way. */
function sides(o: { debit?: number; sender?: string }) {
  const them = { Name: o.sender ?? null, Inn: null, AccountNumber: 'GE00TB0000000000000002', BankCode: 'TBCBGE22', BankName: 'TEST BANK' };
  const us = { Name: 'TEST COMPANY', Inn: null, AccountNumber: ACCOUNT, BankCode: 'BAGAGE22', BankName: 'TEST BANK' };
  return o.debit ? { from: us, to: them } : { from: them, to: us };
}

/**
 * One of the day's operations, as `todayactivities` lists it. Its sums are in
 * the account's currency; `base` is what the bank says it is in lari, the same
 * sum for an account in lari.
 */
function activity(o: { id: number; day: string; doc?: string; credit?: number; debit?: number; sender?: string; comment?: string; nomination?: string; base?: number }) {
  return {
    Id: o.id,
    DocKey: o.id * 10,
    DocNo: o.doc ?? null,
    PostDate: `${o.day}T00:00:00`,
    ValueDate: `${o.day}T00:00:00`,
    EntryType: 'PMD',
    EntryComment: o.comment ?? 'tankhis gadaritskhva',
    EntryCommentEn: null,
    Nomination: o.nomination ?? 'qira',
    Credit: o.credit ?? 0,
    Debit: o.debit ?? 0,
    Amount: o.credit ?? -(o.debit ?? 0),
    AmountBase: o.base == null ? (o.credit ?? -(o.debit ?? 0)) : o.debit ? -o.base : o.base,
    PayerName: sides(o).from.Name,
    PayerInn: null,
    Sender: sides(o).from,
    Beneficiary: sides(o).to,
  };
}

/** One entry of the statement; `base` as for an operation of the day. */
function entry(o: { id: number; day: string; doc?: string; credit?: number; debit?: number; sender?: string; comment?: string; base?: number }) {
  const base = o.base ?? o.credit ?? o.debit ?? 0;
  return {
    EntryDate: `${o.day}T00:00:00`,
    EntryDocumentNumber: o.doc ?? null,
    EntryAccountNumber: ACCOUNT,
    EntryAmountDebit: o.debit ?? 0,
    EntryAmountCredit: o.credit ?? 0,
    EntryAmount: o.credit ?? o.debit ?? 0,
    EntryAmountDebitBase: o.debit ? base : 0,
    EntryAmountCreditBase: o.credit ? base : 0,
    EntryAmountBase: base,
    EntryComment: o.comment ?? 'tankhis gadaritskhva',
    DocumentProductGroup: 'PMD',
    DocumentValueDate: `${o.day}T00:00:00`,
    SenderDetails: sides(o).from,
    BeneficiaryDetails: sides(o).to,
    DocumentNomination: 'qira',
    DocumentKey: o.id * 10,
    EntryId: o.id,
    DocumentPayerName: sides(o).from.Name,
  };
}

/**
 * A payment by the company's card as Bank of Georgia words it — in Georgian in
 * the API, where both listings of one payment carry the same words; in English
 * in the CSV export. The shop, the sum, the minute and the card's digits are
 * invented.
 */
function cardText(o: { sum: number; at: string; shop?: string; card?: string; mcc?: string; lang?: 'ka' | 'en' }): string {
  const gel = o.sum.toFixed(2);
  const shop = o.shop ?? 'Example Cafe, Tbilisi, 1 Test Street';
  return o.lang === 'en'
    ? `Payment - Amount: GEL${gel}; Merchant: ${shop}; MCC:${o.mcc ?? '5814'}; Date: ${o.at}; Card No: ****${o.card ?? '0000'}; Payment transaction amount and currency: ${gel} GEL`
    : `გადახდა - თანხა: GEL${gel}; ობიექტი: ${shop}; MCC:${o.mcc ?? '5814'}; თარიღი: ${o.at}; ბარათის No: ****${o.card ?? '0000'}; გადახდის ოპერაციის თანხა და ვალუტა: ${gel} GEL`;
}

/**
 * The two numbers the bank gives one card payment, invented in their shapes:
 * the posting's (eleven digits), then the card operation's (twelve).
 */
const posting = (n: number) => `110000${String(n).padStart(5, '0')}`;
const cardOperation = (n: number) => `6200000${String(n).padStart(5, '0')}`;

/** What the bank says of a card payment in each listing's nomination (invented shop, card and code). */
const nominations = (sum: number, at: string) => ({
  posting: `ჩამოჭრა თანხაზე ${sum.toFixed(2)} GEL, მერჩანტი: EXAMPLE CAFE>TBILISI GE, ბარათი ***0000, კოდი: 000000`,
  cardOperation: `გადახდა - თანხა: GEL ${sum} საკომისიო: 0; MCC: 5814; ობიექტი: სატესტო კაფე; თარიღი: ${at}:07; ბარათის ნომერი: 00000*******0000`,
});

describe('the Bank of Georgia settings', () => {
  it('are off without both keys', () => {
    expect(bogConfig({})).toBeNull();
    expect(bogConfig({ BOG_CLIENT_ID: ID })).toBeNull();
    expect(bogConfig({ BOG_CLIENT_SECRET: SECRET })).toBeNull();
  });

  it('take the account from the env file, as a statement file writes it or bare', () => {
    expect(bogConfig({ BOG_CLIENT_ID: ID, BOG_CLIENT_SECRET: SECRET })?.accounts).toEqual([]);
    expect(bogConfig({ BOG_CLIENT_ID: ID, BOG_CLIENT_SECRET: SECRET, BOG_ACCOUNT: ` ${ACCOUNT.toLowerCase()}GEL ` })?.accounts).toEqual([GEL]);
    const bad = bogConfig({ BOG_CLIENT_ID: ID, BOG_CLIENT_SECRET: SECRET, BOG_ACCOUNT: 'GE00BG123' });
    expect(bad?.badAccount).toBe(true);
    expect(accountOf(`${ACCOUNT}GEL`)).toBe(ACCOUNT);
    expect(accountOf('GE00TB0000000000000002')).toBe('GE00TB0000000000000002');
    expect(accountOf('not an account')).toBeNull();
  });

  // The company opened an account in dollars (29.10.2026): the env file names it
  // as the bank writes it in a file, with its currency after the IBAN.
  it('read an account in each currency it is named in, each pair once, and stop at a currency the stand does not read', () => {
    const keys = { BOG_CLIENT_ID: ID, BOG_CLIENT_SECRET: SECRET };
    expect(bogConfig({ ...keys, BOG_ACCOUNT: `${ACCOUNT} ${ACCOUNT}USD, ${ACCOUNT}GEL;${ACCOUNT.toLowerCase()}usd` })).toMatchObject({ accounts: [GEL, USD], badAccount: false });
    expect(bogConfig({ ...keys, BOG_ACCOUNT: `${ACCOUNT}EUR` })?.accounts).toEqual([{ iban: ACCOUNT, currency: 'EUR' }]);
    expect(bogConfig({ ...keys, BOG_ACCOUNT: `${ACCOUNT} ${ACCOUNT}GBP` })?.badAccount).toBe(true);
  });
});

describe('reading the bank’s answer', () => {
  it('reads a day however the bank writes it, and an empty .NET date as none', () => {
    expect(bankDay('2031-03-10T00:00:00')).toBe('2031-03-10');
    expect(bankDay('2031-03-10')).toBe('2031-03-10');
    expect(bankDay('2031-03-09T21:30:00Z', 'Asia/Tbilisi')).toBe('2031-03-10'); // 01:30 in Tbilisi
    expect(bankDay('10.03.2031')).toBe('2031-03-10');
    expect(bankDay('0001-01-01T00:00:00')).toBeNull();
    expect(bankDay(null)).toBeNull();
  });

  it('makes an operation a line shaped like a file’s row: payer, document, sum, direction', () => {
    const l = lineFromToday(activity({ id: 501, day: '2031-03-10', doc: '0042', credit: 150, sender: 'TEST PAYER' }), '2031-03-10', 'GEL')!;
    expect(l).toMatchObject({ naturalKey: 'api:today:501', docNo: '0042', occurredOn: '2031-03-10', direction: 'in', amountTetri: 15000, payer: 'TEST PAYER', purpose: 'qira', channel: 'transfer' });
    expect(l.raw.split(' | ').slice(0, 5)).toEqual(['10.03.2031', '0042', 'GE00TB0000000000000002', '', '150.00']);
    const out = lineFromToday(activity({ id: 502, day: '2031-03-10', debit: 7.6, comment: 'Beneficiary: TEST SHOP; Details: komisia' }), '2031-03-10', 'GEL')!;
    expect(out).toMatchObject({ direction: 'out', amountTetri: 760, payer: 'TEST SHOP', purpose: 'qira' });
    expect(out.raw.split(' | ').slice(2, 5)).toEqual(['GE00TB0000000000000002', '7.60', '']);
    // A transfer sent last night and credited this morning: the bank's PostDate is yesterday, the line is today's.
    expect(lineFromToday(activity({ id: 504, day: '2031-03-09', doc: '1', credit: 1 }), '2031-03-10', 'GEL')!.occurredOn).toBe('2031-03-10');
  });

  it('reads a card payment for both its sums, with no payer, as a file’s card line is read', () => {
    const l = lineFromEntry(entry({ id: 601, day: '2031-03-10', credit: 196.8, sender: 'ACQUIRER', comment: 'Caricxva - gadaxda; Tanxa:GEL 200; sakomisio: GEL 3.20; terminalis ID: TEST' }), 'GEL')!;
    expect(l).toMatchObject({ naturalKey: 'api:entry:601', direction: 'in', amountTetri: 19680, grossTetri: 20000, feeTetri: 320, payer: null, channel: 'acquiring' });
  });

  it('reads an operation of the account in dollars under a key of its own, in cents, with the bank’s lari beside it', () => {
    expect(lineFromToday(activity({ id: 501, day: '2031-03-10', doc: '0042', credit: 150, base: 405.5 }), '2031-03-10', 'USD')).toMatchObject({
      naturalKey: 'api:today:USD:501',
      docNo: '0042',
      direction: 'in',
      amountTetri: 15000,
      bankGelTetri: 40550,
    });
    expect(lineFromEntry(entry({ id: 601, day: '2031-03-10', debit: 20, base: 54.1 }), 'USD')).toMatchObject({ naturalKey: 'api:entry:USD:601', direction: 'out', amountTetri: 2000, bankGelTetri: 5410 });
    // An answer without the bank's lari is read all the same.
    const bare = { ...entry({ id: 602, day: '2031-03-10', credit: 5 }), EntryAmountCreditBase: undefined, EntryAmountBase: undefined };
    expect(lineFromEntry(bare, 'USD')).toMatchObject({ naturalKey: 'api:entry:USD:602', amountTetri: 500, bankGelTetri: null });
    // In lari the keys are what they always were, and there is no second sum.
    expect(lineFromToday(activity({ id: 501, day: '2031-03-10', credit: 150 }), '2031-03-10', 'GEL')).not.toHaveProperty('bankGelTetri');
    expect(lineFromEntry(entry({ id: 601, day: '2031-03-10', debit: 20 }), 'GEL')).toMatchObject({ naturalKey: 'api:entry:601' });
    expect(lineFromEntry(entry({ id: 601, day: '2031-03-10', debit: 20 }), 'GEL')).not.toHaveProperty('bankGelTetri');
  });

  it('skips an operation where nothing moved, and refuses one without its id', () => {
    expect(lineFromToday(activity({ id: 503, day: '2031-03-10' }), '2031-03-10', 'GEL')).toBeNull();
    expect(() => lineFromEntry({ EntryDate: '2031-03-10T00:00:00', EntryAmountCredit: 5 }, 'GEL')).toThrow(BogError);
  });
});

describe('one operation, two sources', () => {
  const l = (key: string, day: string, amount: number, doc: string | null, direction: 'in' | 'out' = 'in'): SameLineCandidate => ({ naturalKey: key, occurredOn: day, amountTetri: amount, docNo: doc, direction });

  it('knows a file’s line in the API by its document number, a day apart at most', () => {
    const stored = [l('hash-a', '2031-03-10', 15000, '0042')];
    expect(alreadyIn([l('api:today:1', '2031-03-10', 15000, '42')], stored)).toMatchObject({ fresh: [], byDoc: 1 });
    expect(alreadyIn([l('api:entry:1', '2031-03-11', 15000, '0042')], stored).byDoc).toBe(1);
    expect(alreadyIn([l('api:entry:1', '2031-03-12', 15000, '0042')], stored).fresh).toHaveLength(1);
  });

  it('takes a different document number, sum or direction for a different operation', () => {
    const stored = [l('hash-a', '2031-03-10', 15000, '0042')];
    expect(alreadyIn([l('api:today:1', '2031-03-10', 15000, '0043')], stored).fresh).toHaveLength(1);
    expect(alreadyIn([l('api:today:1', '2031-03-10', 15100, '0042')], stored).fresh).toHaveLength(1);
    expect(alreadyIn([l('api:today:1', '2031-03-10', 15000, '0042', 'out')], stored).fresh).toHaveLength(1);
  });

  it('counts: three payments of 150 on a day, two of them in, leave one to add', () => {
    const stored = [l('hash-a', '2031-03-10', 15000, null), l('hash-b', '2031-03-10', 15000, null)];
    const incoming = [l('api:today:1', '2031-03-10', 15000, '1'), l('api:today:2', '2031-03-10', 15000, '2'), l('api:today:3', '2031-03-10', 15000, '3')];
    const r = alreadyIn(incoming, stored);
    expect(r.bySum).toBe(2);
    expect(r.fresh.map((x) => x.naturalKey)).toEqual(['api:today:3']);
  });

  it('never takes two lines of one source for one: the bank’s ids tell them apart', () => {
    const stored = [l('api:today:1', '2031-03-10', 15000, '0042')];
    const r = alreadyIn([l('api:today:1', '2031-03-10', 15000, '0042'), l('api:today:2', '2031-03-10', 15000, '0042')], stored);
    expect(r.byKey).toBe(1);
    expect(r.fresh.map((x) => x.naturalKey)).toEqual(['api:today:2']);
  });

  it('knows the day’s pull in the nightly statement', () => {
    const stored = [l('api:today:1', '2031-03-10', 15000, '0042'), l('api:today:2', '2031-03-10', 2000, null)];
    const r = alreadyIn([l('api:entry:9', '2031-03-10', 15000, '0042'), l('api:entry:10', '2031-03-10', 2000, '77'), l('api:entry:11', '2031-03-10', 2000, '78')], stored);
    expect(r).toMatchObject({ byDoc: 1, bySum: 1 });
    expect(r.fresh.map((x) => x.naturalKey)).toEqual(['api:entry:11']);
  });
});

describe('a card payment the bank lists twice (rule 5, issue #16)', () => {
  const at = '03/03/2031 18:13';
  const card = (key: string, day: string, doc: string | null, o: Partial<Parameters<typeof cardText>[0]> = {}): SameLineCandidate => ({
    naturalKey: key,
    occurredOn: day,
    amountTetri: 1240,
    docNo: doc,
    direction: 'out',
    raw: `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)} | ${doc ?? ''} |  | 12.40 |  | ${cardText({ sum: 12.4, at, ...o })}`,
  });

  it('reads the shop, the minute, the MCC and the card from either wording, and nothing from a transfer', () => {
    expect(bogCardOf(cardText({ sum: 12.4, at }))).toEqual({ merchant: 'example cafe', at: '2031-03-03 18:13', mcc: '5814', card: '0000' });
    expect(bogCardOf(cardText({ sum: 12.4, at, lang: 'en' }))).toEqual({ merchant: 'example cafe', at: '2031-03-03 18:13', mcc: '5814', card: '0000' });
    // The bank writes one shop two ways: `>` and the city, or a comma and the street.
    expect(bogCardOf(cardText({ sum: 12.4, at, shop: 'Example Cafe>TBILISI GE, Georgia' }))?.merchant).toBe('example cafe');
    expect(bogCardOf('Beneficiary: TEST SHOP; Details: komisia')).toBeNull();
    expect(bogCardOf(null)).toBeNull();
    // Cut short after the minute: what is there is read. Before the minute: no card payment for the rule.
    const text = cardText({ sum: 12.4, at });
    expect(bogCardOf(text.slice(0, text.indexOf('ბარათის No') + 14))).toMatchObject({ at: '2031-03-03 18:13', card: null });
    expect(bogCardOf(text.slice(0, text.indexOf('თარიღი') + 12))).toBeNull();
  });

  it('knows the card operation’s listing as the posting already in — the same day, or the next one — and keeps the posting', () => {
    const stored = [card('api:today:1', '2031-03-03', posting(1))];
    expect(alreadyIn([card('api:today:2', '2031-03-03', cardOperation(1))], stored)).toMatchObject({ fresh: [], byCard: 1 });
    expect(alreadyIn([card('api:today:2', '2031-03-04', cardOperation(1))], stored)).toMatchObject({ fresh: [], byCard: 1 });
    // The night and a file know it the same way, whichever of its numbers they carry.
    expect(alreadyIn([card('api:entry:9', '2031-03-03', cardOperation(1))], stored).byCard).toBe(1);
    expect(alreadyIn([card('hash-a', '2031-03-03', cardOperation(1), { lang: 'en', shop: 'Example Cafe>TBILISI GE, Georgia' })], stored).byCard).toBe(1);
    // The day's list holds both listings: the posting is known by its key, and still closes its twin.
    const both = alreadyIn([card('api:today:1', '2031-03-03', posting(1)), card('api:today:2', '2031-03-03', cardOperation(1))], stored);
    expect(both).toMatchObject({ fresh: [], byKey: 1, byCard: 1 });
    // Both new in one reading: the first stays.
    expect(alreadyIn([card('api:today:1', '2031-03-03', posting(1)), card('api:today:2', '2031-03-03', cardOperation(1))], []).fresh.map((x) => x.naturalKey)).toEqual(['api:today:1']);
  });

  it('keeps two purchases of one sum in one shop two lines: at different minutes, and in one minute', () => {
    const stored = [card('api:today:1', '2031-03-03', posting(1))];
    expect(alreadyIn([card('api:today:2', '2031-03-03', cardOperation(2), { at: '03/03/2031 18:40' })], stored).fresh).toHaveLength(1);
    expect(alreadyIn([card('api:today:2', '2031-03-03', posting(2), { at: '03/03/2031 18:40' })], stored).fresh).toHaveLength(1);
    // In one minute each comes first under a posting number of its own: two numbers of one kind are two payments.
    expect(alreadyIn([card('api:today:2', '2031-03-03', posting(2))], stored).fresh).toHaveLength(1);
    // Their card operations later: each closes one posting, and nothing is added.
    const two = [...stored, card('api:today:2', '2031-03-03', posting(2))];
    expect(alreadyIn([card('api:today:3', '2031-03-03', cardOperation(1)), card('api:today:4', '2031-03-03', cardOperation(2))], two)).toMatchObject({ fresh: [], byCard: 2 });
    expect(alreadyIn([card('api:today:3', '2031-03-03', cardOperation(1)), card('api:today:4', '2031-03-03', cardOperation(2)), card('api:today:5', '2031-03-03', cardOperation(3))], two).fresh).toHaveLength(1);
  });

  it('takes another card, another MCC, another shop, a sum, a direction or days too far apart for another payment', () => {
    const stored = [card('api:today:1', '2031-03-03', posting(1))];
    expect(alreadyIn([card('api:today:2', '2031-03-03', cardOperation(1), { card: '1111' })], stored).fresh).toHaveLength(1);
    expect(alreadyIn([card('api:today:2', '2031-03-03', cardOperation(1), { mcc: '4814' })], stored).fresh).toHaveLength(1);
    expect(alreadyIn([card('api:today:2', '2031-03-03', cardOperation(1), { shop: 'Another Shop, Tbilisi' })], stored).fresh).toHaveLength(1);
    expect(alreadyIn([{ ...card('api:today:2', '2031-03-03', cardOperation(1)), amountTetri: 1250 }], stored).fresh).toHaveLength(1);
    expect(alreadyIn([{ ...card('api:today:2', '2031-03-03', cardOperation(1)), direction: 'in' }], stored).fresh).toHaveLength(1);
    expect(alreadyIn([card('api:today:2', '2031-03-07', cardOperation(1))], stored).fresh).toHaveLength(1);
    // A number missing on either side: the rule does not say.
    expect(sameCardPayment(card('a', '2031-03-03', null), card('b', '2031-03-03', cardOperation(1)))).toBe(false);
    expect(sameCardPayment(card('a', '2031-03-03', posting(1)), card('b', '2031-03-03', cardOperation(1)))).toBe(true);
  });

  it('names, of lines already in, the later listing of each payment and the line it repeats — once each', () => {
    const t0 = new Date('2031-03-03T14:15:00Z').getTime();
    const line = (id: string, doc: string, minutes: number, o: Partial<Parameters<typeof cardText>[0]> = {}) => ({ ...card(`api:today:${id}`, '2031-03-03', doc, o), id, createdAt: new Date(t0 + minutes * 60_000) });
    const lines = [
      line('b', cardOperation(1), 5),
      line('a', posting(1), 0),
      line('c', posting(2), 1),
      line('d', cardOperation(2), 6),
      line('e', cardOperation(3), 7),
      line('f', posting(4), 2, { at: '03/03/2031 19:00' }),
    ];
    const repeats = cardRepeats(lines);
    expect([...repeats.entries()].map(([id, twin]) => [id, twin.id]).sort()).toEqual([
      ['b', 'a'],
      ['d', 'c'],
    ]);
  });
});

describe('the client', () => {
  it('buys a token with the keys as Basic and in the body, and asks the API with the token alone, only by GET', async () => {
    const bank = fakeBank({ today: [activity({ id: 1, day: '2031-03-10', credit: 10 })] });
    await new BogClient(cfg(), { ...quick, fetch: bank.fetchFn }).today(GEL);
    const [token, get] = bank.calls;
    expect(token!.url).toBe(TOKEN_URL);
    expect(token!.method).toBe('POST');
    expect(token!.headers.authorization).toBe(`Basic ${Buffer.from(`${ID}:${SECRET}`).toString('base64')}`);
    expect(new URLSearchParams(token!.body)).toEqual(new URLSearchParams({ grant_type: 'client_credentials', client_id: ID, client_secret: SECRET }));
    expect(get!.url).toBe(`${API}/v2/documents/todayactivities/${ACCOUNT}/GEL`);
    expect(get!.method).toBe('GET');
    expect(get!.headers.authorization).toBe('Bearer token-1');
    for (const c of bank.calls.filter((c) => c.url.startsWith(API))) {
      expect(c.method).toBe('GET');
      expect(JSON.stringify(c)).not.toContain(SECRET);
    }
  });

  it('keeps the token while it is good, and buys a new one once when the bank stops taking it', async () => {
    const bank = fakeBank({ today: [], apiStatus: [0, 401] });
    const client = new BogClient(cfg(), { ...quick, fetch: bank.fetchFn });
    await client.today(GEL);
    await client.today(GEL);
    expect(bank.tokens()).toBe(2);
    expect(bank.calls.filter((c) => c.url.startsWith(API))).toHaveLength(3);
  });

  it('waits out a short 429 once; a long one, or a second, fails with our word', async () => {
    const waited: number[] = [];
    const sleep = async (ms: number) => void waited.push(ms);
    const once = fakeBank({ today: [], apiStatus: [429], retryAfter: '2' });
    await new BogClient(cfg(), { gapMs: 0, sleep, fetch: once.fetchFn }).today(GEL);
    expect(waited).toContain(2000);
    const long = fakeBank({ today: [], apiStatus: [429], retryAfter: '3600' });
    await expect(new BogClient(cfg(), { ...quick, fetch: long.fetchFn }).today(GEL)).rejects.toMatchObject({ failure: 'rate_limited', httpStatus: 429 });
  });

  it('asks once more after a pause when the bank’s gateway is busy (503), for the token and for the API alike', async () => {
    const waited: number[] = [];
    const sleep = async (ms: number) => void waited.push(ms);
    const blip = fakeBank({ today: [activity({ id: 1, day: '2031-03-10', credit: 10 })], tokenStatuses: [503], apiStatus: [502] });
    expect(await new BogClient(cfg(), { gapMs: 0, sleep, fetch: blip.fetchFn }).today(GEL)).toHaveLength(1);
    expect(waited.filter((w) => w === 3000)).toHaveLength(2);
    const down = fakeBank({ apiStatus: [503, 503] });
    await expect(new BogClient(cfg(), { ...quick, fetch: down.fetchFn }).today(GEL)).rejects.toMatchObject({ failure: 'http', httpStatus: 503, stage: 'api' });
    const noToken = fakeBank({ tokenStatuses: [503, 503] });
    await expect(new BogClient(cfg(), { ...quick, fetch: noToken.fetchFn }).today(GEL)).rejects.toMatchObject({ failure: 'http', httpStatus: 503, stage: 'token' });
  });

  it('turns a refusal into our word, with nothing of the bank’s answer or of the keys in it', async () => {
    const refused = fakeBank({ tokenStatus: 401 });
    const err = await new BogClient(cfg(), { ...quick, fetch: refused.fetchFn }).today(GEL).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BogError);
    expect(err).toMatchObject({ failure: 'unauthorized', httpStatus: 401, stage: 'token' });
    expect(String(err)).not.toContain('Тайна');
    expect(String(err)).not.toContain(SECRET);
    const forbidden = fakeBank({ apiStatus: [403] });
    await expect(new BogClient(cfg(), { ...quick, fetch: forbidden.fetchFn }).today(GEL)).rejects.toMatchObject({ failure: 'forbidden' });
    const dead: BogFetch = async () => Promise.reject(new Error(`connect ECONNREFUSED ${SECRET}`));
    const net = await new BogClient(cfg(), { ...quick, fetch: dead }).today(GEL).catch((e: unknown) => e);
    expect(net).toMatchObject({ failure: 'network' });
    expect(String(net)).not.toContain(SECRET);
  });

  it('reads the statement page after page while the bank says there is more', async () => {
    const entries = [1, 2, 3, 4, 5].map((id) => entry({ id, day: '2031-03-10', credit: id }));
    const bank = fakeBank({ entries, pageSize: 2 });
    const rows = await new BogClient(cfg(), { ...quick, fetch: bank.fetchFn }).statement(GEL, '2031-03-09', '2031-03-10');
    expect(rows).toHaveLength(5);
    expect(bank.calls.filter((c) => c.url.startsWith(API)).map((c) => c.url.slice(API.length))).toEqual([
      `/v2/statement/${ACCOUNT}/GEL/2031-03-09/2031-03-10`,
      `/v2/statement/${ACCOUNT}/GEL/777/2`,
      `/v2/statement/${ACCOUNT}/GEL/777/3`,
    ]);
  });

  it('asks for an account in the currency of the pair, the statement’s further pages too', async () => {
    const bank = fakeBank({ other: { USD: { today: [], entries: [1, 2, 3].map((id) => entry({ id, day: '2031-03-10', credit: id })) } }, pageSize: 2 });
    const client = new BogClient(cfg(), { ...quick, fetch: bank.fetchFn });
    await client.today(USD);
    expect(await client.statement(USD, '2031-03-09', '2031-03-10')).toHaveLength(3);
    expect(bank.calls.filter((c) => c.url.startsWith(API)).map((c) => c.url.slice(API.length))).toEqual([
      `/v2/documents/todayactivities/${ACCOUNT}/USD`,
      `/v2/statement/${ACCOUNT}/USD/2031-03-09/2031-03-10`,
      `/v2/statement/${ACCOUNT}/USD/777/2`,
    ]);
  });

  it('keeps under five requests a second: each one waits out the gap after the one before', async () => {
    let clock = 0;
    const waits: number[] = [];
    const bank = fakeBank({ today: [] });
    const client = new BogClient(cfg(), { fetch: bank.fetchFn, gapMs: 250, now: () => clock, sleep: async (ms) => void (waits.push(ms), (clock += ms)) });
    await client.today(GEL);
    await client.today(GEL);
    expect(waits.every((w) => w <= 250)).toBe(true);
    expect(waits.length).toBeGreaterThanOrEqual(2);
  });
});

describe.skipIf(!HAS_DB)('the pull, the night and the queue', () => {
  // Sums nobody else in this database has: the rules then attach nothing, and a line is told by its sum.
  const run = Date.now() % 100_000;
  let test = 0;
  let base = 0;
  const sum = (n: number) => base + n;
  const at = (day: string, time = '10:00') => new Date(`${day}T${time}:00+04:00`);
  const isoOf = (d: Date | null | undefined) => d?.toISOString().slice(0, 10) ?? null;

  async function reset() {
    const { prisma } = await import('../src/lib/db.js');
    // Each account and currency keeps its own state since the dollars: a suite starts with none.
    await prisma.bankApiAccount.deleteMany({ where: { bank: 'bog' } });
    await prisma.bogSync.update({
      where: { id: true },
      data: { lastOkAt: null, lastTryAt: null, lastFailure: null, lastHttpStatus: null, todayCount: 0, nightThrough: null, nightAt: null, nightFailure: null, nightHttpStatus: null, nightAdded: 0 },
    });
  }

  async function linesOf(amounts: number[]) {
    const { prisma } = await import('../src/lib/db.js');
    return prisma.statementLine.findMany({ where: { bank: 'bog', amountTetri: { in: amounts.map((a) => Math.round(a * 100)) } }, include: { statement: true }, orderBy: { naturalKey: 'asc' } });
  }

  /** A Bank of Georgia CSV of this invented account, as the export writes it: money in under «krediti», out under «debeti». */
  function csv(period: [string, string], rows: { day: string; doc: string; credit?: string; debit?: string; text: string }[]) {
    const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}`;
    return [
      ',,,"angariSis mflobeli: TEST",,,,',
      `,,,"angariSis #:${ACCOUNT}GEL",,,,`,
      `"TEST",,,"periodi: ${dmy(period[0])}-${dmy(period[1])}",,,,`,
      '"TariRi","sabuTis #","mokorespondento angariSi","debeti","krediti","kursi","eqv.lari","operaciis Sinaarsi"',
      ...rows.map(
        (r) => `"${r.day.slice(8, 10)}.${r.day.slice(5, 7)}.${r.day.slice(0, 4)}","${r.doc}","GE00TB0000000000000002","${r.debit ?? ''}","${r.credit ?? ''}","1","${r.credit ?? r.debit}","${r.text}"`,
      ),
    ].join('\n');
  }

  beforeEach(async () => {
    base = 100_000 + run * 100 + (test++ % 10) * 10;
    process.env.BOG_CLIENT_ID = ID;
    process.env.BOG_CLIENT_SECRET = SECRET;
    process.env.BOG_ACCOUNT = ACCOUNT;
    await reset();
  });
  afterEach(() => {
    delete process.env.BOG_CLIENT_ID;
    delete process.env.BOG_CLIENT_SECRET;
    delete process.env.BOG_ACCOUNT;
    setBogFetchForTests(null);
  });
  afterAll(reset);

  it('puts the day’s operations in the queue once, under one statement of the day, and a second pull adds nothing', async () => {
    const day = '2031-03-10';
    const bank = fakeBank({
      today: [activity({ id: 9101, day, doc: '0101', credit: sum(1), sender: `TEST PAYER ${uniq()}` }), activity({ id: 9102, day, doc: '0102', debit: sum(2), comment: 'Beneficiary: TEST SHOP' })],
    });
    setBogFetchForTests(bank.fetchFn, quick);

    const first = await syncBogToday(at(day));
    expect(first).toMatchObject({ status: 'ok', listed: 2, added: 2, known: { byKey: 0, byDoc: 0, bySum: 0 }, fromStatement: false });
    const second = await syncBogToday(at(day, '10:05'));
    expect(second).toMatchObject({ status: 'ok', listed: 2, added: 0, known: { byKey: 2 } });

    const lines = await linesOf([sum(1), sum(2)]);
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.status === 'unmatched')).toBe(true); // an unknown payer waits for a person
    expect(new Set(lines.map((l) => l.statementId)).size).toBe(1);
    const st = lines[0]!.statement;
    expect(st).toMatchObject({ bank: 'bog', source: 'api', fileName: 'Business Online', account: ACCOUNT, newLines: 2, uploadedById: null });

    const { prisma } = await import('../src/lib/db.js');
    const sync = await prisma.bogSync.findUnique({ where: { id: true } });
    expect(sync).toMatchObject({ lastFailure: null, todayCount: 2 });
    expect(sync?.lastOkAt?.getTime()).toBe(at(day, '10:05').getTime());

    const journal = await prisma.auditLog.findMany({ where: { action: 'statement.pull', entityId: st.id } });
    expect(journal).toHaveLength(1);
    expect(journal[0]!.actorId).toBeNull();
    expect(JSON.stringify(journal[0]!.after)).not.toContain('TEST PAYER');
  });

  it('takes the day from today’s statement when the list of the day’s operations is down, and the night knows those lines by their key', async () => {
    const day = '2031-03-15';
    const bank = fakeBank({ apiStatus: [503, 503], entries: [entry({ id: 99501, day, doc: '0501', credit: sum(1) })] });
    setBogFetchForTests(bank.fetchFn, quick);
    expect(await syncBogToday(at(day))).toMatchObject({ status: 'ok', listed: 1, added: 1, fromStatement: true });
    expect(bank.calls.filter((c) => c.url.startsWith(API)).map((c) => c.url.slice(API.length)).at(-1)).toBe(`/v2/statement/${ACCOUNT}/GEL/${day}/${day}`);
    const { prisma } = await import('../src/lib/db.js');
    await prisma.bogSync.update({ where: { id: true }, data: { nightThrough: new Date('2031-03-14T00:00:00Z') } });
    expect(await reconcileBogNight(at('2031-03-16', '01:17'))).toMatchObject({ status: 'ok', listed: 1, added: 0, known: { byKey: 1 } });
    expect(await linesOf([sum(1)])).toHaveLength(1);

    // A refusal is not a busy gateway: it is said, and the statement is not asked instead.
    setBogFetchForTests(fakeBank({ apiStatus: [403] }).fetchFn, quick);
    expect(await syncBogToday(at(day, '11:00'))).toMatchObject({ status: 'failed', failure: 'forbidden', stage: 'api' });
  });

  it('does not bring again a line already loaded from a CSV: one operation, known by its document number', async () => {
    const day = '2031-03-11';
    const owner = await loginAs('owner');
    const res = await call(owner, 'POST', '/api/statements', {
      fileName: 'StatementExport.csv',
      text: csv([day, day], [{ day, doc: '0201', credit: sum(1).toFixed(2), text: `tankhis gadaritskhva: Incoming Transfer - Amount: GEL${sum(1)}; Sender: TEST PAYER; Details: qira` }]),
    });
    expect(res.statusCode, res.body).toBe(201);

    setBogFetchForTests(fakeBank({ today: [activity({ id: 9201, day, doc: '201', credit: sum(1) }), activity({ id: 9202, day, doc: '0202', credit: sum(2) })] }).fetchFn, quick);
    const pulled = await syncBogToday(at(day, '18:00'));
    expect(pulled).toMatchObject({ status: 'ok', listed: 2, added: 1, known: { byDoc: 1 } });
    const lines = await linesOf([sum(1), sum(2)]);
    expect(lines.map((l) => [l.amountTetri, l.statement.source])).toEqual(
      expect.arrayContaining([
        [Math.round(sum(1) * 100), 'file'],
        [Math.round(sum(2) * 100), 'api'],
      ]),
    );
    expect(lines).toHaveLength(2);

    // And the other way: the same CSV, exported later with the second line in it, adds nothing.
    const later = csv([day, day], [
      { day, doc: '0201', credit: sum(1).toFixed(2), text: `tankhis gadaritskhva: Incoming Transfer - Amount: GEL${sum(1)}; Sender: TEST PAYER; Details: qira` },
      { day, doc: '0202', credit: sum(2).toFixed(2), text: 'tankhis gadaritskhva: Incoming Transfer - other words' },
    ]);
    const preview = json<{ newLines: number; alreadyIn: number }>(await call(owner, 'POST', '/api/statements/preview', { fileName: 'StatementExport.csv', text: later }));
    expect(preview).toMatchObject({ newLines: 0, alreadyIn: 2 });
  });

  it('reads the night’s statement from where the last night stopped, skips the days a file covers, and adds what the pulls missed', async () => {
    const owner = await loginAs('owner');
    // A file of 01–08.03, uploaded long before its last day was over: 01–07 are whole, 08 is not.
    await call(owner, 'POST', '/api/statements', {
      fileName: 'StatementExport.csv',
      text: csv(['2031-03-01', '2031-03-08'], [{ day: '2031-03-08', doc: '0301', credit: sum(1).toFixed(2), text: 'tankhis gadaritskhva: Incoming Transfer; Details: qira' }]),
    });
    const { prisma } = await import('../src/lib/db.js');
    await prisma.bogSync.update({ where: { id: true }, data: { nightThrough: new Date('2031-03-06T00:00:00Z') } });

    // The day's pull of the 9th brought one operation; the statement has it, and one more.
    setBogFetchForTests(fakeBank({ today: [activity({ id: 9301, day: '2031-03-09', doc: '0302', credit: sum(2) })] }).fetchFn, quick);
    await syncBogToday(at('2031-03-09'));

    const bank = fakeBank({
      entries: [
        entry({ id: 99300, day: '2031-03-07', doc: '0300', credit: sum(9) }), // a whole day of the file: not taken
        entry({ id: 99301, day: '2031-03-08', doc: '0301', credit: sum(1) }), // in the file
        entry({ id: 99302, day: '2031-03-09', doc: '0302', credit: sum(2) }), // in the day's pull
        entry({ id: 99303, day: '2031-03-09', doc: '0303', credit: sum(3) }), // missed
      ],
    });
    setBogFetchForTests(bank.fetchFn, quick);
    const night = await reconcileBogNight(at('2031-03-10', '01:17'));
    expect(night).toMatchObject({ status: 'ok', listed: 3, added: 1, known: { byDoc: 2 }, days: ['2031-03-08', '2031-03-09'] });
    expect(bank.calls.filter((c) => c.url.startsWith(API)).map((c) => c.url.slice(API.length))).toEqual([`/v2/statement/${ACCOUNT}/GEL/2031-03-08/2031-03-09`]);
    expect(await linesOf([sum(9)])).toHaveLength(0);
    expect(await linesOf([sum(1), sum(2), sum(3)])).toHaveLength(3);

    const sync = await prisma.bogSync.findUnique({ where: { id: true } });
    expect(sync).toMatchObject({ nightFailure: null, nightAdded: 1 });
    expect(sync?.nightThrough?.toISOString().slice(0, 10)).toBe('2031-03-09');

    // Asked again before the morning — the worker asks every hour and on every start — it reads nothing.
    const early = await reconcileBogNight(at('2031-03-10', '04:17'));
    expect(early).toMatchObject({ status: 'ok', listed: 0, days: [] });
    expect(bank.calls.filter((c) => c.url.startsWith(API))).toHaveLength(1);

    // The bank books part of the evening after midnight under the day before:
    // in the morning yesterday is read once more, and what came late comes in.
    bank.addEntry(entry({ id: 99304, day: '2031-03-09', doc: '0304', credit: sum(4) }));
    const morning = await reconcileBogNight(at('2031-03-10', '06:17'));
    expect(morning).toMatchObject({ status: 'ok', added: 1, days: ['2031-03-09'] });
    expect(bank.calls.filter((c) => c.url.startsWith(API)).at(-1)!.url.slice(API.length)).toBe(`/v2/statement/${ACCOUNT}/GEL/2031-03-09/2031-03-09`);
    expect(await linesOf([sum(4)])).toHaveLength(1);

    // After the morning's reading the day is read whole: the rest of the day asks nothing.
    const later = await reconcileBogNight(at('2031-03-10', '09:00'));
    expect(later).toMatchObject({ status: 'ok', listed: 0, days: [] });
    expect(bank.calls.filter((c) => c.url.startsWith(API))).toHaveLength(2);
  });

  it('keeps the failure and its word, and the night that failed is read the next time', async () => {
    setBogFetchForTests(fakeBank({ tokenStatus: 401 }).fetchFn, quick);
    expect(await syncBogToday(at('2031-03-12'))).toEqual({ status: 'failed', failure: 'unauthorized', httpStatus: 401, stage: 'token' });
    expect(await reconcileBogNight(at('2031-03-12'))).toEqual({ status: 'failed', failure: 'unauthorized', httpStatus: 401, stage: 'token' });
    const { prisma } = await import('../src/lib/db.js');
    const sync = await prisma.bogSync.findUnique({ where: { id: true } });
    expect(sync).toMatchObject({ lastFailure: 'unauthorized', lastHttpStatus: 401, lastOkAt: null, nightFailure: 'unauthorized', nightThrough: null });

    const owner = await loginAs('owner');
    const page = json<{ banks: { bank: string; api: { freshness: string; failure: string | null; nightFailure: string | null } | null; accounts: unknown[] }[] }>(await call(owner, 'GET', '/api/statements'));
    expect(page.banks.find((b) => b.bank === 'bog')?.api).toMatchObject({ freshness: 'silent', failure: 'unauthorized', nightFailure: 'unauthorized' });
    expect(page.banks.find((b) => b.bank === 'tbc')?.api).toBeNull();
    // An account in lari alone is the bank's card, as before the dollars: no card of an account beside it.
    for (const b of page.banks) expect(b.accounts).toEqual([]);
  });

  // The company opened a dollar account at the bank (29.10.2026). A second
  // account the bank refuses these keys must not keep the lari account's money
  // out of «Разобрать».
  it('asks each account on its own: one the bank refuses keeps nothing of the other out of the queue, and the pull says which', async () => {
    const day = '2031-03-21';
    const { prisma } = await import('../src/lib/db.js');
    const paid = activity({ id: 9801, day, doc: '0801', credit: sum(6) });
    process.env.BOG_ACCOUNT = `${ACCOUNT} ${OTHER}`;
    setBogFetchForTests(fakeBank({ today: [paid], refused: { [OTHER]: 403 } }).fetchFn, quick);
    expect(await syncBogToday(at(day))).toMatchObject({
      status: 'ok',
      added: 1,
      accounts: [
        { last4: '0001', currency: 'GEL', listed: 1, added: 1, failure: null },
        { last4: '0003', currency: 'GEL', listed: 0, added: 0, failure: 'forbidden', httpStatus: 403 },
      ],
    });
    const lines = await linesOf([sum(6)]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.statement).toMatchObject({ source: 'api', account: ACCOUNT });
    // The link in lari says it failed: an account in lari the bank does not answer is not hidden behind one it does.
    expect(await prisma.bogSync.findUnique({ where: { id: true } })).toMatchObject({ lastFailure: 'forbidden', lastHttpStatus: 403, lastOkAt: null });
    const pairs = await prisma.bankApiAccount.findMany({ where: { bank: 'bog' }, orderBy: { account: 'asc' } });
    expect(pairs.map((p) => [p.account, p.lastFailure, p.lastOkAt?.getTime() ?? null])).toEqual([
      [ACCOUNT, null, at(day).getTime()],
      [OTHER, 'forbidden', null],
    ]);

    // The refused account first: the one after it is asked all the same, with the same token.
    process.env.BOG_ACCOUNT = `${OTHER},${ACCOUNT}`;
    const bank = fakeBank({ today: [paid, activity({ id: 9802, day, doc: '0802', credit: sum(7) })], refused: { [OTHER]: 404 } });
    setBogFetchForTests(bank.fetchFn, quick);
    expect(await syncBogToday(at(day, '10:05'))).toMatchObject({
      status: 'ok',
      accounts: [
        { last4: '0003', failure: 'not_found', httpStatus: 404 },
        { last4: '0001', failure: null, listed: 2, added: 1 },
      ],
    });
    expect(bank.calls.filter((c) => c.url.startsWith(API)).map((c) => c.url.slice(API.length))).toEqual([
      `/v2/documents/todayactivities/${OTHER}/GEL`,
      `/v2/documents/todayactivities/${ACCOUNT}/GEL`,
    ]);
    expect(bank.tokens()).toBe(1);
    expect(await linesOf([sum(6), sum(7)])).toHaveLength(2);

    // Keys the bank refuses are refused for every account: the second is not asked.
    const keys = fakeBank({ tokenStatus: 401 });
    setBogFetchForTests(keys.fetchFn, quick);
    expect(await syncBogToday(at(day, '10:10'))).toEqual({ status: 'failed', failure: 'unauthorized', httpStatus: 401, stage: 'token' });
    expect(keys.calls).toHaveLength(1);

    // Both answer: the link is well again.
    setBogFetchForTests(fakeBank({ today: [paid] }).fetchFn, quick);
    expect(await syncBogToday(at(day, '10:15'))).toMatchObject({ status: 'ok', added: 0 });
    expect(await prisma.bogSync.findUnique({ where: { id: true } })).toMatchObject({ lastFailure: null, lastHttpStatus: null });
  });

  it('reads the night of each account on its own, and has read up to yesterday only once every account is read', async () => {
    const { prisma } = await import('../src/lib/db.js');
    await prisma.bogSync.update({ where: { id: true }, data: { nightThrough: new Date('2031-03-22T00:00:00Z') } });
    const entries = [entry({ id: 99801, day: '2031-03-23', doc: '0811', credit: sum(7) })];

    // The refused account comes first, and the night goes on to the next.
    process.env.BOG_ACCOUNT = `${OTHER} ${ACCOUNT}`;
    setBogFetchForTests(fakeBank({ entries, refused: { [OTHER]: 403 } }).fetchFn, quick);
    expect(await reconcileBogNight(at('2031-03-24', '06:17'))).toMatchObject({
      status: 'ok',
      added: 1,
      accounts: [
        { last4: '0003', failure: 'forbidden', httpStatus: 403 },
        { last4: '0001', failure: null, added: 1, days: ['2031-03-22', '2031-03-23'] },
      ],
    });
    expect(await linesOf([sum(7)])).toHaveLength(1);
    const held = await prisma.bogSync.findUnique({ where: { id: true } });
    expect(held).toMatchObject({ nightFailure: 'forbidden', nightHttpStatus: 403 });
    expect(held?.nightThrough?.toISOString().slice(0, 10)).toBe('2031-03-22');

    // The next hour both answer: the night reaches yesterday, and the line already in does not come twice.
    setBogFetchForTests(fakeBank({ entries }).fetchFn, quick);
    expect(await reconcileBogNight(at('2031-03-24', '07:17'))).toMatchObject({ status: 'ok', added: 0, days: ['2031-03-22', '2031-03-23'] });
    expect(await linesOf([sum(7)])).toHaveLength(1);
    const read = await prisma.bogSync.findUnique({ where: { id: true } });
    expect(read).toMatchObject({ nightFailure: null, nightHttpStatus: null });
    expect(read?.nightThrough?.toISOString().slice(0, 10)).toBe('2031-03-23');
  });

  // The account in dollars (29.10.2026, decision D1 of docs/spec/usd-accounts-plan.md):
  // read next to the lari, kept apart from it, and outside every sum in lari.
  it('reads one IBAN in lari and in dollars as two accounts: a statement of the day each, the dollars parked with the bank’s lari beside them', async () => {
    const day = '2031-03-25';
    const { prisma } = await import('../src/lib/db.js');
    process.env.BOG_ACCOUNT = `${ACCOUNT} ${ACCOUNT}USD`;
    // The same id, document and sum in both currencies: 150 dollars are not 150 lari, nor one operation with them.
    const bank = fakeBank({
      today: [activity({ id: 9901, day, doc: '0901', credit: sum(1) })],
      other: { USD: { today: [activity({ id: 9901, day, doc: '0901', credit: sum(1), base: 405.5 }), activity({ id: 9902, day, doc: '0902', debit: sum(2), base: 54.1 })] } },
    });
    setBogFetchForTests(bank.fetchFn, quick);
    const pulled = await syncBogToday(at(day));
    expect(pulled).toMatchObject({
      status: 'ok',
      listed: 3,
      added: 3,
      known: { byKey: 0, byDoc: 0, bySum: 0 },
      accounts: [
        { last4: '0001', currency: 'GEL', listed: 1, added: 1, failure: null },
        { last4: '0001', currency: 'USD', listed: 2, added: 2, failure: null },
      ],
    });
    // What the job says goes to the worker's log: an account by its last four digits, never more.
    expect(JSON.stringify(pulled)).not.toContain(ACCOUNT);
    expect(bank.calls.filter((c) => c.url.startsWith(API)).map((c) => c.url.slice(API.length))).toEqual([`/v2/documents/todayactivities/${ACCOUNT}/GEL`, `/v2/documents/todayactivities/${ACCOUNT}/USD`]);

    const lines = await linesOf([sum(1), sum(2)]);
    expect(lines.map((l) => [l.naturalKey, l.currency, l.status, l.resolution, l.bankGelTetri]).sort()).toEqual([
      ['api:today:9901', 'GEL', 'unmatched', null, null],
      ['api:today:USD:9901', 'USD', 'ignored', 'foreign', 40550],
      ['api:today:USD:9902', 'USD', 'ignored', 'foreign', 5410],
    ]);
    const days = await prisma.statement.findMany({ where: { id: { in: lines.map((l) => l.statementId) } }, orderBy: { currency: 'asc' } });
    expect(days.map((s) => [s.source, s.account, s.currency, s.newLines])).toEqual([
      ['api', ACCOUNT, 'GEL', 1],
      ['api', ACCOUNT, 'USD', 2],
    ]);

    // The lari link counts the lari; each pair keeps its own, and a new pair in dollars the day it reads back from.
    expect(await prisma.bogSync.findUnique({ where: { id: true } })).toMatchObject({ lastFailure: null, todayCount: 1 });
    const pairs = await prisma.bankApiAccount.findMany({ where: { bank: 'bog' }, orderBy: { currency: 'asc' } });
    expect(pairs.map((p) => [p.account, p.currency, p.todayCount, p.lastFailure, isoOf(p.readFrom)])).toEqual([
      [ACCOUNT, 'GEL', 1, null, null],
      [ACCOUNT, 'USD', 2, null, '2031-02-22'],
    ]);
    expect(await syncBogToday(at(day, '10:05'))).toMatchObject({ status: 'ok', listed: 3, added: 0, known: { byKey: 3 } });
  });

  it('leaves the lari green, its lines in, when the bank refuses the dollars — by day and by night', async () => {
    const day = '2031-03-26';
    const { prisma } = await import('../src/lib/db.js');
    process.env.BOG_ACCOUNT = `${ACCOUNT} ${ACCOUNT}USD`;
    setBogFetchForTests(fakeBank({ today: [activity({ id: 9911, day, doc: '0911', credit: sum(3) })], refused: { [`${ACCOUNT}/USD`]: 403 } }).fetchFn, quick);
    expect(await syncBogToday(at(day))).toMatchObject({
      status: 'ok',
      added: 1,
      accounts: [
        { currency: 'GEL', failure: null, added: 1 },
        { currency: 'USD', failure: 'forbidden', httpStatus: 403 },
      ],
    });
    expect(await linesOf([sum(3)])).toHaveLength(1);
    const sync = await prisma.bogSync.findUnique({ where: { id: true } });
    expect(sync).toMatchObject({ lastFailure: null, lastHttpStatus: null, todayCount: 1 });
    expect(sync?.lastOkAt?.getTime()).toBe(at(day).getTime());
    const owner = await loginAs('owner');
    type Page = { banks: { bank: string; api: { freshness: string; failure: string | null } | null; accounts: { last4: string; currency: string; api: { freshness: string; failure: string | null } }[] }[] };
    const page = json<Page>(await call(owner, 'GET', '/api/statements'));
    expect(page.banks.find((b) => b.bank === 'bog')?.api).toMatchObject({ freshness: 'ok', failure: null });
    // The dollars have a card of their own on «Выписки», which says why the bank gives nothing for them — by four digits, never the account.
    expect(page.banks.find((b) => b.bank === 'bog')?.accounts).toMatchObject([{ last4: '0001', currency: 'USD', api: { freshness: 'silent', failure: 'forbidden', lastOkAt: null } }]);
    expect(JSON.stringify(page.banks)).not.toContain(ACCOUNT);
    const pairs = await prisma.bankApiAccount.findMany({ where: { bank: 'bog' }, orderBy: { currency: 'asc' } });
    expect(pairs.map((p) => [p.currency, p.lastFailure, p.lastHttpStatus, p.lastOkAt?.getTime() ?? null])).toEqual([
      ['GEL', null, null, at(day).getTime()],
      ['USD', 'forbidden', 403, null],
    ]);

    // The night: the bank does not know the account in dollars. The lari reaches yesterday all the same.
    await prisma.bogSync.update({ where: { id: true }, data: { nightThrough: new Date('2031-03-24T00:00:00Z') } });
    setBogFetchForTests(fakeBank({ entries: [entry({ id: 99911, day: '2031-03-25', doc: '0912', credit: sum(4) })], refused: { [`${ACCOUNT}/USD`]: 404 } }).fetchFn, quick);
    expect(await reconcileBogNight(at('2031-03-27', '06:17'))).toMatchObject({
      status: 'ok',
      added: 1,
      days: ['2031-03-24', '2031-03-25', '2031-03-26'],
      accounts: [
        { currency: 'GEL', failure: null, added: 1 },
        { currency: 'USD', failure: 'not_found', httpStatus: 404 },
      ],
    });
    const night = await prisma.bogSync.findUnique({ where: { id: true } });
    expect(night).toMatchObject({ nightFailure: null, nightHttpStatus: null, nightAdded: 1 });
    expect(isoOf(night?.nightThrough)).toBe('2031-03-26');
    const dollars = await prisma.bankApiAccount.findFirstOrThrow({ where: { bank: 'bog', currency: 'USD' } });
    expect(dollars).toMatchObject({ nightFailure: 'not_found', nightHttpStatus: 404, nightThrough: null });
  });

  it('reads a new account back once, a month at most, while the lari reads on from where its night stopped', async () => {
    const { prisma } = await import('../src/lib/db.js');
    await prisma.bogSync.update({ where: { id: true }, data: { nightThrough: new Date('2031-04-08T00:00:00Z') } });
    process.env.BOG_ACCOUNT = `${ACCOUNT}GEL,${ACCOUNT}USD`;
    const bank = fakeBank({
      entries: [entry({ id: 99921, day: '2031-04-09', doc: '0921', credit: sum(1) })],
      other: { USD: { entries: [entry({ id: 99921, day: '2031-03-12', doc: '0921', credit: sum(1), base: 2702.7 }), entry({ id: 99922, day: '2031-04-09', doc: '0922', debit: sum(2), base: 27.1 })] } },
    });
    setBogFetchForTests(bank.fetchFn, quick);
    const night = await reconcileBogNight(at('2031-04-10', '06:17'));
    expect(bank.calls.filter((c) => c.url.startsWith(API)).map((c) => c.url.slice(API.length))).toEqual([
      `/v2/statement/${ACCOUNT}/GEL/2031-04-08/2031-04-09`,
      `/v2/statement/${ACCOUNT}/USD/2031-03-10/2031-04-09`,
    ]);
    expect(night).toMatchObject({
      status: 'ok',
      listed: 3,
      added: 3,
      accounts: [
        { currency: 'GEL', listed: 1, added: 1, days: ['2031-04-08', '2031-04-09'] },
        { currency: 'USD', listed: 2, added: 2 },
      ],
    });
    expect(night.status === 'ok' ? night.accounts[1]!.days : []).toHaveLength(31);
    const lines = await linesOf([sum(1), sum(2)]);
    expect(lines.map((l) => [l.naturalKey, l.currency, isoOf(l.occurredOn), l.bankGelTetri]).sort()).toEqual([
      ['api:entry:99921', 'GEL', '2031-04-09', null],
      ['api:entry:USD:99921', 'USD', '2031-03-12', 270270],
      ['api:entry:USD:99922', 'USD', '2031-04-09', 2710],
    ]);
    const dollars = await prisma.bankApiAccount.findFirstOrThrow({ where: { bank: 'bog', currency: 'USD' } });
    expect([isoOf(dollars.readFrom), isoOf(dollars.nightThrough), dollars.nightFailure, dollars.nightAdded]).toEqual(['2031-03-10', '2031-04-09', null, 2]);
    expect(isoOf((await prisma.bogSync.findUnique({ where: { id: true } }))?.nightThrough)).toBe('2031-04-09');

    // The next night the dollars read on from their own night, as the lari do: not a month again.
    expect(await reconcileBogNight(at('2031-04-11', '06:17'))).toMatchObject({ status: 'ok', added: 0, known: { byKey: 2 } });
    expect(bank.calls.filter((c) => c.url.startsWith(API)).slice(2).map((c) => c.url.slice(API.length))).toEqual([
      `/v2/statement/${ACCOUNT}/GEL/2031-04-09/2031-04-10`,
      `/v2/statement/${ACCOUNT}/USD/2031-04-09/2031-04-10`,
    ]);
  });

  it('asks about the account of the last uploaded statement when the env file names none — and says when there is none', async () => {
    delete process.env.BOG_ACCOUNT;
    process.env.BOG_ACCOUNT = 'GE00BG123';
    expect(await syncBogToday(at('2031-03-13'))).toEqual({ status: 'failed', failure: 'no_account', httpStatus: null, stage: null });

    delete process.env.BOG_ACCOUNT;
    const owner = await loginAs('owner');
    await call(owner, 'POST', '/api/statements', {
      fileName: 'StatementExport.csv',
      text: csv(['2031-03-13', '2031-03-13'], [{ day: '2031-03-13', doc: '0401', credit: sum(1).toFixed(2), text: 'tankhis gadaritskhva' }]),
    });
    const bank = fakeBank({ today: [] });
    setBogFetchForTests(bank.fetchFn, quick);
    expect(await syncBogToday(at('2031-03-13'))).toMatchObject({ status: 'ok', listed: 0 });
    expect(bank.calls.at(-1)!.url).toBe(`${API}/v2/documents/todayactivities/${ACCOUNT}/GEL`);
  });

  it('is off without the keys: nothing is asked, nothing is shown', async () => {
    delete process.env.BOG_CLIENT_ID;
    const bank = fakeBank({ today: [] });
    setBogFetchForTests(bank.fetchFn, quick);
    expect(await syncBogToday(at('2031-03-14'))).toEqual({ status: 'off' });
    expect(await reconcileBogNight(at('2031-03-14'))).toEqual({ status: 'off' });
    expect(bank.calls).toHaveLength(0);
    const owner = await loginAs('owner');
    const page = json<{ banks: { bank: string; api: unknown }[] }>(await call(owner, 'GET', '/api/statements'));
    expect(page.banks.find((b) => b.bank === 'bog')?.api).toBeNull();
  });

  // Issue #16: a payment by the company's card reached «Разобрать» twice. The
  // bank lists it in the day's list under the posting's number, and again —
  // minutes later, or on the next day's list — under the card operation's.
  it('puts a card payment the bank lists twice — posting, then card operation — in the queue once; the next day, the night and a file know it too', async () => {
    const day = '2031-03-17';
    const when = '17/03/2031 18:13';
    const text = cardText({ sum: sum(5), at: when });
    const said = nominations(sum(5), when);
    const first = activity({ id: 9601, day, doc: posting(9601), debit: sum(5), comment: text, nomination: said.posting });
    const again = activity({ id: 9602, day, doc: cardOperation(9601), debit: sum(5), comment: text, nomination: said.cardOperation });
    setBogFetchForTests(fakeBank({ today: [first] }).fetchFn, quick);
    expect(await syncBogToday(at(day, '18:15'))).toMatchObject({ status: 'ok', listed: 1, added: 1 });
    // Five minutes later the day's list holds both listings.
    setBogFetchForTests(fakeBank({ today: [first, again] }).fetchFn, quick);
    expect(await syncBogToday(at(day, '18:20'))).toMatchObject({ status: 'ok', listed: 2, added: 0, known: { byKey: 1, byCard: 1 } });
    // Or the card operation comes on the next day's list, dated that day.
    setBogFetchForTests(fakeBank({ today: [again] }).fetchFn, quick);
    expect(await syncBogToday(at('2031-03-18', '08:20'))).toMatchObject({ status: 'ok', listed: 1, added: 0, known: { byCard: 1 } });

    // The night's statement, under either number.
    const { prisma } = await import('../src/lib/db.js');
    await prisma.bogSync.update({ where: { id: true }, data: { nightThrough: new Date('2031-03-16T00:00:00Z') } });
    setBogFetchForTests(
      fakeBank({ entries: [entry({ id: 99601, day, doc: posting(9601), debit: sum(5), comment: text }), entry({ id: 99602, day, doc: cardOperation(9601), debit: sum(5), comment: text })] }).fetchFn,
      quick,
    );
    expect(await reconcileBogNight(at('2031-03-19', '06:17'))).toMatchObject({ status: 'ok', listed: 2, added: 0, known: { byDoc: 1, byCard: 1 } });

    // A CSV export of the day words it in English, under the card operation's number.
    const owner = await loginAs('owner');
    const file = csv([day, day], [{ day, doc: cardOperation(9601), debit: sum(5).toFixed(2), text: cardText({ sum: sum(5), at: when, lang: 'en', shop: 'Example Cafe>TBILISI GE, Georgia' }) }]);
    const preview = json<{ newLines: number; alreadyIn: number }>(await call(owner, 'POST', '/api/statements/preview', { fileName: 'StatementExport.csv', text: file }));
    expect(preview).toMatchObject({ newLines: 0, alreadyIn: 1 });

    const lines = await linesOf([sum(5)]);
    expect(lines.map((l) => [l.naturalKey, l.docNo, l.direction])).toEqual([['api:today:9601', posting(9601), 'out']]);
  });

  it('keeps two purchases of one sum in one shop at different minutes two lines, each listed twice', async () => {
    const day = '2031-03-20';
    const listings = ['18:13', '18:40'].map((hhmm, i) => {
      const when = `20/03/2031 ${hhmm}`;
      const text = cardText({ sum: sum(6), at: when });
      const said = nominations(sum(6), when);
      return [
        activity({ id: 9701 + i, day, doc: posting(9701 + i), debit: sum(6), comment: text, nomination: said.posting }),
        activity({ id: 9711 + i, day, doc: cardOperation(9701 + i), debit: sum(6), comment: text, nomination: said.cardOperation }),
      ];
    });
    setBogFetchForTests(fakeBank({ today: listings.map((l) => l[0]) }).fetchFn, quick);
    expect(await syncBogToday(at(day, '19:00'))).toMatchObject({ status: 'ok', added: 2 });
    setBogFetchForTests(fakeBank({ today: listings.flat() }).fetchFn, quick);
    expect(await syncBogToday(at(day, '19:05'))).toMatchObject({ status: 'ok', listed: 4, added: 0, known: { byKey: 2, byCard: 2 } });
    expect(await linesOf([sum(6)])).toHaveLength(2);
  });

  // `deploy/set-bog-keys.sh --add-account` asks the bank about the new pair through the stand before writing it.
  it('asks the bank about one pair before a script writes it, says only our word and the status, and keeps nothing', async () => {
    const app = await getApp();
    const { env } = await import('../src/lib/env.js');
    const { prisma } = await import('../src/lib/db.js');
    const probe = (payload: Record<string, unknown>, token = env.WORKER_TOKEN) => app.inject({ method: 'POST', url: '/api/jobs/bank-probe', headers: { 'x-worker-token': token }, payload });
    const said = async (payload: Record<string, unknown>) => {
      const res = await probe(payload);
      expect(res.statusCode, res.body).toBe(200);
      for (const never of [ACCOUNT, OTHER, 'Тайна', SECRET]) expect(res.body).not.toContain(never);
      return json<{ code: string; httpStatus: number | null }>(res);
    };
    expect((await probe({ bank: 'bog', account: ACCOUNT, currency: 'USD' }, 'not-it')).statusCode).toBe(401);

    // The dollars on the account in lari: one question, by GET, in that currency, and nothing kept of the answer.
    const bank = fakeBank({ today: [activity({ id: 9961, day: '2031-03-28', credit: sum(1) })], other: { USD: { today: [activity({ id: 9962, day: '2031-03-28', credit: sum(2) })] } } });
    setBogFetchForTests(bank.fetchFn, quick);
    expect(await said({ bank: 'bog', account: ` ${ACCOUNT.toLowerCase()} `, currency: 'usd' })).toEqual({ code: 'ok', httpStatus: null });
    expect(bank.calls.filter((c) => c.url.startsWith(API)).map((c) => [c.method, c.url.slice(API.length)])).toEqual([['GET', `/v2/documents/todayactivities/${ACCOUNT}/USD`]]);
    expect(await linesOf([sum(1), sum(2)])).toEqual([]);
    expect(await prisma.bankApiAccount.count({ where: { bank: 'bog' } })).toBe(0);
    expect(await prisma.bogSync.findUnique({ where: { id: true } })).toMatchObject({ lastTryAt: null, nightAt: null });

    // A refusal is our word and the status, the bank's own answer dropped.
    setBogFetchForTests(fakeBank({ refused: { [`${ACCOUNT}/USD`]: 403 } }).fetchFn, quick);
    expect(await said({ bank: 'bog', account: ACCOUNT, currency: 'USD' })).toEqual({ code: 'forbidden', httpStatus: 403 });
    // It knows the IBAN in lari and not in euros: the account in euros has a number of its own.
    const euros = fakeBank({ refused: { [`${ACCOUNT}/EUR`]: 404 } });
    setBogFetchForTests(euros.fetchFn, quick);
    expect(await said({ bank: 'bog', account: ACCOUNT, currency: 'EUR' })).toEqual({ code: 'no_currency', httpStatus: 404 });
    expect(euros.calls.filter((c) => c.url.startsWith(API)).map((c) => c.url.slice(API.length))).toEqual([`/v2/documents/todayactivities/${ACCOUNT}/EUR`, `/v2/documents/todayactivities/${ACCOUNT}/GEL`]);
    // A number it does not know in any currency.
    setBogFetchForTests(fakeBank({ refused: { [OTHER]: 404 } }).fetchFn, quick);
    expect(await said({ bank: 'bog', account: OTHER, currency: 'USD' })).toEqual({ code: 'not_found', httpStatus: 404 });
    // Keys it no longer takes: the token is asked for once, and nothing more.
    const keys = fakeBank({ tokenStatus: 401 });
    setBogFetchForTests(keys.fetchFn, quick);
    expect(await said({ bank: 'bog', account: ACCOUNT, currency: 'USD' })).toEqual({ code: 'unauthorized', httpStatus: 401 });
    expect(keys.calls).toHaveLength(1);

    // What is not an account in GEL, USD or EUR is not asked about at all.
    const none = fakeBank({});
    setBogFetchForTests(none.fetchFn, quick);
    for (const payload of [
      { bank: 'bog', account: `${ACCOUNT}USD`, currency: 'USD' },
      { bank: 'bog', account: 'GE00BG123', currency: 'USD' },
      { bank: 'bog', account: ACCOUNT, currency: 'GBP' },
      { bank: 'bog', account: ACCOUNT, currency: '' },
      { bank: 'credo', account: ACCOUNT, currency: 'USD' },
      {},
    ]) {
      expect(await said(payload)).toEqual({ code: 'bad_account', httpStatus: null });
    }
    expect(none.calls).toHaveLength(0);
    // Without the keys the link is off.
    delete process.env.BOG_CLIENT_SECRET;
    expect(await said({ bank: 'bog', account: ACCOUNT, currency: 'USD' })).toEqual({ code: 'off', httpStatus: null });
    expect(none.calls).toHaveLength(0);
  });

  it('opens the two jobs to the worker only', async () => {
    const app = await getApp();
    const { env } = await import('../src/lib/env.js');
    setBogFetchForTests(fakeBank({ today: [] }).fetchFn, quick);
    for (const url of ['/api/jobs/bog-today', '/api/jobs/bog-night']) {
      expect((await app.inject({ method: 'POST', url, headers: { 'x-worker-token': 'not-it' } })).statusCode).toBe(401);
      const ok = await app.inject({ method: 'POST', url, headers: { 'x-worker-token': env.WORKER_TOKEN } });
      expect(ok.statusCode, ok.body).toBe(200);
      expect(json<{ status: string }>(ok).status).toBe('ok');
      expect(ok.body).not.toContain(SECRET);
    }
  });
});
