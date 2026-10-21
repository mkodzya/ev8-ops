import { nextWorkCode, normSecFromMinutes } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { audit } from '../lib/audit.js';
import { prisma } from '../lib/db.js';
import { badRequest, isUniqueViolation, notFound } from '../lib/errors.js';
import { actorOf } from '../lib/guard.js';
import { serviceSettings } from '../lib/serviceSettings.js';
import { BOT_SOURCE } from '../lib/workBook.js';
import { str } from '../lib/validate.js';

// The book of works (stage 2 of docs/spec/mechanic-in-erp-plan.md): what a
// mechanic picks from when he writes what he will do, and the norm he is paid
// by. The chief mechanic and the owners keep it (`service.norms`); whoever
// carries a repair reads it. A code never changes and is never given twice,
// and nothing is deleted: a work nobody does any more is switched off, and the
// repairs that used it still name it.

type Body = Record<string, unknown>;

const WORK = {
  id: true,
  code: true,
  category: true,
  nameKa: true,
  nameRu: true,
  nameEn: true,
  normSec: true,
  active: true,
  notes: true,
  source: true,
} as const;

/** The three spellings of a name as the body gives them; an empty field stays empty. */
function names(b: Body): { nameKa?: string | null; nameRu?: string | null; nameEn?: string | null } {
  const out: { nameKa?: string | null; nameRu?: string | null; nameEn?: string | null } = {};
  for (const k of ['nameKa', 'nameRu', 'nameEn'] as const) if (k in b) out[k] = str(b, k, { max: 300 });
  return out;
}

function normOf(b: Body): number {
  const raw = b.normMin;
  if (raw == null || raw === '') throw badRequest('missing_field', 'A work in the book has a norm.', { field: 'normMin' });
  const sec = normSecFromMinutes(raw as string | number);
  if (sec == null) throw badRequest('bad_field', 'A norm is minutes, more than nought.', { field: 'normMin' });
  return sec;
}

const nameless = (n: { nameKa?: string | null; nameRu?: string | null; nameEn?: string | null }) => !n.nameKa && !n.nameRu && !n.nameEn;

export function workBookRoutes(app: FastifyInstance): void {
  app.get('/api/work-book', { config: { scope: 'service.work' } }, async (req) => {
    const [categories, works, me, settings] = await Promise.all([
      prisma.workCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }], select: { code: true, nameKa: true, nameRu: true, nameEn: true } }),
      prisma.workType.findMany({ orderBy: { code: 'asc' }, select: WORK }),
      prisma.user.findUnique({ where: { id: actorOf(req).id }, select: { labourRateTetri: true } }),
      serviceSettings(),
    ]);
    // The mark on the screen: how much of the book is still the bot's, not yet set against the director's sheet.
    const fromBot = works.filter((w) => w.source === BOT_SOURCE).length;
    // The reader's own rate, so the screen can show a mechanic what the works he picks come to.
    return { categories, works, fromBot, botSource: BOT_SOURCE, rateTetri: me?.labourRateTetri ?? settings.defaultRateTetri };
  });

  app.post<{ Body: Body }>('/api/work-book/works', { config: { scope: 'service.norms' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const category = str(b, 'category', { required: true, max: 3 })!;
    if (!(await prisma.workCategory.findUnique({ where: { code: category } }))) throw notFound('work_category_not_found', 'No such category of works.');
    const n = names(b);
    if (nameless(n)) throw badRequest('missing_field', 'A work needs a name in one language at least.', { field: 'nameKa' });
    const normSec = normOf(b);
    const notes = str(b, 'notes', { max: 1000 });
    // The next number of the category. Two people adding at once both reach
    // for it; the second takes the one after.
    for (let attempt = 0; ; attempt++) {
      const codes = (await prisma.workType.findMany({ where: { category }, select: { code: true } })).map((w) => w.code);
      const code = nextWorkCode(category, codes);
      try {
        const row = await prisma.workType.create({ data: { code, category, ...n, normSec, notes, createdById: actor.id }, select: WORK });
        await audit({ actorId: actor.id, action: 'work_type.create', entityType: 'work_type', entityId: row.id, after: { code, ...n, normSec, notes } });
        return reply.code(201).send(row);
      } catch (e) {
        if (!isUniqueViolation(e) || attempt >= 2) throw e;
      }
    }
  });

  app.patch<{ Params: { id: string }; Body: Body }>('/api/work-book/works/:id', { config: { scope: 'service.norms' } }, async (req) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const was = await prisma.workType.findUnique({ where: { id: req.params.id }, select: WORK });
    if (!was) throw notFound('work_type_not_found', 'No such work in the book.');
    const data: Record<string, unknown> = { ...names(b) };
    if (nameless({ nameKa: was.nameKa, nameRu: was.nameRu, nameEn: was.nameEn, ...(data as object) })) {
      throw badRequest('missing_field', 'A work needs a name in one language at least.', { field: 'nameKa' });
    }
    // A new norm is for the lines written from now on; the ones already on
    // repairs keep the norm they were written with.
    if ('normMin' in b) data.normSec = normOf(b);
    if ('active' in b) {
      if (typeof b.active !== 'boolean') throw badRequest('bad_field', 'active is yes or no.', { field: 'active' });
      data.active = b.active;
    }
    if ('notes' in b) data.notes = str(b, 'notes', { max: 1000 });
    const changed = Object.keys(data).filter((k) => (was as Record<string, unknown>)[k] !== data[k]);
    if (changed.length === 0) return { ok: true, work: was };
    const work = await prisma.workType.update({ where: { id: was.id }, data: { ...data, updatedAt: new Date() }, select: WORK });
    await audit({
      actorId: actor.id,
      action: 'work_type.update',
      entityType: 'work_type',
      entityId: was.id,
      before: Object.fromEntries(changed.map((k) => [k, (was as Record<string, unknown>)[k]])),
      after: { code: was.code, ...Object.fromEntries(changed.map((k) => [k, data[k]])) },
    });
    return { ok: true, work };
  });

  /** A category's name, translated once for all its works. */
  app.patch<{ Params: { code: string }; Body: Body }>('/api/work-book/categories/:code', { config: { scope: 'service.norms' } }, async (req) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const was = await prisma.workCategory.findUnique({ where: { code: req.params.code } });
    if (!was) throw notFound('work_category_not_found', 'No such category of works.');
    const data = names(b);
    if (nameless({ nameKa: was.nameKa, nameRu: was.nameRu, nameEn: was.nameEn, ...data })) {
      throw badRequest('missing_field', 'A category needs a name in one language at least.', { field: 'nameKa' });
    }
    const category = await prisma.workCategory.update({ where: { code: was.code }, data, select: { code: true, nameKa: true, nameRu: true, nameEn: true } });
    await audit({
      actorId: actor.id,
      action: 'work_category.update',
      entityType: 'work_category',
      entityId: null,
      before: { code: was.code, nameKa: was.nameKa, nameRu: was.nameRu, nameEn: was.nameEn },
      after: { code: was.code, ...data },
    });
    return { ok: true, category };
  });
}
