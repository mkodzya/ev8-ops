// «Прочитать сейчас» on «Деньги → Выписки» (Mika, 29.10.2026: «давай сделаем
// кнопку тоже»): both banks asked at once by the jobs' own functions. The banks
// are never called from here — a function stands in for each, so these run
// with no network and no key that opens anything.
//
// Every account number, id, name and sum below is invented for the test. The
// dates are in 2033 so that no line another suite loaded can be taken for one
// of these.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setBogFetchForTests, syncBogToday, type BogFetch } from '../src/lib/bog.js';
import { resetReadNowForTests, setReadNowClockForTests } from '../src/lib/statements/readNow.js';
import { setTbcFetchForTests, type TbcFetch } from '../src/lib/tbc.js';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

const SECRET = 'test-client-secret-that-opens-nothing';
const BOG_ACCOUNT = 'GE00BG0000000000000001'; // invented
const TBC_ACCOUNT = 'GE00TB0000000000000001'; // invented
const BOG_TOKEN = 'https://account.bog.ge/auth/realms/bog/protocol/openid-connect/token';
const BOG_API = 'https://api.businessonline.ge/api';
const TBC_BASE = 'https://api.tbcbank.ge';
const quick = { gapMs: 0, sleep: async () => {} };
/** What a stand-in bank says when it refuses: a text the answer must never carry. */
const BANKS_WORDS = 'ТЕСТ Тайна банка';

const reply = (status: number, body: unknown) => ({ status, headers: { get: () => null }, json: async () => body });

/**
 * Bank of Georgia as far as the link knows it: the day's operations and the
 * statement of each currency apart. `refused` — pairs as `IBAN/USD` the bank
 * refuses these keys; `down` — currencies whose list of the day's operations
 * the gateway does not answer; `gate` holds every answer until it opens.
 */
function bogBank(state: { today?: Record<string, unknown[]>; entries?: Record<string, unknown[]>; refused?: string[]; down?: string[]; tokenStatus?: number; gate?: Promise<void> }) {
  const calls: string[] = [];
  const fetchFn: BogFetch = async (url) => {
    calls.push(url);
    if (state.gate) await state.gate;
    if (url === BOG_TOKEN) return state.tokenStatus ? reply(state.tokenStatus, { error: BANKS_WORDS }) : reply(200, { access_token: 'token-1', expires_in: 300 });
    const m = /^\/v2\/(documents\/todayactivities|statement)\/([^/]+)\/([A-Z]{3})(?:\/(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2}))?$/.exec(url.slice(BOG_API.length));
    if (!m) return reply(404, {});
    const [, kind, iban, currency, from, to] = m;
    if (state.refused?.includes(`${iban}/${currency}`)) return reply(403, { message: BANKS_WORDS });
    if (kind !== 'statement') return state.down?.includes(currency!) ? reply(503, { message: BANKS_WORDS }) : reply(200, state.today?.[currency!] ?? []);
    const records = (state.entries?.[currency!] ?? []).filter((e) => {
      const day = String((e as { EntryDate: string }).EntryDate).slice(0, 10);
      return day >= from! && day <= to!;
    });
    return reply(200, { Id: 1, Count: records.length, TotalCount: records.length, Records: records });
  };
  return { fetchFn, calls };
}

/** One of the day's operations at Bank of Georgia, money in, from an invented payer. */
function activity(id: number, day: string, credit: number) {
  const them = { Name: `TEST PAYER ${uniq()}`, AccountNumber: 'GE00TB0000000000000002' };
  return { Id: id, DocNo: `D${id}`, PostDate: `${day}T00:00:00`, EntryComment: 'test transfer', Nomination: 'qira', Credit: credit, Debit: 0, Amount: credit, AmountBase: credit, Sender: them, Beneficiary: { Name: 'TEST COMPANY', AccountNumber: BOG_ACCOUNT } };
}

