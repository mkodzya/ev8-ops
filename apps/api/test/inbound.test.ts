// «Разобрать → Поступления» answered by its kind (issue #13 of the director,
// 25.10.2026; ADR-0046; migration 0069): a founder's contribution, other
// income with its category, the payer remembered, the panel's options, a
// charge paid alone, a deposit as a part of its own, and «Отчёты →
// Поступления». Every payer and customer here is invented, and carries a tag
// of its own so a name never matches what an earlier run left behind.
import { addDays, fleetNumber, todayISO } from '@ev8/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

const today = () => todayISO(new Date(), 'Asia/Tbilisi');
const dmy = (iso: string) => iso.split('-').reverse().join('.');

const BOG_HEADER = [
  ',,,"angariSis mflobeli: Sps e-mouSen moTors",,,,',
  ',,,"angariSis #:GE41BG0000000600217157GEL (600217157)",,,,',
  '"TariRi","sabuTis #","mokorespondento angariSi","debeti","krediti","kursi","eqv.lari","operaciis Sinaarsi"',
].join('\n');
let doc = 0;
const inRow = (iso: string, amount: string, content: string) => `"${dmy(iso)}","${7000 + (doc++ % 900)}","GE38TB7756045063400002","","${amount}","1","${amount}","${content}"`;
const outRow = (iso: string, amount: string, content: string) => `"${dmy(iso)}","${8000 + (doc++ % 900)}","GE89BG0000000902936900GEL","${amount}","","1","${amount}","${content}"`;
const file = (...rows: string[]) => [BOG_HEADER, ...rows].join('\n');
/** A transfer from an invented sender, in the bank's English wording since autumn 2026. */
const from = (who: string, extra = '') => `Incoming Transfer - Amount: GEL; Sender: ${who}; Account: GE38BG0000000000000001GEL; Details: Transfer${extra}`;

const tag = () => `t${uniq().replace(/\D/g, '').slice(-9)}`;

// Other suites leave running rentals of 150 behind; each test here counts only what it made itself.
beforeEach(async () => {
  if (!HAS_DB) return;
  const { prisma } = await import('../src/lib/db.js');
  await prisma.rental.updateMany({ where: { status: { not: 'returned' } }, data: { status: 'returned' } });
  await prisma.payment.updateMany({ where: { statementLineId: null, voidedAt: null, source: 'manual', channel: { not: 'cash' } }, data: { voidedAt: new Date(), voidReason: 'test isolation', voidKind: 'void' } });
});

