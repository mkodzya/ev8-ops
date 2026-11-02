// Lines of an account in another currency (migration 0073; Mika's decision D1
// «А» of 29.10.2026, docs/spec/usd-accounts-plan.md), sorted by an owner since
// migration 0076 (stage 5, Mika 02.11.2026; decisions D2 and D3 of 01.11.2026).
// These suites put such lines in the way the bank's API does — by `keep` — and
// check that they wait for an owner untouched by any rule, are answered only
// as no customer's money, count in lari at the sum they were sorted at — the
// bank's or the owner's — and that 150 dollars are never 150 lari. Every
// account, sum, shop and number here is invented; the days are in 2097 and
// 2098, which no other suite writes lines in.
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

describe.skipIf(!HAS_DB)('lines in another currency, sorted by an owner at their lari (migration 0076)', () => {
  const made: string[] = [];
  afterAll(async () => {
    // The lines these suites write go with their statements, so no later suite meets them in the queue.
    const { prisma } = await import('../src/lib/db.js');
    await prisma.statement.deleteMany({ where: { id: { in: made } } });
  });

  async function apiDay(bank: 'bog' | 'tbc', account: string, currency: string, day: string) {
    const { prisma } = await import('../src/lib/db.js');
    const s = await prisma.statement.findFirstOrThrow({ where: { bank, source: 'api', account, currency, periodFrom: asDate(day) } });
    made.push(s.id);
    return s;
  }

  /** One line of a dollar account, kept as the bank's API keeps it; Bank of Georgia's carries its lari (invented, 2.6 to the dollar). */
  async function dollars(day: string, direction: 'in' | 'out', cents: number, more: Partial<ParsedLine> = {}, bank: 'bog' | 'tbc' = 'bog') {
    const { prisma } = await import('../src/lib/db.js');
    const { keep, tally } = await import('../src/lib/statements/apiDays.js');
    const key = bank === 'bog' ? `api:today:USD:test-${uniq()}` : `api:mv:0${String(Math.floor(Math.random() * 1e10)).padStart(11, '0')}.${direction === 'in' ? 2 : 1}`;
    const t = tally();
    await keep(bank, bank === 'bog' ? 'Business Online' : 'Business Integration Services', bank === 'bog' ? BOG_ACCOUNT : TBC_ACCOUNT, day, [op(key, day, direction, cents, { ...(bank === 'bog' ? { bankGelTetri: Math.round(cents * 2.6) } : {}), ...more })], t, 'USD');
    await apiDay(bank, bank === 'bog' ? BOG_ACCOUNT : TBC_ACCOUNT, 'USD', day);
    return { line: await prisma.statementLine.findFirstOrThrow({ where: { naturalKey: key } }), t };
  }

  async function category(owner: string, kind: 'expense' | 'income'): Promise<string> {
    const made = await call(owner, 'POST', `/api/${kind}-categories`, { nameRu: `ТЕСТ ${kind} ${uniq()}`, nameKa: 'სატესტო', nameEn: 'Test' });
    expect(made.statusCode, made.body).toBeLessThan(300);
    return json<{ id: string }>(made).id;
  }

  type Queue = { lines: { id: string; group: string; currency: string; bankGelTetri?: number | null; suggestions: unknown[] }[] };

  it('wait in the queue for an owner, untouched by any rule; a manager sees neither them nor their number', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const manager = await loginAs('manager');
    const { line, t } = await dollars('2097-03-10', 'in', 15000, { payer: 'Invented Payer', purpose: 'invented rent' });
    expect(t).toMatchObject({ added: 1, recorded: 0, matched: 0 });
    expect(line).toMatchObject({ currency: 'USD', status: 'unmatched', resolution: null, matchedRule: null, paymentId: null, gelTetri: null, bankGelTetri: 39000 });

    // An owner: in a group of its own, its currency and the bank's lari, no hint of rent.
    const mine = json<Queue>(await call(owner, 'GET', '/api/statement-lines?direction=in')).lines.find((l) => l.id === line.id);
    expect(mine).toMatchObject({ group: 'foreign', currency: 'USD', bankGelTetri: 39000, suggestions: [] });
    // A manager: not in his queue, not in his count.
    const his = await call(manager, 'GET', '/api/statement-lines?direction=in');
    expect(json<Queue>(his).lines.map((l) => l.id)).not.toContain(line.id);
    const lari = await prisma.statementLine.count({ where: { status: 'unmatched', direction: 'in', currency: 'GEL' } });
    expect(json<{ counts: { in: number } }>(his).counts.in).toBe(lari);
    expect(json<{ sort: { in: number } }>(await call(manager, 'GET', '/api/nav/counts')).sort.in).toBe(lari);
  });

  it('are an expense at the bank’s lari or the owner’s, the reports count that lari, and «Вернуть в очередь» undoes it', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const day = '2097-03-11';
    const cat = await category(owner, 'expense');
    const a = (await dollars(day, 'out', 4000)).line;
    const b = (await dollars(day, 'out', 1000)).line;
    const c = (await dollars(day, 'out', 2500)).line;
    // A remembered payee is no answer for dollars: nothing is remembered, and nothing else is sorted.
    const ok = await call(owner, 'POST', `/api/statement-lines/${a.id}/expense`, { categoryId: cat, remember: true });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(json<{ ruleId: string | null; alsoSorted: string[] }>(ok)).toMatchObject({ ruleId: null, alsoSorted: [] });
    expect(await prisma.statementLine.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ status: 'ignored', resolution: 'company_expense', expenseCategoryId: cat, gelTetri: 10400 });
    // The owner's correction is what it counts at.
    expect((await call(owner, 'POST', `/api/statement-lines/${b.id}/expense`, { categoryId: cat, gelTetri: '27.00' })).statusCode).toBe(200);
    expect((await prisma.statementLine.findUniqueOrThrow({ where: { id: b.id } })).gelTetri).toBe(2700);

    type Out = { categories: { categoryId: string; tetri: number; lines: number }[]; unsorted: number; totalOutTetri: number; foreign: { currency: string; sortedMinor: number; sortedGelTetri: number; waitingMinor: number; waitingLines: number }[] };
    const report = json<Out>(await call(owner, 'GET', `/api/reports/expenses?from=${day}&to=${day}`));
    expect(report.categories).toEqual([{ categoryId: cat, tetri: 13100, lines: 2 }]);
    // The line still waiting is in no sum in lari: the day has nothing else.
    expect(report).toMatchObject({ unsorted: 0, totalOutTetri: 13100, foreign: [{ currency: 'USD', sortedMinor: 5000, sortedGelTetri: 13100, waitingMinor: 2500, waitingLines: 1 }] });
    expect(c.status).toBe('unmatched');

    // Put back, it waits again and counts at nothing.
    expect((await call(owner, 'POST', `/api/statement-lines/${a.id}/restore`, {})).statusCode).toBe(200);
    expect(await prisma.statementLine.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ status: 'unmatched', resolution: null, gelTetri: null, expenseCategoryId: null });
    // And «Отменить» right after «Записать» does the same.
    expect((await call(owner, 'POST', `/api/statement-lines/${b.id}/expense-undo`, {})).statusCode).toBe(200);
    expect(await prisma.statementLine.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ status: 'unmatched', gelTetri: null });
    expect(json<Out>(await call(owner, 'GET', `/api/reports/expenses?from=${day}&to=${day}`))).toMatchObject({ totalOutTetri: 0, foreign: [{ waitingMinor: 7500, waitingLines: 3, sortedMinor: 0 }] });
  });

  it('pay no rent, deposit, sale or cash to the bank, and are no split', async () => {
    const owner = await loginAs('owner');
    const day = '2097-03-12';
    const incoming = (await dollars(day, 'in', 18000)).line;
    const out = (await dollars(day, 'out', 18000)).line;
    const refused = async (path: string, body: unknown) => {
      const res = await call(owner, 'POST', `/api/statement-lines/${path}`, body);
      expect(res.statusCode, `${path} ${res.body}`).toBe(409);
      expect(err(res)).toBe('foreign_line');
    };
    await refused(`${incoming.id}/assign`, { customerId: '00000000-0000-4000-8000-000000000000' });
    await refused(`${incoming.id}/split`, { parts: [9000, 9000].map((grossTetri, i) => ({ grossTetri, customerId: `00000000-0000-4000-8000-00000000000${i}` })) });
    await refused(`${incoming.id}/bank-deposit`, {});
    await refused(`${out.id}/pay-out`, { kind: 'deposit_payout', rentalId: '00000000-0000-4000-8000-000000000000' });
    await refused(`${out.id}/expense-split`, { parts: [{ amountTetri: 9000, categoryId: 'a' }, { amountTetri: 9000, categoryId: 'b' }] });
    const { prisma } = await import('../src/lib/db.js');
    expect(await prisma.statementLine.count({ where: { id: { in: [incoming.id, out.id] }, status: 'unmatched' } })).toBe(2);
    expect(await prisma.bankCashDeposit.count({ where: { amountTetri: 18000, occurredOn: asDate(day) } })).toBe(0);
  });

  it('with no lari from the bank — TBC — are sorted only with the owner’s sum', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const { line } = await dollars('2097-03-13', 'out', 3300, {}, 'tbc');
    expect(line.bankGelTetri).toBeNull();
    const none = await call(owner, 'POST', `/api/statement-lines/${line.id}/own-transfer`, {});
    expect(none.statusCode).toBe(400);
    expect(err(none)).toBe('gel_needed');
    expect((await call(owner, 'POST', `/api/statement-lines/${line.id}/own-transfer`, { gelTetri: 8600 })).statusCode).toBe(200);
    expect(await prisma.statementLine.findUniqueOrThrow({ where: { id: line.id } })).toMatchObject({ resolution: 'own_transfer', gelTetri: 8600 });
    // Set aside as nobody's money it needs no lari.
    const other = (await dollars('2097-03-13', 'out', 100, {}, 'tbc')).line;
    expect((await call(owner, 'POST', `/api/statement-lines/${other.id}/ignore`, { reason: 'invented' })).statusCode).toBe(200);
    expect(await prisma.statementLine.findUniqueOrThrow({ where: { id: other.id } })).toMatchObject({ resolution: 'not_ours', gelTetri: null });
  });

  it('pay a supplier at their lari, and the payment keeps the dollars beside them', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const day = '2097-03-14';
    const supplier = await prisma.customer.create({ data: { name: `ТЕСТ Поставщик ${uniq()}`, recordKind: 'supplier' } });
    const po = json<{ id: string }>(await call(owner, 'POST', '/api/purchases', { supplierId: supplier.id, currency: 'USD', orderedOn: day }));
    const { line } = await dollars(day, 'out', 50000);
    const paid = await call(owner, 'POST', `/api/statement-lines/${line.id}/pay-out`, { kind: 'supplier', purchaseId: po.id });
    expect(paid.statusCode, paid.body).toBe(200);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: json<{ id: string }>(paid).id } });
    expect(payment).toMatchObject({ kind: 'supplier', grossTetri: 130000, foreignMinor: 50000n, foreignCurrency: 'USD', statementLineId: line.id });
    expect(await prisma.statementLine.findUniqueOrThrow({ where: { id: line.id } })).toMatchObject({ status: 'matched', gelTetri: 130000 });
    expect(json<{ suppliers: number }>(await call(owner, 'GET', `/api/reports/expenses?from=${day}&to=${day}`)).suppliers).toBe(130000);
    // Annulled, the line waits again, at no lari.
    expect((await call(owner, 'POST', `/api/payments/${payment.id}/undo`, {})).statusCode).toBe(200);
    expect(await prisma.statementLine.findUniqueOrThrow({ where: { id: line.id } })).toMatchObject({ status: 'unmatched', gelTetri: null });
  });

  it('are an exchange, a founder’s money or other income, each in its row at the lari', async () => {
    const owner = await loginAs('owner');
    const day = '2097-03-15';
    const cat = await category(owner, 'income');
    const sold = (await dollars(day, 'out', 10000)).line;
    const bought = (await dollars(day, 'in', 20000)).line;
    const founder = (await dollars(day, 'in', 1000)).line;
    const other = (await dollars(day, 'in', 500)).line;
    for (const [path, body] of [[`${sold.id}/fx-exchange`, {}], [`${bought.id}/fx-exchange`, { gelTetri: '519.00' }], [`${founder.id}/founder-equity`, {}], [`${other.id}/other-income`, { categoryId: cat, remember: true }]] as const) {
      const res = await call(owner, 'POST', `/api/statement-lines/${path}`, body);
      expect(res.statusCode, `${path} ${res.body}`).toBe(200);
    }
    expect(json<{ fxExchange: number; totalOutTetri: number }>(await call(owner, 'GET', `/api/reports/expenses?from=${day}&to=${day}`))).toMatchObject({ fxExchange: 26000, totalOutTetri: 26000 });
    const inc = json<{ fxExchange: number; founder: number; categories: { categoryId: string; tetri: number }[]; totalInTetri: number }>(await call(owner, 'GET', `/api/reports/incoming?from=${day}&to=${day}`));
    expect(inc).toMatchObject({ fxExchange: 51900, founder: 2600, totalInTetri: 51900 + 2600 + 1300 });
    expect(inc.categories).toEqual([{ categoryId: cat, tetri: 1300, lines: 1 }]);
  });

  it('the database holds a sorted line in another currency to its lari, and a line in lari to none', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { line } = await dollars('2097-03-16', 'out', 700);
    await expect(prisma.statementLine.update({ where: { id: line.id }, data: { status: 'ignored', resolution: 'company_expense' } })).rejects.toThrow();
    await expect(prisma.statementLine.update({ where: { id: line.id }, data: { status: 'matched', matchedRule: 'by_hand' } })).rejects.toThrow();
    await prisma.statementLine.update({ where: { id: line.id }, data: { status: 'ignored', resolution: 'not_ours' } });
    const gel = await prisma.statement.create({ data: { bank: 'bog', source: 'api', fileName: 'Business Online', fileSha256: 'api', account: BOG_ACCOUNT, periodFrom: asDate('2097-03-16'), periodTo: asDate('2097-03-16') } });
    made.push(gel.id);
    const lari = { statementId: gel.id, bank: 'bog' as const, occurredOn: asDate('2097-03-16'), direction: 'in' as const, amountTetri: 100, raw: 'invented' };
    await expect(prisma.statementLine.create({ data: { ...lari, naturalKey: `api:today:test-${uniq()}`, status: 'ignored', resolution: 'foreign' } })).rejects.toThrow();
    await expect(prisma.statementLine.create({ data: { ...lari, naturalKey: `api:today:test-${uniq()}`, gelTetri: 100 } })).rejects.toThrow();
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
    expect(await prisma.statementLine.findFirstOrThrow({ where: { statementId: usd.id } })).toMatchObject({ currency: 'USD', status: 'unmatched', resolution: null, amountTetri: 4000 });
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
      data: { statementId: s.id, bank: 'credo', currency: 'USD', naturalKey: `test-${uniq()}`, occurredOn: asDate(today), direction: 'in', amountTetri: 900, raw: 'invented', status: 'unmatched' },
    });
    type Q = { queue: { rows: { id: string }[] }[] };
    const rows = json<Q>(await call(owner, 'GET', '/api/today')).queue.flatMap((g) => g.rows);
    expect(rows.map((r) => r.id)).toContain('bank:credo');
    const banks = json<{ banks: { bank: string; throughOn: string | null; never: boolean }[] }>(await call(owner, 'GET', '/api/statements')).banks;
    expect(banks.find((b) => b.bank === 'credo')).toMatchObject({ throughOn: null, never: true });
  });

  it('the migration runs a second time over what is stored without a word', async () => {
    const pg = (await import('pg')).default;
    const sql = await readFile(new URL('../migrations/0076_foreign_lines_sorted.sql', import.meta.url), 'utf8');
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
    accounts: { bank: string; last4: string | null; currency: string; inMinor: number; outMinor: number; lines: { occurredOn: string; direction: string; amountMinor: number; bankGelTetri: number | null; repeats?: { occurredOn: string }; purpose: string | null }[] }[];
  };

  it('lists each account apart and sums it in its own currency: no currency is added to another, nor to the lari', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { keep, tally } = await import('../src/lib/statements/apiDays.js');
    const owner = await loginAs('owner');
    const key = () => `api:test:${uniq()}`;
    // One IBAN at Bank of Georgia in dollars, euros and lari, and a TBC account in dollars.
    // Bank of Georgia sends its own lari for a line in dollars; the invented ones here are 2.6 to the dollar.
    await keep('bog', 'Business Online', BOG_ACCOUNT, '2098-02-10', [op(key(), '2098-02-10', 'in', 15000, { purpose: 'invented USD in', bankGelTetri: 39000 }), op(key(), '2098-02-10', 'out', 4000, { bankGelTetri: 10400 })], tally(), 'USD');
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
    // Each line carries the bank's lari for it, or null when the bank sent none; no total sums them.
    expect(dollars.map((l) => `${l.amountMinor} ${l.bankGelTetri}`).sort()).toEqual(['15000 39000', '2050 null', '4000 10400']);
    expect(page.accounts[2]!.lines.map((l) => l.bankGelTetri)).toEqual([null]);
    expect(Object.keys(page.accounts[1]!).sort()).toEqual(['bank', 'currency', 'inMinor', 'last4', 'lines', 'outMinor']);
    // An account is said by its last four digits, never more.
    expect(res.body).not.toContain(BOG_ACCOUNT);
    expect(res.body).not.toContain(TBC_ACCOUNT);

    // The lari of the same IBAN and days: in the reports in lari, alone, and not in the block.
    const inc = json<{ totalInTetri: number }>(await call(owner, 'GET', '/api/reports/incoming?from=2098-02-01&to=2098-02-28'));
    expect(inc.totalInTetri).toBe(77700);
    const out = json<{ totalOutTetri: number }>(await call(owner, 'GET', '/api/reports/expenses?from=2098-02-01&to=2098-02-28'));
    expect(out.totalOutTetri).toBe(0);

    // «Выписки» knows there are lines in another currency, and says the currency of each day of them.
    const s = json<{ foreignLines: number; foreignLastOn: string | null; statements: { id: string; currency: string }[] }>(await call(owner, 'GET', '/api/statements'));
    expect(s.foreignLines).toBeGreaterThanOrEqual(6);
    // And the day of the newest of them, which the block opens on the month of.
    expect(s.foreignLastOn! >= '2098-03-01').toBe(true);
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

  it('keeps a card payment the bank sends twice out, and shows one that got in before beside the line it repeats, in no sum', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { keep, tally } = await import('../src/lib/statements/apiDays.js');
    const owner = await loginAs('owner');
    // A payment abroad as the bank lists it (01.11.2026): first with the minute it was
    // paid, then posted with its day alone under a number of four digits. Shop, sum,
    // card and numbers are invented.
    const words = (at: string, shop: string) => `გადახდა - თანხა: USD25.00; ობიექტი: ${shop}; MCC:7311; თარიღი: ${at}; ბარათის No: ****0000`;
    const line = (day: string, doc: string, at: string, shop: string) =>
      op(`api:test:${uniq()}`, day, 'out', 2500, { docNo: doc, bankGelTetri: 6500, raw: [day.split('-').reverse().join('.'), doc, '', '25.00', '', words(at, shop)].join(' | ') });
    const first = line('2098-04-30', '11000000001', '30/04/2098 00:51', 'EXAMPLE ADS>DUBLIN IE, Ireland');
    const posted = line('2098-05-01', '4444', '30/04/2098 00:00', 'EXAMPLE ADS, Ireland');
    await keep('bog', 'Business Online', BOG_ACCOUNT, '2098-04-30', [first], tally(), 'USD');
    await keep('bog', 'Business Online', BOG_ACCOUNT, '2098-05-01', [posted], tally(), 'USD');
    made.push(...(await prisma.statement.findMany({ where: { source: 'api', account: BOG_ACCOUNT, periodFrom: { gte: asDate('2098-04-01'), lte: asDate('2098-05-31') } }, select: { id: true } })).map((s) => s.id));
    // Rule 5: the posting is the payment already in, and is not added.
    expect(await prisma.statementLine.count({ where: { naturalKey: posted.naturalKey } })).toBe(0);

    // As the posting of 01.11.2026 did before the rule knew a day alone: it is in.
    const kept = await prisma.statementLine.findFirstOrThrow({ where: { naturalKey: first.naturalKey } });
    await prisma.statementLine.create({ data: { statementId: kept.statementId, bank: 'bog', naturalKey: posted.naturalKey, docNo: '4444', occurredOn: asDate('2098-05-01'), direction: 'out', currency: 'USD', amountTetri: 2500, bankGelTetri: 6500, raw: posted.raw, status: 'ignored', resolution: 'foreign' } });
    // The month of the repeat shows it beside the day it repeats, and sums nothing of it.
    const may = json<Foreign>(await call(owner, 'GET', '/api/statement-lines/foreign?from=2098-05-01&to=2098-05-31')).accounts.find((a) => a.currency === 'USD')!;
    expect(may.lines.map((l) => [l.amountMinor, l.repeats?.occurredOn ?? null])).toEqual([[2500, '2098-04-30']]);
    expect(may.outMinor).toBe(0);
    // The month of the first listing counts it once.
    const april = json<Foreign>(await call(owner, 'GET', '/api/statement-lines/foreign?from=2098-04-01&to=2098-04-30')).accounts.find((a) => a.currency === 'USD')!;
    expect(april.outMinor).toBe(2500);
    expect(april.lines.map((l) => l.repeats ?? null)).toEqual([null]);
  });
});
