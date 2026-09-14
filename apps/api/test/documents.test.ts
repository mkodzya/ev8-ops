// The contract and the return act as PDFs (RNT-08): they render with the
// rental's own figures, the bytes are kept, and rebuilding one is a
// deliberate act that leaves the old copy in the archive.
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

async function rentalWithEverything() {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Model ${uniq()}`, forRent: true } });
  const vehicle = await prisma.vehicle.create({
    data: { vin: `TESTD${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id, color: 'შავი' },
  });
  const customer = await prisma.customer.create({
    data: { name: 'ვაჟა ტესტი', personalId: `T${uniq().replace(/\D/g, '')}`, phone: '+995500000000', address: 'თბილისი' },
  });
  const director = await loginAs('director');
  const created = json<{ id: string; actId: string }>(
    await call(director, 'POST', '/api/rentals', {
      customerId: customer.id,
      vehicleId: vehicle.id,
      weeklyRateTetri: 15000,
      pickedUpOn: '2026-09-01',
      nightParkingAddress: 'ვაკე, ეზო',
      batteries: 2,
      chargers: 2,
    }),
  );
  return { prisma, director, customer, vehicle, ...created };
}

describe.skipIf(!HAS_DB)('documents', () => {
  it('renders the contract, keeps the bytes, and hands the same copy back next time', async () => {
    const { prisma, director, id } = await rentalWithEverything();

    const first = await call(director, 'GET', `/api/rentals/${id}/contract.pdf`);
    expect(first.statusCode, first.body.slice(0, 200)).toBe(200);
    expect(first.headers['content-type']).toBe('application/pdf');
    expect(first.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(first.rawPayload.length).toBeGreaterThan(20_000); // fonts are embedded

    const stored = await prisma.storedFile.findMany({ where: { rentalId: id, kind: 'pdf', archived: false } });
    expect(stored).toHaveLength(1);
    expect(stored[0].docKind).toBe('contract');
    expect(stored[0].sizeBytes).toBe(first.rawPayload.length);

    const second = await call(director, 'GET', `/api/rentals/${id}/contract.pdf`);
    expect(Buffer.compare(second.rawPayload, first.rawPayload)).toBe(0);
    expect(await prisma.storedFile.count({ where: { rentalId: id, kind: 'pdf' } })).toBe(1);
  });

  it('a manager may hand the contract over but not rebuild it; a director rebuild archives the old copy', async () => {
    const { prisma, director, id } = await rentalWithEverything();
    await call(director, 'GET', `/api/rentals/${id}/contract.pdf`);

    const manager = await loginAs('manager');
    expect((await call(manager, 'GET', `/api/rentals/${id}/contract.pdf`)).statusCode).toBe(200);
    expect((await call(manager, 'GET', `/api/rentals/${id}/contract.pdf?fresh=1`)).statusCode).toBe(409);

    expect((await call(director, 'GET', `/api/rentals/${id}/contract.pdf?fresh=1`)).statusCode).toBe(200);
    const all = await prisma.storedFile.findMany({ where: { rentalId: id, docKind: 'contract' } });
    expect(all).toHaveLength(2);
    expect(all.filter((f) => f.archived)).toHaveLength(1);
    const journal = await prisma.auditLog.findFirst({ where: { entityId: id, action: 'document.regenerate' } });
    expect(journal).not.toBeNull();
  });

  it('the return act exists only once the rental is closed, and carries the deposit decision', async () => {
    const { prisma, director, id } = await rentalWithEverything();
    const early = await call(director, 'GET', `/api/rentals/${id}/return-act.pdf`);
    expect(early.statusCode).toBe(409);
    expect(json<{ error: string }>(early).error).toBe('not_returned');

    await call(director, 'POST', `/api/rentals/${id}/return`, {
      returnedOn: '2026-09-12',
      items: { moped: { state: 'ok' }, key: { state: 'damaged', note: 'bent' }, battery_1: { state: 'missing' } },
      deposit: { returnedTetri: 13000, withheldTetri: 5000, withheldReason: 'broken mirror', grounds: ['moped_damage', 'other'] },
    });

    const act = await call(director, 'GET', `/api/rentals/${id}/return-act.pdf`);
    expect(act.statusCode, act.body.slice(0, 200)).toBe(200);
    expect(act.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');

    const dep = await prisma.deposit.findUniqueOrThrow({ where: { rentalId: id } });
    expect(dep.withheldGrounds).toEqual(['moped_damage', 'other']);
    const ret = await prisma.act.findFirstOrThrow({ where: { rentalId: id, kind: 'return' } });
    expect(ret.items).toMatchObject({ key: { state: 'damaged', note: 'bent' }, battery_1: { state: 'missing', note: null } });
  });
});
