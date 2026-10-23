// Goods sold over the counter (issue #11, ADR-0045; Mika 23.10.2026 «А»).
//
// The director's acceptance cases and the session's defaults, on live rows: a
// charger to a retail buyer by card whose TBC line arrives later, a part for
// cash at the till, cancellations both ways, «Разобрать» that never links
// beyond what is open, selling beyond the count, the stocktake question, the
// rights, one key one sale, and the last charger wanted twice at once.
// Buyers, items and phones are invented: the repository is public.
import { acquiringNet, addDays, goodsCancelNote, todayISO } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, getApp, json, loginAs, makeUser, login, uniq } from './helpers.js';

const today = () => todayISO();

type Sold = { id: string; number: string; paymentId: string | null; openTetri: number };
type Err = { error: string; field?: string; lines?: { index: number; available: number; asked: number }[]; lastCountOn?: string; number?: string; openTetri?: number; paymentId?: string };
type Card = {
  sale: { id: string; number: string; status: string; state: string; openTetri: number; paidTetri: number; totals: { grossTetri: number; netTetri: number; vatTetri: number }; lines: { stockFrom: string; priceEdited: boolean; unitCostTetri: number | null; shelfPriceTetri: number | null }[]; cancelReason: string | null };
  payments: { id: string; fate: string; channel: string; grossTetri: number }[];
  can: { cancel: boolean; undo: boolean; edit: boolean };
};

const db = async () => (await import('../src/lib/db.js')).prisma;
const sell = (cookie: string, body: Record<string, unknown>) => call(cookie, 'POST', '/api/goods-sales', body);
const card = async (cookie: string, id: string) => json<Card>(await call(cookie, 'GET', `/api/goods-sales/${id}`));
const charger = (over: Record<string, unknown> = {}) => ({ countedItem: 'charger', spec: '73V6A', qty: 1, unitPriceTetri: 100_00, ...over });

/** A part with a price for the customer and a first count at a cost; invented names. */
async function newPart(owner: string, o: { priceTetri?: number | null; qty?: number; costTetri?: number; on?: string } = {}) {
  const res = await call(owner, 'POST', '/api/parts', { name: `Brake pad (example) ${uniq()}`, nameKa: `სამუხრუჭე ხუნდი (მაგალითი) ${uniq()}`, salePriceTetri: o.priceTetri === undefined ? 35_00 : o.priceTetri });
  expect(res.statusCode, res.body).toBe(201);
  const { id } = json<{ id: string }>(res);
  if ((o.qty ?? 5) > 0) {
    const init = await call(owner, 'POST', `/api/parts/${id}/initial`, { qty: o.qty ?? 5, unitCostTetri: o.costTetri ?? 20_00, occurredOn: o.on ?? today() });
    expect(init.statusCode, init.body).toBe(201);
  }
  return id;
}

const onHand = async (owner: string, partId: string) => json<{ part: { onHand: number } }>(await call(owner, 'GET', `/api/parts/${partId}`)).part.onHand;

/** The charger count as an owner counts it today: N in the showroom, nothing in repair. */
async function countChargers(owner: string, showroomQty: number) {
  const res = await call(owner, 'POST', '/api/batteries/inventory', { item: 'charger', showroomQty, repairQty: 0, reason: 'test: counted for the goods suite' });
  expect(res.statusCode, res.body).toBe(201);
}
const showroom = async (owner: string) => json<{ showroom: number }>(await call(owner, 'GET', '/api/batteries?item=charger')).showroom;

/** A TBC terminal settlement as the bank sends it: the net credited, the card sum stated. */
async function tbcCardLine(grossTetri: number, occurredOn = today()) {
  const prisma = await db();
  const statement = await prisma.statement.create({ data: { bank: 'tbc', fileName: `transactions_history_${uniq()}.csv`, fileSha256: `test-${uniq()}` } });
  const net = acquiringNet(grossTetri);
  return prisma.statementLine.create({
    data: {
      statementId: statement.id,
      bank: 'tbc',
      naturalKey: `goods-${uniq()}`,
      occurredOn: new Date(`${occurredOn}T00:00:00Z`),
      direction: 'in',
      amountTetri: net,
      payer: 'Wallet/domestic/საერთაშორისო ბარათებით თიბისის სავაჭრო ობიექტებში',
      purpose: null,
      raw: `Wallet/domestic/x | ${occurredOn}_ის ტრანზაქციის თანხები E MOTION MOTORS LLC, TBC BANK, Visa, ${(grossTetri / 100).toFixed(2)}, SH${uniq().replace(/\D/g, '').slice(-6)},,V`,
    },
  });
}

/** A transfer line, named or not. */
async function transferLine(amountTetri: number, payer: string | null = null, occurredOn = today()) {
  const prisma = await db();
  const statement = await prisma.statement.create({ data: { bank: 'bog', fileName: `StatementExport ${uniq()}`, fileSha256: `test-${uniq()}` } });
  return prisma.statementLine.create({
    data: { statementId: statement.id, bank: 'bog', naturalKey: `goods-${uniq()}`, occurredOn: new Date(`${occurredOn}T00:00:00Z`), direction: 'in', amountTetri, payer, purpose: 'nawili', raw: `Transfer ${uniq()}` },
  });
}

/** A customer renting a moped since ten days ago, with weeks owed. */
async function renter(owner: string, rateTetri = 140_00, name = `Клиент Пример ${uniq()}`) {
  const prisma = await db();
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Model ${uniq()}`, forRent: true } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `GOODS${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id } });
  const customer = await prisma.customer.create({ data: { name } });
  const res = await call(owner, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: rateTetri, pickedUpOn: addDays(today(), -10) });
  expect(res.statusCode, res.body).toBe(201);
  return { customerId: customer.id, rentalId: json<{ id: string }>(res).id, name };
}

