// Rent reminders, step 2 — sent through Kommo (issue #20, ADR-0053; migration
// 0075). Kommo is never called from here: a function stands in for it and
// keeps what was asked of it, so the order «write the sum, read it back, start
// the bot» can be checked. Every customer and deal is invented. Like step 1's
// suite, the tests that need the 1st day overdue stand aside on a Georgian
// Orthodox holiday and the day after one.
import { addDays, isReminderHoliday, todayISO } from '@ev8/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setKommoFetchForTests, type KommoFetch } from '../src/lib/kommo.js';
import { HAS_DB, call, getApp, json, loginAs, uniq } from './helpers.js';

const TOKEN = 'test-kommo-token-that-opens-nothing';
const FIELD = 900001;
const today = () => todayISO(new Date(), 'Asia/Tbilisi');
const quiet = [0, 1].every((i) => !isReminderHoliday(addDays(today(), -i)));

/** Kommo as far as a reminder knows it: the deal fields, a deal, the bot. */
function fakeKommo(opts: { fieldName?: string; fieldId?: number; sticks?: boolean; patchStatus?: number } = {}) {
  const fieldId = opts.fieldId ?? FIELD;
  const values = new Map<string, unknown>();
  const calls: { method: string; path: string; body: unknown }[] = [];
  const answer = (status: number, body: unknown = null) => ({ status, json: async () => body });
  const fetchFn: KommoFetch = async (url, init) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method, path: u.pathname, body });
    if (init.method === 'GET' && u.pathname === '/api/v4/leads/custom_fields') {
      return answer(200, { _embedded: { custom_fields: [{ id: 11, name: 'Budget', type: 'numeric' }, { id: fieldId, name: opts.fieldName ?? 'Amount due', type: 'numeric' }] }, _links: {} });
    }
    const lead = u.pathname.match(/^\/api\/v4\/leads\/(\d+)$/)?.[1];
    if (lead && init.method === 'PATCH') {
      if (opts.patchStatus) return answer(opts.patchStatus);
      if (opts.sticks !== false) values.set(lead, body.custom_fields_values[0].values[0].value);
      return answer(200, { id: Number(lead) });
    }
    if (lead && init.method === 'GET') {
      const v = values.get(lead);
      return answer(200, { id: Number(lead), custom_fields_values: v === undefined ? null : [{ field_id: fieldId, values: [{ value: v }] }] });
    }
    if (init.method === 'POST' && u.pathname === '/api/v2/salesbot/run') return answer(202);
    return answer(404);
  };
  return { fetchFn, calls, values, bots: () => calls.filter((c) => c.path === '/api/v2/salesbot/run').map((c) => c.body) };
}

/** A deal number of its own for each test: digits, as Kommo's are. */
const dealNo = () => String(Date.now()).slice(-9) + String(Math.floor(Math.random() * 1000)).padStart(3, '0');

async function rental(opts: { deal?: string | null; lang?: 'ka' | 'en'; dealOn?: 'rental' | 'customer' } = {}) {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Kommo Remind ${uniq()}`, forRent: true } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TESTK${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id } });
  const deal = opts.deal === undefined ? dealNo() : opts.deal;
  const onCustomer = opts.dealOn === 'customer' && deal;
  const customer = await prisma.customer.create({
    data: { name: `ТЕСТ Отправка ${uniq()}`, phone: '+995 555 00 00 08', messageLang: opts.lang ?? 'ka', kommoRef: onCustomer ? `https://ev8mopeds.kommo.com/leads/detail/${deal}` : null },
  });
  const owner = await loginAs('owner');
  // A week and a day ago, the deposit and the first week paid: the 1st day overdue, 150 owed.
  const { id } = json<{ id: string }>(await call(owner, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, pickedUpOn: addDays(today(), -8) }));
  await call(owner, 'POST', '/api/money', { kind: 'rent', rentalId: id, amountTetri: '330', channel: 'cash' });
  if (deal && !onCustomer) await prisma.rental.update({ where: { id }, data: { kommoRef: deal } });
  return { prisma, owner, rentalId: id, deal };
}

