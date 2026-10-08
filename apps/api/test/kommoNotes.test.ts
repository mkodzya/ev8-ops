// The Kommo link, step 2 (ADR-0013): a rental payment taken here becomes a
// note in the deal. Kommo is never called from here — a function stands in
// for it — and the customers, mopeds and sums are made up.
import { addDays, todayISO } from '@ev8/shared';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KommoClient, KommoError, kommoConfig, setKommoFetchForTests, type KommoFetch } from '../src/lib/kommo.js';
import { deliverKommoNotes, kommoNotesState } from '../src/lib/kommoNotes.js';
import { HAS_DB, call, getApp, json, loginAs, uniq } from './helpers.js';

const TOKEN = 'test-kommo-token-that-opens-nothing';

interface Posted {
  leadId: string;
  text: string;
  auth: string;
  contentType: string;
}

/** Kommo as far as writing a note goes: one address, an id back, or a refusal. */
function fakeKommo(state: { status?: number; refuse?: Record<string, number> } = {}) {
  const posted: Posted[] = [];
  let nextId = 9000;
  const fetchFn: KommoFetch = async (url, init) => {
    const u = new URL(url);
    const m = u.pathname.match(/^\/api\/v4\/leads\/(\d+)\/notes$/);
    if (init.method === 'POST' && m) {
      const leadId = m[1]!;
      if (state.status) return { status: state.status, json: async () => ({ title: 'refused', detail: 'ТЕСТ Тайна' }) };
      if (state.refuse?.[leadId]) return { status: state.refuse[leadId]!, json: async () => ({}) };
      const body = JSON.parse(init.body ?? '[]') as { note_type: string; params: { text: string } }[];
      posted.push({ leadId, text: body[0]?.params.text ?? '', auth: init.headers.authorization ?? '', contentType: init.headers['content-type'] ?? '' });
      return { status: 200, json: async () => ({ _embedded: { notes: [{ id: nextId++, entity_id: Number(leadId) }] } }) };
    }
    // The poll's own reading is not this suite's business: nobody rents.
    return { status: 204, json: async () => Promise.reject(new Error('no body')) };
  };
  return { fetchFn, posted, state };
}

describe('the switch', () => {
  it('leaves writing off unless the stand says so, and reads the language of the notes', () => {
    expect(kommoConfig({ KOMMO_TOKEN: TOKEN })).toMatchObject({ write: { kind: 'off' }, noteLocale: 'ka' });
    expect(kommoConfig({ KOMMO_TOKEN: TOKEN, KOMMO_WRITE: 'on', DEFAULT_LOCALE: 'ru' })).toMatchObject({ write: { kind: 'all' }, noteLocale: 'ru' });
    expect(kommoConfig({ KOMMO_TOKEN: TOKEN, KOMMO_WRITE: 'only:42', KOMMO_NOTE_LOCALE: 'en', DEFAULT_LOCALE: 'ru' })).toMatchObject({ write: { kind: 'only', leads: ['42'] }, noteLocale: 'en' });
  });
});

describe('writing a note', () => {
  const client = (k: ReturnType<typeof fakeKommo>) => new KommoClient(kommoConfig({ KOMMO_TOKEN: TOKEN })!, { fetch: k.fetchFn, gapMs: 0 });

  it('posts one plain note into the deal, with the token in the header, and returns its id', async () => {
    const k = fakeKommo();
    expect(await client(k).addLeadNote('777', 'ТЕСТ заметка')).toEqual({ noteId: '9000' });
    expect(k.posted).toEqual([{ leadId: '777', text: 'ТЕСТ заметка', auth: `Bearer ${TOKEN}`, contentType: 'application/json' }]);
  });

  it('turns a refusal into our own word, with nothing of the note or of Kommo’s answer in it', async () => {
    const err = (await client(fakeKommo({ status: 404 }))
      .addLeadNote('777', 'ТЕСТ заметка')
      .catch((e: unknown) => e)) as KommoError;
    expect(err).toBeInstanceOf(KommoError);
    expect(err).toMatchObject({ failure: 'http', httpStatus: 404 });
    expect(err.message).not.toContain('ТЕСТ');
    expect(await client(fakeKommo({ status: 401 })).addLeadNote('777', 'x').catch((e: KommoError) => e.failure)).toBe('unauthorized');
  });

  it('does not ask Kommo at all for something that is not a deal number', async () => {
    const k = fakeKommo();
    expect(await client(k).addLeadNote('../contacts/1', 'x').catch((e: KommoError) => e.failure)).toBe('bad_answer');
    expect(k.posted).toHaveLength(0);
  });
});