const week = async (owner: string) => json<{ from: string; to: string; money: { totalTetri: number; rentTetri: number; saleTetri: number; depositsInTetri: number; serviceTetri: number; goodsTetri: number; acquiringFeeTetri: number } }>(await call(owner, 'GET', '/api/reports/week'));
const rows = (m: { rentTetri: number; saleTetri: number; depositsInTetri: number; serviceTetri: number; goodsTetri: number }) => m.rentTetri + m.saleTetri + m.depositsInTetri + m.serviceTetri + m.goodsTetri;

describe.skipIf(!HAS_DB)('a charger to a retail buyer by card (acceptance 1)', () => {
  it('waits for the bank, stops the rental rules in «Разобрать», is offered there, and is paid by the TBC line less 1.5 %', async () => {
    const owner = await loginAs('owner');
    const manager = await loginAs('manager');
    await countChargers(owner, 4);
    // A rental at 100 a week handed over today: the card rule would take a 100 card line for it.
    const prisma = await db();
    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Model ${uniq()}`, forRent: true } });
    const vehicle = await prisma.vehicle.create({ data: { vin: `GOODC${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id } });
    const c = await prisma.customer.create({ data: { name: `Клиент Пример ${uniq()}` } });
    expect((await call(owner, 'POST', '/api/rentals', { customerId: c.id, vehicleId: vehicle.id, weeklyRateTetri: 100_00, pickedUpOn: today() })).statusCode).toBe(201);

    const before = await week(owner);
    const res = await sell(manager, { lines: [charger()], promisedChannel: 'acquiring' });
    expect(res.statusCode, res.body).toBe(201);
    const sold = json<Sold>(res);
    expect(sold).toMatchObject({ paymentId: null, openTetri: 100_00 });
    expect(sold.number).toMatch(/^TS-\d{5}$/);
    expect(await showroom(owner)).toBe(3);
    expect((await card(manager, sold.id)).sale).toMatchObject({ state: 'waiting_bank', openTetri: 100_00, totals: { grossTetri: 100_00, netTetri: 84_75, vatTetri: 15_25 } });
    expect(await prisma.payment.count({ where: { goodsSaleId: sold.id } })).toBe(0);

    const line = await tbcCardLine(100_00);
    expect(line.amountTetri).toBe(98_50);
    const { decide, loadCtx, storedLine, suggest } = await import('../src/lib/statements/reconcile.js');
    const ctx = await loadCtx();
    expect(decide(storedLine(line), ctx)).toEqual({ type: 'queue' });
    // The hints as this suite's own records give them: the suites share one database, and other suites' rentals of
    // 100 handed over today would fill the eight places first. The card's rental of the day leads, the goods sale follows.
    const mine = { ...ctx, rentals: ctx.rentals.filter((r) => r.customerId === c.id), sales: [], payments: [], bankDeposits: [], goods: ctx.goods.filter((g) => g.id === sold.id) };
    const hints = suggest(storedLine(line), mine).suggestions;
    expect(hints.map((h) => h.kind)).toEqual(['rental', 'goods_sale']);
    expect(hints[1]).toMatchObject({ id: sold.id, retail: true, reason: { code: 'goods', number: sold.number, debtTetri: 100_00, channel: 'acquiring' } });

    const assigned = await call(owner, 'POST', `/api/statement-lines/${line.id}/assign`, { goodsSaleId: sold.id });
    expect(assigned.statusCode, assigned.body).toBe(200);
    const pay = await prisma.payment.findFirstOrThrow({ where: { goodsSaleId: sold.id } });
    expect(pay).toMatchObject({ kind: 'goods', channel: 'acquiring', grossTetri: 100_00, feeTetri: 1_50, netTetri: 98_50, customerId: null, source: 'statement' });
    expect((await card(owner, sold.id)).sale).toMatchObject({ state: 'paid', openTetri: 0 });

    const after = await week(owner);
    expect(after.money.goodsTetri - before.money.goodsTetri).toBe(100_00);
    expect(after.money.acquiringFeeTetri - before.money.acquiringFeeTetri).toBe(1_50);
    expect(rows(after.money)).toBe(after.money.totalTetri);
  });
});

describe.skipIf(!HAS_DB)('a part for cash at the counter (acceptance 2)', () => {
  it('takes one off the shelf at the shelf\'s cost, puts the cash in the seller\'s till, and the payments of the goods row add up to the week', async () => {
    const owner = await loginAs('owner');
    const managerUser = await makeUser('manager');
    const manager = await login(managerUser.email);
    const partId = await newPart(owner, { qty: 5, costTetri: 20_00 });
    const tillBefore = json<{ rows: { userId: string; onHandTetri: number }[] }>(await call(manager, 'GET', '/api/till')).rows.find((r) => r.userId === managerUser.id)?.onHandTetri ?? 0;

    const res = await sell(manager, { lines: [{ partId, qty: 1, unitPriceTetri: 35_00 }], paidNow: { channel: 'cash', amountTetri: 35_00 } });
    expect(res.statusCode, res.body).toBe(201);
    const sold = json<Sold>(res);
    expect(sold.openTetri).toBe(0);
    expect(sold.paymentId).not.toBeNull();
    const prisma = await db();
    const line = await prisma.goodsSaleLine.findFirstOrThrow({ where: { saleId: sold.id } });
    expect(line).toMatchObject({ unitCostTetri: 20_00, shelfPriceTetri: 35_00, stockFrom: 'shelf' });
    const issue = await prisma.stockMove.findFirstOrThrow({ where: { goodsSaleLineId: line.id } });
    expect(issue).toMatchObject({ kind: 'issue', qty: -1, reason: sold.number });
    expect(await onHand(owner, partId)).toBe(4);
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: sold.paymentId! } })).toMatchObject({ kind: 'goods', channel: 'cash', grossTetri: 35_00, createdById: managerUser.id });

    const tillAfter = json<{ rows: { userId: string; onHandTetri: number }[] }>(await call(manager, 'GET', '/api/till')).rows.find((r) => r.userId === managerUser.id)!.onHandTetri;
    expect(tillAfter - tillBefore).toBe(35_00);

    const w = await week(owner);
    const list = json<{ totals: { rowTetri: number } }>(await call(owner, 'GET', `/api/payments?from=${w.from}&to=${w.to}&row=goods`));
    expect(list.totals.rowTetri).toBe(w.money.goodsTetri);
    expect(rows(w.money)).toBe(w.money.totalTetri);
  });
});

