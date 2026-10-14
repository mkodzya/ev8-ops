import { daysBetween, todayISO } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { audit } from '../lib/audit.js';
import { isoDate } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { env } from '../lib/env.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { actorOf } from '../lib/guard.js';
import { voidPayment } from '../lib/payments.js';
import { SPLIT_MAX, attach, importStatement, linkBankDeposit, linkPayment, previewStatement, split } from '../lib/statements/import.js';
import { ParseError, cardOf } from '../lib/statements/parse.js';
import { isCashDeposit, loadCtx, suggest, type Line } from '../lib/statements/reconcile.js';
import { str, tetri } from '../lib/validate.js';

// Statements and "Разобрать" (wave 2 §3.2, §3.5).
//
// The file arrives as text in a JSON body, the same way photos arrive as
// base64: one less dependency in an image the company rebuilds by hand.

/** The largest statement read (QA-1-05). The screen checks it before sending. */
export const MAX_STATEMENT_BYTES = 8 * 1024 * 1024;
/** How far back "Отложено" looks, and what its count on the queue counts. */
const ASIDE_DAYS = 30;
const BODY_LIMIT = Math.ceil(MAX_STATEMENT_BYTES * 1.2);
/** Older than this, a bank's statements are stale (§3.5; the threshold is a proposal). */
const STALE_DAYS = 7;
export const BANKS = ['bog', 'tbc', 'credo'] as const;
/** What the rules and the import attached by themselves. */
const BY_RULES = ['payer_name', 'amount_date', 'card_pickup_day', 'recorded', 'bank_deposit'];

type Body = Record<string, unknown>;

function readFile(b: Body): { fileName: string; text: string } {
  const fileName = str(b, 'fileName', { required: true, max: 200 })!;
  const text = typeof b.text === 'string' ? b.text : null;
  if (!text) throw badRequest('missing_field', 'text is required', { field: 'text' });
  if (Buffer.byteLength(text, 'utf8') > MAX_STATEMENT_BYTES) {
    throw badRequest('file_too_big', 'Statements up to 8 MB.', { limitBytes: MAX_STATEMENT_BYTES });
  }
  return { fileName, text };
}

function asLine(l: {
  occurredOn: Date;
  direction: 'in' | 'out';
  amountTetri: number;
  grossTetri: number | null;
  feeTetri: number | null;
  payer: string | null;
  purpose: string | null;
  raw: string;
  bank: 'bog' | 'tbc' | 'credo';
}): Line {
  // A card line is told by its text as well as by its stored sums: one loaded
  // before a bank's wording was known is read here as it would be read today.
  const card = l.direction === 'in' ? cardOf(l) : null;
  return {
    occurredOn: isoDate(l.occurredOn)!,
    direction: l.direction,
    amountTetri: l.amountTetri,
    grossTetri: card?.grossTetri ?? null,
    feeTetri: card?.feeTetri ?? null,
    payer: l.payer,
    purpose: l.purpose,
    raw: l.raw,
    channel: card ? 'acquiring' : 'transfer',
    bank: l.bank,
  };
}