describe.skipIf(!HAS_DB)('a payment becomes a note', () => {
  let seq = 0;
  const lead = () => String(Number(`8${Date.now()}`.slice(0, 12)) * 1000 + (seq++ % 1000));

  async function reset() {
    const { prisma } = await import('../src/lib/db.js');
    await prisma.kommoNote.deleteMany({});
    await prisma.kommoLead.deleteMany({});
    await prisma.kommoSync.update({ where: { id: true }, data: { notesFrom: null, lastOkAt: null, lastTryAt: null, lastFailure: null, lastHttpStatus: null, leads: 0 } });
  }

  /** A rental that is out, whose customer card points at a Kommo deal (or at none). */
  async function runningRental(leadId: string | null) {
    const { prisma } = await import('../src/lib/db.js');
    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Notes ${uniq()}`, weeklyRateTetri: 15000, forRent: true } });
    const vehicle = await prisma.vehicle.create({ data: { vin: `TESTN${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id, pool: 'rent' } });
    const customer = await prisma.customer.create({ data: { name: `ТЕСТ Заметки ${uniq()}`, kommoRef: leadId ? `https://ev8mopeds.kommo.com/leads/detail/${leadId}` : null } });
    const res = await call(owner, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, pickedUpOn: addDays(todayISO(), -3) });
    if (res.statusCode !== 201) throw new Error(res.body);
    return json<{ id: string; number: string }>(res);
  }

  async function pay(rentalId: string, grossTetri: number): Promise<string> {
    const res = await call(owner, 'POST', '/api/payments', { rentalId, channel: 'cash', grossTetri });
    if (res.statusCode !== 201) throw new Error(res.body);
    return json<{ id: string }>(res).id;
  }

  const noteOf = async (paymentId: string, kind = 'payment') => {
    const { prisma } = await import('../src/lib/db.js');
    return prisma.kommoNote.findUnique({ where: { kind_paymentId: { kind, paymentId } } });
  };

  let owner = '';
  beforeEach(async () => {
    process.env.KOMMO_TOKEN = TOKEN;
    process.env.KOMMO_WRITE = 'on';
    process.env.KOMMO_NOTE_LOCALE = 'ru';
    owner = await loginAs('owner');
    await reset();
  });
  afterEach(() => {
    delete process.env.KOMMO_TOKEN;
    delete process.env.KOMMO_WRITE;
    delete process.env.KOMMO_NOTE_LOCALE;
    setKommoFetchForTests(null);
  });
  afterAll(reset);

  it('writes nothing while the stand is not told to: no row, no request', async () => {
    delete process.env.KOMMO_WRITE;
    const k = fakeKommo();
    setKommoFetchForTests(k.fetchFn, { gapMs: 0 });
    const r = await runningRental(lead());
    const paymentId = await pay(r.id, 15000);
    expect(await deliverKommoNotes()).toEqual({ status: 'off' });
    expect(await noteOf(paymentId)).toBeNull();
    expect(k.posted).toHaveLength(0);
  });

  it('never writes a payment made before writing was switched on', async () => {
    const k = fakeKommo();
    setKommoFetchForTests(k.fetchFn, { gapMs: 0 });
    const r = await runningRental(lead());
    const before = await pay(r.id, 18000);
    // The first walk is the moment writing comes on.
    expect(await deliverKommoNotes()).toMatchObject({ status: 'ok', queued: 0, sent: 0 });
    expect(await deliverKommoNotes()).toMatchObject({ status: 'ok', queued: 0, sent: 0 });
    expect(await noteOf(before)).toBeNull();
    expect(k.posted).toHaveLength(0);
  });

  it('sends one note for a payment into the rental’s deal, once', async () => {
    const k = fakeKommo();
    setKommoFetchForTests(k.fetchFn, { gapMs: 0 });
    const leadId = lead();
    const r = await runningRental(leadId);
    await deliverKommoNotes(); // writing comes on
    // The first money on a rental closes its deposit and then its weeks.
    const paymentId = await pay(r.id, 33000);

    expect(await deliverKommoNotes()).toEqual({ status: 'ok', queued: 1, sent: 1, refused: 0, waiting: 0 });
    expect(k.posted).toHaveLength(1);
    expect(k.posted[0]!.leadId).toBe(leadId);
    expect(k.posted[0]!.text).toMatch(new RegExp(`^EV8 Ops · оплата 330 ₾ · \\d\\d\\.\\d\\d\\.\\d{4} · наличные · аренда 150 ₾, залог 180 ₾ · оплачено по \\d\\d\\.\\d\\d\\.\\d{4} · ${r.number} · принял\\(а\\) Test owner$`));
    expect(await noteOf(paymentId)).toMatchObject({ state: 'sent', leadId, kommoNoteId: '9000', attempts: 1, reason: null });

    expect(await deliverKommoNotes()).toMatchObject({ status: 'ok', queued: 0, sent: 0 });
    expect(k.posted).toHaveLength(1);
  });

  it('takes the note back with a second one when the payment is voided after it left, and sends none when voided before', async () => {
    const { voidPayment } = await import('../src/lib/payments.js');
    const { prisma } = await import('../src/lib/db.js');
    const actor = (await prisma.user.findFirstOrThrow({ where: { role: 'owner' }, orderBy: { createdAt: 'desc' } })).id;
    const k = fakeKommo();
    setKommoFetchForTests(k.fetchFn, { gapMs: 0 });
    const leadId = lead();
    const r = await runningRental(leadId);
    await deliverKommoNotes();

    const sentThenVoided = await pay(r.id, 18000);
    await deliverKommoNotes();
    await voidPayment({ actorId: actor, paymentId: sentThenVoided, reason: 'ТЕСТ не тот клиент' });
    const voidedFirst = await pay(r.id, 15000);
    await voidPayment({ actorId: actor, paymentId: voidedFirst, reason: 'ТЕСТ ошибка' });

    expect(await deliverKommoNotes()).toMatchObject({ status: 'ok', queued: 1, sent: 1 });
    expect(k.posted).toHaveLength(2);
    expect(k.posted[1]!.text).toContain('ОТМЕНЕНА оплата 180 ₾');
    expect(k.posted[1]!.text).toContain('причина: ТЕСТ не тот клиент');
    expect(await noteOf(sentThenVoided, 'payment_void')).toMatchObject({ state: 'sent', leadId });
    expect(await noteOf(voidedFirst)).toMatchObject({ state: 'cancelled', reason: 'voided' });
    expect(await noteOf(voidedFirst, 'payment_void')).toBeNull();

    expect(await deliverKommoNotes()).toMatchObject({ queued: 0, sent: 0 });
    expect(k.posted).toHaveLength(2);
  });

  it('keeps a note waiting while Kommo refuses the token, and sends it when Kommo answers again', async () => {
    const down = fakeKommo({ status: 401 });
    setKommoFetchForTests(down.fetchFn, { gapMs: 0 });
    const r = await runningRental(lead());
    await deliverKommoNotes();
    const paymentId = await pay(r.id, 15000);

    expect(await deliverKommoNotes()).toEqual({ status: 'failed', failure: 'unauthorized', httpStatus: 401, queued: 1, sent: 0, refused: 0, waiting: 1 });
    expect(await noteOf(paymentId)).toMatchObject({ state: 'pending', attempts: 1, reason: 'unauthorized', httpStatus: 401 });

    const up = fakeKommo();
    setKommoFetchForTests(up.fetchFn, { gapMs: 0 });
    expect(await deliverKommoNotes()).toMatchObject({ status: 'ok', queued: 0, sent: 1, waiting: 0 });
    expect(up.posted).toHaveLength(1);
    expect(await noteOf(paymentId)).toMatchObject({ state: 'sent', attempts: 2, reason: null });
  });

  it('sets aside a note Kommo refuses, goes on with the rest, and shows it to an owner — in the list and in “Today”', async () => {
    const [gone, fine] = [lead(), lead()];
    const k = fakeKommo({ refuse: { [gone]: 404 } });
    setKommoFetchForTests(k.fetchFn, { gapMs: 0 });
    const lost = await runningRental(gone);
    const kept = await runningRental(fine);
    const unlinked = await runningRental(null);
    await deliverKommoNotes();
    const refusedPayment = await pay(lost.id, 15000);
    await pay(kept.id, 15000);
    const noDealPayment = await pay(unlinked.id, 15000);

    expect(await deliverKommoNotes()).toEqual({ status: 'ok', queued: 2, sent: 1, refused: 1, waiting: 0 });
    expect(k.posted.map((p) => p.leadId)).toEqual([fine]);
    expect(await noteOf(refusedPayment)).toMatchObject({ state: 'refused', reason: 'http', httpStatus: 404 });
    expect(await noteOf(noDealPayment)).toMatchObject({ state: 'skipped', reason: 'no_deal' });

    const state = await kommoNotesState();
    expect(state).toMatchObject({ mode: 'all', sent: 1, waiting: 0 });
    expect(state!.stuck.map((x) => [x.paymentId, x.why, x.rentalNumber])).toEqual(
      expect.arrayContaining([
        [refusedPayment, 'refused', lost.number],
        [noDealPayment, 'no_deal', unlinked.number],
      ]),
    );

    // Kommo has to have answered once for the page and the row to exist at all.
    const { syncKommo } = await import('../src/lib/kommo.js');
    await syncKommo();
    const page = json<{ notes: { mode: string; stuck: { paymentId: string; why: string }[] } }>(await call(owner, 'GET', '/api/kommo/reconciliation'));
    expect(page.notes.mode).toBe('all');
    expect(page.notes.stuck.some((x) => x.paymentId === refusedPayment && x.why === 'refused')).toBe(true);
    const row = json<{ queue: { rows: { id: string; note: string | null }[] }[] }>(await call(owner, 'GET', '/api/today'))
      .queue.flatMap((g) => g.rows)
      .find((x) => x.id === 'kommo');
    expect(row!.note).toMatch(/\|1$/);
  });

  it('writes to the named test deals alone when the stand says “only”', async () => {
    const [testDeal, realDeal] = [lead(), lead()];
    process.env.KOMMO_WRITE = `only:${testDeal}`;
    const k = fakeKommo();
    setKommoFetchForTests(k.fetchFn, { gapMs: 0 });
    const test = await runningRental(testDeal);
    const real = await runningRental(realDeal);
    await deliverKommoNotes();
    await pay(test.id, 15000);
    const realPayment = await pay(real.id, 15000);

    expect(await deliverKommoNotes()).toMatchObject({ status: 'ok', queued: 1, sent: 1 });
    expect(k.posted.map((p) => p.leadId)).toEqual([testDeal]);
    expect(await noteOf(realPayment)).toMatchObject({ state: 'skipped', reason: 'not_a_test_deal' });
    expect((await kommoNotesState())!.mode).toBe('only');
  });

  it('goes out on the worker’s knock, and the answer carries counts but no note', async () => {
    const k = fakeKommo();
    setKommoFetchForTests(k.fetchFn, { gapMs: 0 });
    const r = await runningRental(lead());
    await deliverKommoNotes();
    await pay(r.id, 15000);
    const app = await getApp();
    const { env } = await import('../src/lib/env.js');
    const job = await app.inject({ method: 'POST', url: '/api/jobs/kommo-sync', headers: { 'x-worker-token': env.WORKER_TOKEN } });
    expect(json(job)).toMatchObject({ status: 'ok', notes: { status: 'ok', queued: 1, sent: 1, refused: 0, waiting: 0 } });
    expect(job.body).not.toContain('EV8 Ops');
    expect(job.body).not.toContain(TOKEN);
    expect(k.posted).toHaveLength(1);
  });
});
