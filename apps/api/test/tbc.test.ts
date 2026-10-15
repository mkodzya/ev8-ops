// TBC through its Business Integration Services (B11-03, ADR-0026). The bank
// itself is never called from here — a function stands in for it, so these
// run with no network and no key that opens anything.
//
// Every account number, transaction id, name and sum below is invented for
// the test. The dates are in 2032 so that no line another suite loaded can be
// taken for one of these.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { alreadyIn, tbcIdOf, type SameLineCandidate } from '../src/lib/statements/sameLine.js';
import { TbcClient, TbcError, lineFromMovement, reconcileTbcNight, setTbcFetchForTests, syncTbcToday, tbcConfig, type TbcConfig, type TbcFetch } from '../src/lib/tbc.js';
import { HAS_DB, call, getApp, json, loginAs, uniq } from './helpers.js';

const ID = 'test-client-id';
const SECRET = 'test-client-secret-that-opens-nothing';
const ACCOUNT = 'GE00TB0000000000000001'; // invented
const BASE = 'https://api.tbcbank.ge';

const cfg = (over: Partial<TbcConfig> = {}): TbcConfig => ({ clientId: ID, clientSecret: SECRET, accounts: [ACCOUNT], badAccount: false, staleMs: 20 * 60_000, baseUrl: BASE, ...over });
const quick = { gapMs: 0, sleep: async () => {} };

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** One movement, as `GET /bab/v1/accounts/movements` lists it. `id` is the eleven digits; the leg follows the direction. */
function movement(o: { id: number; day: string; amount: number; debit?: boolean; partner?: string; purpose?: string; doc?: string | null; status?: number; currency?: string }) {
  const digits = String(o.id).padStart(11, '0');
  return {
    movementId: `0${digits}.${o.debit ? 1 : 2}`,
    paymentId: null,
    externalPaymentId: digits,
    amount: o.amount,
    currency: o.currency ?? 'GEL',
    purpose: o.purpose ?? 'TEST rent',
    isDebit: o.debit ?? false,
    customerAccountInfo: { accountName: 'TEST COMPANY', accountIban: ACCOUNT },
    documentDate: `${o.day}T00:00:00`,
    exchangeRate: null,
    additionalInformation: null,
    opCode: 'GIB',
    partnerAccountInfo: { accountIban: 'GE00BG0000000000000002', bankCode: 'BAGAGE22', bankName: 'TEST BANK', treasuryCode: null, partnerName: o.partner ?? null, docTypeId: null, personalNumber: null, documentNumber: null, taxCode: null },
    intermediaryBankCode: null,
    intermediaryBankName: null,
    statusCode: o.status ?? 0,
    date: `${o.day}T00:00:00`,
    parentExternalPaymentId: 0,
    transactionReference: null,
    additionalDescription: null,
    documentNumber: o.doc === undefined ? '000123' : o.doc,
    chargeDetail: null,
    taxpayerCode: null,
    taxpayerName: null,
    transactionType: o.debit ? 30 : 20,
  };
}

/** The file's "Transaction ID" of the same movement, as TBC's CSV writes it. */
const txnOf = (id: number, debit = false) => `${String(id).padStart(11, '0')}.${debit ? 10 : 20}`;

