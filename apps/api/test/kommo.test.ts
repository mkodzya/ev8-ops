// The Kommo link, step 1 (ADR-0012): read, keep, compare. Kommo itself is
// never called from here — a function stands in for it, so these run with no
// network and no token that opens anything.
import { addDays, todayISO } from '@ev8/shared';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KommoClient, KommoError, kommoConfig, kommoReconciliation, setKommoFetchForTests, syncKommo, type KommoFetch } from '../src/lib/kommo.js';
import { HAS_DB, call, getApp, json, loginAs, uniq } from './helpers.js';

const TOKEN = 'test-kommo-token-that-opens-nothing';
const PIPELINE = 13427775;
const RENTED = 103582579;
const BOOKING = 107998668;
const SALES = 11266343;
const WON = 142;

interface FakeLead {
  id: number;
  name: string;
  contactId?: number;
  status_id?: number;
  pipeline_id?: number;
  /** Unix seconds, as Kommo gives it for a closed deal. */
  closed_at?: number;
}
type FakeContact = string | { name: string; phone?: string };

/** Kommo as far as this link knows it: two addresses, pages of 250, 204 for "nothing". */
function fakeKommo(state: { leads: FakeLead[]; contacts?: Record<number, FakeContact>; status?: number; contactsStatus?: number }) {
  const calls: { url: URL; auth: string }[] = [];
  const nothing = { status: 204, json: async () => Promise.reject(new Error('a 204 has no body')) };
  const fetchFn: KommoFetch = async (url, init) => {
    const u = new URL(url);
    calls.push({ url: u, auth: init.headers.authorization ?? '' });
    if (state.status) return { status: state.status, json: async () => ({ title: 'Unauthorized', detail: 'ТЕСТ Тайна' }) };
    if (u.pathname === '/api/v4/leads') {
      const limit = Number(u.searchParams.get('limit'));
      const page = Number(u.searchParams.get('page'));
      const slice = state.leads.slice((page - 1) * limit, page * limit);
      if (slice.length === 0) return nothing;
      const more = state.leads.length > page * limit;
      return {
        status: 200,
        json: async () => ({
          _page: page,
          _links: { self: { href: url }, ...(more ? { next: { href: `${url}&next` } } : {}) },
          _embedded: {
            leads: slice.map((l) => ({
              id: l.id,
              name: l.name,
              status_id: l.status_id ?? RENTED,
              pipeline_id: l.pipeline_id ?? PIPELINE,
              closed_at: l.closed_at ?? null,
              _embedded: { contacts: l.contactId ? [{ id: l.contactId, is_main: true }] : [] },
            })),
          },
        }),
      };
    }
    if (u.pathname === '/api/v4/contacts') {
      if (state.contactsStatus) return { status: state.contactsStatus, json: async () => ({}) };
      const ids = [...u.searchParams.entries()].filter(([k]) => k.startsWith('filter[id]')).map(([, v]) => Number(v));
      const rows = ids
        .filter((id) => state.contacts?.[id])
        .map((id) => {
          const c = state.contacts![id]!;
          const phone = typeof c === 'string' ? undefined : c.phone;
          return {
            id,
            name: typeof c === 'string' ? c : c.name,
            // The way Kommo gives a phone: one field of several values, among other fields.
            custom_fields_values: phone ? [{ field_code: 'EMAIL', values: [{ value: 'test@ev8.test' }] }, { field_code: 'PHONE', values: [{ value: phone, enum_code: 'WORK' }, { value: '+995 599 00 00 00', enum_code: 'MOB' }] }] : null,
          };
        });
      return rows.length ? { status: 200, json: async () => ({ _embedded: { contacts: rows } }) } : nothing;
    }
    return { status: 404, json: async () => ({}) };
  };
  return { fetchFn, calls };
}

const cfg = () => kommoConfig({ KOMMO_TOKEN: TOKEN })!;
const client = (k: ReturnType<typeof fakeKommo>) => new KommoClient(cfg(), { fetch: k.fetchFn, gapMs: 0 });

describe('the Kommo settings', () => {
  it('are off without a token', () => {
    expect(kommoConfig({})).toBeNull();
    expect(kommoConfig({ KOMMO_TOKEN: '   ' })).toBeNull();
  });

  it('point at the company’s account and its rented stage unless told otherwise', () => {
    expect(kommoConfig({ KOMMO_TOKEN: TOKEN })).toMatchObject({ baseUrl: 'https://ev8mopeds.kommo.com', pipelineId: PIPELINE, rentedStatusId: RENTED, staleMs: 20 * 60_000 });
    expect(kommoConfig({ KOMMO_TOKEN: TOKEN, KOMMO_BASE_URL: 'https://other.kommo.com/', KOMMO_RENTED_STATUS_ID: '7', KOMMO_RENTAL_PIPELINE_ID: '' })).toMatchObject({
      baseUrl: 'https://other.kommo.com',
      pipelineId: PIPELINE,
      rentedStatusId: 7,
    });
  });

  it('are off rather than send the token over plain http or to a path', () => {
    expect(kommoConfig({ KOMMO_TOKEN: TOKEN, KOMMO_BASE_URL: 'http://ev8mopeds.kommo.com' })).toBeNull();
    expect(kommoConfig({ KOMMO_TOKEN: TOKEN, KOMMO_BASE_URL: 'https://ev8mopeds.kommo.com/api' })).toBeNull();
  });
});