async function rental(opts: { rate?: number; pickedUpOn?: string; phone?: string; georgian?: boolean } = {}) {
  const { prisma } = await import('../src/lib/db.js');
  const t = tag();
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Inbound ${uniq()}`, forRent: true } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TESTI${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id } });
  // An invented renter; the bank, as in the director's case, writes his sender otherwise.
  // With `georgian` the card holds the Georgian spelling, which the bank writes in its Latin («testaZe gela»).
  const customer = await prisma.customer.create({ data: { name: `Тест Арендатор ${t}`, nameKa: opts.georgian ? `გელა ტესტაძე ${t}` : null, phone: opts.phone ?? null } });
  const owner = await loginAs('owner');
  const res = await call(owner, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: opts.rate ?? 15000, pickedUpOn: opts.pickedUpOn ?? today() });
  const { id } = json<{ id: string }>(res);
  return { prisma, owner, customer, vehicle, rentalId: id, tag: t };
}

async function load(owner: string, ...rows: string[]) {
  return json<{ matched: number; recorded: number }>(await call(owner, 'POST', '/api/statements', { fileName: 's.csv', text: file(...rows) }));
}
async function lineOf(t: string) {
  const { prisma } = await import('../src/lib/db.js');
  return prisma.statementLine.findFirstOrThrow({ where: { raw: { contains: t } }, orderBy: { createdAt: 'desc' } });
}

type Option = { key: string; target: Record<string, string>; number: string | null; probable: string | null; fits: boolean; owesTetri: number; customerDebtTetri: number | null; plan?: { kind: string; tetri: number }[]; payDay?: number | null };

describe.skipIf(!HAS_DB)('«Взнос учредителя» (issue #13, ADR-0046)', () => {
  it('sets the line aside as a founder’s money: no payment, not in the week’s money in, apart in «Поступления»', async () => {
    const owner = await loginAs('owner');
    const t = tag();
    const before = json<{ money: { totalTetri: number } }>(await call(owner, 'GET', '/api/reports/week'));
    const report0 = json<{ founder: number }>(await call(owner, 'GET', `/api/reports/incoming?from=${today()}&to=${today()}`));
    await load(owner, inRow(today(), '5000.00', `FOUNDER'S EQUITY: ${from(`Founder Example ${t}`)}`));
    const line = await lineOf(t);
    expect((await call(owner, 'POST', `/api/statement-lines/${line.id}/founder-equity`, {})).statusCode).toBe(200);
    const { prisma } = await import('../src/lib/db.js');
    expect(await prisma.statementLine.findUniqueOrThrow({ where: { id: line.id } })).toMatchObject({ status: 'ignored', resolution: 'founder_equity' });
    expect(await prisma.payment.count({ where: { statementLineId: line.id } })).toBe(0);
    const after = json<{ money: { totalTetri: number } }>(await call(owner, 'GET', '/api/reports/week'));
    expect(after.money.totalTetri).toBe(before.money.totalTetri);
    const report = json<{ founder: number; customersTetri: number }>(await call(owner, 'GET', `/api/reports/incoming?from=${today()}&to=${today()}`));
    expect(report.founder - report0.founder).toBe(500000);
    // In «Отложено», with its answer; «Вернуть в очередь» undoes it.
    const aside = json<{ lines: { id: string; resolution: string }[] }>(await call(owner, 'GET', '/api/statement-lines/aside'));
    expect(aside.lines.find((l) => l.id === line.id)?.resolution).toBe('founder_equity');
    expect((await call(owner, 'POST', `/api/statement-lines/${line.id}/restore`)).statusCode).toBe(200);
    expect((await prisma.statementLine.findUniqueOrThrow({ where: { id: line.id } })).status).toBe('unmatched');
  });

  it('is money coming in only', async () => {
    const owner = await loginAs('owner');
    const t = tag();
    await load(owner, outRow(today(), '50.00', `gadaricxva mimRebi: SOMEBODY ${t}`));
    const line = await lineOf(t);
    const res = await call(owner, 'POST', `/api/statement-lines/${line.id}/founder-equity`, {});
    expect(res.statusCode).toBe(409);
    expect(json<{ error: string }>(res).error).toBe('not_incoming');
  });
});