/** One entry of a Bank of Georgia statement, money in. */
function entry(id: number, day: string, credit: number) {
  return {
    EntryId: id,
    EntryDate: `${day}T00:00:00`,
    EntryDocumentNumber: `E${id}`,
    EntryAmountCredit: credit,
    EntryAmountDebit: 0,
    EntryAmountBase: credit,
    EntryComment: 'test transfer',
    DocumentNomination: 'qira',
    SenderDetails: { Name: `TEST PAYER ${uniq()}`, AccountNumber: 'GE00TB0000000000000002' },
    BeneficiaryDetails: { Name: 'TEST COMPANY', AccountNumber: BOG_ACCOUNT },
  };
}

/**
 * TBC as far as the link knows it: the movements, and the statement's sums made
 * of them. `off` — a sum the bank's statement has beyond its movements, by
 * currency and day (`USD 2033-05-10`).
 */
function tbcBank(state: { movements?: ReturnType<typeof movement>[]; off?: Record<string, number>; tokenStatus?: number }) {
  const calls: string[] = [];
  const fetchFn: TbcFetch = async (url) => {
    calls.push(url);
    if (url === `${TBC_BASE}/oauth/token`) return state.tokenStatus ? reply(state.tokenStatus, { error: BANKS_WORDS }) : reply(200, { access_token: 'token-1', expires_in: 3600 });
    const u = new URL(url);
    const q = u.searchParams;
    const all = (state.movements ?? []).filter((m) => m.currency === q.get('AccountCurrencyCode') && m.date.slice(0, 10) >= q.get('PeriodFrom')! && m.date.slice(0, 10) <= q.get('PeriodTo')!);
    if (u.pathname === '/bab/v1/accounts/movements') return reply(200, { transactions: all, total: all.length });
    if (u.pathname === '/bab/v1/accounts/statements') {
      const off = state.off?.[`${q.get('AccountCurrencyCode')} ${q.get('PeriodFrom')}`] ?? 0;
      return reply(200, { creditSum: all.filter((m) => !m.isDebit).reduce((s, m) => s + m.amount, 0) + off, debitSum: 0 });
    }
    return reply(404, {});
  };
  return { fetchFn, calls };
}

/** One movement at TBC, money in, from an invented partner. */
function movement(id: number, day: string, amount: number) {
  const digits = String(id).padStart(11, '0');
  return {
    movementId: `0${digits}.2`,
    externalPaymentId: digits,
    amount,
    currency: 'GEL',
    purpose: 'TEST rent',
    isDebit: false,
    documentDate: `${day}T00:00:00`,
    date: `${day}T00:00:00`,
    statusCode: 0,
    documentNumber: `T${id}`,
    partnerAccountInfo: { accountIban: 'GE00BG0000000000000002', partnerName: `TEST PAYER ${uniq()}` },
  };
}

interface Read {
  status: string;
  seconds?: number;
  banks?: { bank: string; failure: string | null; accounts: { last4: string; currency: string; added: number; days: string[]; failure: string | null; later?: true }[] }[];
}

