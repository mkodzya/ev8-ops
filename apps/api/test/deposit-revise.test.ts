// «Пересмотреть решение по залогу» (issue #14, ADR-0047): an owner revises a
// deposit decided at the return, any time after it, with a reason. Every
// customer here is invented. Needs a *_test database.
import { addDays, todayISO } from '@ev8/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

const today = () => todayISO();
const digits = () => uniq().replace(/\D/g, '');
const PNG = 'data:image/png;base64,' + 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const items = () => ({ moped: { state: 'ok' }, key: { state: 'ok' }, battery_1: { state: 'ok' }, battery_2: { state: 'ok' }, charger_1: { state: 'ok' }, charger_2: { state: 'ok' } });

interface Card {
  rental: { status: string; debtTetri: number };
  periods: { seq: number; amountTetri: number; paidTetri: number }[];
  charges: { kind: string; amountTetri: number; paidTetri: number }[];
  deposit: { paidTetri: number; status: string; withheldTetri: number; returnedTetri: number; paidOutTetri: number; decided: boolean; withholdings: { source: string; amountTetri: number }[] };
  documents: { returnAct: { signedAt: string | null } | null };
}
interface Figures {
  withheldTetri: number;
  backTetri: number;
  paidOutTetri: number;
  onHandTetri: number;
  debtTetri: number;
}
interface View {
  before: Figures;
  after: Figures | null;
  heldTetri: number;
  claimsTetri: number;
  current: { keptTetri: number; grounds: string[]; reason: string | null };
  actSigned: boolean;
}
const card = async (cookie: string, id: string) => json<Card>(await call(cookie, 'GET', `/api/rentals/${id}`));
const err = (res: { body: string }) => json<{ error: string; field?: string }>(res);

/**
 * A rental of an invented customer handed over `daysAgo` days back with 330
 * in cash — the deposit 180 and the first week 150 — and returned today
 * by an owner, with a decision or (null) leaving it for later.
 */
async function returned(daysAgo: number, deposit: Record<string, unknown> | null) {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Model ${uniq()}`, weeklyRateTetri: 15000, forRent: true } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TEST${digits().slice(0, 13).padStart(13, '0')}`, modelId: model.id, pool: 'rent' } });
  const customer = await prisma.customer.create({ data: { name: `Invented Customer ${uniq()}`, phone: `+9955${digits().slice(-8)}`, personalId: digits().slice(-11) } });
  const owner = await loginAs('owner');
  const res = await call(owner, 'POST', '/api/pickups', {
    customerId: customer.id,
    vehicleId: vehicle.id,
    weeklyRateTetri: 15000,
    depositTetri: 18000,
    pickedUpOn: addDays(today(), -daysAgo),
    nightParkingAddress: 'Invented street 1',
    batteries: 2,
    chargers: 2,
    odometerKm: 100,
    payment: { later: false, channel: 'cash', amountTetri: 33000 },
  });
  if (res.statusCode !== 201) throw new Error(res.body);
  const id = json<{ id: string }>(res).id;
  const back = await call(owner, 'POST', `/api/rentals/${id}/return`, { odometerKm: 150, items: items(), ...(deposit ? { deposit } : {}) });
  if (back.statusCode !== 200) throw new Error(back.body);
  made.push({ owner, id });
  return { prisma, owner, id };
}

/**
 * The rentals a test returned, handed back whatever they still owe back when
 * it ends: the suites share one database, and a deposit of 180 left owed back
 * makes «Разобрать» unsure which deposit another suite's bank line of 180 is.
 */
const made: { owner: string; id: string }[] = [];
afterEach(async () => {
  for (const { owner, id } of made.splice(0)) {
    const d = json<{ deposits: { rentalId: string; toHandBackTetri: number }[] }>(await call(owner, 'GET', '/api/deposits')).deposits.find((x) => x.rentalId === id);
    if (d && d.toHandBackTetri > 0) await call(owner, 'POST', '/api/money', { kind: 'deposit_payout', rentalId: id, amountTetri: d.toHandBackTetri, channel: 'cash' });
  }
});

