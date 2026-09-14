import { instalmentSchedule, todayISO } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { audit } from '../lib/audit.js';
import { dateFromISO, isoDate } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { env } from '../lib/env.js';
import { conflict, notFound } from '../lib/errors.js';
import { actorOf } from '../lib/guard.js';
import { recordPayment } from '../lib/payments.js';
import { date, int, oneOf, str, tetri } from '../lib/validate.js';
import { moveVehicle } from '../lib/vehicles.js';

// Selling a moped (SAL-01…03).
//
// The price starts from the model's and is edited as often as not, so it is
// a field and not a lookup. The schedule is always there, even when the
// customer pays in one go: then it is one instalment due on the day of the
// sale, and "what is owed" stays one question.

type Body = Record<string, unknown>;

const INCLUDE = {
  customer: { select: { id: true, name: true, phone: true } },
  vehicle: { select: { id: true, vin: true, model: { select: { brand: true, name: true } } } },
  instalments: { orderBy: { seq: 'asc' } },
} as const;

type SaleRow = {
  id: string;
  number: string;
  soldOn: Date;
  priceTetri: number;
  extras: string | null;
  warrantyUntil: Date | null;
  status: string;
  boughtBackOn: Date | null;
  vinNote: string | null;
  notes: string | null;
  customer: { id: string; name: string; phone?: string | null };
  vehicle: { id: string; vin: string; model: { brand: string; name: string } } | null;
  instalments: { id: string; seq: number; dueOn: Date; amountTetri: number; paidTetri: number; payStatus: string }[];
};

function serialize(s: SaleRow, today: string) {
  const paid = s.instalments.reduce((n, i) => n + i.paidTetri, 0);
  const overdue = s.instalments
    .filter((i) => i.payStatus !== 'paid' && isoDate(i.dueOn)! < today)
    .reduce((n, i) => n + (i.amountTetri - i.paidTetri), 0);
  return {
    id: s.id,
    number: s.number,
    soldOn: isoDate(s.soldOn),
    priceTetri: s.priceTetri,
    paidTetri: paid,
    outstandingTetri: s.priceTetri - paid,
    overdueTetri: overdue,
    extras: s.extras,
    warrantyUntil: isoDate(s.warrantyUntil),
    status: s.status,
    boughtBackOn: isoDate(s.boughtBackOn),
    notes: s.notes,
    customer: s.customer,
    vehicle: s.vehicle ? { id: s.vehicle.id, vin: s.vehicle.vin, model: `${s.vehicle.model.brand} ${s.vehicle.model.name}` } : null,
    vinNote: s.vinNote,
    instalments: s.instalments.map((i) => ({
      id: i.id,
      seq: i.seq,
      dueOn: isoDate(i.dueOn),
      amountTetri: i.amountTetri,
      paidTetri: i.paidTetri,
      payStatus: i.payStatus,
      overdue: i.payStatus !== 'paid' && isoDate(i.dueOn)! < today,
    })),
  };
}

