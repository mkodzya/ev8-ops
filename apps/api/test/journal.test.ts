import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, login, loginAs, makeUser, uniq } from './helpers.js';

interface Line {
  id: string;
  at: string;
  action: string;
  actorName: string | null;
  entityType: string;
  number: string | null;
  before: unknown;
  after: unknown;
  note: string | null;
  kind: 'change' | 'event';
  times: number;
}

const rows = async (cookie: string, query = '') => json<{ rows: Line[] }>(await call(cookie, 'GET', `/api/journal${query}`)).rows;

describe.skipIf(!HAS_DB)('the journal on its own screen (wave 6 §3.8)', () => {
  it('a manager is not let in', async () => {
    const manager = await loginAs('manager');
    expect((await call(manager, 'GET', '/api/journal')).statusCode).toBe(403);
    expect((await call(manager, 'GET', '/api/journal.csv')).statusCode).toBe(403);
  });

  it('finds a sale by its number and says what changed, from what to what (crit. 17)', async () => {
    const owner = await loginAs('owner');
    const { prisma } = await import('../src/lib/db.js');
    const customer = await prisma.customer.create({ data: { name: `ТЕСТ Журнал ${uniq()}` } });
    const sale = await prisma.sale.create({ data: { customerId: customer.id, soldOn: new Date(), priceTetri: 518800, vinNote: 'ТЕСТ без VIN' } });
    await prisma.auditLog.create({
      data: { action: 'sale.update', entityType: 'sale', entityId: sale.id, before: { priceTetri: 518800 }, after: { priceTetri: 500000 }, note: 'скидка по договорённости' },
    });

    const found = await rows(owner, `?q=${sale.number}`);
    expect(found).toHaveLength(1);
    expect(found[0].number).toBe(sale.number);
    expect(found[0].kind).toBe('change');
    expect(found[0].before).toEqual({ priceTetri: 518800 });
    expect(found[0].after).toEqual({ priceTetri: 500000 });
    expect(found[0].note).toBe('скидка по договорённости');
  });

  it('a failed sign-in is found by the address, carries the IP, and has no "было" (crit. 18, 19а)', async () => {
    const u = await makeUser('manager');
    await call(null, 'POST', '/api/auth/login', { email: u.email, password: 'wrong-one' });
    const owner = await loginAs('owner');

    const found = await rows(owner, `?q=${encodeURIComponent(u.email)}&filter=logins`);
    const failed = found.find((r) => r.action === 'auth.login.failed');
    expect(failed).toBeDefined();
    expect(failed?.kind).toBe('event');
    expect(failed?.before).toBeNull();
    expect((failed?.after as { ip: string | null }).ip).not.toBeUndefined();
    expect(JSON.stringify(found)).not.toContain('wrong-one');
  });

  it('three looks at one personal number are one line with a counter, and three rows in the CSV (crit. 19)', async () => {
    const owner = await loginAs('owner');
    const { prisma } = await import('../src/lib/db.js');
    const c = await prisma.customer.create({ data: { name: `ТЕСТ Номер ${uniq()}`, personalId: `T${uniq().replace(/\D/g, '')}` } });
    for (let i = 0; i < 3; i++) {
      const res = await call(owner, 'GET', `/api/customers/${c.id}/personal-id`);
      expect(res.statusCode).toBe(200);
    }

    const found = await rows(owner, `?q=${encodeURIComponent(c.name)}`);
    const views = found.filter((r) => r.action === 'customer.personalId.view');
    expect(views).toHaveLength(1);
    expect(views[0].times).toBe(3);
    expect(views[0].kind).toBe('event');

    const csv = await call(owner, 'GET', `/api/journal.csv?q=${encodeURIComponent(c.name)}`);
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    const lines = csv.body.split('\n').filter((l) => l.includes('customer.personalId.view'));
    expect(lines).toHaveLength(3);
    // A cell for something that does not exist is empty, not the word "null",
    // which a spreadsheet reads as a value somebody wrote (round 5 remark).
    expect(lines[0]).not.toContain('null');
    expect(lines[0].split(',').slice(5, 8)).toEqual(['', '', '']);
  });

  // QA-W6-10, crit. 20. A deposit and a payment are written under ids of
  // their own; asking about the rental used to find the hand-over and
  // nothing else.
  it('a rental number finds what belongs to the rental — its money and its deposit', async () => {
    const owner = await loginAs('owner');
    const { prisma } = await import('../src/lib/db.js');
    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Search ${uniq()}`, weeklyRateTetri: 15000, forRent: true } });
    const vehicle = await prisma.vehicle.create({ data: { vin: `TESTSEARCH${uniq().replace(/\D/g, '').slice(-6)}`, modelId: model.id, pool: 'rent' } });
    const customer = await prisma.customer.create({ data: { name: `ТЕСТ Поиск ${uniq()}` } });
    const rental = await prisma.rental.create({ data: { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, status: 'returned', returnedOn: new Date() } });
    const deposit = await prisma.deposit.create({ data: { rentalId: rental.id, amountTetri: 18000, paidTetri: 18000 } });
    const payment = await prisma.payment.create({
      data: { customerId: customer.id, rentalId: rental.id, occurredOn: new Date(), grossTetri: 15000, netTetri: 15000, channel: 'cash', direction: 'in', kind: 'rent', source: 'manual' },
    });
    await prisma.auditLog.create({ data: { action: 'rental.pickup', entityType: 'rental', entityId: rental.id, after: { status: 'active' } } });
    await prisma.auditLog.create({ data: { action: 'payment.record', entityType: 'payment', entityId: payment.id, after: { grossTetri: 15000 } } });
    await prisma.auditLog.create({ data: { action: 'deposit.decide', entityType: 'deposit', entityId: deposit.id, after: { withheldTetri: 5000 }, note: 'ключ не вернул' } });

    const found = await rows(owner, `?q=${rental.number}`);
    const actions = found.map((r) => r.action);
    expect(actions).toContain('rental.pickup');
    expect(actions).toContain('payment.record');
    expect(actions).toContain('deposit.decide');
    // And each of them answers for the rental, rather than showing "—".
    expect(found.every((r) => r.number === rental.number)).toBe(true);
  });

  // QA-W6-15. The decision carried its reason inside what was written, and
  // the journal's own column looked only beside it — so a person asking
  // "почему клиенту вернули не всё" saw that a decision happened and not
  // which one.
  it('a deposit decided says how much it held, how much went back, and why', async () => {
    const owner = await loginAs('owner');
    const { prisma } = await import('../src/lib/db.js');
    const { applyDecision } = await import('../src/lib/rentals.js');
    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Reason ${uniq()}`, weeklyRateTetri: 15000, forRent: true } });
    const vehicle = await prisma.vehicle.create({ data: { vin: `TESTREASON${uniq().replace(/\D/g, '').slice(-6)}`, modelId: model.id, pool: 'rent' } });
    const customer = await prisma.customer.create({ data: { name: `ТЕСТ Причина ${uniq()}` } });
    const rental = await prisma.rental.create({
      data: { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, status: 'returned', returnedOn: new Date(), pickedUpOn: new Date() },
    });
    await prisma.deposit.create({ data: { rentalId: rental.id, amountTetri: 18000, paidTetri: 18000 } });
    const me = json<{ id: string; role: string }>(await call(owner, 'GET', '/api/me'));

    await prisma.$transaction(async (tx) => {
      await applyDecision(tx, { id: me.id, email: '', name: '', role: 'owner', locale: 'ru' }, rental.id, {
        action: 'withhold',
        withheldTetri: 5000,
        grounds: ['damage'],
        reason: 'ТЕСТ царапина на щитке',
        returnedTo: null,
        returnedToReason: null,
      }, '2026-09-22');
    });

    const found = await rows(owner, `?q=${rental.number}`);
    const line = found.find((r) => r.action === 'deposit.decide');
    expect(line).toBeDefined();
    expect(line?.note).toBe('ТЕСТ царапина на щитке');
    expect((line?.before as { heldTetri: number }).heldTetri).toBe(18000);
    expect((line?.after as { heldTetri: number; keptTetri: number; backTetri: number }).heldTetri).toBe(0);
    expect((line?.after as { keptTetri: number }).keptTetri).toBe(5000);
    expect((line?.after as { backTetri: number }).backTetri).toBe(13000);
  });

  it('the filters keep a line where it belongs, and "всё" keeps them all', async () => {
    const owner = await loginAs('owner');
    const { prisma } = await import('../src/lib/db.js');
    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Journal ${uniq()}`, weeklyRateTetri: 15000, forRent: true } });
    const v = await prisma.vehicle.create({ data: { vin: `TESTJOURNAL${uniq().replace(/\D/g, '').slice(-6)}`, modelId: model.id, state: 'available' } });
    await prisma.auditLog.create({ data: { action: 'vehicle.state.manual', entityType: 'vehicle', entityId: v.id, before: { state: 'available' }, after: { state: 'service' }, note: 'ТЕСТ' } });

    expect((await rows(owner, `?q=${v.vin}&filter=states`)).map((r) => r.action)).toContain('vehicle.state.manual');
    expect((await rows(owner, `?q=${v.vin}&filter=money`)).map((r) => r.action)).not.toContain('vehicle.state.manual');
    expect((await rows(owner, `?q=${v.vin}&filter=all`)).map((r) => r.action)).toContain('vehicle.state.manual');
  });

  it('a query nobody answers to finds nothing rather than everything', async () => {
    const owner = await loginAs('owner');
    expect(await rows(owner, '?q=R-99999')).toEqual([]);
    expect(await rows(owner, `?q=${encodeURIComponent('нет такого имени ' + uniq())}`)).toEqual([]);
  });

  it('an export is itself a line in the journal', async () => {
    const owner = await loginAs('owner');
    await call(owner, 'GET', '/api/journal.csv?filter=deposits');
    const { prisma } = await import('../src/lib/db.js');
    const row = await prisma.auditLog.findFirst({ where: { action: 'journal.export' }, orderBy: { createdAt: 'desc' } });
    expect(row).not.toBeNull();
  });

  it('a date range answers by its dates', async () => {
    const owner = await loginAs('owner');
    const { prisma } = await import('../src/lib/db.js');
    const c = await prisma.customer.create({ data: { name: `ТЕСТ Даты ${uniq()}` } });
    const old = await prisma.auditLog.create({ data: { action: 'customer.update', entityType: 'customer', entityId: c.id, before: { name: 'a' }, after: { name: 'b' } } });
    await prisma.auditLog.update({ where: { id: old.id }, data: { createdAt: new Date('2026-08-01T10:00:00Z') } });

    expect(await rows(owner, `?q=${encodeURIComponent(c.name)}&from=2026-09-01`)).toEqual([]);
    expect((await rows(owner, `?q=${encodeURIComponent(c.name)}&from=2026-07-01&to=2026-08-31`)).length).toBe(1);
  });
});
