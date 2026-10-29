// A manager in «Разобрать» and «Оплаты по графику» (issue #15 of the director,
// 25.10.2026; Mika's «начинай» the same day; ADR-0048). He sorts the customers'
// money coming in — a rental, a deposit, a moped sale, goods, a repair, and
// «Несколько услуг» of those — and calls those who pay by the schedule. Every
// other answer of the queue, letting go of somebody else's link, and the
// week's and month's sums stay the owners', and the server says so for each.
//
// The suites share one database and the real clock: every assertion is about
// this suite's own made-up rentals and lines, or about the shape of an answer,
// never about a total other suites move. The bank lines are written straight
// into the queue with a purpose no rule reads, as the pull leaves them.
import { todayISO } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { HAS_DB, byHand, call, json, login, loginAs, makeUser, uniq } from './helpers.js';

const today = () => todayISO();
const digits = () => uniq().replace(/\D/g, '');
const err = (res: { body: string }) => json<{ error: string; permission?: string }>(res);

/** A made-up renter with a rental handed over today: its deposit and its first week still owed. */
async function rental() {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Manager sort ${uniq()}`, forRent: true } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TESTMS${digits().slice(-11).padStart(11, '0')}`, modelId: model.id } });
  const customer = await prisma.customer.create({ data: { name: `Test Manager Sort ${uniq()}` } });
  const owner = await loginAs('owner');
  const res = await call(owner, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, pickedUpOn: today() });
  if (res.statusCode !== 201) throw new Error(res.body);
  return { prisma, owner, customer, rentalId: json<{ id: string }>(res).id };
}

/** A bank line in the queue, today, in or out. */
async function bankLine(amountTetri: number, direction: 'in' | 'out' = 'in') {
  const { prisma } = await import('../src/lib/db.js');
  const statement = await prisma.statement.create({ data: { bank: 'tbc', fileName: `Test manager sort ${uniq()}`, fileSha256: `test-${uniq()}`, source: 'api' } });
  return prisma.statementLine.create({
    data: {
      statementId: statement.id,
      bank: 'tbc',
      naturalKey: `manager-sort-${uniq()}`,
      occurredOn: new Date(`${today()}T00:00:00Z`),
      direction,
      amountTetri,
      purpose: 'test transfer',
      raw: `Test transfer ${uniq()}`,
    },
  });
}

async function manager() {
  const u = await makeUser('manager');
  return { id: u.id, cookie: await login(u.email) };
}