export function saleRoutes(app: FastifyInstance): void {
  app.get('/api/sales', { config: { scope: 'fleet.view' } }, async () => {
    const today = todayISO(new Date(), env.TZ);
    const sales = await prisma.sale.findMany({ orderBy: { soldOn: 'desc' }, take: 300, include: INCLUDE });
    const rows = sales.map((s) => serialize(s, today));
    return {
      today,
      overdueTetri: rows.reduce((n, s) => n + s.overdueTetri, 0),
      sales: rows,
    };
  });

  app.get<{ Params: { id: string } }>('/api/sales/:id', { config: { scope: 'fleet.view' } }, async (req) => {
    const sale = await prisma.sale.findUnique({ where: { id: req.params.id }, include: INCLUDE });
    if (!sale) throw notFound('sale_not_found', 'No such sale.');
    const payments = await prisma.payment.findMany({
      where: { saleId: sale.id, voidedAt: null },
      orderBy: { occurredOn: 'asc' },
      select: { id: true, occurredOn: true, channel: true, direction: true, grossTetri: true },
    });
    return {
      sale: serialize(sale, todayISO(new Date(), env.TZ)),
      payments: payments.map((p) => ({
        id: p.id,
        occurredOn: isoDate(p.occurredOn),
        channel: p.channel,
        direction: p.direction,
        grossTetri: p.grossTetri,
      })),
    };
  });

  /** Sell a moped (SAL-01). The VIN leaves the fleet the same moment. */
  app.post<{ Body: Body }>('/api/sales', { config: { scope: 'sales.manage' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const customerId = str(b, 'customerId', { required: true })!;
    const vehicleId = str(b, 'vehicleId');
    const vinNote = str(b, 'vinNote', { max: 200 });
    if (!vehicleId && !vinNote) throw conflict('vin_or_note', 'Pick a moped from the fleet, or say what the papers show.');

    const soldOn = date(b, 'soldOn') ?? todayISO(new Date(), env.TZ);
    const priceTetri = tetri(b, 'priceTetri', { required: true, min: 1 })!;
    const downPaymentTetri = tetri(b, 'downPaymentTetri', { min: 0 }) ?? 0;
    const months = int(b, 'months', { min: 0 }) ?? 0;
    if (downPaymentTetri > priceTetri) throw conflict('down_payment_too_big', 'The down payment is more than the price.');

    const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!customer) throw notFound('customer_not_found', 'No such customer.');
    if (vehicleId) {
      const v = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { state: true, archived: true } });
      if (!v || v.archived) throw notFound('vehicle_not_found', 'No such moped.');
      if (v.state !== 'available') {
        throw conflict('vehicle_not_available', 'Only a moped standing free is sold.', { state: v.state });
      }
    }

    // Twelve months from the day, unless somebody says otherwise.
    const warranty = date(b, 'warrantyUntil') ?? (() => {
      const [y, m, d] = soldOn.split('-').map(Number);
      return new Date(Date.UTC(y + 1, m - 1, d)).toISOString().slice(0, 10);
    })();

    const sale = await prisma.$transaction(async (tx) => {
      const created = await tx.sale.create({
        data: {
          customerId,
          vehicleId: vehicleId ?? null,
          vinNote,
          soldOn: dateFromISO(soldOn)!,
          priceTetri,
          extras: str(b, 'extras', { max: 1000 }),
          warrantyUntil: dateFromISO(warranty),
          notes: str(b, 'notes', { max: 4000 }),
          createdById: actor.id,
        },
        select: { id: true, number: true },
      });
      for (const line of instalmentSchedule({ soldOn, priceTetri, downPaymentTetri, months })) {
        await tx.saleInstalment.create({
          data: { saleId: created.id, seq: line.seq, dueOn: dateFromISO(line.dueOn)!, amountTetri: line.amountTetri },
        });
      }
      if (vehicleId) {
        await moveVehicle(tx, { vehicleId, kind: 'sold', occurredOn: soldOn, actorId: actor.id });
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'sale.create',
          entityType: 'sale',
          entityId: created.id,
          after: { number: created.number, customerId, vehicleId, soldOn, priceTetri, downPaymentTetri, months },
        },
      });
      return created;
    });
    return reply.code(201).send(sale);
  });

  app.patch<{ Params: { id: string }; Body: Body }>('/api/sales/:id', { config: { scope: 'sales.manage' } }, async (req) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const sale = await prisma.sale.findUnique({ where: { id: req.params.id } });
    if (!sale) throw notFound('sale_not_found', 'No such sale.');
    if (sale.status !== 'active') throw conflict('sale_closed', 'This sale is closed.');
    const data: Record<string, unknown> = {};
    if ('extras' in b) data.extras = str(b, 'extras', { max: 1000 });
    if ('notes' in b) data.notes = str(b, 'notes', { max: 4000 });
    if ('warrantyUntil' in b) data.warrantyUntil = dateFromISO(date(b, 'warrantyUntil'));
    await prisma.sale.update({ where: { id: sale.id }, data: { ...data, updatedAt: new Date() } });
    await audit({ actorId: actor.id, action: 'sale.update', entityType: 'sale', entityId: sale.id, after: data as object });
    return { ok: true };
  });

  /**
   * The company buys the moped back (SAL-03): money goes out, the VIN comes
   * back into the fleet, and both events stay on the VIN's own history.
   */
  app.post<{ Params: { id: string }; Body: Body }>('/api/sales/:id/buy-back', { config: { scope: 'sales.manage' } }, async (req) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const sale = await prisma.sale.findUnique({ where: { id: req.params.id } });
    if (!sale) throw notFound('sale_not_found', 'No such sale.');
    if (sale.status !== 'active') throw conflict('sale_closed', 'This sale is already closed.');
    if (!sale.vehicleId) throw conflict('no_vehicle', 'This sale names no moped in the fleet.');

    const occurredOn = date(b, 'occurredOn') ?? todayISO(new Date(), env.TZ);
    if (occurredOn < isoDate(sale.soldOn)!) throw conflict('before_sale', 'A moped cannot be bought back before it was sold.');
    const amountTetri = tetri(b, 'amountTetri', { required: true, min: 1 })!;
    const channel = oneOf(b, 'channel', ['transfer', 'acquiring', 'cash'] as const) ?? 'cash';
    const toState = oneOf(b, 'toState', ['available', 'service'] as const) ?? 'available';

    await prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          occurredOn: dateFromISO(occurredOn)!,
          direction: 'out',
          channel,
          grossTetri: amountTetri,
          feeTetri: 0,
          netTetri: amountTetri,
          customerId: sale.customerId,
          saleId: sale.id,
          note: str(b, 'note', { max: 1000 }) ?? `buy-back ${sale.number}`,
          source: 'manual',
          createdById: actor.id,
        },
      });
      await tx.sale.update({
        where: { id: sale.id },
        data: { status: 'bought_back', boughtBackOn: dateFromISO(occurredOn)!, updatedAt: new Date() },
      });
      await moveVehicle(tx, {
        vehicleId: sale.vehicleId!,
        kind: 'bought_back',
        occurredOn,
        actorId: actor.id,
        reason: `${sale.number}`,
      });
      if (toState === 'service') {
        await moveVehicle(tx, {
          vehicleId: sale.vehicleId!,
          kind: 'manual',
          toState: 'service',
          occurredOn,
          actorId: actor.id,
          reason: `bought back under ${sale.number}, needs work`,
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'sale.buy_back',
          entityType: 'sale',
          entityId: sale.id,
          after: { occurredOn, amountTetri, channel, toState },
        },
      });
    });
    return { ok: true };
  });

  /** A sale entered by mistake. The VIN goes back to where it was. */
  app.post<{ Params: { id: string }; Body: Body }>('/api/sales/:id/cancel', { config: { scope: 'sales.manage' } }, async (req) => {
    const actor = actorOf(req);
    const reason = str(req.body ?? {}, 'reason', { required: true, max: 1000 })!;
    const sale = await prisma.sale.findUnique({ where: { id: req.params.id }, include: { payments: { where: { voidedAt: null } } } });
    if (!sale) throw notFound('sale_not_found', 'No such sale.');
    if (sale.status !== 'active') throw conflict('sale_closed', 'This sale is already closed.');
    if (sale.payments.length > 0) {
      throw conflict('sale_has_payments', 'Void the payments on this sale first.', { payments: sale.payments.length });
    }
    const today = todayISO(new Date(), env.TZ);
    await prisma.$transaction(async (tx) => {
      await tx.sale.update({ where: { id: sale.id }, data: { status: 'cancelled', updatedAt: new Date() } });
      if (sale.vehicleId) {
        await moveVehicle(tx, {
          vehicleId: sale.vehicleId,
          kind: 'manual',
          toState: 'available',
          occurredOn: today,
          actorId: actor.id,
          reason: `sale ${sale.number} cancelled: ${reason}`,
        });
      }
      await tx.auditLog.create({
        data: { actorId: actor.id, action: 'sale.cancel', entityType: 'sale', entityId: sale.id, note: reason },
      });
    });
    return { ok: true };
  });

  /** Money for a sale. The schedule takes it oldest instalment first. */
  app.post<{ Params: { id: string }; Body: Body }>('/api/sales/:id/payments', { config: { scope: 'cash.record' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const sale = await prisma.sale.findUnique({ where: { id: req.params.id }, select: { id: true, customerId: true, status: true } });
    if (!sale) throw notFound('sale_not_found', 'No such sale.');
    if (sale.status === 'cancelled') throw conflict('sale_closed', 'This sale is cancelled.');
    const channel = oneOf(b, 'channel', ['transfer', 'acquiring', 'cash'] as const, { required: true })!;
    const grossTetri = tetri(b, 'grossTetri', { required: true, min: 1 })!;
    const result = await recordPayment({
      actorId: actor.id,
      occurredOn: date(b, 'occurredOn') ?? todayISO(new Date(), env.TZ),
      channel,
      grossTetri,
      feeTetri: tetri(b, 'feeTetri', { min: 0 }) ?? 0,
      customerId: sale.customerId,
      rentalId: null,
      saleId: sale.id,
      bankText: str(b, 'bankText', { max: 500 }),
      note: str(b, 'note', { max: 1000 }),
      source: 'manual',
    });
    return reply.code(201).send(result);
  });
}
