// Typed text in the reader's language (ADR-0042; Mika, 21.10.2026). Nothing
// leaves the machine: a stand-in answers for the translator. The key, the
// mopeds, the notes and the people are invented test values.
//
// The suites share one database, and its texts are other suites' too: a look
// at everything lists them all. Each test gives up whatever else waits before
// it asks the translator, and reads its own rows by a mark in their words.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TranslatorAnswer } from '../src/lib/translator.js';
import { HAS_DB, call, getApp, json, loginAs, makeUser, uniq } from './helpers.js';

const KEY = 'sk-ant-test-invented-key-not-a-real-one-000000';
const USAGE = { inputTokens: 400, outputTokens: 90 };
const digits = () => uniq().replace(/\D/g, '');

/** The translator as the test scripts it: each answer in turn, then a Russian note's translation. */
function standIn(answers: (TranslatorAnswer | Error)[] = []) {
  const asked: string[] = [];
  const fn = async (text: string): Promise<TranslatorAnswer> => {
    asked.push(text);
    const a = answers.shift();
    if (a instanceof Error) throw a;
    return a ?? { ok: true, lang: 'ru', ka: `KA ${text}`, ru: null, en: `EN ${text}`, usage: USAGE };
  };
  return { fn, asked };
}

describe.skipIf(!HAS_DB)('typed text in the reader’s language (ADR-0042)', () => {
  beforeEach(async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { resetTranslationsForTests } = await import('../src/lib/translations.js');
    resetTranslationsForTests();
    process.env.ANTHROPIC_API_KEY = KEY;
    delete process.env.TRANSLATE_DAILY_LIMIT;
    // The day's count starts from nothing, or a cap reached by an earlier run would hold this one.
    await prisma.translationDay.deleteMany({});
  });

  afterEach(async () => {
    const { setTranslatorForTests } = await import('../src/lib/translator.js');
    setTranslatorForTests(null);
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.TRANSLATE_DAILY_LIMIT;
  });

  async function useTranslator(answers: (TranslatorAnswer | Error)[] = []) {
    const { setTranslatorForTests } = await import('../src/lib/translator.js');
    const s = standIn(answers);
    setTranslatorForTests(s.fn);
    return s;
  }

  /** Only these texts wait: whatever else is listed is given up. */
  async function onlyFor(...texts: string[]) {
    const { prisma } = await import('../src/lib/db.js');
    const { textHash } = await import('../src/lib/translations.js');
    await prisma.textTranslation.updateMany({
      where: { translatedAt: null, gaveUpAt: null, sourceHash: { notIn: texts.map(textHash) } },
      data: { gaveUpAt: new Date(), lastFailure: 'test' },
    });
  }

  async function rowOf(text: string) {
    const { prisma } = await import('../src/lib/db.js');
    const { textHash } = await import('../src/lib/translations.js');
    return prisma.textTranslation.findUnique({ where: { sourceHash: textHash(text) } });
  }

  async function moped(notes: string | null = null) {
    const { prisma } = await import('../src/lib/db.js');
    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Translate ${uniq()}`, forRent: true } });
    return prisma.vehicle.create({ data: { vin: `TESTT${digits().slice(-12).padStart(12, '0')}`, modelId: model.id, notes } });
  }

  /** A manual state change written straight into the table, with its reason. */
  async function reasonOn(vehicleId: string, reason: string, kind: 'manual' | 'pickup' = 'manual') {
    const { prisma } = await import('../src/lib/db.js');
    return prisma.vehicleEvent.create({ data: { vehicleId, kind, occurredOn: new Date('2026-10-21'), toState: kind === 'pickup' ? 'rented' : 'service', reason } });
  }

  /** A minute ahead, so a text listed just now is due. */
  const soon = () => new Date(Date.now() + 60_000);

  it('lists only what is about mopeds and repairs, each text once; never a customer’s, a rental’s, a sale’s or money’s words', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { scanTexts } = await import('../src/lib/translations.js');
    const m = uniq();
    const said = (what: string) => `${what} ${m}`;
    const v = await moped(said('заметка о мопеде'));
    await reasonOn(v.id, said('стучит двигатель'));
    // The same words in the journal line beside the event: one text, one row.
    await prisma.auditLog.create({ data: { action: 'vehicle.state.manual', entityType: 'vehicle', entityId: v.id, note: said('стучит двигатель') } });
    const job = await prisma.serviceJob.create({ data: { vehicleId: v.id, reason: said('не тормозит задний'), notes: said('заметка механика'), openedOn: new Date('2026-10-21') } });
    await prisma.serviceWork.create({ data: { jobId: job.id, freeText: said('перебрал карбюратор'), rateTetri: 5000 } });
    const part = await prisma.part.create({ data: { name: `ТЕСТ part ${m}` } });
    const line = await prisma.servicePart.create({ data: { jobId: job.id, name: 'ТЕСТ', unitPriceTetri: 100, partId: part.id } });
    await prisma.stockMove.create({ data: { partId: part.id, kind: 'issue', qty: -1, occurredOn: new Date('2026-10-21'), servicePartId: line.id, reason: `${job.number}: ${said('сняли со склада')}` } });
    await prisma.batteryInventory.create({ data: { countedOn: new Date('2026-10-21'), showroomQty: 1, repairQty: 0, couriersQty: 0, totalQty: 1, reason: said('одна потерялась') } });
    await prisma.workshop.create({ data: { name: `Test workshop ${m}`, note: said('закрыто по воскресеньям') } });
    await prisma.location.create({ data: { name: `ТЕСТ point ${m}`, note: said('ключ у охраны') } });
    // Never: a customer's notes, a rental's words in a moped's record, a sale called off, a payout undone, a customer's journal line.
    await prisma.customer.create({ data: { name: `Тест Клиент ${m}`, notes: said('клиентская заметка') } });
    await reasonOn(v.id, `return undone: ${said('клиент вернулся')}`, 'pickup');
    await reasonOn(v.id, `sale SL-00007 cancelled: ${said('покупатель передумал')}`);
    await prisma.auditLog.create({ data: { action: 'service.unpaid', entityType: 'service_job', entityId: job.id, note: said('выплата ошибочна') } });
    await prisma.auditLog.create({ data: { action: 'customer.update', entityType: 'customer', note: said('исправили имя') } });
    // Not words at all: a lone code.
    const code = `TESTCODE${digits()}`;
    await reasonOn(v.id, code);

    const first = await scanTexts({ full: true });
    expect(first.found).toBeGreaterThanOrEqual(9);
    const rows = await prisma.textTranslation.findMany({ where: { sourceText: { contains: m } } });
    expect(rows.map((r) => r.sourceText).sort()).toEqual(
      [
        said('заметка о мопеде'),
        said('стучит двигатель'),
        said('не тормозит задний'),
        said('заметка механика'),
        said('перебрал карбюратор'),
        // As the part's card reads it: without the repair's number in front.
        said('сняли со склада'),
        said('одна потерялась'),
        said('закрыто по воскресеньям'),
        said('ключ у охраны'),
      ].sort(),
    );
    for (const r of rows) expect(r).toMatchObject({ lang: null, translatedAt: null, gaveUpAt: null, attempts: 0 });
    expect(await rowOf(code)).toBeNull();
    // A second look finds nothing new.
    expect((await scanTexts({ full: true })).found).toBe(0);
  });

  it('lists a reason the moment after it is written, by the state change itself, as one text for the event and its journal line', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { scanTexts } = await import('../src/lib/translations.js');
    await scanTexts({ full: true });
    const owner = await loginAs('owner');
    const v = await moped();
    const reason = `ушёл на диагностику ${uniq()}`;
    const res = await call(owner, 'POST', `/api/fleet/${v.id}/state`, { toState: 'service', reason });
    expect(res.statusCode, res.body).toBe(200);
    // The look since the last one, not a look at everything.
    expect((await scanTexts()).found).toBeGreaterThanOrEqual(1);
    expect(await prisma.textTranslation.count({ where: { sourceText: reason } })).toBe(1);
  });

  it('sends nothing without a key: the job says `off`, the texts wait, and the translator is never asked', async () => {
    const { env } = await import('../src/lib/env.js');
    const app = await getApp();
    const s = await useTranslator();
    delete process.env.ANTHROPIC_API_KEY;
    const v = await moped();
    const reason = `заменили реле ${uniq()}`;
    await reasonOn(v.id, reason);
    expect((await app.inject({ method: 'POST', url: '/api/jobs/translate', headers: { 'x-worker-token': 'not-it' } })).statusCode).toBe(401);
    const res = await app.inject({ method: 'POST', url: '/api/jobs/translate', headers: { 'x-worker-token': env.WORKER_TOKEN } });
    expect(res.statusCode, res.body).toBe(200);
    expect(json<{ status: string; translated: number; pending: number }>(res)).toMatchObject({ status: 'off', translated: 0 });
    expect(json<{ pending: number }>(res).pending).toBeGreaterThanOrEqual(1);
    expect(s.asked).toHaveLength(0);
    expect(await rowOf(reason)).toMatchObject({ translatedAt: null, gaveUpAt: null, attempts: 0 });
  });

  it('keeps the language it was written in and the two others, its own left empty, and counts the day’s tokens', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { scanTexts, translateWaiting } = await import('../src/lib/translations.js');
    const v = await moped();
    const reason = `тормозные колодки стёрлись ${uniq()}`;
    await reasonOn(v.id, reason);
    await scanTexts({ full: true });
    await onlyFor(reason);
    const s = await useTranslator();
    const outcome = await translateWaiting(soon());
    expect(s.asked).toEqual([reason]);
    expect(outcome).toMatchObject({ status: 'ok', translated: 1, failed: 0, gaveUp: 0, pending: 0, capped: false, today: { requests: 1, ...USAGE } });
    expect(await rowOf(reason)).toMatchObject({ lang: 'ru', textKa: `KA ${reason}`, textRu: null, textEn: `EN ${reason}`, model: 'claude-haiku-5-5', attempts: 1, gaveUpAt: null });
    expect((await rowOf(reason))!.translatedAt).not.toBeNull();
    const day = await prisma.translationDay.findMany({});
    expect(day).toHaveLength(1);
    expect(day[0]).toMatchObject({ requests: 1, translated: 1, failed: 0, ...USAGE });
  });

  it('backs a text off when the service fails — a minute, then five — and stops the run; gives up at once what the model declines', async () => {
    const { scanTexts, translateWaiting } = await import('../src/lib/translations.js');
    const { TranslatorError } = await import('../src/lib/translator.js');
    const v = await moped();
    const [a, b] = [`первая заметка ${uniq()}`, `вторая заметка ${uniq()}`];
    await reasonOn(v.id, a);
    await reasonOn(v.id, b);
    await scanTexts({ full: true });
    await onlyFor(a, b);
    const now = soon();

    // No answer: the run stops at the first failure, and the other text is not asked about.
    const down = await useTranslator([new TranslatorError('network')]);
    expect(await translateWaiting(now)).toMatchObject({ status: 'ok', translated: 0, failed: 1, gaveUp: 0, pending: 2, today: { requests: 0 } });
    expect(down.asked).toHaveLength(1);
    const [x, y] = down.asked[0] === a ? [a, b] : [b, a];
    const failed = (await rowOf(x))!;
    expect(failed).toMatchObject({ attempts: 1, lastFailure: 'network', gaveUpAt: null });
    expect(failed.nextTryAt.getTime()).toBe(now.getTime() + 60_000);
    expect(await rowOf(y)).toMatchObject({ attempts: 0, lastFailure: null });

    // The model declines the other one: given up at once, and counted as the paid request it was.
    const declines = await useTranslator([{ ok: false, failure: 'refused', usage: USAGE }]);
    expect(await translateWaiting(now)).toMatchObject({ translated: 0, failed: 1, gaveUp: 1, pending: 1, today: { requests: 1, ...USAGE } });
    expect(declines.asked).toEqual([y]);
    expect(await rowOf(y)).toMatchObject({ attempts: 1, lastFailure: 'refused' });
    expect((await rowOf(y))!.gaveUpAt).not.toBeNull();

    // A minute on, the first one is due again and fails again: five minutes this time.
    const busy = await useTranslator([new TranslatorError('rate_limited', 429)]);
    const later = new Date(now.getTime() + 61_000);
    await translateWaiting(later);
    expect(busy.asked).toEqual([x]);
    const twice = (await rowOf(x))!;
    expect(twice).toMatchObject({ attempts: 2, lastFailure: 'rate_limited', lastHttpStatus: 429, gaveUpAt: null });
    expect(twice.nextTryAt.getTime()).toBe(later.getTime() + 5 * 60_000);
  });

  it('holds the day’s cap: past it the rest wait for tomorrow', async () => {
    const { scanTexts, translateWaiting } = await import('../src/lib/translations.js');
    process.env.TRANSLATE_DAILY_LIMIT = '2';
    const v = await moped();
    const texts = [`раз заметка ${uniq()}`, `два заметка ${uniq()}`, `три заметка ${uniq()}`];
    for (const t of texts) await reasonOn(v.id, t);
    await scanTexts({ full: true });
    await onlyFor(...texts);
    const s = await useTranslator();
    const now = soon();
    expect(await translateWaiting(now)).toMatchObject({ translated: 2, pending: 1, capped: true, today: { requests: 2 } });
    expect(await translateWaiting(now)).toMatchObject({ translated: 0, pending: 1, capped: true });
    expect(s.asked).toHaveLength(2);
  });

  it('runs once at a time: a second call while one translates answers `busy`', async () => {
    const { runTranslations, scanTexts } = await import('../src/lib/translations.js');
    const { setTranslatorForTests } = await import('../src/lib/translator.js');
    const v = await moped();
    const reason = `медленный перевод ${uniq()}`;
    await reasonOn(v.id, reason);
    await scanTexts({ full: true });
    await onlyFor(reason);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    setTranslatorForTests(async (text) => {
      await held;
      return { ok: true, lang: 'ru', ka: `KA ${text}`, ru: null, en: `EN ${text}`, usage: USAGE };
    });
    const one = runTranslations(soon());
    await new Promise((r) => setTimeout(r, 50));
    expect(await runTranslations(soon())).toMatchObject({ status: 'busy', translated: 0 });
    release();
    expect((await one).status).toBe('ok');
  });

  it('keeps the key and the texts out of every outcome, answer, row and log line', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { buildApp } = await import('../src/server.js');
    const { env } = await import('../src/lib/env.js');
    const { TranslatorError } = await import('../src/lib/translator.js');
    const { scanTexts } = await import('../src/lib/translations.js');
    const v = await moped();
    const reason = `секретная заметка механика ${uniq()}`;
    await reasonOn(v.id, reason);
    await scanTexts({ full: true });
    await onlyFor(reason);
    await useTranslator([new TranslatorError('unauthorized', 401)]);
    const logged: string[] = [];
    const app = buildApp({ logger: { level: 'info', stream: { write: (line: string) => void logged.push(line) } } });
    await app.ready();
    try {
      const res = await app.inject({ method: 'POST', url: '/api/jobs/translate', headers: { 'x-worker-token': env.WORKER_TOKEN } });
      expect(res.statusCode, res.body).toBe(200);
      expect(json<{ status: string; failed: number }>(res)).toMatchObject({ status: 'ok', failed: 1 });
      expect(logged.some((l) => l.includes('the translator did not translate every text'))).toBe(true);
      for (const said of [res.body, logged.join('\n')]) {
        expect(said).not.toContain(KEY);
        expect(said).not.toContain(reason);
      }
    } finally {
      await app.close();
    }
    const row = await rowOf(reason);
    expect(row).toMatchObject({ lastFailure: 'unauthorized', lastHttpStatus: 401 });
    expect(JSON.stringify(row)).not.toContain(KEY);
    expect(JSON.stringify(await prisma.translationDay.findMany({}))).not.toContain(reason);
  });

  it('forgets the translation of a text nobody keeps any more, at the hourly look', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { scanTexts } = await import('../src/lib/translations.js');
    const before = `старая заметка ${uniq()}`;
    const v = await moped(before);
    await scanTexts({ full: true });
    expect(await rowOf(before)).not.toBeNull();
    const after = `новая заметка ${uniq()}`;
    await prisma.vehicle.update({ where: { id: v.id }, data: { notes: after, updatedAt: new Date() } });
    // A look since the last one finds the new words and keeps the old ones…
    await scanTexts();
    expect(await rowOf(after)).not.toBeNull();
    expect(await rowOf(before)).not.toBeNull();
    // …the hourly look at everything forgets them.
    expect((await scanTexts({ full: true })).forgotten).toBeGreaterThanOrEqual(1);
    expect(await rowOf(before)).toBeNull();
    expect(await rowOf(after)).not.toBeNull();
  });

  it('answers a screen with what is ready, in the order asked, to every signed-in person — and writes nothing', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { scanTexts, translateWaiting } = await import('../src/lib/translations.js');
    const v = await moped();
    const [ready, waiting] = [`готовый перевод ${uniq()}`, `ждёт перевода ${uniq()}`];
    await reasonOn(v.id, ready);
    await scanTexts({ full: true });
    await onlyFor(ready);
    await useTranslator();
    await translateWaiting(soon());
    await reasonOn(v.id, waiting);
    await scanTexts({ full: true });
    const unknown = `нигде не записано ${uniq()}`;

    expect((await call(null, 'POST', '/api/texts/translations', { texts: [ready] })).statusCode).toBe(401);
    const mechanic = await mechanicOnTablet();
    const manager = await loginAs('manager');
    const rows = await prisma.textTranslation.count();
    for (const cookie of [mechanic, manager]) {
      const res = await call(cookie, 'POST', '/api/texts/translations', { texts: [unknown, ready, waiting, ready] });
      expect(res.statusCode, res.body).toBe(200);
      const translation = { lang: 'ru', ka: `KA ${ready}`, ru: null, en: `EN ${ready}` };
      expect(json<{ translations: unknown[] }>(res).translations).toEqual([null, translation, null, translation]);
    }
    // Asking about a text creates no row and asks no translator.
    expect(await prisma.textTranslation.count()).toBe(rows);
    expect(await rowOf(unknown)).toBeNull();
    // A list, of strings, at most a hundred, none too long.
    for (const texts of [undefined, 'one', [1], Array.from({ length: 101 }, (_, i) => `t${i}`), ['x'.repeat(4001)]]) {
      const res = await call(manager, 'POST', '/api/texts/translations', { texts });
      expect(res.statusCode, String(texts)).toBe(400);
      expect(json<{ error: string }>(res).error).toBe('bad_field');
    }
  });

  /** A mechanic signed in with a PIN on a workshop tablet the owner registered (ADR-0033). */
  async function mechanicOnTablet(): Promise<string> {
    const owner = await loginAs('owner');
    const tablet = await call(owner, 'POST', '/api/workshop/devices', { name: `Tablet ${uniq()}` });
    expect(tablet.statusCode, tablet.body).toBe(201);
    const device = tablet.cookies.map((c) => `${c.name}=${c.value}`).find((c) => c.startsWith('ev8_device='))!;
    const u = await makeUser('mechanic');
    expect((await call(owner, 'POST', `/api/users/${u.id}/pin`, { pin: '4826' })).statusCode).toBe(200);
    const signed = await call(device, 'POST', '/api/auth/pin', { userId: u.id, pin: '4826' });
    expect(signed.statusCode, signed.body).toBe(200);
    return [device, ...signed.cookies.map((c) => `${c.name}=${c.value}`)].join('; ');
  }
});