/** The bank as far as this link knows it: a token, the movements in pages, the statement's sums. */
function fakeBank(state: {
  movements?: ReturnType<typeof movement>[];
  pageSize?: number;
  tokenStatus?: number;
  tokenBody?: unknown;
  apiStatus?: number[];
  apiBody?: unknown;
  /** Sums the statement gives for a day instead of the movements' own. */
  sums?: Record<string, { creditSum: number; debitSum: number }>;
}) {
  const calls: Call[] = [];
  let tokens = 0;
  const apiStatus = [...(state.apiStatus ?? [])];
  const reply = (status: number, body: unknown) => ({ status, headers: { get: () => null }, json: async () => body });
  const fetchFn: TbcFetch = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    if (url === `${BASE}/oauth/token`) {
      if (state.tokenStatus) return reply(state.tokenStatus, state.tokenBody ?? { error: 'invalid_client', error_description: 'ТЕСТ Тайна' });
      tokens++;
      return reply(200, { access_token: `token-${tokens}`, token_type: 'Bearer', scope: 'bab_accounts', expires_in: 3600 });
    }
    const forced = apiStatus.shift();
    if (forced) return reply(forced, state.apiBody ?? { title: 'GENERAL_ERROR', detail: 'ТЕСТ Тайна' });
    const u = new URL(url);
    const q = u.searchParams;
    const inPeriod = (m: ReturnType<typeof movement>) => m.date.slice(0, 10) >= q.get('PeriodFrom')! && m.date.slice(0, 10) <= q.get('PeriodTo')!;
    const all = (state.movements ?? []).filter(inPeriod);
    if (u.pathname === '/bab/v1/accounts/movements') {
      const size = Math.min(Number(q.get('PageSize')), state.pageSize ?? 700);
      const page = Number(q.get('PageIndex'));
      return reply(200, { transactions: all.slice(page * size, (page + 1) * size), pager: [{ pageIndex: page, pageSize: size }], total: all.length });
    }
    if (u.pathname === '/bab/v1/accounts/statements') {
      const day = q.get('PeriodFrom')!;
      const done = all.filter((m) => m.statusCode === 0);
      const own = {
        creditSum: done.filter((m) => !m.isDebit).reduce((s, m) => s + m.amount, 0),
        debitSum: done.filter((m) => m.isDebit).reduce((s, m) => s + m.amount, 0),
      };
      return reply(200, { openingDate: `${day}T00:00:00`, openingBalance: 0, closingDate: `${day}T00:00:00`, closingBalance: 0, currency: 'GEL', accountNumber: ACCOUNT, ...(state.sums?.[day] ?? own) });
    }
    return reply(404, {});
  };
  return { fetchFn, calls, tokens: () => tokens };
}

describe('the TBC settings', () => {
  it('are off without both keys', () => {
    expect(tbcConfig({})).toBeNull();
    expect(tbcConfig({ TBC_CLIENT_ID: ID })).toBeNull();
    expect(tbcConfig({ TBC_CLIENT_SECRET: SECRET })).toBeNull();
  });

  it('take a TBC account from the env file, and stop rather than guess at any other', () => {
    expect(tbcConfig({ TBC_CLIENT_ID: ID, TBC_CLIENT_SECRET: SECRET })?.accounts).toEqual([]);
    expect(tbcConfig({ TBC_CLIENT_ID: ID, TBC_CLIENT_SECRET: SECRET, TBC_ACCOUNT: ` ${ACCOUNT.toLowerCase()}GEL ` })?.accounts).toEqual([ACCOUNT]);
    expect(tbcConfig({ TBC_CLIENT_ID: ID, TBC_CLIENT_SECRET: SECRET, TBC_ACCOUNT: 'GE00BG0000000000000001' })?.badAccount).toBe(true);
    expect(tbcConfig({ TBC_CLIENT_ID: ID, TBC_CLIENT_SECRET: SECRET, TBC_ACCOUNT: 'GE00TB123' })?.badAccount).toBe(true);
  });

  it('send the keys to the bank’s own hosts only', () => {
    const keys = { TBC_CLIENT_ID: ID, TBC_CLIENT_SECRET: SECRET };
    expect(tbcConfig(keys)?.baseUrl).toBe(BASE);
    expect(tbcConfig({ ...keys, TBC_BASE_URL: 'https://test-api.tbcbank.ge/' })?.baseUrl).toBe('https://test-api.tbcbank.ge');
    expect(tbcConfig({ ...keys, TBC_BASE_URL: 'https://tbcbank.ge.example.com' })?.baseUrl).toBe(BASE);
    expect(tbcConfig({ ...keys, TBC_BASE_URL: 'http://api.tbcbank.ge' })?.baseUrl).toBe(BASE);
  });
});

