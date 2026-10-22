// M-10 on live rows (wave 6 §3.2, criteria 5–7).
import { fleetChipOf, type VehiclePool, type VehicleState } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

const vin = (tag: string) => `TESTU${tag.replace(/\D/g, '').slice(-12).padStart(12, '0')}`;

describe.skipIf(!HAS_DB)('utilisation of the rental fleet', () => {
  it('counts days in the park against days out, from the mopeds own events (crit. 5)', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Util ${uniq()}`, weeklyRateTetri: 15000 } });

    // Two mopeds in the rental park for the whole fortnight; one of them out
    // with somebody for a week of it.
    const busy = await prisma.vehicle.create({ data: { vin: vin(uniq()), modelId: model.id, pool: 'rent' } });
    const idle = await prisma.vehicle.create({ data: { vin: vin(uniq()), modelId: model.id, pool: 'rent' } });
    for (const v of [busy, idle]) {
      await prisma.vehicleEvent.create({ data: { vehicleId: v.id, kind: 'arrived', occurredOn: new Date('2026-08-01'), toState: 'available' } });
    }
    await prisma.vehicleEvent.create({ data: { vehicleId: busy.id, kind: 'pickup', occurredOn: new Date('2026-09-01'), toState: 'rented' } });
    await prisma.vehicleEvent.create({ data: { vehicleId: busy.id, kind: 'return', occurredOn: new Date('2026-09-08'), toState: 'available' } });

    const u = json<{ rentedDays: number; poolDays: number; percent: number; rows: { id: string; poolDays: number }[] }>(
      await call(owner, 'GET', '/api/reports/utilisation?from=2026-09-01&to=2026-09-14'),
    );
    const mine = u.rows.filter((r) => r.id === busy.id || r.id === idle.id);
    expect(mine).toHaveLength(2);
    expect(mine.every((r) => r.poolDays === 14)).toBe(true);
    expect(u.rows.find((r) => r.id === busy.id)).toMatchObject({ rentedDays: 7 });
    expect(u.rows.find((r) => r.id === idle.id)).toMatchObject({ rentedDays: 0 });
  });

  it('adds up by model to the same total, and refuses a period that runs backwards (crit. 7)', async () => {
    const owner = await loginAs('owner');
    const u = json<{ rentedDays: number; poolDays: number; byModel: { rentedDays: number; poolDays: number }[] }>(
      await call(owner, 'GET', '/api/reports/utilisation?from=2026-09-01&to=2026-09-14'),
    );
    expect(u.byModel.reduce((n, m) => n + m.poolDays, 0)).toBe(u.poolDays);
    expect(u.byModel.reduce((n, m) => n + m.rentedDays, 0)).toBe(u.rentedDays);

    const wrong = await call(owner, 'GET', '/api/reports/utilisation?from=2026-09-14&to=2026-09-01');
    expect(wrong.statusCode).toBe(400);
    expect(json<{ error: string }>(wrong).error).toBe('bad_period');
  });

  // ADR-0005, addendum 22.10.2026 (Mika, answer «А»): a number beside a link is the list it opens.
  it('gives its link into «Не назначен» that list’s number, not the period’s mopeds with no park', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Unclaimed ${uniq()}`, weeklyRateTetri: 15000 } });
    type Answer = { unassigned: number; unassignedIdle: number };
    const period = '/api/reports/utilisation?from=2026-09-01&to=2026-09-14';
    const before = json<Answer>(await call(owner, 'GET', period));

    // Two mopeds no park has claimed: one standing idle, one out with a
    // renter, as the mopeds brought over from Odoo stood.
    const idle = await prisma.vehicle.create({ data: { vin: vin(uniq()), modelId: model.id } });
    const out = await prisma.vehicle.create({ data: { vin: vin(uniq()), modelId: model.id, state: 'rented' } });
    for (const v of [idle, out]) {
      await prisma.vehicleEvent.create({ data: { vehicleId: v.id, kind: 'arrived', occurredOn: new Date('2026-08-01'), toState: 'available' } });
    }
    const after = json<Answer>(await call(owner, 'GET', period));

    // Both are outside the figure; only the idle one is behind the link.
    expect(after.unassigned - before.unassigned).toBe(2);
    expect(after.unassignedIdle - before.unassignedIdle).toBe(1);
    const fleet = json<{ vehicles: { state: VehicleState; pool: VehiclePool | null; location: unknown }[] }>(await call(owner, 'GET', '/api/fleet')).vehicles;
    expect(after.unassignedIdle).toBe(fleet.filter((v) => fleetChipOf(v, v.location != null) === 'nopool').length);

    // A rented moped with no rental behind it is not left for the suites after this one.
    await prisma.vehicle.update({ where: { id: out.id }, data: { state: 'available' } });
  });

  it('is an owner’s figure', async () => {
    const manager = await loginAs('manager');
    expect((await call(manager, 'GET', '/api/reports/utilisation')).statusCode).toBe(403);
  });
});

