import { applyPaidBefore, instalmentSchedule, saleState, todayISO, warrantyUntil as warrantyFrom } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { audit } from '../lib/audit.js';
import { dateFromISO, dayOf, isoDate } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { env } from '../lib/env.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { hasPerm } from '../lib/auth.js';
import { actorOf } from '../lib/guard.js';
import { recordMoney } from '../lib/money.js';
import { recomputeSale } from '../lib/payments.js';
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
  customer: { select: { id: true, name: true, nameKa: true, nameLat: true, phone: true } },
  vehicle: { select: { id: true, vin: true, model: { select: { brand: true, name: true } } } },
  instalments: { orderBy: { seq: 'asc' } },
} as const;

type SaleRow = {
  id: string;
  number: string;
  soldOn: Date;
  priceTetri: number;
  paidBeforeTetri?: number;
  transferred?: boolean;
  extras: string | null;
  warrantyUntil: Date | null;
  status: string;
  boughtBackOn: Date | null;
  vinNote: string | null;
  notes: string | null;
  kommoRef?: string | null;
  customer: { id: string; name: string; phone?: string | null };
  vehicle: { id: string; vin: string; model: { brand: string; name: string } } | null;
  instalments: { id: string; seq: number; dueOn: Date; amountTetri: number; paidTetri: number; payStatus: string }[];
};