const revise = (owner: string, id: string, body: Record<string, unknown>) => call(owner, 'POST', `/api/rentals/${id}/deposit/revise`, body);
const preview = async (owner: string, id: string, body: Record<string, unknown> = {}) => {
  const res = await call(owner, 'POST', `/api/rentals/${id}/deposit/revise/preview`, body);
  if (res.statusCode !== 200) throw new Error(res.body);
  return json<View>(res);
};

describe.skipIf(!HAS_DB)('issue #14 · revising a deposit decision', () => {
  it('a decision whose money was annulled by hand is rebuilt from a clean state: all 180 goes back (the case of 25.10.2026)', async () => {
    // Week 2 unpaid at the return: 150 kept for it, 30 to go back, handed back in cash.
    const { prisma, owner, id } = await returned(10, { action: 'withhold', withheldTetri: 15000, grounds: ['rent_arrears'], reason: 'week 2 unpaid' });
    const paid = await call(owner, 'POST', '/api/money', { kind: 'deposit_payout', rentalId: id, amountTetri: '30', channel: 'cash' });
    expect(paid.statusCode, paid.body).toBe(201);
    // Then the week was found not owed: both movements annulled by hand, the week discounted to nothing.
    const kept = await prisma.depositWithholding.findFirstOrThrow({ where: { rentalId: id, source: 'return', voidedAt: null } });
    expect((await call(owner, 'POST', `/api/payments/${kept.paymentId}/void`, { reason: 'week not owed' })).statusCode).toBe(200);
    expect((await call(owner, 'POST', `/api/payments/${json<{ id: string }>(paid).id}/void`, { reason: 'not handed over' })).statusCode).toBe(200);
    expect((await call(owner, 'POST', `/api/rentals/${id}/weeks/2/discount`, { discountTetri: 15000, reason: 'not owed' })).statusCode).toBe(200);
    // The card still says what the decision said.
    const stale = await card(owner, id);
    expect(stale.deposit.withheldTetri).toBe(15000);
    expect(stale.rental.debtTetri).toBe(0);

    const view = await preview(owner, id);
    expect(view.current).toMatchObject({ keptTetri: 15000, grounds: ['rent_arrears'], reason: 'week 2 unpaid' });
    expect(view.heldTetri).toBe(18000);
    expect(view.claimsTetri).toBe(0);
    expect(view.after).toBeNull();

    expect(err(await revise(owner, id, { action: 'return_all' }))).toMatchObject({ error: 'missing_field', field: 'revisionReason' });
    const ok = await revise(owner, id, { action: 'return_all', revisionReason: 'week 2 was not charged, the deposit goes back whole' });
    expect(ok.statusCode, ok.body).toBe(200);
    const c = await card(owner, id);
    expect(c.deposit).toMatchObject({ withheldTetri: 0, returnedTetri: 18000, paidOutTetri: 0, status: 'returned', decided: true, withholdings: [] });
    expect(c.rental.debtTetri).toBe(0);
    // The transfer of 180 now fits the decision whole.
    const out = await call(owner, 'POST', '/api/money', { kind: 'deposit_payout', rentalId: id, amountTetri: '180', channel: 'transfer', occurredOn: addDays(today(), -1), backdateReason: 'bank transfer of yesterday' });
    expect(out.statusCode, out.body).toBe(201);
    expect((await card(owner, id)).deposit.paidOutTetri).toBe(18000);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'deposit.revise', entityId: kept.depositId } });
    expect(log.note).toBe('week 2 was not charged, the deposit goes back whole');
    expect(log.before).toMatchObject({ withheldTetri: 15000, backTetri: 3000 });
    expect(log.after).toMatchObject({ withheldTetri: 0, backTetri: 18000, decision: { action: 'return_all' } });
  });

  it('less kept: the debt it paid is owed again, and the preview says so before anything is written', async () => {
    const { owner, id } = await returned(10, { action: 'withhold', withheldTetri: 15000, grounds: ['rent_arrears'], reason: 'week 2 unpaid' });
    expect((await card(owner, id)).rental.debtTetri).toBe(0);
    const view = await preview(owner, id, { action: 'withhold', withheldTetri: 5000, grounds: ['rent_arrears'], reason: 'part of week 2' });
    expect(view.before).toMatchObject({ withheldTetri: 15000, backTetri: 3000, debtTetri: 0 });
    expect(view.after).toMatchObject({ withheldTetri: 5000, backTetri: 13000, debtTetri: 10000 });
    // A preview writes nothing.
    const still = await card(owner, id);
    expect(still.deposit.withheldTetri).toBe(15000);
    expect(still.rental.debtTetri).toBe(0);

    const ok = await revise(owner, id, { action: 'withhold', withheldTetri: 5000, grounds: ['rent_arrears'], reason: 'part of week 2', revisionReason: 'agreed to pay the rest' });
    expect(ok.statusCode, ok.body).toBe(200);
    const c = await card(owner, id);
    expect(c.deposit).toMatchObject({ withheldTetri: 5000, returnedTetri: 13000, status: 'partial' });
    expect(c.deposit.withholdings).toEqual([expect.objectContaining({ source: 'return', amountTetri: 5000 })]);
    expect(c.rental.debtTetri).toBe(10000);
    expect(c.periods.find((p) => p.seq === 2)).toMatchObject({ amountTetri: 15000, paidTetri: 5000 });
  });

  it('more kept than the debt: the rest is a charge of its own, and revised away it goes with it', async () => {
    const { owner, id } = await returned(3, { action: 'return_all' });
    const up = await revise(owner, id, { action: 'withhold', withheldTetri: 5000, grounds: ['cleaning'], reason: 'mud inside', revisionReason: 'found the mud the next day' });
    expect(up.statusCode, up.body).toBe(200);
    let c = await card(owner, id);
    expect(c.deposit).toMatchObject({ withheldTetri: 5000, returnedTetri: 13000 });
    expect(c.charges).toEqual([expect.objectContaining({ kind: 'withheld', amountTetri: 5000, paidTetri: 5000 })]);
    const down = await revise(owner, id, { action: 'return_all', revisionReason: 'the mud was ours' });
    expect(down.statusCode, down.body).toBe(200);
    c = await card(owner, id);
    expect(c.deposit).toMatchObject({ withheldTetri: 0, returnedTetri: 18000, status: 'returned' });
    expect(c.charges).toEqual([]);
    expect(c.rental.debtTetri).toBe(0);
  });

  it('other money on the charge for what was kept beyond the claims: the revision refuses rather than strand it (review of 25.10.2026)', async () => {
    const { prisma, owner, id } = await returned(3, { action: 'return_all' });
    // Kept 50 for mud with nothing owed: the 50 is a charge of its own, paid by the deposit.
    expect((await revise(owner, id, { action: 'withhold', withheldTetri: 5000, grounds: ['cleaning'], reason: 'mud inside', revisionReason: 'found the mud the next day' })).statusCode).toBe(200);
    // The deposit's payment annulled by hand: the charge is open again, and 20 in cash is booked onto it.
    const kept = await prisma.depositWithholding.findFirstOrThrow({ where: { rentalId: id, source: 'return', voidedAt: null } });
    expect((await call(owner, 'POST', `/api/payments/${kept.paymentId}/void`, { reason: 'annulled by hand' })).statusCode).toBe(200);
    const cash = await call(owner, 'POST', '/api/money', { kind: 'rent', rentalId: id, amountTetri: '20', channel: 'cash' });
    expect(cash.statusCode, cash.body).toBe(201);
    expect((await card(owner, id)).charges).toEqual([expect.objectContaining({ kind: 'withheld', amountTetri: 5000, paidTetri: 2000 })]);
    // Taking the decision apart would void the charge and leave the 20 on nothing: refused, and the preview says so first.
    expect(err(await call(owner, 'POST', `/api/rentals/${id}/deposit/revise/preview`, {})).error).toBe('withheld_paid_by_other');
    const refused = await revise(owner, id, { action: 'return_all', revisionReason: 'the mud was ours' });
    expect(refused.statusCode).toBe(409);
    expect(json<{ error: string; paidTetri: number }>(refused)).toMatchObject({ error: 'withheld_paid_by_other', paidTetri: 2000 });
    expect((await card(owner, id)).deposit.withheldTetri).toBe(5000);
    // Its own door first — the cash annulled — and then the revision goes through.
    expect((await call(owner, 'POST', `/api/payments/${json<{ id: string }>(cash).id}/void`, { reason: 'booked on the wrong charge' })).statusCode).toBe(200);
    const ok = await revise(owner, id, { action: 'return_all', revisionReason: 'the mud was ours' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await card(owner, id)).charges).toEqual([]);
  });

  it('money handed back already stays; more than is left cannot be kept', async () => {
    const { owner, id } = await returned(3, { action: 'withhold', withheldTetri: 3000, grounds: ['cleaning'], reason: 'mud' });
    expect((await call(owner, 'POST', '/api/money', { kind: 'deposit_payout', rentalId: id, amountTetri: '150', channel: 'cash' })).statusCode).toBe(201);
    const view = await preview(owner, id);
    // 180 received, 150 of it handed back: 30 is all a decision may still keep.
    expect(view.heldTetri).toBe(3000);
    const over = await revise(owner, id, { action: 'withhold', withheldTetri: 4000, grounds: ['cleaning'], reason: 'mud', revisionReason: 'more mud' });
    expect(err(over).error).toBe('over_held');
    const ok = await revise(owner, id, { action: 'withhold', withheldTetri: 1000, grounds: ['cleaning'], reason: 'a little mud', revisionReason: 'less mud than thought' });
    expect(ok.statusCode, ok.body).toBe(200);
    const c = await card(owner, id);
    expect(c.deposit).toMatchObject({ withheldTetri: 1000, returnedTetri: 17000, paidOutTetri: 15000 });
    const d = json<{ deposits: { rentalId: string; toHandBackTetri: number }[] }>(await call(owner, 'GET', '/api/deposits')).deposits.find((x) => x.rentalId === id)!;
    expect(d.toHandBackTetri).toBe(2000);
  });

  it('a signed return act is replaced: the card asks for a signature again', async () => {
    const { owner, id } = await returned(3, { action: 'return_all' });
    expect((await call(owner, 'GET', `/api/rentals/${id}/return-act.pdf`)).statusCode).toBe(200);
    const signed = await call(owner, 'POST', `/api/rentals/${id}/return-act/sign`, { agree: true, signaturePng: PNG });
    expect(signed.statusCode, signed.body).toBe(201);
    expect((await card(owner, id)).documents.returnAct?.signedAt).toBeTruthy();
    expect((await preview(owner, id)).actSigned).toBe(true);
    const ok = await revise(owner, id, { action: 'withhold', withheldTetri: 2000, grounds: ['cleaning'], reason: 'mud', revisionReason: 'mud found later' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await card(owner, id)).documents.returnAct?.signedAt).toBeNull();
    expect((await call(owner, 'GET', `/api/rentals/${id}/return-act.pdf`)).statusCode).toBe(200);
  });

  it('only an owner, only a returned rental, only a decision that was made', async () => {
    const { owner, id } = await returned(3, { action: 'return_all' });
    const manager = await loginAs('manager');
    expect((await revise(manager, id, { action: 'return_all', revisionReason: 'x' })).statusCode).toBe(403);
    // A return with no decision leaves the deposit waiting: «Решить», not «Пересмотреть».
    const { prisma } = await import('../src/lib/db.js');
    const waiting = await returned(3, null);
    expect(err(await revise(owner, waiting.id, { action: 'return_all', revisionReason: 'x' })).error).toBe('deposit_undecided');
    // Taken back, the return is no return.
    await prisma.rental.update({ where: { id }, data: { status: 'active' } });
    expect(err(await revise(owner, id, { action: 'return_all', revisionReason: 'x' })).error).toBe('not_returned');
  });
});