describe.skipIf(!HAS_DB)('what kept the figure down (§3.2)', () => {
  it('names the moped that was in repair the whole period, and says nothing about batteries', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Stuck ${uniq()}`, weeklyRateTetri: 15000 } });
    const stuck = await prisma.vehicle.create({ data: { vin: vin(uniq()), modelId: model.id, pool: 'rent', state: 'service' } });
    await prisma.vehicleEvent.create({ data: { vehicleId: stuck.id, kind: 'arrived', occurredOn: new Date('2026-07-01'), toState: 'available' } });
    await prisma.vehicleEvent.create({ data: { vehicleId: stuck.id, kind: 'service_in', occurredOn: new Date('2026-07-10'), toState: 'service' } });

    const u = json<{
      blockers: { inRepairAllPeriod: { id: string; vin: string; days: number }[]; freeTooLong: { id: string }[]; batteriesHolding: null };
    }>(await call(owner, 'GET', '/api/reports/utilisation?from=2026-08-01&to=2026-08-31'));

    const mine = u.blockers.inRepairAllPeriod.find((r) => r.id === stuck.id);
    expect(mine).toBeDefined();
    expect(mine?.days).toBe(31);
    expect(mine?.vin).toBe(stuck.vin);
    // It is in repair, so it cannot also be on the "free too long" list.
    expect(u.blockers.freeTooLong.some((r) => r.id === stuck.id)).toBe(false);
    // No record ties a repair to a missing battery: null, never 0 (CLAUDE.md rule 1).
    expect(u.blockers.batteriesHolding).toBeNull();
  });

  it('counts the mopeds per model beside the days, and the two agree (crit. 7)', async () => {
    const owner = await loginAs('owner');
    const u = json<{ vehicles: number; rows: unknown[]; byModel: { vehicles: number }[] }>(
      await call(owner, 'GET', '/api/reports/utilisation?from=2026-09-01&to=2026-09-14'),
    );
    expect(u.vehicles).toBe(u.rows.length);
    expect(u.byModel.reduce((n, m) => n + m.vehicles, 0)).toBe(u.vehicles);
  });
});

describe.skipIf(!HAS_DB)('a moped carries its utilisation into the economics (§3.3)', () => {
  it('answers with the same per cent M-10 gives for it', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Econ ${uniq()}`, weeklyRateTetri: 15000 } });
    const v = await prisma.vehicle.create({ data: { vin: vin(uniq()), modelId: model.id, pool: 'rent' } });
    await prisma.vehicleEvent.create({ data: { vehicleId: v.id, kind: 'arrived', occurredOn: new Date('2026-08-01'), toState: 'available' } });

    const econ = json<{ economics: { id: string; utilisation: number | null } }>(await call(owner, 'GET', `/api/fleet/${v.id}/economics`));
    expect(econ.economics.utilisation).toBe(0);

    const list = json<{ rows: { id: string; utilisation: number | null }[] }>(await call(owner, 'GET', '/api/economics'));
    expect(list.rows.find((r) => r.id === v.id)?.utilisation).toBe(0);
  });
});

describe.skipIf(!HAS_DB)('a sale carried over from Odoo still takes the moped out (QA-W6-06)', () => {
  it('stops counting it as idle capacity from the day it was sold, with no event to say so', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Carried ${uniq()}` } });
    const moped = await prisma.vehicle.create({ data: { vin: vin(uniq()), modelId: model.id, pool: 'rent', state: 'sold' } });
    // It arrived, and that is the only event it has: the deal was written
    // straight into `sales`, as the migration from Odoo did.
    await prisma.vehicleEvent.create({ data: { vehicleId: moped.id, kind: 'arrived', occurredOn: new Date('2026-08-01'), toState: 'available' } });
    const customer = await prisma.customer.create({ data: { name: `ТЕСТ Carried ${uniq()}` } });
    const sale = await prisma.sale.create({
      data: { number: `SL-T${uniq().replace(/\D/g, '').slice(-5)}`, customerId: customer.id, vehicleId: moped.id, soldOn: new Date('2026-09-10'), priceTetri: 500000 },
    });

    const mid = json<{ rows: { id: string; poolDays: number }[] }>(
      await call(owner, 'GET', '/api/reports/utilisation?from=2026-09-01&to=2026-09-30'),
    );
    // Nine days of September, not thirty: sold on the tenth.
    expect(mid.rows.find((r) => r.id === moped.id)?.poolDays).toBe(9);

    const after = json<{ rows: { id: string }[] }>(await call(owner, 'GET', '/api/reports/utilisation?from=2026-10-01&to=2026-10-31'));
    expect(after.rows.find((r) => r.id === moped.id)).toBeUndefined();

    // Bought back, and it is capacity again from that day — the event the
    // product writes wins by being later.
    await prisma.sale.update({ where: { id: sale.id }, data: { status: 'bought_back', boughtBackOn: new Date('2026-10-15') } });
    const back = json<{ rows: { id: string; poolDays: number }[] }>(
      await call(owner, 'GET', '/api/reports/utilisation?from=2026-10-01&to=2026-10-31'),
    );
    expect(back.rows.find((r) => r.id === moped.id)?.poolDays).toBe(17);
  });
});
