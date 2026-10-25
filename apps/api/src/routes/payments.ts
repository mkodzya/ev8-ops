import { INCOME_ROWS, acquiringGross, goodsTotals, paymentInRow, rentCreditTetri, rentWeekday, todayISO, type IncomeRow, type WeekAllocationTarget, type WeekPaymentKind } from '@ev8/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { hasPerm } from '../lib/auth.js';
import { dateFromISO, isoDate } from '../lib/dates.js';
import { debtOf } from '../lib/debt.js';
import { prisma } from '../lib/db.js';
import { env } from '../lib/env.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { actorOf } from '../lib/guard.js';
import { MONEY_KINDS, bankLinesFor, planMoney, recordMoney, type MoneyInput } from '../lib/money.js';
import { voidPayment } from '../lib/payments.js';
import { payOffsetOf } from '../lib/rentState.js';
import { date, oneOf, str, strList, tetri } from '../lib/validate.js';

// Money in and out (wave 2 §3.1, §3.3). One form writes every kind; the
// list says what came in, what went out and what the card acquirer kept; a
// payment has a page of its own with what it closed.

const CHANNELS = ['transfer', 'acquiring', 'cash'] as const;
/** What the list filters by: the form's channels and rent closed by a mechanic's work, which only a payout writes (0066). */
const LIST_CHANNELS = [...CHANNELS, 'offset'] as const;
/** "Undo" in the message after a write: seconds on screen, a minute of room for a slow phone. A remembered payer's undo keeps it too (inbound.ts). */
export const UNDO_MS = 60_000;
type Body = Record<string, unknown>;
type Query = Record<string, string | undefined>;

function moneyInput(b: Body): MoneyInput {
  const kind = oneOf(b, 'kind', MONEY_KINDS, { required: true })!;
  const foreign = b.foreignAmount;
  let foreignMinor: number | null = null;
  if (foreign != null && foreign !== '') {
    const n = typeof foreign === 'number' ? foreign : Number(String(foreign).replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) throw badRequest('bad_field', 'foreignAmount must be an amount', { field: 'foreignAmount' });
    foreignMinor = Math.round(n * 100);
  }
  return {
    kind,
    rentalId: str(b, 'rentalId'),
    saleId: str(b, 'saleId'),
    serviceJobId: str(b, 'serviceJobId'),
    goodsSaleId: str(b, 'goodsSaleId'),
    customerId: str(b, 'customerId'),
    purchaseId: str(b, 'purchaseId'),
    amountTetri: tetri(b, 'amountTetri', { required: true, min: 1 })!,
    channel: oneOf(b, 'channel', CHANNELS) ?? 'cash',
    occurredOn: date(b, 'occurredOn'),
    backdateReason: str(b, 'backdateReason', { max: 500 }),
    note: str(b, 'note', { max: 1000 }),
    paidTo: str(b, 'paidTo', { max: 200 }),
    paidToReason: str(b, 'paidToReason', { max: 500 }),
    foreignMinor,
    foreignCurrency: str(b, 'foreignCurrency', { max: 3 }),
    bankFeeTetri: tetri(b, 'bankFeeTetri', { min: 0 }),
    toState: oneOf(b, 'toState', ['available', 'service'] as const) ?? 'available',
    notBankLines: strList(b, 'notBankLines'),
  };
}

/** Filters in the address (§3.3): period, channel, direction, kind, who. */
function paymentWhere(req: FastifyRequest<{ Querystring: Query }>) {
  const actor = actorOf(req);
  const q = req.query;
  // A manager: their own payments, "Мои платежи" — and a record's payments on a card they have open.
  const mine = !hasPerm(actor, 'payments.view') && !q.customerId && !q.rentalId && !q.saleId && !q.goodsSaleId;
  return {
    ...(q.customerId ? { customerId: q.customerId } : {}),
    ...(q.rentalId ? { rentalId: q.rentalId } : {}),
    ...(q.saleId ? { saleId: q.saleId } : {}),
    ...(q.goodsSaleId ? { goodsSaleId: q.goodsSaleId } : {}),
    ...(q.from || q.to ? { occurredOn: { ...(q.from ? { gte: dateFromISO(q.from)! } : {}), ...(q.to ? { lte: dateFromISO(q.to)! } : {}) } } : {}),
    ...(q.channel && (LIST_CHANNELS as readonly string[]).includes(q.channel) ? { channel: q.channel as (typeof LIST_CHANNELS)[number] } : {}),
    ...(q.direction === 'in' || q.direction === 'out' ? { direction: q.direction as 'in' | 'out' } : {}),
    ...(q.kind && (MONEY_KINDS as readonly string[]).includes(q.kind) ? { kind: q.kind as (typeof MONEY_KINDS)[number] } : {}),
    ...(q.by ? { createdById: q.by } : {}),
    ...(mine ? { createdById: actor.id } : {}),
  };
}