describe.skipIf(!HAS_DB)('«Прочий доход ▸» and a remembered payer (issue #13)', () => {
  it('takes a category, remembers the payer, and sorts his next line by itself under «Разобрано правилами»', async () => {
    const owner = await loginAs('owner');
    const t = tag();
    const cats = json<{ categories: { id: string; nameRu: string }[] }>(await call(owner, 'GET', '/api/income-categories'));
    const insurance = cats.categories.find((c) => c.nameRu === 'Страховка')!;
    expect(insurance).toBeTruthy();
    await load(owner, inRow(today(), '120.00', from(`Insurer Example ${t}`)));
    const first = await lineOf(t);
    const res = json<{ ruleId: string; alsoSorted: string[] }>(await call(owner, 'POST', `/api/statement-lines/${first.id}/other-income`, { categoryId: insurance.id, remember: true }));
    expect(res.ruleId).toBeTruthy();

    await load(owner, inRow(addDays(today(), 1), '80.00', from(`Insurer Example ${t}`, ' second')));
    const { prisma } = await import('../src/lib/db.js');
    const second = await prisma.statementLine.findFirstOrThrow({ where: { raw: { contains: `${t}; Account` }, amountTetri: 8000 } });
    expect(second).toMatchObject({ status: 'ignored', resolution: 'other_income', incomeCategoryId: insurance.id, payerRuleId: res.ruleId, matchedRule: 'payer_rule' });
    const rules = json<{ incoming: { id: string; rule: { id: string; live: boolean } | null }[] }>(await call(owner, 'GET', '/api/statement-lines/by-rules'));
    expect(rules.incoming.find((l) => l.id === second.id)?.rule).toMatchObject({ id: res.ruleId, live: true });
    // Not in «Отложено»: a rule did it, not a person.
    const aside = json<{ lines: { id: string }[] }>(await call(owner, 'GET', '/api/statement-lines/aside'));
    expect(aside.lines.map((l) => l.id)).not.toContain(second.id);

    // «Забыть правило»: the third line waits for a person; what the rule sorted stays.
    expect((await call(owner, 'POST', `/api/payer-rules/${res.ruleId}/forget`)).statusCode).toBe(200);
    await load(owner, inRow(addDays(today(), 2), '70.00', from(`Insurer Example ${t}`, ' third')));
    expect((await prisma.statementLine.findFirstOrThrow({ where: { raw: { contains: `${t}; Account` }, amountTetri: 7000 } })).status).toBe('unmatched');
    expect((await prisma.statementLine.findUniqueOrThrow({ where: { id: second.id } })).status).toBe('ignored');
  });

  it('a category taken off cannot be chosen; the settings are an owner’s', async () => {
    const owner = await loginAs('owner');
    const manager = await loginAs('manager');
    const made = json<{ id: string }>(await call(owner, 'POST', '/api/income-categories', { nameRu: `Тестовый доход ${uniq()}`, nameKa: 'სატესტო', nameEn: 'Test income' }));
    expect((await call(manager, 'POST', '/api/income-categories', { nameRu: 'x' })).statusCode).toBe(403);
    expect((await call(owner, 'PATCH', `/api/income-categories/${made.id}`, { archived: true })).statusCode).toBe(200);
    const t = tag();
    await load(owner, inRow(today(), '33.00', from(`Somebody ${t}`)));
    const line = await lineOf(t);
    const res = await call(owner, 'POST', `/api/statement-lines/${line.id}/other-income`, { categoryId: made.id });
    expect(json<{ error: string }>(res).error).toBe('income_category_not_found');
  });
});

