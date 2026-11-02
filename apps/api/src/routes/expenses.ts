import { todayISO, weekOf } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { dateFromISO } from '../lib/dates.js';
import { env } from '../lib/env.js';
import { audit } from '../lib/audit.js';
import { prisma } from '../lib/db.js';
import { foreignTally, lariOf } from '../lib/statements/foreign.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { actorOf } from '../lib/guard.js';
import { date, str } from '../lib/validate.js';

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

  /**
   * «Отчёты → Расходы»: what left the accounts in a period, by what it was —
   * expenses by category, deposits handed back, suppliers paid, money between
   * the company's own accounts — and what still waits in «Разобрать» (the
   * report of variant 1, Mika 15.10.2026). Lines set aside as "not ours" are
   * not the company's money and are left out. The report is in lari: a line
   * of an account in another currency counts in its rows at the lari it was
   * sorted at, and while it waits it is in `foreign` only, in its own currency
   * (migration 0076; decision D2). «Обмен валюты» is a row of its own.
   */
  app.get<{ Querystring: { from?: string; to?: string } }>('/api/reports/expenses', { config: { scope: 'reports.view' } }, async (req) => {
    const week = weekOf(todayISO(new Date(), env.TZ));
    const from = date(req.query, 'from') ?? week.from;
    const to = date(req.query, 'to') ?? week.to;
    if (from > to) throw badRequest('bad_period', 'The period starts after it ends.', { field: 'from' });
    const lines = await prisma.statementLine.findMany({
      where: { direction: 'out', occurredOn: { gte: dateFromISO(from)!, lte: dateFromISO(to)! } },
      select: {
        currency: true,
        amountTetri: true,
        gelTetri: true,
        status: true,
        resolution: true,
        expenseCategoryId: true,
        expenseParts: { select: { amountTetri: true, categoryId: true } },
        payments: { where: { voidedAt: null }, select: { kind: true, grossTetri: true } },
      },
    });
    const byCategory = new Map<string | null, { tetri: number; lines: number }>();
    const other = { depositsBack: 0, suppliers: 0, ownTransfers: 0, shareholder: 0, fxExchange: 0, unsorted: 0, unsortedLines: 0, otherPaid: 0 };
    const foreign = foreignTally();
    for (const l of lines) {
      if (foreign.take(l)) continue;
      // Lari: the line's own, or what a line in another currency was sorted at.
      const money = lariOf(l) ?? 0;
      if (l.status === 'unmatched') {
        other.unsorted += l.amountTetri;
        other.unsortedLines++;
      } else if (l.resolution === 'company_expense') {
        // A line split into expenses counts each part in its category (ADR-0030).
        const pieces = l.expenseParts.length > 0 ? l.expenseParts.map((p) => ({ categoryId: p.categoryId as string | null, tetri: p.amountTetri })) : [{ categoryId: l.expenseCategoryId, tetri: money }];
        for (const piece of pieces) {
          const row = byCategory.get(piece.categoryId) ?? { tetri: 0, lines: 0 };
          row.tetri += piece.tetri;
          row.lines++;
          byCategory.set(piece.categoryId, row);
        }
      } else if (l.resolution === 'own_transfer') {
        other.ownTransfers += money;
      } else if (l.resolution === 'shareholder') {
        // Taken out by a shareholder (ADR-0029): left the accounts, not spent.
        other.shareholder += money;
      } else if (l.resolution === 'fx_exchange') {
        // One leg of a currency exchange (0076): neither spent nor earned.
        other.fxExchange += money;
      } else if (l.status === 'matched') {
        const kind = l.payments[0]?.kind;
        if (kind === 'deposit_payout') other.depositsBack += money;
        else if (kind === 'supplier') other.suppliers += money;
        else other.otherPaid += money;
      }
    }
    const categories = [...byCategory.entries()].map(([categoryId, v]) => ({ categoryId, tetri: v.tetri, lines: v.lines })).sort((a, b) => b.tetri - a.tetri);
    const expensesTetri = categories.reduce((n, c) => n + c.tetri, 0);
    return {
      from,
      to,
      categories,
      expensesTetri,
      ...other,
      foreign: foreign.list(),
      totalOutTetri: expensesTetri + other.depositsBack + other.suppliers + other.ownTransfers + other.shareholder + other.fxExchange + other.otherPaid + other.unsorted,
    };
  });
}
