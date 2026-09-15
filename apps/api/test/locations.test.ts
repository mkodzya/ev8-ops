// Points: where a moped stands, and who may say so.
// Needs a *_test database; the teardown removes everything it made.
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

async function fixtures() {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Model ${uniq()}`, weeklyRateTetri: 15000, forRent: true } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TEST${uniq().replace(/\D/g, '').slice(0, 13).padStart(13, '0')}`, modelId: model.id } });
  const customer = await prisma.customer.create({ data: { name: `Test Customer ${uniq()}`, phone: `+9955${uniq().replace(/\D/g, '').slice(-8)}` } });
  return { prisma, model, vehicle, customer };
}

async function point(cookie: string, name = `Yard ${uniq()}`) {
  const res = await call(cookie, 'POST', '/api/locations', { name });
  expect(res.statusCode, res.body).toBe(201);
  return { name, id: json<{ id: string }>(res).id };
}

describe.skipIf(!HAS_DB)('naming the places', () => {
  it('refuses the same place twice, however it is spelled', async () => {
    const owner = await loginAs('owner');
    const { name } = await point(owner);
    const again = await call(owner, 'POST', '/api/locations', { name: `  ${name.toUpperCase()} ` });
    expect(again.statusCode).toBe(409);
    expect(json<{ error: string }>(again).error).toBe('duplicate_location');
  });

  it('is the owner\'s list, though everyone who moves a moped reads it', async () => {
    const manager = await loginAs('manager');
    expect((await call(manager, 'GET', '/api/locations')).statusCode).toBe(200);
    expect((await call(manager, 'POST', '/api/locations', { name: `Yard ${uniq()}` })).statusCode).toBe(403);
  });

  it('keeps a point that still holds mopeds, and names the number in the way', async () => {
    const owner = await loginAs('owner');
    const { vehicle } = await fixtures();
    const { id } = await point(owner);
    expect((await call(owner, 'POST', `/api/fleet/${vehicle.id}/location`, { locationId: id })).statusCode).toBe(200);

    const retire = await call(owner, 'PATCH', `/api/locations/${id}`, { archived: true });
    expect(retire.statusCode).toBe(409);
    expect(json<{ error: string; vehicles: number }>(retire)).toMatchObject({ error: 'location_in_use', vehicles: 1 });

    // Empty it, and the point retires without argument.
    await call(owner, 'POST', `/api/fleet/${vehicle.id}/location`, { locationId: null });
    expect((await call(owner, 'PATCH', `/api/locations/${id}`, { archived: true })).statusCode).toBe(200);
  });
});

describe.skipIf(!HAS_DB)('placing a moped', () => {
  it('is the manager\'s to answer, and reads back on the fleet list', async () => {
    const owner = await loginAs('owner');
    const manager = await loginAs('manager');
    const { vehicle } = await fixtures();
    const { id, name } = await point(owner);

    expect((await call(manager, 'POST', `/api/fleet/${vehicle.id}/location`, { locationId: id })).statusCode).toBe(200);
    const list = json<{ vehicles: { id: string; location: { name: string } | null }[] }>(await call(manager, 'GET', '/api/fleet'));
    expect(list.vehicles.find((v) => v.id === vehicle.id)?.location?.name).toBe(name);

    // Nobody has said is an answer too, and it clears the point.
    expect((await call(manager, 'POST', `/api/fleet/${vehicle.id}/location`, { locationId: null })).statusCode).toBe(200);
    const after = json<{ vehicle: { location: unknown } }>(await call(manager, 'GET', `/api/fleet/${vehicle.id}`));
    expect(after.vehicle.location).toBeNull();
  });

  it('lets the moped go to its customer, and takes the point off it on the way out', async () => {
    const owner = await loginAs('owner');
    const manager = await loginAs('manager');
    const { prisma, vehicle, customer } = await fixtures();
    const { id } = await point(owner);
    await call(manager, 'POST', `/api/fleet/${vehicle.id}/location`, { locationId: id });

    const rental = await call(manager, 'POST', '/api/rentals', {
      customerId: customer.id,
      vehicleId: vehicle.id,
      weeklyRateTetri: '150',
      pickedUpOn: '2026-09-10',
    });
    expect(rental.statusCode, rental.body).toBe(201);

    // At a customer is where it is; a yard of ours would be a second answer.
    const v = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(v.state).toBe('rented');
    expect(v.locationId).toBeNull();

    const refused = await call(manager, 'POST', `/api/fleet/${vehicle.id}/location`, { locationId: id });
    expect(refused.statusCode).toBe(409);
    expect(json<{ error: string }>(refused).error).toBe('vehicle_rented');
  });

  it('refuses a point that does not exist', async () => {
    const manager = await loginAs('manager');
    const { vehicle } = await fixtures();
    const res = await call(manager, 'POST', `/api/fleet/${vehicle.id}/location`, { locationId: '00000000-0000-0000-0000-000000000000' });
    expect(res.statusCode).toBe(404);
  });
});
