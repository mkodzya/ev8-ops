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
      'PATCH /api/income-categories/:id',
      'PATCH /api/locations/:id',
      'PATCH /api/models/:id',
      // Wave 6: the deposit and the weekly rates are an owner's to set (R5).
      'PATCH /api/settings/rental',
      // Stage 6: the company rate and the planned maintenance are an owner's to set (ADR-0038 §3).
      'PATCH /api/settings/service',
      'PATCH /api/settings/sticker',
      'PATCH /api/users/:id',
      'PATCH /api/workshops/:id',
      'POST /api/customers/:id/merge',
      // «Это не возврат» on a Drive return row (issue #19, ADR-0034 addendum): Drive is an owner's.
      'POST /api/drive/returns/:rentalId/not-return',
      'POST /api/drive/scan',
      'POST /api/expense-categories',
      'POST /api/fleet',
      'POST /api/income-categories',
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
    // Moving a renter's latest week was an owner's (deposit.decide, ADR-0041); since Mika's «А» of
    // 23.10.2026 (issue #12) it has a right of its own that a manager has too — this route and no other.
    const weekShift = app.routeTable.filter((r) => r.scope === 'rental.week.shift').map((r) => `${r.method} ${r.url}`);
    expect(weekShift).toEqual(['POST /api/rentals/:id/weeks/:seq/shift']);
    // «Разобрать» for the customers' money is a manager's too since issue #15 (ADR-0048): these routes
    // and no other. Each refuses him, with words, every answer that is not the customers' money.
    const sortCustomer = app.routeTable.filter((r) => r.scope === 'payments.sort.customer').map((r) => `${r.method} ${r.url}`).sort();
    expect(sortCustomer).toEqual([
      'GET /api/statement-lines',
      'GET /api/statement-lines/:id/options',
      'POST /api/statement-lines/:id/assign',
      'POST /api/statement-lines/:id/link',
      'POST /api/statement-lines/:id/split',
      'POST /api/statement-lines/:id/unlink',
    ]);
    // Everything else of the queue stays an owner's by its scope: no manager reaches it at all.
    const reconcile = app.routeTable.filter((r) => r.scope === 'payments.reconcile').map((r) => `${r.method} ${r.url}`);
    for (const owners of [
      'GET /api/statement-lines/by-rules',
      'GET /api/statement-lines/aside',
      'GET /api/statements',
      'GET /api/income-categories',
      'POST /api/statement-lines/:id/ignore',
      'POST /api/statement-lines/:id/expense',
      'POST /api/statement-lines/:id/expense-split',
      'POST /api/statement-lines/:id/own-transfer',
      'POST /api/statement-lines/:id/founder-equity',
      'POST /api/statement-lines/:id/other-income',
      'POST /api/statement-lines/:id/shareholder',
      'POST /api/statement-lines/:id/bank-deposit',
      'POST /api/statement-lines/:id/pay-out',
      'POST /api/statement-lines/:id/restore',
      // «Это дубль» (issue #16) sets a line aside, as «Это не наше» does: an owner's.
      'POST /api/statement-lines/:id/duplicate',
      'POST /api/payer-rules/:id/forget',
      'POST /api/payer-rules/:id/undo',
    ]) {
      expect(reconcile, owners).toContain(owners);
    }
    // «Оплаты по графику»: one route, the rows for whoever calls, the sums only with `payments.view` (issue #15).
    expect(app.routeTable.filter((r) => r.scope === 'payments.schedule').map((r) => `${r.method} ${r.url}`)).toEqual(['GET /api/money/calendar']);
    const publicOnes = app.routeTable.filter((r) => r.scope === 'public').map((r) => r.url).sort();
    // The jobs are public to the session guard and closed by the worker token (routes/jobs.ts).
    // The PIN sign-in and the tablet's list of names are closed by the tablet's own token (ADR-0033).
    expect(publicOnes).toEqual(['/api/auth/login', '/api/auth/pin', '/api/health', '/api/jobs/bog-night', '/api/jobs/bog-today', '/api/jobs/drive-scan', '/api/jobs/kommo-sync', '/api/jobs/notices', '/api/jobs/notices-scan', '/api/jobs/roll-periods', '/api/jobs/tbc-night', '/api/jobs/tbc-today', '/api/jobs/translate', '/api/site/queue', '/api/workshop/tablet']);
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
