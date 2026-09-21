import { SEARCH_GROUP_LIMIT, spellingMatches, numberMatches, paymentMatches, phoneMatches, readQuery, vinMatches, type Query } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { isoDate } from '../lib/dates.js';
import { debtsOf } from '../lib/debt.js';
import { prisma } from '../lib/db.js';
import { actorOf, mayView } from '../lib/guard.js';

/**
 * The search in the header (wave 1 §3.5): one field, every kind of record,
 * grouped. Each group gives its first three and how many there are in all,
 * so "More N" can open the section's list with the same search.
 *
 * The business is small enough — dozens of customers, a few hundred rentals
 * and payments — that records are read and matched here with the shared
 * rules, not with a text index. When that stops being true this is the one
 * place that changes.
 *
 * Rights follow the rest of the API: no personal number for a manager, no
 * purchases, and of payments only the cash they took themselves.
 */

interface Group<T> {
  total: number;
  items: T[];
}

const group = <T>(all: T[]): Group<T> => ({ total: all.length, items: all.slice(0, SEARCH_GROUP_LIMIT) });

export function searchRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { q?: string } }>('/api/search', { config: { scope: 'fleet.view' } }, async (req) => {
    const q = readQuery(req.query.q ?? '');
    if (!q) return { q: null, groups: null };
    const actor = actorOf(req);
    const seeIdentity = mayView(req, 'customer.documents.view');
    const seeAllPayments = mayView(req, 'payments.view');
    const seePurchases = mayView(req, 'purchases.view');

    const [customers, vehicles, rentals, sales, payments, purchases, jobs] = await Promise.all([
      prisma.customer.findMany({
        where: { archived: false },
        select: { id: true, name: true, nameKa: true, nameLat: true, phone: true, personalId: true, recordKind: true },
        orderBy: { name: 'asc' },
      }),
      prisma.vehicle.findMany({
        where: { archived: false },
        select: { id: true, vin: true, state: true, model: { select: { brand: true, name: true } } },
        orderBy: { vin: 'asc' },
      }),
      prisma.rental.findMany({
        select: {
          id: true,
          number: true,
          status: true,
          vinNote: true,
          customerId: true,
          customer: { select: { name: true, nameKa: true, nameLat: true } },
          vehicle: { select: { vin: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.sale.findMany({
        select: {
          id: true,
          number: true,
          status: true,
          customer: { select: { name: true, nameKa: true, nameLat: true } },
          vehicle: { select: { vin: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.payment.findMany({
        where: seeAllPayments ? {} : { createdById: actor.id, channel: 'cash' as const },
        select: {
          id: true,
          grossTetri: true,
          occurredOn: true,
          channel: true,
          voidedAt: true,
          bankText: true,
          note: true,
          customer: { select: { name: true } },
          createdBy: { select: { name: true } },
          rental: { select: { id: true, number: true } },
          sale: { select: { id: true, number: true } },
        },
        orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
      }),
      seePurchases
        ? prisma.purchase.findMany({
            select: { id: true, number: true, status: true, invoiceNo: true, supplier: { select: { name: true } } },
            orderBy: { orderedOn: 'desc' },
          })
        : Promise.resolve([]),
      prisma.serviceJob.findMany({
        select: { id: true, number: true, status: true, reason: true, vehicle: { select: { vin: true, model: { select: { brand: true, name: true } } } } },
        orderBy: { openedOn: 'desc' },
      }),
    ]);

    const byCustomer = (c: { name: string; nameKa: string | null; nameLat: string | null }, q: Query) => spellingMatches(q, [c.name, c.nameKa, c.nameLat]);

    const groups = {
      customers: group(
        customers
          .filter((c) => byCustomer(c, q) || phoneMatches(q, c.phone) || (seeIdentity && !!c.personalId && c.personalId.includes(q.text)))
          .map((c) => ({ id: c.id, name: c.name, nameKa: c.nameKa, nameLat: c.nameLat, phone: c.phone, recordKind: c.recordKind })),
      ),
      vehicles: group(
        vehicles
          .filter((v) => vinMatches(q, v.vin) || spellingMatches(q, [`${v.model.brand} ${v.model.name}`]))
          .map((v) => ({ id: v.id, vin: v.vin, state: v.state, model: `${v.model.brand} ${v.model.name}` })),
      ),
      rentals: group(
        rentals
          .filter((r) => numberMatches(q, r.number) || byCustomer(r.customer, q) || vinMatches(q, r.vehicle?.vin))
          .map((r) => ({ id: r.id, number: r.number, status: r.status, customer: r.customer.name, customerId: r.customerId, vin: r.vehicle?.vin ?? null })),
      ),
      sales: group(
        sales
          .filter((s) => numberMatches(q, s.number) || byCustomer(s.customer, q) || vinMatches(q, s.vehicle?.vin))
          .map((s) => ({ id: s.id, number: s.number, status: s.status, customer: s.customer.name, vin: s.vehicle?.vin ?? null })),
      ),
      payments: group(
        payments
          .filter((p) =>
            paymentMatches(q, { grossTetri: p.grossTetri, customer: p.customer?.name, bankText: p.bankText, note: p.note, createdBy: p.createdBy?.name, rentalNumber: p.rental?.number }),
          )
          .map((p) => ({
          id: p.id,
          grossTetri: p.grossTetri,
          occurredOn: isoDate(p.occurredOn),
          channel: p.channel,
          voided: p.voidedAt != null,
          customer: p.customer?.name ?? null,
          rental: p.rental,
          sale: p.sale,
        })),
      ),
      purchases: seePurchases
        ? group(
            purchases
              .filter((p) => numberMatches(q, p.number) || spellingMatches(q, [p.supplier.name, p.invoiceNo]))
              .map((p) => ({ id: p.id, number: p.number, status: p.status, supplier: p.supplier.name, invoiceNo: p.invoiceNo })),
          )
        : null,
      jobs: group(
        jobs
          .filter((j) => numberMatches(q, j.number) || vinMatches(q, j.vehicle.vin))
          .map((j) => ({ id: j.id, number: j.number, status: j.status, reason: j.reason, vin: j.vehicle.vin, model: `${j.vehicle.model.brand} ${j.vehicle.model.name}` })),
      ),
    };
    // The one debt figure (B7-02) on what the search shows — a customer and a
    // rental carry the same number as their cards (wave 2 §3.7, QA-W2-02).
    const debts = await debtsOf([...groups.customers.items.map((c) => c.id), ...groups.rentals.items.map((r) => r.customerId)]);
    const owes = (customerId: string, rentalId?: string) =>
      rentalId
        ? (debts.get(customerId)?.parts ?? []).filter((p) => p.id === rentalId && (p.kind === 'rent' || p.kind === 'deposit' || p.kind === 'charge')).reduce((n, p) => n + p.owesTetri, 0)
        : debts.get(customerId)?.owesTetri ?? 0;
    return {
      q: req.query.q,
      groups: {
        ...groups,
        customers: { ...groups.customers, items: groups.customers.items.map((c) => ({ ...c, debtTetri: owes(c.id) })) },
        rentals: { ...groups.rentals, items: groups.rentals.items.map((r) => ({ ...r, debtTetri: owes(r.customerId, r.id) })) },
      },
    };
  });
}
