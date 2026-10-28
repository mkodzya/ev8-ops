// The mechanic's roles and the workshop tablet (ADR-0033; stage 1 of
// docs/spec/mechanic-in-erp-plan.md). Each "Сдан" point of the stage is a test
// here: a PIN from a browser that is not the registered tablet, or from a
// revoked one, opens nothing; five wrong PINs close the sign-in for fifteen
// minutes; a mechanic is refused the approval; no answer carries a hash.
// PINs here are invented test values.
import { PIN_SESSION_PERMISSIONS } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { HAS_DB, PASSWORD, call, json, login, loginAs, makeUser, uniq } from './helpers.js';

const HASHES = /s2:|pin_?hash|secret_?hash|pinHash|secretHash|password_?hash|passwordHash/i;

/** A cookie header from what the answer set, joined to what the browser already had. */
function withCookies(res: { cookies: { name: string; value: string }[] }, ...had: (string | null)[]): string {
  const set = res.cookies.map((c) => `${c.name}=${c.value}`);
  return [...had.filter(Boolean), ...set].join('; ');
}

const cookieValue = (cookie: string, name: string) => cookie.split('; ').find((c) => c.startsWith(`${name}=`)) ?? null;

/** The owner registers the browser they are on as the workshop tablet; the answer is the tablet's cookie. */
async function registerTablet(owner: string): Promise<{ device: string; id: string }> {
  const res = await call(owner, 'POST', '/api/workshop/devices', { name: `Tablet ${uniq()}` });
  expect(res.statusCode, res.body).toBe(201);
  const device = cookieValue(withCookies(res), 'ev8_device');
  expect(device).not.toBeNull();
  return { device: device!, id: json<{ id: string }>(res).id };
}

/** A mechanic with a PIN the owner set; no address — they sign in only on the tablet. */
async function mechanic(owner: string, role: 'mechanic' | 'chief_mechanic' = 'mechanic', pin = '4826') {
  const made = await call(owner, 'POST', '/api/users', { name: `Test ${role} ${uniq()}`, role });
  expect(made.statusCode, made.body).toBe(201);
  const { id } = json<{ id: string }>(made);
  const set = await call(owner, 'POST', `/api/users/${id}/pin`, { pin });
  expect(set.statusCode, set.body).toBe(200);
  return { id, pin };
}

async function pinLogin(device: string | null, userId: string, pin: string) {
  return call(device, 'POST', '/api/auth/pin', { userId, pin });
}

/** Signs in on the tablet; the tablet's cookies afterwards (device and session). */
async function onTablet(device: string, userId: string, pin: string): Promise<string> {
  const res = await pinLogin(device, userId, pin);
  expect(res.statusCode, res.body).toBe(200);
  return withCookies(res, device);
}

describe('the PIN and the tablet, without a database', () => {
  // And since issue #18 A (ADR-0050) his own «Сегодня» and tasks: most mechanics sign in nowhere else.
  it('lets a PIN session reach the repairs and one’s own tasks and nothing else, whatever the role (ADR-0033 §7)', async () => {
    const { permissionsOf } = await import('../src/lib/auth.js');
    expect(permissionsOf('owner', 'pin')).toEqual(PIN_SESSION_PERMISSIONS);
    expect(permissionsOf('owner', 'pin')).not.toContain('service.payout');
    expect(permissionsOf('owner', 'pin')).not.toContain('todos.assign');
    expect(permissionsOf('mechanic', 'pin')).toEqual(['service.view', 'service.work', 'todos.own']);
    expect(permissionsOf('chief_mechanic', 'pin')).toEqual(['service.view', 'service.work', 'service.approve', 'service.norms', 'todos.own']);
  });

  it('gives neither mechanic the fleet, a customer, money or cost', async () => {
    const { permissionsOf } = await import('../src/lib/auth.js');
    for (const role of ['mechanic', 'chief_mechanic'] as const) {
      for (const p of ['fleet.view', 'payments.view', 'cash.record', 'cost.view', 'deposit.decide', 'service.manage', 'service.payout'] as const) {
        expect(permissionsOf(role), `${role} ${p}`).not.toContain(p);
      }
    }
  });
});