describe('reading a movement', () => {
  it('makes a movement a line shaped like a row of the file: day, description, signed sum, partner, id', () => {
    const l = lineFromMovement(movement({ id: 20000000101, day: '2032-03-10', amount: 150, partner: 'TEST PAYER', purpose: 'TEST qira', doc: '0042' }))!;
    expect(l).toMatchObject({ naturalKey: 'api:mv:020000000101.2', docNo: '0042', occurredOn: '2032-03-10', direction: 'in', amountTetri: 15000, payer: 'TEST PAYER', purpose: 'TEST qira', channel: 'transfer' });
    expect(l.raw.split(' | ')).toEqual(['10/03/2032', 'TEST qira', '150.00', 'TEST PAYER', '020000000101.2']);
    const out = lineFromMovement(movement({ id: 20000000102, day: '2032-03-10', amount: 7.6, debit: true, partner: 'TEST SHOP' }))!;
    expect(out).toMatchObject({ naturalKey: 'api:mv:020000000102.1', direction: 'out', amountTetri: 760, payer: 'TEST SHOP' });
    expect(out.raw.split(' | ')[2]).toBe('-7.60');
  });

  it('reads the terminal’s settlement as a card payment, for the customer’s sum, as the file’s line is read', () => {
    const l = lineFromMovement(
      movement({
        id: 20000000103,
        day: '2032-03-10',
        amount: 197,
        partner: 'Wallet/domestic/TEST ბარათებით',
        purpose: '09/03/2032_ის ტრანზაქციის თანხები 000000000 TEST COMPANY, TBC BANK, Visa, 200.00, TEST00,,V',
      }),
    )!;
    expect(l).toMatchObject({ direction: 'in', amountTetri: 19700, grossTetri: 20000, feeTetri: 300, channel: 'acquiring' });
  });

  it('leaves out a movement not yet authorized, another currency and a zero; refuses one without its id', () => {
    expect(lineFromMovement(movement({ id: 1, day: '2032-03-10', amount: 50, debit: true, status: 1 }))).toBeNull();
    expect(lineFromMovement(movement({ id: 2, day: '2032-03-10', amount: 50, currency: 'USD' }))).toBeNull();
    expect(lineFromMovement(movement({ id: 3, day: '2032-03-10', amount: 0 }))).toBeNull();
    expect(() => lineFromMovement({ date: '2032-03-10T00:00:00', amount: 5 })).toThrow(TbcError);
  });
});

describe('one TBC operation, two sources', () => {
  const l = (key: string, day: string, amount: number, doc: string | null = null, direction: 'in' | 'out' = 'in'): SameLineCandidate => ({ naturalKey: key, occurredOn: day, amountTetri: amount, docNo: doc, direction });

  it('writes the file’s transaction id and the movement’s id one way', () => {
    expect(tbcIdOf('txn:20000000001.20')).toBe('20000000001.2');
    expect(tbcIdOf('api:mv:020000000001.2')).toBe('20000000001.2');
    expect(tbcIdOf('txn:20000000001.10')).toBe(tbcIdOf('api:mv:020000000001.1'));
    expect(tbcIdOf('txn:20000000001.10')).not.toBe(tbcIdOf('api:mv:020000000001.2'));
    expect(tbcIdOf('api:entry:5')).toBeNull();
    expect(tbcIdOf('0123abcd')).toBeNull();
  });

  it('knows the file’s lines in the API by their transaction ids before any day and sum are compared', () => {
    // Three payments of 150 on one day, two of them in the file. Were the day and the sum asked first,
    // the third could be taken for one of the two, and one of the two left over as new.
    const stored = [l('txn:20000000001.20', '2032-03-10', 15000), l('txn:20000000002.20', '2032-03-10', 15000)];
    const incoming = [l('api:mv:020000000003.2', '2032-03-10', 15000, '9'), l('api:mv:020000000002.2', '2032-03-10', 15000, '8'), l('api:mv:020000000001.2', '2032-03-10', 15000, '7')];
    const r = alreadyIn(incoming, stored);
    expect(r).toMatchObject({ byId: 2, bySum: 0 });
    expect(r.fresh.map((x) => x.naturalKey)).toEqual(['api:mv:020000000003.2']);
  });

  it('still knows the file’s line by day and sum if the two ids turn out not to be one number', () => {
    const stored = [l('txn:20000000001.20', '2032-03-10', 15000)];
    const r = alreadyIn([l('api:mv:099999999999.2', '2032-03-10', 15000, '0042')], stored);
    expect(r).toMatchObject({ byId: 0, bySum: 1, fresh: [] });
  });

  it('never takes two movements for one: their ids tell them apart', () => {
    const stored = [l('api:mv:020000000001.2', '2032-03-10', 15000)];
    const r = alreadyIn([l('api:mv:020000000001.2', '2032-03-10', 15000), l('api:mv:020000000004.2', '2032-03-10', 15000)], stored);
    expect(r.byKey).toBe(1);
    expect(r.fresh.map((x) => x.naturalKey)).toEqual(['api:mv:020000000004.2']);
  });
});

