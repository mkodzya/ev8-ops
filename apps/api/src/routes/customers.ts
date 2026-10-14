import { rentDueOn, todayISO } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { audit } from '../lib/audit.js';
import { dayOf, isoDate } from '../lib/dates.js';
import { debtOf, debtsOf } from '../lib/debt.js';
import { prisma } from '../lib/db.js';
import { env } from '../lib/env.js';
import { notFound } from '../lib/errors.js';
import { actorOf, mayView } from '../lib/guard.js';
import { payOffsetOf, rentStateOf } from '../lib/rentState.js';

// Customers, read side (CST-01). Personal numbers are shown only to roles
// that may see documents (CST-03): a manager sees the card, not the number.

const OPEN_RENTAL: string[] = ['active', 'overdue', 'paused', 'disputed'];

export function customerRoutes(app: FastifyInstance): void {
  /**
   * Is this person already on a card? (U12, CST-02.)
   *
   * The same rule the create route enforces, asked before anybody fills in
   * the rest of the form — a duplicate refused after typing nine fields is a
   * duplicate somebody creates anyway with a changed digit.
   */
  app.get<{ Querystring: { phone?: string; personalId?: string } }>(
    '/api/customers/lookup',
    { config: { scope: 'customer.create' } },
    async (req) => {
      const phone = (req.query.phone ?? '').trim();
      const personalId = (req.query.personalId ?? '').trim();
      if (!phone && !personalId) return { existing: null };
      const existing = await prisma.customer.findFirst({
        where: {
          archived: false,
          OR: [...(personalId ? [{ personalId }] : []), ...(phone ? [{ phone }] : [])],
        },
        select: { id: true, name: true, phone: true },
      });
      return { existing };
    },
  );

  app.get('/api/customers', { config: { scope: 'fleet.view' } }, async (req) => {
    const identity = mayView(req, 'customer.documents.view');
    const customers = await prisma.customer.findMany({
      // Clients only (B3-06, wave 5 §3.9): a factory has a card of its own,
      // and neither the hand-over nor the sale should have to step over it.
      where: { archived: false, recordKind: { not: 'supplier' } },
      orderBy: { name: 'asc' },
      include: {
        // Every rental: the list counts them; only open ones are named, each
        // by the status the rentals list gives it (ADR-0017).
        rentals: {
          select: { id: true, number: true, status: true, paidThrough: true, pickedUpOn: true, payWeekday: true },
        },
        _count: { select: { sales: { where: { status: { not: 'cancelled' } } } } },
      },
    });
    const today = todayISO(new Date(), env.TZ);
    const debts = await debtsOf(customers.map((c) => c.id), today);
    return {
      customers: customers.map((c) => ({
        id: c.id,
        name: c.name,
        nameKa: c.nameKa,
        nameLat: c.nameLat,
        personalId: c.personalId ? '••••' : null,
        phone: c.phone,
        email: c.email,
        kind: c.kind,
        recordKind: c.recordKind,
        tags: c.tags,
        openRentals: c.rentals
          .filter((r) => OPEN_RENTAL.includes(r.status))
          .map((r) => ({ id: r.id, number: r.number, status: rentStateOf(r, today).status, paidThrough: isoDate(r.paidThrough) })),
        rentals: c.rentals.length,
        // The one debt figure (B7-02): the same the card, "Today" and the search show.
        debtTetri: debts.get(c.id)?.owesTetri ?? 0,
        // Of that figure: awaited today and not late, and the rent alone of it (ADR-0017).
        dueTodayTetri: debts.get(c.id)?.dueTodayTetri ?? 0,
        dueTodayRentTetri: debts.get(c.id)?.dueTodayRentTetri ?? 0,
        creditTetri: debts.get(c.id)?.creditTetri ?? 0,
        // Where the debt sits: «Долг 300 по R-00488» in the hand-over (wave 3 §3.1).
        debtIn: (debts.get(c.id)?.parts ?? []).filter((p) => p.owesTetri > 0).map((p) => ({ kind: p.kind, id: p.id, number: p.number, owesTetri: p.owesTetri })),
        buyer: c._count.sales > 0,
      })),
    };
  });

  app.get<{ Params: { id: string } }>('/api/customers/:id', { config: { scope: 'fleet.view' } }, async (req) => {
    const identity = mayView(req, 'customer.documents.view');
    const c = await prisma.customer.findUnique({
      where: { id: req.params.id },
      include: {
        rentals: {
          orderBy: { createdAt: 'desc' },
          include: { vehicle: { select: { id: true, vin: true } }, deposit: true },
        },
        // Documents: the fact of a document is visible to everyone who sees
        // the card; the file itself only to the owners (CST-03) —
        // the files route enforces that, so ids are safe to list here.
        documents: { where: { archived: false }, orderBy: { createdAt: 'asc' }, select: { id: true, docKind: true, label: true, sizeBytes: true, mimeType: true, createdAt: true } },
      },
    });
    if (!c) throw notFound('customer_not_found', 'No such customer.');
    // The one debt figure and what it is made of (B7-04, wave 2), the sales,
    // and one timeline: money, documents, changes of the card.
    // One clock for the figure and for the statuses of the rentals below.
    const today = todayISO(new Date(), env.TZ);
    const debt = await debtOf(c.id, today);
    const [sales, payments, log] = await Promise.all([
      prisma.sale.findMany({
        where: { customerId: c.id, status: { not: 'cancelled' } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, number: true, status: true, soldOn: true, priceTetri: true, instalments: { select: { seq: true, payStatus: true } } },
      }),
      prisma.payment.findMany({
        where: { customerId: c.id, voidedAt: null },
        orderBy: { occurredOn: 'desc' },
        take: 50,
        select: { id: true, occurredOn: true, channel: true, kind: true, direction: true, grossTetri: true, rental: { select: { number: true } }, sale: { select: { number: true } } },
      }),
      prisma.auditLog.findMany({ where: { entityType: 'customer', entityId: c.id }, orderBy: { createdAt: 'desc' }, take: 50, include: { actor: { select: { name: true } } } }),
    ]);
    const feed = [
      ...payments.map((p) => ({
        at: isoDate(p.occurredOn)!,
        kind: 'payment' as const,
        text: p.channel,
        number: p.rental?.number ?? p.sale?.number ?? null,
        amountTetri: p.direction === 'out' ? -p.grossTetri : p.grossTetri,
        by: null as string | null,
        note: null as string | null,
      })),
      ...c.documents.map((d) => ({ at: dayOf(d.createdAt)!, kind: 'document' as const, text: d.docKind ?? '', number: null, amountTetri: null, by: null, note: d.label })),
      ...log.map((l) => ({ at: dayOf(l.createdAt)!, kind: 'log' as const, text: l.action, number: null, amountTetri: null, by: l.actor?.name ?? null, note: l.note })),
    ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return {
      debt: { owesTetri: debt.owesTetri, dueTodayTetri: debt.dueTodayTetri, creditTetri: debt.creditTetri, depositHeldTetri: debt.depositHeldTetri, aheadTetri: debt.aheadTetri, parts: debt.parts },
      sales: sales.map((s2) => ({
        id: s2.id,
        number: s2.number,
        status: s2.status,
        soldOn: isoDate(s2.soldOn),
        priceTetri: s2.priceTetri,
        instalments: s2.instalments.length,
        instalmentsPaid: s2.instalments.filter((i) => i.payStatus === 'paid').length,
      })),
      feed,
      customer: {
        id: c.id,
        name: c.name,
        nameKa: c.nameKa,
        nameLat: c.nameLat,
        // The number itself is asked for separately, and the asking is
        // written down (Q27, §3.8): a card anybody opens must not carry it.
        personalId: c.personalId ? '••••' : null,
        phone: c.phone,
        email: c.email,
        kind: c.kind,
        recordKind: c.recordKind,
        tags: c.tags,
        address: c.address,
        notes: c.notes,
        source: c.source,
        kommoRef: c.kommoRef,
        // A card merged away is in the archive, and an archive that looks
        // like a live card is not one: the screen needs to know (crit. 33,
        // QA-W5-03).
        archived: c.archived,
        mergedInto: c.mergedIntoId ? await prisma.customer.findUnique({ where: { id: c.mergedIntoId }, select: { id: true, name: true, nameKa: true, nameLat: true } }) : null,
      },
      documents: c.documents.map((d) => ({ id: d.id, docKind: d.docKind, label: d.label, sizeBytes: d.sizeBytes, mimeType: d.mimeType, createdAt: d.createdAt.toISOString() })),
      canOpenDocuments: identity,
      // Is there a number to ask for, and may this person ask.
      personalIdAvailable: identity && Boolean(c.personalId),
      rentals: c.rentals.map((r) => ({
        id: r.id,
        number: r.number,
        // As the rentals list calls it — never the stored status, which does not know overdue (ADR-0017).
        status: rentStateOf(r, today).status,
        vehicle: r.vehicle,
        vinUnconfirmed: r.vinUnconfirmed,
        pickedUpOn: isoDate(r.pickedUpOn),
        returnedOn: isoDate(r.returnedOn),
        paidThrough: isoDate(r.paidThrough),
        // The day the next rent is due — on the rental's pay day (ADR-0020); the WhatsApp text names it.
        dueOn: r.pickedUpOn && (r.status === 'active' || r.status === 'overdue') ? rentDueOn(isoDate(r.paidThrough), isoDate(r.pickedUpOn)!, payOffsetOf(r)) : null,
        weeklyRateTetri: r.weeklyRateTetri,
        deposit: r.deposit ? { amountTetri: r.deposit.amountTetri, status: r.deposit.status } : null,
      })),
    };
  });

  /**
   * "Показать" the personal number (CST-03, Q27). Every look is written —
   * three looks are three rows — because otherwise "looked three times" is
   * exactly the thing that cannot be found out afterwards. The journal folds
   * a day's looks into one line with a counter; the CSV keeps all three
   * (wave 6 §3.8, crit. 19).
   */
  app.get<{ Params: { id: string } }>('/api/customers/:id/personal-id', { config: { scope: 'customer.documents.view' } }, async (req) => {
    const actor = actorOf(req);
    const c = await prisma.customer.findUnique({ where: { id: req.params.id }, select: { id: true, personalId: true } });
    if (!c) throw notFound('customer_not_found', 'No such customer.');
    await audit({ actorId: actor.id, action: 'customer.personalId.view', entityType: 'customer', entityId: c.id });
    return { personalId: c.personalId };
  });
}
