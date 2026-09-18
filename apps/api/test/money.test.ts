// Money in one place (wave 2 §3.1, §3.3, §3.6, §3.7): the money form's
// criteria 1–10 and 32–35, at the API.
import { addDays, todayISO } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

const today = () => todayISO(new Date(), 'Asia/Tbilisi');

/** A rental handed over today at 150 a week with a 180 deposit: 330 is open. */
async function freshRental(opts: { rate?: number; pickedUpOn?: string } = {}) {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Money ${uniq()}`, forRent: true } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TESTM${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id } });
  const customer = await prisma.customer.create({ data: { name: `ТЕСТ Деньги ${uniq()}` } });
  const owner = await loginAs('owner');
  const res = await call(owner, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: opts.rate ?? 15000, pickedUpOn: opts.pickedUpOn ?? today() });
  const { id } = json<{ id: string }>(res);
  return { prisma, owner, customer, rentalId: id, modelId: model.id };
}

type Plan = { closes: { target: string; amountTetri: number; fullTetri: number }[]; leftoverTetri: number; feeTetri: number; netTetri: number; paidThroughAfter: string | null; rate: number | null };
const debt = async (who: string, customerId: string) =>
  json<{ owesTetri: number; creditTetri: number; aheadTetri: number; depositHeldTetri: number; parts: { kind: string; owesTetri: number }[] }>(
    await call(who, 'GET', `/api/customers/${customerId}/balance`),
  );

describe.skipIf(!HAS_DB)('the money form (§3.1)', () => {
  it('says what a payment will close before it is written, and closes exactly that (crit. 1, 3)', async () => {
    const { owner, customer, rentalId } = await freshRental();
    expect((await debt(owner, customer.id)).owesTetri).toBe(33000);

    const plan = json<Plan>(await call(owner, 'POST', '/api/money/preview', { kind: 'rent', rentalId, amountTetri: '100', channel: 'cash' }));
    // Deposit first, then the weeks (Q6): 100 of 180, and the week untouched.
    expect(plan.closes).toEqual([expect.objectContaining({ target: 'deposit', amountTetri: 10000, fullTetri: 18000 })]);

    const res = await call(owner, 'POST', '/api/money', { kind: 'rent', rentalId, amountTetri: '100', channel: 'cash' });
    expect(res.statusCode, res.body).toBe(201);
    expect((await debt(owner, customer.id)).owesTetri).toBe(23000);
  });

  it('a card says what the bank will credit and what the acquirer keeps, and the debt goes by the gross (crit. 2)', async () => {
    const { owner, customer, rentalId } = await freshRental();
    const plan = json<Plan>(await call(owner, 'POST', '/api/money/preview', { kind: 'rent', rentalId, amountTetri: '330', channel: 'acquiring' }));
    expect(plan.feeTetri).toBe(495);
    expect(plan.netTetri).toBe(32505);
    const { id } = json<{ id: string }>(await call(owner, 'POST', '/api/money', { kind: 'rent', rentalId, amountTetri: '330', channel: 'acquiring' }));
    const page = json<{ payment: { grossTetri: number; feeTetri: number; kind: string } }>(await call(owner, 'GET', `/api/payments/${id}`));
    expect(page.payment).toMatchObject({ grossTetri: 33000, feeTetri: 495, kind: 'rent' });
    expect((await debt(owner, customer.id)).owesTetri).toBe(0);
  });

  it('more than is owed goes on the customer’s account (crit. 4)', async () => {
    const { owner, customer, rentalId } = await freshRental();
    const plan = json<Plan>(await call(owner, 'POST', '/api/money/preview', { kind: 'rent', rentalId, amountTetri: '350', channel: 'cash' }));
    expect(plan.leftoverTetri).toBe(2000);
    await call(owner, 'POST', '/api/money', { kind: 'rent', rentalId, amountTetri: '350', channel: 'cash' });
    const d = await debt(owner, customer.id);
    expect(d.owesTetri).toBe(0);
    expect(d.creditTetri).toBe(2000);
  });

  it('a manager takes cash, today, and nothing else (crit. 5)', async () => {
    const { rentalId } = await freshRental();
    const manager = await loginAs('manager');
    expect((await call(manager, 'POST', '/api/money', { kind: 'rent', rentalId, amountTetri: '150', channel: 'cash' })).statusCode).toBe(201);
    const card = await call(manager, 'POST', '/api/money', { kind: 'rent', rentalId, amountTetri: '150', channel: 'acquiring' });
    expect(json<{ error: string }>(card).error).toBe('reconcile_required');
    const back = await call(manager, 'POST', '/api/money', { kind: 'rent', rentalId, amountTetri: '10', channel: 'cash', occurredOn: addDays(today(), -1), backdateReason: 'x' });
    expect(json<{ error: string }>(back).error).toBe('owner_only_backdate');
    const out = await call(manager, 'POST', '/api/money', { kind: 'deposit_payout', rentalId, amountTetri: '10', channel: 'cash' });
    expect(json<{ error: string }>(out).error).toBe('owner_only');
  });

  it('an owner may date a payment back, with a reason (ux №14)', async () => {
    const { owner, rentalId } = await freshRental({ pickedUpOn: addDays(today(), -3) });
    const bare = await call(owner, 'POST', '/api/money', { kind: 'rent', rentalId, amountTetri: '150', channel: 'cash', occurredOn: addDays(today(), -1) });
    expect(json<{ details?: { field?: string }; field?: string; error: string }>(bare).error).toBe('missing_field');
    const ok = await call(owner, 'POST', '/api/money', { kind: 'rent', rentalId, amountTetri: '150', channel: 'cash', occurredOn: addDays(today(), -1), backdateReason: 'paid yesterday, entered today' });
    expect(ok.statusCode).toBe(201);
  });

  it('an instalment by card carries its fee, and closes the instalment (crit. 6)', async () => {
    const { prisma, owner, customer, modelId } = await freshRental();
    const vehicle = await prisma.vehicle.create({ data: { vin: `TESTS${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId } });
    const sale = json<{ id: string }>(await call(owner, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '4188', downPaymentTetri: '1396', months: 2, soldOn: today() }));
    const { id } = json<{ id: string }>(await call(owner, 'POST', '/api/money', { kind: 'sale', saleId: sale.id, amountTetri: '1396', channel: 'acquiring' }));
    const page = json<{ payment: { feeTetri: number; closed: { target: string; seq: number }[] } }>(await call(owner, 'GET', `/api/payments/${id}`));
    expect(page.payment.feeTetri).toBe(2094);
    expect(page.payment.closed).toEqual([expect.objectContaining({ target: 'instalment', seq: 1 })]);
  });

  it('a deposit goes back no further than what we hold, and to someone else only with a reason (crit. 7, 8)', async () => {
    const { owner, customer, rentalId } = await freshRental();
    await call(owner, 'POST', '/api/money', { kind: 'rent', rentalId, amountTetri: '330', channel: 'cash' });
    const over = await call(owner, 'POST', '/api/money', { kind: 'deposit_payout', rentalId, amountTetri: '181', channel: 'cash' });
    expect(json<{ error: string }>(over).error).toBe('over_held');
    const noReason = await call(owner, 'POST', '/api/money', { kind: 'deposit_payout', rentalId, amountTetri: '180', channel: 'cash', paidTo: 'His brother' });
    expect(json<{ error: string }>(noReason).error).toBe('missing_field');
    const card = await call(owner, 'POST', '/api/money', { kind: 'deposit_payout', rentalId, amountTetri: '180', channel: 'acquiring' });
    expect(json<{ error: string }>(card).error).toBe('bad_channel');

    const ok = await call(owner, 'POST', '/api/money', { kind: 'deposit_payout', rentalId, amountTetri: '180', channel: 'cash', paidTo: 'His brother', paidToReason: 'the customer asked by phone' });
    expect(ok.statusCode, ok.body).toBe(201);
    const { id } = json<{ id: string }>(ok);
    const page = json<{ payment: { direction: string; paidTo: string; kind: string }; journal: { after: { paidToReason?: string } }[] }>(await call(owner, 'GET', `/api/payments/${id}`));
    expect(page.payment).toMatchObject({ direction: 'out', paidTo: 'His brother', kind: 'deposit_payout' });
    expect(page.journal.some((j) => j.after?.paidToReason === 'the customer asked by phone')).toBe(true);
    expect((await debt(owner, customer.id)).depositHeldTetri).toBe(0);
  });

  it('a supplier paid in two currencies shows the rate (crit. 9)', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const supplier = await prisma.customer.create({ data: { name: `ТЕСТ Завод ${uniq()}`, isSupplier: true } });
    const po = json<{ id: string }>(await call(owner, 'POST', '/api/purchases', { supplierId: supplier.id, currency: 'CNY', orderedOn: today() }));
    const plan = json<Plan>(await call(owner, 'POST', '/api/money/preview', { kind: 'supplier', purchaseId: po.id, amountTetri: '2541.42', foreignAmount: '6000', foreignCurrency: 'CNY', channel: 'transfer' }));
    expect(plan.rate).toBe(0.42357);
    const res = await call(owner, 'POST', '/api/money', { kind: 'supplier', purchaseId: po.id, amountTetri: '2541.42', foreignAmount: '6000', foreignCurrency: 'CNY', channel: 'transfer' });
    expect(res.statusCode, res.body).toBe(201);
    const page = json<{ payment: { direction: string; channel: string; foreignAmount: number } }>(await call(owner, 'GET', `/api/payments/${json<{ id: string }>(res).id}`));
    expect(page.payment).toMatchObject({ direction: 'out', channel: 'transfer', foreignAmount: 6000 });
  });

  it('"undo" within seconds takes it back without a reason; the debt returns (crit. 10)', async () => {
    const { owner, customer, rentalId } = await freshRental();
    const { id } = json<{ id: string }>(await call(owner, 'POST', '/api/money', { kind: 'rent', rentalId, amountTetri: '150', channel: 'cash' }));
    const other = await loginAs('owner');
    expect(json<{ error: string }>(await call(other, 'POST', `/api/payments/${id}/undo`)).error).toBe('undo_too_late');
    expect((await call(owner, 'POST', `/api/payments/${id}/undo`)).statusCode).toBe(200);
    const page = json<{ payment: { voided: boolean; voidKind: string }; journal: { action: string }[] }>(await call(owner, 'GET', `/api/payments/${id}`));
    expect(page.payment).toMatchObject({ voided: true, voidKind: 'undo' });
    expect(page.journal.map((j) => j.action)).toContain('payment.undo');
    expect((await debt(owner, customer.id)).owesTetri).toBe(33000);
  });
});