function serialize(s: SaleRow, today: string) {
  // Where the schedule stands is one rule, in shared, so the sale, the
  // customer's debt and "Today" cannot disagree about it (wave 5 §3.2).
  const state = saleState({
    today,
    status: s.status as 'active' | 'cancelled' | 'bought_back',
    instalments: s.instalments.map((i) => ({ seq: i.seq, dueOn: isoDate(i.dueOn)!, amountTetri: i.amountTetri, paidTetri: i.paidTetri })),
  });
  const byId = new Map(s.instalments.map((i) => [i.seq, i]));
  return {
    id: s.id,
    number: s.number,
    soldOn: isoDate(s.soldOn),
    priceTetri: s.priceTetri,
    paidTetri: state.paidTetri,
    // A sale bought back or cancelled owes nothing (M8).
    outstandingTetri: s.status === 'active' ? Math.max(0, s.priceTetri - state.paidTetri) : 0,
    /** Instalments due and unpaid — the debt (Q21). */
    overdueTetri: state.owesTetri,
    /** Instalments not due yet, shown beside the debt and never inside it. */
    aheadTetri: state.aheadTetri,
    /** How long the oldest unpaid instalment has been waiting, for the pill. */
    lateDays: state.worstDays,
    // Due by today, the part of the customer's one debt figure this sale makes (B7-02).
    owesTetri: state.owesTetri,
    paidBeforeTetri: s.paidBeforeTetri ?? 0,
    transferred: s.transferred ?? false,
    extras: s.extras,
    warrantyUntil: isoDate(s.warrantyUntil),
    status: s.status,
    boughtBackOn: isoDate(s.boughtBackOn),
    notes: s.notes,
    kommoRef: s.kommoRef ?? null,
    customer: s.customer,
    vehicle: s.vehicle ? { id: s.vehicle.id, vin: s.vehicle.vin, model: `${s.vehicle.model.brand} ${s.vehicle.model.name}` } : null,
    vinNote: s.vinNote,
    instalments: state.rows.map((r) => ({
      id: byId.get(r.seq)!.id,
      seq: r.seq,
      dueOn: r.dueOn,
      amountTetri: r.amountTetri,
      paidTetri: r.paidTetri,
      payStatus: byId.get(r.seq)!.payStatus,
      state: r.state,
      days: r.days,
      overdue: r.state === 'overdue',
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
    // One timeline for the sale, as the rental and the customer have (ux №7).
    const log = await prisma.auditLog.findMany({
      where: { entityType: 'sale', entityId: sale.id },
      orderBy: { createdAt: 'asc' },
      include: { actor: { select: { name: true } } },
    });
    const documents = await prisma.storedFile.findMany({
      where: { saleId: sale.id, kind: 'pdf', archived: false },
      select: { id: true, docKind: true, signedAt: true, signedBy: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    const feed = [
      ...payments.map((p) => ({ at: isoDate(p.occurredOn)!, kind: 'payment' as const, by: null as string | null, text: p.direction === 'out' ? 'buyback' : p.channel, amountTetri: p.grossTetri, note: null as string | null })),
      ...documents.filter((d) => d.signedAt).map((d) => ({ at: dayOf(d.signedAt)!, kind: 'document' as const, by: d.signedBy, text: d.docKind ?? '', amountTetri: null, note: null })),
      ...log.map((l) => ({ at: dayOf(l.createdAt)!, kind: 'log' as const, by: l.actor?.name ?? null, text: l.action, amountTetri: null, note: l.note })),
    ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return {
      sale: serialize(sale, todayISO(new Date(), env.TZ)),
      documents: documents.map((d) => ({ id: d.id, docKind: d.docKind, signedAt: d.signedAt?.toISOString() ?? null, signedBy: d.signedBy })),
      feed,
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
    // The price is the model's, edited as often as not, plus whatever was put
    // on the moped with it: a second battery, a top box (SAL-01, §3.1).
    const extraLines = Array.isArray(b.extraLines) ? (b.extraLines as Record<string, unknown>[]) : [];
    const extrasTetri = extraLines.reduce((n, l) => n + (tetri(l, 'amountTetri', { min: 0 }) ?? 0), 0);
    const priceTetri = (tetri(b, 'priceTetri', { required: true, min: 1 })! ?? 0) + extrasTetri;
    const downPaymentTetri = tetri(b, 'downPaymentTetri', { min: 0 }) ?? 0;
    const months = int(b, 'months', { min: 0 }) ?? 0;
    if (downPaymentTetri > priceTetri) throw conflict('down_payment_too_big', 'The down payment is more than the price.', { field: 'downPaymentTetri' });
    // A sale carried over from the paper contract (B3-03): its schedule comes
    // from the contract line by line, and one figure says what had been paid.
    const transferred = Boolean(b.transferred);
    const paidBeforeTetri = transferred ? (tetri(b, 'paidBeforeTetri', { min: 0 }) ?? 0) : 0;
    if (transferred && !hasPerm(actor, 'deposit.decide')) throw forbidden('owner_only', 'Only an owner carries a sale over.');
    if (paidBeforeTetri > priceTetri) throw conflict('paid_before_too_big', 'More was paid before the move than the sale is worth.', { field: 'paidBeforeTetri' });
    // A schedule the wizard edited line by line comes back as it is; an
    // untouched one is built from the down payment and the months (SAL-02).
    const edited = Array.isArray(b.schedule) ? (b.schedule as Record<string, unknown>[]) : null;
    const schedule = edited && edited.length > 0
      ? edited.map((r, i) => ({ seq: i + 1, dueOn: date(r, 'dueOn', { required: true })!, amountTetri: tetri(r, 'amountTetri', { required: true, min: 0 })! }))
      : instalmentSchedule({ soldOn, priceTetri, downPaymentTetri, months });

    const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!customer) throw notFound('customer_not_found', 'No such customer.');
    let poolMove = false;
    if (vehicleId) {
      const v = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { state: true, archived: true, pool: true } });
      if (!v || v.archived) throw notFound('vehicle_not_found', 'No such moped.');
      // Words about selling, not about handing over: a moped at a customer
      // cannot be sold until they bring it back (QA-1-07, crit. 2).
      // Its own code: one `vehicle_rented` served three unrelated refusals,
      // and the words the screen showed were another one's (QA-W5-04).
      if (v.state === 'rented') throw conflict('vehicle_rented_sale', 'This moped is out on rent; it cannot be sold until it comes back.', { state: v.state });
      if (v.state === 'sold') throw conflict('vehicle_sold', 'This moped has already been sold.', { state: v.state });
      if (v.state !== 'available') throw conflict('vehicle_not_available', 'Only a moped standing free is sold.', { state: v.state });
      // A moped kept for renting can be sold, but somebody has to say so:
      // the wizard asks, and the park moves with the sale (§3.1).
      if (v.pool === 'rent') {
        if (!b.movePool) throw conflict('vehicle_in_rent_pool', 'This moped is kept for renting; selling it moves it to the sale park.', { field: 'movePool' });
        poolMove = true;
      }
    }

    // Twelve months from the day, unless somebody says otherwise (`sales.md`).
    const warranty = date(b, 'warrantyUntil') ?? warrantyFrom(soldOn);

    const sale = await prisma.$transaction(async (tx) => {
      const created = await tx.sale.create({
        data: {
          customerId,
          vehicleId: vehicleId ?? null,
          vinNote,
          soldOn: dateFromISO(soldOn)!,
          priceTetri,
          paidBeforeTetri,
          transferred,
          extras: extraLines.length > 0 ? extraLines.map((l) => `${str(l, 'name', { max: 200 }) ?? ''} · ${(tetri(l, 'amountTetri', { min: 0 }) ?? 0) / 100}`).join('; ') : str(b, 'extras', { max: 1000 }),
          warrantyUntil: dateFromISO(warranty),
          notes: str(b, 'notes', { max: 4000 }),
          createdById: actor.id,
        },
        select: { id: true, number: true },
      });
      const carried = new Map(applyPaidBefore(schedule, paidBeforeTetri).map((r) => [r.seq, r.paidTetri]));
      for (const line of schedule) {
        const paid = carried.get(line.seq) ?? 0;
        await tx.saleInstalment.create({
          data: {
            saleId: created.id,
            seq: line.seq,
            dueOn: dateFromISO(line.dueOn)!,
            amountTetri: line.amountTetri,
            paidTetri: paid,
            payStatus: paid <= 0 ? 'unpaid' : paid >= line.amountTetri ? 'paid' : 'partial',
          },
        });
      }
      if (vehicleId) {
        if (poolMove) await tx.vehicle.update({ where: { id: vehicleId }, data: { pool: 'sale', updatedAt: new Date() } });
        await moveVehicle(tx, { vehicleId, kind: 'sold', occurredOn: soldOn, actorId: actor.id });
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'sale.create',
          entityType: 'sale',
          entityId: created.id,
          after: { number: created.number, customerId, vehicleId, soldOn, priceTetri, downPaymentTetri, months, transferred, paidBeforeTetri },
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
    // The front office's deal, one way only until the webhook tariff
    // (B10-03, register #5): a link or an id, kept as typed.
    if ('kommoRef' in b) data.kommoRef = str(b, 'kommoRef', { max: 300 });
    await prisma.sale.update({ where: { id: sale.id }, data: { ...data, updatedAt: new Date() } });
    await audit({ actorId: actor.id, action: 'sale.update', entityType: 'sale', entityId: sale.id, after: data as object });
    return { ok: true };
  });

  /**
   * The company buys the moped back (SAL-03): money goes out, the VIN comes
   * back into the fleet, and both events stay on the VIN's own history.
   */
  app.post<{ Params: { id: string }; Body: Body }>('/api/sales/:id/buy-back', { config: { scope: 'sales.manage' } }, async (req, reply) => {
    const b = req.body ?? {};
    const { id } = await recordMoney(actorOf(req), {
      kind: 'buyback',
      saleId: req.params.id,
      amountTetri: tetri(b, 'amountTetri', { required: true, min: 1 })!,
      channel: oneOf(b, 'channel', ['transfer', 'acquiring', 'cash'] as const) ?? 'cash',
      occurredOn: date(b, 'occurredOn'),
      backdateReason: str(b, 'backdateReason', { max: 500 }) ?? (date(b, 'occurredOn') ? 'dated on entry' : null),
      note: str(b, 'note', { max: 1000 }),
      toState: oneOf(b, 'toState', ['available', 'service'] as const) ?? 'available',
    });
    return reply.code(200).send({ ok: true, id });
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
  /**
   * An instalment paid (M12). It goes through the one money rule of wave 2,
   * so a card payment carries its 1.5 % the way every other one does and the
   * instalments it closes are the instalments it says it closes (crit. 8).
   */
  app.post<{ Params: { id: string }; Body: Body }>('/api/sales/:id/payments', { config: { scope: 'cash.record' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const sale = await prisma.sale.findUnique({ where: { id: req.params.id }, select: { id: true, status: true } });
    if (!sale) throw notFound('sale_not_found', 'No such sale.');
    if (sale.status === 'cancelled') throw conflict('sale_closed', 'This sale is cancelled.');
    const { id, plan } = await recordMoney(actor, {
      kind: 'sale',
      saleId: sale.id,
      amountTetri: tetri(b, 'grossTetri', { required: true, min: 1 })!,
      channel: oneOf(b, 'channel', ['transfer', 'acquiring', 'cash'] as const, { required: true })!,
      occurredOn: date(b, 'occurredOn'),
      backdateReason: str(b, 'backdateReason', { max: 500 }) ?? (date(b, 'occurredOn') ? 'dated on entry' : null),
      note: str(b, 'note', { max: 1000 }),
    });
    return reply.code(201).send({ id, feeTetri: plan.feeTetri, closes: plan.closes });
  });

  /**
   * The schedule moved (§3.2): an owner re-dates or re-sizes what is left,
   * always with a reason, and the journal keeps what it was. Instalments
   * already paid are not touched — the money went where it went.
   */
  app.post<{ Params: { id: string }; Body: Body }>('/api/sales/:id/schedule', { config: { scope: 'sales.manage' } }, async (req) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    if (!hasPerm(actor, 'deposit.decide')) throw forbidden('owner_only', 'Only an owner changes a schedule.');
    const reason = str(b, 'reason', { required: true, max: 1000 })!;
    const sale = await prisma.sale.findUnique({ where: { id: req.params.id }, include: { instalments: { orderBy: { seq: 'asc' } } } });
    if (!sale) throw notFound('sale_not_found', 'No such sale.');
    if (sale.status !== 'active') throw conflict('sale_closed', 'This sale is closed.');
    const rows = Array.isArray(b.schedule) ? (b.schedule as Record<string, unknown>[]) : [];
    if (rows.length === 0) throw conflict('empty_schedule', 'A sale keeps a schedule, even of one line.', { field: 'schedule' });
    const before = sale.instalments.map((i) => ({ seq: i.seq, dueOn: isoDate(i.dueOn), amountTetri: i.amountTetri }));
    await prisma.$transaction(async (tx) => {
      for (const [i, raw] of rows.entries()) {
        const seq = i + 1;
        const dueOn = date(raw, 'dueOn', { required: true })!;
        const amountTetri = tetri(raw, 'amountTetri', { required: true, min: 0 })!;
        const existing = sale.instalments.find((x) => x.seq === seq);
        if (existing) {
          if (existing.paidTetri > amountTetri) {
            throw conflict('instalment_paid', 'An instalment cannot be made smaller than what has been paid against it.', { seq, paidTetri: existing.paidTetri });
          }
          await tx.saleInstalment.update({ where: { id: existing.id }, data: { dueOn: dateFromISO(dueOn)!, amountTetri, updatedAt: new Date() } });
        } else {
          await tx.saleInstalment.create({ data: { saleId: sale.id, seq, dueOn: dateFromISO(dueOn)!, amountTetri } });
        }
      }
      for (const extra of sale.instalments.filter((x) => x.seq > rows.length)) {
        if (extra.paidTetri > 0) throw conflict('instalment_paid', 'A paid instalment is not removed from a schedule.', { seq: extra.seq });
        await tx.saleInstalment.delete({ where: { id: extra.id } });
      }
      await recomputeSale(tx, sale.id);
      await tx.auditLog.create({
        data: { actorId: actor.id, action: 'sale.schedule', entityType: 'sale', entityId: sale.id, before: { schedule: before } as object, after: { schedule: rows } as object, note: reason },
      });
    });
    return { ok: true };
  });
}
