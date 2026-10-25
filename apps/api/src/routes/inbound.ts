import { todayISO, weekOf } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { audit } from '../lib/audit.js';
import { dateFromISO } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { env } from '../lib/env.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { actorOf } from '../lib/guard.js';
import { voidPayment } from '../lib/payments.js';
import { BACK_TO_QUEUE, setAside } from '../lib/statements/aside.js';
import { OPTION_KINDS, optionsFor, type OptionKind } from '../lib/statements/options.js';
import { rememberPayer } from '../lib/statements/payers.js';
import { storedLine } from '../lib/statements/reconcile.js';
import { date, str, strList } from '../lib/validate.js';
import { UNDO_MS } from './payments.js';
import { incomingKey } from './statements.js';

// Money coming in, answered by its kind (issue #13 of the director,
// 25.10.2026; ADR-0046; migration 0069): the panel's options, «Взнос
// учредителя», «Прочий доход ▸» with the categories an owner keeps, the
// remembered payers, and «Отчёты → Поступления».

type Body = Record<string, unknown>;

const shape = (c: { id: string; nameRu: string; nameKa: string | null; nameEn: string | null; archived: boolean }) => ({
  id: c.id,
  nameRu: c.nameRu,
  nameKa: c.nameKa,
  nameEn: c.nameEn,
  archived: c.archived,
});

async function incoming(lineId: string) {
  const line = await prisma.statementLine.findUnique({ where: { id: lineId } });
  if (!line) throw notFound('line_not_found', 'No such statement line.');
  if (line.direction !== 'in') throw conflict('not_incoming', 'Only money coming in is answered so.');
  return line;
}

