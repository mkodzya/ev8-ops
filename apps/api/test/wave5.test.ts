// Wave 5 as the API hands it over: a sale with its schedule and its refusals,
// a shipment received before it is paid for and re-costed afterwards, a
// breakdown a manager reported, the shelf's opening balance, and the two
// corrections an owner may make to a record (docs/redesign/wave-5.md §6).
import { todayISO } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

const vin = (...parts: (string | number)[]): string => {
  const clean = parts.join('').toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');
  const tail = clean.slice(-17);
  return tail.length === 17 ? tail : 'W'.repeat(17 - tail.length) + tail;
};

async function forSale(priceTetri = 520000) {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Sale ${uniq()}`, salePriceTetri: priceTetri, forSale: true } });
  const vehicle = await prisma.vehicle.create({ data: { vin: vin('W5', uniq()), modelId: model.id, pool: 'sale' } });
  const customer = await prisma.customer.create({ data: { name: `ТЕСТ Волна 5 ${uniq()}`, phone: `+9955${uniq().replace(/\D/g, '').slice(-8)}` } });
  return { prisma, model, vehicle, customer };
}

interface SaleCard {
  sale: {
    id: string;
    number: string;
    priceTetri: number;
    overdueTetri: number;
    aheadTetri: number;
    paidTetri: number;
    status: string;
    instalments: { seq: number; dueOn: string; amountTetri: number; paidTetri: number; state: string }[];
  };
  feed: { text: string }[];
}

describe.skipIf(!HAS_DB)('wave 5 · selling', () => {
  it('builds the schedule, takes the prepayment with its fee and owes only what is due (crit. 1, 8)', async () => {
    const owner = await loginAs('owner');
    const { vehicle, customer } = await forSale();
    const made = await call(owner, 'POST', '/api/sales', {
      customerId: customer.id,
      vehicleId: vehicle.id,
      priceTetri: '5200',
      downPaymentTetri: '1000',
      months: 3,
    });
    expect(made.statusCode, made.body).toBe(201);
    const { id } = json<{ id: string }>(made);

    const paid = await call(owner, 'POST', `/api/sales/${id}/payments`, { grossTetri: '1396', channel: 'acquiring' });
    expect(paid.statusCode, paid.body).toBe(201);
    // 1.5 % of an acquiring payment is the company's expense (money.md).
    expect(json<{ feeTetri: number }>(paid).feeTetri).toBe(2094);

    const card = json<SaleCard>(await call(owner, 'GET', `/api/sales/${id}`));
    expect(card.sale.instalments).toHaveLength(4);
    expect(card.sale.instalments[0].amountTetri).toBe(100000);
    expect(card.sale.paidTetri).toBe(139600);
    // The moped left the fleet the moment it was sold.
    const fleet = json<{ vehicle: { state: string } }>(await call(owner, 'GET', `/api/fleet/${vehicle.id}`));
    expect(fleet.vehicle.state).toBe('sold');
  });

  it('refuses a moped that is out on rent in words about selling (crit. 2)', async () => {
    const owner = await loginAs('owner');
    const { prisma, customer } = await forSale();
    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Rented ${uniq()}`, weeklyRateTetri: 15000, salePriceTetri: 500000 } });
    const moped = await prisma.vehicle.create({ data: { vin: vin('W5R', uniq()), modelId: model.id, pool: 'rent' } });
    const rental = await call(owner, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: moped.id, weeklyRateTetri: 15000 });
    expect(rental.statusCode, rental.body).toBe(201);
    const res = await call(owner, 'POST', '/api/sales', { customerId: customer.id, vehicleId: moped.id, priceTetri: '5000' });
    expect(res.statusCode).toBe(409);
    // Its own code: `vehicle_rented` also answered "a rented moped takes no
    // point" and "close the rental first", and the screen showed the wrong
    // one of the three — the words crit. 2 forbids (QA-W5-04).
    expect(json<{ error: string }>(res).error).toBe('vehicle_rented_sale');
  });

  it('carries a sale over with what was paid before the move (crit. 5)', async () => {
    const owner = await loginAs('owner');
    const { vehicle, customer } = await forSale(518800);
    const made = await call(owner, 'POST', '/api/sales', {
      customerId: customer.id,
      vehicleId: vehicle.id,
      priceTetri: '5188',
      downPaymentTetri: '1000',
      months: 3,
      soldOn: '2026-06-15',
      transferred: true,
      paidBeforeTetri: '2396',
    });
    expect(made.statusCode, made.body).toBe(201);
    const card = json<SaleCard>(await call(owner, 'GET', `/api/sales/${json<{ id: string }>(made).id}`));
    expect(card.sale.instalments.map((i) => i.paidTetri)).toEqual([100000, 139600, 0, 0]);
    expect(card.sale.paidTetri).toBe(239600);
    expect(card.sale.overdueTetri).toBeGreaterThan(0);
  });

  it('closes the schedule on a buy-back and leaves nothing owed (crit. 6)', async () => {
    const owner = await loginAs('owner');
    const { vehicle, customer } = await forSale();
    const { id } = json<{ id: string }>(
      await call(owner, 'POST', '/api/sales', { customerId: customer.id, vehicleId: vehicle.id, priceTetri: '5200', downPaymentTetri: '1000', months: 3 }),
    );
    await call(owner, 'POST', `/api/sales/${id}/payments`, { grossTetri: '1000', channel: 'cash' });
    const back = await call(owner, 'POST', `/api/sales/${id}/buy-back`, { amountTetri: '800', channel: 'cash' });
    expect(back.statusCode, back.body).toBe(200);
    const card = json<SaleCard>(await call(owner, 'GET', `/api/sales/${id}`));
    expect(card.sale.status).toBe('bought_back');
    expect(card.sale.overdueTetri).toBe(0);
    expect(card.sale.aheadTetri).toBe(0);
    const fleet = json<{ vehicle: { state: string } }>(await call(owner, 'GET', `/api/fleet/${vehicle.id}`));
    expect(fleet.vehicle.state).toBe('available');
  });
});

