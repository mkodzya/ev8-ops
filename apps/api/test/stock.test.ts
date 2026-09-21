// The warehouse: parts on the shelf, and mopeds counted by model.
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

interface PartRow {
  id: string;
  name: string;
  onHand: number;
  valueTetri: number;
  avgCostTetri: number | null;
  minQty: number;
  shortBy: number;
}

async function part(extra: Record<string, unknown> = {}) {
  const otherOwner = await loginAs('owner');
  const name = `Brake pad ${uniq()}`;
  const res = await call(otherOwner, 'POST', '/api/parts', { name, ...extra });
  expect(res.statusCode, res.body).toBe(201);
  return { otherOwner, name, id: json<{ id: string }>(res).id };
}

const cardOf = async (cookie: string, id: string) =>
  json<{ part: PartRow; moves: { kind: string; qty: number; reason: string | null; purchase: { number: string } | null; job: { number: string } | null }[] }>(
    await call(cookie, 'GET', `/api/parts/${id}`),
  );

describe.skipIf(!HAS_DB)('the parts list', () => {
  it('starts a new part at nothing on the shelf, and refuses the same name twice', async () => {
    const { otherOwner, name, id } = await part({ minQty: 4 });
    const card = await cardOf(otherOwner, id);
    expect(card.part).toMatchObject({ onHand: 0, valueTetri: 0, avgCostTetri: null, shortBy: 4 });
    expect(card.moves).toEqual([]);

    const again = await call(otherOwner, 'POST', '/api/parts', { name: name.toUpperCase() });
    expect(again.statusCode).toBe(409);
    expect(json<{ error: string }>(again).error).toBe('part_exists');
  });

  it('is read by anyone in the workshop but written only by those who repair', async () => {
    const manager = await loginAs('manager');
    expect((await call(manager, 'GET', '/api/parts')).statusCode).toBe(200);
    expect((await call(manager, 'POST', '/api/parts', { name: `Filter ${uniq()}` })).statusCode).toBe(403);
  });
});

describe.skipIf(!HAS_DB)('a shipment lands on the shelf', () => {
  it('receives the ordered quantity at what it cost to land, once and only once', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { id: partId } = await part();
    const owner = await loginAs('owner');
    const supplier = await prisma.customer.create({ data: { name: `Supplier ${uniq()}`, isSupplier: true } });

    const { id: poId } = json<{ id: string }>(
      await call(owner, 'POST', '/api/purchases', { supplierId: supplier.id, currency: 'CNY', orderedOn: '2026-04-01', extrasTetri: 0 }),
    );
    // 20 pads at 30.00 CNY, paid 2 400.00 GEL for the shipment.
    const line = await call(owner, 'POST', `/api/purchases/${poId}/lines`, { partId, qty: 20, unitPrice: '30' });
    expect(line.statusCode, line.body).toBe(201);
    await call(owner, 'POST', `/api/purchases/${poId}/payments`, { grossTetri: '2400', occurredOn: '2026-04-05', channel: 'transfer' });

    const received = await call(owner, 'POST', `/api/purchases/${poId}/receive`, { receivedOn: '2026-05-01', vins: {} });
    expect(received.statusCode, received.body).toBe(200);
    expect(json<{ parts: number }>(received).parts).toBe(20);

    const card = await cardOf(owner, partId);
    expect(card.part.onHand).toBe(20);
    expect(card.part.valueTetri).toBe(240000);
    expect(card.part.avgCostTetri).toBe(12000);
    expect(card.moves[0]).toMatchObject({ kind: 'receipt', qty: 20 });
    expect(card.moves[0].purchase).not.toBeNull();

    // The order cannot arrive twice, so the shelf cannot be stocked twice.
    expect((await call(owner, 'POST', `/api/purchases/${poId}/receive`, { receivedOn: '2026-05-01', vins: {} })).statusCode).toBe(409);
    expect((await cardOf(owner, partId)).part.onHand).toBe(20);
  });
});

