import {
  REMINDER_AMOUNT_FIELD,
  REMINDER_BOT_KEYS,
  REMINDER_META_NAME,
  kommoLeadId,
  type ReminderBotKey,
  MAINTENANCE_INTERVAL_MAX_KM,
  MAINTENANCE_INTERVAL_MIN_KM,
  PIN_IDLE_MINUTES,
  PIN_LOCK_MINUTES,
  PIN_MAX_DIGITS,
  PIN_MAX_FAILURES,
  PIN_MIN_DIGITS,
  todayISO,
} from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { audit } from '../lib/audit.js';
import { dateFromISO } from '../lib/dates.js';
import { MAX_ATTEMPTS, SESSION_IDLE_MS, SESSION_TTL_MS } from '../lib/auth.js';
import { env, isDevStack } from '../lib/env.js';
import { prisma } from '../lib/db.js';
import { badRequest, conflict, isUniqueViolation, notFound } from '../lib/errors.js';
import { actorOf, mayView } from '../lib/guard.js';
import { kommoConfig } from '../lib/kommo.js';
import { reminderSendMode, reminderSettings } from '../lib/reminders.js';
import { serviceSettings } from '../lib/serviceSettings.js';
import { int, str, strList, tetri } from '../lib/validate.js';

// What a hand-over proposes when nobody says otherwise (wave 6 §3.5, R5).
//
// The deposit was a constant in the code and the weekly rates were nowhere:
// every hand-over typed the rate by hand. Both are settings now, an owner
// edits them, and every change goes to the journal — a figure that decides
// money has to say who moved it and from what.
//
// The model's own rate still goes in first: these are the buttons beside it,
// not a replacement for it.

type Body = Record<string, unknown>;

// A handful of deals to try the sending on; a long list is not a test any more.
const MAX_TEST_LEADS = 20;

/** The one row, made on the first read if the migration's row ever went missing. */
export async function settingsRow() {
  return (
    (await prisma.rentalSettings.findUnique({ where: { id: true } })) ??
    (await prisma.rentalSettings.create({ data: { id: true } }))
  );
}

