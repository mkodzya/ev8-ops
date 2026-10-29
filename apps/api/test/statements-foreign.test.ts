// Lines of an account in another currency, kept apart from the lari (migration
// 0073; Mika's decision D1 «А» of 29.10.2026, docs/spec/usd-accounts-plan.md).
// The stand does not read such an account yet; these suites put its lines in
// the way the bank's API will — by `keep` — and check that nothing in lari
// meets them: the queue, «Отложено», «Вернуть в очередь», the reports, the
// freshness of a bank, the rules that know a line already in. Every account,
// sum, shop and number here is invented; the days are in 2097, which no other
// suite writes lines in.
import { readFile } from 'node:fs/promises';
import { afterAll, describe, expect, it } from 'vitest';
import { todayISO } from '@ev8/shared';
import type { ParsedLine } from '../src/lib/statements/parse.js';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

const BOG_ACCOUNT = 'GE00BG0000000000000005'; // invented
const TBC_ACCOUNT = 'GE00TB0000000000000006'; // invented

const err = (res: { body: string }) => json<{ error: string }>(res).error;
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

/** An operation as a bank's reader hands it over: no payer, nothing a rule could take for a customer's money. */
function op(naturalKey: string, day: string, direction: 'in' | 'out', amountTetri: number, more: Partial<ParsedLine> = {}): ParsedLine {
  const sum = (amountTetri / 100).toFixed(2);
  return {
    naturalKey,
    docNo: null,
    occurredOn: day,
    direction,
    amountTetri,
    grossTetri: null,
    feeTetri: null,
    payer: null,
    purpose: 'invented transfer',
    // As Bank of Georgia's reader writes it: day, document, account, debit, credit, text.
    raw: [day.split('-').reverse().join('.'), '', 'GE00TB0000000000000002', direction === 'out' ? sum : '', direction === 'in' ? sum : '', 'invented transfer'].join(' | '),
    channel: 'transfer',
    ...more,
  };
}

describe('an account and its currency, as an env or a statement file writes it', () => {
  it('reads the currency after the IBAN, lari when there is none, and refuses one the stand does not read', async () => {
    const { accountPairOf } = await import('../src/lib/statements/apiDays.js');
    expect(accountPairOf(BOG_ACCOUNT)).toEqual({ iban: BOG_ACCOUNT, currency: 'GEL' });
    expect(accountPairOf(`${BOG_ACCOUNT}GEL`)).toEqual({ iban: BOG_ACCOUNT, currency: 'GEL' });
    expect(accountPairOf(` ${BOG_ACCOUNT.toLowerCase()}usd `)).toEqual({ iban: BOG_ACCOUNT, currency: 'USD' });
    expect(accountPairOf(`${TBC_ACCOUNT}EUR`, 'TB')).toEqual({ iban: TBC_ACCOUNT, currency: 'EUR' });
    expect(accountPairOf(`${BOG_ACCOUNT}GBP`)).toBeNull();
    expect(accountPairOf(`${BOG_ACCOUNT}USD`, 'TB')).toBeNull();
    expect(accountPairOf('GE00BG123USD')).toBeNull();
    expect(accountPairOf(null)).toBeNull();
  });
});

