// Models: the catalogue, and the one form that adds to it from anywhere.
// Needs a *_test database; the teardown removes everything it made.
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

interface ModelRow {
  id: string;
  brand: string;
  name: string;
  costTetri: number | null;
  costSource: { kind: string; number?: string } | null;
  fleet: { rent: number; sale: number; none: number; gone: number };
  onOrder: number;
  archived: boolean;
}

describe.skipIf(!HAS_DB)('adding a model', () => {
  it('needs only a brand and a name, and refuses the same model spelled another way', async () => {
    const owner = await loginAs('owner');
    const brand = `Test${uniq().slice(-6)}`;
    const made = await call(owner, 'POST', '/api/models', { brand, name: 'B12 Pro' });
    expect(made.statusCode, made.body).toBe(201);
    const { id } = json<{ id: string }>(made);

    const twin = await call(owner, 'POST', '/api/models', { brand: brand.toUpperCase(), name: '  b12 pro ' });
    expect(twin.statusCode).toBe(409);
    expect(json<{ error: string; id: string }>(twin)).toMatchObject({ error: 'duplicate_model', id });
  });

  it('keeps the spelling of a brand already in the catalogue', async () => {
    const owner = await loginAs('owner');
    const brand = `Test${uniq().slice(-6)}`;
    await call(owner, 'POST', '/api/models', { brand, name: 'One' });
    const second = json<{ brand: string }>(await call(owner, 'POST', '/api/models', { brand: brand.toLowerCase(), name: 'Two' }));
    expect(second.brand).toBe(brand);
  });

  it('is the owner\'s to write, and everybody\'s to read', async () => {
    const manager = await loginAs('manager');
    expect((await call(manager, 'POST', '/api/models', { brand: 'Test', name: `M ${uniq()}` })).statusCode).toBe(403);
    expect((await call(manager, 'GET', '/api/models')).statusCode).toBe(200);
  });
});

describe.skipIf(!HAS_DB)('a model card', () => {
  it('counts its mopeds by park, what is on order, and says it has no cost yet', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Card ${uniq()}` } });
    const vin = () => `TESTM${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`;
    await prisma.vehicle.create({ data: { vin: vin(), modelId: model.id, pool: 'rent' } });
    await prisma.vehicle.create({ data: { vin: vin(), modelId: model.id } });
    await prisma.vehicle.create({ data: { vin: vin(), modelId: model.id, pool: 'sale', state: 'sold' } });
    const supplier = await prisma.customer.create({ data: { name: `Supplier ${uniq()}`, isSupplier: true } });
    const { id: poId } = json<{ id: string }>(await call(owner, 'POST', '/api/purchases', { supplierId: supplier.id, currency: 'CNY', orderedOn: '2026-04-01' }));
    await call(owner, 'POST', `/api/purchases/${poId}/lines`, { modelId: model.id, qty: 3, unitPrice: '4000' });

    const res = await call(owner, 'GET', `/api/models/${model.id}`);
    expect(res.statusCode, res.body).toBe(200);
    const card = json<{ model: ModelRow; vehicles: unknown[]; orders: { qty: number; unitCostTetri: number | null }[] }>(res);
    expect(card.model.fleet).toEqual({ rent: 1, sale: 0, none: 1, gone: 1 });
    expect(card.model.onOrder).toBe(3);
    expect(card.vehicles).toHaveLength(3);
    // Nothing paid, nothing received: no unit cost anywhere, and no guess.
    expect(card.orders).toEqual([expect.objectContaining({ qty: 3, unitCostTetri: null })]);
    expect(card.model.costTetri).toBeNull();
    expect(card.model.costSource).toBeNull();
  });

  it('names Odoo as the source of a cost no shipment here has written', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const model = await prisma.vehicleModel.create({
      data: { brand: 'Test', name: `Odoo ${uniq()}`, costTetri: 168929, odooSaleProductId: Number(uniq().replace(/\D/g, '').slice(-8)) },
    });
    const card = json<{ model: ModelRow }>(await call(owner, 'GET', `/api/models/${model.id}`));
    expect(card.model).toMatchObject({ costTetri: 168929, costSource: { kind: 'odoo' } });
  });
});

describe.skipIf(!HAS_DB)('correcting a model', () => {
  it('changes prices and hides it, but the cost is not for typing', async () => {
    const owner = await loginAs('owner');
    const { id } = json<{ id: string }>(await call(owner, 'POST', '/api/models', { brand: 'Test', name: `Edit ${uniq()}` }));
    const res = await call(owner, 'PATCH', `/api/models/${id}`, { weeklyRateTetri: 15000, costTetri: 1, archived: true });
    expect(res.statusCode, res.body).toBe(200);

    const listed = json<{ models: ModelRow[] }>(await call(owner, 'GET', '/api/models')).models;
    expect(listed.find((m) => m.id === id)).toBeUndefined();
    const all = json<{ models: (ModelRow & { weeklyRateTetri: number })[] }>(await call(owner, 'GET', '/api/models?archived=1')).models;
    expect(all.find((m) => m.id === id)).toMatchObject({ weeklyRateTetri: 15000, costTetri: null, archived: true });
  });

  it('refuses a rename onto a model that already exists', async () => {
    const owner = await loginAs('owner');
    const name = `Rename ${uniq()}`;
    await call(owner, 'POST', '/api/models', { brand: 'Test', name });
    const { id } = json<{ id: string }>(await call(owner, 'POST', '/api/models', { brand: 'Test', name: `${name} 2` }));
    const res = await call(owner, 'PATCH', `/api/models/${id}`, { name: name.toUpperCase() });
    expect(res.statusCode).toBe(409);
  });
});