describe('the client', () => {
  it('buys a token with the keys as Basic for the account services only, and asks the API with the token alone, only by GET', async () => {
    const bank = fakeBank({ movements: [movement({ id: 1, day: '2032-03-10', amount: 10 })] });
    await new TbcClient(cfg(), { ...quick, fetch: bank.fetchFn }).movements(ACCOUNT, '2032-03-10', '2032-03-10');
    const [token, get] = bank.calls;
    expect(token!.url).toBe(`${BASE}/oauth/token`);
    expect(token!.method).toBe('POST');
    expect(token!.headers.authorization).toBe(`Basic ${Buffer.from(`${ID}:${SECRET}`).toString('base64')}`);
    expect(new URLSearchParams(token!.body)).toEqual(new URLSearchParams({ grant_type: 'client_credentials', scope: 'bab_accounts' }));
    const u = new URL(get!.url);
    expect(u.origin + u.pathname).toBe(`${BASE}/bab/v1/accounts/movements`);
    expect(Object.fromEntries(u.searchParams)).toEqual({ AccountNumber: ACCOUNT, AccountCurrencyCode: 'GEL', PeriodFrom: '2032-03-10', PeriodTo: '2032-03-10', PageIndex: '0', PageSize: '700' });
    expect(get!.headers.authorization).toBe('Bearer token-1');
    for (const c of bank.calls.slice(1)) {
      expect(c.method).toBe('GET');
      expect(JSON.stringify(c)).not.toContain(SECRET);
    }
  });

  it('reads the movements page after page until the total is reached', async () => {
    const movements = [1, 2, 3, 4, 5].map((id) => movement({ id, day: '2032-03-10', amount: id }));
    const bank = fakeBank({ movements, pageSize: 2 });
    const rows = await new TbcClient(cfg(), { ...quick, fetch: bank.fetchFn }).movements(ACCOUNT, '2032-03-09', '2032-03-10');
    expect(rows).toHaveLength(5);
    expect(bank.calls.slice(1).map((c) => new URL(c.url).searchParams.get('PageIndex'))).toEqual(['0', '1', '2']);
  });

  it('keeps the token while it is good, and buys a new one once when the bank stops taking it', async () => {
    const bank = fakeBank({ movements: [], apiStatus: [0, 401] });
    const client = new TbcClient(cfg(), { ...quick, fetch: bank.fetchFn });
    await client.movements(ACCOUNT, '2032-03-10', '2032-03-10');
    await client.movements(ACCOUNT, '2032-03-10', '2032-03-10');
    expect(bank.tokens()).toBe(2);
  });

  it('asks once more after a pause when the bank’s gateway is busy', async () => {
    const waited: number[] = [];
    const bank = fakeBank({ movements: [movement({ id: 1, day: '2032-03-10', amount: 10 })], apiStatus: [503] });
    expect(await new TbcClient(cfg(), { gapMs: 0, sleep: async (ms) => void waited.push(ms), fetch: bank.fetchFn }).movements(ACCOUNT, '2032-03-10', '2032-03-10')).toHaveLength(1);
    expect(waited).toContain(3000);
  });

  it('turns the bank’s refusals into our words, with nothing of its answer or of the keys in them', async () => {
    const run = (state: Parameters<typeof fakeBank>[0]) => new TbcClient(cfg(), { ...quick, fetch: fakeBank(state).fetchFn }).movements(ACCOUNT, '2032-03-10', '2032-03-10').catch((e: unknown) => e);
    const refused = await run({ tokenStatus: 401 });
    expect(refused).toBeInstanceOf(TbcError);
    expect(refused).toMatchObject({ failure: 'unauthorized', httpStatus: 401, stage: 'token' });
    expect(String(refused)).not.toContain('Тайна');
    expect(String(refused)).not.toContain(SECRET);
    expect(await run({ tokenStatus: 400, tokenBody: { error: 'invalid_scope' } })).toMatchObject({ failure: 'forbidden', stage: 'token' });
    expect(await run({ apiStatus: [400], apiBody: { type: '/error-codes#DomainError', title: 'INVALID_ACCOUNT', status: 400, code: 'DomainError' } })).toMatchObject({ failure: 'not_found', httpStatus: 400, stage: 'api' });
    expect(await run({ apiStatus: [400], apiBody: { title: 'USER_IS_BLOCKED', status: 400, code: 'DomainError' } })).toMatchObject({ failure: 'user_inactive' });
    expect(await run({ apiStatus: [403], apiBody: { title: 'NOT_AUTHORIZED', status: 403, code: 'ForbiddenError' } })).toMatchObject({ failure: 'forbidden' });
    expect(await run({ apiStatus: [500] })).toMatchObject({ failure: 'http', httpStatus: 500 });
    const dead: TbcFetch = async () => Promise.reject(new Error(`connect ECONNREFUSED ${SECRET}`));
    const net = await new TbcClient(cfg(), { ...quick, fetch: dead }).movements(ACCOUNT, '2032-03-10', '2032-03-10').catch((e: unknown) => e);
    expect(net).toMatchObject({ failure: 'network' });
    expect(String(net)).not.toContain(SECRET);
  });

  it('reads the statement as the bank’s sums of the period, in tetri', async () => {
    const bank = fakeBank({ sums: { '2032-03-10': { creditSum: 10172.6, debitSum: 10181.5 } } });
    expect(await new TbcClient(cfg(), { ...quick, fetch: bank.fetchFn }).statement(ACCOUNT, '2032-03-10', '2032-03-10')).toEqual({ creditTetri: 1017260, debitTetri: 1018150 });
  });
});