export function statementRoutes(app: FastifyInstance): void {
  /** By bank: the last upload and up to which day; below, the history (§3.5). */
  app.get('/api/statements', { config: { scope: 'payments.reconcile' } }, async () => {
    const today = todayISO(new Date(), env.TZ);
    const statements = await prisma.statement.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { uploadedBy: { select: { name: true } } } });
    const lastLines = await prisma.statementLine.groupBy({ by: ['bank'], _max: { occurredOn: true } });
    const queue = await prisma.statementLine.count({ where: { status: 'unmatched' } });
    const banks = BANKS.map((bank) => {
      const last = statements.find((s) => s.bank === bank) ?? null;
      const through = isoDate(lastLines.find((l) => l.bank === bank)?._max.occurredOn ?? null);
      const upTo = [through, last ? isoDate(last.periodTo) : null].filter((d): d is string => !!d).sort().pop() ?? null;
      return {
        bank,
        lastUploadAt: last?.createdAt.toISOString() ?? null,
        throughOn: upTo,
        // A line dated ahead of today is not "−7 days ago" (QA-W2-05).
        daysOld: upTo ? Math.max(0, daysBetween(upTo, today)) : null,
        stale: upTo ? daysBetween(upTo, today) > STALE_DAYS : false,
        never: !last,
      };
    });
    return {
      queue,
      staleDays: STALE_DAYS,
      limitBytes: MAX_STATEMENT_BYTES,
      banks,
      statements: statements.map((s) => ({
        id: s.id,
        bank: s.bank,
        fileName: s.fileName,
        account: s.account,
        periodFrom: isoDate(s.periodFrom),
        periodTo: isoDate(s.periodTo),
        lineCount: s.lineCount,
        newLines: s.newLines,
        matched: s.matched,
        uploadedBy: s.uploadedBy?.name ?? null,
        createdAt: s.createdAt.toISOString(),
      })),
    };
  });

  app.post<{ Body: Body }>('/api/statements', { config: { scope: 'payments.reconcile' }, bodyLimit: BODY_LIMIT }, async (req, reply) => {
    const { fileName, text } = readFile(req.body ?? {});
    try {
      return reply.code(201).send(await importStatement({ actorId: actorOf(req).id, fileName, text }));
    } catch (e) {
      if (e instanceof ParseError) throw badRequest('unreadable_statement', e.message);
      throw e;
    }
  });

  /** The same file, read but not kept: what it would do (§3.5). */
  app.post<{ Body: Body }>('/api/statements/preview', { config: { scope: 'payments.reconcile' }, bodyLimit: BODY_LIMIT }, async (req) => {
    const { fileName, text } = readFile(req.body ?? {});
    try {
      return await previewStatement({ fileName, text });
    } catch (e) {
      if (e instanceof ParseError) throw badRequest('unreadable_statement', e.message);
      throw e;
    }
  });

  /** "Разобрать": the lines nobody placed, in and out, each with its group and hints (§3.2). */
  app.get<{ Querystring: { direction?: string } }>('/api/statement-lines', { config: { scope: 'payments.reconcile' } }, async (req) => {
    const direction = req.query.direction === 'out' ? 'out' : req.query.direction === 'in' ? 'in' : undefined;
    const [lines, counts, byRules, ctx] = await Promise.all([
      prisma.statementLine.findMany({
        where: { status: 'unmatched', ...(direction ? { direction } : {}) },
        orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
        take: 300,
        include: { statement: { select: { fileName: true } } },
      }),
      prisma.statementLine.groupBy({ by: ['direction'], where: { status: 'unmatched' }, _count: { _all: true } }),
      prisma.statementLine.count({ where: { status: 'matched', matchedRule: { in: BY_RULES }, createdAt: { gte: new Date(Date.now() - 7 * 24 * 3600_000) } } }),
      loadCtx(),
    ]);
    const aside = await prisma.statementLine.count({ where: { status: 'ignored', resolvedAt: { gte: new Date(Date.now() - ASIDE_DAYS * 24 * 3600_000) } } });
    return {
      counts: { in: counts.find((c) => c.direction === 'in')?._count._all ?? 0, out: counts.find((c) => c.direction === 'out')?._count._all ?? 0 },
      byRulesWeek: byRules,
      asideMonth: aside,
      lines: lines.map((l) => {
        const line = asLine(l);
        return {
          id: l.id,
          bank: l.bank,
          direction: l.direction,
          occurredOn: isoDate(l.occurredOn),
          amountTetri: l.amountTetri,
          grossTetri: line.grossTetri,
          feeTetri: line.feeTetri,
          channel: line.channel,
          payer: l.payer,
          purpose: l.purpose,
          raw: l.raw,
          fileName: l.statement.fileName,
          cashDeposit: isCashDeposit(line),
          ...suggest(line, ctx),
        };
      }),
    };
  });

  /** "Разобрано правилами": what the rules attached, with why (§3.2, B2-07). */
  app.get<{ Querystring: { days?: string } }>('/api/statement-lines/by-rules', { config: { scope: 'payments.reconcile' } }, async (req) => {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
    const lines = await prisma.statementLine.findMany({
      where: { status: 'matched', matchedRule: { in: BY_RULES }, createdAt: { gte: new Date(Date.now() - days * 24 * 3600_000) } },
      orderBy: [{ occurredOn: 'desc' }],
      take: 300,
      include: {
        payments: {
          where: { voidedAt: null },
          select: { id: true, grossTetri: true, rental: { select: { id: true, number: true } }, sale: { select: { id: true, number: true } }, customer: { select: { name: true } } },
        },
      },
    });
    const reasons = await prisma.auditLog.findMany({
      where: { entityType: 'statement_line', entityId: { in: lines.map((l) => l.id) }, action: 'statement.line.rule' },
      select: { entityId: true, after: true },
    });
    const why = new Map(reasons.map((r) => [r.entityId, (r.after as { reason?: unknown } | null)?.reason ?? null]));
    return {
      days,
      lines: lines.map((l) => {
        const p = l.payments[0] ?? null;
        return {
          id: l.id,
          bank: l.bank,
          occurredOn: isoDate(l.occurredOn),
          amountTetri: l.amountTetri,
          payer: l.payer,
          purpose: l.purpose,
          rule: l.matchedRule,
          reason: why.get(l.id) ?? null,
          payment: p
            ? { id: p.id, grossTetri: p.grossTetri, number: p.rental?.number ?? p.sale?.number ?? null, rentalId: p.rental?.id ?? null, saleId: p.sale?.id ?? null, customer: p.customer?.name ?? null }
            : null,
        };
      }),
    };
  });

  /**
   * "Отложено": the lines people took out of the queue — "not ours" with its
   * reason, or the company's own spending — so that one taken out by mistake
   * can be seen and put back (Mika, 13.10.2026: nothing in the product
   * returned such a line).
   */
  app.get<{ Querystring: { days?: string } }>('/api/statement-lines/aside', { config: { scope: 'payments.reconcile' } }, async (req) => {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || ASIDE_DAYS));
    const lines = await prisma.statementLine.findMany({
      where: { status: 'ignored', resolvedAt: { gte: new Date(Date.now() - days * 24 * 3600_000) } },
      orderBy: [{ resolvedAt: 'desc' }],
      take: 300,
    });
    const people = await prisma.user.findMany({ where: { id: { in: [...new Set(lines.map((l) => l.resolvedById).filter((x): x is string => x != null))] } }, select: { id: true, name: true } });
    const who = new Map(people.map((u) => [u.id, u.name]));
    return {
      days,
      lines: lines.map((l) => {
        const line = asLine(l);
        return {
          id: l.id,
          bank: l.bank,
          direction: l.direction,
          occurredOn: isoDate(l.occurredOn),
          amountTetri: l.amountTetri,
          grossTetri: line.grossTetri,
          feeTetri: line.feeTetri,
          channel: line.channel,
          payer: l.payer,
          purpose: l.purpose,
          raw: l.raw,
          resolution: l.resolution,
          reason: l.resolutionReason,
          by: l.resolvedById ? (who.get(l.resolvedById) ?? null) : null,
          on: l.resolvedAt ? todayISO(l.resolvedAt, env.TZ) : null,
        };
      }),
    };
  });

  /** One line with its hints. */
  app.get<{ Params: { id: string } }>('/api/statement-lines/:id', { config: { scope: 'payments.reconcile' } }, async (req) => {
    const l = await prisma.statementLine.findUnique({ where: { id: req.params.id } });
    if (!l) throw notFound('line_not_found', 'No such statement line.');
    const line = asLine(l);
    const s = suggest(line, await loadCtx());
    return {
      line: { id: l.id, occurredOn: isoDate(l.occurredOn), direction: l.direction, amountTetri: l.amountTetri, grossTetri: line.grossTetri, payer: l.payer, purpose: l.purpose, raw: l.raw, channel: line.channel, status: l.status },
      // The earlier shape, kept for what still reads it.
      hints: s.suggestions.filter((x) => x.kind === 'rental').map((x) => ({ rentalId: x.id, number: x.number, customer: x.customer, why: x.reason.code })),
      ...s,
    };
  });

  /** This line is this record's money (§3.2): a rental, a sale, a repair, or the customer's account. */
  app.post<{ Params: { id: string }; Body: Body }>('/api/statement-lines/:id/assign', { config: { scope: 'payments.reconcile' } }, async (req) => {
    const b = req.body ?? {};
    const target = { rentalId: str(b, 'rentalId'), saleId: str(b, 'saleId'), serviceJobId: str(b, 'serviceJobId'), customerId: str(b, 'customerId') };
    if (!target.rentalId && !target.saleId && !target.serviceJobId && !target.customerId) {
      throw badRequest('missing_field', 'Say what this line pays for.', { field: 'rentalId' });
    }
    const r = await prisma.$transaction((tx) => attach(tx, { actorId: actorOf(req).id, lineId: req.params.id, rule: 'by_hand', ...target }));
    return { ok: true, id: r.paymentId };
  });

  /**
   * "Разделить": one line, several records — a rental week and a repair paid
   * in one transfer (meeting of 14.10.2026). Each part is what the customer
   * paid for that record; together they are the whole line.
   */
  app.post<{ Params: { id: string }; Body: Body }>('/api/statement-lines/:id/split', { config: { scope: 'payments.reconcile' } }, async (req) => {
    const raw = (req.body ?? {}).parts;
    if (!Array.isArray(raw) || raw.length === 0) throw badRequest('missing_field', 'Say what each part pays for.', { field: 'parts' });
    if (raw.length > SPLIT_MAX) throw badRequest('split_too_many', `A split has at most ${SPLIT_MAX} parts.`);
    const parts = raw.map((x) => {
      const b = (x ?? {}) as Body;
      return {
        grossTetri: tetri(b, 'grossTetri', { required: true, min: 1 })!,
        rentalId: str(b, 'rentalId'),
        saleId: str(b, 'saleId'),
        serviceJobId: str(b, 'serviceJobId'),
        customerId: str(b, 'customerId'),
      };
    });
    const r = await prisma.$transaction((tx) => split(tx, { actorId: actorOf(req).id, lineId: req.params.id, parts }));
    return { ok: true, ids: r.paymentIds };
  });

  /** "Да, это он": the line is a payment already entered by hand (§3.2 "Похоже, уже записан"). */
  app.post<{ Params: { id: string }; Body: Body }>('/api/statement-lines/:id/link', { config: { scope: 'payments.reconcile' } }, async (req) => {
    const actor = actorOf(req);
    const paymentId = str(req.body ?? {}, 'paymentId', { required: true })!;
    await prisma.$transaction((tx) => linkPayment(tx, req.params.id, paymentId, 'recorded_by_hand'));
    await audit({ actorId: actor.id, action: 'statement.line.link', entityType: 'statement_line', entityId: req.params.id, after: { paymentId } });
    return { ok: true };
  });

  /** Cash an owner took to the bank: to the record there is, or a new one made from this line (§3.4). */
  app.post<{ Params: { id: string }; Body: Body }>('/api/statement-lines/:id/bank-deposit', { config: { scope: 'payments.reconcile' } }, async (req) => {
    const actor = actorOf(req);
    const given = str(req.body ?? {}, 'bankDepositId');
    await prisma.$transaction(async (tx) => {
      let id = given;
      if (!id) {
        const line = await tx.statementLine.findUnique({ where: { id: req.params.id } });
        if (!line) throw notFound('line_not_found', 'No such statement line.');
        if (line.direction !== 'in') throw conflict('outgoing_line', 'Cash taken to the bank comes in, not out.');
        id = (await tx.bankCashDeposit.create({ data: { userId: actor.id, amountTetri: line.amountTetri, bank: line.bank, occurredOn: line.occurredOn }, select: { id: true } })).id;
      }
      await linkBankDeposit(tx, actor.id, req.params.id, id);
    });
    await audit({ actorId: actor.id, action: 'statement.line.bank_deposit', entityType: 'statement_line', entityId: req.params.id, after: { bankDepositId: given } });
    return { ok: true };
  });

  /** "Это не наше" — out of the queue, with a reason it must have (§3.2). */
  app.post<{ Params: { id: string }; Body: Body }>('/api/statement-lines/:id/ignore', { config: { scope: 'payments.reconcile' } }, async (req) => {
    const actor = actorOf(req);
    const reason = str(req.body ?? {}, 'reason', { required: true, max: 500 })!;
    await setAside(req.params.id, actor.id, 'not_ours', reason);
    await audit({ actorId: actor.id, action: 'statement.line.ignore', entityType: 'statement_line', entityId: req.params.id, note: reason });
    return { ok: true };
  });

  /** An outgoing line that is the company's own spending: one tap (§3.2 "Списания"). */
  app.post<{ Params: { id: string } }>('/api/statement-lines/:id/expense', { config: { scope: 'payments.reconcile' } }, async (req) => {
    const actor = actorOf(req);
    const line = await prisma.statementLine.findUnique({ where: { id: req.params.id }, select: { direction: true } });
    if (!line) throw notFound('line_not_found', 'No such statement line.');
    if (line.direction !== 'out') throw conflict('incoming_line', 'Money coming in is not a company expense.');
    await setAside(req.params.id, actor.id, 'company_expense', null);
    await audit({ actorId: actor.id, action: 'statement.line.expense', entityType: 'statement_line', entityId: req.params.id });
    return { ok: true };
  });

  /**
   * "Вернуть в очередь": a line set aside waits for a person again. Setting a
   * line aside wrote nothing but the decision, so nothing else is undone.
   */
  app.post<{ Params: { id: string } }>('/api/statement-lines/:id/restore', { config: { scope: 'payments.reconcile' } }, async (req) => {
    const actor = actorOf(req);
    const line = await prisma.statementLine.findUnique({ where: { id: req.params.id }, select: { id: true, resolution: true, resolutionReason: true } });
    if (!line) throw notFound('line_not_found', 'No such statement line.');
    const done = await prisma.statementLine.updateMany({
      where: { id: line.id, status: 'ignored' },
      data: { status: 'unmatched', matchedRule: null, resolution: null, resolutionReason: null, resolvedById: null, resolvedAt: null },
    });
    if (done.count === 0) throw conflict('not_set_aside', 'This line is not set aside.');
    await audit({ actorId: actor.id, action: 'statement.line.restore', entityType: 'statement_line', entityId: line.id, before: { resolution: line.resolution, reason: line.resolutionReason } });
    return { ok: true };
  });

  /**
   * "Отвязать": the line goes back to the queue. A payment the line made is
   * annulled; one entered by hand keeps living and only lets go of the line (B2-07).
   */
  app.post<{ Params: { id: string } }>('/api/statement-lines/:id/unlink', { config: { scope: 'payments.reconcile' } }, async (req) => {
    const actor = actorOf(req);
    const line = await prisma.statementLine.findUnique({
      where: { id: req.params.id },
      include: { payments: { where: { voidedAt: null }, select: { id: true, source: true } }, bankDeposit: { select: { id: true } } },
    });
    if (!line) throw notFound('line_not_found', 'No such statement line.');
    if (line.status !== 'matched') throw conflict('not_matched', 'This line is not attached.');
    const p = line.payments[0];
    if (p && p.source === 'statement') {
      await voidPayment({ actorId: actor.id, paymentId: p.id, reason: 'unlinked from the bank line' });
    } else {
      await prisma.$transaction(async (tx) => {
        if (p) await tx.payment.update({ where: { id: p.id }, data: { statementLineId: null } });
        if (line.bankDeposit) await tx.bankCashDeposit.update({ where: { id: line.bankDeposit.id }, data: { statementLineId: null } });
        await tx.statementLine.update({ where: { id: line.id }, data: { status: 'unmatched', matchedRule: null, paymentId: null, resolution: null } });
      });
    }
    await audit({ actorId: actor.id, action: 'statement.line.unlink', entityType: 'statement_line', entityId: line.id, before: { paymentId: p?.id ?? null, rule: line.matchedRule } });
    return { ok: true };
  });
}

/** Set a line aside, once: a second answer finds it taken. */
async function setAside(lineId: string, actorId: string, resolution: 'not_ours' | 'company_expense', reason: string | null): Promise<void> {
  const done = await prisma.statementLine.updateMany({
    where: { id: lineId, status: 'unmatched' },
    data: { status: 'ignored', matchedRule: resolution, resolution, resolutionReason: reason, resolvedById: actorId, resolvedAt: new Date() },
  });
  if (done.count === 0) {
    const exists = await prisma.statementLine.findUnique({ where: { id: lineId }, select: { id: true } });
    if (!exists) throw notFound('line_not_found', 'No such statement line.');
    throw conflict('already_matched', 'This line is already attached.');
  }
}