describe.skipIf(!HAS_DB)('«Прочитать сейчас» on «Выписки»', () => {
  const today = '2033-05-20';
  const yesterday = '2033-05-19';
  const now = new Date(`${today}T10:00:00+04:00`).getTime();
  // Sums and ids nobody else in this database has: a line is told by its sum.
  const run = Date.now() % 100_000;
  const sum = (n: number) => 300_000 + run + n;
  const id = (n: number) => run * 100 + n;
  let clock = now;

  async function reset() {
    const { prisma } = await import('../src/lib/db.js');
    await prisma.bankApiAccount.deleteMany({ where: { bank: { in: ['bog', 'tbc'] } } });
    // The lari of both banks has read its nights up to yesterday, after the morning: only a new pair has past days to read.
    const read = { nightThrough: new Date(`${yesterday}T00:00:00Z`), nightAt: new Date(`${today}T07:00:00+04:00`), nightFailure: null, nightHttpStatus: null, nightAdded: 0 };
    const fresh = { lastOkAt: null, lastTryAt: null, lastFailure: null, lastHttpStatus: null, todayCount: 0 };
    await prisma.bogSync.update({ where: { id: true }, data: { ...fresh, ...read } });
    await prisma.tbcSync.update({ where: { id: true }, data: { ...fresh, ...read, nightMismatchOn: null } });
  }

  const press = (cookie: string) => call(cookie, 'POST', '/api/statements/read-now', {});

  beforeEach(async () => {
    process.env.BOG_CLIENT_ID = 'test-client-id';
    process.env.BOG_CLIENT_SECRET = SECRET;
    process.env.BOG_ACCOUNT = `${BOG_ACCOUNT} ${BOG_ACCOUNT}USD`;
    process.env.TBC_CLIENT_ID = 'test-client-id';
    process.env.TBC_CLIENT_SECRET = SECRET;
    process.env.TBC_ACCOUNT = TBC_ACCOUNT;
    resetReadNowForTests();
    clock = now;
    setReadNowClockForTests(() => clock);
    await reset();
  });
  afterEach(() => {
    for (const k of ['BOG_CLIENT_ID', 'BOG_CLIENT_SECRET', 'BOG_ACCOUNT', 'TBC_CLIENT_ID', 'TBC_CLIENT_SECRET', 'TBC_ACCOUNT']) delete process.env[k];
    setBogFetchForTests(null);
    setTbcFetchForTests(null);
    resetReadNowForTests();
  });
  afterAll(reset);

  it('asks both banks for the day and the past days not read yet, and says per pair what came, by the last four digits only', async () => {
    const bog = bogBank({
      today: { GEL: [activity(id(1), today, sum(1))], USD: [activity(id(2), today, sum(2))] },
      // The account in dollars is new: its night reads back a month.
      entries: { USD: [entry(id(3), '2033-04-25', sum(3)), entry(id(4), '2033-05-10', sum(4))] },
    });
    const tbc = tbcBank({ movements: [movement(8_000_000_000 + id(5), today, sum(5))] });
    setBogFetchForTests(bog.fetchFn, quick);
    setTbcFetchForTests(tbc.fetchFn, quick);

    const owner = await loginAs('owner');
    const res = await press(owner);
    expect(res.statusCode, res.body).toBe(200);
    const read = json<Read>(res);
    expect(read).toMatchObject({ status: 'ok', seconds: 60 });
    const [b, t] = read.banks!;
    expect(b).toMatchObject({ bank: 'bog', failure: null });
    expect(b!.accounts).toEqual([
      { last4: '0001', currency: 'GEL', added: 1, days: [], failure: null },
      expect.objectContaining({ last4: '0001', currency: 'USD', added: 3, failure: null }),
    ]);
    const usd = b!.accounts[1]!;
    expect([usd.days[0], usd.days.at(-1), usd.days.length]).toEqual(['2033-04-19', yesterday, 31]);
    expect(t).toEqual({ bank: 'tbc', failure: null, accounts: [{ last4: '0001', currency: 'GEL', added: 1, days: [], failure: null }] });

    // Counts and our words: no account beyond its last four digits, no payer, no key, nothing of the banks' answers.
    for (const never of [BOG_ACCOUNT, TBC_ACCOUNT, SECRET, 'TEST PAYER', 'token-1']) expect(res.body).not.toContain(never);

    // The lines are where the jobs put them: in the queue for lari, parked for dollars.
    const { prisma } = await import('../src/lib/db.js');
    const lines = await prisma.statementLine.findMany({ where: { amountTetri: { in: [1, 2, 3, 4, 5].map((n) => sum(n) * 100) } }, orderBy: { amountTetri: 'asc' } });
    expect(lines.map((l) => [l.bank, l.currency, l.status])).toEqual([
      ['bog', 'GEL', 'unmatched'],
      ['bog', 'USD', 'ignored'],
      ['bog', 'USD', 'ignored'],
      ['bog', 'USD', 'ignored'],
      ['tbc', 'GEL', 'unmatched'],
    ]);
    // The pair in dollars has read its past days, as the worker's night would have.
    const row = await prisma.bankApiAccount.findFirst({ where: { bank: 'bog', currency: 'USD' } });
    expect(row?.nightThrough?.toISOString().slice(0, 10)).toBe(yesterday);
  });

  it('asks at most once a minute, whoever asks: the second press within it is refused with the seconds left', async () => {
    const bog = bogBank({ today: { GEL: [] } });
    const tbc = tbcBank({});
    setBogFetchForTests(bog.fetchFn, quick);
    setTbcFetchForTests(tbc.fetchFn, quick);
    const owner = await loginAs('owner');
    expect((await press(owner)).statusCode).toBe(200);
    const asked = [bog.calls.length, tbc.calls.length];

    clock = now + 15_000;
    const again = await press(await loginAs('owner'));
    expect(again.statusCode).toBe(429);
    expect(json(again)).toMatchObject({ error: 'bank_read_too_soon', seconds: 45 });
    expect([bog.calls.length, tbc.calls.length]).toEqual(asked);

    clock = now + 60_000;
    const later = await press(owner);
    expect(later.statusCode, later.body).toBe(200);
    // The night has nothing left to read: only the day is asked again.
    expect(json<Read>(later).banks!.flatMap((x) => x.accounts.map((a) => a.days.length))).toEqual([0, 0, 0]);
  });

  it('is an owner’s: a manager, a mechanic and a chief mechanic are refused, and spend no minute', async () => {
    const bog = bogBank({ today: {} });
    setBogFetchForTests(bog.fetchFn, quick);
    setTbcFetchForTests(tbcBank({}).fetchFn, quick);
    for (const role of ['manager', 'mechanic', 'chief_mechanic'] as const) {
      const res = await press(await loginAs(role));
      expect(res.statusCode, role).toBe(403);
    }
    expect(bog.calls).toHaveLength(0);
    expect((await press(await loginAs('owner'))).statusCode).toBe(200);
  });

  it('answers busy while a job of a bank runs, asks nothing, and spends no minute', async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const bog = bogBank({ today: {}, gate });
    const tbc = tbcBank({});
    setBogFetchForTests(bog.fetchFn, quick);
    setTbcFetchForTests(tbc.fetchFn, quick);
    // The worker's pull of the day, held at the bank's door.
    const pull = syncBogToday(new Date(now));

    const owner = await loginAs('owner');
    const res = await press(owner);
    expect(res.statusCode, res.body).toBe(200);
    expect(json(res)).toEqual({ status: 'busy' });
    expect(tbc.calls).toHaveLength(0);

    open();
    expect(await pull).toMatchObject({ status: 'ok' });
    const after = await press(owner);
    expect(after.statusCode, after.body).toBe(200);
    expect(json(after)).toMatchObject({ status: 'ok' });
  });

  it('skips a bank whose keys are not on the stand, without a word, and is off with neither', async () => {
    delete process.env.TBC_CLIENT_SECRET;
    const tbc = tbcBank({});
    setBogFetchForTests(bogBank({ today: {} }).fetchFn, quick);
    setTbcFetchForTests(tbc.fetchFn, quick);
    const owner = await loginAs('owner');
    const read = json<Read>(await press(owner));
    expect(read.banks!.map((x) => x.bank)).toEqual(['bog']);
    expect(tbc.calls).toHaveLength(0);

    delete process.env.BOG_CLIENT_ID;
    clock = now + 60_000;
    expect(json(await press(owner))).toEqual({ status: 'off' });
  });

  it('says per pair why the bank gave nothing — the pair it refused, every pair when it refused the keys — and the bank’s own word with no pair to ask', async () => {
    setBogFetchForTests(bogBank({ today: { GEL: [activity(id(6), today, sum(6))] }, refused: [`${BOG_ACCOUNT}/USD`] }).fetchFn, quick);
    setTbcFetchForTests(tbcBank({ tokenStatus: 401 }).fetchFn, quick);
    const owner = await loginAs('owner');
    const res = await press(owner);
    expect(json<Read>(res).banks).toEqual([
      {
        bank: 'bog',
        failure: null,
        accounts: [
          { last4: '0001', currency: 'GEL', added: 1, days: [], failure: null },
          { last4: '0001', currency: 'USD', added: 0, days: [], failure: 'forbidden' },
        ],
      },
      { bank: 'tbc', failure: null, accounts: [{ last4: '0001', currency: 'GEL', added: 0, days: [], failure: 'unauthorized' }] },
    ]);
    expect(res.body).not.toContain(BANKS_WORDS);

    // An account the stand cannot read is no pair: the bank has its word, and no account is named.
    process.env.TBC_ACCOUNT = 'GE00TB123';
    clock = now + 60_000;
    expect(json<Read>(await press(owner)).banks!.find((x) => x.bank === 'tbc')).toEqual({ bank: 'tbc', failure: 'no_account', accounts: [] });
  });

  it('asks a pair’s statement at Bank of Georgia once a press: when today’s stood in for the list of the day, the past days wait for the night, and it says so', async () => {
    // The list of the day's operations is down for the dollars (test stand, 15.10.2026: `todayactivities` 503 again and again).
    const state = { today: { GEL: [] }, down: ['USD'], entries: { USD: [entry(id(7), '2033-05-01', sum(7)), entry(id(8), today, sum(8))] } };
    const bog = bogBank(state);
    setBogFetchForTests(bog.fetchFn, quick);
    setTbcFetchForTests(tbcBank({}).fetchFn, quick);
    const owner = await loginAs('owner');
    const res = await press(owner);
    expect(res.statusCode, res.body).toBe(200);
    expect(json<Read>(res).banks!.find((x) => x.bank === 'bog')!.accounts).toEqual([
      { last4: '0001', currency: 'GEL', added: 0, days: [], failure: null },
      { last4: '0001', currency: 'USD', added: 1, days: [], failure: null, later: true },
    ]);
    // One statement of the dollars, today's: the bank gives one a minute.
    const statements = () => bog.calls.filter((u) => u.startsWith(`${BOG_API}/v2/statement/`) && u.includes('/USD/'));
    expect(statements()).toEqual([`${BOG_API}/v2/statement/${BOG_ACCOUNT}/USD/${today}/${today}`]);
    const { prisma } = await import('../src/lib/db.js');
    const row = () => prisma.bankApiAccount.findFirst({ where: { bank: 'bog', currency: 'USD' } });
    expect((await row())?.nightThrough).toBeNull();

    // A minute on, with the list of the day back, the past days are read.
    state.down = [];
    clock = now + 60_000;
    const later = json<Read>(await press(owner)).banks!.find((x) => x.bank === 'bog')!.accounts[1]!;
    expect(later).toMatchObject({ currency: 'USD', added: 1, failure: null });
    expect([later.days[0], later.days.at(-1), later.days.length, 'later' in later]).toEqual(['2033-04-19', yesterday, 31, false]);
    expect((await row())?.nightThrough?.toISOString().slice(0, 10)).toBe(yesterday);
  });

  it('says a TBC night whose days do not add up to the bank’s sums brought not everything, as the card says', async () => {
    process.env.TBC_ACCOUNT = `${TBC_ACCOUNT} ${TBC_ACCOUNT}USD`;
    setBogFetchForTests(bogBank({ today: {} }).fetchFn, quick);
    const dollars = { ...movement(8_000_000_000 + id(9), '2033-05-10', sum(9)), currency: 'USD' };
    // The bank's sums of the dollars for the 10th have a movement more than its list gave.
    setTbcFetchForTests(tbcBank({ movements: [dollars], off: { 'USD 2033-05-10': 12.5 } }).fetchFn, quick);
    const owner = await loginAs('owner');
    const res = await press(owner);
    expect(res.statusCode, res.body).toBe(200);
    const tbc = json<Read>(res).banks!.find((x) => x.bank === 'tbc')!;
    expect(tbc.failure).toBeNull();
    expect(tbc.accounts[0]).toEqual({ last4: '0001', currency: 'GEL', added: 0, days: [], failure: null });
    expect(tbc.accounts[1]).toMatchObject({ last4: '0001', currency: 'USD', added: 1, failure: 'mismatch' });
    expect(tbc.accounts[1]!.days).toContain('2033-05-10');
    // The card says the same of the pair: its night is read again from the day that did not add up.
    const { prisma } = await import('../src/lib/db.js');
    const row = await prisma.bankApiAccount.findFirst({ where: { bank: 'tbc', currency: 'USD' } });
    expect([row?.nightFailure, row?.nightMismatchOn?.toISOString().slice(0, 10), row?.nightThrough?.toISOString().slice(0, 10)]).toEqual(['mismatch', '2033-05-10', '2033-05-09']);
  });
});
