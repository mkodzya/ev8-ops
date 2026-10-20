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
      // Wave 5 moved the orders onto a purchases scope of their own; what is
      // left here is the settings and the people.
      'DELETE /api/settings/rates/:id',
      // ADR-0033: the PIN of the workshop tablet and the tablet itself are an owner's to give and take.
      'DELETE /api/users/:id/pin',
      // The rentals folders in Drive beside the rentals here (ADR-0031): an owner's list.
      'GET /api/drive/folders/:id/prefill',
      'GET /api/drive/reconciliation',
      // Wave 6: the journal and its export are an owner's (§3.8).
      'GET /api/journal',
      'GET /api/journal.csv',
      // Where Kommo and the rentals here disagree (ADR-0012): an owner's list.
      'GET /api/kommo/reconciliation',
      // Wave 6: what the transfer left, and the batch that sorts it (§3.6).
      'GET /api/migration',
      'GET /api/settings/login',
      'GET /api/users',
      'GET /api/workshop/devices',
      // What money going out was for: the owner keeps the categories (migration 0046).
      'PATCH /api/expense-categories/:id',
      'PATCH /api/fleet/:id',
      'PATCH /api/fleet/:id/vin',
      'PATCH /api/locations/:id',
      'PATCH /api/models/:id',
      // Wave 6: the deposit and the weekly rates are an owner's to set (R5).
      'PATCH /api/settings/rental',
      'PATCH /api/settings/sticker',
      'PATCH /api/users/:id',
      'PATCH /api/workshops/:id',
      'POST /api/customers/:id/merge',
      'POST /api/drive/scan',
      'POST /api/expense-categories',
      'POST /api/fleet',
      'POST /api/locations',
      'POST /api/models',
      'POST /api/settings/rates',
      'POST /api/users',
      'POST /api/users/:id/password',
      'POST /api/users/:id/pin',
      'POST /api/users/:id/sessions/close',
      'POST /api/workshop/devices',
      'POST /api/workshop/devices/:id/revoke',
      'POST /api/workshops',
    ]);
    const publicOnes = app.routeTable.filter((r) => r.scope === 'public').map((r) => r.url).sort();
    // The jobs are public to the session guard and closed by the worker token (routes/jobs.ts).
    // The PIN sign-in and the tablet's list of names are closed by the tablet's own token (ADR-0033).
    expect(publicOnes).toEqual(['/api/auth/login', '/api/auth/pin', '/api/health', '/api/jobs/bog-night', '/api/jobs/bog-today', '/api/jobs/drive-scan', '/api/jobs/kommo-sync', '/api/jobs/roll-periods', '/api/jobs/tbc-night', '/api/jobs/tbc-today', '/api/site/queue', '/api/workshop/tablet']);
  });
});

describe.skipIf(!HAS_DB)('who may read what', () => {
  it('nobody reads the fleet without a session', async () => {
    expect((await call(null, 'GET', '/api/fleet')).statusCode).toBe(401);
  });

  it('both roles may read the fleet', async () => {
    for (const role of ['owner', 'manager'] as const) {
      const cookie = await loginAs(role);
      const res = await call(cookie, 'GET', '/api/fleet');
      expect(res.statusCode, role).toBe(200);
      expect(json<{ byState: Record<string, number> }>(res).byState).toHaveProperty('available');
    }
  });

  it('nobody gets a personal number with the card; an owner asks for it and a manager may not (CST-03, Q27)', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const personalId = `T${Date.now()}`;
    const c = await prisma.customer.create({ data: { name: 'Guard Probe', personalId } });

    const manager = await loginAs('manager');
    const asManager = json<{ customer: { personalId: string }; personalIdAvailable: boolean }>(await call(manager, 'GET', `/api/customers/${c.id}`));
    expect(asManager.customer.personalId).toBe('••••');
    expect(asManager.personalIdAvailable).toBe(false);
    expect((await call(manager, 'GET', `/api/customers/${c.id}/personal-id`)).statusCode).toBe(403);

    // The card no longer carries the number for an owner either: the number
    // is asked for, and the asking is written down.
    const owner = await loginAs('owner');
    const asOwner = json<{ customer: { personalId: string }; personalIdAvailable: boolean }>(await call(owner, 'GET', `/api/customers/${c.id}`));
    expect(asOwner.customer.personalId).toBe('••••');
    expect(asOwner.personalIdAvailable).toBe(true);
    const shown = json<{ personalId: string }>(await call(owner, 'GET', `/api/customers/${c.id}/personal-id`));
    expect(shown.personalId).toBe(personalId);
  });

  it('the summary answers any signed-in role', async () => {
    const cookie = await loginAs('manager');
    const res = await call(cookie, 'GET', '/api/summary');
    expect(res.statusCode).toBe(200);
    const body = json<{ fleet: Record<string, number>; rentals: { active: number; overdue: number } }>(res);
    expect(Object.keys(body.fleet).sort()).toEqual(['available', 'out', 'rented', 'service', 'sold']);
  });
});
