// The notices to the workshop's Telegram group (stage 6 of
// docs/spec/mechanic-in-erp-plan.md; ADR-0038 §6–7). Nothing leaves the
// machine: a stand-in answers for Telegram. The token, the group, the stand's
// address, the mopeds, the parts and the people are invented test values.
//
// The suites share one database, and other suites write notices too (every
// repair they open or close does): each test here first gives up whatever
// another left waiting, and reads its own rows by their record.
import { fleetNumber, todayISO } from '@ev8/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TelegramFetch } from '../src/lib/telegram.js';
import { HAS_DB, call, json, login, makeUser, uniq } from './helpers.js';

const TOKEN = '123456789:TEST-invented-token-not-a-bot-0000000';
const CHAT = '-1009999999999';
const STAND = 'https://test.ops.ev8.ge';
const PHOTO = { mimeType: 'image/jpeg', dataBase64: Buffer.from(`test photo ${uniq()}`).toString('base64') };
const digits = () => uniq().replace(/\D/g, '');
/** A moped as a notice names it: its number, or the tail of its VIN before it has one. */
const label = (v: { fleetNo: number | null; vin: string }) => fleetNumber(v.fleetNo) ?? `···${v.vin.slice(-6)}`;

interface Asked {
  url: string;
  body: { chat_id: string; text: string; parse_mode: string; disable_web_page_preview: boolean };
}
type Answer = { status: number; body: unknown } | 'throw';

/** Telegram as the test scripts it: each answer in turn, then «ok». */
function fakeTelegram(answers: Answer[] = []) {
  const asked: Asked[] = [];
  const fn: TelegramFetch = async (url, init) => {
    asked.push({ url, body: JSON.parse(init.body) as Asked['body'] });
    const a = answers.shift() ?? { status: 200, body: { ok: true, result: { message_id: asked.length, chat: { id: Number(CHAT) } } } };
    // A failed connection names the address it was going to — the token with it.
    if (a === 'throw') throw new Error(`fetch failed: connect ECONNREFUSED ${url}`);
    return { status: a.status, json: async () => a.body };
  };
  return { fn, asked, texts: () => asked.map((a) => a.body.text) };
}

const refused = (code: number, description: string, parameters?: Record<string, unknown>): Answer => ({ status: code, body: { ok: false, error_code: code, description, ...(parameters ? { parameters } : {}) } });

