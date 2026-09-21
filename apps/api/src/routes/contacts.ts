import { CONTACT_KINDS, normalizeVin, vinFault } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { audit } from '../lib/audit.js';
import { prisma } from '../lib/db.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { actorOf } from '../lib/guard.js';
import { str } from '../lib/validate.js';
import { PURCHASE_INCLUDE, serializePurchase } from './purchases.js';

// Records that turned out to be one record, and VINs that were typed wrong
// (wave 5 §3.9, B3-06). Both are an owner's corrections: they rewrite
// history rather than add to it, so both leave the journal a "was / became".

type Body = Record<string, unknown>;

export function contactRoutes(app: FastifyInstance): void {
  /** Suppliers, for an order (B3-04): a factory is not looked for among customers. */
  app.get('/api/suppliers', { config: { scope: 'purchases.view' } }, async () => {
    const rows = await prisma.customer.findMany({
      where: { archived: false, OR: [{ recordKind: 'supplier' }, { isSupplier: true }] },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, address: true, notes: true, phone: true },
    });
    const debts = await supplierDebts(rows.map((r) => r.id));
    return {
      suppliers: rows.map((r) => ({
        id: r.id,
        name: r.name,
        country: r.address,
        contact: r.notes,
        phone: r.phone,
        orders: debts.get(r.id)?.orders ?? 0,
        debt: debts.get(r.id)?.debt ?? [],
      })),
    };
  });

  /** One factory: what is owed to it and what has been ordered from it (§3.5). */
  app.get<{ Params: { id: string } }>('/api/suppliers/:id', { config: { scope: 'purchases.view' } }, async (req) => {
    const row = await prisma.customer.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, address: true, notes: true, phone: true, recordKind: true, isSupplier: true },
    });
    if (!row || !(row.recordKind === 'supplier' || row.isSupplier)) throw notFound('supplier_not_found', 'No such supplier.');
    const orders = await prisma.purchase.findMany({
      where: { supplierId: row.id },
      orderBy: { orderedOn: 'desc' },
      include: PURCHASE_INCLUDE,
    });
    const debts = await supplierDebts([row.id]);
    return {
      supplier: {
        id: row.id,
        name: row.name,
        country: row.address,
        contact: row.notes,
        phone: row.phone,
        orders: orders.length,
        debt: debts.get(row.id)?.debt ?? [],
      },
      orders: orders.map(serializePurchase),
    };
  });

  /** A factory nobody has ordered from before, made where it is needed (S1). */
  app.post<{ Body: Body }>('/api/suppliers', { config: { scope: 'purchases.manage' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const name = str(b, 'name', { required: true, max: 200 })!;
    const twin = await prisma.customer.findFirst({ where: { archived: false, name: { equals: name, mode: 'insensitive' } }, select: { id: true, name: true } });
    if (twin && !b.force) throw conflict('duplicate_supplier', 'A record with this name exists.', { existing: twin, field: 'name' });
    const row = await prisma.customer.create({
      data: {
        name,
        // A factory's country and the person who answers there: the two things
        // an order needs and the card has room for.
        address: str(b, 'country', { max: 200 }),
        notes: str(b, 'contact', { max: 1000 }),
        phone: str(b, 'phone', { max: 40 }),
        recordKind: 'supplier',
        isSupplier: true,
        kind: 'company',
      },
      select: { id: true, name: true },
    });
    await audit({ actorId: actor.id, action: 'supplier.create', entityType: 'customer', entityId: row.id, after: { name } });
    return reply.code(201).send(row);
  });

  /**
   * Two cards, one person (§3.9). Everything the duplicate holds moves to the
   * card that stays; the duplicate goes to the archive pointing at it, so a
   * link somebody saved a month ago still leads somewhere true.
   */
  app.post<{ Params: { id: string }; Body: Body }>('/api/customers/:id/merge', { config: { scope: 'settings.manage' } }, async (req) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const keepId = req.params.id;
    const dropId = str(b, 'fromId', { required: true })!;
    const reason = str(b, 'reason', { required: true, max: 1000 })!;
    if (keepId === dropId) throw badRequest('same_customer', 'A card cannot be merged into itself.', { field: 'fromId' });
    const [keep, drop] = await Promise.all([
      prisma.customer.findUnique({ where: { id: keepId }, select: { id: true, name: true, archived: true } }),
      prisma.customer.findUnique({ where: { id: dropId }, select: { id: true, name: true, archived: true, personalId: true } }),
    ]);
    if (!keep || !drop) throw notFound('customer_not_found', 'No such customer.');
    if (drop.archived) throw conflict('already_merged', 'That card is already in the archive.', { field: 'fromId' });

    const moved = await prisma.$transaction(async (tx) => {
      const where = { customerId: dropId };
      const counts = {
        rentals: (await tx.rental.updateMany({ where, data: { customerId: keepId } })).count,
        sales: (await tx.sale.updateMany({ where, data: { customerId: keepId } })).count,
        payments: (await tx.payment.updateMany({ where, data: { customerId: keepId } })).count,
        documents: (await tx.storedFile.updateMany({ where, data: { customerId: keepId } })).count,
        repairs: (await tx.serviceJob.updateMany({ where, data: { customerId: keepId } })).count,
      };
      // A personal number is unique: the duplicate gives it up, because two
      // cards cannot hold one, and the card that stays already has its own.
      await tx.customer.update({
        where: { id: dropId },
        data: { archived: true, mergedIntoId: keepId, personalId: null, updatedAt: new Date() },
      });
      return counts;
    });
    await audit({ actorId: actor.id, action: 'customer.merge', entityType: 'customer', entityId: keepId, before: { from: drop.name }, after: { into: keep.name, ...moved }, note: reason });
    return { ok: true, moved };
  });

  /**
   * A VIN typed wrong (§3.9, crit. 32). Only an owner, always with a reason,
   * and the journal keeps both spellings — the moped is the same moped and
   * its history does not move anywhere.
   */
  app.patch<{ Params: { id: string }; Body: Body }>('/api/fleet/:id/vin', { config: { scope: 'settings.manage' } }, async (req) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const vin = normalizeVin(str(b, 'vin', { required: true, max: 40 })!);
    const reason = str(b, 'reason', { required: true, max: 1000 })!;
    const fault = vinFault(vin);
    if (fault) throw badRequest('bad_vin', 'A VIN is 17 characters and has no I, O or Q.', { field: 'vin', fault });
    const before = await prisma.vehicle.findUnique({ where: { id: req.params.id }, select: { id: true, vin: true } });
    if (!before) throw notFound('vehicle_not_found', 'No such moped.');
    if (before.vin === vin) throw conflict('nothing_to_correct', 'That is the VIN it already has.', { field: 'vin' });
    const taken = await prisma.vehicle.findUnique({ where: { vin }, select: { id: true } });
    if (taken) throw conflict('duplicate_vin', 'This VIN is already in the fleet.', { field: 'vin', existing: taken });
    await prisma.vehicle.update({ where: { id: before.id }, data: { vin, updatedAt: new Date() } });
    await audit({ actorId: actor.id, action: 'vehicle.vin', entityType: 'vehicle', entityId: before.id, before: { vin: before.vin }, after: { vin }, note: reason });
    return { ok: true, vin };
  });
}

