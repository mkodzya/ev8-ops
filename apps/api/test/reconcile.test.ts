// "Разобрать", statements and the till (wave 2 §3.2, §3.4, §3.5): criteria
// 11–26, 29–31a at the API. Bank lines are synthetic, in the Bank of
// Georgia export's real shape; every customer carries a tag of its own so a
// name never matches somebody an earlier run left behind.
import { addDays, todayISO } from '@ev8/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

const today = () => todayISO(new Date(), 'Asia/Tbilisi');
const dmy = (iso: string) => iso.split('-').reverse().join('.');

const BOG_HEADER = [
  ',,,"angariSis mflobeli: Sps e-mouSen moTors",,,,',
  ',,,"angariSis #:GE41BG0000000600217157GEL (600217157)",,,,',
  '"TariRi","sabuTis #","mokorespondento angariSi","debeti","krediti","kursi","eqv.lari","operaciis Sinaarsi"',
].join('\n');
const inRow = (iso: string, amount: string, content: string) => `"${dmy(iso)}","0017","GE38TB7756045063400002","","${amount}","1","${amount}","${content}"`;
const outRow = (iso: string, amount: string, content: string) => `"${dmy(iso)}","0018","GE89BG0000000902936900GEL","${amount}","","1","${amount}","${content}"`;
const file = (...rows: string[]) => [BOG_HEADER, ...rows].join('\n');

// The rules match a line to the one rental its amount and date fit. Suites
// that ran before this one leave rentals handed over today at 150 + 180 still
// open, and card payments entered by hand (all deleted only when the whole
// run ends); any of them makes a 330 card line ambiguous here, and so do the
// ones an earlier test in this file made. They are closed before each test,
// in this throwaway database, so every test counts only what it made itself.
beforeEach(async () => {
  if (!HAS_DB) return;
  const { prisma } = await import('../src/lib/db.js');
  await prisma.rental.updateMany({ where: { status: { not: 'returned' } }, data: { status: 'returned' } });
  // Card and transfer payments entered by hand wait for their bank line; one
  // of 330 from the hand-over suite takes a 325.05 line as "already recorded".
  await prisma.payment.updateMany({ where: { statementLineId: null, voidedAt: null, source: 'manual', channel: { not: 'cash' } }, data: { voidedAt: new Date(), voidReason: 'test isolation', voidKind: 'void' } });
});

function tag(): string {
  return `t${uniq().replace(/\D/g, '').slice(-9)}`;
}

