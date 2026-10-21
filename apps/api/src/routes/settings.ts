import {
  MAINTENANCE_INTERVAL_MAX_KM,
  MAINTENANCE_INTERVAL_MIN_KM,
  PIN_IDLE_MINUTES,
  PIN_LOCK_MINUTES,
  PIN_MAX_DIGITS,
  PIN_MAX_FAILURES,
  PIN_MIN_DIGITS,
} from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { audit } from '../lib/audit.js';
import { MAX_ATTEMPTS, SESSION_IDLE_MS, SESSION_TTL_MS } from '../lib/auth.js';
import { isDevStack } from '../lib/env.js';
import { prisma } from '../lib/db.js';
import { badRequest, conflict, isUniqueViolation, notFound } from '../lib/errors.js';
import { actorOf, mayView } from '../lib/guard.js';
import { serviceSettings } from '../lib/serviceSettings.js';
import { int, str, tetri } from '../lib/validate.js';

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