describe.skipIf(!HAS_DB)('«Разобрать» for a manager: the customers’ money coming in (issue #15)', () => {
  it('answers him the lines coming in and none of the owners’ counts; going out is refused in words', async () => {
    const m = await manager();
    await bankLine(1111, 'in');
    await bankLine(2222, 'out');
    const res = await call(m.cookie, 'GET', '/api/statement-lines');
    expect(res.statusCode, res.body).toBe(200);
    const q = json<{ counts: { in: number; out: number | null }; byRulesWeek: number | null; asideMonth: number | null; lines: { direction: string }[] }>(res);
    expect(q.lines.every((l) => l.direction === 'in')).toBe(true);
    expect(q.counts.out).toBeNull();
    expect(q.byRulesWeek).toBeNull();
    expect(q.asideMonth).toBeNull();
    const out = await call(m.cookie, 'GET', '/api/statement-lines?direction=out');
    expect(out.statusCode).toBe(403);
    expect(err(out).error).toBe('sort_owner_only');
    // The owner's answer is as it was.
    const owner = json<{ counts: { out: number | null }; byRulesWeek: number | null }>(await call(await loginAs('owner'), 'GET', '/api/statement-lines'));
    expect(typeof owner.counts.out).toBe('number');
    expect(typeof owner.byRulesWeek).toBe('number');
  });

  it('links a line to a rental; the payment is his, and he may let go of it himself', async () => {
    const r = await rental();
    const m = await manager();
    const line = await bankLine(18000);
    const res = await call(m.cookie, 'POST', `/api/statement-lines/${line.id}/assign`, { rentalId: r.rentalId });
    expect(res.statusCode, res.body).toBe(200);
    const paymentId = json<{ id: string }>(res).id;
    expect(await r.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).toMatchObject({ createdById: m.id, source: 'statement', rentalId: r.rentalId });
    // His payment's page offers «Отвязать»; an owner's offers «Аннулировать» instead.
    expect(json<{ canUnlink: boolean }>(await call(m.cookie, 'GET', `/api/payments/${paymentId}`)).canUnlink).toBe(true);
    expect(json<{ canUnlink: boolean; canVoid: boolean }>(await call(r.owner, 'GET', `/api/payments/${paymentId}`))).toMatchObject({ canUnlink: false, canVoid: true });
    expect((await call(m.cookie, 'POST', `/api/statement-lines/${line.id}/unlink`)).statusCode).toBe(200);
    expect((await r.prisma.statementLine.findUniqueOrThrow({ where: { id: line.id } })).status).toBe('unmatched');
    expect((await r.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).voidedAt).not.toBeNull();
  });

  it('does not let go of a link somebody else made', async () => {
    const r = await rental();
    const m = await manager();
    const line = await bankLine(18000);
    const owners = await call(r.owner, 'POST', `/api/statement-lines/${line.id}/assign`, { rentalId: r.rentalId });
    expect(owners.statusCode, owners.body).toBe(200);
    const res = await call(m.cookie, 'POST', `/api/statement-lines/${line.id}/unlink`);
    expect(res.statusCode).toBe(403);
    expect(err(res).error).toBe('sort_owner_only');
    expect((await r.prisma.statementLine.findUniqueOrThrow({ where: { id: line.id } })).status).toBe('matched');
    // Nor does he open the owner's payment: «Мои платежи» are his own.
    expect((await call(m.cookie, 'GET', `/api/payments/${json<{ id: string }>(owners).id}`)).statusCode).toBe(403);
  });

  it('spreads a line over a deposit and rent, and is refused an advance, a new fine or a remembered payer', async () => {
    const r = await rental();
    const m = await manager();
    const line = await bankLine(25000);
    const refused = async (path: string, body: unknown) => {
      const res = await call(m.cookie, 'POST', `/api/statement-lines/${line.id}/${path}`, body);
      expect(res.statusCode, `${path} ${JSON.stringify(body)}`).toBe(403);
      expect(err(res).error).toBe('sort_owner_only');
    };
    await refused('assign', { customerId: r.customer.id });
    await refused('assign', { rentalId: r.rentalId, remember: true });
    await refused('split', { parts: [{ rentalId: r.rentalId, grossTetri: 15000 }, { customerId: r.customer.id, grossTetri: 10000 }] });
    await refused('split', { parts: [{ rentalId: r.rentalId, grossTetri: 15000 }, { fineRentalId: r.rentalId, fineReason: 'test: invented', grossTetri: 10000 }] });
    expect((await r.prisma.statementLine.findUniqueOrThrow({ where: { id: line.id } })).status).toBe('unmatched');
    expect(await r.prisma.payment.count({ where: { statementLineId: line.id } })).toBe(0);

    const ok = await call(m.cookie, 'POST', `/api/statement-lines/${line.id}/split`, { parts: [{ depositRentalId: r.rentalId, grossTetri: 18000 }, { rentalId: r.rentalId, rentOnly: true, grossTetri: 7000 }] });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(json<{ ids: string[] }>(ok).ids).toHaveLength(2);
  });

  it('opens the panel of the customers’ kinds only', async () => {
    const m = await manager();
    const line = await bankLine(3333);
    for (const kind of ['rental', 'deposit', 'sale', 'goods', 'repair']) {
      expect((await call(m.cookie, 'GET', `/api/statement-lines/${line.id}/options?kind=${kind}`)).statusCode, kind).toBe(200);
    }
    for (const kind of ['customer', 'bank_deposit']) {
      const res = await call(m.cookie, 'GET', `/api/statement-lines/${line.id}/options?kind=${kind}`);
      expect(res.statusCode, kind).toBe(403);
      expect(err(res).error).toBe('sort_owner_only');
    }
  });

  it('links a line to rent entered by hand, not to an advance', async () => {
    const r = await rental();
    const m = await manager();
    // Odd sums, so no other suite's line is the same money.
    const rent = json<{ id: string }>(await call(r.owner, 'POST', '/api/payments', { rentalId: r.rentalId, channel: 'cash', grossTetri: 4321 }));
    const advance = json<{ id: string }>(await call(r.owner, 'POST', '/api/payments', { customerId: r.customer.id, channel: 'cash', grossTetri: 4322 }));
    expect(rent.id && advance.id).toBeTruthy();
    const one = await bankLine(4321);
    const two = await bankLine(4322);
    const refused = await call(m.cookie, 'POST', `/api/statement-lines/${two.id}/link`, { paymentId: advance.id });
    expect(refused.statusCode).toBe(403);
    expect(err(refused).error).toBe('sort_owner_only');
    const linked = await call(m.cookie, 'POST', `/api/statement-lines/${one.id}/link`, { paymentId: rent.id });
    expect(linked.statusCode, linked.body).toBe(200);
  });

  it('says under «Похоже, уже записан» what the money entered by hand was, so he is offered only what he may link (QA of #15)', async () => {
    const r = await rental();
    const m = await manager();
    // By transfer, not in cash: cash never reaches a bank, so no line is ever offered as it. Odd sums, the suite's own.
    const rent = await byHand(r.owner, '/api/payments', { rentalId: r.rentalId, channel: 'transfer', grossTetri: 4383 });
    const advance = await byHand(r.owner, '/api/payments', { customerId: r.customer.id, channel: 'transfer', grossTetri: 4384 });
    expect([rent.statusCode, advance.statusCode], `${rent.body} ${advance.body}`).toEqual([201, 201]);
    const one = await bankLine(4383);
    const two = await bankLine(4384);
    type Queue = { lines: { id: string; group: string; recorded: { id: string; kind: string; paymentKind?: string }[] }[] };
    const q = json<Queue>(await call(m.cookie, 'GET', '/api/statement-lines'));
    const candidate = (lineId: string, paymentId: string) => q.lines.find((l) => l.id === lineId)?.recorded.find((p) => p.id === paymentId);
    expect(candidate(one.id, json<{ id: string }>(rent).id)).toMatchObject({ kind: 'payment', paymentKind: 'rent' });
    expect(candidate(two.id, json<{ id: string }>(advance).id)).toMatchObject({ kind: 'payment', paymentKind: 'on_account' });
    // The screen asks the server's own rule of that kind: the advance stays the owners' to link.
    const refused = await call(m.cookie, 'POST', `/api/statement-lines/${two.id}/link`, { paymentId: json<{ id: string }>(advance).id });
    expect(refused.statusCode).toBe(403);
    expect(err(refused).error).toBe('sort_owner_only');
  });

  it('refuses him every answer that is not the customers’ money, by its scope, and writes nothing', async () => {
    const m = await manager();
    const inLine = await bankLine(5555, 'in');
    const outLine = await bankLine(6666, 'out');
    const { prisma } = await import('../src/lib/db.js');
    const asks: [string, string, unknown?][] = [
      ['POST', `/api/statement-lines/${inLine.id}/ignore`, { reason: 'test' }],
      ['POST', `/api/statement-lines/${inLine.id}/own-transfer`, {}],
      ['POST', `/api/statement-lines/${inLine.id}/founder-equity`, {}],
      ['POST', `/api/statement-lines/${inLine.id}/other-income`, { categoryId: 'none' }],
      ['POST', `/api/statement-lines/${inLine.id}/bank-deposit`, {}],
      ['POST', `/api/statement-lines/${inLine.id}/restore`],
      ['POST', `/api/statement-lines/${outLine.id}/expense`, {}],
      ['POST', `/api/statement-lines/${outLine.id}/expense-split`, { parts: [] }],
      ['POST', `/api/statement-lines/${outLine.id}/shareholder`],
      ['POST', `/api/statement-lines/${outLine.id}/pay-out`, { kind: 'supplier', purchaseId: 'none' }],
      ['GET', '/api/statement-lines/by-rules'],
      ['GET', '/api/statement-lines/aside'],
      // The lines of the accounts in another currency, and their sums, are an owner's to see.
      ['GET', '/api/statement-lines/foreign'],
      ['GET', '/api/statements'],
      ['GET', '/api/income-categories'],
      ['POST', '/api/payer-rules/none/forget'],
    ];
    for (const [method, url, body] of asks) {
      const res = await call(m.cookie, method as 'GET' | 'POST', url, body);
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect(err(res), `${method} ${url}`).toMatchObject({ error: 'forbidden', permission: 'payments.reconcile' });
    }
    for (const id of [inLine.id, outLine.id]) expect((await prisma.statementLine.findUniqueOrThrow({ where: { id } })).status).toBe('unmatched');
  });

  it('keeps a mechanic out of the queue altogether', async () => {
    const mechanic = await loginAs('mechanic');
    const res = await call(mechanic, 'GET', '/api/statement-lines');
    expect(res.statusCode).toBe(403);
    expect(err(res).permission).toBe('payments.sort.customer');
  });
});

