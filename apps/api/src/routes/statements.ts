import { daysBetween, mayLinkPayment, mayRemember, maySortTo, mayUnlink, nameMatches, todayISO, type Permission } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import type { Prisma } from '../generated/prisma/client.js';
import { audit } from '../lib/audit.js';
import { hasPerm, permissionsOf, type Actor } from '../lib/auth.js';
import { bogApiStatus } from '../lib/bog.js';
import { isoDate } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { env } from '../lib/env.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { actorOf } from '../lib/guard.js';
import { voidPayment } from '../lib/payments.js';
import { recordOutFromLine } from '../lib/money.js';
import { depositsOverview } from '../lib/deposits.js';
import { SPLIT_MAX, attach, importStatement, linkBankDeposit, linkPayment, previewStatement, split, type SplitShift } from '../lib/statements/import.js';
import { ParseError } from '../lib/statements/parse.js';
import { isCashDeposit, loadCtx, storedLine, suggest } from '../lib/statements/reconcile.js';
import { expenseKey, lastCategories, payeeLabel, sortByRule, waitingFrom } from '../lib/statements/expenses.js';
import { BACK_TO_QUEUE, setAside } from '../lib/statements/aside.js';
import { twinReason, twinsOf } from '../lib/statements/duplicates.js';
import { livePayerRules, payerKey, payerLabel, rememberPayer, type PayerKind } from '../lib/statements/payers.js';
import { tbcApiStatus } from '../lib/tbc.js';
import { settleAfterShift } from '../lib/weekShift.js';
import { int, oneOf, str, tetri } from '../lib/validate.js';

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
/**
 * What the rules and the import attached by themselves. `amount_date` and
 * `card_pickup_day` attach nothing since issue #13; the lines they attached
 * before stay listed with their reason.
 */
const BY_RULES = ['payer_name', 'payer_rule', 'amount_date', 'card_pickup_day', 'recorded', 'bank_deposit'];

type Body = Record<string, unknown>;

/** What this person may do here: the rights of the role, as the guard reads them. */
const rightsOf = (actor: Actor): readonly Permission[] => permissionsOf(actor.role, actor.via);

/**
 * «Разобрать» is a manager's too since issue #15 (ADR-0048), for the
 * customers' money coming in. Every answer beyond it is refused here with
 * words that say whose it is — the route's scope lets him in, the answer
 * decides what he may do there.
 */
const ownersAnswer = () =>
  forbidden('sort_owner_only', 'The owner sorts this. A manager links money coming in to a rental, a deposit, a moped sale, goods or a repair.');

/** Set aside by a person — not by a remembered payee or payer, which «Разобрано правилами» lists. */
const BY_PERSON = { OR: [{ matchedRule: null }, { matchedRule: { notIn: ['expense_rule', 'payer_rule'] } }] };

function readFile(b: Body): { fileName: string; text: string } {
  const fileName = str(b, 'fileName', { required: true, max: 200 })!;
  const text = typeof b.text === 'string' ? b.text : null;
  if (!text) throw badRequest('missing_field', 'text is required', { field: 'text' });
  if (Buffer.byteLength(text, 'utf8') > MAX_STATEMENT_BYTES) {
    throw badRequest('file_too_big', 'Statements up to 8 MB.', { limitBytes: MAX_STATEMENT_BYTES });
  }
  return { fileName, text };
}

