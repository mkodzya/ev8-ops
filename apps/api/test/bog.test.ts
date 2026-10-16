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
import { alreadyIn, type SameLineCandidate } from '../src/lib/statements/sameLine.js';
import { HAS_DB, call, getApp, json, loginAs, uniq } from './helpers.js';

const ID = 'test-client-id';
const SECRET = 'test-client-secret-that-opens-nothing';
const ACCOUNT = 'GE00BG0000000000000001'; // invented
const TOKEN_URL = 'https://account.bog.ge/auth/realms/bog/protocol/openid-connect/token';
const API = 'https://api.businessonline.ge/api';

const cfg = (over: Partial<BogConfig> = {}): BogConfig => ({ clientId: ID, clientSecret: SECRET, accounts: [ACCOUNT], badAccount: false, staleMs: 20 * 60_000, ...over });
const quick = { gapMs: 0, sleep: async () => {} };

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** The bank as far as this link knows it: a token, the day's operations, the statement in pages. */
function fakeBank(state: {
  today?: unknown[];
  entries?: unknown[];
  pageSize?: number;
  tokenStatus?: number;
  tokenStatuses?: number[];
  apiStatus?: number[];
  retryAfter?: string;
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
    if (path.startsWith('/v2/documents/todayactivities/')) return reply(200, state.today ?? []);
    const paged = /^\/v2\/statement\/[^/]+\/GEL\/(\d+)\/(\d+)$/.exec(path);
    const size = state.pageSize ?? 1000;
    // Like the bank, the statement holds the days asked for and no others.
    const dayOf = (e: unknown) => String((e as { EntryDate?: string }).EntryDate ?? '').slice(0, 10);
    const ranged = /^\/v2\/statement\/[^/]+\/GEL\/(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})$/.exec(path);
    if (ranged) range = [ranged[1]!, ranged[2]!];
    const all = (state.entries ?? []).filter((e) => !range || (dayOf(e) >= range[0] && dayOf(e) <= range[1]));
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

/** One of the day's operations, as `todayactivities` lists it. */
function activity(o: { id: number; day: string; doc?: string; credit?: number; debit?: number; sender?: string; comment?: string; nomination?: string }) {
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
    AmountBase: o.credit ?? -(o.debit ?? 0),
    PayerName: sides(o).from.Name,
    PayerInn: null,
    Sender: sides(o).from,
    Beneficiary: sides(o).to,
  };
}

