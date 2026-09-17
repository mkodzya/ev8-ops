import type { FastifyInstance } from 'fastify';
import { isoDate } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { notFound } from '../lib/errors.js';
import { mayView } from '../lib/guard.js';

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
      where: { archived: false },
      orderBy: { name: 'asc' },
      include: {
        // Every rental: the list counts them and sums the debt with the rule
        // the rentals list uses (periods not paid); only open ones are named.
        rentals: {
          select: { id: true, number: true, status: true, paidThrough: true, periods: { where: { payStatus: { not: 'paid' } }, select: { amountTetri: true, paidTetri: true } } },
        },
        _count: { select: { sales: { where: { status: { not: 'cancelled' } } } } },
      },
    });
    return {
      customers: customers.map((c) => ({
        id: c.id,
        name: c.name,
        nameKa: c.nameKa,
        nameLat: c.nameLat,
        personalId: identity ? c.personalId : c.personalId ? '••••' : null,
        phone: c.phone,
        email: c.email,
        kind: c.kind,
        isSupplier: c.isSupplier,
        tags: c.tags,
        openRentals: c.rentals
          .filter((r) => OPEN_RENTAL.includes(r.status))
          .map((r) => ({ id: r.id, number: r.number, status: r.status, paidThrough: isoDate(r.paidThrough) })),
        rentals: c.rentals.length,
        debtTetri: c.rentals.reduce((n, r) => n + r.periods.reduce((m, p) => m + (p.amountTetri - p.paidTetri), 0), 0),
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
        // the card; the file itself only to director and owner (CST-03) —
        // the files route enforces that, so ids are safe to list here.
        documents: { where: { archived: false }, orderBy: { createdAt: 'asc' }, select: { id: true, docKind: true, label: true, sizeBytes: true, mimeType: true, createdAt: true } },
      },
    });
    if (!c) throw notFound('customer_not_found', 'No such customer.');
    return {
      customer: {
        id: c.id,
        name: c.name,
        nameKa: c.nameKa,
        nameLat: c.nameLat,
        personalId: identity ? c.personalId : c.personalId ? '••••' : null,
        phone: c.phone,
        email: c.email,
        kind: c.kind,
        isSupplier: c.isSupplier,
        tags: c.tags,
        address: c.address,
        notes: c.notes,
      },
      documents: c.documents.map((d) => ({ id: d.id, docKind: d.docKind, label: d.label, sizeBytes: d.sizeBytes, mimeType: d.mimeType, createdAt: d.createdAt.toISOString() })),
      canOpenDocuments: identity,
      rentals: c.rentals.map((r) => ({
        id: r.id,
        number: r.number,
        status: r.status,
        vehicle: r.vehicle,
        vinUnconfirmed: r.vinUnconfirmed,
        pickedUpOn: isoDate(r.pickedUpOn),
        returnedOn: isoDate(r.returnedOn),
        paidThrough: isoDate(r.paidThrough),
        weeklyRateTetri: r.weeklyRateTetri,
        deposit: r.deposit ? { amountTetri: r.deposit.amountTetri, status: r.deposit.status } : null,
      })),
    };
  });
}
