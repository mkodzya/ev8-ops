import type { FastifyInstance } from 'fastify';
import { audit } from '../lib/audit.js';
import { prisma } from '../lib/db.js';
import { conflict, isUniqueViolation, notFound } from '../lib/errors.js';
import { actorOf } from '../lib/guard.js';
import { int, tetri } from '../lib/validate.js';

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
async function settingsRow() {
  return (
    (await prisma.rentalSettings.findUnique({ where: { id: true } })) ??
    (await prisma.rentalSettings.create({ data: { id: true } }))
  );
}

export function settingsRoutes(app: FastifyInstance): void {
  /** Read by anyone who hands a moped over; written by an owner. */
  app.get('/api/settings/rental', { config: { scope: 'rental.create' } }, async () => {
    const [row, rates] = await Promise.all([
      settingsRow(),
      prisma.quickRate.findMany({ where: { archived: false }, orderBy: [{ sortOrder: 'asc' }, { rateTetri: 'asc' }] }),
    ]);
    return {
      depositTetri: row.depositTetri,
      quickRates: rates.map((r) => ({ id: r.id, rateTetri: r.rateTetri })),
    };
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
