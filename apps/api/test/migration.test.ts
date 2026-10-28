import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

const digits = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

/** A rental Odoo brought over, ended, with a deposit nobody decided. */
async function transferred(status: 'returned' | 'active' = 'returned') {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Migr ${uniq()}`, weeklyRateTetri: 15000, forRent: true } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TESTM${digits().slice(-12).padStart(12, '0')}`, modelId: model.id, pool: 'rent' } });
  const customer = await prisma.customer.create({ data: { name: `ТЕСТ Перенос ${uniq()}` } });
  const rental = await prisma.rental.create({
    data: {
      customerId: customer.id,
      vehicleId: vehicle.id,
      weeklyRateTetri: 15000,
      status,
      pickedUpOn: new Date('2026-05-01'),
      returnedOn: status === 'returned' ? new Date('2026-05-26') : null,
      odooOrderId: Number(digits().slice(-8)),
    },
  });
  const deposit = await prisma.deposit.create({
    data: { rentalId: rental.id, amountTetri: 18000, paidTetri: 18000, status: 'held', notes: 'Перенесено из Odoo 15.09.2026' },
  });
  return { prisma, customer, rental, deposit, vehicle };
}

interface Migration {
  deposits: {
    due: { count: number; amountTetri: number; rows: { id: string; number: string; receivedTetri: number; contractTetri: number }[] };
    running: { count: number; amountTetri: number };
  };
  rentalsWithoutVin: { count: number; rows: { id: string; number: string }[] };
}