export function paymentRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: Query }>('/api/payments', { config: { scope: 'fleet.view' } }, async (req) => {
    const payments = await prisma.payment.findMany({
      where: paymentWhere(req),
      orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
      take: 1000,
      include: {
        customer: { select: { id: true, name: true, nameKa: true, nameLat: true } },
        rental: { select: { id: true, number: true } },
        sale: { select: { id: true, number: true } },
        purchase: { select: { id: true, number: true } },
        serviceJob: { select: { id: true, number: true } },
        goodsSale: { select: { id: true, number: true } },
        createdBy: { select: { id: true, name: true } },
        allocations: { select: { amountTetri: true, target: true } },
      },
    });

    // A figure on the week's report links here, and ux №10 asks that the
    // list add up to the figure it came from. The week splits one payment
    // between rows — a hand-over is rent and a deposit at once — so the list
    // has to answer the same question: how much of each payment belongs to
    // this row. Same function, `paymentInRow` (QA-W6-01).
    const row = (INCOME_ROWS as readonly string[]).includes(req.query.row ?? '') ? (req.query.row as IncomeRow) : null;
    const inRow = (p: (typeof payments)[number]): number =>
      paymentInRow(
        {
          occurredOn: isoDate(p.occurredOn) as string,
          direction: p.direction as 'in' | 'out',
          channel: p.channel as 'cash' | 'acquiring' | 'transfer' | 'deposit' | 'offset',
          kind: p.kind as WeekPaymentKind,
          grossTetri: p.grossTetri,
          feeTetri: p.feeTetri,
          allocations: p.allocations.map((a) => ({ target: a.target as WeekAllocationTarget, amountTetri: a.amountTetri })),
        },
        row ?? 'rent',
      );
    // The total over the filter (§3.3): what came in, what went out, what the
    // acquirer kept. A voided payment is shown, not counted.
    const live = payments.filter((p) => !p.voidedAt).filter((p) => (row ? inRow(p) > 0 : true));
    const totals = {
      // When a row of the week asked, the total is what belongs to that row —
      // not the whole of every payment that touches it.
      rowTetri: row ? live.reduce((n, p) => n + inRow(p), 0) : null,
      // Money kept from a deposit came in once already, as the deposit: it is not counted twice.
      // Rent closed by a mechanic's work never came in (0066).
      inTetri: live.filter((p) => p.direction === 'in' && p.channel !== 'deposit' && p.channel !== 'offset').reduce((n, p) => n + p.grossTetri, 0),
      outTetri: live.filter((p) => p.direction === 'out').reduce((n, p) => n + p.grossTetri, 0),
      acquiringFeeTetri: live.filter((p) => p.channel === 'acquiring' && p.direction === 'in').reduce((n, p) => n + p.feeTetri, 0),
    };
    const people = hasPerm(actorOf(req), 'payments.view')
      ? await prisma.user.findMany({ where: { paymentsCreated: { some: {} } }, select: { id: true, name: true }, orderBy: { name: 'asc' } })
      : [];
    return {
      totals,
      people,
      row,
      // A voided payment is listed, not counted — and only under the row of its own kind: its allocations went
      // with it, so `paymentInRow` names it by what it was for. It used to show under every row (QA 23.10.2026).
      payments: (row ? payments.filter((p) => inRow(p) > 0) : payments).map((p) => ({
        id: p.id,
        occurredOn: isoDate(p.occurredOn),
        direction: p.direction,
        kind: p.kind,
        channel: p.channel,
        grossTetri: p.grossTetri,
        feeTetri: p.feeTetri,
        netTetri: p.netTetri,
        customer: p.customer,
        rental: p.rental,
        sale: p.sale,
        purchase: p.purchase,
        serviceJob: p.serviceJob,
        goodsSale: p.goodsSale,
        bankText: p.bankText,
        note: p.note,
        source: p.source,
        fromStatement: p.statementLineId != null,
        allocatedTetri: p.allocations.reduce((n, a) => n + a.amountTetri, 0),
        voided: p.voidedAt != null,
        voidKind: p.voidKind,
        voidReason: p.voidReason,
        createdBy: p.createdBy?.name ?? null,
        createdById: p.createdBy?.id ?? null,
      })),
    };
  });

  /** A payment's own page (§3.3): what it closed, the bank line, the journal. */
  app.get<{ Params: { id: string } }>('/api/payments/:id', { config: { scope: 'fleet.view' } }, async (req) => {
    const actor = actorOf(req);
    const p = await prisma.payment.findUnique({
      where: { id: req.params.id },
      include: {
        customer: { select: { id: true, name: true, nameKa: true, nameLat: true } },
        rental: { select: { id: true, number: true } },
        sale: { select: { id: true, number: true } },
        purchase: { select: { id: true, number: true, currency: true } },
        serviceJob: { select: { id: true, number: true } },
        goodsSale: { select: { id: true, number: true } },
        createdBy: { select: { id: true, name: true } },
        voidedBy: { select: { name: true } },
        statementLine: { select: { id: true, bank: true, occurredOn: true, amountTetri: true, payer: true, purpose: true, matchedRule: true } },
        allocations: {
          select: {
            target: true,
            amountTetri: true,
            period: { select: { seq: true, startsOn: true, endsOn: true } },
            instalment: { select: { seq: true, dueOn: true } },
            charge: { select: { kind: true, note: true } },
          },
        },
      },
    });
    if (!p) throw notFound('payment_not_found', 'No such payment.');
    if (!hasPerm(actor, 'payments.view') && p.createdById !== actor.id) throw forbidden('forbidden', 'This payment is not yours.');
    // The other parts of a split bank line: voiding this payment voids them too (migration 0039).
    const splitWith =
      p.statementLineId && p.source === 'statement'
        ? await prisma.payment.findMany({
            where: { statementLineId: p.statementLineId, source: 'statement', voidedAt: p.voidedAt ? undefined : null, id: { not: p.id } },
            orderBy: { statementPart: 'asc' },
            select: { id: true, grossTetri: true, rental: { select: { number: true } }, sale: { select: { number: true } }, serviceJob: { select: { number: true } }, goodsSale: { select: { number: true } }, customer: { select: { name: true } } },
          })
        : [];
    const journal = await prisma.auditLog.findMany({
      where: { entityType: 'payment', entityId: p.id },
      orderBy: { createdAt: 'asc' },
      include: { actor: { select: { name: true } } },
    });
    return {
      payment: {
        id: p.id,
        occurredOn: isoDate(p.occurredOn),
        direction: p.direction,
        kind: p.kind,
        channel: p.channel,
        grossTetri: p.grossTetri,
        feeTetri: p.feeTetri,
        netTetri: p.netTetri,
        customer: p.customer,
        rental: p.rental,
        sale: p.sale,
        purchase: p.purchase,
        serviceJob: p.serviceJob,
        goodsSale: p.goodsSale,
        note: p.note,
        paidTo: p.paidTo,
        paidToReason: p.paidToReason,
        backdateReason: p.backdateReason,
        foreignAmount: p.foreignMinor != null ? Number(p.foreignMinor) / 100 : null,
        foreignCurrency: p.foreignCurrency,
        source: p.source,
        createdBy: p.createdBy?.name ?? null,
        createdAt: p.createdAt.toISOString(),
        voided: p.voidedAt != null,
        voidKind: p.voidKind,
        voidReason: p.voidReason,
        voidedBy: p.voidedBy?.name ?? null,
        voidedAt: p.voidedAt?.toISOString() ?? null,
        statementLine: p.statementLine ? { ...p.statementLine, occurredOn: isoDate(p.statementLine.occurredOn) } : null,
        splitWith: splitWith.map((x) => ({ id: x.id, grossTetri: x.grossTetri, number: x.rental?.number ?? x.sale?.number ?? x.serviceJob?.number ?? x.goodsSale?.number ?? null, customer: x.customer?.name ?? null })),
        closed: p.allocations.map((a) => ({
          target: a.target,
          amountTetri: a.amountTetri,
          seq: a.period?.seq ?? a.instalment?.seq ?? null,
          startsOn: a.period ? isoDate(a.period.startsOn) : null,
          endsOn: a.period ? isoDate(a.period.endsOn) : null,
          dueOn: a.instalment ? isoDate(a.instalment.dueOn) : null,
          // What a return charged, by its kind and note: the page took a key for an instalment (QA after issue #9).
          chargeKind: a.charge?.kind ?? null,
          chargeNote: a.charge?.note ?? null,
        })),
        // The rest of the money, which no week, deposit or charge has taken yet: rent credit (PAY-06).
        creditTetri: rentCreditTetri({
          direction: p.direction,
          kind: p.kind,
          voided: p.voidedAt != null,
          grossTetri: p.grossTetri,
          allocatedTetri: p.allocations.reduce((n, a) => n + a.amountTetri, 0),
        }),
      },
      journal: journal.map((j) => ({ at: j.createdAt.toISOString(), action: j.action, who: j.actor?.name ?? null, note: j.note, before: j.before, after: j.after })),
      // Rent closed by a mechanic's payout goes with the payout, never alone (0066).
      canVoid: hasPerm(actor, 'payments.reconcile') && !p.voidedAt && p.kind !== 'buyback' && !(await prisma.mechanicPayout.findFirst({ where: { offsetPaymentId: p.id, voidedAt: null }, select: { id: true } })),
    };
  });

  /**
   * What the money form's payment will close, before it is written (§3.1
   * "Закроет") — and the bank lines it may already be (B11-03). Lines are
   * the queue's, an owner's: a manager takes cash, which has none.
   */
  app.post<{ Body: Body }>('/api/money/preview', { config: { scope: 'cash.record' } }, async (req) => {
    const input = moneyInput(req.body ?? {});
    const owner = hasPerm(actorOf(req), 'payments.reconcile');
    return prisma.$transaction(async (tx) => ({
      ...(await planMoney(tx, input)),
      inBank: owner ? await bankLinesFor(tx, input, input.occurredOn ?? todayISO(new Date(), env.TZ)) : [],
    }));
  });

  /** One form, every kind of money (§3.1). */
  app.post<{ Body: Body }>('/api/money', { config: { scope: 'cash.record' } }, async (req, reply) => {
    const result = await recordMoney(actorOf(req), moneyInput(req.body ?? {}));
    return reply.code(201).send(result);
  });

  /**
   * The earlier entry point, kept for what still posts to it: a rental or a
   * customer, and for a card line the gross or the net the bank credited.
   */
  app.post<{ Body: Body }>('/api/payments', { config: { scope: 'cash.record' } }, async (req, reply) => {
    const b = req.body ?? {};
    const channel = oneOf(b, 'channel', CHANNELS, { required: true })!;
    let gross = tetri(b, 'grossTetri', { min: 1 });
    const net = tetri(b, 'netTetri', { min: 1 });
    if (gross == null && net == null) throw badRequest('missing_field', 'grossTetri or netTetri is required', { field: 'grossTetri' });
    if (gross == null) {
      gross = channel === 'acquiring' ? acquiringGross(net!) : net!;
      if (gross == null) throw badRequest('bad_field', 'That net does not come from a whole-tetri gross.', { field: 'netTetri' });
    }
    const rentalId = str(b, 'rentalId');
    const customerId = str(b, 'customerId');
    if (!rentalId && !customerId) throw badRequest('missing_field', 'customerId is required', { field: 'customerId' });
    const occurredOn = date(b, 'occurredOn');
    const { id, plan } = await recordMoney(actorOf(req), {
      kind: rentalId ? 'rent' : 'on_account',
      rentalId,
      customerId,
      amountTetri: gross,
      channel,
      occurredOn,
      backdateReason: str(b, 'backdateReason', { max: 500 }) ?? (occurredOn ? str(b, 'note', { max: 500 }) ?? 'dated on entry' : null),
      note: str(b, 'note', { max: 1000 }),
      notBankLines: strList(b, 'notBankLines'),
    });
    return reply.code(201).send({ id, allocated: plan.grossTetri - plan.leftoverTetri, leftover: plan.leftoverTetri });
  });

  /**
   * "Undo" in the message after a write (§3.1): the same person, within
   * seconds, no reason asked. Later it is an owner's "annul", with one.
   */
  app.post<{ Params: { id: string } }>('/api/payments/:id/undo', { config: { scope: 'cash.record' } }, async (req) => {
    const actor = actorOf(req);
    const p = await prisma.payment.findUnique({ where: { id: req.params.id }, select: { createdById: true, createdAt: true, voidedAt: true, kind: true } });
    if (!p) throw notFound('payment_not_found', 'No such payment.');
    if (p.voidedAt) throw conflict('already_voided', 'This payment is already void.');
    if (p.createdById !== actor.id || Date.now() - p.createdAt.getTime() > UNDO_MS || p.kind === 'buyback') {
      throw conflict('undo_too_late', 'Too late to undo; an owner can annul it with a reason.');
    }
    await voidPayment({ actorId: actor.id, paymentId: req.params.id, reason: 'undone at once', kind: 'undo' });
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: Body }>('/api/payments/:id/void', { config: { scope: 'payments.reconcile' } }, async (req) => {
    const actor = actorOf(req);
    const reason = str(req.body ?? {}, 'reason', { required: true, max: 1000 })!;
    const p = await prisma.payment.findUnique({ where: { id: req.params.id }, select: { kind: true } });
    if (p?.kind === 'buyback') throw conflict('buyback_void', 'A buy-back moved the moped back; it is not annulled here.');
    await voidPayment({ actorId: actor.id, paymentId: req.params.id, reason });
    return { ok: true };
  });

  /** The one debt figure (B7-02) and what it is made of. */
  app.get<{ Params: { id: string } }>('/api/customers/:id/balance', { config: { scope: 'fleet.view' } }, async (req) => debtOf(req.params.id));

  /** A customer's records the money form can take money for (§3.1 "От кого"). */
  app.get<{ Params: { id: string } }>('/api/customers/:id/money-targets', { config: { scope: 'cash.record' } }, async (req) => {
    const id = req.params.id;
    const today = todayISO(new Date(), env.TZ);
    const [debt, rentals, sales, jobs, goods] = await Promise.all([
      debtOf(id, today),
      prisma.rental.findMany({
        where: { customerId: id },
        orderBy: { pickedUpOn: 'desc' },
        select: {
          id: true,
          number: true,
          status: true,
          weeklyRateTetri: true,
          transferredAt: true,
          // What «Перенос дня оплаты» counts from (issue #12): the day the rent falls due, and the weeks.
          pickedUpOn: true,
          returnedOn: true,
          payWeekday: true,
          weekShiftDays: true,
          vehicle: { select: { vin: true, model: { select: { name: true } } } },
        },
      }),
      prisma.sale.findMany({
        where: { customerId: id, status: 'active' },
        select: { id: true, number: true, instalments: { orderBy: { seq: 'asc' }, select: { dueOn: true, amountTetri: true, paidTetri: true } } },
      }),
      prisma.serviceJob.findMany({ where: { customerId: id, payer: 'customer', status: 'done' }, select: { id: true, number: true } }),
      // Goods sold to him and not paid in full (ADR-0045): the money form and «Разнести» can take money for them.
      prisma.goodsSale.findMany({
        where: { customerId: id, status: 'active' },
        orderBy: { soldOn: 'asc' },
        select: { id: true, number: true, soldOn: true, lines: { orderBy: { seq: 'asc' }, select: { name: true, countedItem: true, spec: true, qty: true, unitPriceTetri: true } }, payments: { where: { voidedAt: null, kind: 'goods' }, select: { grossTetri: true } } },
      }),
    ]);
    // What "Разделить" can put a part on beyond a whole rental (ADR-0023): a
    // fine or other charge still open, and a week carried over as paid that
    // no bank money stands behind yet.
    const rentalIds = rentals.map((r) => r.id);
    const [charges, carried, open, weeks] = await Promise.all([
      prisma.rentalCharge.findMany({
        where: { rentalId: { in: rentalIds }, voidedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true, rentalId: true, kind: true, note: true, amountTetri: true, allocations: { where: { payment: { voidedAt: null } }, select: { amountTetri: true } } },
      }),
      prisma.rentalPeriod.findMany({
        where: { rentalId: { in: rentalIds }, paidBeforeTransfer: true, carriedPaymentId: null },
        orderBy: [{ rentalId: 'asc' }, { seq: 'asc' }],
        select: { id: true, rentalId: true, seq: true, startsOn: true, endsOn: true, amountTetri: true },
      }),
      // The first week each rental still owes: where new rent money goes.
      prisma.rentalPeriod.findMany({
        where: { rentalId: { in: rentalIds }, payStatus: { not: 'paid' } },
        orderBy: [{ rentalId: 'asc' }, { seq: 'asc' }],
        select: { rentalId: true, startsOn: true, endsOn: true },
      }),
      // Every week, for the latest one a move of the pay day would change (issue #12).
      prisma.rentalPeriod.findMany({
        where: { rentalId: { in: rentalIds } },
        orderBy: [{ rentalId: 'asc' }, { seq: 'asc' }],
        select: { rentalId: true, seq: true, startsOn: true, endsOn: true, amountTetri: true, paidTetri: true, payStatus: true, extraDays: true, extraTetri: true, paidBeforeTransfer: true },
      }),
    ]);
    const firstOpen = new Map<string, { startsOn: string | null; endsOn: string | null }>();
    for (const w of open) if (!firstOpen.has(w.rentalId)) firstOpen.set(w.rentalId, { startsOn: isoDate(w.startsOn), endsOn: isoDate(w.endsOn) });
    /**
     * «Перенос дня оплаты» in «Разнести» (issue #12, ADR-0041 addendum of
     * 23.10.2026): the running rental's latest week, the weekday its rent
     * falls due on, and — when the move is shown but closed — why: an older
     * week still owed, or the week moved already. None where the week cannot
     * be moved at all: a rental not running, a week at nothing, a week paid
     * before the transfer.
     */
    const payDayMoveOf = (r: (typeof rentals)[number]) => {
      const pickedUpOn = isoDate(r.pickedUpOn);
      if ((r.status !== 'active' && r.status !== 'overdue') || r.returnedOn || !pickedUpOn) return null;
      const mine = weeks.filter((w) => w.rentalId === r.id);
      const last = mine.at(-1);
      if (!last || last.paidBeforeTransfer || (last.extraDays === 0 && last.amountTetri - last.extraTetri <= 0)) return null;
      const older = mine.some((w) => w.seq < last.seq && w.payStatus !== 'paid');
      return {
        seq: last.seq,
        startsOn: isoDate(last.startsOn)!,
        endsOn: isoDate(last.endsOn)!,
        amountTetri: last.amountTetri,
        paidTetri: last.paidTetri,
        payDay: rentWeekday(pickedUpOn, r.weekShiftDays, r.payWeekday),
        payOffsetDays: payOffsetOf(r),
        closed: older ? ('older_week_open' as const) : last.extraDays !== 0 ? ('week_moved' as const) : null,
      };
    };
    return {
      debt,
      rentals: rentals.map((r) => ({
        id: r.id,
        number: r.number,
        status: r.status,
        weeklyRateTetri: r.weeklyRateTetri,
        vin: r.vehicle?.vin ?? null,
        model: r.vehicle?.model.name ?? null,
        // The day it was carried over: a line no later than it may already be inside "paid through" (ADR-0018).
        transferredOn: r.transferredAt ? todayISO(r.transferredAt, env.TZ) : null,
        firstOpenWeek: firstOpen.get(r.id) ?? null,
        payDayMove: payDayMoveOf(r),
      })),
      sales: sales.map((s) => {
        const next = s.instalments.find((i) => i.paidTetri < i.amountTetri);
        return { id: s.id, number: s.number, nextTetri: next ? next.amountTetri - next.paidTetri : 0, nextDueOn: next ? isoDate(next.dueOn) : null, overdue: !!next && isoDate(next.dueOn)! <= today };
      }),
      repairs: jobs,
      goods: goods
        .map((g) => ({
          id: g.id,
          number: g.number,
          soldOn: isoDate(g.soldOn),
          items: g.lines.map((l) => ({ name: l.name, countedItem: l.countedItem, spec: l.spec, qty: l.qty })),
          openTetri: Math.max(0, goodsTotals(g.lines).grossTetri - g.payments.reduce((n, p) => n + p.grossTetri, 0)),
        }))
        .filter((g) => g.openTetri > 0),
      charges: charges
        .map((c) => ({ id: c.id, rentalId: c.rentalId, kind: c.kind, note: c.note, openTetri: c.amountTetri - c.allocations.reduce((n, a) => n + a.amountTetri, 0) }))
        .filter((c) => c.openTetri > 0),
      carriedWeeks: carried.map((w) => ({ id: w.id, rentalId: w.rentalId, seq: w.seq, startsOn: isoDate(w.startsOn), endsOn: isoDate(w.endsOn), amountTetri: w.amountTetri })),
    };
  });
}
