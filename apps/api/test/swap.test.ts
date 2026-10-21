// A swap in a running rental (ADR-0040): the customer gives one moped back and
// takes another, and the rental goes on — its number, weeks, deposit, debt and
// pay day. Two acts, two events, the old moped to a point or a repair; and
// every place that once read "one rental, one moped" reads the right one.
// Every moped, person, point and number here is made up.
import { addDays, todayISO } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

const today = () => todayISO();
const digits = () => uniq().replace(/\D/g, '');
/** A one-pixel PNG, as a signature pad and a camera would send one. */
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function moped(opts: { pool?: 'rent' | 'sale' | null; odometerKm?: number | null; state?: 'available' | 'service' } = {}) {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Swap ${uniq()}`, weeklyRateTetri: 15000, forRent: true } });
  return prisma.vehicle.create({
    data: {
      vin: `TESTSW${digits().slice(-11).padStart(11, '0')}`,
      modelId: model.id,
      pool: opts.pool === undefined ? 'rent' : opts.pool,
      odometerKm: opts.odometerKm ?? null,
      state: opts.state ?? 'available',
    },
  });
}

/** A rental running on one moped from `pickedUpOn`, with a free moped beside it and a point to leave one at. */
async function running(opts: { pickedUpOn?: string; freshPool?: 'rent' | 'sale' | null } = {}) {
  const { prisma } = await import('../src/lib/db.js');
  const old = await moped();
  const fresh = await moped({ odometerKm: 300, pool: opts.freshPool });
  const point = await prisma.location.create({ data: { name: `ТЕСТ point ${uniq()}` }, select: { id: true } });
  const customer = await prisma.customer.create({ data: { name: `Test Swapper ${uniq()}`, phone: `+9955${digits().slice(-8)}`, personalId: digits().slice(-11) } });
  const owner = await loginAs('owner');
  const res = await call(owner, 'POST', '/api/pickups', {
    customerId: customer.id,
    vehicleId: old.id,
    weeklyRateTetri: 15000,
    depositTetri: 18000,
    pickedUpOn: opts.pickedUpOn ?? today(),
    nightParkingAddress: 'Test street 1',
    batteries: 2,
    chargers: 2,
    odometerKm: 1000,
    payment: { later: false, channel: 'cash', amountTetri: 33000 },
  });
  expect(res.statusCode, res.body).toBe(201);
  return { prisma, owner, old, fresh, point, customer, rentalId: json<{ id: string }>(res).id };
}

/** What the wizard sends: the old moped back at 1 150 km, fine, to the point; the new one out at 320. */
function swapBody(f: { fresh: { id: string }; point: { id: string } }, over: Record<string, unknown> = {}) {
  return {
    swappedOn: today(),
    reason: 'the customer asked for a bigger battery',
    outOdometerKm: 1150,
    items: { moped: { state: 'ok' }, key: { state: 'ok' } },
    toService: false,
    locationId: f.point.id,
    vehicleId: f.fresh.id,
    inOdometerKm: 320,
    ...over,
  };
}

interface Card {
  rental: {
    number: string;
    status: string;
    paidThrough: string | null;
    pickedUpOn: string | null;
    debtTetri: number;
    vehicle: { id: string; vin: string } | null;
    mopeds: { vehicle: { id: string; vin: string | null }; from: string; to: string | null; began: string; ended: string | null }[];
  };
  periods: unknown[];
  deposit: unknown;
  charges: { kind: string; amountTetri: number }[];
  documents: { contract: { signedAt: string | null } };
  acts: { id: string; kind: string; vehicle: { id: string } | null; odometerKm: number | null }[];
}
const card = async (cookie: string, id: string) => json<Card>(await call(cookie, 'GET', `/api/rentals/${id}`));
const err = (res: { body: string }) => json<{ error: string; field?: string; lastOn?: string }>(res);

describe.skipIf(!HAS_DB)('a swap in a running rental (ADR-0040)', () => {
  it('a manager changes the moped: the same rental, weeks, deposit and debt; the old moped at a point, the new one out', async () => {
    const f = await running();
    const manager = await loginAs('manager');
    const before = await card(manager, f.rentalId);
    const res = await call(manager, 'POST', `/api/rentals/${f.rentalId}/swap`, swapBody(f));
    expect(res.statusCode, res.body).toBe(200);
    expect(json<{ serviceJobId: string | null; adoptedJob: boolean }>(res)).toMatchObject({ serviceJobId: null, adoptedJob: false });

    const after = await card(manager, f.rentalId);
    expect(after.rental).toMatchObject({ number: before.rental.number, paidThrough: before.rental.paidThrough, pickedUpOn: before.rental.pickedUpOn, debtTetri: before.rental.debtTetri, vehicle: { id: f.fresh.id } });
    expect(after.periods).toEqual(before.periods);
    expect(after.deposit).toEqual(before.deposit);
    expect(after.rental.mopeds.map((m) => [m.vehicle.id, m.from, m.to, m.began, m.ended])).toEqual([
      [f.old.id, today(), today(), 'pickup', 'swap_out'],
      [f.fresh.id, today(), null, 'swap_in', null],
    ]);
    // Each act names its moped, the hand-over's included.
    expect(after.acts.map((a) => [a.kind, a.vehicle?.id, a.odometerKm])).toEqual([
      ['pickup', f.old.id, 1000],
      ['swap_out', f.old.id, 1150],
      ['swap_in', f.fresh.id, 320],
    ]);

    const old = await f.prisma.vehicle.findUniqueOrThrow({ where: { id: f.old.id } });
    expect(old).toMatchObject({ state: 'available', currentRentalId: null, locationId: f.point.id, odometerKm: 1150 });
    const fresh = await f.prisma.vehicle.findUniqueOrThrow({ where: { id: f.fresh.id } });
    expect(fresh).toMatchObject({ state: 'rented', currentRentalId: f.rentalId, pool: 'rent', locationId: null, odometerKm: 320 });
    // Two events, each with the rental and the reason (one transaction: their moments may be one).
    const events = await f.prisma.vehicleEvent.findMany({ where: { rentalId: f.rentalId } });
    expect(events.map((e) => `${e.vehicleId === f.old.id ? 'old' : 'new'}:${e.kind}`).sort()).toEqual(['new:pickup', 'old:pickup', 'old:return']);
    expect(events.find((e) => e.vehicleId === f.old.id && e.kind === 'return')?.reason).toBe('the customer asked for a bigger battery');

    const log = await f.prisma.auditLog.findFirstOrThrow({ where: { entityId: f.rentalId, action: 'rental.swap' } });
    expect(log.before).toMatchObject({ vehicleId: f.old.id, vin: f.old.vin });
    expect(log.after).toMatchObject({ vehicleId: f.fresh.id, vin: f.fresh.vin, swappedOn: today(), outKm: 1150, inKm: 320, keyCharged: false });
    expect(log.note).toBe('the customer asked for a bigger battery');
  });

  it('refuses what is not a swap, and a refusal changes nothing', async () => {
    const f = await running();
    const manager = await loginAs('manager');
    const url = `/api/rentals/${f.rentalId}/swap`;
    expect(err(await call(manager, 'POST', url, swapBody(f, { reason: '' })))).toMatchObject({ error: 'missing_field', field: 'reason' });
    expect(err(await call(manager, 'POST', url, swapBody(f, { swappedOn: addDays(today(), 1) })))).toMatchObject({ error: 'future_date', field: 'swappedOn' });
    expect(err(await call(manager, 'POST', url, swapBody(f, { outOdometerKm: null })))).toMatchObject({ error: 'missing_field', field: 'outOdometerKm' });
    expect(err(await call(manager, 'POST', url, swapBody(f, { vehicleId: f.old.id })))).toMatchObject({ error: 'same_vehicle', field: 'vehicleId' });
    const busy = await moped({ state: 'service' });
    expect(err(await call(manager, 'POST', url, swapBody(f, { vehicleId: busy.id })))).toMatchObject({ error: 'vehicle_not_available', field: 'vehicleId' });
    // Not before the hand-over, nor before the last thing either moped's history holds.
    expect(err(await call(manager, 'POST', url, swapBody(f, { swappedOn: addDays(today(), -1) })))).toMatchObject({ error: 'swap_before_last_event', field: 'swappedOn', lastOn: today() });
    // Less than at the hand-over is a mistake; below the new moped's last reading — with a reason.
    expect(err(await call(manager, 'POST', url, swapBody(f, { outOdometerKm: 900 })))).toMatchObject({ error: 'odometer_below_pickup', field: 'outOdometerKm' });
    expect(err(await call(manager, 'POST', url, swapBody(f, { inOdometerKm: 250 })))).toMatchObject({ error: 'odometer_below', field: 'inOdometerReason' });
    // A mechanic has neither right.
    const mechanic = await loginAs('mechanic');
    expect((await call(mechanic, 'POST', url, swapBody(f))).statusCode).toBe(403);

    const old = await f.prisma.vehicle.findUniqueOrThrow({ where: { id: f.old.id } });
    expect(old).toMatchObject({ state: 'rented', currentRentalId: f.rentalId, odometerKm: 1000 });
    expect(await f.prisma.act.count({ where: { rentalId: f.rentalId } })).toBe(1);

    // With the reason the lower reading is taken, and kept with it.
    const ok = await call(manager, 'POST', url, swapBody(f, { inOdometerKm: 250, inOdometerReason: 'the dashboard was replaced' }));
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await f.prisma.act.findFirstOrThrow({ where: { rentalId: f.rentalId, kind: 'swap_in' } })).odometerReason).toBe('the dashboard was replaced');
    // Closed, a rental has nothing to swap.
    const done = await call(manager, 'POST', `/api/rentals/${f.rentalId}/return`, { returnedOn: today(), odometerKm: 400, toService: false, locationId: f.point.id });
    expect(done.statusCode, done.body).toBe(200);
    const another = await moped();
    expect(err(await call(manager, 'POST', url, swapBody({ fresh: another, point: f.point })))).toMatchObject({ error: 'already_returned' });
  });

  it('a rental handed over without a VIN has nothing to give back; its moped is given in "Change terms", and its act names it', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const customer = await prisma.customer.create({ data: { name: `Test NoVin ${uniq()}` } });
    const made = await call(owner, 'POST', '/api/rentals', { customerId: customer.id, vinNote: 'the sticker is unreadable', weeklyRateTetri: 15000, pickedUpOn: today() });
    expect(made.statusCode, made.body).toBe(201);
    const id = json<{ id: string }>(made).id;
    const fresh = await moped();
    expect(err(await call(owner, 'POST', `/api/rentals/${id}/swap`, swapBody({ fresh, point: { id: '' } }, { locationId: null })))).toMatchObject({ error: 'swap_no_vehicle' });
    const given = await call(owner, 'PATCH', `/api/rentals/${id}`, { vehicleId: fresh.id });
    expect(given.statusCode, given.body).toBe(200);
    expect((await prisma.act.findFirstOrThrow({ where: { rentalId: id, kind: 'pickup' } })).vehicleId).toBe(fresh.id);
    // Once it has one, the moped is changed by a swap, not by "Change terms".
    const other = await moped();
    expect(err(await call(owner, 'PATCH', `/api/rentals/${id}`, { vehicleId: other.id })).error).toBe('vehicle_already_set');
  });

  it('a moped of the sale park: a manager is refused, an owner confirms the move to rent (Q9)', async () => {
    const f = await running({ freshPool: 'sale' });
    const manager = await loginAs('manager');
    const url = `/api/rentals/${f.rentalId}/swap`;
    const refused = await call(manager, 'POST', url, swapBody(f));
    expect(refused.statusCode).toBe(403);
    expect(err(refused).error).toBe('vehicle_in_sale_pool');
    expect(err(await call(f.owner, 'POST', url, swapBody(f))).error).toBe('vehicle_in_sale_pool');
    const ok = await call(f.owner, 'POST', url, swapBody(f, { moveFromSale: true }));
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await f.prisma.vehicle.findUniqueOrThrow({ where: { id: f.fresh.id } })).pool).toBe('rent');
  });

  it('“to service” opens a draft repair on the old moped, and the act’s photos go to it too', async () => {
    const f = await running();
    const manager = await loginAs('manager');
    const res = await call(manager, 'POST', `/api/rentals/${f.rentalId}/swap`, swapBody(f, { toService: true, items: { moped: { state: 'damaged', note: 'cracked mirror' }, key: { state: 'ok' } } }));
    expect(res.statusCode, res.body).toBe(200);
    const { outActId, serviceJobId } = json<{ outActId: string; serviceJobId: string }>(res);
    const job = await f.prisma.serviceJob.findUniqueOrThrow({ where: { id: serviceJobId } });
    expect(job).toMatchObject({ vehicleId: f.old.id, rentalId: f.rentalId, movedVehicle: true, payer: 'company' });
    expect(job.reason).toContain('cracked mirror');
    expect((await f.prisma.vehicle.findUniqueOrThrow({ where: { id: f.old.id } })).state).toBe('service');
    // Not at a point: in the repair.
    expect((await f.prisma.act.findUniqueOrThrow({ where: { id: outActId } })).locationId).toBeNull();
    const photo = await call(manager, 'POST', `/api/acts/${outActId}/photos`, { mimeType: 'image/png', label: 'mirror', dataBase64: PNG_B64 });
    expect(photo.statusCode, photo.body).toBe(201);
    expect(await f.prisma.storedFile.count({ where: { serviceJobId, kind: 'service_photo' } })).toBe(1);
  });

  it('a repair reported while the customer had the moped is taken up, not doubled; cancelled, it frees the moped', async () => {
    const f = await running();
    // Reported on the moped out with the customer: it did not move it (service.ts, movedVehicle).
    const reported = await call(f.owner, 'POST', '/api/service', { vehicleId: f.old.id, reason: 'brakes squeak' });
    expect(reported.statusCode, reported.body).toBe(201);
    const jobId = json<{ id: string }>(reported).id;
    expect((await f.prisma.serviceJob.findUniqueOrThrow({ where: { id: jobId } })).movedVehicle).toBe(false);

    const res = await call(f.owner, 'POST', `/api/rentals/${f.rentalId}/swap`, swapBody(f));
    expect(res.statusCode, res.body).toBe(200);
    expect(json<{ serviceJobId: string; adoptedJob: boolean }>(res)).toMatchObject({ serviceJobId: jobId, adoptedJob: true });
    expect(await f.prisma.serviceJob.count({ where: { vehicleId: f.old.id } })).toBe(1);
    expect((await f.prisma.serviceJob.findUniqueOrThrow({ where: { id: jobId } })).movedVehicle).toBe(true);
    expect((await f.prisma.vehicle.findUniqueOrThrow({ where: { id: f.old.id } })).state).toBe('service');

    const cancelled = await call(f.owner, 'POST', `/api/service/${jobId}/cancel`, { reason: 'nothing wrong after all' });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect((await f.prisma.vehicle.findUniqueOrThrow({ where: { id: f.old.id } })).state).toBe('available');
  });

  it('a key not brought back is the contract’s 250 on the rental', async () => {
    const f = await running();
    const manager = await loginAs('manager');
    const before = await card(manager, f.rentalId);
    const res = await call(manager, 'POST', `/api/rentals/${f.rentalId}/swap`, swapBody(f, { items: { moped: { state: 'ok' }, key: { state: 'missing' } } }));
    expect(res.statusCode, res.body).toBe(200);
    const after = await card(manager, f.rentalId);
    expect(after.charges).toEqual([expect.objectContaining({ kind: 'key', amountTetri: 25000 })]);
    expect(after.rental.debtTetri).toBe(before.rental.debtTetri + 25000);
  });

  it('after a swap the return is measured from the new moped’s hand-over, and its act names it', async () => {
    const f = await running();
    const manager = await loginAs('manager');
    expect((await call(manager, 'POST', `/api/rentals/${f.rentalId}/swap`, swapBody(f))).statusCode).toBe(200);
    const preview = json<{ pickupKm: number | null; pickupOn: string | null; vehicleKm: number | null }>(await call(manager, 'POST', `/api/rentals/${f.rentalId}/return/preview`, { returnedOn: today() }));
    expect(preview).toMatchObject({ pickupKm: 320, pickupOn: today(), vehicleKm: 320 });
    expect(err(await call(manager, 'POST', `/api/rentals/${f.rentalId}/return`, { returnedOn: today(), odometerKm: 310, toService: false, locationId: f.point.id })).error).toBe('odometer_below_pickup');
    // Below the old moped's 1 000 at the hand-over, and that is no mistake: it is another moped.
    const done = await call(manager, 'POST', `/api/rentals/${f.rentalId}/return`, { returnedOn: today(), odometerKm: 500, toService: false, locationId: f.point.id });
    expect(done.statusCode, done.body).toBe(200);
    const act = await f.prisma.act.findUniqueOrThrow({ where: { id: json<{ actId: string }>(done).actId } });
    expect(act.vehicleId).toBe(f.fresh.id);
    expect((await f.prisma.vehicle.findUniqueOrThrow({ where: { id: f.fresh.id } })).state).toBe('available');
  });

  it('the contract is drawn again with the new VIN and waits for a signature; the signed copy is kept in the archive', async () => {
    const { pdfText } = await import('../src/lib/driveDocs.js');
    const f = await running();
    const signed = await call(f.owner, 'POST', `/api/rentals/${f.rentalId}/contract/sign`, { agree: true, signaturePng: `data:image/png;base64,${PNG_B64}` });
    expect(signed.statusCode, signed.body).toBe(201);
    expect((await card(f.owner, f.rentalId)).documents.contract.signedAt).not.toBeNull();

    expect((await call(f.owner, 'POST', `/api/rentals/${f.rentalId}/swap`, swapBody(f))).statusCode).toBe(200);
    expect((await card(f.owner, f.rentalId)).documents.contract.signedAt).toBeNull();
    expect(await f.prisma.storedFile.count({ where: { rentalId: f.rentalId, docKind: 'contract', archived: true, signedAt: { not: null } } })).toBe(1);
    const list = json<{ rentals: { id: string; contractSigned: boolean | null }[] }>(await call(f.owner, 'GET', '/api/rentals'));
    expect(list.rentals.find((r) => r.id === f.rentalId)?.contractSigned).toBe(false);

    const pdf = await call(f.owner, 'GET', `/api/rentals/${f.rentalId}/contract.pdf`);
    expect(pdf.statusCode).toBe(200);
    const text = await pdfText(new Uint8Array(pdf.rawPayload));
    expect(text).toContain(f.fresh.vin);
    expect(text).not.toContain(f.old.vin);
    const log = await f.prisma.auditLog.findFirstOrThrow({ where: { entityId: f.rentalId, action: 'rental.swap' } });
    expect(log.after).toMatchObject({ contractSignedBefore: true });
  });

  it('a rental brought over gets a contract of EV8 Ops to sign once a swap replaces its moped', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { debtsOf } = await import('../src/lib/debt.js');
    const { QUEUE_RENTAL, queueRental } = await import('../src/routes/today.js');
    const owner = await loginAs('owner');
    const old = await moped();
    const fresh = await moped();
    const customer = await prisma.customer.create({ data: { name: `Test Carried ${uniq()}`, phone: `+9955${digits().slice(-8)}`, personalId: digits().slice(-11) } });
    const made = await call(owner, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: old.id, weeklyRateTetri: 15000, pickedUpOn: addDays(today(), -10), transfer: { depositReceivedTetri: 0 } });
    expect(made.statusCode, made.body).toBe(201);
    const id = json<{ id: string }>(made).id;
    const signedOf = async () => json<{ rentals: { id: string; contractSigned: boolean | null }[] }>(await call(owner, 'GET', '/api/rentals')).rentals.find((r) => r.id === id)?.contractSigned;
    expect(await signedOf()).toBeNull();
    const rowOf = async () => {
      const r = await prisma.rental.findUniqueOrThrow({ where: { id }, select: QUEUE_RENTAL });
      return queueRental(r, today(), await debtsOf([r.customer.id], today()));
    };
    expect((await rowOf()).contractUnsigned).toBe(false);

    const res = await call(owner, 'POST', `/api/rentals/${id}/swap`, { swappedOn: addDays(today(), -1), reason: 'breakdown on the road', outOdometerKm: 2000, vehicleId: fresh.id, inOdometerKm: 10 });
    expect(res.statusCode, res.body).toBe(200);
    expect(await signedOf()).toBe(false);
    // Counted from the swap's day: a day on, «Не подписан» asks for it.
    expect((await rowOf()).contractUnsigned).toBe(true);
  });

  it('each moped’s card keeps its part of the rental, and its events find the rental', async () => {
    const f = await running();
    expect((await call(f.owner, 'POST', `/api/rentals/${f.rentalId}/swap`, swapBody(f))).statusCode).toBe(200);
    type VehicleCard = {
      rentals: { id: string; number: string; withThisMoped: { from: string; to: string | null; swappedIn: boolean; swappedOut: boolean } | null }[];
      events: { kind: string; rentalId: string | null }[];
      maintenance: { currentKm: number | null; readingSource: string | null } | null;
    };
    const oldCard = json<VehicleCard>(await call(f.owner, 'GET', `/api/fleet/${f.old.id}`));
    expect(oldCard.rentals.find((r) => r.id === f.rentalId)?.withThisMoped).toEqual({ from: today(), to: today(), swappedIn: false, swappedOut: true });
    expect(oldCard.events.filter((e) => e.rentalId === f.rentalId).map((e) => e.kind)).toEqual(['pickup', 'return']);
    const freshCard = json<VehicleCard>(await call(f.owner, 'GET', `/api/fleet/${f.fresh.id}`));
    expect(freshCard.rentals.find((r) => r.id === f.rentalId)?.withThisMoped).toEqual({ from: today(), to: null, swappedIn: true, swappedOut: false });
    // The mileage of each act is its own moped's (ADR-0038 §1): the old moped's 1 000 and 1 150 are not the new one's.
    expect(oldCard.maintenance).toMatchObject({ currentKm: 1150, readingSource: 'return' });
    expect(freshCard.maintenance).toMatchObject({ currentKm: 320, readingSource: 'pickup' });
  });

  it('a week’s rent goes to the moped the rental had on the week’s first day', async () => {
    const f = await running({ pickedUpOn: addDays(today(), -20) });
    // Weeks begin 20, 13 and 6 days ago; the swap, 10 days ago, falls in the second.
    const res = await call(f.owner, 'POST', `/api/rentals/${f.rentalId}/swap`, swapBody(f, { swappedOn: addDays(today(), -10) }));
    expect(res.statusCode, res.body).toBe(200);
    // The hand-over paid the deposit and the first week; two more weeks now.
    const paid = await call(f.owner, 'POST', '/api/payments', { rentalId: f.rentalId, channel: 'cash', grossTetri: 30000 });
    expect(paid.statusCode, paid.body).toBe(201);
    const economics = async (id: string) => json<{ economics: { rentalRevenueTetri: number } }>(await call(f.owner, 'GET', `/api/fleet/${id}/economics`)).economics;
    expect((await economics(f.old.id)).rentalRevenueTetri).toBe(30000);
    expect((await economics(f.fresh.id)).rentalRevenueTetri).toBe(15000);
  });
});
