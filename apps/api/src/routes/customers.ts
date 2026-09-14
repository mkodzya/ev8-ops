import type { FastifyInstance } from 'fastify';
import { isoDate } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { notFound } from '../lib/errors.js';

// Customers, read side (CST-01). Personal numbers are shown only to roles
// that may see documents (CST-03): a manager sees the card, not the number.

function canSeeIdentity(role: string): boolean {
  return role === 'owner' || role === 'director';
}

export function customerRoutes(app: FastifyInstance): void {
  app.get('/api/customers', { config: { scope: 'fleet.view' } }, async (req) => {
    const identity = canSeeIdentity(req.actor!.role);
    const customers = await prisma.customer.findMany({
      where: { archived: false },
      orderBy: { name: 'asc' },
      include: {
        rentals: { where: { status: { in: ['active', 'overdue', 'paused', 'disputed'] } }, select: { id: true, number: true, status: true, paidThrough: true } },
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
        tags: c.tags,
        openRentals: c.rentals.map((r) => ({ id: r.id, number: r.number, status: r.status, paidThrough: isoDate(r.paidThrough) })),
      })),
    };
  });

  app.get<{ Params: { id: string } }>('/api/customers/:id', { config: { scope: 'fleet.view' } }, async (req) => {
    const identity = canSeeIdentity(req.actor!.role);
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
