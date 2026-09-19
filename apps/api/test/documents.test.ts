// The contract and the return act as PDFs (RNT-08): they render with the
// rental's own figures, the bytes are kept, and rebuilding one is a
// deliberate act that leaves the old copy in the archive.
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

/** A one-pixel PNG, as a signature pad would send one. */
const PNG = 'data:image/png;base64,' + 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function rentalWithEverything() {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Model ${uniq()}`, forRent: true } });
  const vehicle = await prisma.vehicle.create({
    data: { vin: `TESTD${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id, color: 'შავი' },
  });
  const customer = await prisma.customer.create({
    data: { name: 'ვაჟა ტესტი', personalId: `T${uniq().replace(/\D/g, '')}`, phone: '+995500000000', address: 'თბილისი' },
  });
  const owner = await loginAs('owner');
  const created = json<{ id: string; actId: string }>(
    await call(owner, 'POST', '/api/rentals', {
      customerId: customer.id,
      vehicleId: vehicle.id,
      weeklyRateTetri: 15000,
      pickedUpOn: '2026-09-01',
      nightParkingAddress: 'ვაკე, ეზო',
      batteries: 2,
      chargers: 2,
    }),
  );
  return { prisma, owner, customer, vehicle, ...created };
}

describe.skipIf(!HAS_DB)('documents', () => {
  it('renders the contract; unsigned it follows the card, signed on the screen it is kept as it was (D17, B4-06)', async () => {
    const { prisma, owner, customer, id } = await rentalWithEverything();

    const first = await call(owner, 'GET', `/api/rentals/${id}/contract.pdf`);
    expect(first.statusCode, first.body.slice(0, 200)).toBe(200);
    expect(first.headers['content-type']).toBe('application/pdf');
    expect(first.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(first.rawPayload.length).toBeGreaterThan(20_000); // fonts are embedded
    expect(await prisma.storedFile.count({ where: { rentalId: id, kind: 'pdf', archived: false } })).toBe(1);

    // A field the contract needs, emptied: it is named and signing waits for it.
    await prisma.customer.update({ where: { id: customer.id }, data: { personalId: null } });
    const card = json<{ documents: { contract: { gaps: string[]; signedAt: string | null } } }>(await call(owner, 'GET', `/api/rentals/${id}`));
    expect(card.documents.contract).toEqual({ gaps: ['personalId'], signedAt: null, signedBy: null });
    const refused = await call(owner, 'POST', `/api/rentals/${id}/contract/sign`, { agree: true, signaturePng: PNG });
    expect(json<{ error: string }>(refused).error).toBe('document_gaps');
    await prisma.customer.update({ where: { id: customer.id }, data: { personalId: `T${uniq().replace(/\D/g, '')}` } });

    expect((await call(owner, 'POST', `/api/rentals/${id}/contract/sign`, { agree: false, signaturePng: PNG })).statusCode).toBe(400);
    const signed = await call(owner, 'POST', `/api/rentals/${id}/contract/sign`, { agree: true, signaturePng: PNG });
    expect(signed.statusCode, signed.body).toBe(201);
    const a = await call(owner, 'GET', `/api/rentals/${id}/contract.pdf`);
    const b = await call(owner, 'GET', `/api/rentals/${id}/contract.pdf`);
    expect(Buffer.compare(a.rawPayload, b.rawPayload)).toBe(0);
    const after = json<{ documents: { contract: { signedAt: string | null } } }>(await call(owner, 'GET', `/api/rentals/${id}`));
    expect(after.documents.contract.signedAt).not.toBeNull();
  });

  it('a manager may hand the contract over but not rebuild it; an owner rebuild archives the old copy', async () => {
    const { prisma, owner, id } = await rentalWithEverything();
    await call(owner, 'GET', `/api/rentals/${id}/contract.pdf`);

    const manager = await loginAs('manager');
    expect((await call(manager, 'GET', `/api/rentals/${id}/contract.pdf`)).statusCode).toBe(200);
    expect((await call(manager, 'GET', `/api/rentals/${id}/contract.pdf?fresh=1`)).statusCode).toBe(409);

    expect((await call(owner, 'GET', `/api/rentals/${id}/contract.pdf?fresh=1`)).statusCode).toBe(200);
    const all = await prisma.storedFile.findMany({ where: { rentalId: id, docKind: 'contract' } });
    expect(all.filter((f) => !f.archived)).toHaveLength(1);
    const journal = await prisma.auditLog.findFirst({ where: { entityId: id, action: 'document.regenerate' } });
    expect(journal).not.toBeNull();
  });

  it('the return act exists only once the rental is closed, and carries the deposit decision', async () => {
    const { prisma, owner, id } = await rentalWithEverything();
    const early = await call(owner, 'GET', `/api/rentals/${id}/return-act.pdf`);
    expect(early.statusCode).toBe(409);
    expect(json<{ error: string }>(early).error).toBe('not_returned');

    await call(owner, 'POST', '/api/money', { kind: 'rent', rentalId: id, amountTetri: '330', channel: 'cash', occurredOn: '2026-09-01', backdateReason: 'test' });
    const back = await call(owner, 'POST', `/api/rentals/${id}/return`, {
      returnedOn: '2026-09-12',
      odometerKm: 10,
      items: { moped: { state: 'ok' }, key: { state: 'damaged', note: 'bent' }, battery_1: { state: 'missing' } },
      deposit: { action: 'withhold', withheldTetri: 5000, reason: 'broken mirror', grounds: ['moped_damage', 'other'] },
    });
    expect(back.statusCode, back.body).toBe(200);

    const act = await call(owner, 'GET', `/api/rentals/${id}/return-act.pdf`);
    expect(act.statusCode, act.body.slice(0, 200)).toBe(200);
    expect(act.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');

    const dep = await prisma.deposit.findUniqueOrThrow({ where: { rentalId: id } });
    expect(dep.withheldGrounds).toEqual(['moped_damage', 'other']);
    const ret = await prisma.act.findFirstOrThrow({ where: { rentalId: id, kind: 'return' } });
    expect(ret.items).toMatchObject({ key: { state: 'damaged', note: 'bent' }, battery_1: { state: 'missing', note: null } });
  });
});