describe.skipIf(!HAS_DB)('a payer remembered as a customer (issue #13, acceptance 1)', () => {
  it('attach to a rental with «Запомнить»: his next line goes on that rental by itself, and shows why', async () => {
    // Handed over a week ago and nothing paid: the deposit and two weeks are owed.
    const { prisma, owner, rentalId } = await rental({ pickedUpOn: addDays(today(), -7) });
    const t = tag();
    // A sender the card does not name: a relative, or the bank's own spelling.
    await load(owner, inRow(today(), '180.00', from(`Relative Example ${t}`)));
    const first = await lineOf(t);
    expect(first.status).toBe('unmatched');
    const res = json<{ id: string; ruleId: string; alsoSorted: string[] }>(await call(owner, 'POST', `/api/statement-lines/${first.id}/assign`, { rentalId, remember: true }));
    expect(res.ruleId).toBeTruthy();
    expect(await prisma.payerRule.findUniqueOrThrow({ where: { id: res.ruleId } })).toMatchObject({ kind: 'customer', payerKey: `relative example ${t}` });

    // The next line from him is a week: it pays the oldest week owed, by itself.
    const loaded = await load(owner, inRow(today(), '150.00', from(`Relative Example ${t}`, ' again')));
    expect(loaded.matched).toBe(1);
    const second = await prisma.statementLine.findFirstOrThrow({ where: { raw: { contains: `${t}; Account` }, id: { not: first.id } } });
    expect(second).toMatchObject({ status: 'matched', matchedRule: 'payer_rule', payerRuleId: res.ruleId });
    expect(await prisma.payment.findFirstOrThrow({ where: { statementLineId: second.id } })).toMatchObject({ rentalId, grossTetri: 15000 });
    const rules = json<{ lines: { id: string; rule: string; reason: { code: string; name: string } | null; payerRule: { id: string; live: boolean } | null }[] }>(await call(owner, 'GET', '/api/statement-lines/by-rules'));
    expect(rules.lines.find((l) => l.id === second.id)).toMatchObject({ rule: 'payer_rule', reason: { code: 'payer_rule', name: `Relative Example ${t}` }, payerRule: { id: res.ruleId, live: true } });
    // The queue says who the payer is remembered as.
    await load(owner, inRow(today(), '1.01', from(`Relative Example ${t}`, ' odd')));
    const queue = json<{ lines: { raw: string; remembered: { kind: string; customerId: string | null; customerName: string | null } | null; canRemember: boolean }[] }>(await call(owner, 'GET', '/api/statement-lines?direction=in'));
    expect(queue.lines.find((l) => l.raw.includes(`${t}; Account`) && l.raw.includes('odd'))).toMatchObject({ canRemember: true, remembered: { kind: 'customer', customerName: expect.stringContaining('Тест Арендатор') } });
  });

  it('a line the rule cannot place without a doubt waits: no debt, or a sum that fits nothing', async () => {
    const { prisma, owner, rentalId } = await rental();
    const t = tag();
    await load(owner, inRow(today(), '330.00', from(`Payer Example ${t}`)));
    const first = await lineOf(t);
    expect(json<{ ruleId: string }>(await call(owner, 'POST', `/api/statement-lines/${first.id}/assign`, { rentalId, remember: true })).ruleId).toBeTruthy();
    // Paid up: 150 more from him has nothing owed to go on.
    await load(owner, inRow(today(), '150.00', from(`Payer Example ${t}`, ' ahead')));
    const ahead = await prisma.statementLine.findFirstOrThrow({ where: { raw: { contains: `${t}; Account` }, amountTetri: 15000 } });
    expect(ahead.status).toBe('unmatched');
  });

  it('remembering sorts the lines already waiting from that payer', async () => {
    const { prisma, owner, rentalId } = await rental();
    const t = tag();
    // 180 and 150: two lines from one sender — the deposit, then the week.
    await load(owner, inRow(today(), '180.00', from(`Brother Example ${t}`)), inRow(today(), '150.00', from(`Brother Example ${t}`, ' week')));
    const lines = await prisma.statementLine.findMany({ where: { raw: { contains: `${t}; Account` } }, orderBy: { amountTetri: 'desc' } });
    expect(lines.map((l) => l.status)).toEqual(['unmatched', 'unmatched']);
    const res = json<{ id: string; ruleId: string; alsoSorted: string[] }>(await call(owner, 'POST', `/api/statement-lines/${lines[0].id}/assign`, { rentalId, remember: true }));
    expect(res.alsoSorted).toEqual([lines[1].id]);
    expect((await prisma.statementLine.findUniqueOrThrow({ where: { id: lines[1].id } })).status).toBe('matched');
    // «Отменить» right after: the payment of the line, then the rule with what it sorted.
    expect((await call(owner, 'POST', `/api/payments/${res.id}/undo`)).statusCode).toBe(200);
    expect(json<{ restored: number }>(await call(owner, 'POST', `/api/payer-rules/${res.ruleId}/undo`)).restored).toBe(1);
    expect((await prisma.statementLine.findMany({ where: { raw: { contains: `${t}; Account` } } })).map((l) => l.status)).toEqual(['unmatched', 'unmatched']);
    expect(await prisma.payment.count({ where: { rentalId, voidedAt: null } })).toBe(0);
    expect((await prisma.payerRule.findUniqueOrThrow({ where: { id: res.ruleId } })).archivedAt).not.toBeNull();
  });

  it('a card line or a sale has no payer to remember', async () => {
    const { owner, rentalId } = await rental();
    const t = tag();
    await load(owner, inRow(today(), '325.05', `Caricxva - Tanxa GEL325.05; Wallet/domestic MC cards ${t}`));
    const card = await lineOf(t);
    expect(json<{ error: string }>(await call(owner, 'POST', `/api/statement-lines/${card.id}/assign`, { rentalId, remember: true })).error).toBe('no_payer');
    const t2 = tag();
    await load(owner, inRow(today(), '99.00', from(`Buyer Example ${t2}`)));
    const other = await lineOf(t2);
    expect(json<{ error: string }>(await call(owner, 'POST', `/api/statement-lines/${other.id}/assign`, { saleId: rentalId, remember: true })).error).toBe('remember_rent_only');
  });
});

