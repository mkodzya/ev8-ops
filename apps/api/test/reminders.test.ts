// Rent reminders on a schedule, step 1 — decided and written, sent nowhere
// (issue #20 of the director, ADR-0052; migration 0074). Every customer here
// is invented. The rule counts days that send, so a run on a Georgian
// Orthodox holiday, or the day after one, proves another case: those tests
// stand aside on such days rather than assert a chain the holiday moved.
import { addDays, isReminderHoliday, todayISO } from '@ev8/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { HAS_DB, call, getApp, json, loginAs, uniq } from './helpers.js';

const today = () => todayISO(new Date(), 'Asia/Tbilisi');
const quietDays = (n: number) => Array.from({ length: n + 1 }, (_, i) => addDays(today(), -i)).every((d) => !isReminderHoliday(d));

beforeEach(async () => {
  if (!HAS_DB) return;
  const { prisma } = await import('../src/lib/db.js');
  // Other suites' rentals would be reminded too; each test counts only its own rental's rows anyway.
  await prisma.rental.updateMany({ where: { status: { not: 'returned' } }, data: { status: 'returned' } });
});

async function rental(opts: { pickedUpOn: string; paid?: string; lang?: 'ka' | 'ru' | 'en' }) {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Remind ${uniq()}`, forRent: true } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TESTM${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id } });
  const customer = await prisma.customer.create({ data: { name: `Тест Напоминание ${uniq()}`, phone: '+995 555 00 00 09', messageLang: opts.lang ?? 'ka' } });
  const owner = await loginAs('owner');
  const { id } = json<{ id: string }>(await call(owner, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, pickedUpOn: opts.pickedUpOn }));
  if (opts.paid) await call(owner, 'POST', '/api/money', { kind: 'rent', rentalId: id, amountTetri: opts.paid, channel: 'cash' });
  return { prisma, owner, rentalId: id, customerId: customer.id };
}

async function job(slot: '12:00' | '18:00') {
  const { env } = await import('../src/lib/env.js');
  const app = await getApp();
  const res = await app.inject({ method: 'POST', url: '/api/jobs/reminders', headers: { 'x-worker-token': env.WORKER_TOKEN, 'content-type': 'application/json' }, payload: { asOf: today(), slot } });
  return json<{ decided: number; written: number; mode: string; slot: string }>(res);
}

describe.skipIf(!HAS_DB)('rent reminders, step 1 (issue #20)', () => {
  it.skipIf(!quietDays(0))('the due day: one reminder at noon, written as not sent, none at six', async () => {
    // A week ago, the deposit and the first week paid: the second week is due today.
    const { prisma, rentalId } = await rental({ pickedUpOn: addDays(today(), -7), paid: '330' });
    const noon = await job('12:00');
    expect(noon.mode).toBe('dry_run');
    const rows = await prisma.rentReminder.findMany({ where: { rentalId } });
    expect(rows).toEqual([expect.objectContaining({ slot: '12:00', template: 'payment_due', lang: 'ka', amountTetri: 15000, mode: 'dry_run' })]);
    await job('18:00');
    expect(await prisma.rentReminder.count({ where: { rentalId } })).toBe(1);
  });

  it.skipIf(!quietDays(1))('the 1st day overdue: noon and six — and nothing at six once he paid in between', async () => {
    const late = await rental({ pickedUpOn: addDays(today(), -8), paid: '330' });
    const payer = await rental({ pickedUpOn: addDays(today(), -8), paid: '330' });
    await job('12:00');
    for (const r of [late, payer]) {
      expect(await late.prisma.rentReminder.findMany({ where: { rentalId: r.rentalId } })).toEqual([expect.objectContaining({ slot: '12:00', template: 'overdue_1', amountTetri: 15000 })]);
    }
    // One pays the week between noon and six.
    await call(payer.owner, 'POST', '/api/money', { kind: 'rent', rentalId: payer.rentalId, amountTetri: '150', channel: 'cash' });
    await job('18:00');
    expect((await late.prisma.rentReminder.findMany({ where: { rentalId: late.rentalId }, orderBy: { slot: 'asc' } })).map((x) => [x.slot, x.template])).toEqual([
      ['12:00', 'overdue_1'],
      ['18:00', 'overdue_1'],
    ]);
    expect(await late.prisma.rentReminder.count({ where: { rentalId: payer.rentalId } })).toBe(1);
  });

  it.skipIf(!quietDays(2))('the 2nd day warns; the 3rd sends nothing by itself', async () => {
    const second = await rental({ pickedUpOn: addDays(today(), -9), paid: '330' });
    const third = await rental({ pickedUpOn: addDays(today(), -10), paid: '330' });
    await job('12:00');
    expect((await second.prisma.rentReminder.findFirstOrThrow({ where: { rentalId: second.rentalId } })).template).toBe('overdue_2');
    expect(await second.prisma.rentReminder.count({ where: { rentalId: third.rentalId } })).toBe(0);
  });

  it.skipIf(!quietDays(1))('a second run of a slot writes nothing more; the language is the card’s, Russian in English', async () => {
    const { prisma, rentalId } = await rental({ pickedUpOn: addDays(today(), -8), paid: '330', lang: 'ru' });
    await job('12:00');
    const again = await job('12:00');
    expect(await prisma.rentReminder.count({ where: { rentalId } })).toBe(1);
    expect((await prisma.rentReminder.findFirstOrThrow({ where: { rentalId } })).lang).toBe('en');
    expect(again.written).toBeLessThanOrEqual(again.decided);
  });

  it('none on the hand-over day', async () => {
    const { prisma, rentalId } = await rental({ pickedUpOn: today() });
    await job('12:00');
    expect(await prisma.rentReminder.count({ where: { rentalId } })).toBe(0);
  });

  it.skipIf(!quietDays(1))('switched off with a reason, by whoever calls by the schedule; on again, it writes', async () => {
    const { prisma, owner, rentalId } = await rental({ pickedUpOn: addDays(today(), -8), paid: '330' });
    const manager = await loginAs('manager');
    const bare = await call(manager, 'POST', `/api/rentals/${rentalId}/reminders`, { off: true });
    expect(json<{ error: string }>(bare).error).toBe('missing_field');
    expect((await call(manager, 'POST', `/api/rentals/${rentalId}/reminders`, { off: true, reason: 'pays the director by hand' })).statusCode).toBe(200);
    await job('12:00');
    expect(await prisma.rentReminder.count({ where: { rentalId } })).toBe(0);
    const card = json<{ rental: { reminders: { off: { reason: string; by: string | null } | null } } }>(await call(owner, 'GET', `/api/rentals/${rentalId}`));
    expect(card.rental.reminders.off).toMatchObject({ reason: 'pays the director by hand' });
    expect(card.rental.reminders.off?.by).toBeTruthy();
    expect((await call(owner, 'POST', `/api/rentals/${rentalId}/reminders`, { off: false })).statusCode).toBe(200);
    await job('18:00');
    expect(await prisma.rentReminder.count({ where: { rentalId } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: rentalId, action: { in: ['rental.reminders.off', 'rental.reminders.on'] } } })).toBe(2);
  });

  it.skipIf(!quietDays(1))('«К звонку» says today’s reminders and «пора звонить»; «Сегодня» counts whom to call', async () => {
    const { owner, rentalId } = await rental({ pickedUpOn: addDays(today(), -8), paid: '330' });
    await job('12:00');
    const cal = json<{ reminders: Record<string, { today: { slot: string; template: string; mode: string }[]; call: boolean; off: string | null }> }>(
      await call(owner, 'GET', `/api/money/calendar?from=${today()}&to=${today()}`),
    );
    expect(cal.reminders[rentalId]).toEqual({ today: [{ slot: '12:00', template: 'overdue_1', mode: 'dry_run' }], call: true, off: null });
    const manager = await loginAs('manager');
    const sched = json<{ reminders: Record<string, { call: boolean }> }>(await call(manager, 'GET', `/api/money/calendar?from=${today()}&to=${today()}`));
    expect(sched.reminders[rentalId]?.call).toBe(true);
    const day = json<{ queue: { group: string; rows: { note: string | null }[] }[] }>(await call(owner, 'GET', '/api/today'));
    const line = day.queue.find((g) => g.group === 'schedule')!.rows[0]!;
    expect(Number(line.note!.split('|')[2])).toBeGreaterThanOrEqual(1);
  });

  it('the clock’s door is the worker’s; the switch is not a mechanic’s', async () => {
    const app = await getApp();
    expect((await app.inject({ method: 'POST', url: '/api/jobs/reminders', headers: { 'x-worker-token': 'not-it' } })).statusCode).toBe(401);
    const { rentalId } = await rental({ pickedUpOn: addDays(today(), -8), paid: '330' });
    const mechanic = await loginAs('mechanic');
    expect((await call(mechanic, 'POST', `/api/rentals/${rentalId}/reminders`, { off: true, reason: 'x' })).statusCode).toBe(403);
  });

  it('a customer’s card keeps the language his messages go in', async () => {
    const owner = await loginAs('owner');
    const made = json<{ id: string }>(await call(owner, 'POST', '/api/customers', { name: `Тест Язык ${uniq()}`, messageLang: 'en' }));
    expect(json<{ customer: { messageLang: string } }>(await call(owner, 'GET', `/api/customers/${made.id}`)).customer.messageLang).toBe('en');
    expect((await call(owner, 'PATCH', `/api/customers/${made.id}`, { messageLang: 'ka' })).statusCode).toBe(200);
    expect(json<{ customer: { messageLang: string } }>(await call(owner, 'GET', `/api/customers/${made.id}`)).customer.messageLang).toBe('ka');
    expect(json<{ error: string }>(await call(owner, 'PATCH', `/api/customers/${made.id}`, { messageLang: 'de' })).error).toBe('bad_field');
  });
});