async function rental(opts: { rate?: number; pickedUpOn?: string; name?: string } = {}) {
  const { prisma } = await import('../src/lib/db.js');
  const t = tag();
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Reco ${uniq()}`, forRent: true } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TESTR${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id } });
  // The bank writes a Georgian name in its own transliteration ("testaZe gela"); the card holds the Georgian spelling.
  const customer = await prisma.customer.create({ data: { name: opts.name ?? `Гела Тестадзе ${t}`, nameKa: `გელა ტესტაძე ${t}` } });
  const owner = await loginAs('owner');
  const { id } = json<{ id: string }>(
    await call(owner, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: opts.rate ?? 15000, pickedUpOn: opts.pickedUpOn ?? today() }),
  );
  return { prisma, owner, customer, rentalId: id, tag: t, modelId: model.id };
}

type Queue = { lines: { id: string; raw: string; group: string; recorded: { id: string }[]; suggestions: { kind: string; id: string; reason: { code: string } }[] }[] };
/** The line carrying this tag, as "Разобрать" shows it — or undefined when it is not waiting there. */
async function queued(owner: string, t: string, direction = 'in'): Promise<Queue['lines'][number] | undefined> {
  const { prisma } = await import('../src/lib/db.js');
  const row = await prisma.statementLine.findFirst({ where: { raw: { contains: t }, status: 'unmatched', direction: direction as 'in' | 'out' } });
  if (!row) return undefined;
  const d = json<Omit<Queue['lines'][number], 'id' | 'raw'> & { line: { id: string; raw: string } }>(await call(owner, 'GET', `/api/statement-lines/${row.id}`));
  return { ...d, id: d.line.id, raw: d.line.raw };
}

describe.skipIf(!HAS_DB)('money entered by hand, then the statement (B2-03)', () => {
  it('a line within three days links to the payment already in, and writes nothing new (crit. 11)', async () => {
    const { prisma, owner, customer, rentalId, tag: t } = await rental({ pickedUpOn: addDays(today(), -2) });
    await call(owner, 'POST', '/api/money', { kind: 'rent', rentalId, amountTetri: '150', channel: 'transfer', occurredOn: addDays(today(), -1), backdateReason: 'bank transfer seen yesterday' });
    const text = file(inRow(today(), '150.00', `Caricxva: gadmomricxavi: testaZe gela ${t}; daniSnuleba: qira`));
    const preview = json<{ recorded: number }>(await call(owner, 'POST', '/api/statements/preview', { fileName: 's.csv', text }));
    expect(preview.recorded).toBe(1);
    await call(owner, 'POST', '/api/statements', { fileName: 's.csv', text });
    const payments = await prisma.payment.findMany({ where: { customerId: customer.id, voidedAt: null } });
    expect(payments).toHaveLength(1);
    expect(payments[0].statementLineId).not.toBeNull();
  });

  it('the same line a week later is not that payment (crit. 12)', async () => {
    const { prisma, owner, customer, rentalId, tag: t } = await rental({ pickedUpOn: addDays(today(), -9) });
    await call(owner, 'POST', '/api/money', { kind: 'rent', rentalId, amountTetri: '150', channel: 'transfer', occurredOn: addDays(today(), -8), backdateReason: 'x' });
    await call(owner, 'POST', '/api/statements', { fileName: 's.csv', text: file(inRow(today(), '150.00', `gadmomricxavi: testaZe gela ${t}`)) });
    const first = await prisma.payment.findFirstOrThrow({ where: { customerId: customer.id, source: 'manual' } });
    expect(first.statementLineId).toBeNull();
  });

  it('two candidates: the line waits under "already recorded" with both, nothing is written (crit. 13)', async () => {
    const { prisma, owner, customer, rentalId, tag: t } = await rental({ pickedUpOn: addDays(today(), -9) });
    await call(owner, 'POST', '/api/money', { kind: 'rent', rentalId, amountTetri: '150', channel: 'transfer', occurredOn: addDays(today(), -1), backdateReason: 'x' });
    await call(owner, 'POST', '/api/money', { kind: 'rent', rentalId, amountTetri: '150', channel: 'transfer', occurredOn: addDays(today(), -2), backdateReason: 'x' });
    await call(owner, 'POST', '/api/statements', { fileName: 's.csv', text: file(inRow(today(), '150.00', `gadmomricxavi: testaZe gela ${t}`)) });
    const line = await queued(owner, t);
    expect(line?.group).toBe('recorded');
    expect(line?.recorded).toHaveLength(2);
    expect(await prisma.payment.count({ where: { customerId: customer.id, voidedAt: null } })).toBe(2);
    // "Да, это он".
    expect((await call(owner, 'POST', `/api/statement-lines/${line!.id}/link`, { paymentId: line!.recorded[0].id })).statusCode).toBe(200);
  });
});

describe.skipIf(!HAS_DB)('rules need two signs (B2-04)', () => {
  it('a disputed rental takes nothing, even with a card line and the full amount (crit. 14)', async () => {
    const { prisma, owner, rentalId } = await rental({ rate: 14000, pickedUpOn: addDays(today(), -3) });
    await prisma.rental.update({ where: { id: rentalId }, data: { status: 'disputed' } });
    const t = tag();
    const res = json<{ matched: number }>(await call(owner, 'POST', '/api/statements', { fileName: 's.csv', text: file(inRow(today(), '315.20', `Tanxa:GEL 320; sakomisio: GEL 4.80; ${t}`)) }));
    expect(res.matched).toBe(0);
    expect(await prisma.payment.count({ where: { rentalId } })).toBe(0);
  });

  it('a card line on the pick-up day attaches, gross and fee, and shows under "by rules" (crit. 15, 22)', async () => {
    const { prisma, owner, rentalId } = await rental({ rate: 15000 });
    const t = tag();
    // 325.05 credited = 330 paid − 1.5 %.
    const res = json<{ matched: number }>(await call(owner, 'POST', '/api/statements', { fileName: 's.csv', text: file(inRow(today(), '325.05', `Caricxva - Tanxa GEL325.05; Wallet/domestic MC cards ${t}`)) }));
    expect(res.matched).toBe(1);
    const p = await prisma.payment.findFirstOrThrow({ where: { rentalId } });
    expect(p).toMatchObject({ channel: 'acquiring', grossTetri: 33000, feeTetri: 495 });
    const byRules = json<{ lines: { payment: { id: string } | null; reason: { code: string } | null }[] }>(await call(owner, 'GET', '/api/statement-lines/by-rules'));
    expect(byRules.lines.find((l) => l.payment?.id === p.id)?.reason?.code).toBe('card_pickup');
  });

  it('an amount alone is only a hint', async () => {
    const { prisma, owner, rentalId } = await rental({ rate: 15000, pickedUpOn: addDays(today(), -30) });
    const t = tag();
    await call(owner, 'POST', '/api/statements', { fileName: 's.csv', text: file(inRow(addDays(today(), -20), '150.00', `anonymous ${t}`)) });
    expect(await prisma.payment.count({ where: { rentalId } })).toBe(0);
  });
});

describe.skipIf(!HAS_DB)('"Разобрать" (§3.2)', () => {
  it('the payer’s own returned rental is the first hint, "name matched" (crit. 16)', async () => {
    const { prisma, owner, rentalId, tag: t } = await rental({ pickedUpOn: addDays(today(), -14) });
    await prisma.rental.update({ where: { id: rentalId }, data: { status: 'returned', returnedOn: new Date() } });
    await call(owner, 'POST', '/api/statements', { fileName: 's.csv', text: file(inRow(today(), '150.00', `gadmomricxavi: testaZe gela ${t}`)) });
    const line = await queued(owner, t);
    expect(line?.group).toBe('suggested');
    expect(line?.suggestions[0]).toMatchObject({ kind: 'rental', id: rentalId, reason: { code: 'name' } });
  });

  it('two taps on "attach" at once make one payment; the second is told the line is taken (crit. 18, 19)', async () => {
    const { prisma, owner, rentalId } = await rental({ pickedUpOn: addDays(today(), -30) });
    const t = tag();
    await call(owner, 'POST', '/api/statements', { fileName: 's.csv', text: file(inRow(today(), '77.70', `nobody ${t}`)) });
    const line = (await queued(owner, t))!;
    const [a, b] = await Promise.all([
      call(owner, 'POST', `/api/statement-lines/${line.id}/assign`, { rentalId }),
      call(owner, 'POST', `/api/statement-lines/${line.id}/assign`, { rentalId }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect(json<{ error: string }>(a.statusCode === 409 ? a : b).error).toBe('already_matched');
    expect(await prisma.payment.count({ where: { rentalId, voidedAt: null } })).toBe(1);
  });

  it('annulling the payment puts the line back, and it attaches elsewhere (crit. 20)', async () => {
    const { owner, rentalId } = await rental({ pickedUpOn: addDays(today(), -30) });
    const other = await rental({ pickedUpOn: addDays(today(), -30) });
    const t = tag();
    await call(owner, 'POST', '/api/statements', { fileName: 's.csv', text: file(inRow(today(), '66.60', `nobody ${t}`)) });
    const line = (await queued(owner, t))!;
    const { id } = json<{ id: string }>(await call(owner, 'POST', `/api/statement-lines/${line.id}/assign`, { rentalId }));
    expect((await call(owner, 'POST', `/api/payments/${id}/void`, { reason: 'wrong rental' })).statusCode).toBe(200);
    expect((await queued(owner, t))?.id).toBe(line.id);
    expect((await call(owner, 'POST', `/api/statement-lines/${line.id}/assign`, { rentalId: other.rentalId })).statusCode).toBe(200);
  });

  it('"unlink" on what a rule attached: the line is back, the payment annulled, the debt returns (crit. 21)', async () => {
    const { prisma, owner, customer, rentalId } = await rental({ rate: 15000 });
    const t = tag();
    await call(owner, 'POST', '/api/statements', { fileName: 's.csv', text: file(inRow(today(), '325.05', `Wallet/domestic MC cards ${t}`)) });
    const line = await prisma.statementLine.findFirstOrThrow({ where: { raw: { contains: t } } });
    expect(line.status).toBe('matched');
    expect((await call(owner, 'POST', `/api/statement-lines/${line.id}/unlink`)).statusCode).toBe(200);
    expect((await queued(owner, t))?.id).toBe(line.id);
    expect(json<{ owesTetri: number }>(await call(owner, 'GET', `/api/customers/${customer.id}/balance`)).owesTetri).toBe(33000);
    expect(await prisma.payment.count({ where: { rentalId, voidedAt: null } })).toBe(0);
  });

  it('an outgoing line is a supplier payment already entered, or a company expense (crit. 23)', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const supplier = await prisma.customer.create({ data: { name: `ТЕСТ Поставщик ${uniq()}`, recordKind: 'supplier' } });
    const po = json<{ id: string }>(await call(owner, 'POST', '/api/purchases', { supplierId: supplier.id, currency: 'CNY' }));
    const amount = `${1000 + Math.floor(Math.random() * 8000)}.13`;
    const paid = json<{ id: string }>(await call(owner, 'POST', '/api/money', { kind: 'supplier', purchaseId: po.id, amountTetri: amount, channel: 'transfer' }));
    const t = tag();
    await call(owner, 'POST', '/api/statements', { fileName: 's.csv', text: file(outRow(addDays(today(), 1 - 1), amount, `gadaricxva mimRebi: FACTORY ${t}`), outRow(today(), '12.00', `bank fee ${t}x`)) });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paid.id } })).statementLineId).not.toBeNull();
    const fee = (await queued(owner, `${t}x`, 'out'))!;
    expect((await call(owner, 'POST', `/api/statement-lines/${fee.id}/expense`)).statusCode).toBe(200);
  });

  it('"not ours" needs a reason (crit. 24)', async () => {
    const owner = await loginAs('owner');
    const t = tag();
    await call(owner, 'POST', '/api/statements', { fileName: 's.csv', text: file(inRow(today(), '1.23', `interest ${t}`)) });
    const line = (await queued(owner, t))!;
    const bare = await call(owner, 'POST', `/api/statement-lines/${line.id}/ignore`, {});
    expect(json<{ error: string }>(bare).error).toBe('missing_field');
    expect((await call(owner, 'POST', `/api/statement-lines/${line.id}/ignore`, { reason: 'bank interest' })).statusCode).toBe(200);
  });

  it('a file over the limit is refused with the limit, not a code (crit. 25)', async () => {
    const owner = await loginAs('owner');
    const big = 'x'.repeat(8 * 1024 * 1024 + 10);
    const res = await call(owner, 'POST', '/api/statements/preview', { fileName: 'big.csv', text: big });
    expect(res.statusCode).toBe(400);
    expect(json<{ error: string; limitBytes: number }>(res)).toMatchObject({ error: 'file_too_big', limitBytes: 8 * 1024 * 1024 });
  });

  it('each bank says up to when its statements are, and when that is stale (crit. 26)', async () => {
    const owner = await loginAs('owner');
    const s = json<{ banks: { bank: string; throughOn: string | null; stale: boolean }[]; staleDays: number }>(await call(owner, 'GET', '/api/statements'));
    expect(s.banks.map((b) => b.bank)).toEqual(['bog', 'tbc', 'credo']);
    expect(s.staleDays).toBe(7);
  });
});

describe.skipIf(!HAS_DB)('the till (§3.4)', () => {
  it('a manager hands over, an owner accepts; what is on hand moves (crit. 29, 31)', async () => {
    const { rentalId } = await rental();
    const manager = await loginAs('manager');
    const owner = await loginAs('owner');
    for (const a of ['50', '60', '70']) await call(manager, 'POST', '/api/money', { kind: 'rent', rentalId, amountTetri: a, channel: 'cash' });
    const mine = json<{ rows: { onHandTetri: number; cashInCount: number }[] }>(await call(manager, 'GET', '/api/till'));
    expect(mine.rows[0]).toMatchObject({ onHandTetri: 18000, cashInCount: 3 });

    const over = await call(manager, 'POST', '/api/till/handovers', { amountTetri: '181' });
    expect(json<{ error: string }>(over).error).toBe('over_on_hand');
    const h = json<{ id: string }>(await call(manager, 'POST', '/api/till/handovers', { amountTetri: '180' }));
    const after = json<{ rows: { onHandTetri: number; pendingTetri: number }[] }>(await call(manager, 'GET', '/api/till'));
    expect(after.rows[0]).toMatchObject({ onHandTetri: 0, pendingTetri: 18000 });

    const ownerId = json<{ id: string }>(await call(owner, 'GET', '/api/me')).id;
    const before = json<{ rows: { userId: string; onHandTetri: number }[] }>(await call(owner, 'GET', '/api/till')).rows.find((r) => r.userId === ownerId)!.onHandTetri;
    expect((await call(owner, 'POST', `/api/till/handovers/${h.id}/accept`)).statusCode).toBe(200);
    expect((await call(owner, 'POST', `/api/till/handovers/${h.id}/accept`)).statusCode).toBe(409);
    const now = json<{ rows: { userId: string; onHandTetri: number }[] }>(await call(owner, 'GET', '/api/till')).rows.find((r) => r.userId === ownerId)!.onHandTetri;
    expect(now - before).toBe(18000);
  });

  it('"does not add up" needs a reason, and the shortfall stays the manager’s (crit. 30)', async () => {
    const { rentalId } = await rental();
    const manager = await loginAs('manager');
    const owner = await loginAs('owner');
    await call(manager, 'POST', '/api/money', { kind: 'rent', rentalId, amountTetri: '100', channel: 'cash' });
    const h = json<{ id: string }>(await call(manager, 'POST', '/api/till/handovers', { amountTetri: '100' }));
    expect(json<{ error: string }>(await call(owner, 'POST', `/api/till/handovers/${h.id}/dispute`, { countedTetri: '90' })).error).toBe('missing_field');
    expect((await call(owner, 'POST', `/api/till/handovers/${h.id}/dispute`, { countedTetri: '90', reason: 'ten short in the envelope' })).statusCode).toBe(200);
    const mine = json<{ rows: { shortTetri: number }[] }>(await call(manager, 'GET', '/api/till'));
    expect(mine.rows[0].shortTetri).toBe(1000);
  });

  it('cash to the bank leaves the till, and the statement’s cash-deposit line finds it (crit. 31а)', async () => {
    const { prisma, owner, rentalId } = await rental({ rate: 150000 });
    await call(owner, 'POST', '/api/money', { kind: 'rent', rentalId, amountTetri: '1700', channel: 'cash' });
    const ownerId = json<{ id: string }>(await call(owner, 'GET', '/api/me')).id;
    const onHand = async () => json<{ rows: { userId: string; onHandTetri: number }[] }>(await call(owner, 'GET', '/api/till')).rows.find((r) => r.userId === ownerId)!.onHandTetri;
    const start = await onHand();
    const over = await call(owner, 'POST', '/api/till/bank-deposits', { amountTetri: String((start + 100) / 100), bank: 'bog' });
    expect(json<{ error: string }>(over).error).toBe('over_on_hand');
    const amount = `${1000 + Math.floor(Math.random() * 500)}`;
    const dep = json<{ id: string }>(await call(owner, 'POST', '/api/till/bank-deposits', { amountTetri: amount, bank: 'bog' }));
    expect(start - (await onHand())).toBe(Number(amount) * 100);

    const t = tag();
    await call(owner, 'POST', '/api/statements', { fileName: 's.csv', text: file(inRow(addDays(today(), 1), `${amount}.00`, `naRdi fulis Setana ${t}`)) });
    expect((await prisma.bankCashDeposit.findUniqueOrThrow({ where: { id: dep.id } })).statementLineId).not.toBeNull();
    expect(await queued(owner, t)).toBeUndefined();
  });
});

describe.skipIf(!HAS_DB)('round 1 of wave 2 (QA-W2-04, designer’s answer 3)', () => {
  it('a name attaches only to a record that owes this sum — a rental paid ahead waits for a person (QA-W2-04)', async () => {
    const { prisma, owner, rentalId, tag: t } = await rental({ pickedUpOn: today() });
    await call(owner, 'POST', '/api/money', { kind: 'rent', rentalId, amountTetri: '330', channel: 'cash' });
    await call(owner, 'POST', '/api/statements', { fileName: 's.csv', text: file(inRow(addDays(today(), 1), '150.00', `gadmomricxavi: testaZe gela ${t}`)) });
    expect(await prisma.payment.count({ where: { rentalId, source: 'statement' } })).toBe(0);
    expect((await queued(owner, t))?.group).toBe('suggested');
  });

  it('a line that is both a hand-entered payment and another rental’s first card payment is asked about, not linked', async () => {
    const entered = await rental({ pickedUpOn: addDays(today(), -1) });
    const fresh = await rental({ pickedUpOn: today() });
    await call(entered.owner, 'POST', '/api/money', { kind: 'rent', rentalId: entered.rentalId, amountTetri: '330', channel: 'acquiring', occurredOn: addDays(today(), -1), backdateReason: 'x' });
    const t = tag();
    await call(entered.owner, 'POST', '/api/statements', { fileName: 's.csv', text: file(inRow(today(), '325.05', `Wallet/domestic MC cards ${t}`)) });
    const line = await queued(entered.owner, t);
    expect(line?.group).toBe('recorded');
    expect(line?.suggestions.map((s) => s.id)).toContain(fresh.rentalId);
  });
});