describe.skipIf(!HAS_DB)('the list of payments (§3.3)', () => {
  it('has a sign, a total over the filter, and a manager sees only their own (crit. 27, 28)', async () => {
    const { owner, rentalId } = await freshRental();
    const manager = await loginAs('manager');
    await call(owner, 'POST', '/api/money', { kind: 'rent', rentalId, amountTetri: '330', channel: 'cash' });
    await call(owner, 'POST', '/api/money', { kind: 'deposit_payout', rentalId, amountTetri: '50', channel: 'cash' });
    const mine = json<{ id: string }>(await call(manager, 'POST', '/api/money', { kind: 'rent', rentalId, amountTetri: '10', channel: 'cash' }));

    const list = json<{ totals: { inTetri: number; outTetri: number }; payments: { grossTetri: number; direction: string; voided: boolean }[] }>(
      await call(owner, 'GET', `/api/payments?rentalId=${rentalId}`),
    );
    const live = list.payments.filter((p) => !p.voided);
    expect(list.totals.inTetri).toBe(live.filter((p) => p.direction === 'in').reduce((n, p) => n + p.grossTetri, 0));
    expect(list.totals.outTetri).toBe(5000);

    const theirs = json<{ payments: { id: string }[] }>(await call(manager, 'GET', '/api/payments'));
    expect(theirs.payments.map((p) => p.id)).toEqual([mine.id]);
    expect((await call(manager, 'POST', `/api/payments/${mine.id}/void`, { reason: 'x' })).statusCode).toBe(403);
  });
});