describe.skipIf(!HAS_DB)('lines in another currency, parked outside the lari (migration 0073)', () => {
  const made: string[] = [];
  afterAll(async () => {
    // The lines in lari these suites put in the queue go with their statements, so no later suite meets them there.
    const { prisma } = await import('../src/lib/db.js');
    await prisma.statement.deleteMany({ where: { id: { in: made } } });
  });

  async function apiDay(bank: 'bog' | 'tbc', account: string, currency: string, day: string) {
    const { prisma } = await import('../src/lib/db.js');
    const s = await prisma.statement.findFirstOrThrow({ where: { bank, source: 'api', account, currency, periodFrom: asDate(day) } });
    made.push(s.id);
    return s;
  }

  it('are written set aside as foreign in one go, and the queue, the reports and the freshness of the bank do not see them', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { keep, tally } = await import('../src/lib/statements/apiDays.js');
    const owner = await loginAs('owner');
    const day = '2097-03-10';
    const t = tally();
    await keep('bog', 'Business Online', BOG_ACCOUNT, day, [op(`api:today:USD:test-${uniq()}`, day, 'in', 15000), op(`api:today:USD:test-${uniq()}`, day, 'out', 4000)], t, 'USD');
    expect(t).toMatchObject({ added: 2, recorded: 0, matched: 0 });

    const statement = await apiDay('bog', BOG_ACCOUNT, 'USD', day);
    expect(statement).toMatchObject({ currency: 'USD', newLines: 2, matched: 0 });
    const lines = await prisma.statementLine.findMany({ where: { statementId: statement.id }, orderBy: { amountTetri: 'desc' } });
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l).toMatchObject({ currency: 'USD', status: 'ignored', resolution: 'foreign', matchedRule: 'foreign', resolvedById: null, resolvedAt: null, paymentId: null });

    // «Разобрать» never has them, and «Вернуть в очередь» does not put them there.
    const queue = json<{ lines: { id: string }[] }>(await call(owner, 'GET', '/api/statement-lines'));
    expect(queue.lines.map((l) => l.id)).not.toContain(lines[0]!.id);
    const restore = await call(owner, 'POST', `/api/statement-lines/${lines[0]!.id}/restore`, {});
    expect(restore.statusCode).toBe(409);
    expect(err(restore)).toBe('foreign_line');
    expect(await prisma.statementLine.findUniqueOrThrow({ where: { id: lines[0]!.id } })).toMatchObject({ status: 'ignored', resolution: 'foreign' });

    // The reports in lari: the day has nothing in lari, and so they say nothing at all.
    const out = json<{ totalOutTetri: number; unsorted: number; otherPaid: number }>(await call(owner, 'GET', `/api/reports/expenses?from=${day}&to=${day}`));
    expect(out).toMatchObject({ totalOutTetri: 0, unsorted: 0, otherPaid: 0 });
    const inc = json<{ totalInTetri: number; unsorted: number; other: number }>(await call(owner, 'GET', `/api/reports/incoming?from=${day}&to=${day}`));
    expect(inc).toMatchObject({ totalInTetri: 0, unsorted: 0, other: 0 });

    // Bank of Georgia's card is its lari account's: a day of dollars neither makes it fresh nor is its last upload.
    const s = json<{ banks: { bank: string; throughOn: string | null; lastUploadAt: string | null }[] }>(await call(owner, 'GET', '/api/statements'));
    const bog = s.banks.find((b) => b.bank === 'bog')!;
    expect(bog.throughOn).not.toBe(day);
    expect(bog.lastUploadAt).not.toBe(statement.createdAt.toISOString());
  });

  it('cannot be put in the queue or answered, and a line in lari cannot be parked: the database holds both', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { keep, tally } = await import('../src/lib/statements/apiDays.js');
    const day = '2097-03-11';
    await keep('bog', 'Business Online', BOG_ACCOUNT, day, [op(`api:today:USD:test-${uniq()}`, day, 'in', 2500)], tally(), 'USD');
    const statement = await apiDay('bog', BOG_ACCOUNT, 'USD', day);
    const line = await prisma.statementLine.findFirstOrThrow({ where: { statementId: statement.id } });

    // Every answer takes a line only from the queue: by its id, a parked line is refused like one answered already.
    const owner = await loginAs('owner');
    expect(err(await call(owner, 'POST', `/api/statement-lines/${line.id}/ignore`, { reason: 'invented' }))).toBe('already_matched');
    expect(err(await call(owner, 'POST', `/api/statement-lines/${line.id}/own-transfer`, {}))).toBe('already_matched');
    expect(err(await call(owner, 'POST', `/api/statement-lines/${line.id}/unlink`, {}))).toBe('not_matched');

    await expect(prisma.statementLine.update({ where: { id: line.id }, data: { status: 'unmatched', matchedRule: null, resolution: null } })).rejects.toThrow();
    await expect(prisma.statementLine.update({ where: { id: line.id }, data: { status: 'ignored', resolution: 'company_expense' } })).rejects.toThrow();
    await expect(prisma.statementLine.update({ where: { id: line.id }, data: { status: 'matched', matchedRule: 'by_hand' } })).rejects.toThrow();
    // Written in the queue in the first place, it is refused as well.
    await expect(
      prisma.statementLine.create({
        data: { statementId: statement.id, bank: 'bog', currency: 'USD', naturalKey: `api:today:USD:test-${uniq()}`, occurredOn: asDate(day), direction: 'in', amountTetri: 100, raw: 'invented', status: 'unmatched' },
      }),
    ).rejects.toThrow();
    // A line in lari is never 'foreign'.
    const gel = await prisma.statement.create({ data: { bank: 'bog', source: 'api', fileName: 'Business Online', fileSha256: 'api', account: BOG_ACCOUNT, periodFrom: asDate(day), periodTo: asDate(day) } });
    made.push(gel.id);
    await expect(
      prisma.statementLine.create({
        data: { statementId: gel.id, bank: 'bog', naturalKey: `api:today:test-${uniq()}`, occurredOn: asDate(day), direction: 'in', amountTetri: 100, raw: 'invented', status: 'ignored', resolution: 'foreign' },
      }),
    ).rejects.toThrow();
    expect(await prisma.statementLine.findUniqueOrThrow({ where: { id: line.id } })).toMatchObject({ status: 'ignored', resolution: 'foreign' });
  });

  it('are not «Отложено», even with a date of an answer on them', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { keep, tally } = await import('../src/lib/statements/apiDays.js');
    const owner = await loginAs('owner');
    const day = '2097-03-12';
    const asideCount = async () => json<{ asideMonth: number }>(await call(owner, 'GET', '/api/statement-lines?direction=out')).asideMonth;
    await keep('bog', 'Business Online', BOG_ACCOUNT, day, [op(`api:today:USD:test-${uniq()}`, day, 'out', 7300)], tally(), 'USD');
    const line = await prisma.statementLine.findFirstOrThrow({ where: { statementId: (await apiDay('bog', BOG_ACCOUNT, 'USD', day)).id } });
    const before = await asideCount();
    // The list of lines set aside reads the last month of answers: a parked line has none, and is left out even if it had.
    await prisma.statementLine.update({ where: { id: line.id }, data: { resolvedAt: new Date() } });
    expect(await asideCount()).toBe(before);
    const aside = json<{ lines: { id: string }[] }>(await call(owner, 'GET', '/api/statement-lines/aside'));
    expect(aside.lines.map((l) => l.id)).not.toContain(line.id);
  });

  it('keep the same IBAN in lari and in dollars apart: two statements a day, and 150 dollars are not 150 lari already in', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { keep, tally } = await import('../src/lib/statements/apiDays.js');
    const owner = await loginAs('owner');
    const day = '2097-04-14';
    // The night's statement brought 150 dollars, with no document number.
    await keep('bog', 'Business Online', BOG_ACCOUNT, day, [op(`api:entry:USD:test-${uniq()}`, day, 'in', 15000)], tally(), 'USD');
    // The day's list brings 150 lari on the same day: by day and sum alone (rule 4) it would be the same operation.
    const t = tally();
    await keep('bog', 'Business Online', BOG_ACCOUNT, day, [op(`api:today:test-${uniq()}`, day, 'in', 15000)], t);
    expect(t).toMatchObject({ added: 1, known: { byKey: 0, byId: 0, byDoc: 0, bySum: 0, byCard: 0 } });
    // And the other way round: 150 dollars more from the night are not the 150 lari of the day.
    const back = tally();
    await keep('bog', 'Business Online', BOG_ACCOUNT, day, [op(`api:entry:USD:test-${uniq()}`, day, 'in', 15000)], back, 'USD');
    expect(back).toMatchObject({ added: 1, known: { bySum: 0 } });

    const usd = await apiDay('bog', BOG_ACCOUNT, 'USD', day);
    const gel = await apiDay('bog', BOG_ACCOUNT, 'GEL', day);
    expect(usd.id).not.toBe(gel.id);
    expect(usd.newLines).toBe(2);
    const lari = await prisma.statementLine.findFirstOrThrow({ where: { statementId: gel.id } });
    expect(lari).toMatchObject({ currency: 'GEL', status: 'unmatched', resolution: null });
    // The lari waits in «Разобрать» as any line does.
    const queue = json<{ lines: { id: string }[] }>(await call(owner, 'GET', '/api/statement-lines?direction=in'));
    expect(queue.lines.map((l) => l.id)).toContain(lari.id);
  });

  it('are not known by TBC’s transaction id of a line in lari, which is compared without the sum', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { keep, tally } = await import('../src/lib/statements/apiDays.js');
    const day = '2097-05-19';
    const id = `2${String(Math.floor(Math.random() * 1e10)).padStart(10, '0')}`;
    // The lari account's file has the transaction under its id.
    const file = await prisma.statement.create({ data: { bank: 'tbc', fileName: 'invented.csv', fileSha256: `test-${uniq()}`, account: TBC_ACCOUNT, periodFrom: asDate(day), periodTo: asDate(day) } });
    made.push(file.id);
    await prisma.statementLine.create({ data: { statementId: file.id, bank: 'tbc', naturalKey: `txn:${id}.20`, occurredOn: asDate(day), direction: 'in', amountTetri: 15000, raw: 'invented' } });
    // A movement of the dollar account under the same number, as if its key carried no currency.
    const t = tally();
    await keep('tbc', 'Business Integration Services', TBC_ACCOUNT, day, [op(`api:mv:0${id}.2`, day, 'in', 4000)], t, 'USD');
    expect(t).toMatchObject({ added: 1, known: { byId: 0 } });
    const usd = await apiDay('tbc', TBC_ACCOUNT, 'USD', day);
    expect(await prisma.statementLine.findFirstOrThrow({ where: { statementId: usd.id } })).toMatchObject({ currency: 'USD', status: 'ignored', resolution: 'foreign', amountTetri: 4000 });
  });

  it('are no card payment the lari account repeats: neither known by rule 5 nor named as its twin in the queue', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { keep, tally } = await import('../src/lib/statements/apiDays.js');
    const owner = await loginAs('owner');
    const day = '2097-06-23';
    const text = (cur: string) =>
      `გადახდა - თანხა: ${cur}12.40; ობიექტი: Example Bakery, Tbilisi, 2 Test Street; MCC:5462; თარიღი: 23/06/2097 18:13; ბარათის No: ****0000; გადახდის ოპერაციის თანხა და ვალუტა: 12.40 ${cur}`;
    const raw = (doc: string, cur: string) => `23.06.2097 | ${doc} |  | 12.40 |  | ${text(cur)}`;
    // The dollar account's posting first, then the lari account's card operation of the same shop, minute and sum.
    await keep('bog', 'Business Online', BOG_ACCOUNT, day, [op(`api:today:USD:test-${uniq()}`, day, 'out', 1240, { docNo: '11000000301', raw: raw('11000000301', 'USD') })], tally(), 'USD');
    const t = tally();
    await keep('bog', 'Business Online', BOG_ACCOUNT, day, [op(`api:today:test-${uniq()}`, day, 'out', 1240, { docNo: '620000000301', raw: raw('620000000301', 'GEL') })], t);
    expect(t).toMatchObject({ added: 1, known: { byCard: 0 } });
    await apiDay('bog', BOG_ACCOUNT, 'USD', day);
    const lari = await prisma.statementLine.findFirstOrThrow({ where: { statementId: (await apiDay('bog', BOG_ACCOUNT, 'GEL', day)).id } });
    const queue = json<{ lines: { id: string; duplicateOf: unknown }[] }>(await call(owner, 'GET', '/api/statement-lines?direction=out'));
    expect(queue.lines.find((l) => l.id === lari.id)).toMatchObject({ duplicateOf: null });
  });

  it('do not make a bank fresh on «Сегодня»', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    // No suite reads Credo: its card asks for a statement, and a line in dollars of today does not change that.
    const today = todayISO(new Date(), 'Asia/Tbilisi');
    const s = await prisma.statement.create({ data: { bank: 'credo', source: 'file', fileName: 'invented.csv', fileSha256: `test-${uniq()}`, currency: 'USD', periodFrom: asDate(today), periodTo: asDate(today) } });
    made.push(s.id);
    await prisma.statementLine.create({
      data: { statementId: s.id, bank: 'credo', currency: 'USD', naturalKey: `test-${uniq()}`, occurredOn: asDate(today), direction: 'in', amountTetri: 900, raw: 'invented', status: 'ignored', matchedRule: 'foreign', resolution: 'foreign' },
    });
    type Q = { queue: { rows: { id: string }[] }[] };
    const rows = json<Q>(await call(owner, 'GET', '/api/today')).queue.flatMap((g) => g.rows);
    expect(rows.map((r) => r.id)).toContain('bank:credo');
    const banks = json<{ banks: { bank: string; throughOn: string | null; never: boolean }[] }>(await call(owner, 'GET', '/api/statements')).banks;
    expect(banks.find((b) => b.bank === 'credo')).toMatchObject({ throughOn: null, never: true });
  });

  it('the migration runs a second time over what is stored without a word', async () => {
    const pg = (await import('pg')).default;
    const sql = await readFile(new URL('../migrations/0073_foreign_currency_accounts.sql', import.meta.url), 'utf8');
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  });
});

