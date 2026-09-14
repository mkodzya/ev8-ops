import type { FastifyInstance } from 'fastify';
import { audit } from '../lib/audit.js';
import { isoDate } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { actorOf } from '../lib/guard.js';
import { recordPayment } from '../lib/payments.js';
import { hintsFor, importStatement } from '../lib/statements/import.js';
import { ParseError } from '../lib/statements/parse.js';
import { str } from '../lib/validate.js';

// Statements and the queue they leave behind (PAY-01, PAY-03).
//
// The file arrives as text in a JSON body, the same way photos arrive as
// base64: one less dependency in an image the company rebuilds by hand, and
// a statement is a few hundred kilobytes of CSV.

const MAX_BYTES = 8 * 1024 * 1024;
const BODY_LIMIT = Math.ceil(MAX_BYTES * 1.2);

type Body = Record<string, unknown>;

export function statementRoutes(app: FastifyInstance): void {
  app.get('/api/statements', { config: { scope: 'payments.reconcile' } }, async () => {
    const statements = await prisma.statement.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { uploadedBy: { select: { name: true } } },
    });
    const queue = await prisma.statementLine.count({ where: { status: 'unmatched' } });
    return {
      queue,
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

  app.post<{ Body: Body }>(
    '/api/statements',
    { config: { scope: 'payments.reconcile' }, bodyLimit: BODY_LIMIT },
    async (req, reply) => {
      const actor = actorOf(req);
      const b = req.body ?? {};
      const fileName = str(b, 'fileName', { required: true, max: 200 })!;
      const text = typeof b.text === 'string' ? b.text : null;
      if (!text) throw badRequest('missing_field', 'text is required', { field: 'text' });
      if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) throw badRequest('file_too_big', 'Statements up to 8 MB.');
      try {
        const result = await importStatement({ actorId: actor.id, fileName, text });
        return reply.code(201).send(result);
      } catch (e) {
        if (e instanceof ParseError) throw badRequest('unreadable_statement', e.message);
        throw e;
      }
    },
  );

  /** The queue: lines nobody could place, newest first. */
  app.get('/api/statement-lines', { config: { scope: 'payments.reconcile' } }, async () => {
    const lines = await prisma.statementLine.findMany({
      where: { status: 'unmatched' },
      orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
      take: 200,
      include: { statement: { select: { bank: true, fileName: true } } },
    });
    return {
      lines: lines.map((l) => ({
        id: l.id,
        bank: l.bank,
        occurredOn: isoDate(l.occurredOn),
        amountTetri: l.amountTetri,
        grossTetri: l.grossTetri,
        feeTetri: l.feeTetri,
        payer: l.payer,
        purpose: l.purpose,
        raw: l.raw,
        fileName: l.statement.fileName,
      })),
    };
  });

  /** One line with its hints, so answering it is a choice and not a search. */
  app.get<{ Params: { id: string } }>('/api/statement-lines/:id', { config: { scope: 'payments.reconcile' } }, async (req) => {
    const found = await hintsFor(req.params.id);
    if (!found) throw notFound('line_not_found', 'No such statement line.');
    return found;
  });

  /** Two taps: this line belongs to this rental. */
  app.post<{ Params: { id: string }; Body: Body }>(
    '/api/statement-lines/:id/assign',
    { config: { scope: 'payments.reconcile' } },
    async (req) => {
      const actor = actorOf(req);
      const rentalId = str(req.body ?? {}, 'rentalId', { required: true })!;
      const line = await prisma.statementLine.findUnique({ where: { id: req.params.id } });
      if (!line) throw notFound('line_not_found', 'No such statement line.');
      if (line.status === 'matched') throw conflict('already_matched', 'This line is already attached to a payment.');
      if (line.direction === 'out') throw conflict('outgoing_line', 'Money leaving the account is not a customer payment.');

      const rental = await prisma.rental.findUnique({ where: { id: rentalId }, select: { id: true, customerId: true } });
      if (!rental) throw notFound('rental_not_found', 'No such rental.');

      const grossTetri = line.grossTetri ?? line.amountTetri;
      const payment = await recordPayment({
        actorId: actor.id,
        occurredOn: isoDate(line.occurredOn)!,
        channel: line.grossTetri != null ? 'acquiring' : 'transfer',
        grossTetri,
        feeTetri: line.feeTetri ?? Math.max(0, grossTetri - line.amountTetri),
        customerId: rental.customerId,
        rentalId: rental.id,
        bankText: line.raw.slice(0, 500),
        note: null,
        source: 'statement',
      });
      await prisma.payment.update({ where: { id: payment.id }, data: { statementLineId: line.id } });
      await prisma.statementLine.update({
        where: { id: line.id },
        data: { status: 'matched', matchedRule: 'by_hand', paymentId: payment.id },
      });
      await audit({ actorId: actor.id, action: 'statement.line.assign', entityType: 'statement_line', entityId: line.id, after: { rentalId, paymentId: payment.id } });
      return { ok: true, ...payment };
    },
  );

  /** Not a customer payment at all: interest, a bank charge, our own transfer. */
  app.post<{ Params: { id: string }; Body: Body }>(
    '/api/statement-lines/:id/ignore',
    { config: { scope: 'payments.reconcile' } },
    async (req) => {
      const actor = actorOf(req);
      const reason = str(req.body ?? {}, 'reason', { required: true, max: 500 })!;
      const line = await prisma.statementLine.findUnique({ where: { id: req.params.id } });
      if (!line) throw notFound('line_not_found', 'No such statement line.');
      if (line.status === 'matched') throw conflict('already_matched', 'This line is already attached to a payment.');
      await prisma.statementLine.update({ where: { id: line.id }, data: { status: 'ignored', matchedRule: 'ignored' } });
      await audit({ actorId: actor.id, action: 'statement.line.ignore', entityType: 'statement_line', entityId: line.id, note: reason });
      return { ok: true };
    },
  );
}