describe.skipIf(!HAS_DB)('a repair takes parts off the shelf', () => {
  async function stocked(qty: number, unitCostTetri: number) {
    const { prisma } = await import('../src/lib/db.js');
    const { id: partId } = await part();
    const owner = await loginAs('owner');
    await prisma.stockMove.create({
      data: { partId, kind: 'receipt', qty, unitCostTetri, occurredOn: new Date('2026-04-01T00:00:00Z') },
    });
    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Model ${uniq()}` } });
    const vehicle = await prisma.vehicle.create({
      data: { vin: `TESTS${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id },
    });
    return { prisma, partId, owner, vehicle };
  }

  /** A moped out with somebody: the only kind whose repair a customer pays for. */
  async function rentedVehicle(): Promise<{ vehicleId: string }> {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Rented ${uniq()}`, weeklyRateTetri: 15000 } });
    const vehicle = await prisma.vehicle.create({
      data: { vin: `TESTR${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id, pool: 'rent' },
    });
    const customer = await prisma.customer.create({ data: { name: `ТЕСТ Repair ${uniq()}` } });
    const res = await call(owner, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000 });
    if (res.statusCode !== 201) throw new Error(res.body);
    return { vehicleId: vehicle.id };
  }

  it('takes them when the line is added and puts them back when it is removed', async () => {
    const { partId, owner, vehicle } = await stocked(10, 1200);
    const { id: jobId } = json<{ id: string }>(
      await call(owner, 'POST', '/api/service', { vehicleId: vehicle.id, reason: 'brake pads', openedOn: '2026-05-10' }),
    );
    const added = await call(owner, 'POST', `/api/service/${jobId}/parts`, { partId, qty: 3, unitPriceTetri: '25' });
    expect(added.statusCode, added.body).toBe(201);
    const lineId = json<{ id: string }>(added).id;

    let card = await cardOf(owner, partId);
    expect(card.part.onHand).toBe(7);
    expect(card.part.valueTetri).toBe(8400);
    expect(card.moves[0]).toMatchObject({ kind: 'issue', qty: -3 });
    expect(card.moves[0].job).not.toBeNull();

    expect((await call(owner, 'DELETE', `/api/service/${jobId}/parts/${lineId}`)).statusCode).toBe(200);
    card = await cardOf(owner, partId);
    expect(card.part.onHand).toBe(10);
    expect(card.moves.filter((m) => m.kind === 'issue')).toHaveLength(0);
  });

  it('prices a part by who is paying for the repair (B8-04, wave 5 crit. 22, 23)', async () => {
    const { prisma, partId, owner, vehicle } = await stocked(10, 1200);
    await prisma.part.update({ where: { id: partId }, data: { salePriceTetri: 2500 } });
    // The company's own repair costs the company what the shelf paid.
    const { id: jobId } = json<{ id: string }>(
      await call(owner, 'POST', '/api/service', { vehicleId: vehicle.id, reason: 'pads', openedOn: '2026-05-10' }),
    );
    const added = await call(owner, 'POST', `/api/service/${jobId}/parts`, { partId, qty: 2 });
    expect(added.statusCode, added.body).toBe(201);
    const job = json<{ job: { parts: { unitPriceTetri: number }[] } }>(await call(owner, 'GET', `/api/service/${jobId}`));
    expect(job.job.parts[0].unitPriceTetri).toBe(1200);

    // The same part on a repair the customer pays for goes on at its price.
    const rented = await rentedVehicle();
    const { id: mine } = json<{ id: string }>(
      await call(owner, 'POST', '/api/service', { vehicleId: rented.vehicleId, reason: 'pads', payer: 'customer', openedOn: '2026-05-10' }),
    );
    expect((await call(owner, 'POST', `/api/service/${mine}/parts`, { partId, qty: 1 })).statusCode).toBe(201);
    const theirs = json<{ job: { parts: { unitPriceTetri: number }[] } }>(await call(owner, 'GET', `/api/service/${mine}`));
    expect(theirs.job.parts[0].unitPriceTetri).toBe(2500);
  });

  it('records a repair even when the shelf is short, and says so out loud', async () => {
    // Refusing here would teach the workshop to stop recording repairs. The
    // count goes below zero instead, where a stock-take can see it.
    const { partId, owner, vehicle } = await stocked(1, 1200);
    const { id: jobId } = json<{ id: string }>(
      await call(owner, 'POST', '/api/service', { vehicleId: vehicle.id, reason: 'pads', openedOn: '2026-05-10' }),
    );
    expect((await call(owner, 'POST', `/api/service/${jobId}/parts`, { partId, qty: 4, unitPriceTetri: '25' })).statusCode).toBe(201);
    const card = await cardOf(owner, partId);
    expect(card.part.onHand).toBe(-3);
    expect(card.part.valueTetri).toBe(0);

    const list = json<{ totals: { negative: number } }>(await call(owner, 'GET', '/api/parts'));
    expect(list.totals.negative).toBeGreaterThanOrEqual(1);
  });

  /**
   * QA-W5-14: cancelling a repair that had parts on it wrote a `return`
   * movement the table's check constraint did not know, and the whole
   * cancellation came back a 500 with the parts still off the shelf.
   */
  it('gives the parts back when the whole repair is cancelled (wave 5 crit. 27)', async () => {
    const { partId, owner, vehicle } = await stocked(10, 1200);
    const { id: jobId } = json<{ id: string }>(
      await call(owner, 'POST', '/api/service', { vehicleId: vehicle.id, reason: 'pads', openedOn: '2026-05-10' }),
    );
    expect((await call(owner, 'POST', `/api/service/${jobId}/parts`, { partId, qty: 2 })).statusCode).toBe(201);
    expect((await cardOf(owner, partId)).part.onHand).toBe(8);

    const cancelled = await call(owner, 'POST', `/api/service/${jobId}/cancel`, { reason: 'ТЕСТ opened on the wrong VIN' });
    expect(cancelled.statusCode, cancelled.body).toBe(200);

    const card = await cardOf(owner, partId);
    expect(card.part.onHand).toBe(10);
    // Back at what it left at, so the shelf's average is where it was.
    expect(card.part.valueTetri).toBe(12000);
    const back = card.moves.find((m) => m.kind === 'return');
    expect(back).toMatchObject({ kind: 'return', qty: 2 });
    // The reason carries the job it came off, so the shelf can explain itself.
    expect(back!.reason).toContain('ТЕСТ opened on the wrong VIN');
  });
});

