// «Изменить данные» on a moped's card (issue #19 of the director, item 2): the
// colour, the year and the day it came, put right by an owner, each change in
// the moped's history «было → стало» with who made it. Mopeds, days and
// reasons are invented test values.
import { addDays, todayISO } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

const errorOf = (res: { body: string }) => json<{ error: string }>(res).error;

/** A moped added the way the owner adds one by hand: with its «Пришёл» on the day it came. */
async function moped(owner: string, body: { color?: string; year?: number; arrivedOn?: string } = {}) {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Details ${uniq()}`, forRent: true } });
  const vin = `TESTV${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`;
  const res = await call(owner, 'POST', '/api/fleet', { vin, modelId: model.id, ...body });
  expect(res.statusCode, res.body).toBe(201);
  return json<{ id: string }>(res).id;
}

interface Card {
  vehicle: { color: string | null; year: number | null; arrivedOn: string | null };
  events: { kind: string; occurredOn: string }[];
  journal: { action: string; by: string | null; note: string | null; before: unknown; after: unknown }[];
}
async function cardOf(cookie: string, id: string): Promise<Card> {
  const res = await call(cookie, 'GET', `/api/fleet/${id}`);
  expect(res.statusCode, res.body).toBe(200);
  return json<Card>(res);
}
const updates = (card: Card) => card.journal.filter((l) => l.action === 'vehicle.update');

describe.skipIf(!HAS_DB)('an owner puts a moped’s details right on its card (issue #19)', () => {
  it('changes the colour and the year, and the history says what they were and who changed them', async () => {
    const owner = await loginAs('owner');
    const id = await moped(owner, { color: 'red', year: 2024, arrivedOn: '2026-09-10' });
    const res = await call(owner, 'PATCH', `/api/fleet/${id}`, { color: 'black', year: 2025 });
    expect(res.statusCode, res.body).toBe(200);
    expect(json<{ changed: boolean }>(res).changed).toBe(true);

    const card = await cardOf(owner, id);
    expect(card.vehicle).toMatchObject({ color: 'black', year: 2025, arrivedOn: '2026-09-10' });
    const [line] = updates(card);
    expect(line).toMatchObject({ before: { color: 'red', year: 2024 }, after: { color: 'black', year: 2025 }, note: null });
    expect(line!.by).toBeTruthy();

    // The same values again change nothing and leave no second line.
    const same = await call(owner, 'PATCH', `/api/fleet/${id}`, { color: 'black', year: 2025 });
    expect(json<{ changed: boolean }>(same).changed).toBe(false);
    expect(updates(await cardOf(owner, id))).toHaveLength(1);

    // «Not known» is an honest colour: it is written as none, and the line says from what.
    expect((await call(owner, 'PATCH', `/api/fleet/${id}`, { color: '' })).statusCode).toBe(200);
    const cleared = await cardOf(owner, id);
    expect(cleared.vehicle.color).toBeNull();
    expect(updates(cleared)[0]).toMatchObject({ before: { color: 'black' }, after: { color: null } });
  });

  it('moves the day it came with a reason, and its «Пришёл» with it', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const id = await moped(owner, { arrivedOn: '2026-09-10' });
    // Something happened to it on 15.09: the day it came is not after that.
    await prisma.vehicleEvent.create({
      data: { vehicleId: id, kind: 'manual', occurredOn: new Date('2026-09-15T00:00:00Z'), fromState: 'available', toState: 'available', reason: 'test event' },
    });

    const noReason = await call(owner, 'PATCH', `/api/fleet/${id}`, { arrivedOn: '2026-09-01' });
    expect(noReason.statusCode).toBe(400);
    expect(json<{ error: string; field: string }>(noReason)).toMatchObject({ error: 'missing_field', field: 'reason' });

    const moved = await call(owner, 'PATCH', `/api/fleet/${id}`, { arrivedOn: '2026-09-01', reason: 'test: the date was typed from the invoice' });
    expect(moved.statusCode, moved.body).toBe(200);
    const card = await cardOf(owner, id);
    expect(card.vehicle.arrivedOn).toBe('2026-09-01');
    expect(card.events.find((e) => e.kind === 'arrived')?.occurredOn).toBe('2026-09-01');
    // A day as a day on both sides — not the moment Prisma hands back.
    expect(updates(card)[0]).toMatchObject({ before: { arrivedOn: '2026-09-10' }, after: { arrivedOn: '2026-09-01' }, note: 'test: the date was typed from the invoice' });

    // The same day as the first thing in its history will do; a day after it will not.
    expect((await call(owner, 'PATCH', `/api/fleet/${id}`, { arrivedOn: '2026-09-15', reason: 'test' })).statusCode).toBe(200);
    const late = await call(owner, 'PATCH', `/api/fleet/${id}`, { arrivedOn: '2026-09-16', reason: 'test' });
    expect(late.statusCode).toBe(400);
    expect(json<{ error: string; field: string; fault: string; latest: string; latestBy: string }>(late)).toMatchObject({
      error: 'arrival_date_bad',
      field: 'arrivedOn',
      fault: 'after_history',
      latest: '2026-09-15',
      latestBy: 'history',
    });
    expect((await cardOf(owner, id)).vehicle.arrivedOn).toBe('2026-09-15');
  });

  it('refuses a day after today, a year that cannot be, and taking away a day that was written', async () => {
    const owner = await loginAs('owner');
    const today = todayISO();
    const id = await moped(owner, { year: 2024, arrivedOn: '2026-09-10' });

    const future = await call(owner, 'PATCH', `/api/fleet/${id}`, { arrivedOn: addDays(today, 1), reason: 'test' });
    expect(future.statusCode).toBe(400);
    expect(json<{ error: string; fault: string; latest: string; latestBy: string }>(future)).toMatchObject({ error: 'arrival_date_bad', fault: 'future', latest: today, latestBy: 'today' });

    const nextYear = Number(today.slice(0, 4)) + 1;
    for (const year of [1999, nextYear + 1]) {
      const res = await call(owner, 'PATCH', `/api/fleet/${id}`, { year });
      expect(res.statusCode, `${year}: ${res.body}`).toBe(400);
      expect(json<{ error: string; field: string; min: number; max: number }>(res)).toMatchObject({ error: 'vehicle_year_bad', field: 'year', min: 2000, max: nextYear });
    }
    expect((await call(owner, 'PATCH', `/api/fleet/${id}`, { year: nextYear })).statusCode).toBe(200);

    const gone = await call(owner, 'PATCH', `/api/fleet/${id}`, { arrivedOn: '', reason: 'test' });
    expect(gone.statusCode).toBe(400);
    expect(json<{ error: string; field: string }>(gone)).toMatchObject({ error: 'missing_field', field: 'arrivedOn' });

    const card = await cardOf(owner, id);
    expect(card.vehicle).toMatchObject({ year: nextYear, arrivedOn: '2026-09-10' });
    // Only the year that went through is in the history.
    expect(updates(card)).toHaveLength(1);
  });

  it('is an owner’s: a manager changes nothing', async () => {
    const owner = await loginAs('owner');
    const manager = await loginAs('manager');
    const id = await moped(owner, { color: 'red' });
    const res = await call(manager, 'PATCH', `/api/fleet/${id}`, { color: 'black' });
    expect(res.statusCode).toBe(403);
    expect((await cardOf(owner, id)).vehicle.color).toBe('red');
    const nobody = await call(owner, 'PATCH', '/api/fleet/00000000-0000-4000-8000-000000000000', { color: 'black' });
    expect(nobody.statusCode).toBe(404);
    expect(errorOf(nobody)).toBe('vehicle_not_found');
  });
});
