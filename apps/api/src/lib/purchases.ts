import { landedCosts, paidSummary, type PaidSummary } from '@ev8/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { prisma } from './db.js';

// What a shipment has cost so far, and writing that onto the mopeds it
// brought (wave 5 §3.5–3.7, Mika's answer to Q23).
//
// A shipment may be received before it is paid for, so a unit cost is a
// figure that moves: it is worked out at the rate of the payments made so
// far and recomputed every time another one goes out or the logistics are
// corrected. Until the invoice is settled the figure is preliminary and
// every screen says so; once it is settled it stops moving for good.

export interface PurchaseMoney extends PaidSummary {
  invoiceMinor: number;
}

type MoneyRow = {
  currency: string;
  paidBeforeTetri: number;
  paidBeforeMinor: bigint | number;
  lines: { qty: number; unitPriceMinor: number; id?: string; modelId?: string | null }[];
  payments: { direction: string; netTetri: number; grossTetri: number; foreignMinor: bigint | number | null; voidedAt?: Date | null }[];
};

/**
 * What has gone out for this order and what it bought. GEL that left the
 * account is the net — the bank's own charge left with it — and the currency
 * side is what each payment said it was buying. Money carried over from
 * before this system existed counts the same way (B3-04).
 */
export function purchaseMoney(p: MoneyRow): PurchaseMoney {
  const out = p.payments.filter((x) => x.direction === 'out' && !x.voidedAt);
  const invoiceMinor = p.lines.reduce((n, l) => n + l.qty * l.unitPriceMinor, 0);
  const payments = [
    ...out.map((x) => ({ paidTetri: x.netTetri, paidMinor: Number(x.foreignMinor ?? 0) })),
    ...(p.paidBeforeTetri > 0 || Number(p.paidBeforeMinor) > 0 ? [{ paidTetri: p.paidBeforeTetri, paidMinor: Number(p.paidBeforeMinor) }] : []),
  ];
  return { ...paidSummary({ payments, invoiceMinor }), invoiceMinor };
}

/**
 * Is what these mopeds cost still a preliminary figure, and at what share of
 * the invoice was it worked out (§7)? A shipment may be received before it
 * is paid for, and every screen that quotes a cost has to say so — the fleet
 * card and "Экономика" said nothing, so a figure that was still moving read
 * as final (QA-W5-11).
 */
export async function preliminaryOf(purchaseIds: readonly string[]): Promise<Map<string, { preliminary: boolean; paidPercent: number }>> {
  const out = new Map<string, { preliminary: boolean; paidPercent: number }>();
  const ids = [...new Set(purchaseIds)];
  if (ids.length === 0) return out;
  const orders = await prisma.purchase.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      currency: true,
      paidBeforeTetri: true,
      paidBeforeMinor: true,
      lines: { select: { qty: true, unitPriceMinor: true } },
      payments: { where: { voidedAt: null }, select: { direction: true, netTetri: true, grossTetri: true, foreignMinor: true } },
    },
  });
  for (const o of orders) {
    const money = purchaseMoney(o);
    out.set(o.id, { preliminary: !money.settled, paidPercent: money.percent });
  }
  return out;
}

/** The cost of every line at today's rate; a moped line carries the freight (Q24). */
export function purchaseCosts(p: Omit<MoneyRow, 'lines'> & { extrasTetri: number; lines: { id: string; qty: number; unitPriceMinor: number; modelId: string | null }[] }) {
  const money = purchaseMoney(p);
  return {
    money,
    costs: landedCosts({
      lines: p.lines.map((l) => ({ id: l.id, qty: l.qty, unitPriceMinor: l.unitPriceMinor, isVehicle: l.modelId != null })),
      basisTetri: money.basisTetri,
      extrasTetri: p.extrasTetri,
    }),
  };
}

/**
 * Write the shipment's cost onto the mopeds it brought (§7). Called after
 * every payment and every correction of the logistics: the mopeds are
 * already in the fleet and being rented out, and their cost has to follow
 * the money rather than wait for it.
 *
 * Each moped gets a line in its own journal, because "why did this moped
 * cost 12 ₾ more this week" is a question asked of the moped, not of the
 * order.
 */
export async function recostPurchase(tx: Prisma.TransactionClient, purchaseId: string, actorId: string | null, reason: string): Promise<number> {
  const p = await tx.purchase.findUnique({
    where: { id: purchaseId },
    select: {
      id: true,
      number: true,
      currency: true,
      status: true,
      extrasTetri: true,
      paidBeforeTetri: true,
      paidBeforeMinor: true,
      lines: { select: { id: true, qty: true, unitPriceMinor: true, modelId: true, partId: true } },
      payments: { where: { voidedAt: null }, select: { direction: true, netTetri: true, grossTetri: true, foreignMinor: true } },
    },
  });
  if (!p || p.status !== 'received') return 0;
  const { money, costs } = purchaseCosts(p);
  const byLine = new Map(costs.map((c) => [c.lineId, c]));
  const vehicles = await tx.vehicle.findMany({ where: { purchaseId: p.id }, select: { id: true, vin: true, modelId: true, costTetri: true } });
  let changed = 0;
  for (const line of p.lines) {
    if (!line.modelId) continue;
    const cost = byLine.get(line.id);
    if (!cost) continue;
    // Nothing has been paid for this shipment and no freight has been put on
    // it, so what a unit cost is not zero — it is not known yet. Writing the
    // zero made a moped look free and wiped the model's known figure with it
    // (QA-W5-29); an empty cost is what "we do not know" looks like here.
    const unitCostTetri = cost.unitCostTetri > 0 ? cost.unitCostTetri : null;
    const mine = vehicles.filter((v) => v.modelId === line.modelId);
    for (const v of mine) {
      if (v.costTetri === unitCostTetri) continue;
      await tx.vehicle.update({ where: { id: v.id }, data: { costTetri: unitCostTetri, updatedAt: new Date() } });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'vehicle.cost',
          entityType: 'vehicle',
          entityId: v.id,
          before: { costTetri: v.costTetri },
          after: { costTetri: unitCostTetri, percent: money.percent, rate: money.rate, order: p.number },
          note: reason,
        },
      });
      changed++;
    }
    // The model keeps the last figure anybody actually knows: an unpaid
    // shipment leaves it alone rather than zeroing it.
    if (mine.length > 0 && unitCostTetri != null) {
      await tx.vehicleModel.update({ where: { id: line.modelId }, data: { costTetri: unitCostTetri, updatedAt: new Date() } });
    }
  }
  // The shelf follows the money too (QA-W5-17). A shipment received before
  // it was paid for landed its parts at nothing and dragged the average
  // down; the receipt movement carries the figure, so the figure is what
  // gets written again — the average is worked out from the movements and
  // needs nothing else.
  let shelf = 0;
  for (const line of p.lines) {
    if (!line.partId) continue;
    const cost = byLine.get(line.id);
    if (!cost) continue;
    const move = await tx.stockMove.findFirst({ where: { purchaseLineId: line.id, kind: 'receipt' }, select: { id: true, unitCostTetri: true } });
    if (!move || move.unitCostTetri === cost.unitCostTetri) continue;
    await tx.stockMove.update({ where: { id: move.id }, data: { unitCostTetri: cost.unitCostTetri } });
    shelf++;
  }
  await tx.purchase.update({ where: { id: p.id }, data: { costedAt: new Date() } });
  if (changed > 0 || shelf > 0) {
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'purchase.recost',
        entityType: 'purchase',
        entityId: p.id,
        after: { vehicles: changed, parts: shelf, percent: money.percent, rate: money.rate },
        note: reason,
      },
    });
  }
  return changed;
}