describe.skipIf(!HAS_DB)('«Платежи» by «Основание» (QA 23.10.2026)', () => {
  it('lists a voided payment only under the row of its own kind, and counts it under none', async () => {
    const owner = await loginAs('owner');
    const r = await renter(owner);
    const partId = await newPart(owner, { qty: 2 });
    // A goods payment voided by the seller's undo, and a rent payment voided by an owner.
    const sold = json<Sold>(await sell(owner, { lines: [{ partId, qty: 1, unitPriceTetri: 35_00 }], paidNow: { channel: 'cash', amountTetri: 35_00 } }));
    expect((await call(owner, 'POST', `/api/goods-sales/${sold.id}/undo`)).statusCode).toBe(200);
    const rent = await call(owner, 'POST', '/api/payments', { rentalId: r.rentalId, channel: 'cash', grossTetri: 140_00 });
    expect(rent.statusCode, rent.body).toBe(201);
    const rentId = json<{ id: string }>(rent).id;
    expect((await call(owner, 'POST', `/api/payments/${rentId}/void`, { reason: 'test: entered twice' })).statusCode).toBe(200);

    const w = await week(owner);
    type List = { totals: { rowTetri: number }; payments: { id: string; voided: boolean }[] };
    const listed = async (row: string) => json<List>(await call(owner, 'GET', `/api/payments?from=${w.from}&to=${w.to}&row=${row}`));
    const goods = await listed('goods');
    const rentRow = await listed('rent');
    const deposits = await listed('deposits');
    expect(goods.payments.map((p) => p.id)).toContain(sold.paymentId);
    expect(goods.payments.map((p) => p.id)).not.toContain(rentId);
    expect(rentRow.payments.map((p) => p.id)).toContain(rentId);
    expect(rentRow.payments.map((p) => p.id)).not.toContain(sold.paymentId);
    expect(deposits.payments.map((p) => p.id)).not.toContain(rentId);
    expect(deposits.payments.map((p) => p.id)).not.toContain(sold.paymentId);
    // Shown, not counted: each list still adds up to its figure of the week.
    expect(goods.totals.rowTetri).toBe(w.money.goodsTetri);
    expect(rentRow.totals.rowTetri).toBe(w.money.rentTetri);
  });
});

describe.skipIf(!HAS_DB)('a cancellation', () => {
  it('an own customer\'s: the part comes back at its cost, his cash becomes his credit and pays his weeks, the journal says both (acceptance 4)', async () => {
    const owner = await loginAs('owner');
    const r = await renter(owner);
    const partId = await newPart(owner, { qty: 3, costTetri: 20_00 });
    const sold = json<Sold>(await sell(owner, { customerId: r.customerId, lines: [{ partId, qty: 1, unitPriceTetri: 35_00 }], paidNow: { channel: 'cash', amountTetri: 35_00 } }));
    const debtBefore = json<{ owesTetri: number }>(await call(owner, 'GET', `/api/customers/${r.customerId}/balance`)).owesTetri;
    const weekBefore = await week(owner);

    const plan = json<{ goods: { beforeQty: number; afterQty: number }[]; payments: { fate: string }[]; creditCloses: unknown[] }>(await call(owner, 'GET', `/api/goods-sales/${sold.id}/cancel-plan`));
    expect(plan.goods[0]).toMatchObject({ beforeQty: 2, afterQty: 3 });
    expect(plan.payments.map((p) => p.fate)).toEqual(['credit']);
    expect(plan.creditCloses.length).toBeGreaterThan(0);

    expect((await call(owner, 'POST', `/api/goods-sales/${sold.id}/cancel`, {})).statusCode).toBe(400);
    const res = await call(owner, 'POST', `/api/goods-sales/${sold.id}/cancel`, { reason: 'test: the buyer brought it back' });
    expect(res.statusCode, res.body).toBe(200);
    const prisma = await db();
    expect(await onHand(owner, partId)).toBe(3);
    const back = await prisma.stockMove.findFirstOrThrow({ where: { goodsSaleLine: { saleId: sold.id }, kind: 'return' } });
    expect(back).toMatchObject({ qty: 1, unitCostTetri: 20_00 });
    const pay = await prisma.payment.findUniqueOrThrow({ where: { id: sold.paymentId! }, include: { allocations: true } });
    expect(pay).toMatchObject({ kind: 'on_account', goodsSaleId: sold.id, voidedAt: null });
    expect(pay.allocations.reduce((n, a) => n + a.amountTetri, 0)).toBe(35_00);
    const debtAfter = json<{ owesTetri: number }>(await call(owner, 'GET', `/api/customers/${r.customerId}/balance`)).owesTetri;
    expect(debtBefore - debtAfter).toBe(35_00);
    expect(await prisma.auditLog.count({ where: { entityId: sold.id, action: 'goods_sale.cancel' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: pay.id, action: 'payment.rebook' } })).toBe(1);
    expect((await card(owner, sold.id)).sale).toMatchObject({ status: 'cancelled', state: 'cancelled', openTetri: 0 });
    expect((await card(owner, sold.id)).payments.map((p) => p.fate)).toEqual(['credit']);

    // The week: the money moved out of goods into what it paid now; the total did not move.
    const weekAfter = await week(owner);
    expect(weekBefore.money.goodsTetri - weekAfter.money.goodsTetri).toBe(35_00);
    expect(weekAfter.money.totalTetri).toBe(weekBefore.money.totalTetri);
    expect(rows(weekAfter.money)).toBe(weekAfter.money.totalTetri);

    expect((await call(owner, 'POST', `/api/goods-sales/${sold.id}/cancel`, { reason: 'again' })).statusCode).toBe(409);
  });

  it('a retail buyer\'s paid by a bank line: the charger comes back, the payment is voided with the reason, the line goes back to «Разобрать» (acceptance 5)', async () => {
    const owner = await loginAs('owner');
    await countChargers(owner, 2);
    const line = await tbcCardLine(87_00);
    const res = await sell(owner, { lines: [charger({ unitPriceTetri: 87_00, spec: '60V3A' })], paidNow: { statementLineId: line.id } });
    expect(res.statusCode, res.body).toBe(201);
    const sold = json<Sold>(res);
    expect(sold.openTetri).toBe(0);
    expect(await showroom(owner)).toBe(1);
    const prisma = await db();
    expect((await prisma.statementLine.findUniqueOrThrow({ where: { id: line.id } })).status).toBe('matched');

    const cancelled = await call(owner, 'POST', `/api/goods-sales/${sold.id}/cancel`, { reason: 'test: returned the same day' });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(await showroom(owner)).toBe(2);
    const move = await prisma.batteryMove.findFirstOrThrow({ where: { goodsSaleLine: { saleId: sold.id }, kind: 'sale_cancelled' } });
    expect(move).toMatchObject({ item: 'charger', qty: 1 });
    const pay = await prisma.payment.findUniqueOrThrow({ where: { id: sold.paymentId! } });
    expect(pay.voidedAt).not.toBeNull();
    // Written in the one shape a screen reads back: the code's part in the reader's words, the owner's as typed.
    expect(goodsCancelNote(pay.voidReason)).toEqual({ number: sold.number, undone: false, why: 'test: returned the same day' });
    expect(goodsCancelNote(move.reason)).toEqual({ number: sold.number, undone: false, why: 'test: returned the same day' });
    expect((await prisma.statementLine.findUniqueOrThrow({ where: { id: line.id } })).status).toBe('unmatched');
  });
});

