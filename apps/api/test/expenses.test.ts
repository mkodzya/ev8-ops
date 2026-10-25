// Money going out, and what it was for (migration 0046; Mika's variant A,
// 15.10.2026). The lines are shaped like a Bank of Georgia export; the payees
// and amounts are made up, each tagged so that suites never share a payee.
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

const BOG_HEADER = [
  ',,,"angariSis mflobeli: Sps e-mouSen moTors",,,,',
  ',,,"angariSis #:GE41BG0000000600217157GEL (600217157)",,,,',
  ',,,,,,,',
  '"centraluri filiali",,,"naerTi amonaweri piradi angariSidan",,,,',
  '"gagarinis q. #29 a",,,"periodi: 01.10.26-31.10.26",,,,',
  '"TariRi","sabuTis #","mokorespondento angariSi","debeti","krediti","kursi","eqv.lari","operaciis Sinaarsi"',
  '"01.10.2026","sawyisi naSTi","","GEL","0","1","0",""',
].join('\n');

let doc = 7000;
const outRow = (date: string, sum: string, payee: string) =>
  `"${date}","${doc++}","GE89BG0000000902936900GEL","${sum}","","1","${sum}","gadaricxva - Tanxa: GEL${sum}; mimRebi: ${payee}"`;

type Owner = Awaited<ReturnType<typeof loginAs>>;
interface QueueLine {
  id: string;
  raw: string;
  group: string;
  payee: string | null;
  canRemember: boolean;
  lastCategoryId: string | null;
}

async function load(owner: Owner, rows: string[]) {
  const res = await call(owner, 'POST', '/api/statements', { fileName: `out-${uniq()}.csv`, text: [BOG_HEADER, ...rows].join('\n') });
  expect(res.statusCode, res.body).toBe(201);
  return json<{ matched: number }>(res);
}
const queue = async (owner: Owner) => json<{ lines: QueueLine[] }>(await call(owner, 'GET', '/api/statement-lines?direction=out')).lines;
const categories = async (owner: Owner) => json<{ categories: { id: string; nameRu: string }[] }>(await call(owner, 'GET', '/api/expense-categories')).categories;

