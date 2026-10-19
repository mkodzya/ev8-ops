// One outgoing line as several expenses (ADR-0030). Every line here is made up.
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

const err = (res: { body: string }) => json<{ error: string }>(res).error;

describe.skipIf(!HAS_DB)('an outgoing line split into expenses (ADR-0030)', () => {
  it('parts with their categories that make the whole line; counted by category; put back whole', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const cats = json<{ categories: { id: string; nameRu: string; archived: boolean }[] }>(await call(owner, 'GET', '/api/expense-categories')).categories.filter((c) => !c.archived);
    const [a, b] = cats;
    const stmt = await prisma.statement.create({ data: { bank: 'tbc', fileName: `test-${uniq()}.csv`, fileSha256: uniq() } });
    // A month no other suite writes lines in, so the report's sums are this test's alone.
    const day = new Date('2034-02-06T00:00:00Z');
    const mk = (direction: 'in' | 'out') =>
      prisma.statementLine.create({ data: { statementId: stmt.id, bank: 'tbc', naturalKey: `test-${uniq()}`, occurredOn: day, direction, amountTetri: 50000, raw: 'test line', status: 'unmatched' } });
    const out = await mk('out');
    const back = await mk('in');
    const split = (id: string, parts: unknown) => call(owner, 'POST', `/api/statement-lines/${id}/expense-split`, { parts });

    expect(err(await split(out.id, [{ categoryId: a.id, amountTetri: 50000 }]))).toBe('split_needs_two');
    expect(err(await split(out.id, [{ categoryId: a.id, amountTetri: 30000 }, { categoryId: b.id, amountTetri: 10000 }]))).toBe('split_sum');
    expect(err(await split(out.id, [{ categoryId: a.id, amountTetri: 30000 }, { categoryId: a.id, amountTetri: 20000 }]))).toBe('split_same_target');
    expect(err(await split(back.id, [{ categoryId: a.id, amountTetri: 30000 }, { categoryId: b.id, amountTetri: 20000 }]))).toBe('incoming_line');
    const manager = await loginAs('manager');
    expect((await call(manager, 'POST', `/api/statement-lines/${out.id}/expense-split`, { parts: [] })).statusCode).toBe(403);

    const ok = await split(out.id, [{ categoryId: a.id, amountTetri: 30000 }, { categoryId: b.id, amountTetri: '200' }]);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await prisma.statementLine.findUniqueOrThrow({ where: { id: out.id } })).toMatchObject({ status: 'ignored', resolution: 'company_expense', expenseCategoryId: null });
    expect((await prisma.statementLineExpensePart.findMany({ where: { lineId: out.id }, orderBy: { seq: 'asc' } })).map((p) => [p.categoryId, p.amountTetri])).toEqual([
      [a.id, 30000],
      [b.id, 20000],
    ]);
    // A second answer finds the line taken.
    expect(err(await split(out.id, [{ categoryId: a.id, amountTetri: 30000 }, { categoryId: b.id, amountTetri: 20000 }]))).toBe('already_matched');

    const report = json<{ categories: { categoryId: string; tetri: number }[]; expensesTetri: number; totalOutTetri: number }>(
      await call(owner, 'GET', '/api/reports/expenses?from=2034-02-01&to=2034-02-28'),
    );
    expect(report.expensesTetri).toBe(50000);
    expect(report.totalOutTetri).toBe(50000);
    expect(Object.fromEntries(report.categories.map((c) => [c.categoryId, c.tetri]))).toEqual({ [a.id]: 30000, [b.id]: 20000 });

    const aside = json<{ lines: { id: string; parts: { categoryId: string; amountTetri: number }[] }[] }>(await call(owner, 'GET', '/api/statement-lines/aside'));
    expect(aside.lines.find((l) => l.id === out.id)?.parts).toEqual([
      { categoryId: a.id, amountTetri: 30000 },
      { categoryId: b.id, amountTetri: 20000 },
    ]);

    expect((await call(owner, 'POST', `/api/statement-lines/${out.id}/restore`, {})).statusCode).toBe(200);
    expect(await prisma.statementLine.findUniqueOrThrow({ where: { id: out.id } })).toMatchObject({ status: 'unmatched', resolution: null });
    expect(await prisma.statementLineExpensePart.count({ where: { lineId: out.id } })).toBe(0);
  });
});