describe.skipIf(!HAS_DB)('the panel beside a line (issue #13)', () => {
  it('«Аренда»: the payer’s own rental first, by name; a rental of the same sum after it, without a mark; a search by the VIN', async () => {
    const named = await rental({ phone: '+995 555 00 00 01', georgian: true });
    const sameSum = await rental();
    const t = named.tag;
    // The bank writes the card's Georgian name in its own Latin.
    await load(named.owner, inRow(today(), '150.00', from(`testaZe gela ${t}`, ' x')));
    const line = await lineOf(t);
    const { options } = json<{ options: Option[] }>(await call(named.owner, 'GET', `/api/statement-lines/${line.id}/options?kind=rental`));
    const mine = options.findIndex((o) => o.target.rentalId === named.rentalId);
    const other = options.findIndex((o) => o.target.rentalId === sameSum.rentalId);
    expect(mine).toBe(0);
    expect(options[mine]).toMatchObject({ probable: 'name' });
    expect(options[other]).toMatchObject({ probable: null, fits: true });
    expect(options[mine].plan).toEqual([{ kind: 'deposit', tetri: 15000 }]);
    expect(options[mine].payDay).toBeGreaterThanOrEqual(1);

    const byVin = json<{ options: Option[] }>(await call(named.owner, 'GET', `/api/statement-lines/${line.id}/options?kind=rental&q=${sameSum.vehicle.vin.slice(-4)}`)).options;
    expect(byVin.map((o) => o.target.rentalId)).toEqual([sameSum.rentalId]);
    const byFleet = json<{ options: Option[] }>(await call(named.owner, 'GET', `/api/statement-lines/${line.id}/options?kind=rental&q=${fleetNumber(sameSum.vehicle.fleetNo)}`)).options;
    expect(byFleet.map((o) => o.target.rentalId)).toEqual([sameSum.rentalId]);
    const byPhone = json<{ options: Option[] }>(await call(named.owner, 'GET', `/api/statement-lines/${line.id}/options?kind=rental&q=5550000`)).options;
    expect(byPhone.map((o) => o.target.rentalId)).toContain(named.rentalId);
  });

  it('«Залог»: rentals with a deposit still to pay; «Ремонт / начисление»: a charge, paid alone', async () => {
    const { prisma, owner, rentalId, tag: t } = await rental();
    const fine = await prisma.rentalCharge.create({ data: { rentalId, kind: 'fine', amountTetri: 4000, note: 'test fine' } });
    await load(owner, inRow(today(), '40.00', from(`Somebody Else ${t}`)));
    const line = await lineOf(t);
    const deposits = json<{ options: Option[] }>(await call(owner, 'GET', `/api/statement-lines/${line.id}/options?kind=deposit`)).options;
    expect(deposits.find((o) => o.target.rentalId === rentalId)).toMatchObject({ owesTetri: expect.any(Number) });
    // A returned rental's deposit is the return's to settle, not a line's.
    const returned = await rental();
    await prisma.rental.update({ where: { id: returned.rentalId }, data: { status: 'returned' } });
    const after = json<{ options: Option[] }>(await call(owner, 'GET', `/api/statement-lines/${line.id}/options?kind=deposit`)).options;
    expect(after.map((o) => o.target.rentalId)).not.toContain(returned.rentalId);
    const repairs = json<{ options: Option[] }>(await call(owner, 'GET', `/api/statement-lines/${line.id}/options?kind=repair`)).options;
    const charge = repairs.find((o) => o.target.chargeId === fine.id)!;
    expect(charge).toMatchObject({ owesTetri: 4000, fits: true });
    expect((await call(owner, 'POST', `/api/statement-lines/${line.id}/assign`, charge.target)).statusCode).toBe(200);
    const p = await prisma.payment.findFirstOrThrow({ where: { statementLineId: line.id }, include: { allocations: true } });
    expect(p.allocations).toEqual([expect.objectContaining({ target: 'charge', chargeId: fine.id, amountTetri: 4000 })]);
  });

  it('an unknown kind is refused in words', async () => {
    const owner = await loginAs('owner');
    const t = tag();
    await load(owner, inRow(today(), '1.11', from(`Nobody ${t}`)));
    const line = await lineOf(t);
    expect(json<{ error: string }>(await call(owner, 'GET', `/api/statement-lines/${line.id}/options?kind=nothing`)).error).toBe('bad_field');
  });
});