export function settingsRoutes(app: FastifyInstance): void {
  /**
   * The rules of signing in (wave 6 §3.9). Read from the code, not typed on
   * the screen: they are constants, and a screen that keeps its own copy of
   * a constant is a screen that will one day disagree with it.
   */
  app.get('/api/settings/login', { config: { scope: 'users.manage' } }, async () => ({
    sessionDays: Math.round(SESSION_TTL_MS / 86_400_000),
    idleDays: Math.round(SESSION_IDLE_MS / 86_400_000),
    maxAttempts: MAX_ATTEMPTS,
    demoLoginsRefused: !isDevStack(),
    // The workshop tablet (ADR-0033 §6–7).
    pin: { minDigits: PIN_MIN_DIGITS, maxDigits: PIN_MAX_DIGITS, maxFailures: PIN_MAX_FAILURES, lockMinutes: PIN_LOCK_MINUTES, idleMinutes: PIN_IDLE_MINUTES },
  }));

  /** Read by anyone who hands a moped over; written by an owner. */
  app.get('/api/settings/rental', { config: { scope: 'rental.create' } }, async () => {
    const [row, rates] = await Promise.all([
      settingsRow(),
      prisma.quickRate.findMany({ where: { archived: false }, orderBy: [{ sortOrder: 'asc' }, { rateTetri: 'asc' }] }),
    ]);
    return {
      depositTetri: row.depositTetri,
      stickerPhone: row.stickerPhone,
      quickRates: rates.map((r) => ({ id: r.id, rateTetri: r.rateTetri })),
    };
  });

  /** The telephone on the moped stickers (migration 0043); empty — the stickers leave the line out. */
  app.patch<{ Body: Body }>('/api/settings/sticker', { config: { scope: 'settings.manage' } }, async (req) => {
    const actor = actorOf(req);
    const before = await settingsRow();
    const phone = str(req.body ?? {}, 'stickerPhone', { max: 40 });
    if (phone === before.stickerPhone) return { ok: true, stickerPhone: phone };
    await prisma.rentalSettings.update({ where: { id: true }, data: { stickerPhone: phone, updatedById: actor.id, updatedAt: new Date() } });
    await audit({
      actorId: actor.id,
      action: 'settings.sticker_phone',
      entityType: 'settings',
      entityId: 'rental',
      before: { stickerPhone: before.stickerPhone },
      after: { stickerPhone: phone },
    });
    return { ok: true, stickerPhone: phone };
  });

  app.patch<{ Body: Body }>('/api/settings/rental', { config: { scope: 'settings.manage' } }, async (req) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const before = await settingsRow();
    const depositTetri = tetri(b, 'depositTetri', { required: true, min: 0 })!;
    if (depositTetri === before.depositTetri) return { ok: true, depositTetri };
    await prisma.rentalSettings.update({
      where: { id: true },
      data: { depositTetri, updatedById: actor.id, updatedAt: new Date() },
    });
    await audit({
      actorId: actor.id,
      action: 'settings.deposit',
      entityType: 'settings',
      entityId: 'rental',
      before: { depositTetri: before.depositTetri },
      after: { depositTetri },
    });
    return { ok: true, depositTetri };
  });

  /**
   * The repair settings (stage 6; ADR-0038 §3): the company rate for an hour
   * of norm, and the interval and the warning of the planned maintenance.
   * Read by anyone who works on repairs — the tablet says how far the next
   * maintenance is — but the rate only by whoever sees the work's money, as a
   * repair shows it (ADR-0033 §4).
   */
  app.get('/api/settings/service', { config: { scope: 'service.view' } }, async (req) => {
    const row = await serviceSettings();
    const by = row.updatedById ? await prisma.user.findUnique({ where: { id: row.updatedById }, select: { name: true } }) : null;
    const seesWork = mayView(req, 'cost.view') || mayView(req, 'service.work');
    return {
      defaultRateTetri: seesWork ? row.defaultRateTetri : null,
      maintenanceIntervalKm: row.maintenanceIntervalKm,
      maintenanceWarnKm: row.maintenanceWarnKm,
      updatedAt: row.updatedAt?.toISOString() ?? null,
      updatedBy: by?.name ?? null,
    };
  });

  /** An owner's to change, each change in the journal: a rate decides money. */
  app.patch<{ Body: Body }>('/api/settings/service', { config: { scope: 'settings.manage' } }, async (req) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const before = await serviceSettings();
    const was = { defaultRateTetri: before.defaultRateTetri, maintenanceIntervalKm: before.maintenanceIntervalKm, maintenanceWarnKm: before.maintenanceWarnKm };
    const now = {
      defaultRateTetri: tetri(b, 'defaultRateTetri', { min: 1 }) ?? was.defaultRateTetri,
      maintenanceIntervalKm: int(b, 'maintenanceIntervalKm', { min: MAINTENANCE_INTERVAL_MIN_KM, max: MAINTENANCE_INTERVAL_MAX_KM }) ?? was.maintenanceIntervalKm,
      maintenanceWarnKm: int(b, 'maintenanceWarnKm', { min: 0 }) ?? was.maintenanceWarnKm,
    };
    // A warning as long as the interval would call every moped all the time.
    if (now.maintenanceWarnKm >= now.maintenanceIntervalKm) {
      throw badRequest('bad_field', 'The warning is shorter than the interval.', { field: 'maintenanceWarnKm', maxKm: now.maintenanceIntervalKm - 1 });
    }
    const changed = (Object.keys(now) as (keyof typeof now)[]).filter((k) => now[k] !== was[k]);
    if (changed.length === 0) return { ok: true, ...now };
    await prisma.serviceSettings.upsert({
      where: { id: true },
      create: { id: true, ...now, updatedById: actor.id, updatedAt: new Date() },
      update: { ...now, updatedById: actor.id, updatedAt: new Date() },
    });
    await audit({
      actorId: actor.id,
      action: 'settings.service',
      entityType: 'settings',
      entityId: 'service',
      before: Object.fromEntries(changed.map((k) => [k, was[k]])),
      after: Object.fromEntries(changed.map((k) => [k, now[k]])),
    });
    return { ok: true, ...now };
  });

  /**
   * The rent reminders through Kommo (ADR-0053): how far this stand sends —
   * its own, set on the server, shown and not changed here — and the owner's
   * side: a pause for every stand, the six bots, the test deals. What went
   * today is counted, not listed: the list is «К звонку».
   */
  app.get('/api/settings/reminders', { config: { scope: 'settings.manage' } }, async () => {
    const s = await reminderSettings();
    const by = s.updatedById ? await prisma.user.findUnique({ where: { id: s.updatedById }, select: { name: true } }) : null;
    const today = await prisma.rentReminder.groupBy({ by: ['mode'], where: { day: dateFromISO(todayISO(new Date(), env.TZ))! }, _count: true });
    const failures = await prisma.rentReminder.groupBy({ by: ['failure'], where: { day: dateFromISO(todayISO(new Date(), env.TZ))!, mode: 'failed' }, _count: true });
    return {
      sendMode: reminderSendMode(),
      kommo: kommoConfig() != null,
      paused: s.paused,
      bots: Object.fromEntries(REMINDER_BOT_KEYS.map((k) => [k, s.bots[k] ?? null])),
      testLeads: s.testLeads,
      amountField: REMINDER_AMOUNT_FIELD,
      templates: REMINDER_META_NAME,
      today: Object.fromEntries(today.map((r) => [r.mode, r._count])),
      failures: Object.fromEntries(failures.map((r) => [r.failure ?? '', r._count])),
      updatedAt: s.updatedAt.toISOString(),
      updatedBy: by?.name ?? null,
    };
  });

  /** An owner's; every change in the journal — the bots and the test deals decide who gets a message. */
  app.patch<{ Body: Body }>('/api/settings/reminders', { config: { scope: 'settings.manage' } }, async (req) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const before = await reminderSettings();
    const was = { paused: before.paused, bots: before.bots, testLeads: before.testLeads };
    const now = { ...was };

    if (b.paused !== undefined) {
      if (typeof b.paused !== 'boolean') throw badRequest('bad_field', 'paused is true or false', { field: 'paused' });
      now.paused = b.paused;
    }
    if (b.bots !== undefined) {
      if (!b.bots || typeof b.bots !== 'object' || Array.isArray(b.bots)) throw badRequest('bad_field', 'bots is an object', { field: 'bots' });
      const bots: Partial<Record<ReminderBotKey, number>> = { ...was.bots };
      for (const [k, v] of Object.entries(b.bots as Record<string, unknown>)) {
        if (!(REMINDER_BOT_KEYS as string[]).includes(k)) throw badRequest('bad_field', `no bot ${k}`, { field: 'bots' });
        const key = k as ReminderBotKey;
        const text = v == null ? '' : String(v).trim();
        if (text === '') delete bots[key];
        else if (/^\d{1,12}$/.test(text) && Number(text) > 0) bots[key] = Number(text);
        else throw badRequest('bad_field', 'A bot is a number', { field: `bots.${key}` });
      }
      now.bots = bots;
    }
    if (b.testLeads !== undefined) {
      const raw = typeof b.testLeads === 'string' ? b.testLeads.split(/[\s,;]+/) : strList(b, 'testLeads');
      const leads: string[] = [];
      for (const x of raw.map((y) => y.trim()).filter(Boolean)) {
        const id = kommoLeadId(x);
        if (!id) throw badRequest('bad_field', 'A test deal is a Kommo deal number or link', { field: 'testLeads' });
        if (!leads.includes(id)) leads.push(id);
      }
      if (leads.length > MAX_TEST_LEADS) throw badRequest('bad_field', `At most ${MAX_TEST_LEADS} test deals`, { field: 'testLeads' });
      now.testLeads = leads;
    }

    const same = (k: keyof typeof now) => JSON.stringify(now[k]) === JSON.stringify(was[k]);
    const changed = (Object.keys(now) as (keyof typeof now)[]).filter((k) => !same(k));
    if (changed.length === 0) return { ok: true };
    await prisma.reminderSettings.update({ where: { id: true }, data: { paused: now.paused, bots: now.bots, testLeads: now.testLeads, updatedById: actor.id, updatedAt: new Date() } });
    await audit({
      actorId: actor.id,
      action: 'settings.reminders',
      entityType: 'settings',
      entityId: 'reminders',
      before: Object.fromEntries(changed.map((k) => [k, was[k]])),
      after: Object.fromEntries(changed.map((k) => [k, now[k]])),
    });
    return { ok: true };
  });

  app.post<{ Body: Body }>('/api/settings/rates', { config: { scope: 'settings.manage' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const rateTetri = tetri(b, 'rateTetri', { required: true, min: 1 })!;
    try {
      const rate = await prisma.quickRate.create({
        data: { rateTetri, sortOrder: int(b, 'sortOrder', { min: 0, max: 999 }) ?? 0, createdById: actor.id },
        select: { id: true },
      });
      await audit({ actorId: actor.id, action: 'settings.rate.add', entityType: 'settings', entityId: 'rental', after: { rateTetri } });
      return reply.code(201).send({ id: rate.id });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('duplicate_rate', 'That rate is already one of the buttons.', { field: 'rateTetri' });
      throw e;
    }
  });

  /**
   * A rate leaves the buttons; it does not leave the rentals that carry it.
   * Archiving rather than deleting is what keeps an old rental's 140 ₾ true.
   */
  app.delete<{ Params: { id: string } }>('/api/settings/rates/:id', { config: { scope: 'settings.manage' } }, async (req) => {
    const actor = actorOf(req);
    const rate = await prisma.quickRate.findUnique({ where: { id: req.params.id } });
    if (!rate || rate.archived) throw notFound('rate_not_found', 'No such rate.');
    await prisma.quickRate.update({ where: { id: rate.id }, data: { archived: true } });
    await audit({ actorId: actor.id, action: 'settings.rate.remove', entityType: 'settings', entityId: 'rental', before: { rateTetri: rate.rateTetri } });
    return { ok: true };
  });
}
