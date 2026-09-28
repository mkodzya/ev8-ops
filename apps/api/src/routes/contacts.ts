import { CONTACT_KINDS, normalizeVin, vinFault } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { audit } from '../lib/audit.js';
import { isoDate } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { actorOf } from '../lib/guard.js';
import { str } from '../lib/validate.js';
import { PURCHASE_INCLUDE, serializePurchase } from './purchases.js';

// Records that turned out to be one record, and VINs that were typed wrong
// (wave 5 §3.9, B3-06). Both are an owner's corrections: they rewrite
// history rather than add to it, so both leave the journal a "was / became".

type Body = Record<string, unknown>;

/**
 * A supplier's card in fields (migration 0031, Mika 28.09.2026, option 2):
 * each thing its own line instead of one paragraph. The keys are the API's
 * and the columns' alike, in the order a person fills them in.
 */
const SUPPLIER_FIELDS = [
  { key: 'country', max: 200 },
  { key: 'contactPerson', max: 200 },
  { key: 'phone', max: 40 },
  { key: 'channel', max: 200 },
  { key: 'goods', max: 1000 },
  { key: 'address', max: 500 },
  { key: 'bank', max: 1000 },
  { key: 'notes', max: 4000 },
] as const;
type SupplierField = (typeof SUPPLIER_FIELDS)[number]['key'];
const SUPPLIER_SELECT = {
  id: true, name: true, recordKind: true,
  country: true, contactPerson: true, phone: true, channel: true, goods: true, address: true, bank: true, notes: true,
} as const;
type SupplierRow = { id: string; name: string } & Record<SupplierField, string | null>;
const supplierCard = (r: SupplierRow) => ({
  id: r.id,
  name: r.name,
  ...Object.fromEntries(SUPPLIER_FIELDS.map((f) => [f.key, r[f.key]])),
});

export function contactRoutes(app: FastifyInstance): void {
  /** Suppliers, for an order (B3-04): a factory is not looked for among customers. */
  app.get('/api/suppliers', { config: { scope: 'purchases.view' } }, async () => {
    const rows = await prisma.customer.findMany({
      where: { archived: false, recordKind: 'supplier' },
      orderBy: { name: 'asc' },
      select: SUPPLIER_SELECT,
    });
    const debts = await supplierDebts(rows.map((r) => r.id));
    return {
      suppliers: rows.map((r) => ({
        ...supplierCard(r),
        orders: debts.get(r.id)?.orders ?? 0,
        lastOrderedOn: debts.get(r.id)?.lastOrderedOn ?? null,
        debt: debts.get(r.id)?.debt ?? [],
      })),
    };
  });

  /** One factory: what is owed to it and what has been ordered from it (§3.5). */
  app.get<{ Params: { id: string } }>('/api/suppliers/:id', { config: { scope: 'purchases.view' } }, async (req) => {
    const row = await prisma.customer.findUnique({ where: { id: req.params.id }, select: SUPPLIER_SELECT });
    if (!row || row.recordKind !== 'supplier') throw notFound('supplier_not_found', 'No such supplier.');
    const orders = await prisma.purchase.findMany({
      where: { supplierId: row.id },
      orderBy: { orderedOn: 'desc' },
      include: PURCHASE_INCLUDE,
    });
    const debts = await supplierDebts([row.id]);
    return {
      supplier: {
        ...supplierCard(row),
        orders: orders.length,
        lastOrderedOn: debts.get(row.id)?.lastOrderedOn ?? null,
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
        ...Object.fromEntries(SUPPLIER_FIELDS.map((f) => [f.key, str(b, f.key, { max: f.max })])),
        recordKind: 'supplier',
        kind: 'company',
      },
      select: { id: true, name: true },
    });
    await audit({ actorId: actor.id, action: 'supplier.create', entityType: 'customer', entityId: row.id, after: { name } });
    return reply.code(201).send(row);
  });

  /**
   * The card's fields, corrected where they are read (Mika, 28.09.2026).
   * Only the fields sent are touched; the journal keeps each one's was / became.
   * A name another record already carries is said, not refused — as at
   * creation, two factories can share one — unless `force` says it is meant.
   */
  app.patch<{ Params: { id: string }; Body: Body }>('/api/suppliers/:id', { config: { scope: 'purchases.manage' } }, async (req) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const row = await prisma.customer.findUnique({ where: { id: req.params.id }, select: SUPPLIER_SELECT });
    if (!row || row.recordKind !== 'supplier') throw notFound('supplier_not_found', 'No such supplier.');
    const was: Record<string, string | null> = { name: row.name, ...Object.fromEntries(SUPPLIER_FIELDS.map((f) => [f.key, row[f.key]])) };
    const now: Record<string, string | null> = {};
    if ('name' in b) now.name = str(b, 'name', { required: true, max: 200 })!;
    for (const f of SUPPLIER_FIELDS) if (f.key in b) now[f.key] = str(b, f.key, { max: f.max });
    const keys = Object.keys(now).filter((k) => now[k] !== was[k]);
    if (keys.length === 0) return { ok: true };
    if (keys.includes('name') && !b.force) {
      const twin = await prisma.customer.findFirst({
        where: { id: { not: row.id }, archived: false, name: { equals: now.name!, mode: 'insensitive' } },
        select: { id: true, name: true },
      });
      if (twin) throw conflict('duplicate_supplier', 'A record with this name exists.', { existing: twin, field: 'name' });
    }
    await prisma.customer.update({
      where: { id: row.id },
      data: { ...Object.fromEntries(keys.map((k) => [k, now[k]])), updatedAt: new Date() },
    });
    await audit({
      actorId: actor.id,
      action: 'supplier.update',
      entityType: 'customer',
      entityId: row.id,
      before: Object.fromEntries(keys.map((k) => [k, was[k]])),
      after: Object.fromEntries(keys.map((k) => [k, now[k]])),
    });
    return { ok: true };
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
type SupplierSums = { orders: number; lastOrderedOn: string | null; debt: { currency: string; minor: number }[] };

async function supplierDebts(ids: string[]): Promise<Map<string, SupplierSums>> {
  if (ids.length === 0) return new Map();
  const orders = await prisma.purchase.findMany({
    where: { supplierId: { in: ids }, status: { not: 'cancelled' } },
    select: {
      id: true,
      supplierId: true,
      currency: true,
      orderedOn: true,
      paidBeforeMinor: true,
      lines: { select: { qty: true, unitPriceMinor: true } },
      payments: { where: { voidedAt: null, direction: 'out' }, select: { foreignMinor: true } },
    },
  });
  const out = new Map<string, SupplierSums>();
  for (const o of orders) {
    const invoice = o.lines.reduce((n, l) => n + l.qty * l.unitPriceMinor, 0);
    const paid = o.payments.reduce((n, p) => n + Number(p.foreignMinor ?? 0), 0) + Number(o.paidBeforeMinor);
    const left = Math.max(0, invoice - paid);
    const row = out.get(o.supplierId) ?? { orders: 0, lastOrderedOn: null, debt: [] };
    row.orders += 1;
    // The last order the card and the list name: when this factory last sold to us.
    const on = isoDate(o.orderedOn);
    if (on && (!row.lastOrderedOn || on > row.lastOrderedOn)) row.lastOrderedOn = on;
    if (left > 0) {
      const line = row.debt.find((d) => d.currency === o.currency);
      if (line) line.minor += left;
      else row.debt.push({ currency: o.currency, minor: left });
    }
    out.set(o.supplierId, row);
  }
  return out;
}
