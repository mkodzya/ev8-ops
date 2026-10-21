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
    expect(card.documents.contract).toEqual({ gaps: ['personalId'], signedAt: null, signedBy: null, signedElsewhere: null });
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

  it('a contract signed in Signify is marked, not signed again; the mark survives a rebuild (ADR-0039)', async () => {
    const { prisma, owner, id } = await rentalWithEverything();
    type Card = { documents: { contract: { signedAt: string | null; signedElsewhere: { at: string; by: string | null; note: string | null } | null } } };

    const manager = await loginAs('manager');
    const marked = await call(manager, 'POST', `/api/rentals/${id}/contract/signed-elsewhere`, { note: 'ТЕСТ: договор в Signify' });
    expect(marked.statusCode, marked.body).toBe(201);
    const card = json<Card>(await call(owner, 'GET', `/api/rentals/${id}`));
    expect(card.documents.contract.signedAt).toBeNull();
    expect(card.documents.contract.signedElsewhere).toMatchObject({ by: 'Test manager', note: 'ТЕСТ: договор в Signify' });
    expect(Date.parse(card.documents.contract.signedElsewhere!.at)).not.toBeNaN();
    const journal = await prisma.auditLog.findFirst({ where: { entityId: id, action: 'document.signed_elsewhere' } });
    expect(journal?.note).toBe('ТЕСТ: договор в Signify');

    // One mark: the second press is refused, not written twice.
    const twice = await call(manager, 'POST', `/api/rentals/${id}/contract/signed-elsewhere`, {});
    expect(twice.statusCode).toBe(409);
    expect(json<{ error: string }>(twice).error).toBe('already_signed');
    expect(await prisma.auditLog.count({ where: { entityId: id, action: 'document.signed_elsewhere' } })).toBe(1);

    // Rebuilding EV8 Ops' own copy does not change what was signed in Signify.
    expect((await call(owner, 'GET', `/api/rentals/${id}/contract.pdf?fresh=1`)).statusCode).toBe(200);
    expect(json<Card>(await call(owner, 'GET', `/api/rentals/${id}`)).documents.contract.signedElsewhere).not.toBeNull();

    expect((await call(manager, 'POST', '/api/rentals/00000000-0000-4000-8000-000000000000/contract/signed-elsewhere', {})).statusCode).toBe(404);
  });

  it('a contract signed on the screen is not marked on top (ADR-0039)', async () => {
    const { owner, id } = await rentalWithEverything();
    expect((await call(owner, 'POST', `/api/rentals/${id}/contract/sign`, { agree: true, signaturePng: PNG })).statusCode).toBe(201);
    const refused = await call(owner, 'POST', `/api/rentals/${id}/contract/signed-elsewhere`, {});
    expect(refused.statusCode).toBe(409);
    expect(json<{ error: string }>(refused).error).toBe('already_signed');
  });

  it('the card speaks of the signed copy when an unsigned one stands beside it, as the list does', async () => {
    const { prisma, owner, id } = await rentalWithEverything();
    expect((await call(owner, 'POST', `/api/rentals/${id}/contract/sign`, { agree: true, signaturePng: PNG })).statusCode).toBe(201);
    // A second, later copy left unarchived beside the signed one — as an old
    // rebuild could leave it. The list counts any signed copy; so does the card.
    const signed = await prisma.storedFile.findFirstOrThrow({ where: { rentalId: id, docKind: 'contract', archived: false, signedAt: { not: null } } });
    await prisma.storedFile.create({
      data: { kind: 'pdf', docKind: 'contract', rentalId: id, label: 'test-unsigned.pdf', mimeType: 'application/pdf', sizeBytes: 4, sha256: 'test', bytes: new Uint8Array(Buffer.from('%PDF')), createdAt: new Date(signed.createdAt.getTime() + 60_000) },
    });
    const card = json<{ documents: { contract: { signedAt: string | null } } }>(await call(owner, 'GET', `/api/rentals/${id}`));
    expect(card.documents.contract.signedAt).toBe(signed.signedAt!.toISOString());
    const listed = json<{ rentals: { id: string; contractSigned: boolean | null }[] }>(await call(owner, 'GET', '/api/rentals')).rentals.find((r) => r.id === id)!;
    expect(listed.contractSigned).toBe(true);
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

describe('the odometer on paper (meeting of 14.10.2026)', () => {
  it('is written in thousands with a space, and left for a pen when nobody read it', async () => {
    const { km } = await import('../src/lib/pdf/company.js');
    expect(km(7500)).toBe('7 500 km');
    expect(km(150)).toBe('150 km');
    expect(km(1234567)).toBe('1 234 567 km');
    expect(km(0)).toBe('0 km');
    expect(km(null)).toBe('');
  });
});
