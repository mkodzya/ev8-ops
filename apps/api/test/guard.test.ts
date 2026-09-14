// Rights come from the role (spec §3). Every route carries a scope, and the
// route table is swept so that a route nobody thought about is owner-only
// rather than open.
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, getApp, json, loginAs } from './helpers.js';

describe('route table', () => {
  it('declares a scope on every route, and none is left at the default by accident', async () => {
    process.env.ALLOW_DEV_SECRET = 'true';
    const app = await getApp();
    expect(app.routeTable.length).toBeGreaterThan(5);
    // The default is owner-only rather than open, which makes a forgotten
    // scope safe but silent. This is the part that stops being silent: a
    // route that declares nothing is named here by method and path.
    const undeclared = app.routeTable.filter((r) => !r.declared).map((r) => `${r.method} ${r.url}`);
    expect(undeclared).toEqual([]);
    const ownerOnly = app.routeTable.filter((r) => r.scope === 'users.manage' || r.scope === 'settings.manage');
    // Owner-only routes are listed here on purpose: a new one that lands at
    // the default scope by accident shows up in this list and is questioned.
    expect(ownerOnly.map((r) => `${r.method} ${r.url}`).sort()).toEqual([
      'DELETE /api/purchases/:id/lines/:lineId',
      'GET /api/users',
      'PATCH /api/fleet/:id',
      'PATCH /api/models/:id',
      'PATCH /api/purchases/:id',
      'PATCH /api/users/:id',
      'POST /api/fleet',
      'POST /api/models',
      'POST /api/purchases',
      'POST /api/purchases/:id/cancel',
      'POST /api/purchases/:id/lines',
      'POST /api/purchases/:id/receive',
      'POST /api/users',
      'POST /api/users/:id/password',
    ]);
    const publicOnes = app.routeTable.filter((r) => r.scope === 'public').map((r) => r.url).sort();
    expect(publicOnes).toEqual(['/api/auth/login', '/api/health', '/api/jobs/roll-periods']);
  });
});

describe.skipIf(!HAS_DB)('who may read what', () => {
  it('nobody reads the fleet without a session', async () => {
    expect((await call(null, 'GET', '/api/fleet')).statusCode).toBe(401);
  });

  it('a manager, a mechanic and an accountant may read the fleet', async () => {
    for (const role of ['manager', 'mechanic', 'accountant'] as const) {
      const cookie = await loginAs(role);
      const res = await call(cookie, 'GET', '/api/fleet');
      expect(res.statusCode, role).toBe(200);
      expect(json<{ byState: Record<string, number> }>(res).byState).toHaveProperty('available');
    }
  });

  it('a manager sees that a personal number exists but not the number (CST-03)', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const personalId = `T${Date.now()}`;
    const c = await prisma.customer.create({ data: { name: 'Guard Probe', personalId } });

    const manager = await loginAs('manager');
    const asManager = json<{ customer: { personalId: string } }>(await call(manager, 'GET', `/api/customers/${c.id}`));
    expect(asManager.customer.personalId).toBe('••••');

    const director = await loginAs('director');
    const asDirector = json<{ customer: { personalId: string } }>(await call(director, 'GET', `/api/customers/${c.id}`));
    expect(asDirector.customer.personalId).toBe(personalId);
  });

  it('the summary answers any signed-in role', async () => {
    const cookie = await loginAs('accountant');
    const res = await call(cookie, 'GET', '/api/summary');
    expect(res.statusCode).toBe(200);
    const body = json<{ fleet: Record<string, number>; rentals: { active: number; overdue: number } }>(res);
    expect(Object.keys(body.fleet).sort()).toEqual(['available', 'out', 'rented', 'service', 'sold']);
  });
});