describe.skipIf(!HAS_DB)('what money going out was for', () => {
  it('starts with the twelve categories Mika accepted; an owner adds one, a manager may not', async () => {
    const owner = await loginAs('owner');
    const names = (await categories(owner)).map((c) => c.nameRu);
    for (const n of ['Налоги', 'Взносы за сотрудников', 'Коммунальные', 'Банк и терминал', 'Прочее']) expect(names).toContain(n);
    // The five 0048 added are taken out again by 0049: the list is the owner's.
    for (const n of ['Пенсионный фонд', 'Расчёт по НДС', 'Подоходный налог']) expect(names).not.toContain(n);
    const manager = await loginAs('manager');
    expect((await call(manager, 'POST', '/api/expense-categories', { nameRu: `ТЕСТ ${uniq()}` })).statusCode).toBe(403);
    const name = `ТЕСТ категория ${uniq()}`;
    const made = await call(owner, 'POST', '/api/expense-categories', { nameRu: name });
    expect(made.statusCode, made.body).toBe(201);
    expect(json<{ error: string }>(await call(owner, 'POST', '/api/expense-categories', { nameRu: name.toUpperCase() })).error).toBe('category_exists');
    const { id } = json<{ id: string }>(made);
    expect((await call(owner, 'PATCH', `/api/expense-categories/${id}`, { archived: true })).statusCode).toBe(200);
    expect((await categories(owner)).map((c) => c.id)).not.toContain(id);
  });

  it('an expense with its category; remembering the payee sorts the waiting line now and the next one on import', async () => {
    const owner = await loginAs('owner');
    const payee = `TEST UTILITY ${uniq()}`;
    await load(owner, [outRow('10.10.2026', '28.98', payee), outRow('11.10.2026', '28.98', payee)]);
    const mine = (await queue(owner)).filter((l) => l.raw.includes(payee));
    expect(mine).toHaveLength(2);
    expect(mine[0]).toMatchObject({ canRemember: true, group: 'none' });
    expect(mine[0].payee).toContain(payee);

    const utilities = (await categories(owner)).find((c) => c.nameRu === 'Коммунальные')!;
    const res = await call(owner, 'POST', `/api/statement-lines/${mine[0].id}/expense`, { categoryId: utilities.id, remember: true });
    expect(res.statusCode, res.body).toBe(200);
    const { ruleId, alsoSorted } = json<{ ruleId: string; alsoSorted: string[] }>(res);
    expect(alsoSorted).toEqual([mine[1].id]);
    expect((await queue(owner)).filter((l) => l.raw.includes(payee))).toHaveLength(0);

    // The next statement: the payee's line never reaches the queue.
    const next = await load(owner, [outRow('12.10.2026', '30.00', payee)]);
    expect(next.matched).toBe(1);
    const rules = json<{ expenses: { payee: string; categoryId: string; rule: { id: string; live: boolean } }[] }>(await call(owner, 'GET', '/api/statement-lines/by-rules'));
    const sorted = rules.expenses.filter((e) => e.payee?.includes(payee));
    expect(sorted).toHaveLength(2);
    expect(sorted.every((e) => e.categoryId === utilities.id && e.rule?.id === ruleId && e.rule.live)).toBe(true);

    // Forgotten, the rule sorts nothing more; what it sorted stays sorted.
    expect((await call(owner, 'POST', `/api/expense-rules/${ruleId}/forget`, {})).statusCode).toBe(200);
    await load(owner, [outRow('13.10.2026', '31.00', payee)]);
    const waiting = (await queue(owner)).filter((l) => l.raw.includes(payee));
    expect(waiting).toHaveLength(1);
    // …but the queue still says how it was sorted last time.
    expect(waiting[0]).toMatchObject({ group: 'suggested', lastCategoryId: utilities.id });
  });

  it('«Отменить» right after puts back the line, the lines it sorted, and forgets the payee', async () => {
    const owner = await loginAs('owner');
    const payee = `TEST TAX ${uniq()}`;
    await load(owner, [outRow('10.10.2026', '5.00', payee), outRow('10.10.2026', '1062.00', payee)]);
    const mine = (await queue(owner)).filter((l) => l.raw.includes(payee));
    const taxes = (await categories(owner)).find((c) => c.nameRu === 'Налоги')!;
    const { ruleId } = json<{ ruleId: string }>(await call(owner, 'POST', `/api/statement-lines/${mine[0].id}/expense`, { categoryId: taxes.id, remember: true }));
    const undo = await call(owner, 'POST', `/api/statement-lines/${mine[0].id}/expense-undo`, { ruleId });
    expect(undo.statusCode, undo.body).toBe(200);
    expect(json<{ restored: number }>(undo).restored).toBe(2);
    expect((await queue(owner)).filter((l) => l.raw.includes(payee))).toHaveLength(2);
    await load(owner, [outRow('11.10.2026', '7.00', payee)]);
    expect((await queue(owner)).filter((l) => l.raw.includes(payee))).toHaveLength(3);
  });

  it('money between the company’s own accounts is neither an expense nor somebody else’s; a nameless line cannot be remembered', async () => {
    const owner = await loginAs('owner');
    const payee = `TEST OWN ${uniq()}`;
    await load(owner, [outRow('10.10.2026', '350.00', payee)]);
    const line = (await queue(owner)).find((l) => l.raw.includes(payee))!;
    expect((await call(owner, 'POST', `/api/statement-lines/${line.id}/own-transfer`, {})).statusCode).toBe(200);
    const aside = json<{ lines: { id: string; resolution: string }[] }>(await call(owner, 'GET', '/api/statement-lines/aside'));
    expect(aside.lines.find((l) => l.id === line.id)?.resolution).toBe('own_transfer');

    const { prisma } = await import('../src/lib/db.js');
    const nameless = await prisma.statementLine.findFirstOrThrow({ where: { id: line.id } });
    const { expenseKey } = await import('../src/lib/statements/expenses.js');
    expect(expenseKey({ payer: '', purpose: 'gadaricxva' })).toBeNull();
    expect(expenseKey({ payer: 'თიბისი ბანკის VISA ბარათებით', purpose: 'POS - GOOGLE *Google One, 1.25 GEL, Oct 11 2026' })).toBe('pos:google *google one');
    expect(nameless.resolution).toBe('own_transfer');
  });

  it('a deposit handed back from the bank line itself: hinted to its renter only, written, and back in the queue when annulled', async () => {
    const owner = await loginAs('owner');
    const { prisma } = await import('../src/lib/db.js');
    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Model ${uniq()}`, forRent: true } });
    const vehicle = await prisma.vehicle.create({ data: { vin: `TESTE${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id } });
    // An invented renter, in Latin letters as a bank writes a recipient.
    const customer = await prisma.customer.create({ data: { name: `Testa Zalogi ${uniq()}` } });
    const { id: rentalId } = json<{ id: string }>(
      await call(owner, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, batteries: 2, chargers: 2, pickedUpOn: '2026-09-01' }),
    );
    // 180 of deposit and the first week, paid; then the moped comes back and the whole deposit is owed back.
    expect((await call(owner, 'POST', '/api/payments', { rentalId, channel: 'cash', grossTetri: 33000, occurredOn: '2026-09-01' })).statusCode).toBe(201);
    const back = await call(owner, 'POST', `/api/rentals/${rentalId}/return`, {
      odometerKm: 10,
      returnedOn: '2026-09-07',
      items: { moped: { state: 'ok' }, key: { state: 'ok' }, battery_1: { state: 'ok' }, battery_2: { state: 'ok' }, charger_1: { state: 'ok' }, charger_2: { state: 'ok' } },
      deposit: { action: 'return_all' },
    });
    expect(back.statusCode, back.body).toBe(200);
    const owed = async () => json<{ deposits: { rentalId: string; toHandBackTetri: number }[] }>(await call(owner, 'GET', '/api/deposits')).deposits.find((d) => d.rentalId === rentalId)!;
    const before = (await owed()).toHandBackTetri;
    expect(before).toBeGreaterThan(0);

    // Exactly that sum to somebody who is none of our customers: no hint — a sum alone is no sign (issue #16).
    const stranger = `TEST STRANGER ${uniq()}`;
    await load(owner, [outRow('10.10.2026', (before / 100).toFixed(2), stranger)]);
    const theirs = (await queue(owner)).find((l) => l.raw.includes(stranger)) as QueueLine & { depositHint: { rentalId: string } | null };
    expect(theirs.depositHint).toBeNull();
    expect(theirs.group).toBe('none');
    // Nor a line that names no recipient at all.
    await load(owner, [`"10.10.2026","${doc++}","GE89BG0000000902936900GEL","${(before / 100).toFixed(2)}","","1","${(before / 100).toFixed(2)}","REFUND ${stranger}"`]);
    const nameless = (await queue(owner)).find((l) => l.raw.includes(`REFUND ${stranger}`)) as QueueLine & { depositHint: { rentalId: string } | null };
    expect(nameless.depositHint).toBeNull();

    // The renter named as the recipient: «Похоже на возврат залога R-…».
    await load(owner, [outRow('10.10.2026', (before / 100).toFixed(2), customer.name)]);
    const line = (await queue(owner)).find((l) => l.raw.includes(customer.name)) as QueueLine & { depositHint: { rentalId: string } | null };
    expect(line.depositHint?.rentalId).toBe(rentalId);
    expect(line.group).toBe('suggested');

    const paid = await call(owner, 'POST', `/api/statement-lines/${line.id}/pay-out`, { kind: 'deposit_payout', rentalId });
    expect(paid.statusCode, paid.body).toBe(200);
    const { id: paymentId } = json<{ id: string }>(paid);
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(p).toMatchObject({ kind: 'deposit_payout', direction: 'out', source: 'statement', statementLineId: line.id, grossTetri: before });
    expect((await owed()).toHandBackTetri).toBe(0);
    expect((await queue(owner)).find((l) => l.id === line.id)).toBeUndefined();
    // Twice is refused; annulled, the line waits again and the deposit is owed again.
    expect((await call(owner, 'POST', `/api/statement-lines/${line.id}/pay-out`, { kind: 'deposit_payout', rentalId })).statusCode).toBe(409);
    expect((await call(owner, 'POST', `/api/payments/${paymentId}/void`, { reason: 'ТЕСТ: не тот залог' })).statusCode).toBe(200);
    expect((await queue(owner)).find((l) => l.id === line.id)).toBeTruthy();
    expect((await owed()).toHandBackTetri).toBe(before);
  });

  it('the report adds up a category over the period, and leaves out what is not spending', async () => {
    const owner = await loginAs('owner');
    const { id: categoryId } = json<{ id: string }>(await call(owner, 'POST', '/api/expense-categories', { nameRu: `ТЕСТ отчёт ${uniq()}` }));
    const payee = `TEST REPORT ${uniq()}`;
    await load(owner, [outRow('20.10.2026', '12.50', payee), outRow('21.10.2026', '7.50', payee), outRow('22.10.2026', '100.00', `${payee} OWN`)]);
    const mine = (await queue(owner)).filter((l) => l.raw.includes(payee));
    for (const l of mine.filter((x) => !x.raw.includes('OWN'))) {
      expect((await call(owner, 'POST', `/api/statement-lines/${l.id}/expense`, { categoryId })).statusCode).toBe(200);
    }
    expect((await call(owner, 'POST', `/api/statement-lines/${mine.find((x) => x.raw.includes('OWN'))!.id}/own-transfer`, {})).statusCode).toBe(200);
    const r = json<{ categories: { categoryId: string; tetri: number; lines: number }[]; ownTransfers: number }>(await call(owner, 'GET', '/api/reports/expenses?from=2026-10-20&to=2026-10-22'));
    expect(r.categories.find((c) => c.categoryId === categoryId)).toEqual({ categoryId, tetri: 2000, lines: 2 });
    expect(r.ownTransfers).toBeGreaterThanOrEqual(10000);
    const manager = await loginAs('manager');
    expect((await call(manager, 'GET', '/api/reports/expenses')).statusCode).toBe(403);
    expect((await call(owner, 'GET', '/api/reports/expenses?from=2026-10-22&to=2026-10-20')).statusCode).toBe(400);
  });
});