describe.skipIf(!HAS_DB)('Settings → Transfer (wave 6 §3.6–3.7)', () => {
  it('shows what the move left, and asks only about deposits whose rental has ended (crit. 23)', async () => {
    const owner = await loginAs('owner');
    const ended = await transferred('returned');
    const running = await transferred('active');

    const m = json<Migration>(await call(owner, 'GET', '/api/migration'));
    expect(m.deposits.due.rows.map((r) => r.id)).toContain(ended.deposit.id);
    // A rental still running holds its deposit for a reason: it is counted
    // apart, not asked about.
    expect(m.deposits.due.rows.map((r) => r.id)).not.toContain(running.deposit.id);
    expect(m.deposits.running.count).toBeGreaterThan(0);
  });

  it('a batch closes them without a payment, a till line or a figure moved (crit. 24)', async () => {
    const owner = await loginAs('owner');
    const a = await transferred();
    const b = await transferred();
    const { prisma } = a;
    const paymentsBefore = await prisma.payment.count();

    const res = await call(owner, 'POST', '/api/migration/deposits', { ids: [a.deposit.id, b.deposit.id], decision: 'returned_earlier', reason: 'по журналу Odoo выдали на руки' });
    expect(res.statusCode).toBe(200);
    expect(json<{ decided: number }>(res).decided).toBe(2);

    expect(await prisma.payment.count()).toBe(paymentsBefore);
    const after = await prisma.deposit.findUniqueOrThrow({ where: { id: a.deposit.id } });
    expect(after.migrationDecision).toBe('returned_earlier');
    expect(after.migrationReason).toBe('по журналу Odoo выдали на руки');
    // Nothing invented: what was received is still what was received.
    expect(after.paidTetri).toBe(18000);
    expect(after.returnedTetri).toBe(0);
    expect(after.withheldTetri).toBe(0);

    // Out of "held": the company is not holding this money today.
    const overview = json<{ totals: { heldTetri: number }; deposits: { number: string; heldTetri: number; live: boolean }[] }>(await call(owner, 'GET', '/api/deposits'));
    const mine = overview.deposits.find((r) => r.number === a.rental.number);
    expect(mine?.heldTetri).toBe(0);
    expect(mine?.live).toBe(false);

    const line = await prisma.auditLog.findFirst({ where: { action: 'deposit.migration.decided', entityId: a.rental.id } });
    expect(line?.note).toBe('по журналу Odoo выдали на руки');
    expect(line?.before).toEqual({ heldTetri: 18000 });
  });

  /**
   * Crit. 25а (designer, 22.09). Odoo knows what the contract asked for and
   * often not what was paid. The screen shows what was received — that is
   * what is being sorted out — and says the other figure beside it only
   * where the two disagree. Which of "нет данных о платеже" and "залог не
   * брали" is true, only Kardu knows, and the system does not guess.
   */
  it('carries both sums, so a screen can say where Odoo knew only the contract', async () => {
    const owner = await loginAs('owner');
    const paid = await transferred();
    const unpaid = await transferred();
    await unpaid.prisma.deposit.update({ where: { id: unpaid.deposit.id }, data: { paidTetri: 0 } });

    const rows = json<Migration>(await call(owner, 'GET', '/api/migration')).deposits.due.rows;
    const a = rows.find((r) => r.id === paid.deposit.id);
    const b = rows.find((r) => r.id === unpaid.deposit.id);
    // Received and asked for agree: the screen shows one figure.
    expect(a?.receivedTetri).toBe(18000);
    expect(a?.contractTetri).toBe(18000);
    // They disagree: both are there, and the screen has something to say.
    expect(b?.receivedTetri).toBe(0);
    expect(b?.contractTetri).toBe(18000);
  });

  it('"kept earlier" without a reason is refused (crit. 25)', async () => {
    const owner = await loginAs('owner');
    const a = await transferred();
    const res = await call(owner, 'POST', '/api/migration/deposits', { ids: [a.deposit.id], decision: 'kept_earlier' });
    expect(res.statusCode).toBe(400);
    expect(json<{ error: string; field?: string }>(res).error).toBe('missing_field');
    const still = await a.prisma.deposit.findUniqueOrThrow({ where: { id: a.deposit.id } });
    expect(still.migrationDecision).toBeNull();
  });

  it('"no data" closes it too, and says so in the journal', async () => {
    const owner = await loginAs('owner');
    const a = await transferred();
    await call(owner, 'POST', '/api/migration/deposits', { ids: [a.deposit.id], decision: 'unknown', reason: 'в Odoo решения нет' });
    const after = await a.prisma.deposit.findUniqueOrThrow({ where: { id: a.deposit.id } });
    expect(after.migrationDecision).toBe('unknown');
    const rows = json<{ deposits: { number: string; segment: string }[] }>(await call(owner, 'GET', '/api/deposits')).deposits;
    expect(rows.find((r) => r.number === a.rental.number)?.segment).toBe('closed');
  });

  it('once decided, a deposit is out of the queue and out of the batch (crit. 26)', async () => {
    const owner = await loginAs('owner');
    const a = await transferred();
    await call(owner, 'POST', '/api/migration/deposits', { ids: [a.deposit.id], decision: 'returned_earlier', reason: 'ТЕСТ' });

    const m = json<Migration>(await call(owner, 'GET', '/api/migration'));
    expect(m.deposits.due.rows.map((r) => r.id)).not.toContain(a.deposit.id);
    const again = await call(owner, 'POST', '/api/migration/deposits', { ids: [a.deposit.id], decision: 'unknown', reason: 'ТЕСТ' });
    expect(again.statusCode).toBe(404);
  });

  // A block of «Ремонты» since issue #18 (B6): it was the third list of this tab.
  it('a moped «in repair» with no repair goes back to the fleet with a reason, from «Ремонты» (crit. 27; issue #18 B6)', async () => {
    const owner = await loginAs('owner');
    const manager = await loginAs('manager');
    const { prisma, vehicle } = await transferred();
    await prisma.vehicle.update({ where: { id: vehicle.id }, data: { state: 'service' } });

    const listed = async (who: string) => json<{ vehicles: { id: string; vin: string }[] }>(await call(who, 'GET', '/api/service/without-repair')).vehicles.map((v) => v.id);
    // Whoever moves a moped by hand reads it — the owner and the manager; a mechanic does not.
    expect(await listed(owner)).toContain(vehicle.id);
    expect(await listed(manager)).toContain(vehicle.id);
    expect((await call(await loginAs('mechanic'), 'GET', '/api/service/without-repair')).statusCode).toBe(403);
    // «До EV8 Ops» no longer carries it.
    expect(json<Record<string, unknown>>(await call(owner, 'GET', '/api/migration'))).not.toHaveProperty('vehiclesInServiceWithoutJob');

    const res = await call(manager, 'POST', `/api/service/without-repair/${vehicle.id}/back`, { reason: 'ТЕСТ ремонта не было' });
    expect(res.statusCode).toBe(200);
    const v = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(v.state).toBe('available');
    const event = await prisma.vehicleEvent.findFirst({ where: { vehicleId: vehicle.id }, orderBy: { createdAt: 'desc' } });
    expect(event?.reason).toBe('ТЕСТ ремонта не было');
    expect(await listed(owner)).not.toContain(vehicle.id);
  });

  // Issue #18 (B6): the tab hides when its two lists are empty; the menu's counts say how much is left.
  it('counts what «До EV8 Ops» still asks — its two lists — for the owner, and for nobody else', async () => {
    const owner = await loginAs('owner');
    const counts = async (who: string) => json<{ migration: number | null }>(await call(who, 'GET', '/api/nav/counts'));
    const a = await transferred();
    const m = json<Migration>(await call(owner, 'GET', '/api/migration'));
    expect(m.deposits.due.rows.map((r) => r.id)).toContain(a.deposit.id);
    // The suites share one database: the count is at least this deposit, and the same number the lists give.
    const { migrationLeft } = await import('../src/routes/migration.js');
    expect((await counts(owner)).migration).toBeGreaterThanOrEqual(1);
    expect(await migrationLeft()).toBeGreaterThanOrEqual(m.deposits.due.count);
    expect((await counts(await loginAs('manager'))).migration).toBeNull();
  });

  /**
   * QA-W6-21. "Сегодня" counted deposit money itself — `status: 'held'` and
   * nothing more — and a deposit closed by a transfer decision keeps that
   * status. Three screens showed one figure and one of them was 3 160 ₾ out.
   * It went eleven rounds unseen because the five deposits sorted in round 5
   * all had `paid_tetri` 0, so "it went down by their sum" came to nothing.
   * This test uses money.
   */
  it('one figure, one function: Today, the week and Deposits agree after a batch (crit. 24)', async () => {
    const owner = await loginAs('owner');
    const a = await transferred();
    const b = await transferred();

    const readAll = async () => {
      const [deposits, today, week] = await Promise.all([
        call(owner, 'GET', '/api/deposits'),
        call(owner, 'GET', '/api/today'),
        call(owner, 'GET', '/api/reports/week'),
      ]);
      return {
        deposits: json<{ totals: { heldTetri: number } }>(deposits).totals.heldTetri,
        today: json<{ numbers: { depositsHeldTetri: number } }>(today).numbers.depositsHeldTetri,
        week: json<{ money: { heldTetri: number } }>(week).money.heldTetri,
      };
    };
    const before = await readAll();
    expect(before.today).toBe(before.deposits);
    expect(before.week).toBe(before.deposits);

    await call(owner, 'POST', '/api/migration/deposits', { ids: [a.deposit.id, b.deposit.id], decision: 'unknown', reason: 'ТЕСТ разбор переноса' });

    const after = await readAll();
    // Two deposits of 180 ₾ each leave "held" — and all three screens say so.
    expect(after.deposits).toBe(before.deposits - 36000);
    expect(after.today).toBe(after.deposits);
    expect(after.week).toBe(after.deposits);
  });

  it('a manager sees none of it', async () => {
    const manager = await loginAs('manager');
    expect((await call(manager, 'GET', '/api/migration')).statusCode).toBe(403);
    expect((await call(manager, 'POST', '/api/migration/deposits', { ids: ['x'], decision: 'unknown', reason: 'no' })).statusCode).toBe(403);
  });
});
