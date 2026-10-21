// Wave 3: the hand-over and return wizards' operations, criterion by criterion
// (docs/redesign/wave-3.md §6). Needs a *_test database.
import { addDays, todayISO } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, login, loginAs, makeUser, uniq } from './helpers.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
).toString('base64');
const today = () => todayISO();
const digits = () => uniq().replace(/\D/g, '');

async function fixtures(opts: { pool?: 'rent' | 'sale'; odometerKm?: number } = {}) {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Model ${uniq()}`, weeklyRateTetri: 16000, forRent: true } });
  const vehicle = await prisma.vehicle.create({
    data: { vin: `TEST${digits().slice(0, 13).padStart(13, '0')}`, modelId: model.id, pool: opts.pool ?? 'rent', odometerKm: opts.odometerKm ?? null },
  });
  const customer = await prisma.customer.create({ data: { name: `Test Customer ${uniq()}`, phone: `+9955${digits().slice(-8)}`, personalId: digits().slice(-11) } });
  return { prisma, model, vehicle, customer };
}

/** Everything the wizard sends, for an existing customer, paid in cash. */
function pickup(customerId: string, vehicleId: string, over: Record<string, unknown> = {}) {
  return {
    customerId,
    vehicleId,
    weeklyRateTetri: 15000,
    depositTetri: 18000,
    pickedUpOn: today(),
    nightParkingAddress: 'Test street 1',
    batteries: 2,
    chargers: 2,
    odometerKm: 100,
    payment: { later: false, channel: 'cash', amountTetri: 33000 },
    ...over,
  };
}

interface Card {
  rental: { status: string; paidThrough: string | null; debtTetri: number; transferredAt: string | null; undoReturnUntil: string | null };
  periods: { seq: number; paidTetri: number; amountTetri: number }[];
  charges: { kind: string; amountTetri: number; paidTetri: number }[];
  deposit: { paidTetri: number; status: string; withheldTetri: number; returnedTetri: number; decided: boolean; withholdings: { source: string; amountTetri: number }[] };
  payments: { grossTetri: number; feeTetri: number; channel: string }[];
}
const card = async (cookie: string, id: string) => json<Card>(await call(cookie, 'GET', `/api/rentals/${id}`));
const err = (res: { body: string }) => json<{ error: string; field?: string }>(res);

describe.skipIf(!HAS_DB)('wave 3 · hand-over', () => {
  it('makes a new customer, the rental and a card payment of 330 in one operation (crit. 1)', async () => {
    const { vehicle } = await fixtures();
    const manager = await loginAs('manager');
    const phone = `+9955${digits().slice(-8)}`;
    const res = await call(manager, 'POST', '/api/pickups', {
      ...pickup('', vehicle.id, { customerId: undefined, payment: { later: false, channel: 'acquiring', amountTetri: 33000 } }),
      newCustomer: { name: `ТЕСТ ${uniq()}`, phone, personalId: digits().slice(-11), idPhoto: { mimeType: 'image/png', dataBase64: PNG } },
    });
    expect(res.statusCode, res.body).toBe(201);
    const { id } = json<{ id: string }>(res);
    const c = await card(manager, id);
    expect(c.rental.paidThrough).toBe(addDays(today(), 6));
    expect(c.deposit.paidTetri).toBe(18000);
    expect(c.payments[0]).toMatchObject({ grossTetri: 33000, feeTetri: 495, channel: 'acquiring' });
  });

  it('refuses a new customer without a personal number or ID photo, and a duplicate phone (crit. 2, 3)', async () => {
    const { vehicle, customer } = await fixtures();
    const manager = await loginAs('manager');
    const base = pickup('', vehicle.id, { customerId: undefined });
    const noId = await call(manager, 'POST', '/api/pickups', { ...base, newCustomer: { name: 'ТЕСТ', phone: `+9955${digits().slice(-8)}`, idPhoto: { mimeType: 'image/png', dataBase64: PNG } } });
    expect(err(noId)).toMatchObject({ error: 'missing_field', field: 'personalId' });
    const noPhoto = await call(manager, 'POST', '/api/pickups', { ...base, newCustomer: { name: 'ТЕСТ', phone: `+9955${digits().slice(-8)}`, personalId: '01234567890' } });
    expect(err(noPhoto)).toMatchObject({ error: 'missing_field', field: 'idPhoto' });
    const twin = await call(manager, 'POST', '/api/pickups', { ...base, newCustomer: { name: 'ТЕСТ', phone: customer.phone, personalId: digits().slice(-11), idPhoto: { mimeType: 'image/png', dataBase64: PNG } } });
    expect(twin.statusCode).toBe(409);
    expect(json<{ error: string; existing: { id: string } }>(twin)).toMatchObject({ error: 'duplicate_customer', existing: { id: customer.id } });
  });

  it('a customer who owes: a manager is refused, an owner needs a reason (crit. 4, 5)', async () => {
    const { prisma, vehicle, customer } = await fixtures();
    const second = await fixtures();
    const owner = await loginAs('owner');
    // An earlier rental, a month ago, never paid.
    const old = await call(owner, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: second.vehicle.id, weeklyRateTetri: 15000, pickedUpOn: addDays(today(), -30) });
    expect(old.statusCode, old.body).toBe(201);
    const manager = await loginAs('manager');
    expect(err(await call(manager, 'POST', '/api/pickups', pickup(customer.id, vehicle.id))).error).toBe('customer_in_debt');
    expect(err(await call(owner, 'POST', '/api/pickups', pickup(customer.id, vehicle.id)))).toMatchObject({ error: 'missing_field', field: 'debtOverrideReason' });
    const ok = await call(owner, 'POST', '/api/pickups', pickup(customer.id, vehicle.id, { debtOverrideReason: 'promised to pay Friday' }));
    expect(ok.statusCode, ok.body).toBe(201);
    const log = await prisma.auditLog.findFirst({ where: { entityId: json<{ id: string }>(ok).id, action: 'rental.pickup' } });
    expect(JSON.stringify(log?.after)).toContain('promised to pay Friday');
  });

  it('a moped of the sale park: a manager is refused, an owner confirms the move (crit. 6)', async () => {
    const { prisma, vehicle, customer } = await fixtures({ pool: 'sale' });
    const manager = await loginAs('manager');
    expect(err(await call(manager, 'POST', '/api/pickups', pickup(customer.id, vehicle.id))).error).toBe('vehicle_in_sale_pool');
    const owner = await loginAs('owner');
    expect(err(await call(owner, 'POST', '/api/pickups', pickup(customer.id, vehicle.id))).error).toBe('vehicle_in_sale_pool');
    const ok = await call(owner, 'POST', '/api/pickups', pickup(customer.id, vehicle.id, { moveFromSale: true }));
    expect(ok.statusCode, ok.body).toBe(201);
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).pool).toBe('rent');
  });

  it('refuses no night parking, a date tomorrow, a planned return before the hand-over (crit. 8)', async () => {
    const { vehicle, customer } = await fixtures();
    const manager = await loginAs('manager');
    expect(err(await call(manager, 'POST', '/api/pickups', pickup(customer.id, vehicle.id, { nightParkingAddress: '' })))).toMatchObject({ field: 'nightParkingAddress' });
    expect(err(await call(manager, 'POST', '/api/pickups', pickup(customer.id, vehicle.id, { pickedUpOn: addDays(today(), 1) }))).error).toBe('future_date');
    expect(err(await call(manager, 'POST', '/api/pickups', pickup(customer.id, vehicle.id, { expectedReturnOn: addDays(today(), -1) }))).error).toBe('return_before_pickup');
    expect(err(await call(manager, 'POST', '/api/pickups', pickup(customer.id, vehicle.id, { payment: undefined })))).toMatchObject({ field: 'payment' });
  });

  it('a rate left empty is no rate — refused under its field; a 0 typed on purpose is a rate (QA 21.10.2026)', async () => {
    const { vehicle, customer } = await fixtures();
    const manager = await loginAs('manager');
    // The wizard once sent 0 for an empty field and the rental ran at 0 ₾ a week.
    expect(err(await call(manager, 'POST', '/api/pickups', pickup(customer.id, vehicle.id, { weeklyRateTetri: '' })))).toMatchObject({ error: 'missing_field', field: 'weeklyRateTetri' });
    expect(err(await call(manager, 'POST', '/api/pickups', pickup(customer.id, vehicle.id, { weeklyRateTetri: undefined })))).toMatchObject({ error: 'missing_field', field: 'weeklyRateTetri' });
    expect(err(await call(manager, 'POST', '/api/pickups', pickup(customer.id, vehicle.id, { weeklyRateTetri: 'abc' })))).toMatchObject({ error: 'bad_field', field: 'weeklyRateTetri' });
    const zero = await call(manager, 'POST', '/api/pickups', pickup(customer.id, vehicle.id, { weeklyRateTetri: 0, payment: { later: false, channel: 'cash', amountTetri: 18000 } }));
    expect(zero.statusCode, zero.body).toBe(201);
    expect((await card(manager, json<{ id: string }>(zero).id)).periods[0]).toMatchObject({ seq: 1, amountTetri: 0 });
  });

  it('a mileage below the last act needs a reason (crit. 9)', async () => {
    const { vehicle, customer } = await fixtures({ odometerKm: 1234 });
    const manager = await loginAs('manager');
    expect(err(await call(manager, 'POST', '/api/pickups', pickup(customer.id, vehicle.id, { odometerKm: 1190 }))).error).toBe('odometer_below');
    const ok = await call(manager, 'POST', '/api/pickups', pickup(customer.id, vehicle.id, { odometerKm: 1190, odometerReason: 'odometer replaced' }));
    expect(ok.statusCode, ok.body).toBe(201);
  });

  it('"later": due today, listed on Today (crit. 12; ADR-0017)', async () => {
    const { vehicle, customer } = await fixtures();
    const manager = await loginAs('manager');
    const res = await call(manager, 'POST', '/api/pickups', pickup(customer.id, vehicle.id, { payment: { later: true } }));
    expect(res.statusCode, res.body).toBe(201);
    const { id } = json<{ id: string }>(res);
    // The hand-over day is a due day like any other: the same status, the week and the deposit still owed.
    expect((await card(manager, id)).rental).toMatchObject({ status: 'due_today', debtTetri: 33000 });
    const summary = json<{ dueToday: { id: string }[] }>(await call(manager, 'GET', '/api/summary'));
    expect(summary.dueToday.map((r) => r.id)).toContain(id);
    // A manager takes no bank transfers.
    const { vehicle: v2, customer: c2 } = await fixtures();
    expect(err(await call(manager, 'POST', '/api/pickups', pickup(c2.id, v2.id, { payment: { later: false, channel: 'transfer', amountTetri: 33000 } }))).error).toBe('reconcile_required');
  });

  /**
   * A moped carried over from Odoo has an arrival date meaning "the day we
   * wrote it down", so a rental older than that is normal, not an error —
   * and utilisation would otherwise count the moped as idle capacity for the
   * months it was actually out (designer, 21.09.2026).
   */
  it('moves the arrival date back when a rental brought over is older than it', async () => {
    const { prisma, vehicle, customer } = await fixtures();
    const recordedOn = addDays(today(), -5);
    await prisma.vehicle.update({ where: { id: vehicle.id }, data: { arrivedOn: new Date(`${recordedOn}T00:00:00Z`) } });
    const pickedUpOn = addDays(today(), -40);

    const owner = await loginAs('owner');
    const res = await call(owner, 'POST', '/api/pickups', {
      ...pickup(customer.id, vehicle.id, {
        pickedUpOn,
        odometerKm: undefined,
        payment: undefined,
        transfer: { paidThrough: addDays(pickedUpOn, 6), depositReceivedTetri: 0 },
      }),
    });
    expect(res.statusCode, res.body).toBe(201);

    const after = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id }, select: { arrivedOn: true } });
    expect(after.arrivedOn?.toISOString().slice(0, 10)).toBe(pickedUpOn);

    // And the correction says so, with what it was before.
    const entry = await prisma.auditLog.findFirst({
      where: { action: 'vehicle.arrived.aligned', entityId: vehicle.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(entry?.before).toMatchObject({ arrivedOn: recordedOn });
    expect(entry?.after).toMatchObject({ arrivedOn: pickedUpOn });
  });

  it('an owner brings a rental over: 9 weeks, 7 paid before, deposit received (crit. 17, 18)', async () => {
    const { prisma, vehicle, customer } = await fixtures();
    const pickedUpOn = addDays(today(), -60);
    const body = pickup(customer.id, vehicle.id, {
      pickedUpOn,
      odometerKm: undefined,
      payment: undefined,
      transfer: { paidThrough: addDays(pickedUpOn, 7 * 7 - 1), depositReceivedTetri: 18000 },
    });
    const manager = await loginAs('manager');
    expect((await call(manager, 'POST', '/api/pickups', body)).statusCode).toBe(403);
    const owner = await loginAs('owner');
    const bad = await call(owner, 'POST', '/api/pickups', { ...body, transfer: { paidThrough: addDays(pickedUpOn, 10), depositReceivedTetri: 0 } });
    expect(err(bad)).toMatchObject({ field: 'paidThrough' });
    const res = await call(owner, 'POST', '/api/pickups', body);
    expect(res.statusCode, res.body).toBe(201);
    const { id } = json<{ id: string }>(res);
    const c = await card(owner, id);
    expect(c.periods).toHaveLength(9);
    expect(c.periods.filter((p) => p.paidTetri === p.amountTetri)).toHaveLength(7);
    expect(c.rental.debtTetri).toBe(2 * 15000);
    expect(c.deposit.paidTetri).toBe(18000);
    expect(c.payments).toHaveLength(0);
    expect(c.rental.transferredAt).toBeTruthy();
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).state).toBe('rented');
    expect(await prisma.auditLog.count({ where: { entityId: id, action: 'rental.transfer' } })).toBe(1);
  });
});

/** A rental handed over `daysAgo` days ago with the first week and deposit paid. */
async function running(daysAgo: number, over: Record<string, unknown> = {}) {
  const f = await fixtures();
  const owner = await loginAs('owner');
  const res = await call(owner, 'POST', '/api/pickups', pickup(f.customer.id, f.vehicle.id, { pickedUpOn: addDays(today(), -daysAgo), ...over }));
  if (res.statusCode !== 201) throw new Error(res.body);
  return { ...f, owner, id: json<{ id: string }>(res).id };
}

const items = (over: Record<string, { state: string }> = {}) => ({ moped: { state: 'ok' }, key: { state: 'ok' }, battery_1: { state: 'ok' }, battery_2: { state: 'ok' }, charger_1: { state: 'ok' }, charger_2: { state: 'ok' }, ...over });

describe.skipIf(!HAS_DB)('wave 3 · return', () => {
  it('a manager returns with the key missing: 250 charged, the deposit waits for an owner (crit. 20)', async () => {
    const { id } = await running(3);
    const manager = await loginAs('manager');
    const res = await call(manager, 'POST', `/api/rentals/${id}/return`, { odometerKm: 150, items: items({ key: { state: 'missing' } }) });
    expect(res.statusCode, res.body).toBe(200);
    const c = await card(manager, id);
    expect(c.rental.status).toBe('returned');
    expect(c.charges).toEqual([expect.objectContaining({ kind: 'key', amountTetri: 25000, paidTetri: 0 })]);
    expect(c.deposit.decided).toBe(false);
    expect(c.rental.debtTetri).toBe(25000);
    const owner = await loginAs('owner');
    const deposits = json<{ deposits: { rentalId: string; segment: string }[] }>(await call(owner, 'GET', '/api/deposits'));
    expect(deposits.deposits.find((d) => d.rentalId === id)?.segment).toBe('undecided');
    const summary = json<{ depositsUndecided: { id: string }[] }>(await call(owner, 'GET', '/api/summary'));
    expect(summary.depositsUndecided.map((r) => r.id)).toContain(id);
    const pdf = await call(owner, 'GET', `/api/rentals/${id}/return-act.pdf`);
    expect(pdf.statusCode).toBe(200);
  });

  it('refuses a mileage below the hand-over (crit. 22) and a manager deciding the deposit', async () => {
    const { id } = await running(2);
    const manager = await loginAs('manager');
    expect(err(await call(manager, 'POST', `/api/rentals/${id}/return`, { odometerKm: 90, items: items() })).error).toBe('odometer_below_pickup');
    expect((await call(manager, 'POST', `/api/rentals/${id}/return`, { odometerKm: 150, items: items(), deposit: { action: 'return_all' } })).statusCode).toBe(403);
  });

  it('keeps no more than was received, and only with grounds and a reason (crit. 23, 25)', async () => {
    const { id, owner } = await running(2, { payment: { later: false, channel: 'cash', amountTetri: 9000 } });
    // 90 paid: all of it to the deposit first (Q6).
    expect((await card(owner, id)).deposit.paidTetri).toBe(9000);
    const ret = await call(owner, 'POST', `/api/rentals/${id}/return`, { odometerKm: 150, items: items() });
    expect(ret.statusCode, ret.body).toBe(200);
    const over = await call(owner, 'POST', `/api/rentals/${id}/deposit/decide`, { action: 'withhold', withheldTetri: 9100, grounds: ['rent_arrears'], reason: 'weeks' });
    expect(err(over).error).toBe('over_held');
    expect(err(await call(owner, 'POST', `/api/rentals/${id}/deposit/decide`, { action: 'withhold', withheldTetri: 5000, reason: 'x' }))).toMatchObject({ field: 'grounds' });
    expect(err(await call(owner, 'POST', `/api/rentals/${id}/deposit/decide`, { action: 'withhold', withheldTetri: 5000, grounds: ['rent_arrears'] }))).toMatchObject({ field: 'reason' });
    const ok = await call(owner, 'POST', `/api/rentals/${id}/deposit/decide`, { action: 'withhold', withheldTetri: 9000, grounds: ['rent_arrears'], reason: 'first week unpaid' });
    expect(ok.statusCode, ok.body).toBe(200);
    const c = await card(owner, id);
    expect(c.deposit.decided).toBe(true);
    // The week 150 is closed by 90 kept; 60 stays owed.
    expect(c.rental.debtTetri).toBe(6000);
    expect(err(await call(owner, 'POST', `/api/rentals/${id}/deposit/decide`, { action: 'return_all' })).error).toBe('deposit_decided');
  });

  it('a repair’s withholding and a return’s stand side by side (crit. 26)', async () => {
    const { id, owner, vehicle } = await running(3);
    const job = json<{ id: string }>(await call(owner, 'POST', '/api/service', { vehicleId: vehicle.id, reason: 'broken mirror', payer: 'customer', labourTetri: '50' }));
    expect((await call(owner, 'POST', `/api/service/${job.id}/close`, { withheldTetri: '50' })).statusCode).toBe(200);
    const ret = await call(owner, 'POST', `/api/rentals/${id}/return`, {
      odometerKm: 150,
      items: items(),
      deposit: { action: 'withhold', withheldTetri: 3000, grounds: ['cleaning'], reason: 'mud' },
    });
    expect(ret.statusCode, ret.body).toBe(200);
    const c = await card(owner, id);
    expect(c.deposit.withholdings.map((w) => [w.source, w.amountTetri])).toEqual([
      ['service', 5000],
      ['return', 3000],
    ]);
    const d = json<{ deposits: { rentalId: string; toHandBackTetri: number }[] }>(await call(owner, 'GET', '/api/deposits')).deposits.find((x) => x.rentalId === id)!;
    expect(d.toHandBackTetri).toBe(10000);
    const { job: after } = json<{ job: { withheldTetri: number } }>(await call(owner, 'GET', `/api/service/${job.id}`));
    expect(after.withheldTetri).toBe(5000);
  });

  it('claims above the deposit become the customer’s debt (crit. 27)', async () => {
    const { id, owner, customer } = await running(3);
    const ret = await call(owner, 'POST', `/api/rentals/${id}/return`, {
      odometerKm: 150,
      items: items({ key: { state: 'missing' } }),
      deposit: { action: 'withhold', withheldTetri: 18000, grounds: ['key_loss'], reason: 'key not brought back' },
    });
    expect(ret.statusCode, ret.body).toBe(200);
    const c = await card(owner, id);
    expect(c.rental.debtTetri).toBe(7000);
    const list = json<{ customers: { id: string; debtTetri: number }[] }>(await call(owner, 'GET', '/api/customers'));
    expect(list.customers.find((x) => x.id === customer.id)?.debtTetri).toBe(7000);
  });

  it('damage sends the moped to service with a draft job; otherwise it stands at the point (crit. 28, 29)', async () => {
    const { prisma, id, owner, vehicle } = await running(2);
    const ret = json<{ serviceJobId: string | null }>(
      await call(owner, 'POST', `/api/rentals/${id}/return`, { odometerKm: 150, items: items({ moped: { state: 'damaged', note: 'cracked panel' } as never }) }),
    );
    expect(ret.serviceJobId).toBeTruthy();
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).state).toBe('service');
    // The repair says what the act said, and gets the act's photos (QA-W3-04).
    const job = await prisma.serviceJob.findUniqueOrThrow({ where: { id: ret.serviceJobId! } });
    expect(job.reason).toMatch(/: cracked panel$/);
    expect(job.reason).not.toMatch(/moped/);
    const act = await prisma.act.findFirstOrThrow({ where: { rentalId: id, kind: 'return' } });
    const PNG1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    expect((await call(owner, 'POST', `/api/acts/${act.id}/photos`, { mimeType: 'image/png', label: 'panel', dataBase64: PNG1 })).statusCode).toBe(201);
    expect(await prisma.storedFile.count({ where: { serviceJobId: job.id, kind: 'service_photo' } })).toBe(1);

    const other = await running(2);
    const loc = json<{ id: string }>(await call(owner, 'POST', '/api/locations', { name: `ТЕСТ шоурум ${uniq()}` }));
    const ok = await call(owner, 'POST', `/api/rentals/${other.id}/return`, { odometerKm: 150, items: items(), locationId: loc.id });
    expect(ok.statusCode, ok.body).toBe(200);
    const v = await prisma.vehicle.findUniqueOrThrow({ where: { id: other.vehicle.id } });
    expect(v.state).toBe('available');
    expect(v.locationId).toBe(loc.id);
  });

  it('an owner takes a return back within a day (crit. 35)', async () => {
    const { prisma, id, owner, vehicle } = await running(3);
    await call(owner, 'POST', `/api/rentals/${id}/return`, { odometerKm: 150, items: items({ key: { state: 'missing' } }), deposit: { action: 'withhold', withheldTetri: 5000, grounds: ['key_loss'], reason: 'key' } });
    const manager = await loginAs('manager');
    expect((await call(manager, 'POST', `/api/rentals/${id}/return/undo`, { reason: 'mistake' })).statusCode).toBe(403);
    expect(err(await call(owner, 'POST', `/api/rentals/${id}/return/undo`, {}))).toMatchObject({ field: 'reason' });
    const res = await call(owner, 'POST', `/api/rentals/${id}/return/undo`, { reason: 'wrong moped' });
    expect(res.statusCode, res.body).toBe(200);
    const c = await card(owner, id);
    expect(c.rental.status).toBe('active');
    expect(c.charges).toHaveLength(0);
    expect(c.deposit.withholdings).toHaveLength(0);
    expect(c.deposit.withheldTetri).toBe(0);
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).state).toBe('rented');

    // A day later there is nothing to take back.
    await call(owner, 'POST', `/api/rentals/${id}/return`, { odometerKm: 160, items: items() });
    await prisma.act.updateMany({ where: { rentalId: id, kind: 'return' }, data: { createdAt: new Date(Date.now() - 25 * 3600_000) } });
    expect(err(await call(owner, 'POST', `/api/rentals/${id}/return/undo`, { reason: 'late' })).error).toBe('undo_return_too_late');
  });

  it('a return taken back calls off the repair it opened, taken on by a mechanic or not; the shelf gets its parts back (crit. 35; ADR-0035 §1)', async () => {
    const { prisma, id, owner, vehicle } = await running(3);
    const photo = { mimeType: 'image/png', dataBase64: PNG };
    const damaged = async (odometerKm: number) => {
      const res = await call(owner, 'POST', `/api/rentals/${id}/return`, { odometerKm, items: items({ moped: { state: 'damaged', note: 'ТЕСТ bent footrest' } as never }) });
      expect(res.statusCode, res.body).toBe(200);
      return json<{ serviceJobId: string }>(res).serviceJobId;
    };
    const jobRow = (jobId: string) => prisma.serviceJob.findUniqueOrThrow({ where: { id: jobId }, select: { status: true, closedOn: true } });

    // Nobody has taken it on yet.
    const one = await damaged(150);
    const undo = await call(owner, 'POST', `/api/rentals/${id}/return/undo`, { reason: 'ТЕСТ wrong moped' });
    expect(undo.statusCode, undo.body).toBe(200);
    expect((await jobRow(one)).status).toBe('cancelled');
    expect((await jobRow(one)).closedOn).not.toBeNull();
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).state).toBe('rented');

    // A mechanic took it on from the tablet — it waits for approval now — and a part off the shelf with it.
    const two = await damaged(160);
    const mech = await makeUser('mechanic');
    const mc = await login(mech.email);
    const taken = await call(mc, 'POST', '/api/service/workshop', {
      vehicleId: vehicle.id,
      jobId: two,
      reasonKind: 'renter_fault',
      reason: 'ТЕСТ bent footrest',
      odometerKm: 160,
      odometerPhoto: photo,
      photos: [photo],
      works: [{ freeText: 'ТЕСТ straighten the footrest' }],
    });
    expect(taken.statusCode, taken.body).toBe(200);
    expect(json<{ status: string }>(taken).status).toBe('draft');
    const part = json<{ id: string }>(await call(owner, 'POST', '/api/parts', { name: `ТЕСТ footrest ${uniq()}`, salePriceTetri: '35' })).id;
    await prisma.stockMove.create({ data: { partId: part, kind: 'receipt', qty: 3, unitCostTetri: 2000, occurredOn: new Date('2026-04-01T00:00:00Z') } });
    const line = await call(mc, 'POST', `/api/service/${two}/parts`, { partId: part, qty: 1 });
    expect(line.statusCode, line.body).toBe(201);
    const onHand = async () => json<{ part: { onHand: number } }>(await call(owner, 'GET', `/api/parts/${part}`)).part.onHand;
    expect(await onHand()).toBe(2);

    const again = await call(owner, 'POST', `/api/rentals/${id}/return/undo`, { reason: 'ТЕСТ wrong day' });
    expect(again.statusCode, again.body).toBe(200);
    expect((await jobRow(two)).status).toBe('cancelled');
    expect(await onHand()).toBe(3);
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).state).toBe('rented');
    expect(await prisma.auditLog.count({ where: { action: 'service.cancel', entityId: { in: [one, two] } } })).toBe(2);
  });

  it('no planned date: the started week in full; planned date missed: the smaller of week and days (crit. 36а, 36б)', async () => {
    // Paid through yesterday: handed over 7 days ago, one week paid.
    const plain = await running(7);
    const p = json<{ settlement: { weeks: number; late: unknown; choice: string } }>(await call(plain.owner, 'POST', `/api/rentals/${plain.id}/return/preview`, {}));
    expect(p.settlement.late).toBeNull();
    const withDate = await running(7, { expectedReturnOn: addDays(today(), -2) });
    const q = json<{ settlement: { late: { days: number; amountTetri: number }; choice: string } }>(
      await call(withDate.owner, 'POST', `/api/rentals/${withDate.id}/return/preview`, {}),
    );
    expect(q.settlement.late).toMatchObject({ days: 2, amountTetri: 6000 });
    expect(q.settlement.choice).toBe('late');
    const ret = await call(withDate.owner, 'POST', `/api/rentals/${withDate.id}/return`, { odometerKm: 150, items: items() });
    expect(ret.statusCode, ret.body).toBe(200);
    const c = await card(withDate.owner, withDate.id);
    expect(c.charges.map((x) => [x.kind, x.amountTetri])).toEqual([['late', 6000]]);
    expect(c.rental.debtTetri).toBe(6000);
  });

  it('a payment after the return closes the debt, not the deposit (crit. 36)', async () => {
    const { id, owner } = await running(8);
    await call(owner, 'POST', `/api/rentals/${id}/return`, { odometerKm: 150, items: items() });
    const before = await card(owner, id);
    expect(before.rental.debtTetri).toBe(15000);
    const manager = await loginAs('manager');
    const paid = await call(manager, 'POST', '/api/payments', { rentalId: id, channel: 'cash', grossTetri: 15000 });
    expect(paid.statusCode, paid.body).toBe(201);
    const after = await card(owner, id);
    expect(after.rental.debtTetri).toBe(0);
    expect(after.deposit.paidTetri).toBe(before.deposit.paidTetri);
  });
});

describe.skipIf(!HAS_DB)('wave 3 · after the hand-over', () => {
  it('a manager changes the terms; the journal keeps was and became; the rate does not change (crit. 32)', async () => {
    const { prisma, id } = await running(2);
    const manager = await loginAs('manager');
    const res = await call(manager, 'PATCH', `/api/rentals/${id}`, { nightParkingAddress: 'ТЕСТ new street 2', chargers: 1 });
    expect(res.statusCode, res.body).toBe(200);
    const r = await prisma.rental.findUniqueOrThrow({ where: { id } });
    expect(r).toMatchObject({ nightParkingAddress: 'ТЕСТ new street 2', chargers: 1, weeklyRateTetri: 15000 });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: id, action: 'rental.update' }, orderBy: { createdAt: 'desc' } });
    expect(log.before).toMatchObject({ nightParkingAddress: 'Test street 1', chargers: 2 });
    expect(log.after).toMatchObject({ nightParkingAddress: 'ТЕСТ new street 2', chargers: 1 });
    await call(manager, 'PATCH', `/api/rentals/${id}`, { weeklyRateTetri: 1 });
    expect((await prisma.rental.findUniqueOrThrow({ where: { id } })).weeklyRateTetri).toBe(15000);
  });

  it('pause and disputed are an owner’s, with a reason; no weeks are added for the time (crit. 33, 34)', async () => {
    const { id, owner } = await running(2);
    const manager = await loginAs('manager');
    expect((await call(manager, 'POST', `/api/rentals/${id}/status`, { status: 'disputed', reason: 'x' })).statusCode).toBe(403);
    expect(err(await call(owner, 'POST', `/api/rentals/${id}/status`, { status: 'disputed' }))).toMatchObject({ field: 'reason' });
    expect((await call(owner, 'POST', `/api/rentals/${id}/status`, { status: 'disputed', reason: 'says moped was broken' })).statusCode).toBe(200);
    expect((await card(owner, id)).rental.status).toBe('disputed');
    expect(err(await call(owner, 'PATCH', `/api/rentals/${id}`, { status: 'active' })).error).toBe('use_status_route');
    expect((await call(owner, 'POST', `/api/rentals/${id}/status`, { status: 'active', reason: 'settled' })).statusCode).toBe(200);
    expect((await card(owner, id)).rental.status).toBe('active');
  });
});