describe.skipIf(!HAS_DB)('«Оплаты по графику» for a manager: the rows, never the sums (issue #15)', () => {
  it('sends no week, month or day total, nothing received and no debt of everybody — each row keeps its own', async () => {
    await rental();
    const m = await manager();
    const res = await call(m.cookie, 'GET', '/api/money/calendar');
    expect(res.statusCode, res.body).toBe(200);
    const a = json<{ totals: boolean; weeks: object[]; days: { due: object }[]; late: object; entries: { amountTetri: number; leftTetri: number }[] }>(res);
    expect(a.totals).toBe(false);
    for (const w of a.weeks) expect(Object.keys(w).sort()).toEqual(['from', 'to']);
    for (const d of a.days) expect(Object.keys(d.due)).toEqual(['count']);
    expect(Object.keys(a.late).sort()).toEqual(['count', 'rentals']);
    // `expected` is a state's name in each day's counts too; the week's figure of that name is gone with the week.
    for (const key of ['receivedTetri', 'thisWeekTetri', 'earlierTetri', 'heaviest', 'paidAhead', 'upcoming', 'partTetri']) expect(res.body, key).not.toContain(key);
    // The rows: who owes what and when.
    expect(a.entries.every((e) => typeof e.amountTetri === 'number' && typeof e.leftTetri === 'number')).toBe(true);

    // An owner's answer has them all.
    const owner = json<{ totals: boolean; weeks: { expected: unknown; receivedTetri: number }[]; late: { debtTetri: number } }>(await call(await loginAs('owner'), 'GET', '/api/money/calendar'));
    expect(owner.totals).toBe(true);
    expect(owner.weeks[0]).toHaveProperty('expected');
    expect(owner.weeks[0]).toHaveProperty('receivedTetri');
    expect(owner.late).toHaveProperty('debtTetri');
  });

  it('counts for the menu what each person has: the schedule and his lines for a manager, the till and the lines going out for an owner', async () => {
    const m = await manager();
    const mine = json<{ schedule: { late: number; dueToday: number } | null; sort: { in: number; out: number | null } | null; till: number | null }>(await call(m.cookie, 'GET', '/api/nav/counts'));
    expect(typeof mine.schedule?.late).toBe('number');
    expect(typeof mine.schedule?.dueToday).toBe('number');
    expect(typeof mine.sort?.in).toBe('number');
    expect(mine.sort?.out).toBeNull();
    expect(mine.till).toBeNull();
    const owner = json<{ sort: { out: number | null } | null; till: number | null }>(await call(await loginAs('owner'), 'GET', '/api/nav/counts'));
    expect(typeof owner.sort?.out).toBe('number');
    expect(typeof owner.till).toBe('number');
    // A mechanic has none of these sections: since issue #18 A (ADR-0050) the answer counts his tasks alone.
    const mechanic = json<{ schedule: unknown; sort: unknown; till: unknown; todos: { late: number; today: number } | null }>(await call(await loginAs('mechanic'), 'GET', '/api/nav/counts'));
    expect(mechanic).toMatchObject({ schedule: null, sort: null, till: null, todos: { late: 0, today: 0 } });
  });
});
