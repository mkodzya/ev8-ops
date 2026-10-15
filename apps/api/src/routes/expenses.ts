import type { FastifyInstance } from 'fastify';
import { audit } from '../lib/audit.js';
import { prisma } from '../lib/db.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { actorOf } from '../lib/guard.js';
import { str } from '../lib/validate.js';

// What money going out was for (migration 0046): the categories an owner
// keeps, and the remembered payees, which an owner may forget.

type Body = Record<string, unknown>;

const shape = (c: { id: string; nameRu: string; nameKa: string | null; nameEn: string | null; archived: boolean }) => ({
  id: c.id,
  nameRu: c.nameRu,
  nameKa: c.nameKa,
  nameEn: c.nameEn,
  archived: c.archived,
});

export function expenseRoutes(app: FastifyInstance): void {
  /** The live categories, in the owner's order; read by whoever sorts the queue. */
  app.get<{ Querystring: { all?: string } }>('/api/expense-categories', { config: { scope: 'payments.reconcile' } }, async (req) => {
    const rows = await prisma.expenseCategory.findMany({
      where: req.query.all === '1' ? {} : { archived: false },
      orderBy: [{ archived: 'asc' }, { sortOrder: 'asc' }, { nameRu: 'asc' }],
    });
    return { categories: rows.map(shape) };
  });

  app.post<{ Body: Body }>('/api/expense-categories', { config: { scope: 'settings.manage' } }, async (req, reply) => {
    const actor = actorOf(req);
    const b = req.body ?? {};
    const nameRu = str(b, 'nameRu', { required: true, max: 80 })!;
    const taken = await prisma.expenseCategory.findFirst({ where: { archived: false, nameRu: { equals: nameRu, mode: 'insensitive' } }, select: { id: true } });
    if (taken) throw conflict('category_exists', 'There is a category by that name already.', { field: 'nameRu' });
    const last = await prisma.expenseCategory.aggregate({ _max: { sortOrder: true } });
    const row = await prisma.expenseCategory.create({
      data: { nameRu, nameKa: str(b, 'nameKa', { max: 80 }), nameEn: str(b, 'nameEn', { max: 80 }), sortOrder: (last._max.sortOrder ?? 0) + 1, createdById: actor.id },
    });
    await audit({ actorId: actor.id, action: 'expense.category.add', entityType: 'expense_category', entityId: row.id, after: { nameRu } });
    return reply.code(201).send(shape(row));
  });

  app.patch<{ Params: { id: string }; Body: Body }>('/api/expense-categories/:id', { config: { scope: 'settings.manage' } }, async (req) => {
    const actor = actorOf(req);
    const b = req.body ?? {};
    const before = await prisma.expenseCategory.findUnique({ where: { id: req.params.id } });
    if (!before) throw notFound('category_not_found', 'No such expense category.');
    const data: Record<string, unknown> = {};
    if ('nameRu' in b) data.nameRu = str(b, 'nameRu', { required: true, max: 80 });
    if ('nameKa' in b) data.nameKa = str(b, 'nameKa', { max: 80 });
    if ('nameEn' in b) data.nameEn = str(b, 'nameEn', { max: 80 });
    if ('archived' in b) {
      if (typeof b.archived !== 'boolean') throw badRequest('bad_field', 'archived is true or false', { field: 'archived' });
      data.archived = b.archived;
    }
    const row = await prisma.expenseCategory.update({ where: { id: before.id }, data });
    // A category taken off the list keeps its lines; its remembered payees stop sorting into it.
    if (data.archived === true) await prisma.expenseRule.updateMany({ where: { categoryId: before.id, archivedAt: null }, data: { archivedAt: new Date(), archivedById: actor.id } });
    await audit({ actorId: actor.id, action: 'expense.category.edit', entityType: 'expense_category', entityId: row.id, before: shape(before), after: shape(row) });
    return shape(row);
  });

  /** «Забыть правило»: the payee's next line waits for a person again; what it sorted stays sorted. */
  app.post<{ Params: { id: string } }>('/api/expense-rules/:id/forget', { config: { scope: 'payments.reconcile' } }, async (req) => {
    const actor = actorOf(req);
    const done = await prisma.expenseRule.updateMany({ where: { id: req.params.id, archivedAt: null }, data: { archivedAt: new Date(), archivedById: actor.id } });
    if (done.count === 0) throw notFound('rule_not_found', 'No such remembered payee.');
    await audit({ actorId: actor.id, action: 'expense.rule.forget', entityType: 'expense_rule', entityId: req.params.id });
    return { ok: true };
  });
}