/** One entry of the statement. */
function entry(o: { id: number; day: string; doc?: string; credit?: number; debit?: number; sender?: string; comment?: string }) {
  return {
    EntryDate: `${o.day}T00:00:00`,
    EntryDocumentNumber: o.doc ?? null,
    EntryAccountNumber: ACCOUNT,
    EntryAmountDebit: o.debit ?? 0,
    EntryAmountCredit: o.credit ?? 0,
    EntryAmount: o.credit ?? o.debit ?? 0,
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

describe('the Bank of Georgia settings', () => {
  it('are off without both keys', () => {
    expect(bogConfig({})).toBeNull();
    expect(bogConfig({ BOG_CLIENT_ID: ID })).toBeNull();
    expect(bogConfig({ BOG_CLIENT_SECRET: SECRET })).toBeNull();
  });

  it('take the account from the env file, as a statement file writes it or bare', () => {
    expect(bogConfig({ BOG_CLIENT_ID: ID, BOG_CLIENT_SECRET: SECRET })?.accounts).toEqual([]);
    expect(bogConfig({ BOG_CLIENT_ID: ID, BOG_CLIENT_SECRET: SECRET, BOG_ACCOUNT: ` ${ACCOUNT.toLowerCase()}GEL ` })?.accounts).toEqual([ACCOUNT]);
    const bad = bogConfig({ BOG_CLIENT_ID: ID, BOG_CLIENT_SECRET: SECRET, BOG_ACCOUNT: 'GE00BG123' });
    expect(bad?.badAccount).toBe(true);
    expect(accountOf(`${ACCOUNT}GEL`)).toBe(ACCOUNT);
    expect(accountOf('GE00TB0000000000000002')).toBe('GE00TB0000000000000002');
    expect(accountOf('not an account')).toBeNull();
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
    const l = lineFromToday(activity({ id: 501, day: '2031-03-10', doc: '0042', credit: 150, sender: 'TEST PAYER' }), '2031-03-10')!;
    expect(l).toMatchObject({ naturalKey: 'api:today:501', docNo: '0042', occurredOn: '2031-03-10', direction: 'in', amountTetri: 15000, payer: 'TEST PAYER', purpose: 'qira', channel: 'transfer' });
    expect(l.raw.split(' | ').slice(0, 5)).toEqual(['10.03.2031', '0042', 'GE00TB0000000000000002', '', '150.00']);
    const out = lineFromToday(activity({ id: 502, day: '2031-03-10', debit: 7.6, comment: 'Beneficiary: TEST SHOP; Details: komisia' }), '2031-03-10')!;
    expect(out).toMatchObject({ direction: 'out', amountTetri: 760, payer: 'TEST SHOP', purpose: 'qira' });
    expect(out.raw.split(' | ').slice(2, 5)).toEqual(['GE00TB0000000000000002', '7.60', '']);
    // A transfer sent last night and credited this morning: the bank's PostDate is yesterday, the line is today's.
    expect(lineFromToday(activity({ id: 504, day: '2031-03-09', doc: '1', credit: 1 }), '2031-03-10')!.occurredOn).toBe('2031-03-10');
  });

  it('reads a card payment for both its sums, with no payer, as a file’s card line is read', () => {
    const l = lineFromEntry(entry({ id: 601, day: '2031-03-10', credit: 196.8, sender: 'ACQUIRER', comment: 'Caricxva - gadaxda; Tanxa:GEL 200; sakomisio: GEL 3.20; terminalis ID: TEST' }))!;
    expect(l).toMatchObject({ naturalKey: 'api:entry:601', direction: 'in', amountTetri: 19680, grossTetri: 20000, feeTetri: 320, payer: null, channel: 'acquiring' });
  });

  it('skips an operation where nothing moved, and refuses one without its id', () => {
    expect(lineFromToday(activity({ id: 503, day: '2031-03-10' }), '2031-03-10')).toBeNull();
    expect(() => lineFromEntry({ EntryDate: '2031-03-10T00:00:00', EntryAmountCredit: 5 })).toThrow(BogError);
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

describe('the client', () => {
  it('buys a token with the keys as Basic and in the body, and asks the API with the token alone, only by GET', async () => {
    const bank = fakeBank({ today: [activity({ id: 1, day: '2031-03-10', credit: 10 })] });
    await new BogClient(cfg(), { ...quick, fetch: bank.fetchFn }).today(ACCOUNT);
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
    await client.today(ACCOUNT);
    await client.today(ACCOUNT);
    expect(bank.tokens()).toBe(2);
    expect(bank.calls.filter((c) => c.url.startsWith(API))).toHaveLength(3);
  });

  it('waits out a short 429 once; a long one, or a second, fails with our word', async () => {
    const waited: number[] = [];
    const sleep = async (ms: number) => void waited.push(ms);
    const once = fakeBank({ today: [], apiStatus: [429], retryAfter: '2' });
    await new BogClient(cfg(), { gapMs: 0, sleep, fetch: once.fetchFn }).today(ACCOUNT);
    expect(waited).toContain(2000);
    const long = fakeBank({ today: [], apiStatus: [429], retryAfter: '3600' });
    await expect(new BogClient(cfg(), { ...quick, fetch: long.fetchFn }).today(ACCOUNT)).rejects.toMatchObject({ failure: 'rate_limited', httpStatus: 429 });
  });

  it('asks once more after a pause when the bank’s gateway is busy (503), for the token and for the API alike', async () => {
    const waited: number[] = [];
    const sleep = async (ms: number) => void waited.push(ms);
    const blip = fakeBank({ today: [activity({ id: 1, day: '2031-03-10', credit: 10 })], tokenStatuses: [503], apiStatus: [502] });
    expect(await new BogClient(cfg(), { gapMs: 0, sleep, fetch: blip.fetchFn }).today(ACCOUNT)).toHaveLength(1);
    expect(waited.filter((w) => w === 3000)).toHaveLength(2);
    const down = fakeBank({ apiStatus: [503, 503] });
    await expect(new BogClient(cfg(), { ...quick, fetch: down.fetchFn }).today(ACCOUNT)).rejects.toMatchObject({ failure: 'http', httpStatus: 503, stage: 'api' });
    const noToken = fakeBank({ tokenStatuses: [503, 503] });
    await expect(new BogClient(cfg(), { ...quick, fetch: noToken.fetchFn }).today(ACCOUNT)).rejects.toMatchObject({ failure: 'http', httpStatus: 503, stage: 'token' });
  });

  it('turns a refusal into our word, with nothing of the bank’s answer or of the keys in it', async () => {
    const refused = fakeBank({ tokenStatus: 401 });
    const err = await new BogClient(cfg(), { ...quick, fetch: refused.fetchFn }).today(ACCOUNT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BogError);
    expect(err).toMatchObject({ failure: 'unauthorized', httpStatus: 401, stage: 'token' });
    expect(String(err)).not.toContain('Тайна');
    expect(String(err)).not.toContain(SECRET);
    const forbidden = fakeBank({ apiStatus: [403] });
    await expect(new BogClient(cfg(), { ...quick, fetch: forbidden.fetchFn }).today(ACCOUNT)).rejects.toMatchObject({ failure: 'forbidden' });
    const dead: BogFetch = async () => Promise.reject(new Error(`connect ECONNREFUSED ${SECRET}`));
    const net = await new BogClient(cfg(), { ...quick, fetch: dead }).today(ACCOUNT).catch((e: unknown) => e);
    expect(net).toMatchObject({ failure: 'network' });
    expect(String(net)).not.toContain(SECRET);
  });

  it('reads the statement page after page while the bank says there is more', async () => {
    const entries = [1, 2, 3, 4, 5].map((id) => entry({ id, day: '2031-03-10', credit: id }));
    const bank = fakeBank({ entries, pageSize: 2 });
    const rows = await new BogClient(cfg(), { ...quick, fetch: bank.fetchFn }).statement(ACCOUNT, '2031-03-09', '2031-03-10');
    expect(rows).toHaveLength(5);
    expect(bank.calls.filter((c) => c.url.startsWith(API)).map((c) => c.url.slice(API.length))).toEqual([
      `/v2/statement/${ACCOUNT}/GEL/2031-03-09/2031-03-10`,
      `/v2/statement/${ACCOUNT}/GEL/777/2`,
      `/v2/statement/${ACCOUNT}/GEL/777/3`,
    ]);
  });

  it('keeps under five requests a second: each one waits out the gap after the one before', async () => {
    let clock = 0;
    const waits: number[] = [];
    const bank = fakeBank({ today: [] });
    const client = new BogClient(cfg(), { fetch: bank.fetchFn, gapMs: 250, now: () => clock, sleep: async (ms) => void (waits.push(ms), (clock += ms)) });
    await client.today(ACCOUNT);
    await client.today(ACCOUNT);
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

  async function reset() {
    const { prisma } = await import('../src/lib/db.js');
    await prisma.bogSync.update({
      where: { id: true },
      data: { lastOkAt: null, lastTryAt: null, lastFailure: null, lastHttpStatus: null, todayCount: 0, nightThrough: null, nightAt: null, nightFailure: null, nightHttpStatus: null, nightAdded: 0 },
    });
  }

  async function linesOf(amounts: number[]) {
    const { prisma } = await import('../src/lib/db.js');
    return prisma.statementLine.findMany({ where: { bank: 'bog', amountTetri: { in: amounts.map((a) => Math.round(a * 100)) } }, include: { statement: true }, orderBy: { naturalKey: 'asc' } });
  }

  /** A Bank of Georgia CSV of this invented account, as the export writes it. */
  function csv(period: [string, string], rows: { day: string; doc: string; credit: string; text: string }[]) {
    const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}`;
    return [
      ',,,"angariSis mflobeli: TEST",,,,',
      `,,,"angariSis #:${ACCOUNT}GEL",,,,`,
      `"TEST",,,"periodi: ${dmy(period[0])}-${dmy(period[1])}",,,,`,
      '"TariRi","sabuTis #","mokorespondento angariSi","debeti","krediti","kursi","eqv.lari","operaciis Sinaarsi"',
      ...rows.map((r) => `"${r.day.slice(8, 10)}.${r.day.slice(5, 7)}.${r.day.slice(0, 4)}","${r.doc}","GE00TB0000000000000002","","${r.credit}","1","${r.credit}","${r.text}"`),
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
    const page = json<{ banks: { bank: string; api: { freshness: string; failure: string | null; nightFailure: string | null } | null }[] }>(await call(owner, 'GET', '/api/statements'));
    expect(page.banks.find((b) => b.bank === 'bog')?.api).toMatchObject({ freshness: 'silent', failure: 'unauthorized', nightFailure: 'unauthorized' });
    expect(page.banks.find((b) => b.bank === 'tbc')?.api).toBeNull();
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