export function statementRoutes(app: FastifyInstance): void {
  /** By bank: the last upload and up to which day; below, the history (§3.5). */
  app.get('/api/statements', { config: { scope: 'payments.reconcile' } }, async () => {
    const today = todayISO(new Date(), env.TZ);
    const statements = await prisma.statement.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { uploadedBy: { select: { name: true } } } });
    const lastLines = await prisma.statementLine.groupBy({ by: ['bank'], _max: { occurredOn: true } });
    const queue = await prisma.statementLine.count({ where: { status: 'unmatched' } });
    // A bank comes by itself once its keys are on the stand (B11-03): Bank of Georgia, TBC.
    const [bogApi, tbcApi] = await Promise.all([bogApiStatus(), tbcApiStatus()]);
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
        api: bank === 'bog' ? bogApi : bank === 'tbc' ? tbcApi : null,
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
        source: s.source,
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

  /**
   * "Разобрать": the lines nobody placed, in and out, each with its group and
   * hints (§3.2). Whoever sorts only the customers' money (a manager, issue
   * #15) is answered the lines coming in, and none of the owners' counts.
   */
  app.get<{ Querystring: { direction?: string } }>('/api/statement-lines', { config: { scope: 'payments.sort.customer' } }, async (req) => {
    const owner = hasPerm(actorOf(req), 'payments.reconcile');
    const asked = req.query.direction === 'out' ? 'out' : req.query.direction === 'in' ? 'in' : undefined;
    if (!owner && asked === 'out') throw ownersAnswer();
    const direction = owner ? asked : 'in';
    const [lines, counts, byRules, ctx] = await Promise.all([
      prisma.statementLine.findMany({
        where: { status: 'unmatched', ...(direction ? { direction } : {}) },
        orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
        take: 300,
        include: { statement: { select: { fileName: true } } },
      }),
      prisma.statementLine.groupBy({ by: ['direction'], where: { status: 'unmatched' }, _count: { _all: true } }),
      owner ? prisma.statementLine.count({ where: { status: 'matched', matchedRule: { in: BY_RULES }, createdAt: { gte: new Date(Date.now() - 7 * 24 * 3600_000) } } }) : 0,
      loadCtx(),
    ]);
    const aside = owner ? await prisma.statementLine.count({ where: { status: 'ignored', ...BY_PERSON, resolvedAt: { gte: new Date(Date.now() - ASIDE_DAYS * 24 * 3600_000) } } }) : 0;
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000);
    // Set aside by a remembered payee (0046) or payer (0069): «Разобрано правилами», not «Отложено».
    const byExpenseRules = owner ? await prisma.statementLine.count({ where: { status: 'ignored', matchedRule: { in: ['expense_rule', 'payer_rule'] }, resolvedAt: { gte: weekAgo } } }) : 0;
    // Payers remembered (0069): what «Запомнить для …» would replace.
    const payers = direction === 'out' ? new Map() : await livePayerRules(prisma);
    // "Как в прошлый раз" for money going out (migration 0046).
    const last = direction === 'in' ? new Map<string, string>() : await lastCategories();
    // A line going out of exactly a deposit we owe back, to its renter, looks like that deposit handed back.
    const toHandBack =
      direction === 'in'
        ? []
        : (await depositsOverview()).deposits.filter((d) => d.toHandBackTetri > 0).map((d) => ({ rentalId: d.rentalId, number: d.number, tetri: d.toHandBackTetri, names: [d.customer.name, d.customer.nameKa, d.customer.nameLat] }));
    // Of the deposits owed back in exactly this sum, the one whose renter the
    // bank names as the recipient. A sum alone is no sign (issue #16 of the
    // director, 25.10.2026, as #13 ruled for money coming in): two refunds of
    // 180 were both offered as the deposit of the one rental with 180 to hand
    // back, and one of them was another renter's. No recipient, a recipient
    // who is none of them, or two of one sum and one name: no hint — the line
    // waits in «Без подсказки» and a person chooses.
    const depositFor = (l: { amountTetri: number; payer: string | null }) => {
      const to = l.payer?.trim();
      if (!to) return null;
      const named = toHandBack.filter((d) => d.tetri === l.amountTetri && nameMatches(to, d.names));
      return named.length === 1 ? named[0] : null;
    };
    // A Bank of Georgia card payment the bank sent twice: the later line names the one it repeats (issue #16).
    const twins = await twinsOf(lines);
    return {
      // Going out, the rules' work and the lines taken out are an owner's pages: no number of them for a manager.
      counts: { in: counts.find((c) => c.direction === 'in')?._count._all ?? 0, out: owner ? (counts.find((c) => c.direction === 'out')?._count._all ?? 0) : null },
      byRulesWeek: owner ? byRules + byExpenseRules : null,
      asideMonth: owner ? aside : null,
      lines: lines.map((l) => {
        const line = storedLine(l);
        const hints = suggest(line, ctx);
        const key = l.direction === 'out' ? expenseKey(l) : null;
        const lastCategoryId = key ? last.get(key) ?? null : null;
        const deposit = l.direction === 'out' ? depositFor(l) : null;
        const twin = twins.get(l.id) ?? null;
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
          ...hints,
          // «Похоже на дубль строки от … (№…)» and its one answer, «Это дубль» (issue #16).
          duplicateOf: twin,
          ...(l.direction === 'in'
            ? (() => {
                // Who sent it, as «Запомнить для „…“» says it; none — a card line, cash paid in, nobody named (0069).
                const key = payerKey(line);
                const rule = key ? payers.get(key) : undefined;
                return { payerLabel: payerLabel(line), canRemember: key != null, remembered: rule ? { kind: rule.kind as PayerKind, customerId: rule.customerId, customerName: rule.customerName ?? null, categoryId: rule.categoryId } : null };
              })()
            : {}),
          ...(l.direction === 'out'
            ? {
                // Who the money went to, as "Запомнить для …" says it; none — nothing to remember.
                payee: payeeLabel(l),
                canRemember: key != null,
                lastCategoryId,
                depositHint: deposit ? { rentalId: deposit.rentalId, number: deposit.number } : null,
                group: hints.group === 'none' && (lastCategoryId || deposit || twin) ? ('suggested' as const) : hints.group,
              }
            : {}),
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
        payerRule: { select: { id: true, createdAt: true, archivedAt: true } },
        payments: {
          where: { voidedAt: null },
          select: {
            id: true,
            grossTetri: true,
            rental: { select: { id: true, number: true } },
            sale: { select: { id: true, number: true } },
            goodsSale: { select: { id: true, number: true } },
            customer: { select: { name: true } },
          },
        },
      },
    });
    const reasons = await prisma.auditLog.findMany({
      where: { entityType: 'statement_line', entityId: { in: lines.map((l) => l.id) }, action: 'statement.line.rule' },
      select: { entityId: true, after: true },
    });
    const why = new Map(reasons.map((r) => [r.entityId, (r.after as { reason?: unknown } | null)?.reason ?? null]));
    const expenses = await prisma.statementLine.findMany({
      where: { status: 'ignored', matchedRule: 'expense_rule', resolvedAt: { gte: new Date(Date.now() - days * 24 * 3600_000) } },
      orderBy: [{ occurredOn: 'desc' }],
      take: 300,
      include: { expenseRule: { select: { id: true, createdAt: true, archivedAt: true } } },
    });
    // Money coming in set aside by a remembered payer (0069): between accounts, a founder's, other income.
    const incoming = await prisma.statementLine.findMany({
      where: { status: 'ignored', matchedRule: 'payer_rule', resolvedAt: { gte: new Date(Date.now() - days * 24 * 3600_000) } },
      orderBy: [{ occurredOn: 'desc' }],
      take: 300,
      include: { payerRule: { select: { id: true, createdAt: true, archivedAt: true } } },
    });
    const ruleOf = (r: { id: string; createdAt: Date; archivedAt: Date | null } | null) => (r ? { id: r.id, since: todayISO(r.createdAt, env.TZ), live: r.archivedAt == null } : null);
    return {
      days,
      // Money going out sorted by a remembered payee (migration 0046).
      expenses: expenses.map((l) => ({
        id: l.id,
        bank: l.bank,
        occurredOn: isoDate(l.occurredOn),
        amountTetri: l.amountTetri,
        payee: payeeLabel(l),
        categoryId: l.expenseCategoryId,
        rule: l.expenseRule ? { id: l.expenseRule.id, since: todayISO(l.expenseRule.createdAt, env.TZ), live: l.expenseRule.archivedAt == null } : null,
      })),
      incoming: incoming.map((l) => ({
        id: l.id,
        bank: l.bank,
        occurredOn: isoDate(l.occurredOn),
        amountTetri: l.amountTetri,
        payer: payerLabel(storedLine(l)),
        resolution: l.resolution,
        categoryId: l.incomeCategoryId,
        rule: ruleOf(l.payerRule),
      })),
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
          // A remembered payer that put it here (0069): «правило „…“, запомнено …», «Забыть правило».
          payerRule: ruleOf(l.payerRule),
          payment: p
            ? {
                id: p.id,
                grossTetri: p.grossTetri,
                number: p.rental?.number ?? p.sale?.number ?? p.goodsSale?.number ?? null,
                rentalId: p.rental?.id ?? null,
                saleId: p.sale?.id ?? null,
                // A goods sale the name rule attached (ADR-0045): the screen links to /sales/goods/:id.
                goodsSaleId: p.goodsSale?.id ?? null,
                customer: p.customer?.name ?? null,
              }
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
      where: { status: 'ignored', ...BY_PERSON, resolvedAt: { gte: new Date(Date.now() - days * 24 * 3600_000) } },
      orderBy: [{ resolvedAt: 'desc' }],
      take: 300,
      include: { expenseParts: { orderBy: { seq: 'asc' }, select: { categoryId: true, amountTetri: true } } },
    });
    const people = await prisma.user.findMany({ where: { id: { in: [...new Set(lines.map((l) => l.resolvedById).filter((x): x is string => x != null))] } }, select: { id: true, name: true } });
    const who = new Map(people.map((u) => [u.id, u.name]));
    return {
      days,
      lines: lines.map((l) => {
        const line = storedLine(l);
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
          // An expense split into parts (ADR-0030): each part's category and sum.
          parts: l.expenseParts.map((p) => ({ categoryId: p.categoryId, amountTetri: p.amountTetri })),
          // Who answered: a rule's name when the stand did it itself (`own_transfer_auto`, ADR-0028).
          rule: l.matchedRule,
          categoryId: l.expenseCategoryId,
          // Other income's category (0069).
          incomeCategoryId: l.incomeCategoryId,
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
    const line = storedLine(l);
    const s = suggest(line, await loadCtx());
    return {
      line: { id: l.id, occurredOn: isoDate(l.occurredOn), direction: l.direction, amountTetri: l.amountTetri, grossTetri: line.grossTetri, payer: l.payer, purpose: l.purpose, raw: l.raw, channel: line.channel, status: l.status },
      // The earlier shape, kept for what still reads it.
      hints: s.suggestions.filter((x) => x.kind === 'rental').map((x) => ({ rentalId: x.id, number: x.number, customer: x.customer, why: x.reason.code })),
      ...s,
    };
  });

  /** This line is this record's money (§3.2): a rental, a sale, a repair, or the customer's account. */
  app.post<{ Params: { id: string }; Body: Body }>('/api/statement-lines/:id/assign', { config: { scope: 'payments.sort.customer' } }, async (req) => {
    const actor = actorOf(req);
    const b = req.body ?? {};
    // A charge — a fine, a key, damage — is paid on its own (ADR-0023): «Ремонт / начисление» (issue #13).
    const target = { rentalId: str(b, 'rentalId'), saleId: str(b, 'saleId'), serviceJobId: str(b, 'serviceJobId'), goodsSaleId: str(b, 'goodsSaleId'), customerId: str(b, 'customerId'), chargeId: str(b, 'chargeId') };
    const named = Object.values(target).filter(Boolean).length;
    if (named === 0) throw badRequest('missing_field', 'Say what this line pays for.', { field: 'rentalId' });
    if (target.chargeId && named > 1) throw badRequest('split_bad_target', 'A charge is paid on its own.', { field: 'chargeId' });
    // «Запомнить для „…“» (0069): for rent, a deposit or an advance the payer is remembered as the customer.
    const remember = b.remember === true;
    // A manager's: the customers' records, and no standing rule (issue #15, ADR-0048).
    if (!maySortTo(rightsOf(actor), target) || (remember && !mayRemember(rightsOf(actor)))) throw ownersAnswer();
    if (remember && !target.rentalId && !target.customerId) throw badRequest('remember_rent_only', 'A payer is remembered for rent, a deposit or an advance.', { field: 'remember' });
    const line = remember ? await prisma.statementLine.findUnique({ where: { id: req.params.id } }) : null;
    const key = line ? payerKey(storedLine(line)) : null;
    if (remember && !key) throw badRequest('no_payer', 'The bank names nobody on this line: there is no payer to remember.', { field: 'remember' });
    const r = await prisma.$transaction((tx) => attach(tx, { actorId: actor.id, lineId: req.params.id, rule: 'by_hand', ...target }));
    if (!remember) return { ok: true, id: r.paymentId };
    const customerId = target.customerId ?? (await prisma.rental.findUniqueOrThrow({ where: { id: target.rentalId! }, select: { customerId: true } })).customerId;
    const remembered = await rememberPayer({ actorId: actor.id, key: key!, kind: 'customer', customerId, categoryId: null, lineId: req.params.id });
    return { ok: true, id: r.paymentId, ...remembered };
  });

  /**
   * "Разделить": one line, several records — a rental week and a repair paid
   * in one transfer (meeting of 14.10.2026). Each part is what the customer
   * paid for that record; together they are the whole line.
   *
   * `shift` — «Перенос дня оплаты» (issue #12, ADR-0041 addendum of
   * 23.10.2026): the renter's latest week moved by the pay day he asked for,
   * in the same transaction — `{ rentalId, seq, days, extraTetri, reason }`.
   * A longer week's extra is money of the line and counts in its sum; a
   * shorter week's discount does not.
   */
  app.post<{ Params: { id: string }; Body: Body }>('/api/statement-lines/:id/split', { config: { scope: 'payments.sort.customer' } }, async (req) => {
    const actor = actorOf(req);
    const body = req.body ?? {};
    const shiftRaw = body.shift;
    let shift: SplitShift | null = null;
    if (shiftRaw != null) {
      if (typeof shiftRaw !== 'object' || Array.isArray(shiftRaw)) throw badRequest('bad_field', 'shift must be an object', { field: 'shift' });
      const sb = shiftRaw as Body;
      shift = {
        rentalId: str(sb, 'rentalId', { required: true })!,
        seq: int(sb, 'seq', { required: true, min: 1 })!,
        days: int(sb, 'days', { required: true })!,
        extraTetri: tetri(sb, 'extraTetri', { min: 0 }),
        reason: str(sb, 'reason', { max: 500 }),
      };
    }
    const raw = body.parts;
    // The line may be the move's money alone: no other part then.
    if (!Array.isArray(raw) || (raw.length === 0 && !shift)) throw badRequest('missing_field', 'Say what each part pays for.', { field: 'parts' });
    if (raw.length > SPLIT_MAX) throw badRequest('split_too_many', `A split has at most ${SPLIT_MAX} parts.`);
    const parts = raw.map((x) => {
      const b = (x ?? {}) as Body;
      return {
        grossTetri: tetri(b, 'grossTetri', { required: true, min: 1 })!,
        rentalId: str(b, 'rentalId'),
        saleId: str(b, 'saleId'),
        serviceJobId: str(b, 'serviceJobId'),
        goodsSaleId: str(b, 'goodsSaleId'),
        customerId: str(b, 'customerId'),
        chargeId: str(b, 'chargeId'),
        carriedPeriodId: str(b, 'carriedPeriodId'),
        fineRentalId: str(b, 'fineRentalId'),
        fineReason: str(b, 'fineReason', { max: 500 }),
        // «Залог» as a part of its own, and a rent part that leaves the deposit to it (issue #13).
        depositRentalId: str(b, 'depositRentalId'),
        rentOnly: b.rentOnly === true,
      };
    });
    // «Несколько услуг» of the customers' records only, for whoever sorts those (issue #15): no advance, no new
    // fine. The pay day moved with the line is whoever may move a renter's week (ADR-0041, addendum of 23.10.2026).
    if (parts.some((p) => !maySortTo(rightsOf(actor), p))) throw ownersAnswer();
    if (shift && !hasPerm(actor, 'rental.week.shift')) throw ownersAnswer();
    const today = todayISO(new Date(), env.TZ);
    const r = await prisma.$transaction((tx) => split(tx, { actorId: actor.id, lineId: req.params.id, parts, shift, today }));
    // What the night would do for the moved week, now: a week begun, money freed or not yet placed.
    if (shift) await settleAfterShift(shift.rentalId, today);
    // The week moved, for the message's «Отменить»: the payments and the move go back together.
    return { ok: true, ids: r.paymentIds, ...(shift ? { shift: { rentalId: shift.rentalId, seq: shift.seq } } : {}) };
  });

  /** "Да, это он": the line is a payment already entered by hand (§3.2 "Похоже, уже записан"). */
  app.post<{ Params: { id: string }; Body: Body }>('/api/statement-lines/:id/link', { config: { scope: 'payments.sort.customer' } }, async (req) => {
    const actor = actorOf(req);
    const paymentId = str(req.body ?? {}, 'paymentId', { required: true })!;
    // A manager links money coming in to a customer's payment entered by hand — rent, a sale, a repair, goods (issue #15).
    if (!hasPerm(actor, 'payments.reconcile')) {
      const [line, payment] = await Promise.all([
        prisma.statementLine.findUnique({ where: { id: req.params.id }, select: { direction: true } }),
        prisma.payment.findUnique({ where: { id: paymentId }, select: { kind: true, direction: true } }),
      ]);
      if (!line) throw notFound('line_not_found', 'No such statement line.');
      if (!payment) throw notFound('payment_not_found', 'No such payment.');
      if (line.direction !== 'in' || payment.direction !== 'in' || !mayLinkPayment(rightsOf(actor), payment.kind)) throw ownersAnswer();
    }
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

  /**
   * «Это дубль» (issue #16): the second listing of a Bank of Georgia card
   * payment the bank sent twice — the line the queue marks «похоже на дубль
   * строки от …» — out of the queue, with the line it repeats as its reason.
   * Only a line rule 5 finds a twin for: any other line is «Это не наше», with
   * a reason in words. «Вернуть в очередь» puts it back.
   */
  app.post<{ Params: { id: string } }>('/api/statement-lines/:id/duplicate', { config: { scope: 'payments.reconcile' } }, async (req) => {
    const actor = actorOf(req);
    const line = await prisma.statementLine.findUnique({ where: { id: req.params.id }, select: { id: true, bank: true, raw: true, occurredOn: true, status: true } });
    if (!line) throw notFound('line_not_found', 'No such statement line.');
    if (line.status !== 'unmatched') throw conflict('already_matched', 'This line is already attached.');
    const twin = (await twinsOf([line])).get(line.id);
    if (!twin) throw conflict('no_twin', 'This line repeats no other line.');
    await setAside(line.id, actor.id, 'duplicate', twinReason(twin));
    await audit({ actorId: actor.id, action: 'statement.line.duplicate', entityType: 'statement_line', entityId: line.id, after: { twinId: twin.id, twinOn: twin.occurredOn, twinDocNo: twin.docNo } });
    return { ok: true };
  });

  /** An outgoing line that is the company's own spending: one tap (§3.2 "Списания"). */
  app.post<{ Params: { id: string }; Body: Body }>('/api/statement-lines/:id/expense', { config: { scope: 'payments.reconcile' } }, async (req) => {
    const actor = actorOf(req);
    const b = req.body ?? {};
    const line = await prisma.statementLine.findUnique({ where: { id: req.params.id }, select: { direction: true, payer: true, purpose: true } });
    if (!line) throw notFound('line_not_found', 'No such statement line.');
    if (line.direction !== 'out') throw conflict('incoming_line', 'Money coming in is not a company expense.');
    // What it was for (migration 0046). A screen from before the categories sends none.
    const categoryId = str(b, 'categoryId');
    if (categoryId) {
      const c = await prisma.expenseCategory.findUnique({ where: { id: categoryId }, select: { archived: true } });
      if (!c || c.archived) throw notFound('category_not_found', 'No such expense category.');
    }
    const remember = b.remember === true && categoryId != null;
    const key = remember ? expenseKey(line) : null;
    if (remember && !key) throw badRequest('no_payee', 'The bank names nobody on this line: there is no payee to remember.');
    const result = await prisma.$transaction(async (tx) => {
      await setAside(req.params.id, actor.id, 'company_expense', null, categoryId, tx);
      if (!key) return { ruleId: null as string | null, alsoSorted: [] as string[] };
      // One live rule a payee: remembering it again replaces the old one.
      await tx.expenseRule.updateMany({ where: { payeeKey: key, archivedAt: null }, data: { archivedAt: new Date(), archivedById: actor.id } });
      const rule = await tx.expenseRule.create({ data: { payeeKey: key, categoryId: categoryId!, createdById: actor.id }, select: { id: true, categoryId: true } });
      const alsoSorted: string[] = [];
      for (const id of await waitingFrom(tx, key, req.params.id)) if (await sortByRule(tx, id, rule, actor.id)) alsoSorted.push(id);
      return { ruleId: rule.id, alsoSorted };
    });
    await audit({ actorId: actor.id, action: 'statement.line.expense', entityType: 'statement_line', entityId: req.params.id, after: { categoryId, remember, ...result } });
    return { ok: true, ...result };
  });

  /**
   * One outgoing line as several expenses (ADR-0030): two to nine parts, each
   * with its category and sum; together they are the whole line. No payee is
   * remembered — the next line from it may be split differently.
   */
  app.post<{ Params: { id: string }; Body: Body }>('/api/statement-lines/:id/expense-split', { config: { scope: 'payments.reconcile' } }, async (req) => {
    const actor = actorOf(req);
    const raw = (req.body ?? {}).parts;
    if (!Array.isArray(raw) || raw.length === 0) throw badRequest('missing_field', 'Say what each part was for.', { field: 'parts' });
    if (raw.length < 2) throw badRequest('split_needs_two', 'A split has at least two parts.');
    if (raw.length > SPLIT_MAX) throw badRequest('split_too_many', `A split has at most ${SPLIT_MAX} parts.`);
    const parts = raw.map((x) => {
      const b = (x ?? {}) as Body;
      const amountTetri = tetri(b, 'amountTetri', { required: true, min: 1 })!;
      return { amountTetri, categoryId: str(b, 'categoryId', { required: true })! };
    });
    if (new Set(parts.map((p) => p.categoryId)).size !== parts.length) throw badRequest('split_same_target', 'Two parts have the same category: make them one.');
    const line = await prisma.statementLine.findUnique({ where: { id: req.params.id }, select: { direction: true, amountTetri: true } });
    if (!line) throw notFound('line_not_found', 'No such statement line.');
    if (line.direction !== 'out') throw conflict('incoming_line', 'Money coming in is not a company expense.');
    const sum = parts.reduce((n, p) => n + p.amountTetri, 0);
    if (sum !== line.amountTetri) throw badRequest('split_sum', 'The parts must add up to the whole line.', { lineTetri: line.amountTetri, partsTetri: sum });
    const live = await prisma.expenseCategory.count({ where: { id: { in: parts.map((p) => p.categoryId) }, archived: false } });
    if (live !== parts.length) throw notFound('category_not_found', 'No such expense category.');
    await prisma.$transaction(async (tx) => {
      await setAside(req.params.id, actor.id, 'company_expense', null, null, tx);
      await tx.statementLineExpensePart.createMany({ data: parts.map((p, i) => ({ lineId: req.params.id, seq: i + 1, amountTetri: p.amountTetri, categoryId: p.categoryId })) });
    });
    await audit({ actorId: actor.id, action: 'statement.line.expense_split', entityType: 'statement_line', entityId: req.params.id, after: { parts } });
    return { ok: true };
  });

  /**
   * "Отменить" right after «Записать»: the line waits again, and so do the
   * lines the remembered payee sorted in the same tap; the rule is forgotten.
   */
  app.post<{ Params: { id: string }; Body: Body }>('/api/statement-lines/:id/expense-undo', { config: { scope: 'payments.reconcile' } }, async (req) => {
    const actor = actorOf(req);
    const ruleId = str(req.body ?? {}, 'ruleId');
    const restored = await prisma.$transaction(async (tx) => {
      const back = (where: Prisma.StatementLineWhereInput) =>
        tx.statementLine.updateMany({
          where: { ...where, status: 'ignored', resolution: 'company_expense' },
          data: { status: 'unmatched', matchedRule: null, resolution: null, resolutionReason: null, resolvedById: null, resolvedAt: null, expenseCategoryId: null, expenseRuleId: null },
        });
      const own = await back({ id: req.params.id });
      if (own.count === 0) throw conflict('not_set_aside', 'This line is not set aside.');
      if (!ruleId) return 1;
      await tx.expenseRule.updateMany({ where: { id: ruleId, archivedAt: null }, data: { archivedAt: new Date(), archivedById: actor.id } });
      return 1 + (await back({ expenseRuleId: ruleId })).count;
    });
    await audit({ actorId: actor.id, action: 'statement.line.expense_undo', entityType: 'statement_line', entityId: req.params.id, after: { ruleId, restored } });
    return { ok: true, restored };
  });

  /**
   * «Возврат залога» or «Поставщику» from the line itself (migration 0046's
   * screen): the payout or the supplier payment is written with this line as
   * its source — nobody enters it in «Деньги» by hand first. Annulled, the
   * line goes back to the queue like any line's payment.
   */
  app.post<{ Params: { id: string }; Body: Body }>('/api/statement-lines/:id/pay-out', { config: { scope: 'payments.reconcile' } }, async (req) => {
    const actor = actorOf(req);
    const b = req.body ?? {};
    const kind = oneOf(b, 'kind', ['deposit_payout', 'supplier'] as const, { required: true })!;
    const rentalId = kind === 'deposit_payout' ? str(b, 'rentalId', { required: true }) : null;
    const purchaseId = kind === 'supplier' ? str(b, 'purchaseId', { required: true }) : null;
    const id = await prisma.$transaction(async (tx) => {
      const line = await tx.statementLine.findUnique({ where: { id: req.params.id } });
      if (!line) throw notFound('line_not_found', 'No such statement line.');
      if (line.direction !== 'out') throw conflict('incoming_line', 'Money coming in is not handed back or paid out.');
      const claimed = await tx.statementLine.updateMany({ where: { id: line.id, status: 'unmatched' }, data: { status: 'matched', matchedRule: 'by_hand' } });
      if (claimed.count === 0) throw conflict('already_matched', 'This line is already attached.');
      const paymentId = await recordOutFromLine(
        tx,
        actor,
        { kind, rentalId, purchaseId, amountTetri: line.amountTetri, channel: 'transfer', occurredOn: isoDate(line.occurredOn) },
        { id: line.id, occurredOn: isoDate(line.occurredOn)!, raw: line.raw },
      );
      await tx.statementLine.update({ where: { id: line.id }, data: { paymentId } });
      return paymentId;
    });
    await audit({ actorId: actor.id, action: 'statement.line.pay_out', entityType: 'statement_line', entityId: req.params.id, after: { kind, rentalId, purchaseId, paymentId: id } });
    return { ok: true, id };
  });

  /** «Между счетами»: money between the company's own accounts, or into the till — neither spent nor somebody else's. */
  app.post<{ Params: { id: string }; Body: Body }>('/api/statement-lines/:id/own-transfer', { config: { scope: 'payments.reconcile' } }, async (req) => {
    const actor = actorOf(req);
    // Money coming in from our own account may have its payer remembered (0069).
    const remember = (req.body ?? {}).remember === true;
    const key = remember ? await incomingKey(req.params.id) : null;
    await setAside(req.params.id, actor.id, 'own_transfer', null);
    await audit({ actorId: actor.id, action: 'statement.line.own_transfer', entityType: 'statement_line', entityId: req.params.id });
    if (!key) return { ok: true };
    return { ok: true, ...(await rememberPayer({ actorId: actor.id, key, kind: 'own_transfer', customerId: null, categoryId: null, lineId: req.params.id })) };
  });

  /**
   * «Акционеру»: money a shareholder took out of the company (ADR-0029) —
   * not an expense, and not somebody else's. Money going out only.
   */
  app.post<{ Params: { id: string } }>('/api/statement-lines/:id/shareholder', { config: { scope: 'payments.reconcile' } }, async (req) => {
    const actor = actorOf(req);
    const line = await prisma.statementLine.findUnique({ where: { id: req.params.id }, select: { direction: true } });
    if (!line) throw notFound('line_not_found', 'No such statement line.');
    if (line.direction !== 'out') throw conflict('not_outgoing', 'Only money going out is taken by a shareholder.');
    await setAside(req.params.id, actor.id, 'shareholder', null);
    await audit({ actorId: actor.id, action: 'statement.line.shareholder', entityType: 'statement_line', entityId: req.params.id });
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
    const done = await prisma.statementLine.updateMany({ where: { id: line.id, status: 'ignored' }, data: BACK_TO_QUEUE });
    if (done.count === 0) throw conflict('not_set_aside', 'This line is not set aside.');
    // A line split into expenses waits again whole (ADR-0030).
    await prisma.statementLineExpensePart.deleteMany({ where: { lineId: line.id } });
    await audit({ actorId: actor.id, action: 'statement.line.restore', entityType: 'statement_line', entityId: line.id, before: { resolution: line.resolution, reason: line.resolutionReason } });
    return { ok: true };
  });

  /**
   * "Отвязать": the line goes back to the queue. A payment the line made is
   * annulled; one entered by hand keeps living and only lets go of the line (B2-07).
   */
  app.post<{ Params: { id: string } }>('/api/statement-lines/:id/unlink', { config: { scope: 'payments.sort.customer' } }, async (req) => {
    const actor = actorOf(req);
    const line = await prisma.statementLine.findUnique({
      where: { id: req.params.id },
      include: { payments: { where: { voidedAt: null }, select: { id: true, source: true, createdById: true } }, bankDeposit: { select: { id: true } } },
    });
    if (!line) throw notFound('line_not_found', 'No such statement line.');
    if (line.status !== 'matched') throw conflict('not_matched', 'This line is not attached.');
    // A manager lets go of the money he attached himself from the line, and of nobody else's link (issue #15).
    if (!mayUnlink(rightsOf(actor), line.bankDeposit ? [] : line.payments, actor.id)) throw ownersAnswer();
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

/**
 * The payer key of a line coming in, for «Запомнить для „…“» (0069): refused
 * when the line goes out or names nobody to remember.
 */
export async function incomingKey(lineId: string): Promise<string> {
  const line = await prisma.statementLine.findUnique({ where: { id: lineId } });
  if (!line) throw notFound('line_not_found', 'No such statement line.');
  if (line.direction !== 'in') throw conflict('not_incoming', 'Only money coming in has a payer to remember.');
  const key = payerKey(storedLine(line));
  if (!key) throw badRequest('no_payer', 'The bank names nobody on this line: there is no payer to remember.', { field: 'remember' });
  return key;
}