async function job(slot: '12:00' | '18:00', asOf = today()) {
  const { env } = await import('../src/lib/env.js');
  const app = await getApp();
  const res = await app.inject({ method: 'POST', url: '/api/jobs/reminders', headers: { 'x-worker-token': env.WORKER_TOKEN, 'content-type': 'application/json' }, payload: { asOf, slot } });
  return json<{ decided: number; written: number; sendMode: string; held: string | null; sent: number; failed: number }>(res);
}

const BOTS = { 'payment_due.ka': 501, 'payment_due.en': 502, 'overdue_1.ka': 511, 'overdue_1.en': 512, 'overdue_2.ka': 521, 'overdue_2.en': 522 };

async function settings(data: { paused?: boolean; bots?: Record<string, number>; testLeads?: string[] }) {
  const { prisma } = await import('../src/lib/db.js');
  await prisma.reminderSettings.upsert({ where: { id: true }, create: { id: true, ...data }, update: data });
}

beforeEach(async () => {
  if (!HAS_DB) return;
  const { prisma } = await import('../src/lib/db.js');
  await prisma.rental.updateMany({ where: { status: { not: 'returned' } }, data: { status: 'returned' } });
  await settings({ paused: false, bots: BOTS, testLeads: [] });
  process.env.KOMMO_TOKEN = TOKEN;
});

afterEach(async () => {
  delete process.env.KOMMO_TOKEN;
  delete process.env.REMINDERS_SEND;
  setKommoFetchForTests(null);
  if (!HAS_DB) return;
  await settings({ paused: false, bots: {}, testLeads: [] });
});

