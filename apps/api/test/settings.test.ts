// Rates, the deposit and what a point is (wave 6 §3.5, criteria 10, 11, 13).
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

describe.skipIf(!HAS_DB)('the rental settings', () => {
  it('starts at one rate of 150 ₾ and a deposit of 180 ₾ (crit. 11)', async () => {
    const owner = await loginAs('owner');
    const s = json<{ depositTetri: number; quickRates: { rateTetri: number }[] }>(await call(owner, 'GET', '/api/settings/rental'));
    expect(s.depositTetri).toBe(18000);
    // 140 and 170 are not created: the rentals that carry them keep their own
    // figure, which lives on the rental (Mika, 21.09.2026).
    expect(s.quickRates.map((r) => r.rateTetri)).toContain(15000);
    expect(s.quickRates.map((r) => r.rateTetri)).not.toContain(14000);
    expect(s.quickRates.map((r) => r.rateTetri)).not.toContain(17000);
  });

  it('changes the deposit and says so in the journal (crit. 10)', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const before = json<{ depositTetri: number }>(await call(owner, 'GET', '/api/settings/rental')).depositTetri;
    const changed = await call(owner, 'PATCH', '/api/settings/rental', { depositTetri: '200' });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(json<{ depositTetri: number }>(await call(owner, 'GET', '/api/settings/rental')).depositTetri).toBe(20000);

    const entry = await prisma.auditLog.findFirst({
      where: { action: 'settings.deposit', entityId: 'rental' },
      orderBy: { createdAt: 'desc' },
    });
    expect(entry?.before).toMatchObject({ depositTetri: before });
    expect(entry?.after).toMatchObject({ depositTetri: 20000 });

    await call(owner, 'PATCH', '/api/settings/rental', { depositTetri: '180' });
  });

  it('adds a rate to the buttons and takes it off without touching old rentals (crit. 11)', async () => {
    const owner = await loginAs('owner');
    const added = await call(owner, 'POST', '/api/settings/rates', { rateTetri: '160' });
    expect(added.statusCode, added.body).toBe(201);
    const id = json<{ id: string }>(added).id;
    expect(json<{ quickRates: { rateTetri: number }[] }>(await call(owner, 'GET', '/api/settings/rental')).quickRates.map((r) => r.rateTetri)).toContain(16000);

    // The same figure twice is one button, not two.
    expect((await call(owner, 'POST', '/api/settings/rates', { rateTetri: '160' })).statusCode).toBe(409);

    expect((await call(owner, 'DELETE', `/api/settings/rates/${id}`)).statusCode).toBe(200);
    expect(json<{ quickRates: { rateTetri: number }[] }>(await call(owner, 'GET', '/api/settings/rental')).quickRates.map((r) => r.rateTetri)).not.toContain(16000);
    // Archived, not deleted: a rental written at that rate still reads true.
    const { prisma } = await import('../src/lib/db.js');
    expect((await prisma.quickRate.findUniqueOrThrow({ where: { id } })).archived).toBe(true);
  });

  it('is an owner’s to change and a manager’s to read (crit. 12)', async () => {
    const manager = await loginAs('manager');
    // A manager hands mopeds over, so they need the figures.
    expect((await call(manager, 'GET', '/api/settings/rental')).statusCode).toBe(200);
    expect((await call(manager, 'PATCH', '/api/settings/rental', { depositTetri: '1' })).statusCode).toBe(403);
    expect((await call(manager, 'POST', '/api/settings/rates', { rateTetri: '99' })).statusCode).toBe(403);
  });
});

describe.skipIf(!HAS_DB)('a point has a kind', () => {
  it('is created as a swap station and chosen like any other point (crit. 13)', async () => {
    const owner = await loginAs('owner');
    const made = await call(owner, 'POST', '/api/locations', { name: `ТЕСТ станция ${uniq()}`, kind: 'swap' });
    expect(made.statusCode, made.body).toBe(201);
    const id = json<{ id: string }>(made).id;

    const list = json<{ locations: { id: string; kind: string }[] }>(await call(owner, 'GET', '/api/locations'));
    expect(list.locations.find((l) => l.id === id)?.kind).toBe('swap');

    // Nothing behaves differently by kind yet: a station takes mopeds like
    // a showroom does, which is what closing a repair at one proves.
    const { prisma } = await import('../src/lib/db.js');
    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Swap ${uniq()}` } });
    const vehicle = await prisma.vehicle.create({
      data: { vin: `TESTSWAP${uniq().replace(/\D/g, '').slice(-9).padStart(9, '0')}`, modelId: model.id },
    });
    const { id: jobId } = json<{ id: string }>(await call(owner, 'POST', '/api/service', { vehicleId: vehicle.id, reason: 'ТЕСТ' }));
    const closed = await call(owner, 'POST', `/api/service/${jobId}/close`, { odometerKm: 10, locationId: id });
    expect(closed.statusCode, closed.body).toBe(200);
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).locationId).toBe(id);

    // And the kind is corrected on the screen like a name.
    expect((await call(owner, 'PATCH', `/api/locations/${id}`, { kind: 'workshop' })).statusCode).toBe(200);
    expect((await call(owner, 'PATCH', `/api/locations/${id}`, { kind: 'garage' })).statusCode).toBe(400);
  });
});