describe('the Telegram link, without a database', () => {
  it('is on only with a bot token and a group of their shape', async () => {
    const { telegramConfig } = await import('../src/lib/telegram.js');
    expect(telegramConfig({})).toBeNull();
    expect(telegramConfig({ TELEGRAM_BOT_TOKEN: TOKEN })).toBeNull();
    expect(telegramConfig({ TELEGRAM_CHAT_ID: CHAT })).toBeNull();
    expect(telegramConfig({ TELEGRAM_BOT_TOKEN: 'not-a-token', TELEGRAM_CHAT_ID: CHAT })).toBeNull();
    expect(telegramConfig({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: '@workshop' })).toBeNull();
    expect(telegramConfig({ TELEGRAM_BOT_TOKEN: ` ${TOKEN} `, TELEGRAM_CHAT_ID: CHAT })).toEqual({ token: TOKEN, chatId: CHAT });
  });

  it('finds the group the bot was just added to, for the setup script, the latest last and each once', async () => {
    const { TelegramClient } = await import('../src/lib/telegram.js');
    // Invented chats: two groups, a private chat that is not one, and the first group again.
    const updates = [
      { update_id: 1, my_chat_member: { chat: { id: -100111, type: 'supergroup', title: 'Test workshop' } } },
      { update_id: 2, message: { chat: { id: 555, type: 'private' } } },
      { update_id: 3, my_chat_member: { chat: { id: -222, type: 'group', title: 'Test other' } } },
      { update_id: 4, message: { chat: { id: -100111, type: 'supergroup', title: 'Test workshop' } } },
    ];
    const tg = fakeTelegram([{ status: 200, body: { ok: true, result: updates } }]);
    const client = new TelegramClient({ token: TOKEN, chatId: '0' }, { fetch: tg.fn, gapMs: 0 });
    expect(await client.findGroups()).toEqual([
      { id: '-222', title: 'Test other' },
      { id: '-100111', title: 'Test workshop' },
    ]);
    expect(tg.asked[0]!.url.endsWith('/getUpdates')).toBe(true);
    // A bot with a webhook is refused the updates: a word of ours, never the token.
    const busy = fakeTelegram([refused(409, 'Conflict: can not use getUpdates method while webhook is active')]);
    const err = await new TelegramClient({ token: TOKEN, chatId: '0' }, { fetch: busy.fn, gapMs: 0 }).findGroups().catch((e: unknown) => e);
    expect(String(err)).not.toContain(TOKEN);
  });

  it('links only to one of EV8 Ops’ own stands', async () => {
    const { publicUrl } = await import('../src/lib/origin.js');
    expect(publicUrl({ PUBLIC_URL: 'https://ops.ev8.ge/' })).toBe('https://ops.ev8.ge');
    expect(publicUrl({ PUBLIC_URL: STAND })).toBe(STAND);
    expect(publicUrl({ PUBLIC_URL: 'http://localhost:5173' })).toBe('http://localhost:5173');
    expect(publicUrl({ PUBLIC_URL: 'https://ops.ev8.ge.example.com' })).toBeNull();
    expect(publicUrl({})).toBeNull();
  });

  it('sends one message in HTML with no preview, the token only in the one address', async () => {
    const { TelegramClient } = await import('../src/lib/telegram.js');
    const tg = fakeTelegram();
    const sent = await new TelegramClient({ token: TOKEN, chatId: CHAT }, { fetch: tg.fn, gapMs: 0 }).sendMessage(CHAT, '<b>SV-1</b>');
    expect(sent.messageId).toBe(1);
    expect(tg.asked[0]!.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(tg.asked[0]!.body).toEqual({ chat_id: CHAT, text: '<b>SV-1</b>', parse_mode: 'HTML', disable_web_page_preview: true });
    expect(JSON.stringify(tg.asked[0]!.body)).not.toContain(TOKEN);
  });

  it('turns a refusal into our word, with nothing of the token or of Telegram’s answer in it', async () => {
    const { TelegramClient, TelegramError } = await import('../src/lib/telegram.js');
    const ask = async (a: Answer) => {
      const tg = fakeTelegram([a]);
      return new TelegramClient({ token: TOKEN, chatId: CHAT }, { fetch: tg.fn, gapMs: 0 }).sendMessage(CHAT, 'x').catch((e: unknown) => e);
    };
    const cases: [Answer, Record<string, unknown>][] = [
      [refused(401, 'Unauthorized'), { failure: 'unauthorized', httpStatus: 401 }],
      [refused(404, 'Not Found'), { failure: 'unauthorized', httpStatus: 404 }],
      [refused(429, 'Too Many Requests: retry after 7', { retry_after: 7 }), { failure: 'rate_limited', httpStatus: 429, retryAfterSec: 7 }],
      [refused(403, 'Forbidden: bot was kicked from the group chat'), { failure: 'forbidden', httpStatus: 403 }],
      [refused(400, 'Bad Request: chat not found'), { failure: 'chat_not_found', httpStatus: 400 }],
      [refused(400, 'Bad Request: group chat was upgraded to a supergroup chat', { migrate_to_chat_id: -1001 }), { failure: 'chat_moved', httpStatus: 400 }],
      [refused(400, "Bad Request: can't parse entities"), { failure: 'bad_request', httpStatus: 400 }],
      [refused(502, 'Bad Gateway'), { failure: 'http', httpStatus: 502 }],
      ['throw', { failure: 'network', httpStatus: null }],
    ];
    for (const [answer, expected] of cases) {
      const err = await ask(answer);
      expect(err).toBeInstanceOf(TelegramError);
      expect(err).toMatchObject(expected);
      expect(String(err)).not.toContain(TOKEN);
      expect(JSON.stringify(err)).not.toContain(TOKEN);
      expect(String(err)).not.toMatch(/Bad Request|Forbidden|kicked|Unauthorized/);
    }
  });

  it('writes the test message deploy/set-telegram.sh sends in both languages, Georgian first, with the stand’s link', async () => {
    const { twoLanguages } = await import('../src/lib/noticeWords.js');
    const [ka, ru, link] = twoLanguages((w) => w.probe, '/service', { PUBLIC_URL: STAND }).split('\n');
    expect(ka).toMatch(/^🔔 EV8 Ops — საცდელი შეტყობინება/);
    expect(ru).toMatch(/^EV8 Ops — тестовое сообщение/);
    expect(link).toBe(`${STAND}/service`);
  });

  it('escapes what Telegram would read as HTML', async () => {
    const { escapeHtml } = await import('../src/lib/notices.js');
    expect(escapeHtml('A <b> & "c"')).toBe('A &lt;b&gt; &amp; "c"');
  });
});

describe.skipIf(!HAS_DB)('the notices to the workshop’s group (ADR-0038 §6–7)', () => {
  beforeEach(async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { resetNoticeSenderForTests, setNoticeClockForTests } = await import('../src/lib/notices.js');
    resetNoticeSenderForTests();
    // A run takes no time unless a test moves the clock itself.
    setNoticeClockForTests(() => 0);
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    process.env.TELEGRAM_CHAT_ID = CHAT;
    process.env.PUBLIC_URL = STAND;
    await prisma.notice.updateMany({ where: { sentAt: null, gaveUpAt: null }, data: { gaveUpAt: new Date(), lastFailure: 'test' } });
  });

  afterEach(async () => {
    const { setTelegramFetchForTests } = await import('../src/lib/telegram.js');
    setTelegramFetchForTests(null);
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    delete process.env.PUBLIC_URL;
  });

  async function useTelegram(answers: Answer[] = []) {
    const { setTelegramFetchForTests } = await import('../src/lib/telegram.js');
    const tg = fakeTelegram(answers);
    setTelegramFetchForTests(tg.fn, { gapMs: 0 });
    return tg;
  }

  /** Only these records' notices wait: whatever another suite left is given up. */
  async function onlyFor(...entityIds: string[]) {
    const { prisma } = await import('../src/lib/db.js');
    await prisma.notice.updateMany({ where: { sentAt: null, gaveUpAt: null, entityId: { notIn: entityIds } }, data: { gaveUpAt: new Date(), lastFailure: 'test' } });
  }

  async function noticesOf(entityId: string) {
    const { prisma } = await import('../src/lib/db.js');
    return prisma.notice.findMany({ where: { entityId }, orderBy: [{ createdAt: 'asc' }, { dedupeKey: 'asc' }] });
  }

  async function moped(odometerKm: number | null = null) {
    const { prisma } = await import('../src/lib/db.js');
    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Notice ${uniq()}`, forRent: true } });
    return prisma.vehicle.create({ data: { vin: `TESTN${digits().slice(-12).padStart(12, '0')}`, modelId: model.id, odometerKm } });
  }

  async function person(role: 'mechanic' | 'chief_mechanic' | 'owner' | 'manager', name?: string) {
    const { prisma } = await import('../src/lib/db.js');
    const u = await makeUser(role);
    if (name) await prisma.user.update({ where: { id: u.id }, data: { name } });
    return { id: u.id, cookie: await login(u.email) };
  }

  async function bookWork(owner: string) {
    const { importWorkBook } = await import('../src/lib/workBook.js');
    await importWorkBook();
    const res = await call(owner, 'POST', '/api/work-book/works', { category: 'OT', nameRu: `Тестовая работа ${uniq()}`, normMin: 30 });
    expect(res.statusCode, res.body).toBe(201);
    return json<{ id: string }>(res).id;
  }

  async function point(): Promise<string> {
    const { prisma } = await import('../src/lib/db.js');
    const row = await prisma.location.findFirst({ where: { archived: false }, select: { id: true } });
    return (row ?? (await prisma.location.create({ data: { name: `ТЕСТ point ${uniq()}` }, select: { id: true } }))).id;
  }

  /** A repair closed long enough ago to be read, written straight into the table. */
  async function closedJob(opts: { mechanicName?: string; customerId?: string; rentalId?: string } = {}) {
    const { prisma } = await import('../src/lib/db.js');
    const v = await moped();
    const mech = await makeUser('mechanic');
    if (opts.mechanicName) await prisma.user.update({ where: { id: mech.id }, data: { name: opts.mechanicName } });
    const opened = new Date('2026-10-18T19:30:00Z'); // 23:30 in Tbilisi
    return prisma.serviceJob.create({
      data: {
        vehicleId: v.id,
        reason: 'test brakes',
        reasonKind: 'wear',
        openedOn: new Date('2026-10-18'),
        openedAt: opened,
        approvedAt: opened,
        closedOn: new Date('2026-10-19'),
        closedAt: new Date('2026-10-18T21:30:00Z'), // 01:30 the next day in Tbilisi
        status: 'done',
        mechanicId: mech.id,
        customerId: opts.customerId ?? null,
        rentalId: opts.rentalId ?? null,
        payer: opts.customerId ? 'customer' : 'company',
        labourTetri: 12345,
        chargedTetri: 6789,
      },
    });
  }

  async function enqueueClosed(jobId: string) {
    const { prisma } = await import('../src/lib/db.js');
    const { enqueueNotice, noticeKey } = await import('../src/lib/notices.js');
    await prisma.$transaction((tx) => enqueueNotice(tx, { kind: 'job_closed', entityId: jobId, dedupeKey: noticeKey.closed(jobId) }));
  }

  /** A minute ahead of the database's clock, so a notice written just now is due. */
  const soon = () => new Date(Date.now() + 60_000);

  it('writes a notice inside each event’s transaction: waiting, approved, waiting again, refused, closed — and a closing told twice is one', async () => {
    const owner = await person('owner');
    const workId = await bookWork(owner.cookie);
    const mech = await person('mechanic');
    const chief = await person('chief_mechanic');
    const v = await moped();

    const opened = await call(mech.cookie, 'POST', '/api/service/workshop', { vehicleId: v.id, reasonKind: 'wear', reason: 'rear brake squeals', odometerKm: 5230, odometerPhoto: PHOTO, photos: [PHOTO], works: [{ workTypeId: workId, qty: 1 }] });
    expect(opened.statusCode, opened.body).toBe(201);
    const id = json<{ id: string; status: string }>(opened).id;
    expect((await noticesOf(id)).map((n) => n.kind)).toEqual(['job_waiting']);

    expect((await call(chief.cookie, 'POST', `/api/service/${id}/approve`, {})).statusCode).toBe(200);
    // A work found once it is in work: back to waiting, asked again.
    const more = await call(mech.cookie, 'POST', `/api/service/${id}/works`, { works: [{ freeText: 'test: chain', qty: 1 }] });
    expect(more.statusCode, more.body).toBe(201);
    // Another while it waits: the group was asked already.
    expect((await call(mech.cookie, 'POST', `/api/service/${id}/works`, { works: [{ freeText: 'test: sprocket', qty: 1 }] })).statusCode).toBe(201);
    expect((await call(chief.cookie, 'POST', `/api/service/${id}/reject`, { reason: 'test: not now' })).statusCode).toBe(200);
    // A part he bought: back to waiting again, then approved the second time.
    const bought = await call(mech.cookie, 'POST', `/api/service/${id}/parts`, { kind: 'bought', name: 'test bolt', qty: 1, paidTetri: 500, receiptPhoto: PHOTO });
    expect(bought.statusCode, bought.body).toBe(201);
    expect((await call(chief.cookie, 'POST', `/api/service/${id}/approve`, {})).statusCode).toBe(200);

    const where = await point();
    const closed = await call(mech.cookie, 'POST', `/api/service/${id}/close`, { odometerKm: 5300, locationId: where, photos: [PHOTO] });
    expect(closed.statusCode, closed.body).toBe(200);
    expect((await call(mech.cookie, 'POST', `/api/service/${id}/close`, { odometerKm: 5300, locationId: where, photos: [PHOTO] })).statusCode).toBe(409);

    const rows = await noticesOf(id);
    expect(rows.map((n) => n.kind)).toEqual(['job_waiting', 'job_approved', 'job_waiting', 'job_rejected', 'job_waiting', 'job_approved', 'job_closed']);
    expect(new Set(rows.map((n) => n.dedupeKey)).size).toBe(rows.length);
    expect(rows.filter((n) => n.kind === 'job_closed').map((n) => n.dedupeKey)).toEqual([`job_closed:${id}`]);

    // A breakdown reported from the office waits too; refused whole, the group hears that.
    const manager = await person('manager');
    const v2 = await moped();
    const reported = await call(manager.cookie, 'POST', '/api/service', { vehicleId: v2.id, reason: 'test: does not start' });
    expect(reported.statusCode, reported.body).toBe(201);
    const id2 = json<{ id: string }>(reported).id;
    expect((await call(chief.cookie, 'POST', `/api/service/${id2}/reject`, { reason: 'test: duplicate' })).statusCode).toBe(200);
    expect((await noticesOf(id2)).map((n) => n.kind)).toEqual(['job_waiting', 'job_rejected']);
  });

  it('writes nothing when the event’s transaction rolls back, and the same key twice is one row', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { enqueueNotice, noticeKey } = await import('../src/lib/notices.js');
    const job = await closedJob();
    const key = noticeKey.closed(job.id);
    await expect(
      prisma.$transaction(async (tx) => {
        await enqueueNotice(tx, { kind: 'job_closed', entityId: job.id, dedupeKey: key });
        throw new Error('test: the event failed');
      }),
    ).rejects.toThrow('test: the event failed');
    expect(await prisma.notice.count({ where: { dedupeKey: key } })).toBe(0);
    expect(await prisma.$transaction((tx) => enqueueNotice(tx, { kind: 'job_closed', entityId: job.id, dedupeKey: key }))).toBe(true);
    expect(await prisma.$transaction((tx) => enqueueNotice(tx, { kind: 'job_closed', entityId: job.id, dedupeKey: key }))).toBe(false);
    expect(await prisma.notice.count({ where: { dedupeKey: key } })).toBe(1);
  });

  it('writes Georgian first and Russian under it, escaped, with the link to this stand — and no link without its address', async () => {
    const { composeNotice } = await import('../src/lib/notices.js');
    const job = await closedJob({ mechanicName: 'Test <Mechanic> & Co' });
    const row = { kind: 'job_closed', entityId: job.id, dedupeKey: `job_closed:${job.id}` };

    const { prisma } = await import('../src/lib/db.js');
    const moped = label(await prisma.vehicle.findUniqueOrThrow({ where: { id: job.vehicleId } }));
    const text = (await composeNotice(row, { env: { PUBLIC_URL: STAND } }))!;
    const lines = text.split('\n');
    expect(lines).toHaveLength(3);
    // Opened at 23:30 and closed at 01:30 the next day in Tbilisi: two hours.
    expect(lines[0]).toBe(`🏁 შეკეთება <b>${job.number}</b> · ${moped} დაიხურა · მექანიკოსი: Test &lt;Mechanic&gt; &amp; Co · მოცდენა 2 სთ`);
    expect(lines[1]).toBe(`Ремонт <b>${job.number}</b> · ${moped} закрыт · механик: Test &lt;Mechanic&gt; &amp; Co · простой 2 ч`);
    expect(lines[2]).toBe(`${STAND}/service/${job.id}`);
    expect(text).not.toContain('<Mechanic>');

    const bare = (await composeNotice(row, { env: {} }))!;
    expect(bare.split('\n')).toHaveLength(2);
    expect(bare).not.toContain('http');
    expect(await composeNotice(row, { env: { PUBLIC_URL: 'https://ops.ev8.ge.example.com' } })).not.toContain('example');
  });

  it('names no money and no customer in any notice', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { composeNotice, noticeKey } = await import('../src/lib/notices.js');
    const customerName = `ТЕСТ Арендатор Уникальный ${uniq()}`;
    const customer = await prisma.customer.create({ data: { name: customerName } });
    const done = await closedJob({ customerId: customer.id });
    const waiting = await prisma.serviceJob.create({
      data: { vehicleId: done.vehicleId, reason: `test: ${customerName} broke it, 120 GEL`, reasonKind: 'renter_fault', openedOn: new Date(), status: 'draft', payer: 'customer', customerId: customer.id, labourTetri: 12000 },
    });
    const part = await prisma.part.create({ data: { name: `Test cable ${uniq()}`, minQty: 5, salePriceTetri: 98765 } });
    const arrived = await prisma.stockMove.create({ data: { partId: part.id, kind: 'receipt', qty: 1, unitCostTetri: 43210, occurredOn: new Date() } });
    const texts = [
      await composeNotice({ kind: 'job_waiting', entityId: waiting.id, dedupeKey: noticeKey.waiting(waiting.id, 'none') }),
      await composeNotice({ kind: 'job_approved', entityId: done.id, dedupeKey: noticeKey.approved(done.id, 'none') }),
      await composeNotice({ kind: 'job_rejected', entityId: done.id, dedupeKey: noticeKey.rejected(done.id, 'none') }),
      await composeNotice({ kind: 'job_closed', entityId: done.id, dedupeKey: noticeKey.closed(done.id) }),
      await composeNotice({ kind: 'stock_low', entityId: part.id, dedupeKey: noticeKey.stock(part.id, arrived.id) }),
    ];
    for (const t of texts) {
      expect(t).toBeTruthy();
      expect(t).not.toContain(customerName);
      expect(t).not.toContain('Арендатор Уникальный');
      expect(t).not.toMatch(/₾|GEL|ლარ|лари|123[.,]45|67[.,]89|987[.,]65|432[.,]10/);
    }
    // The reason the mechanic picked is named; what he wrote is not.
    expect(texts[0]).toContain('მოიჯარის ბრალი');
    expect(texts[0]).toContain('вина арендатора');
    // Not left waiting: «Сегодня» of the suites after this one shows the first three waiting repairs.
    await prisma.serviceJob.delete({ where: { id: waiting.id } });
  });

  it('does not announce a repair as waiting once it was decided, and sends what is still true', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { deliverNotices } = await import('../src/lib/notices.js');
    const owner = await person('owner');
    const workId = await bookWork(owner.cookie);
    const mech = await person('mechanic', 'Test Mechanic Levan');
    const chief = await person('chief_mechanic', 'Test Chief Nino');
    const v = await moped();
    const opened = await call(mech.cookie, 'POST', '/api/service/workshop', { vehicleId: v.id, reasonKind: 'wear', reason: 'test squeal', odometerKm: 1200, odometerPhoto: PHOTO, photos: [PHOTO], works: [{ workTypeId: workId, qty: 1 }] });
    const id = json<{ id: string }>(opened).id;
    expect((await call(chief.cookie, 'POST', `/api/service/${id}/approve`, {})).statusCode).toBe(200);
    await onlyFor(id);

    const tg = await useTelegram();
    const outcome = await deliverNotices(soon());
    expect(outcome).toEqual({ status: 'ok', sent: 1, failed: 0, pending: 0 });
    expect(tg.asked.every((a) => a.body.chat_id === CHAT)).toBe(true);
    const [text] = tg.texts();
    expect(text).toContain('დამტკიცდა — მუშავდება');
    expect(text).toContain('მექანიკოსი: Test Mechanic Levan · დაამტკიცა: Test Chief Nino');
    expect(text).toContain('согласован — в работе · механик: Test Mechanic Levan · согласовал(а): Test Chief Nino');
    expect(text).toContain(`${STAND}/service/${id}`);
    const rows = await prisma.notice.findMany({ where: { entityId: id }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => [r.kind, r.sentAt != null, r.lastFailure])).toEqual([
      ['job_waiting', false, 'stale'],
      ['job_approved', true, null],
    ]);
    expect(rows[0]!.gaveUpAt).not.toBeNull();
  });

  it('sends only the latest wait of a repair that waited again, not an earlier one left behind', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { deliverNotices } = await import('../src/lib/notices.js');
    const owner = await person('owner');
    const workId = await bookWork(owner.cookie);
    const mech = await person('mechanic', 'Test Mechanic Giorgi');
    const chief = await person('chief_mechanic');
    const v = await moped();
    // Telegram was away: the first wait, the approval and the second wait all pile up.
    const opened = await call(mech.cookie, 'POST', '/api/service/workshop', { vehicleId: v.id, reasonKind: 'wear', reason: 'test squeal', odometerKm: 700, odometerPhoto: PHOTO, photos: [PHOTO], works: [{ workTypeId: workId, qty: 1 }] });
    const id = json<{ id: string }>(opened).id;
    expect((await call(chief.cookie, 'POST', `/api/service/${id}/approve`, {})).statusCode).toBe(200);
    expect((await call(mech.cookie, 'POST', `/api/service/${id}/works`, { works: [{ freeText: 'test: chain', qty: 1 }] })).statusCode).toBe(201);
    await onlyFor(id);

    const tg = await useTelegram();
    expect(await deliverNotices(soon())).toEqual({ status: 'ok', sent: 2, failed: 0, pending: 0 });
    const rows = await prisma.notice.findMany({ where: { entityId: id }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => [r.kind, r.sentAt != null, r.lastFailure])).toEqual([
      ['job_waiting', false, 'stale'],
      ['job_approved', true, null],
      ['job_waiting', true, null],
    ]);
    // The one wait told is the work found later, said once.
    expect(tg.texts().filter((t) => t.includes('ждёт'))).toHaveLength(1);
    expect(tg.texts().find((t) => t.includes('ждёт'))).toContain('новая работа ждёт согласования');
    // Not left waiting: «Сегодня» of the suites after this one shows the first three waiting repairs.
    expect((await call(owner.cookie, 'POST', `/api/service/${id}/cancel`, { reason: 'ТЕСТ done' })).statusCode).toBe(200);
  });

  it('waits as long as Telegram asks on 429, and the rest of the run waits with it', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { deliverNotices } = await import('../src/lib/notices.js');
    const a = await closedJob();
    const b = await closedJob();
    await enqueueClosed(a.id);
    await enqueueClosed(b.id);
    await onlyFor(a.id, b.id);
    const tg = await useTelegram([refused(429, 'Too Many Requests: retry after 30', { retry_after: 30 })]);
    const now = soon();
    expect(await deliverNotices(now)).toEqual({ status: 'ok', sent: 0, failed: 1, pending: 2 });
    expect(tg.asked).toHaveLength(1);
    const first = (await prisma.notice.findMany({ where: { entityId: { in: [a.id, b.id] }, attempts: 1 } }))[0]!;
    expect(first).toMatchObject({ lastFailure: 'rate_limited', lastHttpStatus: 429, sentAt: null, gaveUpAt: null });
    expect(first.nextTryAt.getTime()).toBe(now.getTime() + 30_000);
    // Within the pause nothing goes; after it, both do.
    expect(await deliverNotices(new Date(now.getTime() + 10_000))).toMatchObject({ sent: 0, pending: 2 });
    expect(tg.asked).toHaveLength(1);
    expect(await deliverNotices(new Date(now.getTime() + 31_000))).toEqual({ status: 'ok', sent: 2, failed: 0, pending: 0 });
    expect(tg.asked).toHaveLength(3);
  });

  it('counts the pause of a 429 from the refusal, not from the start of a run that had been sending', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { deliverNotices, setNoticeClockForTests } = await import('../src/lib/notices.js');
    const { setTelegramFetchForTests } = await import('../src/lib/telegram.js');
    const a = await closedJob();
    const b = await closedJob();
    await enqueueClosed(a.id);
    await enqueueClosed(b.id);
    await onlyFor(a.id, b.id);
    // One clock for the run and for the stand-in's three seconds between messages.
    let t = 1_000_000;
    const clock = () => t;
    const tg = fakeTelegram([{ status: 200, body: { ok: true, result: { message_id: 1 } } }, refused(429, 'Too Many Requests: retry after 5', { retry_after: 5 })]);
    setTelegramFetchForTests(tg.fn, { gapMs: 3000, now: clock, sleep: async (ms) => void (t += ms) });
    setNoticeClockForTests(clock);
    const now = soon();
    expect(await deliverNotices(now)).toEqual({ status: 'ok', sent: 1, failed: 1, pending: 1 });
    const [late] = await prisma.notice.findMany({ where: { entityId: { in: [a.id, b.id] }, lastFailure: 'rate_limited' } });
    // Refused three seconds into the run: five seconds from then, not from the start.
    expect(late!.nextTryAt.getTime()).toBe(now.getTime() + 3000 + 5000);
    expect(await deliverNotices(new Date(now.getTime() + 6000))).toMatchObject({ sent: 0, pending: 1 });
    expect(tg.asked).toHaveLength(2);
    expect(await deliverNotices(new Date(now.getTime() + 8000))).toMatchObject({ sent: 1, pending: 0 });
  });

  it('gives a notice up on 403 or a group Telegram does not know, and does not try it again', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { deliverNotices } = await import('../src/lib/notices.js');
    const a = await closedJob();
    await enqueueClosed(a.id);
    await onlyFor(a.id);
    const tg = await useTelegram([refused(403, 'Forbidden: bot was kicked from the group chat')]);
    expect(await deliverNotices(soon())).toEqual({ status: 'ok', sent: 0, failed: 1, pending: 0 });
    const [row] = await noticesOf(a.id);
    expect(row).toMatchObject({ lastFailure: 'forbidden', lastHttpStatus: 403, sentAt: null, attempts: 1 });
    expect(row!.gaveUpAt).not.toBeNull();
    await deliverNotices(new Date(Date.now() + 3_600_000));
    expect(tg.asked).toHaveLength(1);

    const b = await closedJob();
    await enqueueClosed(b.id);
    await useTelegram([refused(400, 'Bad Request: chat not found')]);
    await deliverNotices(soon());
    expect((await noticesOf(b.id))[0]).toMatchObject({ lastFailure: 'chat_not_found', sentAt: null });
    expect((await noticesOf(b.id))[0]!.gaveUpAt).not.toBeNull();
  });

  it('backs off after a failed connection: a minute, then five', async () => {
    const { deliverNotices } = await import('../src/lib/notices.js');
    const a = await closedJob();
    await enqueueClosed(a.id);
    await onlyFor(a.id);
    await useTelegram(['throw', 'throw']);
    const now = soon();
    expect(await deliverNotices(now)).toEqual({ status: 'ok', sent: 0, failed: 1, pending: 1 });
    let [row] = await noticesOf(a.id);
    expect(row).toMatchObject({ attempts: 1, lastFailure: 'network', lastHttpStatus: null });
    expect(row!.nextTryAt.getTime()).toBe(now.getTime() + 60_000);
    const later = new Date(now.getTime() + 61_000);
    await deliverNotices(later);
    [row] = await noticesOf(a.id);
    expect(row!.attempts).toBe(2);
    expect(row!.nextTryAt.getTime()).toBe(later.getTime() + 5 * 60_000);
  });

  it('sends nothing with the link off and the job says `off`; once on, a day-old notice is given up, not sent', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { deliverNotices } = await import('../src/lib/notices.js');
    const { env } = await import('../src/lib/env.js');
    const { getApp } = await import('./helpers.js');
    delete process.env.TELEGRAM_BOT_TOKEN;
    const tg = await useTelegram();
    const a = await closedJob();
    await enqueueClosed(a.id);
    const app = await getApp();
    for (const url of ['/api/jobs/notices', '/api/jobs/notices-scan']) {
      expect((await app.inject({ method: 'POST', url, headers: { 'x-worker-token': 'not-it' } })).statusCode).toBe(401);
      const res = await app.inject({ method: 'POST', url, headers: { 'x-worker-token': env.WORKER_TOKEN } });
      expect(res.statusCode, res.body).toBe(200);
      expect(json<{ status: string; sent: number }>(res)).toMatchObject({ status: 'off', sent: 0 });
    }
    expect(tg.asked).toHaveLength(0);
    expect((await noticesOf(a.id))[0]).toMatchObject({ sentAt: null, gaveUpAt: null });

    // The link comes on a day and an hour later. The row is not back-dated:
    // one written before the run would outlive the run's teardown.
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    await onlyFor(a.id);
    expect(await deliverNotices(new Date(Date.now() + 25 * 3_600_000))).toEqual({ status: 'ok', sent: 0, failed: 0, pending: 0 });
    expect(tg.asked).toHaveLength(0);
    expect((await noticesOf(a.id))[0]).toMatchObject({ sentAt: null, lastFailure: 'expired' });
  });

  it('keeps the token out of every error, outcome, answer, row and log line', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { buildApp } = await import('../src/server.js');
    const { env } = await import('../src/lib/env.js');
    const a = await closedJob();
    const b = await closedJob();
    await enqueueClosed(a.id);
    await enqueueClosed(b.id);
    await onlyFor(a.id, b.id);
    // The failed connection quotes the address — the token in it — as undici's errors can.
    await useTelegram(['throw']);
    const logged: string[] = [];
    const app = buildApp({ logger: { level: 'info', stream: { write: (line: string) => void logged.push(line) } } });
    await app.ready();
    try {
      const res = await app.inject({ method: 'POST', url: '/api/jobs/notices', headers: { 'x-worker-token': env.WORKER_TOKEN } });
      expect(res.statusCode, res.body).toBe(200);
      expect(json<{ status: string; failed: number }>(res)).toMatchObject({ status: 'ok', failed: 1 });
      expect(res.body).not.toContain(TOKEN);
      expect(logged.some((l) => l.includes('telegram did not take every notice'))).toBe(true);
      expect(logged.join('\n')).not.toContain(TOKEN);
      await useTelegram([refused(401, 'Unauthorized')]);
      const again = await app.inject({ method: 'POST', url: '/api/jobs/notices-scan', headers: { 'x-worker-token': env.WORKER_TOKEN } });
      expect(again.body).not.toContain(TOKEN);
      expect(logged.join('\n')).not.toContain(TOKEN);
    } finally {
      await app.close();
    }
    const rows = await prisma.notice.findMany({ where: { entityId: { in: [a.id, b.id] } } });
    expect(JSON.stringify(rows)).not.toContain(TOKEN);
    expect(rows.map((r) => r.lastFailure).sort()).toEqual(['network', 'unauthorized']);
  });

  it('tells the group once per maintenance mark, and again only at the next', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { deliverNotices, scanNotices } = await import('../src/lib/notices.js');
    const v = await moped();
    const t0 = Date.now() - 3 * 86_400_000;
    const at = (h: number) => new Date(t0 + h * 3_600_000);
    const job = (data: { openedOdometerKm: number; odometerKm: number; reasonKind: 'wear' | 'planned'; opened: number }) =>
      prisma.serviceJob.create({
        data: {
          vehicleId: v.id, reason: 'test reading', reasonKind: data.reasonKind, status: 'done', openedOn: at(data.opened), openedAt: at(data.opened),
          openedOdometerKm: data.openedOdometerKm, odometerKm: data.odometerKm, closedOn: at(data.opened + 1), closedAt: at(data.opened + 1),
        },
      });
    // First readings 4 800 and 4 850: the first mark is 5 000, 150 km away — «Пора на ТО».
    await job({ openedOdometerKm: 4800, odometerKm: 4850, reasonKind: 'wear', opened: 0 });
    expect((await scanNotices()).status).toBe('ok');
    expect((await noticesOf(v.id)).map((n) => n.dedupeKey)).toEqual([`maintenance_due:${v.id}:5000`]);
    await scanNotices();
    expect(await noticesOf(v.id)).toHaveLength(1);

    await onlyFor(v.id);
    const tg = await useTelegram();
    expect(await deliverNotices(soon())).toMatchObject({ sent: 1, failed: 0 });
    const [ka, ru, link] = tg.texts()[0]!.split('\n');
    // Thousands apart by a space that does not break.
    expect(ka).toBe(`🛠 მოპედი <b>${label(v)}</b>: გეგმიური მომსახურების დროა — ნიშნული 5\u00a0000 კმ, ახლა 4\u00a0850 კმ, დარჩა 150 კმ`);
    expect(ru).toBe(`Мопед <b>${label(v)}</b>: пора на ТО — отметка 5\u00a0000 км, сейчас 4\u00a0850 км, осталось 150 км`);
    // The sticker's address where the moped has a number: the card for the owners, a planned repair for the chief mechanic.
    expect(link).toBe(v.fleetNo != null ? `${STAND}/m/${encodeURIComponent(fleetNumber(v.fleetNo)!)}?reason=planned` : `${STAND}/fleet/${v.id}`);
    await scanNotices();
    await deliverNotices(soon());
    expect(tg.asked).toHaveLength(1);

    // The planned maintenance closed at 4 980: the next is at 9 980, far off — nothing to tell.
    await job({ openedOdometerKm: 4950, odometerKm: 4980, reasonKind: 'planned', opened: 2 });
    await scanNotices();
    expect(await noticesOf(v.id)).toHaveLength(1);
    // Read at 9 750: the next mark is near, and that is a notice of its own.
    await job({ openedOdometerKm: 9700, odometerKm: 9750, reasonKind: 'wear', opened: 4 });
    await scanNotices();
    expect((await noticesOf(v.id)).map((n) => n.dedupeKey)).toEqual([`maintenance_due:${v.id}:5000`, `maintenance_due:${v.id}:9980`]);
  });

  it('tells the group once a part is below its minimum, and again only after a restock', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { deliverNotices, scanNotices } = await import('../src/lib/notices.js');
    const part = await prisma.part.create({ data: { name: `Test brake pad ${uniq()}`, nameKa: 'სატესტო ხუნდი', minQty: 5 } });
    const move = (kind: 'receipt' | 'issue', qty: number) => prisma.stockMove.create({ data: { partId: part.id, kind, qty, unitCostTetri: 1000, occurredOn: new Date() } });
    const first = await move('receipt', 3);
    await scanNotices();
    expect((await noticesOf(part.id)).map((n) => n.dedupeKey)).toEqual([`stock_low:${part.id}:${first.id}`]);
    await scanNotices();
    expect(await noticesOf(part.id)).toHaveLength(1);

    await onlyFor(part.id);
    const tg = await useTelegram();
    await deliverNotices(soon());
    const [ka, ru, link] = tg.texts()[0]!.split('\n');
    expect(ka).toBe('📦 <b>სატესტო ხუნდი</b> მინიმუმზე ნაკლებია: ნაშთი 3, გვქონდეს არანაკლებ 5');
    expect(ru).toBe(`Деталь <b>${part.name}</b> ниже минимума: остаток 3, держать не меньше 5`);
    expect(link).toBe(`${STAND}/service/stock/parts/${part.id}`);

    // A part taken off a donor only passes through the shelf (ADR-0036): no restock, no new notice.
    const v = await moped();
    const donor = await moped();
    const job = await prisma.serviceJob.create({ data: { vehicleId: v.id, reason: 'test', openedOn: new Date(), status: 'open' } });
    const line = await prisma.servicePart.create({ data: { jobId: job.id, name: part.name, qty: 1, unitPriceTetri: 0, partId: part.id, kind: 'donor', donorVehicleId: donor.id } });
    const { passThrough } = await import('../src/lib/stock.js');
    const { id: actorId } = await makeUser('chief_mechanic');
    await prisma.$transaction((tx) => passThrough(tx, { servicePartId: line.id, partId: part.id, qty: 1, unitCostTetri: 1000, occurredOn: todayISO(), actorId, reason: 'test donor' }));
    await scanNotices();
    expect(await noticesOf(part.id)).toHaveLength(1);

    // Its line taken off the repair, the pass-through's movements name no line any more: still no arrival.
    await prisma.servicePart.delete({ where: { id: line.id } });
    await scanNotices();
    expect(await noticesOf(part.id)).toHaveLength(1);

    // Parts given back — a line taken off a repair, a repair called off — and
    // a stock-take that found one more are no arrival: nothing new to tell.
    await prisma.stockMove.create({ data: { partId: part.id, kind: 'issue', qty: -1, occurredOn: new Date() } });
    await prisma.stockMove.create({ data: { partId: part.id, kind: 'return', qty: 1, unitCostTetri: 1000, occurredOn: new Date(), reason: 'test: line taken off' } });
    await prisma.stockMove.create({ data: { partId: part.id, kind: 'adjust', qty: 1, occurredOn: new Date(), reason: 'test: counted one more' } });
    await scanNotices();
    expect(await noticesOf(part.id)).toHaveLength(1);

    // Restocked above the minimum: nothing; used below it again: told again.
    const restock = await move('receipt', 7);
    await scanNotices();
    expect(await noticesOf(part.id)).toHaveLength(1);
    await move('issue', -7);
    await scanNotices();
    expect((await noticesOf(part.id)).map((n) => n.dedupeKey)).toEqual([`stock_low:${part.id}:${first.id}`, `stock_low:${part.id}:${restock.id}`]);
  });

  it('sends only the notice of the last restock when an earlier one is still waiting', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { deliverNotices, scanNotices } = await import('../src/lib/notices.js');
    const part = await prisma.part.create({ data: { name: `Test cable ${uniq()}`, minQty: 5 } });
    const receipt = (qty: number) => prisma.stockMove.create({ data: { partId: part.id, kind: 'receipt', qty, unitCostTetri: 1000, occurredOn: new Date() } });
    await receipt(2);
    await scanNotices();
    // Telegram away; a small shipment comes in, and the shelf is still short.
    const second = await receipt(1);
    await scanNotices();
    expect(await noticesOf(part.id)).toHaveLength(2);
    await onlyFor(part.id);
    const tg = await useTelegram();
    expect(await deliverNotices(soon())).toEqual({ status: 'ok', sent: 1, failed: 0, pending: 0 });
    expect(tg.texts()[0]).toContain('остаток 3');
    const rows = await noticesOf(part.id);
    expect(rows.map((r) => [r.dedupeKey, r.sentAt != null, r.lastFailure])).toEqual([
      [expect.any(String), false, 'stale'],
      [`stock_low:${part.id}:${second.id}`, true, null],
    ]);
  });
});