// «Операции в валюте» on «Выписки» (stage 3 of the plan): the lines of each
// account in another currency, read only, with what came in and went out in
// its own currency. The days are in 2098, which no other suite writes lines in.
describe.skipIf(!HAS_DB)('the accounts in another currency, shown apart on «Выписки»', () => {
  const made: string[] = [];
  afterAll(async () => {
    const { prisma } = await import('../src/lib/db.js');
    await prisma.statement.deleteMany({ where: { id: { in: made } } });
  });

  type Foreign = {
    from: string;
    to: string;
    accounts: { bank: string; last4: string | null; currency: string; inMinor: number; outMinor: number; lines: { occurredOn: string; direction: string; amountMinor: number; purpose: string | null }[] }[];
  };

  it('lists each account apart and sums it in its own currency: no currency is added to another, nor to the lari', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { keep, tally } = await import('../src/lib/statements/apiDays.js');
    const owner = await loginAs('owner');
    const key = () => `api:test:${uniq()}`;
    // One IBAN at Bank of Georgia in dollars, euros and lari, and a TBC account in dollars.
    await keep('bog', 'Business Online', BOG_ACCOUNT, '2098-02-10', [op(key(), '2098-02-10', 'in', 15000, { purpose: 'invented USD in' }), op(key(), '2098-02-10', 'out', 4000)], tally(), 'USD');
    await keep('bog', 'Business Online', BOG_ACCOUNT, '2098-02-11', [op(key(), '2098-02-11', 'in', 2050)], tally(), 'USD');
    await keep('bog', 'Business Online', BOG_ACCOUNT, '2098-02-12', [op(key(), '2098-02-12', 'in', 9900)], tally(), 'EUR');
    await keep('tbc', 'Business Integration Services', TBC_ACCOUNT, '2098-02-13', [op(key(), '2098-02-13', 'out', 1240)], tally(), 'USD');
    await keep('bog', 'Business Online', BOG_ACCOUNT, '2098-02-10', [op(key(), '2098-02-10', 'in', 77700)], tally());
    // A day of dollars after the month asked for.
    await keep('bog', 'Business Online', BOG_ACCOUNT, '2098-03-01', [op(key(), '2098-03-01', 'in', 50000)], tally(), 'USD');
    made.push(...(await prisma.statement.findMany({ where: { source: 'api', account: { in: [BOG_ACCOUNT, TBC_ACCOUNT] }, periodFrom: { gte: asDate('2098-01-01') } }, select: { id: true } })).map((s) => s.id));

    const res = await call(owner, 'GET', '/api/statement-lines/foreign?from=2098-02-01&to=2098-02-28');
    expect(res.statusCode, res.body).toBe(200);
    const page = json<Foreign>(res);
    expect(page).toMatchObject({ from: '2098-02-01', to: '2098-02-28' });
    expect(page.accounts.map((a) => [a.bank, a.last4, a.currency, a.inMinor, a.outMinor, a.lines.length])).toEqual([
      ['bog', '0005', 'EUR', 9900, 0, 1],
      ['bog', '0005', 'USD', 17050, 4000, 3],
      ['tbc', '0006', 'USD', 0, 1240, 1],
    ]);
    // Newest first, each sum in minor units of its own currency.
    const dollars = page.accounts[1]!.lines;
    expect(dollars.map((l) => l.occurredOn)).toEqual(['2098-02-11', '2098-02-10', '2098-02-10']);
    expect(dollars.map((l) => `${l.direction} ${l.amountMinor}`).sort()).toEqual(['in 15000', 'in 2050', 'out 4000']);
    expect(page.accounts[1]!.lines.map((l) => l.purpose)).toContain('invented USD in');
    // An account is said by its last four digits, never more.
    expect(res.body).not.toContain(BOG_ACCOUNT);
    expect(res.body).not.toContain(TBC_ACCOUNT);

    // The lari of the same IBAN and days: in the reports in lari, alone, and not in the block.
    const inc = json<{ totalInTetri: number }>(await call(owner, 'GET', '/api/reports/incoming?from=2098-02-01&to=2098-02-28'));
    expect(inc.totalInTetri).toBe(77700);
    const out = json<{ totalOutTetri: number }>(await call(owner, 'GET', '/api/reports/expenses?from=2098-02-01&to=2098-02-28'));
    expect(out.totalOutTetri).toBe(0);

    // «Выписки» knows there are lines in another currency, and says the currency of each day of them.
    const s = json<{ foreignLines: number; statements: { id: string; currency: string }[] }>(await call(owner, 'GET', '/api/statements'));
    expect(s.foreignLines).toBeGreaterThanOrEqual(6);
    const days = s.statements.filter((x) => made.includes(x.id));
    expect(days.map((x) => x.currency).sort()).toEqual(['EUR', 'GEL', 'USD', 'USD', 'USD', 'USD']);
  });

  it('reads this month unless asked, and refuses a period that ends before it starts', async () => {
    const { monthOf } = await import('@ev8/shared');
    const owner = await loginAs('owner');
    const month = monthOf(todayISO(new Date(), 'Asia/Tbilisi'));
    expect(json<Foreign>(await call(owner, 'GET', '/api/statement-lines/foreign'))).toMatchObject({ from: month.from, to: month.to });
    const bad = await call(owner, 'GET', '/api/statement-lines/foreign?from=2098-02-28&to=2098-02-01');
    expect(bad.statusCode).toBe(400);
    expect(err(bad)).toBe('bad_period');
  });
});