describe.skipIf(!HAS_DB)('rent reminders through Kommo, step 2 (issue #20, ADR-0053)', () => {
  it.skipIf(!quiet)('on: the sum is written, read back, and only then the bot of the template and language starts', async () => {
    process.env.REMINDERS_SEND = 'on';
    const k = fakeKommo();
    setKommoFetchForTests(k.fetchFn, { gapMs: 0 });
    const { prisma, rentalId, deal } = await rental({ lang: 'en' });
    const out = await job('12:00');
    expect(out).toMatchObject({ sendMode: 'on', held: null });
    expect(out.sent).toBeGreaterThanOrEqual(1);
    const mine = k.calls.filter((c) => c.path.endsWith(`/${deal}`) || (c.path === '/api/v2/salesbot/run' && (c.body as { entity_id: number }[])[0]!.entity_id === Number(deal)));
    expect(mine.map((c) => c.method)).toEqual(['PATCH', 'GET', 'POST']);
    expect(mine[0]!.body).toEqual({ custom_fields_values: [{ field_id: FIELD, values: [{ value: 150 }] }] });
    expect(mine[2]!.body).toEqual([{ bot_id: BOTS['overdue_1.en'], entity_id: Number(deal), entity_type: 2 }]);
    const row = await prisma.rentReminder.findFirstOrThrow({ where: { rentalId } });
    expect(row).toMatchObject({ mode: 'sent', failure: null, leadId: deal, template: 'overdue_1', lang: 'en', amountTetri: 15000 });
    expect(row.sentAt).toBeInstanceOf(Date);
    // The same slot again: written once, sent once.
    const before = k.calls.length;
    await job('12:00');
    expect(k.calls.slice(before).filter((c) => c.method !== 'GET')).toEqual([]);
    expect(await prisma.rentReminder.count({ where: { rentalId } })).toBe(1);
  });

  it.skipIf(!quiet)('a sum that did not stay in the deal starts no bot: an empty field sends the template’s sample', async () => {
    process.env.REMINDERS_SEND = 'on';
    const k = fakeKommo({ sticks: false });
    setKommoFetchForTests(k.fetchFn, { gapMs: 0 });
    const { prisma, rentalId } = await rental();
    await job('12:00');
    expect(k.bots()).toEqual([]);
    expect(await prisma.rentReminder.findFirstOrThrow({ where: { rentalId } })).toMatchObject({ mode: 'failed', failure: 'not_written', sentAt: null });
  });

  it.skipIf(!quiet)('no deal, no bot, no field: each is said, and Kommo is not written to', async () => {
    process.env.REMINDERS_SEND = 'on';
    await settings({ bots: { ...BOTS, 'overdue_1.en': undefined } as unknown as Record<string, number> });
    const k = fakeKommo();
    setKommoFetchForTests(k.fetchFn, { gapMs: 0 });
    const noDeal = await rental({ deal: null });
    const noBot = await rental({ lang: 'en' });
    await job('12:00');
    expect(await noDeal.prisma.rentReminder.findFirstOrThrow({ where: { rentalId: noDeal.rentalId } })).toMatchObject({ mode: 'failed', failure: 'no_deal' });
    expect(await noBot.prisma.rentReminder.findFirstOrThrow({ where: { rentalId: noBot.rentalId } })).toMatchObject({ mode: 'failed', failure: 'no_bot' });
    expect(k.calls.filter((c) => c.method !== 'GET')).toEqual([]);

    const renamed = fakeKommo({ fieldName: 'Сумма' });
    setKommoFetchForTests(renamed.fetchFn, { gapMs: 0 });
    const noField = await rental();
    await job('18:00');
    expect(await noField.prisma.rentReminder.findFirstOrThrow({ where: { rentalId: noField.rentalId } })).toMatchObject({ mode: 'failed', failure: 'no_field' });
    expect(renamed.calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it.skipIf(!quiet)('the field is the account’s «Amount due» by its id, even renamed in Kommo', async () => {
    process.env.REMINDERS_SEND = 'on';
    const k = fakeKommo({ fieldId: 1387297, fieldName: 'Сумма к оплате' });
    setKommoFetchForTests(k.fetchFn, { gapMs: 0 });
    const { prisma, rentalId } = await rental();
    await job('12:00');
    expect(k.calls.find((c) => c.method === 'PATCH')!.body).toEqual({ custom_fields_values: [{ field_id: 1387297, values: [{ value: 150 }] }] });
    expect(await prisma.rentReminder.findFirstOrThrow({ where: { rentalId } })).toMatchObject({ mode: 'sent' });
  });

  it.skipIf(!quiet)('the customer’s deal serves when the rental names none', async () => {
    process.env.REMINDERS_SEND = 'on';
    const k = fakeKommo();
    setKommoFetchForTests(k.fetchFn, { gapMs: 0 });
    const { prisma, rentalId, deal } = await rental({ dealOn: 'customer' });
    await job('12:00');
    expect(await prisma.rentReminder.findFirstOrThrow({ where: { rentalId } })).toMatchObject({ mode: 'sent', leadId: deal });
  });

  it.skipIf(!quiet)('test: only the listed test deals get a message; every other one is a trial', async () => {
    process.env.REMINDERS_SEND = 'test';
    const k = fakeKommo();
    setKommoFetchForTests(k.fetchFn, { gapMs: 0 });
    const listed = await rental();
    const other = await rental();
    await settings({ testLeads: [listed.deal!] });
    await job('12:00');
    expect(await listed.prisma.rentReminder.findFirstOrThrow({ where: { rentalId: listed.rentalId } })).toMatchObject({ mode: 'sent' });
    expect(await other.prisma.rentReminder.findFirstOrThrow({ where: { rentalId: other.rentalId } })).toMatchObject({ mode: 'dry_run', leadId: null });
    expect(k.bots()).toEqual([[{ bot_id: BOTS['overdue_1.ka'], entity_id: Number(listed.deal), entity_type: 2 }]]);
  });

  it.skipIf(!quiet)('paused by an owner, off on the stand, or a run for another day: nothing goes', async () => {
    const k = fakeKommo();
    setKommoFetchForTests(k.fetchFn, { gapMs: 0 });
    process.env.REMINDERS_SEND = 'on';
    await settings({ paused: true });
    const paused = await rental();
    expect(await job('12:00')).toMatchObject({ sendMode: 'on', held: 'paused', sent: 0 });
    expect(await paused.prisma.rentReminder.findFirstOrThrow({ where: { rentalId: paused.rentalId } })).toMatchObject({ mode: 'dry_run' });

    await settings({ paused: false });
    expect(await job('12:00', addDays(today(), -1))).toMatchObject({ held: 'not_today', sent: 0 });

    process.env.REMINDERS_SEND = 'nonsense';
    const off = await rental();
    expect(await job('18:00')).toMatchObject({ sendMode: 'off', sent: 0 });
    expect(await off.prisma.rentReminder.findFirstOrThrow({ where: { rentalId: off.rentalId } })).toMatchObject({ mode: 'dry_run' });
    expect(k.calls).toEqual([]);
  });

  it.skipIf(!quiet)('Kommo refusing the token stops the run: one refusal asked, the rest written as not gone', async () => {
    process.env.REMINDERS_SEND = 'on';
    const k = fakeKommo({ patchStatus: 401 });
    setKommoFetchForTests(k.fetchFn, { gapMs: 0 });
    const a = await rental();
    const b = await rental();
    await job('12:00');
    expect(k.calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
    for (const r of [a, b]) expect(await a.prisma.rentReminder.findFirstOrThrow({ where: { rentalId: r.rentalId } })).toMatchObject({ mode: 'failed', failure: 'unauthorized' });
    expect(k.bots()).toEqual([]);
  });

  it.skipIf(!quiet)('«К звонку» and the rental’s card say what came of it, and when there is no deal', async () => {
    process.env.REMINDERS_SEND = 'on';
    setKommoFetchForTests(fakeKommo().fetchFn, { gapMs: 0 });
    const sent = await rental();
    const bare = await rental({ deal: null });
    await job('12:00');
    const cal = json<{ reminders: Record<string, { today: { mode: string; failure: string | null }[]; deal: boolean }> }>(await call(sent.owner, 'GET', `/api/money/calendar?from=${today()}&to=${today()}`));
    expect(cal.reminders[sent.rentalId]).toMatchObject({ today: [{ mode: 'sent', failure: null }], deal: true });
    expect(cal.reminders[bare.rentalId]).toMatchObject({ today: [{ mode: 'failed', failure: 'no_deal' }], deal: false });
    const card = json<{ rental: { reminders: { sending: string; deal: boolean; recent: { mode: string; failure: string | null }[] } } }>(await call(sent.owner, 'GET', `/api/rentals/${bare.rentalId}`));
    expect(card.rental.reminders).toMatchObject({ sending: 'on', deal: false, recent: [{ mode: 'failed', failure: 'no_deal' }] });
  });

  it('Settings → Reminders: an owner’s; bots are numbers, test deals are deals, every change in the journal', async () => {
    const owner = await loginAs('owner');
    const manager = await loginAs('manager');
    expect((await call(manager, 'GET', '/api/settings/reminders')).statusCode).toBe(403);
    expect((await call(manager, 'PATCH', '/api/settings/reminders', { paused: true })).statusCode).toBe(403);

    const deal = dealNo();
    expect((await call(owner, 'PATCH', '/api/settings/reminders', { bots: { 'payment_due.ka': '777', 'overdue_2.en': '' }, testLeads: `https://ev8mopeds.kommo.com/leads/detail/${deal}, ${deal}` })).statusCode).toBe(200);
    const s = json<{ sendMode: string; kommo: boolean; bots: Record<string, number | null>; testLeads: string[]; amountField: string; paused: boolean }>(await call(owner, 'GET', '/api/settings/reminders'));
    expect(s).toMatchObject({ sendMode: 'off', kommo: true, amountField: 'Amount due', paused: false, testLeads: [deal] });
    expect(s.bots['payment_due.ka']).toBe(777);
    expect(s.bots['overdue_2.en']).toBeNull();
    expect(s.bots['overdue_1.ka']).toBe(BOTS['overdue_1.ka']);

    expect(json<{ error: string; field?: string }>(await call(owner, 'PATCH', '/api/settings/reminders', { bots: { 'payment_due.ka': 'bot seven' } })).error).toBe('bad_field');
    expect(json<{ error: string }>(await call(owner, 'PATCH', '/api/settings/reminders', { bots: { 'payment_due.ru': '5' } })).error).toBe('bad_field');
    expect(json<{ error: string }>(await call(owner, 'PATCH', '/api/settings/reminders', { testLeads: 'not a deal' })).error).toBe('bad_field');
    expect(json<{ error: string }>(await call(owner, 'PATCH', '/api/settings/reminders', { paused: 'yes' })).error).toBe('bad_field');

    const { prisma } = await import('../src/lib/db.js');
    const before = await prisma.auditLog.count({ where: { action: 'settings.reminders' } });
    expect((await call(owner, 'PATCH', '/api/settings/reminders', { paused: true })).statusCode).toBe(200);
    expect((await call(owner, 'PATCH', '/api/settings/reminders', { paused: true })).statusCode).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: 'settings.reminders' } })).toBe(before + 1);
  });
});