describe.skipIf(!HAS_DB)('a stock-take', () => {
  it('writes the difference with a reason, and refuses one without', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { id: partId } = await part();
    const otherOwner = await loginAs('owner');
    await prisma.stockMove.create({
      data: { partId, kind: 'receipt', qty: 10, unitCostTetri: 1200, occurredOn: new Date('2026-04-01T00:00:00Z') },
    });

    expect((await call(otherOwner, 'POST', `/api/parts/${partId}/count`, { countedQty: 8 })).statusCode).toBe(400);
    const done = await call(otherOwner, 'POST', `/api/parts/${partId}/count`, { countedQty: 8, reason: 'two broke in the workshop' });
    expect(done.statusCode, done.body).toBe(200);
    expect(json<{ delta: number; onHand: number }>(done)).toMatchObject({ delta: -2, onHand: 8 });

    const card = await cardOf(otherOwner, partId);
    expect(card.part.onHand).toBe(8);
    // What is left keeps the price it had; a stock-take counts, it does not price.
    expect(card.part.avgCostTetri).toBe(1200);
    expect(card.moves[0].reason).toBe('two broke in the workshop');

    // Counting the same number again changes nothing and says so.
    expect((await call(otherOwner, 'POST', `/api/parts/${partId}/count`, { countedQty: 8, reason: 'again' })).statusCode).toBe(409);
  });

  it('is not for a manager to do', async () => {
    const { id: partId } = await part();
    const manager = await loginAs('manager');
    expect((await call(manager, 'POST', `/api/parts/${partId}/count`, { countedQty: 3, reason: 'found some' })).statusCode).toBe(403);
  });
});

describe.skipIf(!HAS_DB)('mopeds by model', () => {
  it('counts what stands here, what is ours, and what has been ordered but has not arrived', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Stock ${uniq()}` } });
    await prisma.vehicle.create({
      data: { vin: `TESTV${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id, costTetri: 150000 },
    });
    await prisma.vehicle.create({
      data: { vin: `TESTW${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id, costTetri: 150000, state: 'sold' },
    });
    const supplier = await prisma.customer.create({ data: { name: `Supplier ${uniq()}`, isSupplier: true } });
    const { id: poId } = json<{ id: string }>(
      await call(owner, 'POST', '/api/purchases', { supplierId: supplier.id, currency: 'CNY', orderedOn: '2026-04-01' }),
    );
    await call(owner, 'POST', `/api/purchases/${poId}/lines`, { modelId: model.id, qty: 5, unitPrice: '4000' });

    const rows = json<{ rows: { id: string; inStock: number; ours: number; onOrder: number; valueTetri: number }[] }>(
      await call(owner, 'GET', '/api/stock/vehicles'),
    ).rows;
    const row = rows.find((r) => r.id === model.id)!;
    expect(row).toMatchObject({ inStock: 1, ours: 1, onOrder: 5 });
    // A moped already sold is not stock and is not worth anything on a shelf.
    expect(row.valueTetri).toBe(150000);
  });
});
