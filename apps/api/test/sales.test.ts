// Selling a moped (SAL-01, SAL-02, SAL-03).
import { addDays, daysBetween, todayISO } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { HAS_DB, byHand, call, json, loginAs, uniq } from './helpers.js';

async function fixtures(price = 320600) {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Model ${uniq()}`, salePriceTetri: price } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TESTL${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id } });
  const customer = await prisma.customer.create({ data: { name: `Buyer ${uniq()}` } });
  const owner = await loginAs('owner');
  return { prisma, model, vehicle, customer, owner };
}

function saleCard(res: { body: string }) {
  return json<{
    sale: {
      priceTetri: number;
      paidTetri: number;
      outstandingTetri: number;
      overdueTetri: number;
      status: string;
      warrantyUntil: string | null;
      vehicle: { id: string } | null;
      instalments: { seq: number; dueOn: string; amountTetri: number; paidTetri: number; payStatus: string; overdue: boolean }[];
    };
    payments: { direction: string; grossTetri: number }[];
  }>(res);
}

describe.skipIf(!HAS_DB)('selling (SAL-01)', () => {
  it('takes the VIN out of the fleet and gives twelve months of warranty', async () => {
    const { prisma, vehicle, customer, owner } = await fixtures();
    const res = await call(owner, 'POST', '/api/sales', {
      customerId: customer.id,
      vehicleId: vehicle.id,
      priceTetri: '2900',
      soldOn: '2026-05-19',
      extras: 'second battery',
    });
    expect(res.statusCode, res.body).toBe(201);
    const { id, number } = json<{ id: string; number: string }>(res);
    expect(number).toMatch(/^SL-\d{5}$/);

    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).state).toBe('sold');
    const card = saleCard(await call(owner, 'GET', `/api/sales/${id}`));
    expect(card.sale.warrantyUntil).toBe('2027-05-19');
    // Paid in one go is one instalment, due the day of the sale.
    expect(card.sale.instalments).toHaveLength(1);
    expect(card.sale.instalments[0]).toMatchObject({ seq: 1, dueOn: '2026-05-19', amountTetri: 290000 });
    expect(card.sale.outstandingTetri).toBe(290000);

    const fleet = json<{ events: { kind: string }[] }>(await call(owner, 'GET', `/api/fleet/${vehicle.id}`));
    expect(fleet.events.map((e) => e.kind)).toContain('sold');
  });

  it('refuses a moped that is out with somebody, and one already sold', async () => {
    const { prisma, vehicle, customer, owner } = await fixtures();
    await prisma.vehicle.update({ where: { id: vehicle.id }, data: { state: 'rented' } });
    const rented = await call(owner, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '2900' });
    expect(rented.statusCode).toBe(409);
    expect(json<{ error: string }>(rented).error).toBe('vehicle_rented_sale');

    await prisma.vehicle.update({ where: { id: vehicle.id }, data: { state: 'available' } });
    expect((await call(owner, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '2900' })).statusCode).toBe(201);
    const twice = await call(owner, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '2900' });
    expect(twice.statusCode).toBe(409);
  });

  // Issue #18, B8 (Mika's «Да, без отмены» of 28.10.2026): a manager sells a moped and takes its
  // money; cancelling the sale, buying the moped back and moving its day stay an owner's.
  it('a manager sells today and takes cash on it; the day, the rental park, cancelling and buying back are an owner’s', async () => {
    const { prisma, vehicle, customer } = await fixtures();
    const manager = await loginAs('manager');
    const today = todayISO();
    expect((await call(manager, 'GET', '/api/sales')).statusCode).toBe(200);

    // Another day is the owner's to give a sale: the refusal says so in words.
    // How the buyer paid today, as the wizard says it: 500 in cash.
    const paid = { prepaymentChannel: 'cash', prepaymentTetri: '500' };
    const back = await call(manager, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '2900', soldOn: addDays(today, -3), ...paid });
    expect(back.statusCode).toBe(403);
    expect(json<{ error: string }>(back).error).toBe('owner_only_backdate');
    // A moped of the rental park goes to the sale park by an owner (ADR-0005), whoever sells it.
    await prisma.vehicle.update({ where: { id: vehicle.id }, data: { pool: 'rent' } });
    const fromRent = await call(manager, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '2900', movePool: true, ...paid });
    expect(fromRent.statusCode).toBe(403);
    expect(json<{ error: string }>(fromRent).error).toBe('owner_only');
    await prisma.vehicle.update({ where: { id: vehicle.id }, data: { pool: 'sale' } });

    // Nothing paid today is an owner's decision (§3.1): the server says so, not the wizard alone.
    for (const nothing of [{}, { prepaymentChannel: 'later' }, { prepaymentChannel: 'cash', prepaymentTetri: '0' }]) {
      const res = await call(manager, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '2900', ...nothing });
      expect(res.statusCode, JSON.stringify(nothing)).toBe(403);
      expect(json<{ error: string; field: string }>(res)).toMatchObject({ error: 'owner_only', field: 'channel' });
    }
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).state).toBe('available');

    const made = await call(manager, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '2900', ...paid });
    expect(made.statusCode, made.body).toBe(201);
    const { id } = json<{ id: string }>(made);
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).state).toBe('sold');
    expect(saleCard(await call(manager, 'GET', `/api/sales/${id}`)).sale).toMatchObject({ status: 'active', priceTetri: 290000 });
    // Its paper is printed and signed by whoever made it.
    expect((await call(manager, 'GET', `/api/sales/${id}/contract.pdf`)).statusCode).toBe(200);

    // The money: cash by his own form; a card reaches the bank and is sorted, as before (ADR-0048).
    expect((await call(manager, 'POST', `/api/sales/${id}/payments`, { grossTetri: '500', channel: 'cash' })).statusCode).toBe(201);
    const card = await call(manager, 'POST', `/api/sales/${id}/payments`, { grossTetri: '500', channel: 'acquiring' });
    expect(card.statusCode).toBe(403);
    expect(json<{ error: string }>(card).error).toBe('reconcile_required');
    expect(saleCard(await call(manager, 'GET', `/api/sales/${id}`)).sale.paidTetri).toBe(50000);

    // What stays an owner's: cancelling, buying back, the day, the schedule, editing.
    expect((await call(manager, 'POST', `/api/sales/${id}/cancel`, { reason: 'test' })).statusCode).toBe(403);
    expect((await call(manager, 'POST', `/api/sales/${id}/buy-back`, { amountTetri: '1000' })).statusCode).toBe(403);
    expect((await call(manager, 'POST', `/api/sales/${id}/date`, { soldOn: addDays(today, -1), reason: 'test' })).statusCode).toBe(403);
    expect((await call(manager, 'POST', `/api/sales/${id}/schedule`, { reason: 'test', schedule: [{ dueOn: today, amountTetri: '2900' }] })).statusCode).toBe(403);
    expect((await call(manager, 'PATCH', `/api/sales/${id}`, { notes: 'test' })).statusCode).toBe(403);
  });

  it('a manager’s sale paid by card is written with the way it was paid; the money comes as a bank line', async () => {
    const { prisma, vehicle, customer } = await fixtures();
    const manager = await loginAs('manager');
    const made = await call(manager, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '2900', prepaymentChannel: 'acquiring', prepaymentTetri: '2900' });
    expect(made.statusCode, made.body).toBe(201);
    const { id } = json<{ id: string }>(made);
    // Nothing is recorded by the sale itself: the line from the bank is sorted to it (ADR-0048).
    expect(saleCard(await call(manager, 'GET', `/api/sales/${id}`)).sale.paidTetri).toBe(0);
    const log = await prisma.auditLog.findFirst({ where: { entityId: id, action: 'sale.create' } });
    expect(log?.after).toMatchObject({ prepaymentChannel: 'acquiring', prepaymentTetri: 290000 });
  });
});

describe.skipIf(!HAS_DB)('the schedule (SAL-02)', () => {
  it('builds the real one and shows what is behind: 900 down, nine of 300', async () => {
    const { vehicle, customer, owner } = await fixtures();
    const { id } = json<{ id: string }>(
      await call(owner, 'POST', '/api/sales', {
        customerId: customer.id,
        vehicleId: vehicle.id,
        priceTetri: '3600',
        downPaymentTetri: '900',
        months: 9,
        soldOn: '2025-05-27',
      }),
    );
    let card = saleCard(await call(owner, 'GET', `/api/sales/${id}`));
    expect(card.sale.instalments).toHaveLength(10);
    expect(card.sale.instalments[0].amountTetri).toBe(90000);
    expect(card.sale.instalments.slice(1).every((i) => i.amountTetri === 30000)).toBe(true);

    // Only the down payment arrived. Every monthly instalment is long past
    // due, so 2 700 is behind — the figure the company knows.
    await byHand(owner, `/api/sales/${id}/payments`, { channel: 'transfer', grossTetri: '900', occurredOn: '2025-05-27' });
    card = saleCard(await call(owner, 'GET', `/api/sales/${id}`));
    expect(card.sale.paidTetri).toBe(90000);
    expect(card.sale.outstandingTetri).toBe(270000);
    expect(card.sale.overdueTetri).toBe(270000);
    expect(card.sale.instalments[0].payStatus).toBe('paid');
    expect(card.sale.instalments[1].overdue).toBe(true);

    const summary = json<{ salesOverdueTetri: number }>(await call(owner, 'GET', '/api/summary'));
    expect(summary.salesOverdueTetri).toBeGreaterThanOrEqual(270000);
  });

  it('a payment fills instalments from the oldest, part-paying the one it runs out on', async () => {
    const { vehicle, customer, owner } = await fixtures();
    const { id } = json<{ id: string }>(
      await call(owner, 'POST', '/api/sales', {
        customerId: customer.id,
        vehicleId: vehicle.id,
        priceTetri: '1200',
        months: 4,
        soldOn: '2026-01-10',
      }),
    );
    await call(owner, 'POST', `/api/sales/${id}/payments`, { channel: 'cash', grossTetri: '450' });
    const card = saleCard(await call(owner, 'GET', `/api/sales/${id}`));
    expect(card.sale.instalments.map((i) => i.payStatus)).toEqual(['paid', 'partial', 'unpaid', 'unpaid']);
    expect(card.sale.instalments[1].paidTetri).toBe(15000);
  });

  it('counts a sale on the customer’s balance and takes it off when the payment is voided', async () => {
    const { vehicle, customer, owner } = await fixtures();
    const { id } = json<{ id: string }>(
      await call(owner, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '1000', months: 2, soldOn: '2026-01-10' }),
    );
    // Both instalments fell due in February and March: all of it is owed now (B7-02).
    let balance = json<{ owesTetri: number }>(await call(owner, 'GET', `/api/customers/${customer.id}/balance`));
    expect(balance.owesTetri).toBe(100000);

    const paid = json<{ id: string }>(await call(owner, 'POST', `/api/sales/${id}/payments`, { channel: 'cash', grossTetri: '1000' }));
    balance = json<{ owesTetri: number }>(await call(owner, 'GET', `/api/customers/${customer.id}/balance`));
    expect(balance.owesTetri).toBe(0);

    expect((await call(owner, 'POST', `/api/payments/${paid.id}/void`, { reason: 'wrong sale' })).statusCode).toBe(200);
    const card = saleCard(await call(owner, 'GET', `/api/sales/${id}`));
    expect(card.sale.paidTetri).toBe(0);
    expect(card.sale.instalments.every((i) => i.payStatus === 'unpaid')).toBe(true);
  });
});

describe.skipIf(!HAS_DB)('buying it back (SAL-03)', () => {
  it('money goes out, the VIN comes back, and the history holds both events', async () => {
    const { prisma, vehicle, customer, owner } = await fixtures();
    const { id } = json<{ id: string }>(
      await call(owner, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '2900', soldOn: '2026-05-19' }),
    );
    const back = await call(owner, 'POST', `/api/sales/${id}/buy-back`, { amountTetri: '2440', occurredOn: '2026-06-03', channel: 'cash' });
    expect(back.statusCode, back.body).toBe(200);

    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).state).toBe('available');
    const card = saleCard(await call(owner, 'GET', `/api/sales/${id}`));
    expect(card.sale.status).toBe('bought_back');
    expect(card.payments).toEqual([{ direction: 'out', grossTetri: 244000, occurredOn: '2026-06-03', channel: 'cash', id: expect.any(String) }]);

    const fleet = json<{ events: { kind: string; occurredOn: string }[] }>(await call(owner, 'GET', `/api/fleet/${vehicle.id}`));
    const kinds = fleet.events.map((e) => e.kind);
    expect(kinds).toContain('sold');
    expect(kinds).toContain('bought_back');
    expect(kinds.indexOf('sold')).toBeLessThan(kinds.indexOf('bought_back'));
  });

  it('can bring it back needing work instead of straight into the fleet', async () => {
    const { prisma, vehicle, customer, owner } = await fixtures();
    const { id } = json<{ id: string }>(
      await call(owner, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '2900', soldOn: '2026-05-19' }),
    );
    await call(owner, 'POST', `/api/sales/${id}/buy-back`, { amountTetri: '2000', occurredOn: '2026-06-03', toState: 'service' });
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).state).toBe('service');
  });

  it('refuses a buy-back dated before the sale, and a second one', async () => {
    const { vehicle, customer, owner } = await fixtures();
    const { id } = json<{ id: string }>(
      await call(owner, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '2900', soldOn: '2026-05-19' }),
    );
    const early = await call(owner, 'POST', `/api/sales/${id}/buy-back`, { amountTetri: '100', occurredOn: '2026-05-01' });
    expect(json<{ error: string }>(early).error).toBe('before_sale');
    expect((await call(owner, 'POST', `/api/sales/${id}/buy-back`, { amountTetri: '100', occurredOn: '2026-06-01' })).statusCode).toBe(200);
    expect((await call(owner, 'POST', `/api/sales/${id}/buy-back`, { amountTetri: '100', occurredOn: '2026-06-02' })).statusCode).toBe(409);
  });
});

describe.skipIf(!HAS_DB)('a sale entered by mistake', () => {
  it('is cancelled with a reason and gives the VIN back, but not while money hangs on it', async () => {
    const { prisma, vehicle, customer, owner } = await fixtures();
    const { id } = json<{ id: string }>(
      await call(owner, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '2900' }),
    );
    await call(owner, 'POST', `/api/sales/${id}/payments`, { channel: 'cash', grossTetri: '100' });
    const held = await call(owner, 'POST', `/api/sales/${id}/cancel`, { reason: 'wrong VIN' });
    expect(held.statusCode).toBe(409);
    expect(json<{ error: string }>(held).error).toBe('sale_has_payments');

    const { prisma: db } = await import('../src/lib/db.js');
    const payment = await db.payment.findFirstOrThrow({ where: { saleId: id } });
    await call(owner, 'POST', `/api/payments/${payment.id}/void`, { reason: 'wrong sale' });

    expect((await call(owner, 'POST', `/api/sales/${id}/cancel`, {})).statusCode).toBe(400);
    expect((await call(owner, 'POST', `/api/sales/${id}/cancel`, { reason: 'wrong VIN' })).statusCode).toBe(200);
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).state).toBe('available');
  });
});

// A sale entered on the wrong day (call of 21.10.2026). Until now the date
// could not be edited: the money was voided, the sale cancelled and entered
// again under a new number. An owner now corrects it with a reason, and the
// warranty, the schedule and the moped's `sold` event move with it.
describe.skipIf(!HAS_DB)('a sale dated wrong', () => {
  type Card = {
    sale: { soldOn: string; warrantyUntil: string | null; paidTetri: number; instalments: { seq: number; dueOn: string; paidTetri: number }[] };
    signedSoldOn: string | null;
  };
  type Events = { events: { kind: string; occurredOn: string }[] };
  const card = async (cookie: string, id: string) => json<Card>(await call(cookie, 'GET', `/api/sales/${id}`));
  const arrived = async (vehicleId: string, on: string) => {
    const { prisma } = await import('../src/lib/db.js');
    await prisma.vehicleEvent.create({ data: { vehicleId, kind: 'arrived', occurredOn: new Date(`${on}T00:00:00Z`), toState: 'available' } });
  };

  it('moves the date, the warranty, the schedule and the moped’s one `sold` event — and not the money', async () => {
    const { vehicle, customer, owner } = await fixtures();
    await arrived(vehicle.id, '2026-05-01');
    const { id } = json<{ id: string }>(
      await call(owner, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '1200', downPaymentTetri: '300', months: 3, soldOn: '2026-05-19' }),
    );
    expect((await call(owner, 'POST', `/api/sales/${id}/payments`, { channel: 'cash', grossTetri: '300', occurredOn: '2026-05-19' })).statusCode).toBe(201);

    const res = await call(owner, 'POST', `/api/sales/${id}/date`, { soldOn: '2026-05-16', reason: 'entered on the wrong day' });
    expect(res.statusCode, res.body).toBe(200);
    expect(json(res)).toMatchObject({ ok: true, changed: true, soldOn: '2026-05-16', warrantyUntil: '2027-05-16', moved: 4, history: true });

    const after = await card(owner, id);
    expect(after.sale.soldOn).toBe('2026-05-16');
    expect(after.sale.warrantyUntil).toBe('2027-05-16');
    expect(after.sale.instalments.map((i) => i.dueOn)).toEqual(['2026-05-16', '2026-06-16', '2026-07-16', '2026-08-16']);
    // The down payment stays paid: money hangs on the line, not on its day.
    expect(after.sale.paidTetri).toBe(30000);
    expect(after.sale.instalments[0].paidTetri).toBe(30000);
    // Nothing is signed, so nothing carries another day.
    expect(after.signedSoldOn).toBeNull();

    // One sale, one `sold`, on the right day; the arrival is not touched.
    const fleet = json<Events>(await call(owner, 'GET', `/api/fleet/${vehicle.id}`));
    expect(fleet.events.map((e) => [e.kind, e.occurredOn])).toEqual([
      ['arrived', '2026-05-01'],
      ['sold', '2026-05-16'],
    ]);
  });

  it('writes the journal line with the day it had, the day it has and why', async () => {
    const { vehicle, customer, owner } = await fixtures();
    const { id } = json<{ id: string }>(await call(owner, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '2900', soldOn: '2026-05-19' }));
    await call(owner, 'POST', `/api/sales/${id}/date`, { soldOn: '2026-05-16', reason: 'entered on the wrong day' });

    const rows = json<{ rows: { action: string; before: { soldOn: string; warrantyUntil: string }; after: { soldOn: string; warrantyUntil: string }; note: string | null }[] }>(
      await call(owner, 'GET', `/api/journal?record=sale:${id}`),
    ).rows.filter((r) => r.action === 'sale.date');
    expect(rows).toHaveLength(1);
    expect(rows[0].before).toMatchObject({ soldOn: '2026-05-19', warrantyUntil: '2027-05-19' });
    expect(rows[0].after).toMatchObject({ soldOn: '2026-05-16', warrantyUntil: '2027-05-16' });
    expect(rows[0].note).toBe('entered on the wrong day');

    // The same day again is not a change, and leaves no second line.
    const same = json<{ changed: boolean }>(await call(owner, 'POST', `/api/sales/${id}/date`, { soldOn: '2026-05-16', reason: 'again' }));
    expect(same.changed).toBe(false);
    const again = json<{ rows: { action: string }[] }>(await call(owner, 'GET', `/api/journal?record=sale:${id}`)).rows.filter((r) => r.action === 'sale.date');
    expect(again).toHaveLength(1);
  });

  it('refuses a future day, a day before the moped’s history, no reason, a manager and a closed sale', async () => {
    const { vehicle, customer, owner } = await fixtures();
    await arrived(vehicle.id, '2026-05-01');
    const { id } = json<{ id: string }>(await call(owner, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '2900', soldOn: '2026-05-19' }));

    const future = await call(owner, 'POST', `/api/sales/${id}/date`, { soldOn: addDays(todayISO(), 1), reason: 'typo' });
    expect(future.statusCode).toBe(400);
    expect(json<{ error: string; field: string }>(future)).toMatchObject({ error: 'sale_date_future', field: 'soldOn' });

    // It arrived on the 1st of May: it cannot have been sold on the 30th of April.
    const early = await call(owner, 'POST', `/api/sales/${id}/date`, { soldOn: '2026-04-30', reason: 'typo' });
    expect(early.statusCode).toBe(409);
    expect(json(early)).toMatchObject({ error: 'sale_before_history', field: 'soldOn', date: '2026-05-01', kind: 'arrived' });
    // The day it arrived is a day it could be sold.
    expect((await call(owner, 'POST', `/api/sales/${id}/date`, { soldOn: '2026-05-01', reason: 'sold the day it came' })).statusCode).toBe(200);

    const noReason = await call(owner, 'POST', `/api/sales/${id}/date`, { soldOn: '2026-05-02' });
    expect(noReason.statusCode).toBe(400);
    expect(json(noReason)).toMatchObject({ error: 'missing_field', field: 'reason' });

    const manager = await loginAs('manager');
    expect((await call(manager, 'POST', `/api/sales/${id}/date`, { soldOn: '2026-05-02', reason: 'typo' })).statusCode).toBe(403);

    // Bought back, the sale is history and keeps its day.
    expect((await call(owner, 'POST', `/api/sales/${id}/buy-back`, { amountTetri: '2000', occurredOn: '2026-06-03', channel: 'cash' })).statusCode).toBe(200);
    const closed = await call(owner, 'POST', `/api/sales/${id}/date`, { soldOn: '2026-05-02', reason: 'typo' });
    expect(closed.statusCode).toBe(409);
    expect(json<{ error: string }>(closed).error).toBe('sale_closed');

    // A cancelled one too.
    const other = await fixtures();
    const { id: cancelled } = json<{ id: string }>(
      await call(other.owner, 'POST', '/api/sales', { customerId: other.customer.id, vehicleId: other.vehicle.id, priceTetri: '2900', soldOn: '2026-05-19' }),
    );
    expect((await call(other.owner, 'POST', `/api/sales/${cancelled}/cancel`, { reason: 'test' })).statusCode).toBe(200);
    expect(json<{ error: string }>(await call(other.owner, 'POST', `/api/sales/${cancelled}/date`, { soldOn: '2026-05-16', reason: 'typo' })).error).toBe('sale_closed');
  });

  it('names on its card the earliest day the date sheet may offer — the day the server refuses below (QA, 22.10.2026)', async () => {
    const { vehicle, customer, owner } = await fixtures();
    await arrived(vehicle.id, '2026-05-01');
    const { id } = json<{ id: string }>(await call(owner, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '2900', soldOn: '2026-05-19' }));
    type Floor = { earliestSoldOn: { date: string; kind: string } | null };
    const floorOf = async (saleId: string) => json<Floor>(await call(owner, 'GET', `/api/sales/${saleId}`)).earliestSoldOn;
    expect(await floorOf(id)).toEqual({ date: '2026-05-01', kind: 'arrived' });
    // The same day the refusal names.
    const early = await call(owner, 'POST', `/api/sales/${id}/date`, { soldOn: '2026-04-30', reason: 'typo' });
    expect(json(early)).toMatchObject({ error: 'sale_before_history', date: '2026-05-01' });
    // Moving the sale does not move the bound: its own `sold` is not history before it.
    expect((await call(owner, 'POST', `/api/sales/${id}/date`, { soldOn: '2026-05-03', reason: 'entered late' })).statusCode).toBe(200);
    expect(await floorOf(id)).toEqual({ date: '2026-05-01', kind: 'arrived' });

    // A sale that names only what the papers show has no history to keep to.
    const { id: paper } = json<{ id: string }>(await call(owner, 'POST', '/api/sales', { customerId: customer.id, vinNote: 'VIN not confirmed (test)', priceTetri: '2900', soldOn: '2026-05-19' }));
    expect(await floorOf(paper)).toBeNull();
  });

  it('moves only this sale’s `sold` on a moped sold twice, and never before it came back', async () => {
    const { vehicle, customer, owner } = await fixtures();
    await arrived(vehicle.id, '2026-04-01');
    const { id: first } = json<{ id: string }>(await call(owner, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '2900', soldOn: '2026-05-01' }));
    expect((await call(owner, 'POST', `/api/sales/${first}/buy-back`, { amountTetri: '2000', occurredOn: '2026-05-10', channel: 'cash' })).statusCode).toBe(200);
    const { id: second } = json<{ id: string }>(await call(owner, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '2900', soldOn: '2026-05-20' }));

    const beforeBack = await call(owner, 'POST', `/api/sales/${second}/date`, { soldOn: '2026-05-09', reason: 'typo' });
    expect(json(beforeBack)).toMatchObject({ error: 'sale_before_history', date: '2026-05-10', kind: 'bought_back' });

    expect((await call(owner, 'POST', `/api/sales/${second}/date`, { soldOn: '2026-05-12', reason: 'entered late' })).statusCode).toBe(200);
    const fleet = json<Events>(await call(owner, 'GET', `/api/fleet/${vehicle.id}`));
    expect(fleet.events.map((e) => [e.kind, e.occurredOn])).toEqual([
      ['arrived', '2026-04-01'],
      ['sold', '2026-05-01'],
      ['bought_back', '2026-05-10'],
      ['sold', '2026-05-12'],
    ]);
  });

  it('moves the row alone for a sale that names only what the papers show', async () => {
    const { customer, owner } = await fixtures();
    const { id } = json<{ id: string }>(await call(owner, 'POST', '/api/sales', { customerId: customer.id, vinNote: 'VIN not confirmed (test)', priceTetri: '2900', soldOn: '2026-05-19' }));
    const res = await call(owner, 'POST', `/api/sales/${id}/date`, { soldOn: '2026-05-16', reason: 'typo' });
    expect(res.statusCode, res.body).toBe(200);
    expect(json(res)).toMatchObject({ changed: true, history: false, moved: 1 });
    expect((await card(owner, id)).sale.soldOn).toBe('2026-05-16');
  });

  it('checks a buy-back against the day the sale has now', async () => {
    const { vehicle, customer, owner } = await fixtures();
    const { id } = json<{ id: string }>(await call(owner, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '2900', soldOn: '2026-05-19' }));
    await call(owner, 'POST', `/api/sales/${id}/date`, { soldOn: '2026-05-16', reason: 'typo' });
    // The 17th was before the sale by the old day, and is after it by the right one.
    expect((await call(owner, 'POST', `/api/sales/${id}/buy-back`, { amountTetri: '2000', occurredOn: '2026-05-17', channel: 'cash' })).statusCode).toBe(200);
  });

  it('counts the moped as free until the right day, not until the day it was typed in', async () => {
    const { vehicle, customer, owner } = await fixtures();
    await arrived(vehicle.id, '2026-08-01');
    const { id } = json<{ id: string }>(await call(owner, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '2900', soldOn: '2026-09-20' }));
    type Econ = { economics: { days: { available: number; sold: number } } };
    const was = json<Econ>(await call(owner, 'GET', `/api/fleet/${vehicle.id}/economics`)).economics.days;
    expect(was.available).toBe(50);

    await call(owner, 'POST', `/api/sales/${id}/date`, { soldOn: '2026-09-10', reason: 'typo' });
    const now = json<Econ>(await call(owner, 'GET', `/api/fleet/${vehicle.id}/economics`)).economics.days;
    // 1 August to 10 September, and sold from then: no day counted twice.
    expect(now.available).toBe(40);
    expect(now.sold).toBe(daysBetween('2026-09-10', todayISO()));
  });

  it('says which day the signed document carries once the sale’s day is put right (B4-06)', async () => {
    const { prisma, vehicle, customer, owner } = await fixtures();
    const { id } = json<{ id: string }>(await call(owner, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '2900', soldOn: '2026-05-19' }));
    // Signed a minute ago — written straight in, the signature itself is documents.test.ts's.
    await prisma.storedFile.create({
      data: {
        kind: 'pdf',
        docKind: 'sale',
        saleId: id,
        label: 'test-sale.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
        sha256: 'test',
        bytes: new Uint8Array([0]),
        signedAt: new Date(Date.now() - 60_000),
        signedBy: 'Test Buyer',
      },
    });
    expect((await card(owner, id)).signedSoldOn).toBe('2026-05-19');

    await call(owner, 'POST', `/api/sales/${id}/date`, { soldOn: '2026-05-16', reason: 'typo' });
    await call(owner, 'POST', `/api/sales/${id}/date`, { soldOn: '2026-05-17', reason: 'typo again' });
    const after = await card(owner, id);
    expect(after.sale.soldOn).toBe('2026-05-17');
    // The paper keeps the day it was signed with, whatever came after.
    expect(after.signedSoldOn).toBe('2026-05-19');
  });
});