export function inboundRoutes(app: FastifyInstance): void {
  /** The panel beside a line, once its kind is chosen: what the money can go on, the probable first. */
  app.get<{ Params: { id: string }; Querystring: { kind?: string; q?: string } }>('/api/statement-lines/:id/options', { config: { scope: 'payments.reconcile' } }, async (req) => {
    const kind = req.query.kind as OptionKind;
    if (!OPTION_KINDS.includes(kind)) throw badRequest('bad_field', `kind is one of ${OPTION_KINDS.join(', ')}`, { field: 'kind' });
    const line = await incoming(req.params.id);
    return { kind, options: await optionsFor(storedLine(line), kind, req.query.q ?? '') };
  });

  /**
   * «Взнос учредителя»: money a founder put into the company — not revenue,
   * and not somebody else's; the mirror of «Акционеру» (ADR-0029). Money
   * coming in only. Its payer may be remembered.
   */
  app.post<{ Params: { id: string }; Body: Body }>('/api/statement-lines/:id/founder-equity', { config: { scope: 'payments.reconcile' } }, async (req) => {
    const actor = actorOf(req);
    await incoming(req.params.id);
    const key = (req.body ?? {}).remember === true ? await incomingKey(req.params.id) : null;
    await setAside(req.params.id, actor.id, 'founder_equity', null);
    await audit({ actorId: actor.id, action: 'statement.line.founder_equity', entityType: 'statement_line', entityId: req.params.id });
    if (!key) return { ok: true };
    return { ok: true, ...(await rememberPayer({ actorId: actor.id, key, kind: 'founder_equity', customerId: null, categoryId: null, lineId: req.params.id })) };
  });

  /** «Прочий доход ▸»: money coming in that is no customer's, with its category. */
  app.post<{ Params: { id: string }; Body: Body }>('/api/statement-lines/:id/other-income', { config: { scope: 'payments.reconcile' } }, async (req) => {
    const actor = actorOf(req);
    const b = req.body ?? {};
    const categoryId = str(b, 'categoryId', { required: true })!;
    await incoming(req.params.id);
    const c = await prisma.incomeCategory.findUnique({ where: { id: categoryId }, select: { archived: true } });
    if (!c || c.archived) throw notFound('income_category_not_found', 'No such income category.');
    const key = b.remember === true ? await incomingKey(req.params.id) : null;
    await setAside(req.params.id, actor.id, 'other_income', null, null, prisma, categoryId);
    await audit({ actorId: actor.id, action: 'statement.line.other_income', entityType: 'statement_line', entityId: req.params.id, after: { categoryId } });
    if (!key) return { ok: true };
    return { ok: true, ...(await rememberPayer({ actorId: actor.id, key, kind: 'other_income', customerId: null, categoryId, lineId: req.params.id })) };
  });

  /** «Забыть правило»: the payer's next line waits for a person again; what the rule sorted stays sorted. */
  app.post<{ Params: { id: string } }>('/api/payer-rules/:id/forget', { config: { scope: 'payments.reconcile' } }, async (req) => {
    const actor = actorOf(req);
    const done = await prisma.payerRule.updateMany({ where: { id: req.params.id, archivedAt: null }, data: { archivedAt: new Date(), archivedById: actor.id } });
    if (done.count === 0) throw notFound('payer_rule_not_found', 'No such remembered payer.');
    await audit({ actorId: actor.id, action: 'payer.rule.forget', entityType: 'payer_rule', entityId: req.params.id });
    return { ok: true };
  });

  /**
   * «Отменить» right after an answer with «Запомнить»: the rule is put away
   * and the lines it sorted in the same tap wait again — a payment it wrote
   * is annulled. The line the person answered is taken back by its own undo.
   *
   * The same tap only, as a payment's «Отменить» (`/api/payments/:id/undo`):
   * the person who remembered the payer, within `UNDO_MS` of it, and only the
   * lines he sorted then — `lines`, the ids the tap returned as `alsoSorted`,
   * narrows it further. A line the rule sorted later, from a statement loaded
   * afterwards, is taken back by itself with «Отвязать»; the rule is
   * forgotten with «Забыть правило» (review of 25.10.2026, ADR-0046 addendum).
   */
  app.post<{ Params: { id: string }; Body: Body }>('/api/payer-rules/:id/undo', { config: { scope: 'payments.reconcile' } }, async (req) => {
    const actor = actorOf(req);
    const b = req.body ?? {};
    const asked = Array.isArray(b.lines) ? new Set(strList(b, 'lines')) : null;
    const rule = await prisma.payerRule.findUnique({ where: { id: req.params.id }, select: { id: true, createdById: true, createdAt: true } });
    if (!rule) throw notFound('payer_rule_not_found', 'No such remembered payer.');
    if (rule.createdById !== actor.id || Date.now() - rule.createdAt.getTime() > UNDO_MS) {
      throw conflict('payer_rule_undo_too_late', 'Too late to undo: forget the rule, and unlink what it sorted one line at a time.');
    }
    // What the tap itself did: by this person, before the minute ran out.
    const until = rule.createdAt.getTime() + UNDO_MS;
    const inTap = (id: string, by: string | null, at: Date | null) => by === actor.id && at != null && at.getTime() <= until && (asked == null || asked.has(id));
    await prisma.payerRule.updateMany({ where: { id: rule.id, archivedAt: null }, data: { archivedAt: new Date(), archivedById: actor.id } });
    const lines = await prisma.statementLine.findMany({
      where: { payerRuleId: rule.id },
      select: { id: true, status: true, resolvedById: true, resolvedAt: true, payments: { where: { voidedAt: null, source: 'statement' }, select: { id: true, createdById: true, createdAt: true } } },
    });
    let restored = 0;
    for (const l of lines) {
      const p = l.payments[0];
      if (l.status === 'matched' && p && inTap(l.id, p.createdById, p.createdAt)) {
        await voidPayment({ actorId: actor.id, paymentId: p.id, reason: 'undone with the payer remembered', kind: 'undo' });
        restored++;
      } else if (l.status === 'ignored' && inTap(l.id, l.resolvedById, l.resolvedAt)) {
        restored += (await prisma.statementLine.updateMany({ where: { id: l.id, status: 'ignored' }, data: BACK_TO_QUEUE })).count;
      }
    }
    await audit({ actorId: actor.id, action: 'payer.rule.undo', entityType: 'payer_rule', entityId: rule.id, after: { restored } });
    return { ok: true, restored };
  });

  /** The categories of other income, in the owner's order; read by whoever sorts the queue. */
  app.get<{ Querystring: { all?: string } }>('/api/income-categories', { config: { scope: 'payments.reconcile' } }, async (req) => {
    const rows = await prisma.incomeCategory.findMany({
      where: req.query.all === '1' ? {} : { archived: false },
      orderBy: [{ archived: 'asc' }, { sortOrder: 'asc' }, { nameRu: 'asc' }],
    });
    return { categories: rows.map(shape) };
  });

  app.post<{ Body: Body }>('/api/income-categories', { config: { scope: 'settings.manage' } }, async (req, reply) => {
    const actor = actorOf(req);
    const b = req.body ?? {};
    const nameRu = str(b, 'nameRu', { required: true, max: 80 })!;
    const taken = await prisma.incomeCategory.findFirst({ where: { archived: false, nameRu: { equals: nameRu, mode: 'insensitive' } }, select: { id: true } });
    if (taken) throw conflict('category_exists', 'There is a category by that name already.', { field: 'nameRu' });
    const last = await prisma.incomeCategory.aggregate({ _max: { sortOrder: true } });
    const row = await prisma.incomeCategory.create({
      data: { nameRu, nameKa: str(b, 'nameKa', { max: 80 }), nameEn: str(b, 'nameEn', { max: 80 }), sortOrder: (last._max.sortOrder ?? 0) + 1, createdById: actor.id },
    });
    await audit({ actorId: actor.id, action: 'income.category.add', entityType: 'income_category', entityId: row.id, after: { nameRu } });
    return reply.code(201).send(shape(row));
  });

  app.patch<{ Params: { id: string }; Body: Body }>('/api/income-categories/:id', { config: { scope: 'settings.manage' } }, async (req) => {
    const actor = actorOf(req);
    const b = req.body ?? {};
    const before = await prisma.incomeCategory.findUnique({ where: { id: req.params.id } });
    if (!before) throw notFound('income_category_not_found', 'No such income category.');
    const data: Record<string, unknown> = {};
    if ('nameRu' in b) data.nameRu = str(b, 'nameRu', { required: true, max: 80 });
    if ('nameKa' in b) data.nameKa = str(b, 'nameKa', { max: 80 });
    if ('nameEn' in b) data.nameEn = str(b, 'nameEn', { max: 80 });
    if ('archived' in b) {
      if (typeof b.archived !== 'boolean') throw badRequest('bad_field', 'archived is true or false', { field: 'archived' });
      data.archived = b.archived;
    }
    if (typeof data.nameRu === 'string' && data.nameRu.toLowerCase() !== before.nameRu.toLowerCase()) {
      const taken = await prisma.incomeCategory.findFirst({ where: { archived: false, id: { not: before.id }, nameRu: { equals: data.nameRu, mode: 'insensitive' } }, select: { id: true } });
      if (taken) throw conflict('category_exists', 'There is a category by that name already.', { field: 'nameRu' });
    }
    const row = await prisma.incomeCategory.update({ where: { id: before.id }, data });
    // A category taken off keeps its lines; its remembered payers stop sorting into it.
    if (data.archived === true) await prisma.payerRule.updateMany({ where: { categoryId: before.id, archivedAt: null }, data: { archivedAt: new Date(), archivedById: actor.id } });
    await audit({ actorId: actor.id, action: 'income.category.edit', entityType: 'income_category', entityId: row.id, before: shape(before), after: shape(row) });
    return shape(row);
  });

  /**
   * «Отчёты → Поступления»: what came into the accounts in a period, by what
   * it was — the customers' money by what it paid, other income by category,
   * and apart from them what is no revenue: a founder's contribution, money
   * between the company's own accounts, cash taken to the bank — and what
   * still waits in «Разобрать». The mirror of «Расходы» (ADR-0027). Lines set
   * aside as "not ours" are not the company's money and are left out. Sums
   * are what reached the account: a card line's net.
   */
  app.get<{ Querystring: { from?: string; to?: string } }>('/api/reports/incoming', { config: { scope: 'reports.view' } }, async (req) => {
    const week = weekOf(todayISO(new Date(), env.TZ));
    const from = date(req.query, 'from') ?? week.from;
    const to = date(req.query, 'to') ?? week.to;
    if (from > to) throw badRequest('bad_period', 'The period starts after it ends.', { field: 'from' });
    const lines = await prisma.statementLine.findMany({
      where: { direction: 'in', occurredOn: { gte: dateFromISO(from)!, lte: dateFromISO(to)! } },
      select: {
        amountTetri: true,
        status: true,
        resolution: true,
        incomeCategoryId: true,
        payments: { where: { voidedAt: null }, select: { kind: true, grossTetri: true, netTetri: true, allocations: { select: { target: true, amountTetri: true } } } },
      },
    });
    const customers = { rent: 0, deposits: 0, sales: 0, goods: 0, repairs: 0, advance: 0 };
    const byCategory = new Map<string | null, { tetri: number; lines: number }>();
    const apart = { founder: 0, ownTransfers: 0, bankDeposits: 0, other: 0, unsorted: 0, unsortedLines: 0 };
    for (const l of lines) {
      if (l.status === 'unmatched') {
        apart.unsorted += l.amountTetri;
        apart.unsortedLines++;
      } else if (l.resolution === 'not_ours') {
        continue;
      } else if (l.resolution === 'founder_equity') {
        apart.founder += l.amountTetri;
      } else if (l.resolution === 'own_transfer') {
        apart.ownTransfers += l.amountTetri;
      } else if (l.resolution === 'other_income') {
        const row = byCategory.get(l.incomeCategoryId) ?? { tetri: 0, lines: 0 };
        row.tetri += l.amountTetri;
        row.lines++;
        byCategory.set(l.incomeCategoryId, row);
      } else if (l.resolution === 'bank_deposit') {
        apart.bankDeposits += l.amountTetri;
      } else if (l.status === 'matched' && l.payments.length > 0) {
        for (const p of l.payments) {
          if (p.kind === 'rent') {
            // A deposit is a liability, not revenue: its share of the money apart from the rent.
            const deposit = p.allocations.filter((a) => a.target === 'deposit').reduce((n, a) => n + a.amountTetri, 0);
            const share = p.grossTetri > 0 ? Math.round((p.netTetri * deposit) / p.grossTetri) : 0;
            customers.deposits += share;
            customers.rent += p.netTetri - share;
          } else if (p.kind === 'sale') customers.sales += p.netTetri;
          else if (p.kind === 'goods') customers.goods += p.netTetri;
          else if (p.kind === 'service') customers.repairs += p.netTetri;
          else if (p.kind === 'on_account') customers.advance += p.netTetri;
          else apart.other += p.netTetri;
        }
      } else {
        apart.other += l.amountTetri;
      }
    }
    const customersTetri = Object.values(customers).reduce((n, v) => n + v, 0);
    const categories = [...byCategory.entries()].map(([categoryId, v]) => ({ categoryId, tetri: v.tetri, lines: v.lines })).sort((a, b) => b.tetri - a.tetri);
    const otherIncomeTetri = categories.reduce((n, c) => n + c.tetri, 0);
    return {
      from,
      to,
      customers,
      customersTetri,
      categories,
      otherIncomeTetri,
      ...apart,
      totalInTetri: customersTetri + otherIncomeTetri + apart.founder + apart.ownTransfers + apart.bankDeposits + apart.other + apart.unsorted,
    };
  });
}
