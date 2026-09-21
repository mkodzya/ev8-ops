// M-10 on live rows (wave 6 §3.2, criteria 5–7).
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

  it('is an owner’s figure', async () => {
    const manager = await loginAs('manager');
    expect((await call(manager, 'GET', '/api/reports/utilisation')).statusCode).toBe(403);
  });
});
