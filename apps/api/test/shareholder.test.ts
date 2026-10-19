// Money taken out by a shareholder (ADR-0029): its own answer, left out of the
// expenses and counted apart in the report. Every line here is made up.
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

describe.skipIf(!HAS_DB)('money taken out by a shareholder (ADR-0029)', () => {
  it('is an answer for money going out, set aside with the journal, and can be put back', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const stmt = await prisma.statement.create({ data: { bank: 'bog', fileName: `test-${uniq()}.csv`, fileSha256: uniq() } });
    // A day far from any other suite's lines, so the report's sums are this test's alone.
    const day = new Date('2033-07-05T00:00:00Z');
    const mk = (direction: 'in' | 'out', amountTetri: number) =>
      prisma.statementLine.create({ data: { statementId: stmt.id, bank: 'bog', naturalKey: `test-${uniq()}`, occurredOn: day, direction, amountTetri, raw: 'test line', status: 'unmatched' } });
    const out = await mk('out', 500000);
    const back = await mk('in', 500000);
    const owner = await loginAs('owner');

    expect((await call(owner, 'POST', `/api/statement-lines/${back.id}/shareholder`, {})).statusCode).toBe(409);
    expect((await call(owner, 'POST', `/api/statement-lines/${out.id}/shareholder`, {})).statusCode).toBe(200);
    expect(await prisma.statementLine.findUniqueOrThrow({ where: { id: out.id } })).toMatchObject({ status: 'ignored', resolution: 'shareholder' });
    // A second answer finds it taken.
    expect((await call(owner, 'POST', `/api/statement-lines/${out.id}/shareholder`, {})).statusCode).toBe(409);
    const log = await prisma.auditLog.findFirst({ where: { entityId: out.id, action: 'statement.line.shareholder' } });
    expect(log).not.toBeNull();

    const report = json<{ expensesTetri: number; shareholder: number; totalOutTetri: number }>(await call(owner, 'GET', '/api/reports/expenses?from=2033-07-01&to=2033-07-31'));
    expect(report).toMatchObject({ expensesTetri: 0, shareholder: 500000, totalOutTetri: 500000 });

    const aside = json<{ lines: { id: string; resolution: string }[] }>(await call(owner, 'GET', '/api/statement-lines/aside?days=90'));
    expect(aside.lines.find((l) => l.id === out.id)).toMatchObject({ resolution: 'shareholder' });
    expect((await call(owner, 'POST', `/api/statement-lines/${out.id}/restore`, {})).statusCode).toBe(200);
    expect(await prisma.statementLine.findUniqueOrThrow({ where: { id: out.id } })).toMatchObject({ status: 'unmatched', resolution: null });
  });
});