describe.skipIf(!HAS_DB)('«Разобрать» links no more than is open (acceptance 6)', () => {
  it('refuses a whole line above the open sum, splits a line into rent and goods with the fee shared, and refuses a goods part above it', async () => {
    const owner = await loginAs('owner');
    const r = await renter(owner, 150_00);
    const partId = await newPart(owner, { qty: 5, priceTetri: 100_00 });
    const sold = json<Sold>(await sell(owner, { customerId: r.customerId, lines: [{ partId, qty: 1, unitPriceTetri: 100_00 }] }));
    expect(sold.openTetri).toBe(100_00);

    const tooMuch = await transferLine(150_00);
    const refused = await call(owner, 'POST', `/api/statement-lines/${tooMuch.id}/assign`, { goodsSaleId: sold.id });
    expect(refused.statusCode).toBe(409);
    expect(json<Err>(refused)).toMatchObject({ error: 'goods_over_open', number: sold.number, openTetri: 100_00 });

    const over = await tbcCardLine(270_00);
    const bad = await call(owner, 'POST', `/api/statement-lines/${over.id}/split`, { parts: [{ rentalId: r.rentalId, grossTetri: 150_00 }, { goodsSaleId: sold.id, grossTetri: 120_00 }] });
    expect(bad.statusCode).toBe(409);
    expect(json<Err>(bad)).toMatchObject({ error: 'split_over_goods', openTetri: 100_00 });

    const both = await tbcCardLine(250_00);
    const split = await call(owner, 'POST', `/api/statement-lines/${both.id}/split`, { parts: [{ rentalId: r.rentalId, grossTetri: 150_00 }, { goodsSaleId: sold.id, grossTetri: 100_00 }] });
    expect(split.statusCode, split.body).toBe(200);
    const prisma = await db();
    const parts = await prisma.payment.findMany({ where: { statementLineId: both.id }, orderBy: { statementPart: 'asc' } });
    expect(parts.map((p) => [p.kind, p.grossTetri, p.feeTetri])).toEqual([
      ['rent', 150_00, 2_25],
      ['goods', 100_00, 1_50],
    ]);
    expect((await card(owner, sold.id)).sale.state).toBe('paid');
  });
});

describe.skipIf(!HAS_DB)('more than there is (§1 п. 3, 5; acceptance 7)', () => {
  it('refuses a manager, asks an owner why, and lets a part go below nought on his word', async () => {
    const owner = await loginAs('owner');
    const manager = await loginAs('manager');
    const partId = await newPart(owner, { qty: 1 });
    const short = await sell(manager, { lines: [{ partId, qty: 2, unitPriceTetri: 35_00 }], paidNow: { channel: 'cash', amountTetri: 70_00 } });
    expect(short.statusCode).toBe(409);
    expect(json<Err>(short)).toMatchObject({ error: 'goods_short', lines: [{ index: 0, available: 1, asked: 2 }] });

    const reasonless = await sell(owner, { lines: [{ partId, qty: 2, unitPriceTetri: 35_00 }], paidNow: { channel: 'cash', amountTetri: 70_00 } });
    expect(reasonless.statusCode).toBe(400);
    expect(json<Err>(reasonless)).toMatchObject({ error: 'missing_field', field: 'lines[0].shortReason' });

    const res = await sell(owner, { lines: [{ partId, qty: 2, unitPriceTetri: 35_00, shortReason: 'test: one more was on the counter' }], paidNow: { channel: 'cash', amountTetri: 70_00 } });
    expect(res.statusCode, res.body).toBe(201);
    expect(await onHand(owner, partId)).toBe(-1);
    const prisma = await db();
    const { id } = json<Sold>(res);
    expect(await prisma.auditLog.findFirstOrThrow({ where: { entityId: id, action: 'goods_sale.minus' } })).toMatchObject({ before: { seq: 1, qty: 1 }, after: { seq: 1, qty: 2 } });
  });

  it('sells a charger beyond the count by finding it first, so the count stays where it was', async () => {
    const owner = await loginAs('owner');
    await countChargers(owner, 0);
    const res = await sell(owner, { lines: [charger({ shortReason: 'test: not counted yet' })], paidNow: { channel: 'cash', amountTetri: 100_00 } });
    expect(res.statusCode, res.body).toBe(201);
    expect(await showroom(owner)).toBe(0);
    const prisma = await db();
    const moves = await prisma.batteryMove.findMany({ where: { goodsSaleLine: { saleId: json<Sold>(res).id } }, orderBy: { createdAt: 'asc' } });
    expect(moves.map((m) => [m.kind, m.qty])).toEqual([
      ['found', 1],
      ['sold', 1],
    ]);
  });
});