describe('reading the rented stage', () => {
  it('asks for that pipeline and that stage, 250 a page, with the token in the header and not in the address', async () => {
    const k = fakeKommo({ leads: [{ id: 1, name: 'ТЕСТ Сделка 1' }] });
    await client(k).rentedLeads();
    const first = k.calls[0]!;
    expect(first.url.origin + first.url.pathname).toBe('https://ev8mopeds.kommo.com/api/v4/leads');
    expect(first.url.searchParams.get('filter[statuses][0][pipeline_id]')).toBe(String(PIPELINE));
    expect(first.url.searchParams.get('filter[statuses][0][status_id]')).toBe(String(RENTED));
    expect(first.url.searchParams.get('limit')).toBe('250');
    expect(first.url.searchParams.get('with')).toBe('contacts');
    expect(first.auth).toBe(`Bearer ${TOKEN}`);
    expect(k.calls.every((c) => !c.url.href.includes(TOKEN))).toBe(true);
  });

  it('follows the pages past the 250 Kommo gives at once', async () => {
    const leads = Array.from({ length: 503 }, (_, i) => ({ id: 1000 + i, name: `ТЕСТ Сделка ${i}` }));
    const k = fakeKommo({ leads });
    const seen = await client(k).rentedLeads();
    expect(seen.leads).toHaveLength(503);
    expect(new Set(seen.leads.map((l) => l.id)).size).toBe(503);
    expect(k.calls.filter((c) => c.url.pathname === '/api/v4/leads').map((c) => c.url.searchParams.get('page'))).toEqual(['1', '2', '3']);
  });

  it('reads 204 as “nobody rents”, not as a failure', async () => {
    const k = fakeKommo({ leads: [] });
    expect(await client(k).rentedLeads()).toEqual({ leads: [], contactsRead: true });
    expect(k.calls).toHaveLength(1);
  });

  it('gives each deal the name of its main contact, asked for in one request', async () => {
    const k = fakeKommo({
      leads: [
        { id: 1, name: 'ТЕСТ Сделка 1', contactId: 11 },
        { id: 2, name: 'ТЕСТ Сделка 2', contactId: 12 },
        { id: 3, name: 'ТЕСТ Сделка 3' },
      ],
      contacts: { 11: 'ТЕСТ Контакт А', 12: { name: 'ТЕСТ Контакт Б', phone: ' 595 11 22 33 ' } },
    });
    const seen = await client(k).rentedLeads();
    expect(seen).toEqual({
      leads: [
        { id: '1', name: 'ТЕСТ Сделка 1', contactName: 'ТЕСТ Контакт А', contactPhone: null, closedAt: null },
        { id: '2', name: 'ТЕСТ Сделка 2', contactName: 'ТЕСТ Контакт Б', contactPhone: '595 11 22 33', closedAt: null },
        { id: '3', name: 'ТЕСТ Сделка 3', contactName: null, contactPhone: null, closedAt: null },
      ],
      contactsRead: true,
    });
    expect(k.calls.filter((c) => c.url.pathname === '/api/v4/contacts')).toHaveLength(1);
  });

  it('keeps the deals when the names do not come, and says so', async () => {
    const k = fakeKommo({ leads: [{ id: 1, name: 'ТЕСТ Сделка 1', contactId: 11 }], contactsStatus: 400 });
    expect(await client(k).rentedLeads()).toEqual({ leads: [{ id: '1', name: 'ТЕСТ Сделка 1', contactName: null, contactPhone: null, closedAt: null }], contactsRead: false });
  });

  it('drops a deal of another stage, should Kommo ignore the filter', async () => {
    const k = fakeKommo({
      leads: [
        { id: 1, name: 'ТЕСТ Арендует' },
        { id: 2, name: 'ТЕСТ Бронь', status_id: BOOKING },
        { id: 3, name: 'ТЕСТ Другая воронка', pipeline_id: 1 },
      ],
    });
    expect((await client(k).rentedLeads()).leads.map((l) => l.id)).toEqual(['1']);
  });

  it('reads the sales won since a moment: asked of Kommo by the closing date, and checked again here', async () => {
    const since = new Date('2026-10-08T06:00:00Z');
    const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);
    const k = fakeKommo({
      leads: [
        { id: 1, name: 'ТЕСТ Продано сегодня', status_id: WON, pipeline_id: SALES, closed_at: unix('2026-10-08T09:00:00Z'), contactId: 21 },
        // Kommo ignoring the date filter must not bring last year's sales in as today's.
        { id: 2, name: 'ТЕСТ Продано в прошлом году', status_id: WON, pipeline_id: SALES, closed_at: unix('2025-06-22T09:00:00Z') },
        { id: 3, name: 'ТЕСТ Закрыта аренда', status_id: WON, pipeline_id: PIPELINE, closed_at: unix('2026-10-08T09:00:00Z') },
        { id: 4, name: 'ТЕСТ Ещё думает', status_id: 87657659, pipeline_id: SALES },
      ],
      contacts: { 21: { name: 'ТЕСТ Покупатель', phone: '+995 595 44 55 66' } },
    });
    const seen = await client(k).wonSales(since);
    expect(seen).toEqual({ leads: [{ id: '1', name: 'ТЕСТ Продано сегодня', contactName: 'ТЕСТ Покупатель', contactPhone: '+995 595 44 55 66', closedAt: new Date('2026-10-08T09:00:00Z') }], contactsRead: true });
    const asked = k.calls[0]!.url.searchParams;
    expect(asked.get('filter[statuses][0][pipeline_id]')).toBe(String(SALES));
    expect(asked.get('filter[statuses][0][status_id]')).toBe(String(WON));
    expect(asked.get('filter[closed_at][from]')).toBe(String(unix('2026-10-08T06:00:00Z')));
  });

  it('turns an expired token into “unauthorized”, with nothing of Kommo’s answer or of the token in it', async () => {
    const k = fakeKommo({ leads: [], status: 401 });
    const err = await client(k)
      .rentedLeads()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KommoError);
    expect(err).toMatchObject({ failure: 'unauthorized', httpStatus: 401 });
    expect(String((err as Error).message)).not.toContain(TOKEN);
    expect(String((err as Error).message)).not.toContain('ТЕСТ');
  });

  it('names a refusal for too many requests, a broken answer and a dead line each by its own word', async () => {
    expect(await client(fakeKommo({ leads: [], status: 429 })).rentedLeads().catch((e: KommoError) => e.failure)).toBe('rate_limited');
    expect(await client(fakeKommo({ leads: [], status: 502 })).rentedLeads().catch((e: KommoError) => e.failure)).toBe('http');
    const dead = new KommoClient(cfg(), { fetch: async () => Promise.reject(new Error(`connect ECONNREFUSED with ${TOKEN}`)), gapMs: 0 });
    const err = (await dead.rentedLeads().catch((e: unknown) => e)) as KommoError;
    expect(err.failure).toBe('network');
    expect(err.message).not.toContain(TOKEN);
    const garbled = new KommoClient(cfg(), { fetch: async () => ({ status: 200, json: async () => ({ _embedded: {} }) }), gapMs: 0 });
    expect(await garbled.rentedLeads().catch((e: KommoError) => e.failure)).toBe('bad_answer');
  });

  it('keeps under seven requests a second: each one waits out the gap after the one before', async () => {
    const leads = Array.from({ length: 600 }, (_, i) => ({ id: 1000 + i, name: `ТЕСТ Сделка ${i}`, contactId: 5000 + i }));
    const k = fakeKommo({ leads, contacts: {} });
    // A clock that moves only when the client waits, so the gaps are exact.
    let clock = 1_000_000;
    const starts: number[] = [];
    const timed: KommoFetch = (url, init) => {
      starts.push(clock);
      return k.fetchFn(url, init);
    };
    const paced = new KommoClient(cfg(), { fetch: timed, now: () => clock, sleep: async (ms) => void (clock += ms) });
    await paced.rentedLeads();
    // Three pages of deals and twelve batches of fifty contacts.
    expect(starts).toHaveLength(15);
    const gaps = starts.slice(1).map((t, i) => t - starts[i]!);
    expect(Math.min(...gaps)).toBeGreaterThan(1000 / 7);
  });
});

