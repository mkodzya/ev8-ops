// The header search (wave 1 §3.5): every kind of record, by what a person
// remembers, within the rights of the one asking.
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

interface Groups {
  groups: {
    customers: { total: number; items: { id: string }[] };
    vehicles: { total: number; items: { id: string }[] };
    rentals: { total: number; items: { id: string; number: string }[] };
    payments: { total: number; items: { id: string }[] };
    purchases: { total: number; items: { id: string }[] } | null;
  } | null;
}

const search = async (cookie: string, q: string) => json<Groups>(await call(cookie, 'GET', `/api/search?q=${encodeURIComponent(q)}`));

describe.skipIf(!HAS_DB)('the header search', () => {
  it('finds a customer by the last digits of the phone and by a Georgian spelling', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const tail = String(Date.now()).slice(-6);
    const c = await prisma.customer.create({ data: { name: `Search Probe ${uniq()}`, nameKa: `ძებნა ${tail}`, phone: `+995 555 ${tail.slice(0, 2)} ${tail.slice(2, 4)} ${tail.slice(4)}` } });
    const manager = await loginAs('manager');
    expect((await search(manager, tail)).groups!.customers.items.map((i) => i.id)).toContain(c.id);
    expect((await search(manager, `ძებნა ${tail}`)).groups!.customers.items.map((i) => i.id)).toContain(c.id);
  });

  it('finds a moped by the end of its VIN and a rental by its number', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Search ${uniq()}`, weeklyRateTetri: 15000 } });
    const vin = `SRCH${uniq().replace(/\D/g, '').slice(-13).padStart(13, '0')}`;
    const vehicle = await prisma.vehicle.create({ data: { vin, modelId: model.id } });
    const customer = await prisma.customer.create({ data: { name: `Renter ${uniq()}`, phone: `+9955${uniq().replace(/\D/g, '').slice(-8)}` } });
    const owner = await loginAs('owner');
    const made = await call(owner, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: '150', pickedUpOn: '2026-09-10' });
    expect(made.statusCode, made.body).toBe(201);
    const { id } = json<{ id: string }>(made);
    const rental = await prisma.rental.findUniqueOrThrow({ where: { id } });

    const byVin = await search(owner, vin.slice(-6));
    expect(byVin.groups!.vehicles.items.map((i) => i.id)).toContain(vehicle.id);
    expect(byVin.groups!.rentals.items.map((i) => i.id)).toContain(id);
    expect((await search(owner, rental.number)).groups!.rentals.items.map((i) => i.id)).toContain(id);
  });

  it('keeps purchases and other people\'s payments from a manager', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const customer = await prisma.customer.create({ data: { name: `Payer ${uniq()}` } });
    const owner = await loginAs('owner');
    const manager = await loginAs('manager');
    const amount = 100 + (Date.now() % 800);
    const byOwner = json<{ id: string }>(await call(owner, 'POST', '/api/payments', { customerId: customer.id, channel: 'cash', grossTetri: amount * 100 }));
    const byManager = json<{ id: string }>(await call(manager, 'POST', '/api/payments', { customerId: customer.id, channel: 'cash', grossTetri: amount * 100 }));

    const asManager = await search(manager, String(amount));
    expect(asManager.groups!.purchases).toBeNull();
    const seen = asManager.groups!.payments.items.map((i) => i.id);
    expect(seen).toContain(byManager.id);
    expect(seen).not.toContain(byOwner.id);

    const asOwner = await search(owner, String(amount));
    expect(asOwner.groups!.purchases).not.toBeNull();
    expect(asOwner.groups!.payments.total).toBeGreaterThanOrEqual(2);
  });

  it('answers nothing to one character, and gives the total beyond the first three', async () => {
    const owner = await loginAs('owner');
    expect((await search(owner, 'a')).groups).toBeNull();
    const { prisma } = await import('../src/lib/db.js');
    const family = `Fam${uniq().replace(/\D/g, '').slice(-5)}`;
    for (let i = 0; i < 4; i++) await prisma.customer.create({ data: { name: `${family} ${i}` } });
    const found = await search(owner, family);
    expect(found.groups!.customers.items).toHaveLength(3);
    expect(found.groups!.customers.total).toBe(4);
  });
});