describe.skipIf(!HAS_DB)('a sale dated before the last stocktake (§1 п. 9; acceptance 8)', () => {
  it('asks whether the count saw it gone, takes nothing when it did, and gives it back when cancelled', async () => {
    const owner = await loginAs('owner');
    const counted = addDays(today(), -8);
    const soldOn = addDays(today(), -15);
    const partId = await newPart(owner, { qty: 4, on: counted });
    const body = { soldOn, backdateReason: 'test: entered late', lines: [{ partId, qty: 1, unitPriceTetri: 35_00 }], paidNow: { channel: 'cash', amountTetri: 35_00 } };

    const asked = await sell(owner, body);
    expect(asked.statusCode).toBe(400);
    expect(json<Err>(asked)).toMatchObject({ error: 'goods_count_answer', field: 'lines[0].countedAlready', lastCountOn: counted });

    const res = await sell(owner, { ...body, lines: [{ ...body.lines[0], countedAlready: true }] });
    expect(res.statusCode, res.body).toBe(201);
    const { id } = json<Sold>(res);
    expect(await onHand(owner, partId)).toBe(4);
    expect((await card(owner, id)).sale.lines[0]!.stockFrom).toBe('count');
    const prisma = await db();
    expect(await prisma.payment.findFirstOrThrow({ where: { goodsSaleId: id } })).toMatchObject({ occurredOn: new Date(`${soldOn}T00:00:00Z`), backdateReason: 'test: entered late' });

    // Cancelled to put the entry right: the count had seen it gone, and nothing comes back unless the owner says so.
    type Plan = { goods: { stockFrom: string; back: boolean; beforeQty: number; afterQty: number }[] };
    expect(json<Plan>(await call(owner, 'GET', `/api/goods-sales/${id}/cancel-plan`)).goods[0]).toMatchObject({ stockFrom: 'count', back: false, beforeQty: 4, afterQty: 4 });
    expect(json<Plan>(await call(owner, 'GET', `/api/goods-sales/${id}/cancel-plan?countedBack=1`)).goods[0]).toMatchObject({ back: true, beforeQty: 4, afterQty: 5 });
    expect((await call(owner, 'POST', `/api/goods-sales/${id}/cancel`, { reason: 'test: wrong day' })).statusCode).toBe(200);
    expect(await onHand(owner, partId)).toBe(4);

    // Sold the same way and undone at once: an undo takes back only what the sale wrote.
    const again = json<Sold>(await sell(owner, { ...body, lines: [{ ...body.lines[0], countedAlready: true }] }));
    expect((await call(owner, 'POST', `/api/goods-sales/${again.id}/undo`)).statusCode).toBe(200);
    expect(await onHand(owner, partId)).toBe(4);

    // The goods did come back: on the owner's word the shelf has them again.
    const third = json<Sold>(await sell(owner, { ...body, lines: [{ ...body.lines[0], countedAlready: true }] }));
    expect((await call(owner, 'POST', `/api/goods-sales/${third.id}/cancel`, { reason: 'test: brought back', countedBack: true })).statusCode).toBe(200);
    expect(await onHand(owner, partId)).toBe(5);
  });
});

describe.skipIf(!HAS_DB)('the money at the counter (§1 п. 6, 7; acceptance 9)', () => {
  it('a retail buyer pays now or waits for the bank, nobody pays more than the sale, and only an owner attaches a bank line', async () => {
    const owner = await loginAs('owner');
    const manager = await loginAs('manager');
    const partId = await newPart(owner, { qty: 5 });
    const line = { partId, qty: 1, unitPriceTetri: 100_00 };

    const unpaid = await sell(manager, { lines: [line] });
    expect(unpaid.statusCode).toBe(409);
    expect(json<Err>(unpaid).error).toBe('retail_must_pay');

    const over = await sell(manager, { lines: [line], paidNow: { channel: 'cash', amountTetri: 120_00 } });
    expect(over.statusCode).toBe(409);
    expect(json<Err>(over).error).toBe('goods_paid_over');

    const bank = await tbcCardLine(100_00);
    const notHis = await sell(manager, { lines: [line], paidNow: { statementLineId: bank.id } });
    expect(notHis.statusCode).toBe(403);
    expect(json<Err>(notHis).error).toBe('reconcile_required');

    const res = await sell(owner, { lines: [line], paidNow: { statementLineId: bank.id } });
    expect(res.statusCode, res.body).toBe(201);
    const sold = json<Sold>(res);
    expect(sold.openTetri).toBe(0);
    const prisma = await db();
    expect((await prisma.statementLine.findUniqueOrThrow({ where: { id: bank.id } })).paymentId).toBe(sold.paymentId);
    expect(await onHand(owner, partId)).toBe(4);
  });

  it('offers an owner only a bank line of exactly the sum, and keeps the line chosen on the list', async () => {
    const owner = await loginAs('owner');
    const partId = await newPart(owner, { qty: 2 });
    const sum = 73_37;
    const cardLine = await tbcCardLine(sum);
    // A transfer of the card's net leaves the fee open; a card line whose net is the sum pays over it.
    const netTransfer = await transferLine(acquiringNet(sum));
    let over = sum;
    while (acquiringNet(over) !== sum) over++;
    const cardOver = await tbcCardLine(over);
    type Preview = { inBank: { lineId: string }[]; paidNowTetri: number; openTetri: number; paymentProblem: string | null };
    const ids = (p: Preview) => p.inBank.map((l) => l.lineId);
    const body = { lines: [{ partId, qty: 1, unitPriceTetri: sum }], promisedChannel: 'acquiring' };

    const offered = json<Preview>(await call(owner, 'POST', '/api/goods-sales/preview', body));
    expect(ids(offered)).toContain(cardLine.id);
    expect(ids(offered)).not.toContain(netTransfer.id);
    expect(ids(offered)).not.toContain(cardOver.id);

    const chosen = json<Preview>(await call(owner, 'POST', '/api/goods-sales/preview', { ...body, paidNow: { statementLineId: cardLine.id } }));
    expect(ids(chosen)).toContain(cardLine.id);
    expect(chosen).toMatchObject({ paidNowTetri: sum, openTetri: 0, paymentProblem: null });
  });
});