describe.skipIf(!HAS_DB)('the poll and what it keeps', () => {
  // Deal ids nobody else in this database has, and no two alike.
  let seq = 0;
  const n = () => Number(`9${Date.now()}`.slice(0, 12)) * 1000 + (seq++ % 1000);

  async function reset() {
    const { prisma } = await import('../src/lib/db.js');
    await prisma.kommoLead.deleteMany({});
    await prisma.kommoSync.update({ where: { id: true }, data: { lastOkAt: null, lastTryAt: null, lastFailure: null, lastHttpStatus: null, leads: 0, intakeFrom: null } });
  }

  /** A rental that is out with a customer, with whatever Kommo links the case needs. */
  async function runningRental(links: { rental?: string; customer?: string } = {}) {
    const { prisma } = await import('../src/lib/db.js');
    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Kommo ${uniq()}`, weeklyRateTetri: 15000, forRent: true } });
    const vehicle = await prisma.vehicle.create({ data: { vin: `TESTK${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id, pool: 'rent' } });
    const customer = await prisma.customer.create({ data: { name: `ТЕСТ Kommo ${uniq()}`, kommoRef: links.customer ?? null } });
    const res = await call(await loginAs('owner'), 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, pickedUpOn: addDays(todayISO(), -3) });
    if (res.statusCode !== 201) throw new Error(res.body);
    const id = json<{ id: string }>(res).id;
    if (links.rental) await prisma.rental.update({ where: { id }, data: { kommoRef: links.rental } });
    return { id, customerId: customer.id };
  }

  beforeEach(async () => {
    process.env.KOMMO_TOKEN = TOKEN;
    await reset();
  });
  afterEach(() => {
    delete process.env.KOMMO_TOKEN;
    setKommoFetchForTests(null);
  });
  afterAll(reset);

  it('keeps the deals of the last poll that worked, and a deal that has left the stage leaves the list', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const [a, b] = [n(), n()];
    const k = fakeKommo({ leads: [{ id: a, name: 'ТЕСТ Сделка А', contactId: 1 }, { id: b, name: 'ТЕСТ Сделка Б' }], contacts: { 1: 'ТЕСТ Контакт' } });
    setKommoFetchForTests(k.fetchFn, { gapMs: 0 });

    const at = new Date('2026-10-07T08:00:00Z');
    expect(await syncKommo(at)).toEqual({ status: 'ok', leads: 2, contactsRead: true });
    expect(await prisma.kommoLead.findMany({ orderBy: { name: 'asc' }, select: { leadId: true, name: true, contactName: true, seenAt: true } })).toEqual([
      { leadId: String(a), name: 'ТЕСТ Сделка А', contactName: 'ТЕСТ Контакт', seenAt: at },
      { leadId: String(b), name: 'ТЕСТ Сделка Б', contactName: null, seenAt: at },
    ]);
    expect(await prisma.kommoSync.findUnique({ where: { id: true } })).toMatchObject({ lastOkAt: at, lastTryAt: at, lastFailure: null, leads: 2 });

    k.calls.length = 0;
    const later = new Date('2026-10-07T08:05:00Z');
    setKommoFetchForTests(fakeKommo({ leads: [{ id: a, name: 'ТЕСТ Сделка А', contactId: 1 }], contacts: { 1: 'ТЕСТ Контакт' } }).fetchFn, { gapMs: 0 });
    expect(await syncKommo(later)).toMatchObject({ status: 'ok', leads: 1 });
    const kept = await prisma.kommoLead.findMany({ select: { leadId: true, firstSeenAt: true, seenAt: true } });
    expect(kept).toEqual([{ leadId: String(a), firstSeenAt: at, seenAt: later }]);
  });

  it('does not wipe the list when Kommo refuses the token: the list stays, and the freshness says Kommo is silent', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const a = n();
    setKommoFetchForTests(fakeKommo({ leads: [{ id: a, name: 'ТЕСТ Сделка А' }] }).fetchFn, { gapMs: 0 });
    const at = new Date('2026-10-07T08:00:00Z');
    await syncKommo(at);

    setKommoFetchForTests(fakeKommo({ leads: [], status: 401 }).fetchFn, { gapMs: 0 });
    const failedAt = new Date('2026-10-07T08:05:00Z');
    expect(await syncKommo(failedAt)).toEqual({ status: 'failed', failure: 'unauthorized', httpStatus: 401 });

    expect(await prisma.kommoLead.count()).toBe(1);
    expect(await prisma.kommoSync.findUnique({ where: { id: true } })).toMatchObject({ lastOkAt: at, lastTryAt: failedAt, lastFailure: 'unauthorized', lastHttpStatus: 401, leads: 1 });

    // One missed poll is not silence yet; twenty minutes without an answer is.
    expect((await kommoReconciliation(failedAt))!.freshness).toBe('ok');
    const stale = await kommoReconciliation(new Date('2026-10-07T08:21:00Z'));
    expect(stale!.freshness).toBe('silent');
    expect(stale!.rentedThere.map((x) => x.leadId)).toContain(String(a));
  });

  it('compares nothing before Kommo has answered once — a token that never worked reads as silence, not as seventeen mismatches', async () => {
    await runningRental();
    setKommoFetchForTests(fakeKommo({ leads: [], status: 401 }).fetchFn, { gapMs: 0 });
    await syncKommo();
    expect(await kommoReconciliation()).toMatchObject({ freshness: 'silent', lastOkAt: null, rentedThere: [], rentedHere: [] });

    const today = json<{ queue: { group: string; rows: { id: string; note: string | null }[] }[] }>(await call(await loginAs('owner'), 'GET', '/api/today'));
    expect(today.queue.flatMap((g) => g.rows).find((r) => r.id === 'kommo')).toMatchObject({ note: '0|silent|' });
  });

  it('shows an owner both kinds of mismatch, each with its way into Kommo and into the record here', async () => {
    const [byRental, byCustomer, noRental, leftStage] = [n(), n(), n(), n()];
    const link = (id: number) => `https://ev8mopeds.kommo.com/leads/detail/${id}`;
    const { prisma } = await import('../src/lib/db.js');

    const matchedByRental = await runningRental({ rental: link(byRental), customer: link(leftStage) });
    const matchedByCustomer = await runningRental({ customer: String(byCustomer) });
    const notRented = await runningRental({ rental: link(leftStage) });
    const noLink = await runningRental();
    const card = await prisma.customer.create({ data: { name: `ТЕСТ Карточка ${uniq()}`, kommoRef: link(noRental) } });

    setKommoFetchForTests(
      fakeKommo({ leads: [{ id: byRental, name: 'ТЕСТ По аренде' }, { id: byCustomer, name: 'ТЕСТ По клиенту' }, { id: noRental, name: 'ТЕСТ Без аренды', contactId: 5 }], contacts: { 5: 'ТЕСТ Контакт' } }).fetchFn,
      { gapMs: 0 },
    );
    const app = await getApp();
    const { env } = await import('../src/lib/env.js');
    const job = await app.inject({ method: 'POST', url: '/api/jobs/kommo-sync', headers: { 'x-worker-token': env.WORKER_TOKEN } });
    expect(json(job)).toEqual({ status: 'ok', leads: 3, contactsRead: true });
    expect(job.body).not.toContain('ТЕСТ');

    const owner = await loginAs('owner');
    const res = await call(owner, 'GET', '/api/kommo/reconciliation');
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(TOKEN);
    const r = json<{
      on: boolean;
      freshness: string;
      leads: number;
      matched: number;
      rentedThere: { leadId: string; leadName: string; contactName: string | null; customer: { id: string } | null; leadUrl: string }[];
      rentedHere: { rentalId: string; reason: string; leadId: string | null; leadUrl: string | null; customer: { id: string } }[];
    }>(res);
    expect(r).toMatchObject({ on: true, freshness: 'ok', leads: 3, matched: 2 });
    expect(r.rentedThere).toEqual([{ leadId: String(noRental), leadName: 'ТЕСТ Без аренды', contactName: 'ТЕСТ Контакт', customer: { id: card.id, name: card.name }, leadUrl: link(noRental) }]);

    const here = new Map(r.rentedHere.map((x) => [x.rentalId, x]));
    expect(here.has(matchedByRental.id)).toBe(false);
    expect(here.has(matchedByCustomer.id)).toBe(false);
    expect(here.get(notRented.id)).toMatchObject({ reason: 'not_rented', leadId: String(leftStage), leadUrl: link(leftStage), customer: { id: notRented.customerId } });
    expect(here.get(noLink.id)).toMatchObject({ reason: 'no_link', leadId: null, leadUrl: null });

    // "Today": one row for all of it, and only in front of an owner.
    const row = json<{ queue: { group: string; rows: { id: string; href: string; note: string | null }[] }[] }>(await call(owner, 'GET', '/api/today'))
      // «Дозаполнить» since issue #18 (B5): «Решения» was a near-twin of «Решить».
      .queue.find((g) => g.group === 'fill')
      ?.rows.find((x) => x.id === 'kommo');
    expect(row).toMatchObject({ href: '/settings/kommo' });
    expect(row!.note).toMatch(new RegExp(`^${r.rentedHere.length}\\|ok\\|\\d{4}-`));

    const manager = await loginAs('manager');
    expect((await call(manager, 'GET', '/api/kommo/reconciliation')).statusCode).toBe(403);
    const managerToday = json<{ queue: { rows: { id: string }[] }[] }>(await call(manager, 'GET', '/api/today'));
    expect(managerToday.queue.flatMap((g) => g.rows).some((x) => x.id === 'kommo')).toBe(false);
  });

  // ADR-0015: a deal Kommo has won comes in as a card and a task.
  const digits = () => uniq().replace(/\D/g, '');
  const link = (id: number) => `https://ev8mopeds.kommo.com/leads/detail/${id}`;
  const poll = async (state: Parameters<typeof fakeKommo>[0], at: Date = new Date()) => {
    setKommoFetchForTests(fakeKommo(state).fetchFn, { gapMs: 0 });
    return syncKommo(at);
  };
  type TodayRow = { id: string; group: string; action: string; who: string | null; href: string; phone: string | null };
  const dealRows = async (cookie: string) => json<{ queue: { group: string; rows: TodayRow[] }[] }>(await call(cookie, 'GET', '/api/today')).queue.find((g) => g.group === 'intake')?.rows ?? [];

  it('makes a card from the contact of a deal nobody here knows — once — and asks a manager for the hand-over', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const deal = n();
    const local = digits().slice(-6);
    const state = { leads: [{ id: deal, name: 'ТЕСТ Сделка новая', contactId: 31 }], contacts: { 31: { name: `ТЕСТ Новый ${uniq()}`, phone: `995595${local}` } } };
    await poll(state);

    const lead = await prisma.kommoLead.findUniqueOrThrow({ where: { leadId: String(deal) }, include: { customer: true } });
    expect(lead).toMatchObject({ kind: 'rent', contactPhone: `995595${local}` });
    expect(lead.customer).toMatchObject({ name: state.contacts[31].name, phone: `+995 595 ${local.slice(0, 2)} ${local.slice(2, 4)} ${local.slice(4)}`, kommoRef: link(deal), kind: 'person', recordKind: 'client', archived: false });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'customer.create', entityId: lead.customerId! } });
    expect(entry).toMatchObject({ actorId: null, note: `from Kommo deal ${deal}` });

    // The next poll finds the card it made.
    await poll(state);
    expect(await prisma.customer.count({ where: { kommoRef: link(deal) } })).toBe(1);

    const row = (await dealRows(await loginAs('manager'))).find((r) => r.id === `kommo-rent:${deal}`);
    expect(row).toMatchObject({ group: 'intake', action: 'hand_over_from_kommo', who: lead.customer!.name, href: `/rentals/new?customer=${lead.customerId}&lead=${deal}`, phone: `995595${local}` });
  });

  it('ties the deal to the card that already has that phone, however it is written, and gives the card the deal’s link', async () => {
    const { prisma } = await import('../src/lib/db.js');
    // `first`: a deal of its own number — a card naming deal 1 would be found by other suites.
    const [fresh, again, first] = [n(), n(), n()];
    const [a, b] = [digits().slice(-6), `${digits().slice(-5)}7`];
    const known = await prisma.customer.create({ data: { name: `ТЕСТ Уже есть ${uniq()}`, phone: `+995 595 ${a.slice(0, 2)} ${a.slice(2, 4)} ${a.slice(4)}` } });
    // A customer who rents a second time: the card keeps the first deal's link.
    const returning = await prisma.customer.create({ data: { name: `ТЕСТ Второй раз ${uniq()}`, phone: `595${b}`, kommoRef: link(first) } });
    const customers = await prisma.customer.count();

    await poll({
      leads: [{ id: fresh, name: 'ТЕСТ Сделка 1', contactId: 41 }, { id: again, name: 'ТЕСТ Сделка 2', contactId: 42 }],
      contacts: { 41: { name: 'ТЕСТ Как в Kommo', phone: `00995 595 ${a}` }, 42: { name: 'ТЕСТ Как в Kommo 2', phone: `+995595${b}` } },
    });

    expect(await prisma.customer.count()).toBe(customers);
    expect(await prisma.kommoLead.findMany({ where: { leadId: { in: [String(fresh), String(again)] } }, select: { leadId: true, customerId: true }, orderBy: { firstSeenAt: 'asc' } })).toEqual(
      expect.arrayContaining([{ leadId: String(fresh), customerId: known.id }, { leadId: String(again), customerId: returning.id }]),
    );
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: known.id } })).kommoRef).toBe(link(fresh));
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: 'customer.update', entityId: known.id } })).toMatchObject({ actorId: null, after: { kommoRef: link(fresh) } });
    // The first deal's link stays on the card; the task still opens on it, by the tie.
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: returning.id } })).kommoRef).toBe(link(first));
    const rows = await dealRows(await loginAs('manager'));
    expect(rows.find((r) => r.id === `kommo-rent:${again}`)).toMatchObject({ who: returning.name, href: `/rentals/new?customer=${returning.id}&lead=${again}` });
  });

  it('makes no card when it cannot tell whose the deal is: two cards with that phone, no contact, or a contact that did not come', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const [twins, nobody, unread, pair1, pair2] = [n(), n(), n(), n(), n()];
    const [a, b] = [digits().slice(-6), `${digits().slice(-5)}3`];
    await prisma.customer.create({ data: { name: `ТЕСТ Отец ${uniq()}`, phone: `+995 595 ${a}` } });
    await prisma.customer.create({ data: { name: `ТЕСТ Сын ${uniq()}`, phone: `595${a}` } });
    const customers = await prisma.customer.count();

    await poll({ leads: [{ id: twins, name: 'ТЕСТ Чья?', contactId: 51 }, { id: nobody, name: 'ТЕСТ Без контакта' }], contacts: { 51: { name: 'ТЕСТ Кто-то из двоих', phone: `995595${a}` } } });
    expect(await prisma.customer.count()).toBe(customers);
    expect((await prisma.kommoLead.findMany({ where: { leadId: { in: [String(twins), String(nobody)] } } })).map((l) => l.customerId)).toEqual([null, null]);
    // The task is still there, named by the contact or the deal, and opens the wizard with nobody chosen.
    const rows = await dealRows(await loginAs('owner'));
    expect(rows.find((r) => r.id === `kommo-rent:${twins}`)).toMatchObject({ who: 'ТЕСТ Кто-то из двоих', href: `/rentals/new?lead=${twins}` });
    expect(rows.find((r) => r.id === `kommo-rent:${nobody}`)).toMatchObject({ who: 'ТЕСТ Без контакта', href: `/rentals/new?lead=${nobody}` });

    // The contacts did not come this time: the deal waits for a poll that reads them.
    await poll({ leads: [{ id: unread, name: 'ТЕСТ Контакт не пришёл', contactId: 52 }], contactsStatus: 400 });
    expect(await prisma.customer.count()).toBe(customers);
    expect((await prisma.kommoLead.findUniqueOrThrow({ where: { leadId: String(unread) } })).customerId).toBeNull();

    // Two deals of one new person in one poll are one card.
    await poll({ leads: [{ id: pair1, name: 'ТЕСТ Сделка А', contactId: 53 }, { id: pair2, name: 'ТЕСТ Сделка Б', contactId: 54 }], contacts: { 53: { name: 'ТЕСТ Один человек', phone: `595${b}` }, 54: { name: 'ТЕСТ Один человек', phone: `+995 595 ${b}` } } });
    expect(await prisma.customer.count()).toBe(customers + 1);
    const tied = await prisma.kommoLead.findMany({ where: { leadId: { in: [String(pair1), String(pair2)] } } });
    expect(new Set(tied.map((l) => l.customerId)).size).toBe(1);
    expect(tied[0]!.customerId).not.toBeNull();
  });

  it('the hand-over started from the deal keeps the deal’s link, and the task is done', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const deal = n();
    const state = { leads: [{ id: deal, name: 'ТЕСТ Сделка к выдаче', contactId: 61 }], contacts: { 61: { name: `ТЕСТ К выдаче ${uniq()}`, phone: `595${digits().slice(-6)}` } } };
    await poll(state);
    const manager = await loginAs('manager');
    const row = (await dealRows(manager)).find((r) => r.id === `kommo-rent:${deal}`)!;
    const customerId = new URLSearchParams(row.href.split('?')[1]).get('customer')!;

    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Kommo ${uniq()}`, weeklyRateTetri: 15000, forRent: true } });
    const vehicle = await prisma.vehicle.create({ data: { vin: `TESTK${digits().slice(-12).padStart(12, '0')}`, modelId: model.id, pool: 'rent' } });
    const res = await call(manager, 'POST', '/api/pickups', {
      customerId,
      vehicleId: vehicle.id,
      weeklyRateTetri: 15000,
      depositTetri: 18000,
      nightParkingAddress: 'ТЕСТ улица 1',
      batteries: 2,
      chargers: 2,
      odometerKm: 10,
      payment: { later: true },
      // What the wizard sends when it was opened from the task: the deal's number.
      kommoRef: String(deal),
    });
    expect(res.statusCode, res.body).toBe(201);
    expect((await prisma.rental.findUniqueOrThrow({ where: { id: json<{ id: string }>(res).id } })).kommoRef).toBe(link(deal));
    expect((await dealRows(manager)).some((r) => r.id === `kommo-rent:${deal}`)).toBe(false);
  });

  it('brings in a sale won after this stand began taking deals in — for those who may sell — and never an older one', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const began = new Date('2026-10-08T06:00:00Z');
    const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);
    const [old, sold] = [n(), n()];
    const sale = (id: number, name: string, closed: string, contactId: number): FakeLead => ({ id, name, status_id: WON, pipeline_id: SALES, closed_at: unix(closed), contactId });
    const contacts = { 71: { name: `ТЕСТ Давний ${uniq()}`, phone: `595${digits().slice(-6)}` }, 72: { name: `ТЕСТ Купил ${uniq()}`, phone: `595${digits().slice(-6)}` } };

    // The first poll is the beginning: nineteen sales of the past years are not nineteen tasks.
    expect(await poll({ leads: [sale(old, 'ТЕСТ Продано давно', '2026-08-06T10:00:00Z', 71)], contacts }, began)).toMatchObject({ status: 'ok', leads: 0 });
    expect((await prisma.kommoSync.findUniqueOrThrow({ where: { id: true } })).intakeFrom).toEqual(began);
    expect(await prisma.kommoLead.count()).toBe(0);
    expect(await prisma.customer.count({ where: { name: contacts[71].name } })).toBe(0);

    await poll({ leads: [sale(old, 'ТЕСТ Продано давно', '2026-08-06T10:00:00Z', 71), sale(sold, 'ТЕСТ Продано сегодня', '2026-10-08T09:00:00Z', 72)], contacts }, new Date('2026-10-08T09:05:00Z'));
    // The beginning does not move with later polls.
    expect((await prisma.kommoSync.findUniqueOrThrow({ where: { id: true } })).intakeFrom).toEqual(began);
    const lead = await prisma.kommoLead.findUniqueOrThrow({ where: { leadId: String(sold) }, include: { customer: true } });
    expect(lead).toMatchObject({ kind: 'sale', closedAt: new Date('2026-10-08T09:00:00Z') });
    expect(lead.customer).toMatchObject({ name: contacts[72].name, kommoRef: link(sold) });

    const owner = await loginAs('owner');
    expect((await dealRows(owner)).find((r) => r.id === `kommo-sale:${sold}`)).toMatchObject({ action: 'sell_from_kommo', who: contacts[72].name, href: `/sales/new?customer=${lead.customerId}&lead=${sold}` });
    // A manager sells a moped too since issue #18 (B8), and is asked to as well.
    expect((await dealRows(await loginAs('manager'))).find((r) => r.id === `kommo-sale:${sold}`)).toMatchObject({ action: 'sell_from_kommo' });
    // The owner's list names it too, with its way into Kommo.
    const page = json<{ wonThere: { leadId: string; leadUrl: string; customer: { id: string } | null }[] }>(await call(owner, 'GET', '/api/kommo/reconciliation'));
    expect(page.wonThere).toEqual([expect.objectContaining({ leadId: String(sold), leadUrl: link(sold), customer: { id: lead.customerId, name: contacts[72].name } })]);

    // Entered: the sale started from the task carries the deal, and the task is done.
    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Kommo ${uniq()}`, salePriceTetri: 290000 } });
    const vehicle = await prisma.vehicle.create({ data: { vin: `TESTK${digits().slice(-12).padStart(12, '0')}`, modelId: model.id, pool: 'sale' } });
    const res = await call(owner, 'POST', '/api/sales', { customerId: lead.customerId, vehicleId: vehicle.id, priceTetri: '2900', kommoRef: String(sold) });
    expect(res.statusCode, res.body).toBe(201);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: json<{ id: string }>(res).id } })).kommoRef).toBe(link(sold));
    expect((await dealRows(owner)).some((r) => r.id === `kommo-sale:${sold}`)).toBe(false);
  });

  it('is off without a token: nothing is asked, nothing is shown, nothing fails', async () => {
    delete process.env.KOMMO_TOKEN;
    const k = fakeKommo({ leads: [{ id: n(), name: 'ТЕСТ Сделка' }] });
    setKommoFetchForTests(k.fetchFn, { gapMs: 0 });
    const app = await getApp();
    const { env } = await import('../src/lib/env.js');

    const job = await app.inject({ method: 'POST', url: '/api/jobs/kommo-sync', headers: { 'x-worker-token': env.WORKER_TOKEN } });
    expect(job.statusCode).toBe(200);
    expect(json(job)).toEqual({ status: 'off' });
    expect(k.calls).toHaveLength(0);
    expect(await kommoReconciliation()).toBeNull();

    const owner = await loginAs('owner');
    const list = await call(owner, 'GET', '/api/kommo/reconciliation');
    expect(list.statusCode).toBe(200);
    expect(json(list)).toEqual({ on: false });
    const today = await call(owner, 'GET', '/api/today');
    expect(today.statusCode).toBe(200);
    expect(json<{ queue: { rows: { id: string }[] }[] }>(today).queue.flatMap((g) => g.rows).some((x) => x.id === 'kommo')).toBe(false);
  });

  it('opens the poll to the worker only', async () => {
    const app = await getApp();
    expect((await app.inject({ method: 'POST', url: '/api/jobs/kommo-sync' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/jobs/kommo-sync', headers: { 'x-worker-token': 'not-it' } })).statusCode).toBe(401);
  });
});