describe.skipIf(!HAS_DB)('deposits and the one debt figure (§3.6, §3.7)', () => {
  it('a deposit paid short is owed and listed as short; held counts what came in (crit. 32)', async () => {
    const { owner, customer, rentalId } = await freshRental();
    await call(owner, 'POST', '/api/money', { kind: 'rent', rentalId, amountTetri: '100', channel: 'cash' });
    const list = json<{ deposits: { rentalId: string; segment: string; heldTetri: number; shortTetri: number }[] }>(await call(owner, 'GET', '/api/deposits'));
    expect(list.deposits.find((d) => d.rentalId === rentalId)).toMatchObject({ segment: 'short', heldTetri: 10000, shortTetri: 8000 });
    const d = await debt(owner, customer.id);
    expect(d.parts).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'deposit', owesTetri: 8000 })]));
  });

  it('owes what is due; what is ahead on a schedule is its own line (crit. 33)', async () => {
    const { prisma, owner, customer, rentalId, modelId } = await freshRental({ pickedUpOn: addDays(today(), -7) });
    // Deposit and the first week paid: the second week, begun today, is owed.
    await call(owner, 'POST', '/api/money', { kind: 'rent', rentalId, amountTetri: '330', channel: 'cash' });
    const vehicle = await prisma.vehicle.create({ data: { vin: `TESTD${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId } });
    await call(owner, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '4188', downPaymentTetri: '1396', months: 2, soldOn: today() });
    const d = await debt(owner, customer.id);
    expect(d.owesTetri).toBe(15000 + 139600);
    expect(d.aheadTetri).toBe(279200);
  });

  it('a sale bought back owes nothing (crit. 34, M8)', async () => {
    const { prisma, owner, customer, modelId } = await freshRental();
    await call(owner, 'POST', '/api/money', { kind: 'on_account', customerId: customer.id, amountTetri: '330', channel: 'cash' });
    const vehicle = await prisma.vehicle.create({ data: { vin: `TESTB${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId } });
    const sale = json<{ id: string }>(await call(owner, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '3000', downPaymentTetri: '1000', months: 2, soldOn: addDays(today(), -70) }));
    expect((await debt(owner, customer.id)).owesTetri).toBeGreaterThan(0);
    const back = await call(owner, 'POST', `/api/sales/${sale.id}/buy-back`, { amountTetri: '500', channel: 'cash' });
    expect(back.statusCode, back.body).toBe(200);
    expect((await debt(owner, customer.id)).parts.filter((p) => p.kind === 'sale')).toEqual([]);
  });

  it('the nightly run never spends a sale’s money on rent (crit. 35, B2-08)', async () => {
    const { prisma, owner, customer, rentalId, modelId } = await freshRental({ pickedUpOn: addDays(today(), -14) });
    const vehicle = await prisma.vehicle.create({ data: { vin: `TESTN${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId } });
    const sale = json<{ id: string }>(await call(owner, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '1000', months: 0, soldOn: today() }));
    // 1500 for a 1000 sale: 500 is left on the sale's payment.
    await call(owner, 'POST', '/api/money', { kind: 'sale', saleId: sale.id, amountTetri: '1500', channel: 'cash' });
    const { settleCredit } = await import('../src/lib/periods.js');
    expect(await settleCredit(rentalId)).toBe(0);
  });
});