describe.skipIf(!HAS_DB)('an own customer\'s goods debt (acceptance 10)', () => {
  it('is a part of his one figure, stops a manager\'s hand-over, and a line naming him on exactly it is attached by the name rule', async () => {
    const owner = await loginAs('owner');
    const manager = await loginAs('manager');
    const prisma = await db();
    const name = `Покупатель Пример ${uniq()}`;
    const customer = await prisma.customer.create({ data: { name } });
    const partId = await newPart(owner, { qty: 5, priceTetri: 43_17 });
    const sold = json<Sold>(await sell(manager, { customerId: customer.id, lines: [{ partId, qty: 1, unitPriceTetri: 43_17 }] }));
    expect(sold.openTetri).toBe(43_17);
    const debt = json<{ owesTetri: number; parts: { kind: string; number: string; owesTetri: number }[] }>(await call(owner, 'GET', `/api/customers/${customer.id}/balance`));
    expect(debt.owesTetri).toBe(43_17);
    expect(debt.parts).toEqual([{ kind: 'goods', id: sold.id, number: sold.number, owesTetri: 43_17 }]);
    const targets = json<{ goods: { id: string; openTetri: number }[] }>(await call(owner, 'GET', `/api/customers/${customer.id}/money-targets`));
    expect(targets.goods).toEqual([expect.objectContaining({ id: sold.id, openTetri: 43_17 })]);

    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Model ${uniq()}`, forRent: true } });
    const vehicle = await prisma.vehicle.create({ data: { vin: `GOODD${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id } });
    const handOver = await call(manager, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 140_00, pickedUpOn: today() });
    expect(handOver.statusCode).toBe(403);
    expect(json<Err>(handOver).error).toBe('customer_in_debt');

    const { decide, loadCtx, storedLine } = await import('../src/lib/statements/reconcile.js');
    const named = await transferLine(43_17, name);
    expect(decide(storedLine(named), await loadCtx())).toMatchObject({ type: 'rule', rule: 'payer_name', target: { goodsSaleId: sold.id }, customerId: customer.id });
  });

  it('waits for a person when the same customer also owes a rental of the same sum', async () => {
    const owner = await loginAs('owner');
    const r = await renter(owner, 70_00, `Покупатель Пример ${uniq()}`);
    // What the rental owes now, its deposit included: the sum its own name rule would take.
    const owes = json<{ owesTetri: number }>(await call(owner, 'GET', `/api/customers/${r.customerId}/balance`)).owesTetri;
    const partId = await newPart(owner, { qty: 2, priceTetri: owes });
    json<Sold>(await sell(owner, { customerId: r.customerId, lines: [{ partId, qty: 1, unitPriceTetri: owes }] }));
    const { decide, loadCtx, storedLine } = await import('../src/lib/statements/reconcile.js');
    expect(decide(storedLine(await transferLine(owes, r.name)), await loadCtx())).toEqual({ type: 'queue' });
  });
});

describe.skipIf(!HAS_DB)('a price edited at the counter (acceptance 11)', () => {
  it('journals the edit and shows it on the card', async () => {
    const owner = await loginAs('owner');
    const partId = await newPart(owner, { qty: 2, priceTetri: 130_00 });
    const sold = json<Sold>(await sell(owner, { lines: [{ partId, qty: 1, unitPriceTetri: 100_00 }], paidNow: { channel: 'cash', amountTetri: 100_00 } }));
    const prisma = await db();
    // One key on both sides, so the journal's «было → стало» has the two prices to show.
    expect(await prisma.auditLog.findFirstOrThrow({ where: { entityId: sold.id, action: 'goods_sale.price' } })).toMatchObject({ before: { seq: 1, unitPriceTetri: 130_00 }, after: { seq: 1, unitPriceTetri: 100_00 } });
    expect((await card(owner, sold.id)).sale.lines[0]).toMatchObject({ priceEdited: true, shelfPriceTetri: 130_00 });
  });
});

describe.skipIf(!HAS_DB)('a retail payment inside a split bank line (acceptance 12)', () => {
  it('cannot be cancelled until the line is undone in «Разобрать»', async () => {
    const owner = await loginAs('owner');
    await countChargers(owner, 3);
    const a = json<Sold>(await sell(owner, { lines: [charger({ unitPriceTetri: 61_00, spec: 'A' })], promisedChannel: 'acquiring' }));
    const b = json<Sold>(await sell(owner, { lines: [charger({ unitPriceTetri: 39_00, spec: 'B' })], promisedChannel: 'acquiring' }));
    const line = await tbcCardLine(100_00);
    const split = await call(owner, 'POST', `/api/statement-lines/${line.id}/split`, { parts: [{ goodsSaleId: a.id, grossTetri: 61_00 }, { goodsSaleId: b.id, grossTetri: 39_00 }] });
    expect(split.statusCode, split.body).toBe(200);
    const refused = await call(owner, 'POST', `/api/goods-sales/${a.id}/cancel`, { reason: 'test' });
    expect(refused.statusCode).toBe(409);
    expect(json<Err>(refused).error).toBe('goods_payment_in_split');
    expect((await card(owner, a.id)).sale.status).toBe('active');
  });
});