describe.skipIf(!HAS_DB)('the workshop tablet (ADR-0033)', () => {
  it('opens nothing with a PIN from a browser that is not the registered tablet', async () => {
    const owner = await loginAs('owner');
    const m = await mechanic(owner);
    const res = await pinLogin(null, m.id, m.pin);
    expect(res.statusCode).toBe(403);
    expect(json<{ error: string }>(res).error).toBe('not_a_workshop_device');
    // A made-up token is no tablet either.
    const forged = await pinLogin(`ev8_device=${m.id}.${'0'.repeat(64)}`, m.id, m.pin);
    expect(forged.statusCode).toBe(403);
    // An ordinary browser sees no names.
    expect(json<{ device: unknown; people: unknown[] }>(await call(null, 'GET', '/api/workshop/tablet'))).toEqual({ device: null, people: [] });
  });

  it('signs a mechanic in on the tablet, and a revoked tablet opens nothing and ends its sessions', async () => {
    const owner = await loginAs('owner');
    const { device, id } = await registerTablet(owner);
    const m = await mechanic(owner);

    const tablet = json<{ device: { name: string }; people: { id: string; name: string; lockedUntil: string | null }[] }>(await call(device, 'GET', '/api/workshop/tablet'));
    expect(tablet.device.name).toMatch(/^Tablet /);
    expect(tablet.people.find((p) => p.id === m.id)).toMatchObject({ lockedUntil: null });

    const session = await onTablet(device, m.id, m.pin);
    const me = json<{ id: string; via: string; idleMinutes: number; permissions: string[] }>(await call(session, 'GET', '/api/me'));
    expect(me).toMatchObject({ id: m.id, via: 'pin', idleMinutes: 10 });
    expect(me.permissions).toEqual(['service.view', 'service.work', 'todos.own']);

    const revoked = await call(owner, 'POST', `/api/workshop/devices/${id}/revoke`);
    expect(revoked.statusCode, revoked.body).toBe(200);
    expect(json<{ closed: number }>(revoked).closed).toBe(1);
    expect((await call(session, 'GET', '/api/me')).statusCode).toBe(401);
    const again = await pinLogin(device, m.id, m.pin);
    expect(again.statusCode).toBe(403);
    expect(json<{ error: string }>(again).error).toBe('not_a_workshop_device');
    expect(json<{ device: unknown }>(await call(device, 'GET', '/api/workshop/tablet')).device).toBeNull();
  });

  it('closes the PIN sign-in for fifteen minutes after five wrong PINs, and a new PIN opens it', async () => {
    const owner = await loginAs('owner');
    const { device } = await registerTablet(owner);
    const m = await mechanic(owner, 'mechanic', '7391');
    for (let i = 1; i <= 4; i++) {
      const wrong = await pinLogin(device, m.id, '0000');
      expect(wrong.statusCode, `try ${i}`).toBe(401);
      expect(json<{ error: string; left: number }>(wrong)).toEqual({ error: 'invalid_pin', left: 5 - i });
    }
    const fifth = await pinLogin(device, m.id, '0000');
    expect(fifth.statusCode).toBe(429);
    const { error, until } = json<{ error: string; until: string }>(fifth);
    expect(error).toBe('pin_locked');
    const minutes = (new Date(until).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);

    // The right PIN does not open it either, and the tablet says until when.
    expect((await pinLogin(device, m.id, '7391')).statusCode).toBe(429);
    const shown = json<{ people: { id: string; lockedUntil: string | null }[] }>(await call(device, 'GET', '/api/workshop/tablet'));
    expect(shown.people.find((p) => p.id === m.id)?.lockedUntil).toBe(until);
    const { prisma } = await import('../src/lib/db.js');
    expect(await prisma.auditLog.count({ where: { actorId: m.id, action: 'auth.pin.failed' } })).toBe(5);

    // The owner sets a new PIN: the sign-in opens at once.
    expect((await call(owner, 'POST', `/api/users/${m.id}/pin`, { pin: '518204' })).statusCode).toBe(200);
    expect((await pinLogin(device, m.id, '518204')).statusCode).toBe(200);
  });

  it('opens again by itself once the fifteen minutes are over', async () => {
    const owner = await loginAs('owner');
    const { device } = await registerTablet(owner);
    const m = await mechanic(owner, 'mechanic', '2468');
    const { prisma } = await import('../src/lib/db.js');
    await prisma.user.update({ where: { id: m.id }, data: { pinLockedUntil: new Date(Date.now() - 1000) } });
    expect((await pinLogin(device, m.id, '2468')).statusCode).toBe(200);
  });

  it('refuses a mechanic the approval and lets the chief mechanic and an owner give it', async () => {
    const owner = await loginAs('owner');
    const { device } = await registerTablet(owner);
    const m = await mechanic(owner, 'mechanic', '1357');
    const chief = await mechanic(owner, 'chief_mechanic', '8642');
    const { prisma } = await import('../src/lib/db.js');
    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Approve ${uniq()}` } });
    const draft = async () => {
      const v = await prisma.vehicle.create({ data: { vin: `PIN${uniq().replace(/\D/g, '').slice(0, 14).padStart(14, '0')}`, modelId: model.id } });
      const manager = await loginAs('manager');
      const res = await call(manager, 'POST', '/api/service', { vehicleId: v.id, reason: 'ТЕСТ does not start' });
      expect(res.statusCode, res.body).toBe(201);
      return json<{ id: string }>(res).id;
    };

    const first = await draft();
    const asMechanic = await onTablet(device, m.id, m.pin);
    const refused = await call(asMechanic, 'POST', `/api/service/${first}/approve`);
    expect(refused.statusCode).toBe(403);
    expect(json<{ error: string; permission: string }>(refused)).toMatchObject({ error: 'forbidden', permission: 'service.approve' });

    const asChief = await onTablet(device, chief.id, chief.pin);
    expect((await call(asChief, 'POST', `/api/service/${first}/approve`)).statusCode).toBe(200);
    expect((await prisma.serviceJob.findUniqueOrThrow({ where: { id: first } })).status).toBe('open');
    // Once taken up it no longer waits.
    expect((await call(asChief, 'POST', `/api/service/${first}/approve`)).statusCode).toBe(409);

    const second = await draft();
    expect((await call(owner, 'POST', `/api/service/${second}/approve`)).statusCode).toBe(200);
    // The PATCH no longer takes a draft up: there is one way to approve.
    const third = await draft();
    await call(owner, 'PATCH', `/api/service/${third}`, { open: true });
    expect((await prisma.serviceJob.findUniqueOrThrow({ where: { id: third } })).status).toBe('draft');
  });

  it('shows a mechanic their own repairs without money or customers, and the chief mechanic every one', async () => {
    const owner = await loginAs('owner');
    const { device } = await registerTablet(owner);
    const m = await mechanic(owner, 'mechanic', '1122');
    const chief = await mechanic(owner, 'chief_mechanic', '3344');
    const { prisma } = await import('../src/lib/db.js');
    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Mine ${uniq()}` } });
    const job = async (createdById: string, mechanicId: string | null) => {
      const v = await prisma.vehicle.create({ data: { vin: `MIN${uniq().replace(/\D/g, '').slice(0, 14).padStart(14, '0')}`, modelId: model.id } });
      const j = await prisma.serviceJob.create({
        data: { vehicleId: v.id, reason: 'ТЕСТ brakes', openedOn: new Date('2026-10-20'), status: 'open', labourMinutes: 90, labourTetri: 7500, withheldTetri: 0, createdById, mechanicId },
      });
      await prisma.servicePart.create({ data: { jobId: j.id, name: 'ТЕСТ pad', qty: 2, unitPriceTetri: 1200, unitCostTetri: 800 } });
      return j.id;
    };
    const ownerMe = json<{ id: string }>(await call(owner, 'GET', '/api/me'));
    // His own are the repairs he carries (stage 2), whoever opened them; one
    // he opened for nobody in particular is not his.
    const own = await job(ownerMe.id, m.id);
    const other = await job(m.id, null);

    const asMechanic = await onTablet(device, m.id, m.pin);
    const list = json<{ jobs: { id: string; totalTetri: number | null; labourTetri: number | null; labourMinutes: number; customer: unknown; parts: { unitPriceTetri: number | null; unitCostTetri?: number | null }[] }[] }>(
      await call(asMechanic, 'GET', '/api/service'),
    );
    expect(list.jobs.map((j) => j.id)).toEqual([own]);
    const seen = list.jobs[0]!;
    expect(seen).toMatchObject({ totalTetri: null, labourTetri: null, labourMinutes: 90, customer: null });
    expect(seen.parts).toEqual([expect.objectContaining({ qty: 2, unitPriceTetri: null, unitCostTetri: null })]);
    expect((await call(asMechanic, 'GET', `/api/service/${other}`)).statusCode).toBe(404);
    expect((await call(asMechanic, 'GET', `/api/service/${own}`)).statusCode).toBe(200);

    const asChief = await onTablet(device, chief.id, chief.pin);
    const all = json<{ jobs: { id: string; totalTetri: number | null }[] }>(await call(asChief, 'GET', '/api/service'));
    expect(all.jobs.map((j) => j.id)).toEqual(expect.arrayContaining([own, other]));
    expect(all.jobs.find((j) => j.id === other)?.totalTetri).toBeNull();

    // The owner sees the money; the manager, since ADR-0033 §4, does not.
    const ownerCard = json<{ job: { totalTetri: number; parts: { unitCostTetri: number }[] } }>(await call(owner, 'GET', `/api/service/${own}`));
    expect(ownerCard.job.totalTetri).toBe(7500 + 2400);
    expect(ownerCard.job.parts[0]!.unitCostTetri).toBe(800);
    const manager = await loginAs('manager');
    const managerCard = json<{ job: { totalTetri: number | null; withheldTetri: number | null; parts: { unitCostTetri?: number | null }[] } }>(await call(manager, 'GET', `/api/service/${own}`));
    expect(managerCard.job).toMatchObject({ totalTetri: null, withheldTetri: null });
    expect(managerCard.job.parts[0]!.unitCostTetri).toBeNull();
  });

  it('keeps a mechanic out of everything but the repairs', async () => {
    const owner = await loginAs('owner');
    const { device } = await registerTablet(owner);
    const m = await mechanic(owner);
    const asMechanic = await onTablet(device, m.id, m.pin);
    for (const url of ['/api/today', '/api/summary', '/api/fleet', '/api/customers', '/api/search?q=ab', '/api/parts', '/api/users']) {
      expect((await call(asMechanic, 'GET', url)).statusCode, url).toBe(403);
    }
    expect((await call(asMechanic, 'GET', '/api/service')).statusCode).toBe(200);
    // Not the place to change a password, either.
    const pw = await call(asMechanic, 'POST', '/api/me/password', { currentPassword: 'x', newPassword: 'long-enough-1' });
    expect(pw.statusCode).toBe(403);
  });

  it('ends a PIN session after ten idle minutes, and a password session not', async () => {
    const owner = await loginAs('owner');
    const { device } = await registerTablet(owner);
    const m = await mechanic(owner);
    const session = await onTablet(device, m.id, m.pin);
    const { prisma } = await import('../src/lib/db.js');
    const token = cookieValue(session, 'ev8_session')!.split('=')[1]!;
    await prisma.session.update({ where: { token }, data: { lastSeenAt: new Date(Date.now() - 11 * 60_000) } });
    expect((await call(session, 'GET', '/api/me')).statusCode).toBe(401);

    const ownerToken = owner.split('=')[1]!;
    await prisma.session.update({ where: { token: ownerToken }, data: { lastSeenAt: new Date(Date.now() - 11 * 60_000) } });
    expect((await call(owner, 'GET', '/api/me')).statusCode).toBe(200);
  });

  it('answers the person\'s own language on a PIN sign-in, not the tablet\'s', async () => {
    const owner = await loginAs('owner');
    const { device } = await registerTablet(owner);
    const m = await mechanic(owner);
    const { prisma } = await import('../src/lib/db.js');
    await prisma.user.update({ where: { id: m.id }, data: { locale: 'ru' } });
    const res = await pinLogin(device, m.id, m.pin);
    expect(json<{ me: { locale: string; via: string } }>(res).me).toMatchObject({ locale: 'ru', via: 'pin' });
  });

  it('carries no hash in any answer', async () => {
    const owner = await loginAs('owner');
    const { device } = await registerTablet(owner);
    const m = await mechanic(owner);
    const signedIn = await pinLogin(device, m.id, m.pin);
    const answers = [
      signedIn.body,
      (await call(owner, 'GET', '/api/users')).body,
      (await call(owner, 'GET', '/api/workshop/devices')).body,
      (await call(device, 'GET', '/api/workshop/tablet')).body,
      (await call(withCookies(signedIn, device), 'GET', '/api/me')).body,
    ];
    // A PIN that leaked would be a value of its own. Looked for as a piece of
    // the text it is found in other people's test names, whose random digits
    // contain «4826» now and then — and the test failed on nothing.
    const values = (x: unknown): unknown[] => (x && typeof x === 'object' ? Object.values(x).flatMap(values) : [x]);
    for (const body of answers) {
      expect(body).not.toMatch(HASHES);
      expect(values(JSON.parse(body))).not.toContain(m.pin);
    }
    const listed = json<{ users: { id: string; hasPin: boolean; email: string | null }[] }>(await call(owner, 'GET', '/api/users')).users.find((u) => u.id === m.id);
    expect(listed).toMatchObject({ hasPin: true, email: null });
    // The device's secret is in its cookie only, never in the list.
    const devices = json<{ devices: { here: boolean }[] }>(await call(`${owner}; ${device}`, 'GET', '/api/workshop/devices')).devices;
    expect(devices.some((d) => d.here)).toBe(true);
  });
});

