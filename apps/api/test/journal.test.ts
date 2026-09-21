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
    expect(csv.body.split('\n').filter((l) => l.includes('customer.personalId.view'))).toHaveLength(3);
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