describe.skipIf(!HAS_DB)('«Отменить» on the toast (§1 п. 11; acceptance 13)', () => {
  it('lets the seller undo within a minute, and nobody else, and not later', async () => {
    const owner = await loginAs('owner');
    const managerUser = await makeUser('manager');
    const manager = await login(managerUser.email);
    const other = await loginAs('manager');
    const partId = await newPart(owner, { qty: 3 });
    const sold = json<Sold>(await sell(manager, { lines: [{ partId, qty: 1, unitPriceTetri: 35_00 }], paidNow: { channel: 'cash', amountTetri: 35_00 } }));
    expect((await card(manager, sold.id)).can.undo).toBe(true);
    const notHis = await call(other, 'POST', `/api/goods-sales/${sold.id}/undo`);
    expect(notHis.statusCode).toBe(409);
    expect(json<Err>(notHis).error).toBe('goods_undo_too_late');

    const undone = await call(manager, 'POST', `/api/goods-sales/${sold.id}/undo`);
    expect(undone.statusCode, undone.body).toBe(200);
    expect(await onHand(owner, partId)).toBe(3);
    const prisma = await db();
    const undonePay = await prisma.payment.findUniqueOrThrow({ where: { id: sold.paymentId! } });
    expect(undonePay).toMatchObject({ voidKind: 'undo' });
    expect(goodsCancelNote(undonePay.voidReason)).toEqual({ number: sold.number, undone: true, why: '' });
    expect(await prisma.auditLog.count({ where: { entityId: sold.id, action: 'goods_sale.undo' } })).toBe(1);

    const late = json<Sold>(await sell(manager, { lines: [{ partId, qty: 1, unitPriceTetri: 35_00 }], paidNow: { channel: 'cash', amountTetri: 35_00 } }));
    await prisma.goodsSale.update({ where: { id: late.id }, data: { createdAt: new Date(Date.now() - 61_000) } });
    const tooLate = await call(manager, 'POST', `/api/goods-sales/${late.id}/undo`);
    expect(tooLate.statusCode).toBe(409);
    expect(json<Err>(tooLate).error).toBe('goods_undo_too_late');
  });
});

describe.skipIf(!HAS_DB)('who may do what (§13; acceptance 14)', () => {
  it('a mechanic sells nothing; a manager neither cancels, edits nor dates back, and never sees a cost', async () => {
    const owner = await loginAs('owner');
    const manager = await loginAs('manager');
    const mechanic = await loginAs('mechanic');
    const partId = await newPart(owner, { qty: 3, costTetri: 20_00 });
    const body = { lines: [{ partId, qty: 1, unitPriceTetri: 35_00 }], paidNow: { channel: 'cash', amountTetri: 35_00 } };
    expect((await sell(mechanic, body)).statusCode).toBe(403);
    expect((await call(mechanic, 'GET', '/api/goods-sales')).statusCode).toBe(403);

    const sold = json<Sold>(await sell(manager, body));
    expect((await call(manager, 'POST', `/api/goods-sales/${sold.id}/cancel`, { reason: 'test' })).statusCode).toBe(403);
    expect((await call(manager, 'PATCH', `/api/goods-sales/${sold.id}`, { buyerName: 'Другое Имя (пример)' })).statusCode).toBe(403);
    const back = await sell(manager, { ...body, soldOn: addDays(today(), -1), backdateReason: 'test' });
    expect(back.statusCode).toBe(403);
    expect(json<Err>(back).error).toBe('owner_only_backdate');
    expect((await card(manager, sold.id)).sale.lines[0]!.unitCostTetri).toBeNull();
    expect((await card(owner, sold.id)).sale.lines[0]!.unitCostTetri).toBe(20_00);
    const items = json<{ parts: { partId: string; avgCostTetri: number | null }[] }>(await call(manager, 'GET', `/api/goods-sales/items`));
    expect(items.parts.find((p) => p.partId === partId)?.avgCostTetri).toBeNull();
    const costed = await sell(manager, { lines: [{ countedItem: 'charger', qty: 1, unitPriceTetri: 100_00, unitCostTetri: 50_00 }], paidNow: { channel: 'cash', amountTetri: 100_00 } });
    expect(costed.statusCode).toBe(403);
    expect(json<Err>(costed).error).toBe('owner_only');
    expect(json<Err>(await sell(owner, { lines: [{ countedItem: 'battery', qty: 1, unitPriceTetri: 100_00 }], paidNow: { channel: 'cash', amountTetri: 100_00 } })).error).toBe('goods_item_not_sellable');
  });

  it('an owner edits a retail buyer\'s name, which sends the invoice handed out to the archive', async () => {
    const owner = await loginAs('owner');
    const partId = await newPart(owner, { qty: 2 });
    const sold = json<Sold>(await sell(owner, { buyerName: 'Покупатель (пример)', lines: [{ partId, qty: 1, unitPriceTetri: 35_00 }], paidNow: { channel: 'cash', amountTetri: 35_00 } }));
    expect((await call(owner, 'GET', `/api/goods-sales/${sold.id}/invoice.pdf`)).statusCode).toBe(200);
    const edit = await call(owner, 'PATCH', `/api/goods-sales/${sold.id}`, { buyerName: 'Другой Покупатель (пример)', buyerPhone: '555 000 000' });
    expect(edit.statusCode, edit.body).toBe(200);
    const prisma = await db();
    expect(await prisma.storedFile.count({ where: { goodsSaleId: sold.id, archived: false } })).toBe(0);
    expect(await prisma.auditLog.findFirstOrThrow({ where: { entityId: sold.id, action: 'goods_sale.update' } })).toMatchObject({ after: { buyerName: 'Другой Покупатель (пример)', buyerPhone: '555 000 000' } });
  });
});