describe.skipIf(!HAS_DB)('people of the workshop (ADR-0033 §8)', () => {
  it('takes a mechanic without an address, and nobody else', async () => {
    const owner = await loginAs('owner');
    const made = await call(owner, 'POST', '/api/users', { name: `Test mechanic ${uniq()}`, role: 'mechanic', labourRateTetri: 6000 });
    expect(made.statusCode, made.body).toBe(201);
    const manager = await call(owner, 'POST', '/api/users', { name: `Test manager ${uniq()}`, role: 'manager', password: 'long-enough-1' });
    expect(manager.statusCode).toBe(400);
    expect(json<{ error: string; field: string }>(manager)).toMatchObject({ error: 'missing_field', field: 'email' });

    // Without an address a mechanic cannot become a manager…
    const { id } = json<{ id: string }>(made);
    const promote = await call(owner, 'PATCH', `/api/users/${id}`, { role: 'manager' });
    expect(promote.statusCode).toBe(409);
    expect(json<{ error: string }>(promote).error).toBe('email_required');
    // …until an owner gives them an address and a password.
    const email = `mech.${uniq()}@test.ev8`;
    expect((await call(owner, 'POST', `/api/users/${id}/password`, { email, password: PASSWORD })).statusCode).toBe(200);
    expect((await call(owner, 'PATCH', `/api/users/${id}`, { role: 'chief_mechanic' })).statusCode).toBe(200);
    const phone = await login(email);
    expect(json<{ via: string; permissions: string[] }>(await call(phone, 'GET', '/api/me'))).toMatchObject({ via: 'password' });
  });

  it('gives a PIN only to a mechanic, only of 4 to 6 digits, and takes it away with the role', async () => {
    const owner = await loginAs('owner');
    const manager = await makeUser('manager');
    const refused = await call(owner, 'POST', `/api/users/${manager.id}/pin`, { pin: '4826' });
    expect(refused.statusCode).toBe(409);
    expect(json<{ error: string }>(refused).error).toBe('pin_for_mechanics');

    const m = await makeUser('mechanic');
    for (const pin of ['123', '1234567', 'abcd', 4826]) {
      expect((await call(owner, 'POST', `/api/users/${m.id}/pin`, { pin })).statusCode, String(pin)).toBe(400);
    }
    expect((await call(owner, 'POST', `/api/users/${m.id}/pin`, { pin: '4826' })).statusCode).toBe(200);
    const { device } = await registerTablet(owner);
    const session = await onTablet(device, m.id, '4826');
    // Made a manager: the PIN, the rate and the tablet's session go.
    expect((await call(owner, 'PATCH', `/api/users/${m.id}`, { role: 'manager' })).statusCode).toBe(200);
    const { prisma } = await import('../src/lib/db.js');
    expect(await prisma.user.findUniqueOrThrow({ where: { id: m.id }, select: { pinHash: true, labourRateTetri: true } })).toEqual({ pinHash: null, labourRateTetri: null });
    expect((await call(session, 'GET', '/api/me')).statusCode).toBe(401);
    // And the journal knows a PIN was set, not what it was.
    const rows = await prisma.auditLog.findMany({ where: { entityId: m.id, action: { startsWith: 'user.pin' } } });
    expect(rows.map((r) => r.action)).toEqual(['user.pin.set']);
    expect(JSON.stringify(rows)).not.toContain('4826');
  });

});
