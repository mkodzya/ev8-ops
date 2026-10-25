// A Bank of Georgia card payment that reached «Разобрать» twice before rule 5
// (issue #16, ADR-0021 addendum of 25.10.2026): the later line says which line
// it repeats, and «Это дубль» sets it aside. Every shop, sum, number and card
// here is invented; the days are in 2035, which no other suite writes lines in.
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

const err = (res: { body: string }) => json<{ error: string }>(res).error;

/** A card payment's text as the bank's API words it: both listings of one payment carry the same. */
const cardText = (gel: string, at: string) =>
  `გადახდა - თანხა: GEL${gel}; ობიექტი: Example Bakery, Tbilisi, 2 Test Street; MCC:5462; თარიღი: ${at}; ბარათის No: ****0000; გადახდის ოპერაციის თანხა და ვალუტა: ${gel} GEL`;

interface QueueLine {
  id: string;
  group: string;
  duplicateOf: { id: string; occurredOn: string; docNo: string | null; status: string } | null;
}

describe.skipIf(!HAS_DB)('a card payment in the queue twice (issue #16)', () => {
  it('marks the later listing with the line it repeats; «Это дубль» sets it aside, an owner’s, and «Вернуть в очередь» brings it back', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const stmt = await prisma.statement.create({ data: { bank: 'bog', source: 'api', fileName: 'Business Online', fileSha256: 'api' } });
    // A sum and a day of this test's own.
    const tetri = 100_000 + Math.floor(Math.random() * 900_000);
    const gel = (tetri / 100).toFixed(2);
    const day = '2035-05-08';
    const t0 = Date.now();
    const mk = (doc: string, at: string, minutes: number) =>
      prisma.statementLine.create({
        data: {
          statementId: stmt.id,
          bank: 'bog',
          naturalKey: `api:today:test-${uniq()}`,
          docNo: doc,
          occurredOn: new Date(`${day}T00:00:00Z`),
          direction: 'out',
          amountTetri: tetri,
          raw: `08.05.2035 | ${doc} |  | ${gel} |  | ${cardText(gel, at)}`,
          status: 'unmatched',
          createdAt: new Date(t0 + minutes * 60_000),
        },
      });
    // The posting first, the card operation of the same payment five minutes
    // later — both in before rule 5 — and another purchase of the same sum in
    // the same shop that evening.
    const posted = await mk('11000000201', '08/05/2035 18:13', 0);
    const again = await mk('620000000201', '08/05/2035 18:13', 5);
    const evening = await mk('11000000202', '08/05/2035 19:40', 10);

    const queue = async () => json<{ lines: QueueLine[] }>(await call(owner, 'GET', '/api/statement-lines?direction=out')).lines;
    const of = (lines: QueueLine[], id: string) => lines.find((l) => l.id === id);
    let lines = await queue();
    expect(of(lines, again.id)).toMatchObject({ group: 'suggested', duplicateOf: { id: posted.id, occurredOn: day, docNo: '11000000201', status: 'unmatched' } });
    expect(of(lines, posted.id)?.duplicateOf).toBeNull();
    expect(of(lines, evening.id)?.duplicateOf).toBeNull();

    // Setting a line aside is an owner's; and only a line that repeats another is a duplicate.
    const manager = await loginAs('manager');
    expect((await call(manager, 'POST', `/api/statement-lines/${again.id}/duplicate`, {})).statusCode).toBe(403);
    expect(err(await call(owner, 'POST', `/api/statement-lines/${posted.id}/duplicate`, {}))).toBe('no_twin');
    expect(err(await call(owner, 'POST', `/api/statement-lines/${evening.id}/duplicate`, {}))).toBe('no_twin');

    const done = await call(owner, 'POST', `/api/statement-lines/${again.id}/duplicate`, {});
    expect(done.statusCode, done.body).toBe(200);
    expect(of(await queue(), again.id)).toBeUndefined();
    expect(await prisma.statementLine.findUniqueOrThrow({ where: { id: again.id } })).toMatchObject({ status: 'ignored', resolution: 'duplicate', resolutionReason: `twin:${day}:11000000201` });
    const aside = json<{ lines: { id: string; resolution: string; reason: string }[] }>(await call(owner, 'GET', '/api/statement-lines/aside'));
    expect(aside.lines.find((l) => l.id === again.id)).toMatchObject({ resolution: 'duplicate', reason: `twin:${day}:11000000201` });
    const journal = await prisma.auditLog.findMany({ where: { action: 'statement.line.duplicate', entityId: again.id } });
    expect(journal).toHaveLength(1);
    expect(journal[0]!.after).toMatchObject({ twinId: posted.id });
    expect(err(await call(owner, 'POST', `/api/statement-lines/${again.id}/duplicate`, {}))).toBe('already_matched');

    // «Вернуть в очередь»: it waits again, marked again.
    expect((await call(owner, 'POST', `/api/statement-lines/${again.id}/restore`, {})).statusCode).toBe(200);
    expect(of(await queue(), again.id)?.duplicateOf?.id).toBe(posted.id);

    // The line it repeats sorted already — an expense — still says so.
    expect((await call(owner, 'POST', `/api/statement-lines/${posted.id}/expense`, {})).statusCode).toBe(200);
    lines = await queue();
    expect(of(lines, again.id)?.duplicateOf).toMatchObject({ id: posted.id, status: 'ignored' });
  });
});
