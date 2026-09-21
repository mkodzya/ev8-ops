// Two roles (redesign §2.1, Mika 17.09.2026). What a manager may not see is
// cut in the API itself, not only hidden on the screen.
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

async function modelWithCost() {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Costed ${uniq()}`, weeklyRateTetri: 15000, costTetri: 168929 } });
  const vehicle = await prisma.vehicle.create({
    data: { vin: `ROLE${uniq().replace(/\D/g, '').slice(0, 13).padStart(13, '0')}`, modelId: model.id, costTetri: 168929 },
  });
  return { prisma, model, vehicle };
}

describe.skipIf(!HAS_DB)('what a manager does not see', () => {
  it('purchases and suppliers are the owners\' — the API refuses them', async () => {
    const manager = await loginAs('manager');
    for (const url of ['/api/purchases', '/api/suppliers']) expect((await call(manager, 'GET', url)).statusCode, url).toBe(403);
    const owner = await loginAs('owner');
    expect((await call(owner, 'GET', '/api/purchases')).statusCode).toBe(200);
  });

  it('no unit cost in models, the moped card or the stock of mopeds', async () => {
    const { model, vehicle } = await modelWithCost();
    const manager = await loginAs('manager');
    const owner = await loginAs('owner');

    const models = async (c: string) =>
      json<{ models: { id: string; costTetri: number | null }[] }>(await call(c, 'GET', '/api/models')).models.find((m) => m.id === model.id)!;
    expect((await models(manager)).costTetri).toBeUndefined();
    expect('costSource' in (await models(manager))).toBe(false);
    expect((await models(owner)).costTetri).toBe(168929);

    const card = json<{ model: { costTetri: number | null }; orders: unknown[] }>(await call(manager, 'GET', `/api/models/${model.id}`));
    expect(card.model.costTetri).toBeUndefined();
    expect(card.orders).toEqual([]);

    const moped = async (c: string) => json<{ vehicle: { costTetri: number | null } }>(await call(c, 'GET', `/api/fleet/${vehicle.id}`)).vehicle.costTetri;
    expect(await moped(manager)).toBeNull();
    expect(await moped(owner)).toBe(168929);

    // The shelf says the same: a manager sees what is on it, not what it is
    // worth. (The table of mopeds by model went with wave 5 §8.)
    const shelf = json<{ parts: { avgCostTetri: number | null; valueTetri: number | null }[]; totals: { valueTetri: number | null } }>(
      await call(manager, 'GET', '/api/parts'),
    );
    expect(shelf.totals.valueTetri).toBeNull();
    expect(shelf.parts.every((p) => p.avgCostTetri === null && p.valueTetri === null)).toBe(true);
  });

  it('no stock value or average cost of a part', async () => {
    const owner = await loginAs('owner');
    const made = await call(owner, 'POST', '/api/parts', { name: `Role probe ${uniq()}` });
    expect(made.statusCode, made.body).toBe(201);
    const { id } = json<{ id: string }>(made);
    const manager = await loginAs('manager');
    const parts = json<{ parts: { avgCostTetri: number | null; valueTetri: number | null }[]; totals: { valueTetri: number | null } }>(
      await call(manager, 'GET', '/api/parts'),
    );
    expect(parts.totals.valueTetri).toBeNull();
    expect(parts.parts.every((p) => p.avgCostTetri === null && p.valueTetri === null)).toBe(true);
    const one = json<{ part: { valueTetri: number | null } }>(await call(manager, 'GET', `/api/parts/${id}`));
    expect(one.part.valueTetri).toBeNull();
  });

  it('only their own cash in the payments list, and no deposit sums on Today', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const customer = await prisma.customer.create({ data: { name: `Role Payer ${uniq()}` } });
    const owner = await loginAs('owner');
    const manager = await loginAs('manager');
    const byOwner = await call(owner, 'POST', '/api/payments', { customerId: customer.id, channel: 'cash', grossTetri: 100 });
    expect(byOwner.statusCode, byOwner.body).toBe(201);
    const byManager = await call(manager, 'POST', '/api/payments', { customerId: customer.id, channel: 'cash', grossTetri: 200 });
    expect(byManager.statusCode, byManager.body).toBe(201);

    const seen = json<{ payments: { id: string }[] }>(await call(manager, 'GET', '/api/payments')).payments.map((p) => p.id);
    expect(seen).toContain(json<{ id: string }>(byManager).id);
    expect(seen).not.toContain(json<{ id: string }>(byOwner).id);
    // On a customer's card the manager has open, the card's payments are all there.
    const onCard = json<{ payments: { id: string }[] }>(await call(manager, 'GET', `/api/payments?customerId=${customer.id}`)).payments;
    expect(onCard).toHaveLength(2);

    const summary = json<{ deposits: { held: number; heldTetri: number | null } }>(await call(manager, 'GET', '/api/summary'));
    expect(summary.deposits.heldTetri).toBeNull();
    expect(json<{ deposits: { heldTetri: number | null } }>(await call(owner, 'GET', '/api/summary')).deposits.heldTetri).not.toBeNull();
  });
});