describe.skipIf(!HAS_DB)('wave 5 · shipments', () => {
  async function order() {
    const owner = await loginAs('owner');
    const supplier = json<{ id: string }>(await call(owner, 'POST', '/api/suppliers', { name: `ТЕСТ Factory ${uniq()}`, country: 'China', contact: 'Alibaba' }));
    const { prisma } = await import('../src/lib/db.js');
    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Batch ${uniq()}` } });
    const part = json<{ id: string }>(await call(owner, 'POST', '/api/parts', { name: `ТЕСТ Sensor ${uniq()}` }));
    const made = await call(owner, 'POST', '/api/purchases', {
      supplierId: supplier.id,
      currency: 'CNY',
      orderedOn: '2026-09-01',
      extrasTetri: '500',
      // The shipment of the prototype: two mopeds and a box of sensors, so
      // the percentages and the unit costs are the ones in the criteria.
      lines: [
        { modelId: model.id, qty: 2, unitPrice: '2600' },
        { partId: part.id, qty: 20, unitPrice: '40' },
      ],
    });
    expect(made.statusCode, made.body).toBe(201);
    return { owner, supplier, model, part, id: json<{ id: string }>(made).id };
  }

  interface Card {
    purchase: {
      paidPercent: number;
      rate: number | null;
      debtMinor: number;
      preliminary: boolean;
      lines: { unitCostTetri: number }[];
    };
    vehicles: { id: string; costTetri: number | null }[];
  }

  it('costs the goods at the rate the payments went through at (crit. 11)', async () => {
    const { owner, id } = await order();
    await call(owner, 'POST', `/api/purchases/${id}/payments`, { grossTetri: '423.57', foreignAmount: '1000', channel: 'transfer' });
    const c = json<Card>(await call(owner, 'GET', `/api/purchases/${id}`));
    expect(c.purchase.paidPercent).toBe(17);
    expect(c.purchase.rate).toBeCloseTo(0.42357, 5);
    expect(c.purchase.debtMinor).toBe(500000);
    expect(c.purchase.preliminary).toBe(true);
    // 2 600 CNY at that rate plus half the freight: 1 101.28 + 250. The
    // sensors ride along but do not carry the freight (Q24): 40 × 0.42357.
    expect(c.purchase.lines[0].unitCostTetri).toBe(135128);
    expect(c.purchase.lines[1].unitCostTetri).toBe(1694);
  });

  it('arrives before it is paid for and is costed again by the payment that settles it (crit. 19, §7)', async () => {
    const { owner, id, part } = await order();
    await call(owner, 'POST', `/api/purchases/${id}/payments`, { grossTetri: '423.57', foreignAmount: '1000', channel: 'transfer' });
    const tag = uniq();
    const received = await call(owner, 'POST', `/api/purchases/${id}/receive`, {
      receivedOn: '2026-09-10',
      color: 'red',
      year: 2026,
      pool: 'rent',
      vins: { [json<{ purchase: { lines: { id: string }[] } }>(await call(owner, 'GET', `/api/purchases/${id}`)).purchase.lines[0].id]: [vin('RCA', tag, 1), vin('RCB', tag, 2)] },
    });
    expect(received.statusCode, received.body).toBe(200);
    expect(json<{ vehicles: number; preliminary: boolean }>(received)).toMatchObject({ vehicles: 2, preliminary: true });

    const before = json<Card>(await call(owner, 'GET', `/api/purchases/${id}`));
    expect(before.vehicles.every((v) => v.costTetri === 135128)).toBe(true);

    // The rest goes out at a slightly different rate: every VIN is written
    // again. It goes through the money form, which is the door the screen
    // uses — the recost used to hang on the purchase route instead, so the
    // suite stayed green while the cost on the screen never moved (QA-W5-10).
    const settled = await call(owner, 'POST', '/api/money', {
      kind: 'supplier',
      purchaseId: id,
      amountTetri: '2115.03',
      foreignAmount: '5000',
      foreignCurrency: 'CNY',
      channel: 'transfer',
    });
    expect(settled.statusCode, settled.body).toBe(201);
    const after = json<Card>(await call(owner, 'GET', `/api/purchases/${id}`));
    expect(after.purchase.preliminary).toBe(false);
    expect(after.purchase.debtMinor).toBe(0);
    expect(after.vehicles.every((v) => v.costTetri !== 135128)).toBe(true);
    const moped = json<{ vehicle: { costTetri: number } }>(await call(owner, 'GET', `/api/fleet/${after.vehicles[0].id}`));
    expect(moped.vehicle.costTetri).toBe(after.vehicles[0].costTetri);
    // And the journal says why the figure moved, for both mopeds.
    const { prisma } = await import('../src/lib/db.js');
    const written = await prisma.auditLog.findMany({
      where: { action: 'vehicle.cost', entityId: { in: after.vehicles.map((v) => v.id) } },
      select: { note: true },
    });
    expect(written).toHaveLength(2);
    expect(written.every((w) => w.note === 'paid the supplier')).toBe(true);

    // The order's own feed carries the recost, which used to live only in
    // audit_log where no screen read it (crit. 19, QA-W5-01).
    const feed = json<{ journal: { action: string }[] }>(await call(owner, 'GET', `/api/purchases/${id}`));
    expect(feed.journal.some((l) => l.action === 'purchase.recost')).toBe(true);

    // The shelf follows the same money: parts landed at the 17 % rate were
    // dragging the average down until the invoice was settled (QA-W5-17).
    const shelf = json<{ part: { onHand: number; avgCostTetri: number | null } }>(await call(owner, 'GET', `/api/parts/${part.id}`));
    expect(shelf.part.onHand).toBe(20);
    // 1 694 at the 17 % rate; the settled invoice works it out again.
    expect(shelf.part.avgCostTetri).toBe(1692);

    // And a card that quotes a cost says whether the figure has stopped moving.
    const card = json<{ vehicle: { costPreliminary: boolean; costPaidPercent: number | null } }>(
      await call(owner, 'GET', `/api/fleet/${after.vehicles[0].id}`),
    );
    expect(card.vehicle).toMatchObject({ costPreliminary: false, costPaidPercent: 100 });
  });

  it('takes the cost back off the mopeds when a supplier payment is annulled (§7)', async () => {
    const { owner, id } = await order();
    await call(owner, 'POST', `/api/purchases/${id}/payments`, { grossTetri: '423.57', foreignAmount: '1000', channel: 'transfer' });
    const tag = uniq();
    const lineId = json<{ purchase: { lines: { id: string }[] } }>(await call(owner, 'GET', `/api/purchases/${id}`)).purchase.lines[0].id;
    await call(owner, 'POST', `/api/purchases/${id}/receive`, {
      receivedOn: '2026-09-10',
      pool: 'rent',
      vins: { [lineId]: [vin('VDA', tag, 1), vin('VDB', tag, 2)] },
    });
    const settle = await call(owner, 'POST', '/api/money', {
      kind: 'supplier',
      purchaseId: id,
      amountTetri: '2115.03',
      foreignAmount: '5000',
      foreignCurrency: 'CNY',
      channel: 'transfer',
    });
    const paymentId = json<{ id: string }>(settle).id;
    const settled = json<Card>(await call(owner, 'GET', `/api/purchases/${id}`));
    expect(settled.purchase.preliminary).toBe(false);

    const voided = await call(owner, 'POST', `/api/payments/${paymentId}/void`, { reason: 'ТЕСТ wrong order' });
    expect(voided.statusCode, voided.body).toBe(200);
    const back = json<Card>(await call(owner, 'GET', `/api/purchases/${id}`));
    expect(back.purchase.preliminary).toBe(true);
    // Back at the 17 % figure the shipment was received at.
    expect(back.vehicles.every((v) => v.costTetri === 135128)).toBe(true);
  });

  it('names the line of a VIN that is not a VIN, and one the fleet already holds (crit. 14, 15)', async () => {
    const { owner, id } = await order();
    const lineId = json<{ purchase: { lines: { id: string }[] } }>(await call(owner, 'GET', `/api/purchases/${id}`)).purchase.lines[0].id;
    const short = await call(owner, 'POST', `/api/purchases/${id}/receive`, { vins: { [lineId]: [vin('OKA', uniq()), 'TEST-1'] } });
    expect(json<{ error: string; line: number; fault: string }>(short)).toMatchObject({ error: 'bad_vin_line', line: 2, fault: 'length' });

    const { prisma } = await import('../src/lib/db.js');
    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Known ${uniq()}` } });
    const known = await prisma.vehicle.create({ data: { vin: vin('KNW', uniq()), modelId: model.id } });
    const clash = await call(owner, 'POST', `/api/purchases/${id}/receive`, { vins: { [lineId]: [vin('OKB', uniq()), known.vin] } });
    expect(json<{ error: string; line: number }>(clash)).toMatchObject({ error: 'duplicate_vin', line: 2 });
    // Nothing of the shipment was written: it is still an order.
    expect(json<{ purchase: { status: string } }>(await call(owner, 'GET', `/api/purchases/${id}`)).purchase.status).toBe('ordered');
  });

  it('keeps the factory out of the hand-over’s search (B3-06, crit. 3, 10)', async () => {
    const owner = await loginAs('owner');
    const name = `ТЕСТ Supplier ${uniq()}`;
    await call(owner, 'POST', '/api/suppliers', { name, country: 'China' });
    const suppliers = json<{ suppliers: { name: string }[] }>(await call(owner, 'GET', '/api/suppliers'));
    expect(suppliers.suppliers.some((s) => s.name === name)).toBe(true);
    const customers = json<{ customers: { name: string }[] }>(await call(owner, 'GET', '/api/customers'));
    expect(customers.customers.some((c) => c.name === name)).toBe(false);
  });
});