describe.skipIf(!HAS_DB)('the TBC pull, the night and the queue', () => {
  // Sums nobody else in this database has: the rules then attach nothing, and a line is told by its sum.
  const run = Date.now() % 100_000;
  let test = 0;
  let base = 0;
  const sum = (n: number) => base + n;
  // Transaction ids nobody else has either.
  const idOf = (n: number) => 20_000_000_000 + run * 1000 + (test % 10) * 100 + n;
  const at = (day: string, time = '10:00') => new Date(`${day}T${time}:00+04:00`);

  async function reset() {
    const { prisma } = await import('../src/lib/db.js');
    await prisma.tbcSync.update({
      where: { id: true },
      data: { lastOkAt: null, lastTryAt: null, lastFailure: null, lastHttpStatus: null, todayCount: 0, nightThrough: null, nightAt: null, nightFailure: null, nightHttpStatus: null, nightMismatchOn: null, nightAdded: 0 },
    });
  }

  async function linesOf(amounts: number[]) {
    const { prisma } = await import('../src/lib/db.js');
    return prisma.statementLine.findMany({ where: { bank: 'tbc', amountTetri: { in: amounts.map((a) => Math.round(a * 100)) } }, include: { statement: true }, orderBy: { naturalKey: 'asc' } });
  }

  /** A TBC CSV of this invented account, as the export writes it. */
  function csv(rows: { day: string; amount: string; txn: string; partner?: string }[]) {
    return [
      '"თარიღი","დანიშნულება","ტრანზაქციის ტიპი","თანხა","ვალუტა","ანგარიშის ნომერი","ანგარიშის დასახელება","დამატებითი ინფორმაცია","საბუთის თარიღი","საბუთის №","პარტნიორის ანგარიში","პარტნიორი","პარტნიორის საგადასახადო კოდი","პარტნიორის ბანკის კოდი","პარტნიორის ბანკი","შუამავალი ბანკის კოდი","შუამავალი ბანკი","ხარჯის ტიპი","გადასახადის გადამხდელის კოდი","გადასახადის გადამხდელის დასახელება","სახაზინო კოდი","ოპ.კოდი","დამატებითი დანიშნულება","ტრანზაქციის ID"',
      '"Date","Description","Transaction Type","Amount","Currency","Account Number","Account Name","Additional Information","Document Date","Document Number","Partner\'s Account","Partner\'s Name","Partner\'s Tax Code","Partner\'s Bank Code","Partner\'s Bank","Intermediary Bank Code","Intermediary Bank","Charge Details","Taxpayer Code","Taxpayer Name","Treasury Code","Op.Code","Additional Description","Transaction ID"',
      ...rows.map((r) => {
        const dmy = `${r.day.slice(8, 10)}/${r.day.slice(5, 7)}/${r.day.slice(0, 4)}`;
        return `"${dmy}","TEST rent","Income","${r.amount}","GEL","${ACCOUNT}","TEST COMPANY","","${dmy}","000123","GE00BG0000000000000002","${r.partner ?? 'TEST PAYER'}","","BAGAGE22","TEST BANK","","","","","","","GIB","","${r.txn}"`;
      }),
    ].join('\n');
  }

  beforeEach(async () => {
    test++;
    base = 200_000 + run * 100 + (test % 10) * 10;
    process.env.TBC_CLIENT_ID = ID;
    process.env.TBC_CLIENT_SECRET = SECRET;
    process.env.TBC_ACCOUNT = ACCOUNT;
    await reset();
  });
  afterEach(() => {
    delete process.env.TBC_CLIENT_ID;
    delete process.env.TBC_CLIENT_SECRET;
    delete process.env.TBC_ACCOUNT;
    setTbcFetchForTests(null);
  });
  afterAll(reset);

  it('puts the day’s movements in the queue once, under one statement of the day, and a second pull adds nothing', async () => {
    const day = '2032-03-10';
    const bank = fakeBank({
      movements: [
        movement({ id: idOf(1), day, amount: sum(1), partner: `TEST PAYER ${uniq()}` }),
        movement({ id: idOf(2), day, amount: sum(2), debit: true, partner: 'TEST SHOP' }),
        movement({ id: idOf(3), day, amount: sum(3), debit: true, status: 2 }), // waiting for its signature
      ],
    });
    setTbcFetchForTests(bank.fetchFn, quick);

    const first = await syncTbcToday(at(day));
    expect(first).toMatchObject({ status: 'ok', listed: 3, added: 2, known: { byKey: 0, byId: 0, byDoc: 0, bySum: 0 } });
    const second = await syncTbcToday(at(day, '10:05'));
    expect(second).toMatchObject({ status: 'ok', listed: 3, added: 0, known: { byKey: 2 } });

    const lines = await linesOf([sum(1), sum(2), sum(3)]);
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.status === 'unmatched')).toBe(true);
    expect(new Set(lines.map((l) => l.statementId)).size).toBe(1);
    expect(lines[0]!.statement).toMatchObject({ bank: 'tbc', source: 'api', fileName: 'Business Integration Services', account: ACCOUNT, newLines: 2, uploadedById: null });

    const { prisma } = await import('../src/lib/db.js');
    expect(await prisma.tbcSync.findUnique({ where: { id: true } })).toMatchObject({ lastFailure: null, todayCount: 3 });
    const journal = await prisma.auditLog.findMany({ where: { action: 'statement.pull', entityId: lines[0]!.statementId } });
    expect(journal).toHaveLength(1);
    expect(journal[0]!.actorId).toBeNull();
    expect(journal[0]!.after).toMatchObject({ bank: 'tbc' });
  });

  it('does not bring again a line already loaded from a CSV — known by its transaction id — nor the other way', async () => {
    const day = '2032-03-11';
    const owner = await loginAs('owner');
    const res = await call(owner, 'POST', '/api/statements', { fileName: 'transactions_history.csv', text: csv([{ day, amount: sum(1).toFixed(1), txn: txnOf(idOf(1)) }]) });
    expect(res.statusCode, res.body).toBe(201);

    setTbcFetchForTests(fakeBank({ movements: [movement({ id: idOf(1), day, amount: sum(1) }), movement({ id: idOf(2), day, amount: sum(2) })] }).fetchFn, quick);
    expect(await syncTbcToday(at(day, '18:00'))).toMatchObject({ status: 'ok', listed: 2, added: 1, known: { byId: 1 } });
    const lines = await linesOf([sum(1), sum(2)]);
    expect(lines.map((l) => [l.amountTetri, l.statement.source]).sort()).toEqual([
      [Math.round(sum(1) * 100), 'file'],
      [Math.round(sum(2) * 100), 'api'],
    ]);

    // The same export, made later with the second movement in it, adds nothing.
    const later = csv([
      { day, amount: sum(1).toFixed(1), txn: txnOf(idOf(1)) },
      { day, amount: sum(2).toFixed(1), txn: txnOf(idOf(2)) },
    ]);
    const preview = json<{ newLines: number; alreadyIn: number }>(await call(owner, 'POST', '/api/statements/preview', { fileName: 'transactions_history.csv', text: later }));
    expect(preview).toMatchObject({ newLines: 0, alreadyIn: 2 });
  });

  it('reads the night from where the last one stopped, skips the days a file covers, adds what the pulls missed, and checks the sums', async () => {
    const owner = await loginAs('owner');
    // A file whose lines run 01–08.03, uploaded before the 8th was over: 01–07 are whole, the 8th is not.
    // (It is uploaded "now", years before 2032; that is what makes its last day not whole.)
    await call(owner, 'POST', '/api/statements', {
      fileName: 'transactions_history.csv',
      text: csv([
        { day: '2032-03-01', amount: sum(8).toFixed(1), txn: txnOf(idOf(8)) },
        { day: '2032-03-08', amount: sum(1).toFixed(1), txn: txnOf(idOf(1)) },
      ]),
    });
    const { prisma } = await import('../src/lib/db.js');
    await prisma.tbcSync.update({ where: { id: true }, data: { nightThrough: new Date('2032-03-06T00:00:00Z') } });

    setTbcFetchForTests(fakeBank({ movements: [movement({ id: idOf(2), day: '2032-03-09', amount: sum(2) })] }).fetchFn, quick);
    await syncTbcToday(at('2032-03-09'));

    const bank = fakeBank({
      movements: [
        movement({ id: idOf(9), day: '2032-03-07', amount: sum(9) }), // a whole day of the file: not taken
        movement({ id: idOf(1), day: '2032-03-08', amount: sum(1) }), // in the file
        movement({ id: idOf(2), day: '2032-03-09', amount: sum(2) }), // in the day's pull
        movement({ id: idOf(3), day: '2032-03-09', amount: sum(3), debit: true }), // missed
      ],
    });
    setTbcFetchForTests(bank.fetchFn, quick);
    const night = await reconcileTbcNight(at('2032-03-10', '01:47'));
    expect(night).toMatchObject({ status: 'ok', added: 1, known: { byKey: 1, byId: 1 }, days: ['2032-03-08', '2032-03-09'], mismatched: [] });
    const asked = bank.calls.slice(1).map((c) => new URL(c.url)).map((u) => `${u.pathname} ${u.searchParams.get('PeriodFrom')}…${u.searchParams.get('PeriodTo')}`);
    expect(asked).toEqual(['/bab/v1/accounts/movements 2032-03-08…2032-03-09', '/bab/v1/accounts/statements 2032-03-08…2032-03-08', '/bab/v1/accounts/statements 2032-03-09…2032-03-09']);
    expect(await linesOf([sum(9)])).toHaveLength(0);
    expect(await linesOf([sum(1), sum(2), sum(3)])).toHaveLength(3);

    const sync = await prisma.tbcSync.findUnique({ where: { id: true } });
    expect(sync).toMatchObject({ nightFailure: null, nightMismatchOn: null, nightAdded: 1 });
    expect(sync?.nightThrough?.toISOString().slice(0, 10)).toBe('2032-03-09');

    // Asked again the same day — the worker asks on every start — it reads nothing.
    expect(await reconcileTbcNight(at('2032-03-10', '09:00'))).toMatchObject({ status: 'ok', listed: 0, days: [] });
    expect(bank.calls).toHaveLength(4);
  });

  it('says when a day does not add up to the bank’s sums, and reads it again the next time', async () => {
    const { prisma } = await import('../src/lib/db.js');
    await prisma.tbcSync.update({ where: { id: true }, data: { nightThrough: new Date('2032-03-12T00:00:00Z') } });
    const movements = [movement({ id: idOf(1), day: '2032-03-13', amount: sum(1) }), movement({ id: idOf(2), day: '2032-03-14', amount: sum(2) })];
    // The bank's sum for the 13th has a movement more than its list gave.
    setTbcFetchForTests(fakeBank({ movements, sums: { '2032-03-13': { creditSum: sum(1) + 40.5, debitSum: 0 } } }).fetchFn, quick);
    const night = await reconcileTbcNight(at('2032-03-15', '01:47'));
    expect(night).toMatchObject({ status: 'ok', added: 2, mismatched: ['2032-03-13'] });
    const sync = await prisma.tbcSync.findUnique({ where: { id: true } });
    expect(sync).toMatchObject({ nightFailure: 'mismatch' });
    expect(sync?.nightMismatchOn?.toISOString().slice(0, 10)).toBe('2032-03-13');
    expect(sync?.nightThrough?.toISOString().slice(0, 10)).toBe('2032-03-12');

    const owner = await loginAs('owner');
    const page = json<{ banks: { bank: string; api: { nightFailure: string | null; nightMismatchOn: string | null } | null }[] }>(await call(owner, 'GET', '/api/statements'));
    expect(page.banks.find((b) => b.bank === 'tbc')?.api).toMatchObject({ nightFailure: 'mismatch', nightMismatchOn: '2032-03-13' });

    // The bank lists the late movement now: the day is read again, the line comes, the sums agree.
    const late = [...movements, movement({ id: idOf(3), day: '2032-03-13', amount: 40.5 })];
    setTbcFetchForTests(fakeBank({ movements: late }).fetchFn, quick);
    expect(await reconcileTbcNight(at('2032-03-15', '02:47'))).toMatchObject({ status: 'ok', added: 1, known: { byKey: 2 }, mismatched: [] });
    const after = await prisma.tbcSync.findUnique({ where: { id: true } });
    expect(after).toMatchObject({ nightFailure: null, nightMismatchOn: null });
    expect(after?.nightThrough?.toISOString().slice(0, 10)).toBe('2032-03-14');
  });

  it('keeps the failure and its word; asks about the account of the last uploaded statement when none is named', async () => {
    setTbcFetchForTests(fakeBank({ tokenStatus: 401 }).fetchFn, quick);
    expect(await syncTbcToday(at('2032-03-16'))).toEqual({ status: 'failed', failure: 'unauthorized', httpStatus: 401, stage: 'token' });
    const owner = await loginAs('owner');
    const page = json<{ banks: { bank: string; api: { freshness: string; failure: string | null } | null }[] }>(await call(owner, 'GET', '/api/statements'));
    expect(page.banks.find((b) => b.bank === 'tbc')?.api).toMatchObject({ freshness: 'silent', failure: 'unauthorized' });

    process.env.TBC_ACCOUNT = 'GE00BG0000000000000001';
    expect(await syncTbcToday(at('2032-03-16'))).toEqual({ status: 'failed', failure: 'no_account', httpStatus: null, stage: null });

    delete process.env.TBC_ACCOUNT;
    await call(owner, 'POST', '/api/statements', { fileName: 'transactions_history.csv', text: csv([{ day: '2032-03-16', amount: sum(1).toFixed(1), txn: txnOf(idOf(1)) }]) });
    const bank = fakeBank({ movements: [] });
    setTbcFetchForTests(bank.fetchFn, quick);
    expect(await syncTbcToday(at('2032-03-16'))).toMatchObject({ status: 'ok', listed: 0 });
    expect(new URL(bank.calls.at(-1)!.url).searchParams.get('AccountNumber')).toBe(ACCOUNT);
  });

  it('is off without the keys: nothing is asked, nothing is shown', async () => {
    delete process.env.TBC_CLIENT_ID;
    const bank = fakeBank({ movements: [] });
    setTbcFetchForTests(bank.fetchFn, quick);
    expect(await syncTbcToday(at('2032-03-17'))).toEqual({ status: 'off' });
    expect(await reconcileTbcNight(at('2032-03-17'))).toEqual({ status: 'off' });
    expect(bank.calls).toHaveLength(0);
    const owner = await loginAs('owner');
    const page = json<{ banks: { bank: string; api: unknown }[] }>(await call(owner, 'GET', '/api/statements'));
    expect(page.banks.find((b) => b.bank === 'tbc')?.api).toBeNull();
  });

  it('opens the two jobs to the worker only', async () => {
    const app = await getApp();
    const { env } = await import('../src/lib/env.js');
    setTbcFetchForTests(fakeBank({ movements: [] }).fetchFn, quick);
    for (const url of ['/api/jobs/tbc-today', '/api/jobs/tbc-night']) {
      expect((await app.inject({ method: 'POST', url, headers: { 'x-worker-token': 'not-it' } })).statusCode).toBe(401);
      const ok = await app.inject({ method: 'POST', url, headers: { 'x-worker-token': env.WORKER_TOKEN } });
      expect(ok.statusCode, ok.body).toBe(200);
      expect(json<{ status: string }>(ok).status).toBe('ok');
      expect(ok.body).not.toContain(SECRET);
    }
  });
});