/** What is still owed to each factory, in its own currency (B3-04). */
async function supplierDebts(ids: string[]): Promise<Map<string, { orders: number; debt: { currency: string; minor: number }[] }>> {
  if (ids.length === 0) return new Map();
  const orders = await prisma.purchase.findMany({
    where: { supplierId: { in: ids }, status: { not: 'cancelled' } },
    select: {
      id: true,
      supplierId: true,
      currency: true,
      paidBeforeMinor: true,
      lines: { select: { qty: true, unitPriceMinor: true } },
      payments: { where: { voidedAt: null, direction: 'out' }, select: { foreignMinor: true } },
    },
  });
  const out = new Map<string, { orders: number; debt: { currency: string; minor: number }[] }>();
  for (const o of orders) {
    const invoice = o.lines.reduce((n, l) => n + l.qty * l.unitPriceMinor, 0);
    const paid = o.payments.reduce((n, p) => n + Number(p.foreignMinor ?? 0), 0) + Number(o.paidBeforeMinor);
    const left = Math.max(0, invoice - paid);
    const row = out.get(o.supplierId) ?? { orders: 0, debt: [] };
    row.orders += 1;
    if (left > 0) {
      const line = row.debt.find((d) => d.currency === o.currency);
      if (line) line.minor += left;
      else row.debt.push({ currency: o.currency, minor: left });
    }
    out.set(o.supplierId, row);
  }
  return out;
}