describe.skipIf(!HAS_DB)('«Несколько услуг»: a deposit as a part of its own (issue #13, acceptance 3)', () => {
  it('250 = deposit 180 + rent 70: the deposit takes its part, the rent its own, no more than the deposit asks', async () => {
    const { prisma, owner, rentalId, tag: t } = await rental();
    await load(owner, inRow(today(), '250.00', from(`Split Example ${t}`)));
    const line = await lineOf(t);
    const over = await call(owner, 'POST', `/api/statement-lines/${line.id}/split`, { parts: [{ depositRentalId: rentalId, grossTetri: '190' }, { rentalId, rentOnly: true, grossTetri: '60' }] });
    expect(json<{ error: string }>(over).error).toBe('split_over_deposit');
    const res = await call(owner, 'POST', `/api/statement-lines/${line.id}/split`, { parts: [{ depositRentalId: rentalId, grossTetri: '180' }, { rentalId, rentOnly: true, grossTetri: '70' }] });
    expect(res.statusCode, res.body).toBe(200);
    const payments = await prisma.payment.findMany({ where: { statementLineId: line.id }, orderBy: { statementPart: 'asc' }, include: { allocations: true } });
    expect(payments.map((p) => p.allocations.map((a) => [a.target, a.amountTetri]))).toEqual([[['deposit', 18000]], [['period', 7000]]]);
    const card = json<{ deposit: { paidTetri: number } }>(await call(owner, 'GET', `/api/rentals/${rentalId}`));
    expect(card.deposit.paidTetri).toBe(18000);
  });
});

describe.skipIf(!HAS_DB)('«Отчёты → Поступления»', () => {
  it('counts the customers’ money by what it paid, the deposit apart, and what still waits', async () => {
    const { owner, rentalId, tag: t } = await rental();
    const day = addDays(today(), -400);
    const r0 = json<{ customers: { rent: number; deposits: number }; unsorted: number }>(await call(owner, 'GET', `/api/reports/incoming?from=${day}&to=${day}`));
    await load(owner, inRow(day, '330.00', from(`Report Example ${t}`)), inRow(day, '12.34', from(`Report Example ${t}`, ' left')));
    const { prisma } = await import('../src/lib/db.js');
    const line = await prisma.statementLine.findFirstOrThrow({ where: { raw: { contains: `${t}; Account` }, amountTetri: 33000 } });
    expect((await call(owner, 'POST', `/api/statement-lines/${line.id}/assign`, { rentalId })).statusCode).toBe(200);
    const r = json<{ customers: { rent: number; deposits: number }; unsorted: number; totalInTetri: number }>(await call(owner, 'GET', `/api/reports/incoming?from=${day}&to=${day}`));
    expect(r.customers.deposits - r0.customers.deposits).toBe(18000);
    expect(r.customers.rent - r0.customers.rent).toBe(15000);
    expect(r.unsorted - r0.unsorted).toBe(1234);
  });
});