describe.skipIf(!HAS_DB)('wave 5 · the shelf and the records', () => {
  it('starts a part once and then receives it (crit. 29)', async () => {
    const owner = await loginAs('owner');
    const part = json<{ id: string }>(await call(owner, 'POST', '/api/parts', { name: `ТЕСТ Part ${uniq()}`, minQty: 2 }));
    const started = await call(owner, 'POST', `/api/parts/${part.id}/initial`, { qty: 10, unitCostTetri: '12.50', occurredOn: '2026-09-15' });
    expect(started.statusCode, started.body).toBe(201);
    const card = json<{ part: { onHand: number; valueTetri: number } }>(await call(owner, 'GET', `/api/parts/${part.id}`));
    expect(card.part).toMatchObject({ onHand: 10, valueTetri: 12500 });
    // Once it has moved, its opening balance is history.
    const again = await call(owner, 'POST', `/api/parts/${part.id}/initial`, { qty: 5, unitCostTetri: '12.50' });
    expect(json<{ error: string }>(again).error).toBe('stock_started');
    expect((await call(owner, 'POST', `/api/parts/${part.id}/receipt`, { qty: 2, unitCostTetri: '12.50', reason: 'ТЕСТ куплено в магазине' })).statusCode).toBe(201);
    expect(json<{ part: { onHand: number } }>(await call(owner, 'GET', `/api/parts/${part.id}`)).part.onHand).toBe(12);
  });

  it('turns a part below its level into an order to whoever supplied it (crit. 28)', async () => {
    const owner = await loginAs('owner');
    const supplier = json<{ id: string }>(await call(owner, 'POST', '/api/suppliers', { name: `ТЕСТ Parts Co ${uniq()}` }));
    const part = json<{ id: string }>(await call(owner, 'POST', '/api/parts', { name: `ТЕСТ Pads ${uniq()}`, minQty: 2 }));
    const order = json<{ id: string }>(
      await call(owner, 'POST', '/api/purchases', { supplierId: supplier.id, currency: 'CNY', lines: [{ partId: part.id, qty: 1, unitPrice: '40' }] }),
    );
    expect(order.id).toBeTruthy();
    const draft = await call(owner, 'POST', '/api/purchases/from-part', { partId: part.id });
    expect(draft.statusCode, draft.body).toBe(201);
    const made = json<{ id: string }>(draft);
    const card = json<{ purchase: { supplier: { id: string }; lines: { qty: number; partId: string | null }[] } }>(await call(owner, 'GET', `/api/purchases/${made.id}`));
    expect(card.purchase.supplier.id).toBe(supplier.id);
    expect(card.purchase.lines[0]).toMatchObject({ qty: 2, partId: part.id });
  });

  it('corrects a VIN and merges two cards, both with a reason (crit. 32, 33)', async () => {
    const owner = await loginAs('owner');
    const { prisma } = await import('../src/lib/db.js');
    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Fix ${uniq()}` } });
    const moped = await prisma.vehicle.create({ data: { vin: vin('FIX', uniq()), modelId: model.id } });
    const better = vin('GOOD', uniq());
    const fixed = await call(owner, 'PATCH', `/api/fleet/${moped.id}/vin`, { vin: better, reason: 'ТЕСТ опечатка в CMR' });
    expect(fixed.statusCode, fixed.body).toBe(200);
    expect(json<{ vin: string }>(fixed).vin).toBe(better);
    expect((await call(owner, 'PATCH', `/api/fleet/${moped.id}/vin`, { vin: 'TEST-1', reason: 'ТЕСТ' })).statusCode).toBe(400);

    // The correction has to be visible on the card, not only in audit_log:
    // crit. 32 asks for a "было / стало" and the card showed none (QA-W5-01).
    const card = json<{ journal: { action: string; note: string | null; before: unknown; after: unknown }[] }>(
      await call(owner, 'GET', `/api/fleet/${moped.id}`),
    );
    const entry = card.journal.find((l) => l.action === 'vehicle.vin');
    expect(entry).toBeDefined();
    expect(entry!.note).toBe('ТЕСТ опечатка в CMR');
    expect(entry!.before).toMatchObject({ vin: moped.vin });
    expect(entry!.after).toMatchObject({ vin: better });

    const keep = await prisma.customer.create({ data: { name: `ТЕСТ Keep ${uniq()}` } });
    const drop = await prisma.customer.create({ data: { name: `ТЕСТ Drop ${uniq()}` } });
    const rentalModel = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Merge ${uniq()}`, weeklyRateTetri: 15000 } });
    const rentalVehicle = await prisma.vehicle.create({ data: { vin: vin('MRG', uniq()), modelId: rentalModel.id, pool: 'rent' } });
    expect((await call(owner, 'POST', '/api/rentals', { customerId: drop.id, vehicleId: rentalVehicle.id, weeklyRateTetri: 15000 })).statusCode).toBe(201);
    const merged = await call(owner, 'POST', `/api/customers/${keep.id}/merge`, { fromId: drop.id, reason: 'ТЕСТ один человек, две карточки' });
    expect(merged.statusCode, merged.body).toBe(200);
    expect(json<{ moved: { rentals: number } }>(merged).moved.rentals).toBe(1);
    const gone = await prisma.customer.findUniqueOrThrow({ where: { id: drop.id }, select: { archived: true, mergedIntoId: true } });
    expect(gone).toMatchObject({ archived: true, mergedIntoId: keep.id });
  });

  it('lets a manager report a breakdown and an owner take it up (crit. 21)', async () => {
    const manager = await loginAs('manager');
    const { prisma } = await import('../src/lib/db.js');
    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Broken ${uniq()}` } });
    const moped = await prisma.vehicle.create({ data: { vin: vin('BRK', uniq()), modelId: model.id, pool: 'rent' } });
    const reported = await call(manager, 'POST', '/api/service', { vehicleId: moped.id, reason: 'ТЕСТ не заводится' });
    expect(reported.statusCode, reported.body).toBe(201);
    const { id } = json<{ id: string }>(reported);

    const owner = await loginAs('owner');
    // A moped standing in the yard goes into service the moment it is reported.
    expect(json<{ vehicle: { state: string } }>(await call(owner, 'GET', `/api/fleet/${moped.id}`)).vehicle.state).toBe('service');
    const today = json<{ queue: { group: string; rows: { action: string; id: string }[] }[] }>(await call(owner, 'GET', '/api/today'));
    const service = today.queue.find((g) => g.group === 'service');
    expect(service?.rows.some((r) => r.action === 'open_report' && r.id === `report:${id}`) ?? false).toBe(true);
    expect((await call(owner, 'PATCH', `/api/service/${id}`, { open: true })).statusCode).toBe(200);
    expect(json<{ job: { status: string } }>(await call(owner, 'GET', `/api/service/${id}`)).job.status).toBe('open');
    void todayISO;
  });
});
