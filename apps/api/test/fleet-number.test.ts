// Every moped's own number, EV-007, and the stickers that carry it (meeting
// of Mika and Kardu, 14.10.2026; the form and the sticker chosen 15.10.2026).
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

async function twoMopeds() {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Model ${uniq()}`, forRent: true } });
  const vin = () => `TESTN${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`;
  const a = await prisma.vehicle.create({ data: { vin: vin(), modelId: model.id } });
  const b = await prisma.vehicle.create({ data: { vin: vin(), modelId: model.id } });
  return { prisma, a, b };
}

describe('where a sticker’s QR may lead', () => {
  it('only to EV8 Ops’ own stands or a laptop; anything else goes to production', async () => {
    const { stickerOrigin } = await import('../src/routes/fleet.js');
    expect(stickerOrigin('https://ops.ev8.ge')).toBe('https://ops.ev8.ge');
    expect(stickerOrigin('https://test.ops.ev8.ge')).toBe('https://test.ops.ev8.ge');
    expect(stickerOrigin('http://localhost:5173')).toBe('http://localhost:5173');
    expect(stickerOrigin('https://ops.ev8.ge.example.com')).toBe('https://ops.ev8.ge');
    expect(stickerOrigin('https://evil.test')).toBe('https://ops.ev8.ge');
    expect(stickerOrigin(undefined)).toBe('https://ops.ev8.ge');
  });
});

describe.skipIf(!HAS_DB)('the fleet number', () => {
  it('a new moped takes the next number by itself, and the number finds it', async () => {
    const { a, b } = await twoMopeds();
    expect(a.fleetNo).toEqual(expect.any(Number));
    expect(b.fleetNo).toBe(a.fleetNo! + 1);

    const owner = await loginAs('owner');
    const list = json<{ vehicles: { id: string; fleetNo: number | null }[] }>(await call(owner, 'GET', '/api/fleet'));
    expect(list.vehicles.find((v) => v.id === a.id)?.fleetNo).toBe(a.fleetNo);
    const card = json<{ vehicle: { fleetNo: number } }>(await call(owner, 'GET', `/api/fleet/${a.id}`));
    expect(card.vehicle.fleetNo).toBe(a.fleetNo);

    const code = `EV-${String(a.fleetNo).padStart(3, '0')}`;
    expect(json<{ id: string }>(await call(owner, 'GET', `/api/fleet/by-number/${code}`)).id).toBe(a.id);
    expect(json<{ id: string }>(await call(owner, 'GET', `/api/fleet/by-number/ev${a.fleetNo}`)).id).toBe(a.id);
    expect((await call(owner, 'GET', '/api/fleet/by-number/EV-99999')).statusCode).toBe(404);
    expect((await call(owner, 'GET', '/api/fleet/by-number/nonsense')).statusCode).toBe(404);

    const found = json<{ groups: { vehicles: { items: { id: string; fleetNo: number }[] } } }>(await call(owner, 'GET', `/api/search?q=ev${a.fleetNo}`));
    expect(found.groups.vehicles.items.map((v) => v.id)).toContain(a.id);
  });

  it('prints a sheet of stickers for a range, and refuses a range backwards', async () => {
    const { a, b } = await twoMopeds();
    const manager = await loginAs('manager');
    const res = await call(manager, 'GET', `/api/fleet/stickers.pdf?from=${a.fleetNo}&to=${b.fleetNo}&origin=https%3A%2F%2Ftest.ops.ev8.ge`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await call(manager, 'GET', `/api/fleet/stickers.pdf?from=${b.fleetNo}&to=${a.fleetNo}`)).statusCode).toBe(400);
    expect((await call(manager, 'GET', '/api/fleet/stickers.pdf?from=999999')).statusCode).toBe(404);
  });

  it('the telephone on the stickers is an owner’s setting; empty leaves the line out', async () => {
    const owner = await loginAs('owner');
    const manager = await loginAs('manager');
    expect((await call(manager, 'PATCH', '/api/settings/sticker', { stickerPhone: '+995 000 00 00 00' })).statusCode).toBe(403);
    expect((await call(owner, 'PATCH', '/api/settings/sticker', { stickerPhone: '+995 000 00 00 00' })).statusCode).toBe(200);
    expect(json<{ stickerPhone: string | null }>(await call(owner, 'GET', '/api/settings/rental')).stickerPhone).toBe('+995 000 00 00 00');
    expect((await call(owner, 'PATCH', '/api/settings/sticker', { stickerPhone: '' })).statusCode).toBe(200);
    expect(json<{ stickerPhone: string | null }>(await call(owner, 'GET', '/api/settings/rental')).stickerPhone).toBeNull();
  });
});