describe.skipIf(!HAS_DB)('one key, one sale (acceptance 15) and the last charger wanted twice (acceptance 16)', () => {
  it('a sale sent twice with the same key is written once', async () => {
    const owner = await loginAs('owner');
    const manager = await loginAs('manager');
    const partId = await newPart(owner, { qty: 5 });
    const app = await getApp();
    const key = `goods-${uniq().replace(/\D/g, '')}`;
    const send = () =>
      app.inject({
        method: 'POST',
        url: '/api/goods-sales',
        payload: { lines: [{ partId, qty: 1, unitPriceTetri: 35_00 }], paidNow: { channel: 'cash', amountTetri: 35_00 } },
        headers: { cookie: manager, 'content-type': 'application/json', 'idempotency-key': key },
      });
    const first = await send();
    const second = await send();
    expect(first.statusCode, first.body).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(json<Sold>(second).id).toBe(json<Sold>(first).id);
    const prisma = await db();
    expect(await prisma.goodsSaleLine.count({ where: { partId } })).toBe(1);
    expect(await prisma.payment.count({ where: { goodsSaleId: json<Sold>(first).id } })).toBe(1);
    expect(await onHand(owner, partId)).toBe(4);
  });

  it('two counters selling the last charger at once: one sells it, the other is told there is none', async () => {
    const owner = await loginAs('owner');
    const [a, b] = [await loginAs('manager'), await loginAs('manager')];
    await countChargers(owner, 1);
    const body = { lines: [charger()], paidNow: { channel: 'cash', amountTetri: 100_00 } };
    const both = await Promise.all([sell(a, body), sell(b, body)]);
    expect(both.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(json<Err>(both.find((r) => r.statusCode === 409)!).error).toBe('goods_short');
    expect(await showroom(owner)).toBe(0);
  });
});

describe.skipIf(!HAS_DB)('cards merged (acceptance 17) and «Экономика» (acceptance 18)', () => {
  it('a merge takes the goods sales to the card that stays', async () => {
    const owner = await loginAs('owner');
    const prisma = await db();
    const keep = await prisma.customer.create({ data: { name: `Клиент Пример ${uniq()}` } });
    const drop = await prisma.customer.create({ data: { name: `Клиент Пример (дубль) ${uniq()}` } });
    const partId = await newPart(owner, { qty: 2 });
    const sold = json<Sold>(await sell(owner, { customerId: drop.id, lines: [{ partId, qty: 1, unitPriceTetri: 35_00 }] }));
    const merged = await call(owner, 'POST', `/api/customers/${keep.id}/merge`, { fromId: drop.id, reason: 'test: one person' });
    expect(merged.statusCode, merged.body).toBe(200);
    expect(json<{ moved: { goodsSales: number } }>(merged).moved.goodsSales).toBe(1);
    expect((await prisma.goodsSale.findUniqueOrThrow({ where: { id: sold.id } })).customerId).toBe(keep.id);
    expect(json<{ owesTetri: number }>(await call(owner, 'GET', `/api/customers/${keep.id}/balance`)).owesTetri).toBe(35_00);
  });

  it('counts revenue, VAT, net, cost and margin, and leaves a charger nobody priced out of the margin', async () => {
    const owner = await loginAs('owner');
    type Eco = { grossTetri: number; vatTetri: number; netTetri: number; costTetri: number; marginTetri: number; unknownCost: { lines: number; netTetri: number } };
    const before = json<Eco>(await call(owner, 'GET', '/api/economics/goods?all=1'));
    await countChargers(owner, 2);
    const partId = await newPart(owner, { qty: 2, costTetri: 20_00 });
    expect((await sell(owner, { lines: [charger()], paidNow: { channel: 'cash', amountTetri: 100_00 } })).statusCode).toBe(201);
    expect((await sell(owner, { lines: [{ partId, qty: 1, unitPriceTetri: 35_00 }], paidNow: { channel: 'cash', amountTetri: 35_00 } })).statusCode).toBe(201);
    const after = json<Eco>(await call(owner, 'GET', '/api/economics/goods?all=1'));
    expect(after.grossTetri - before.grossTetri).toBe(135_00);
    expect(after.vatTetri - before.vatTetri).toBe(15_25 + 5_34);
    expect(after.netTetri - before.netTetri).toBe(84_75 + 29_66);
    expect(after.costTetri - before.costTetri).toBe(20_00);
    expect(after.marginTetri - before.marginTetri).toBe(29_66 - 20_00);
    expect(after.unknownCost.lines - before.unknownCost.lines).toBe(1);
    expect(after.unknownCost.netTetri - before.unknownCost.netTetri).toBe(84_75);
    expect((await call(await loginAs('manager'), 'GET', '/api/economics/goods')).statusCode).toBe(403);
  });
});

describe.skipIf(!HAS_DB)('what the screens read', () => {
  it('the list, the search, the part\'s sales and the customer\'s purchases name the sale', async () => {
    const owner = await loginAs('owner');
    const prisma = await db();
    const customer = await prisma.customer.create({ data: { name: `Клиент Пример ${uniq()}` } });
    const partId = await newPart(owner, { qty: 3 });
    const sold = json<Sold>(await sell(owner, { customerId: customer.id, lines: [{ partId, qty: 1, unitPriceTetri: 35_00 }] }));

    const list = json<{ sales: { id: string; openTetri: number; state: string }[] }>(await call(owner, 'GET', '/api/goods-sales?open=1'));
    expect(list.sales.find((s) => s.id === sold.id)).toMatchObject({ openTetri: 35_00, state: 'owes' });
    const found = json<{ groups: { goods: { items: { id: string }[] } } }>(await call(owner, 'GET', `/api/search?q=${sold.number}`));
    expect(found.groups.goods.items.map((g) => g.id)).toContain(sold.id);
    const part = json<{ sales: { saleId: string }[]; moves: { sale: { number: string } | null }[] }>(await call(owner, 'GET', `/api/parts/${partId}`));
    expect(part.sales.map((s) => s.saleId)).toEqual([sold.id]);
    expect(part.moves.some((m) => m.sale?.number === sold.number)).toBe(true);
    const cust = json<{ goodsSales: { id: string }[] }>(await call(owner, 'GET', `/api/customers/${customer.id}`));
    expect(cust.goodsSales.map((g) => g.id)).toEqual([sold.id]);
    const journal = json<{ rows: { action: string }[] }>(await call(owner, 'GET', `/api/journal?record=goods_sale:${sold.id}`));
    expect(journal.rows.map((r) => r.action)).toContain('goods_sale.create');
  });
});
