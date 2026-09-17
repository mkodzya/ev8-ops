// Photos on acts and customer documents (CST-03): bytes round-trip, the
// wrong type is refused, and a manager can attach a document but not open it.
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

// A 1×1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

describe.skipIf(!HAS_DB)('files', () => {
  it('a photo on a hand-over act comes back byte for byte, and appears on the rental card', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Model ${uniq()}`, forRent: true } });
    const vehicle = await prisma.vehicle.create({ data: { vin: `TESTF${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id } });
    const customer = await prisma.customer.create({ data: { name: `Photo Customer ${uniq()}` } });
    const manager = await loginAs('manager');
    const { id, actId } = json<{ id: string; actId: string }>(
      await call(manager, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000 }),
    );

    const bad = await call(manager, 'POST', `/api/acts/${actId}/photos`, { mimeType: 'image/svg+xml', dataBase64: PNG.toString('base64') });
    expect(bad.statusCode).toBe(400);

    const up = await call(manager, 'POST', `/api/acts/${actId}/photos`, { mimeType: 'image/png', label: 'front.png', dataBase64: PNG.toString('base64') });
    expect(up.statusCode, up.body).toBe(201);
    const fileId = json<{ id: string }>(up).id;

    const got = await call(manager, 'GET', `/api/files/${fileId}`);
    expect(got.statusCode).toBe(200);
    expect(got.headers['content-type']).toBe('image/png');
    expect(got.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(got.rawPayload, PNG)).toBe(0);

    const card = json<{ acts: { kind: string; photos: { id: string }[] }[] }>(await call(manager, 'GET', `/api/rentals/${id}`));
    expect(card.acts[0].photos.map((p) => p.id)).toEqual([fileId]);
  });

  it('a manager attaches a customer document but cannot open it; the owner can, and the opening is journaled', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const customer = await prisma.customer.create({ data: { name: `Doc Customer ${uniq()}` } });
    const manager = await loginAs('manager');
    const up = await call(manager, 'POST', `/api/customers/${customer.id}/documents`, { docKind: 'id_card', mimeType: 'image/png', dataBase64: PNG.toString('base64') });
    expect(up.statusCode, up.body).toBe(201);
    const fileId = json<{ id: string }>(up).id;

    const asManager = json<{ documents: { id: string; docKind: string }[]; canOpenDocuments: boolean }>(await call(manager, 'GET', `/api/customers/${customer.id}`));
    expect(asManager.documents).toEqual([expect.objectContaining({ id: fileId, docKind: 'id_card' })]);
    expect(asManager.canOpenDocuments).toBe(false);
    expect((await call(manager, 'GET', `/api/files/${fileId}`)).statusCode).toBe(403);

    const owner = await loginAs('owner');
    expect((await call(owner, 'GET', `/api/files/${fileId}`)).statusCode).toBe(200);
    const opened = await prisma.auditLog.findFirst({ where: { action: 'customer.document.open', entityId: customer.id } });
    expect(opened).not.toBeNull();

    expect((await call(manager, 'POST', `/api/files/${fileId}/archive`, { reason: 'wrong person' })).statusCode).toBe(403);
    expect((await call(owner, 'POST', `/api/files/${fileId}/archive`, { reason: 'wrong person' })).statusCode).toBe(200);
    expect((await call(owner, 'GET', `/api/files/${fileId}`)).statusCode).toBe(404);
  });
});
