// The shelf: what is on it, what it is worth, and the only ways it changes.
//
// Every count on every screen comes through here, and every movement is a
// row somebody can point at — a shipment line, a repair line, or a person's
// signed stock-take with a reason. There is no fourth way.
import { type StockMoveKind, shortfall, stockState } from '@ev8/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { dateFromISO, isoDate } from './dates.js';
import { prisma } from './db.js';

type Tx = Prisma.TransactionClient;

export interface PartRow {
  id: string;
  sku: string | null;
  name: string;
  nameKa: string | null;
  unit: string;
  minQty: number;
  salePriceTetri: number | null;
  notes: string | null;
  archived: boolean;
  onHand: number;
  valueTetri: number;
  avgCostTetri: number | null;
  shortBy: number;
}

/** Every part with what the ledger makes of it. */
export async function partRows(opts: { includeArchived?: boolean } = {}): Promise<PartRow[]> {
  const parts = await prisma.part.findMany({
    where: opts.includeArchived ? {} : { archived: false },
    orderBy: { name: 'asc' },
    include: { moves: { select: { kind: true, qty: true, unitCostTetri: true, occurredOn: true } } },
  });
  return parts.map((p) => {
    const state = stockState(
      p.moves.map((m) => ({
        kind: m.kind as StockMoveKind,
        qty: m.qty,
        unitCostTetri: m.unitCostTetri,
        occurredOn: isoDate(m.occurredOn)!,
      })),
    );
    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      nameKa: p.nameKa,
      unit: p.unit,
      minQty: p.minQty,
      salePriceTetri: p.salePriceTetri,
      notes: p.notes,
      archived: p.archived,
      ...state,
      shortBy: shortfall(state.onHand, p.minQty),
    };
  });
}

/**
 * A shipment line lands on the shelf. The unique index makes this safe to
 * call again: an order received twice does not stock the part twice.
 */
export async function receivePartLine(
  tx: Tx,
  input: { purchaseLineId: string; partId: string; qty: number; unitCostTetri: number; occurredOn: string; actorId: string; reason?: string },
): Promise<void> {
  const already = await tx.stockMove.findFirst({ where: { purchaseLineId: input.purchaseLineId }, select: { id: true } });
  if (already) return;
  await tx.stockMove.create({
    data: {
      partId: input.partId,
      kind: 'receipt',
      qty: input.qty,
      unitCostTetri: input.unitCostTetri,
      occurredOn: dateFromISO(input.occurredOn)!,
      purchaseLineId: input.purchaseLineId,
      reason: input.reason ?? null,
      createdById: input.actorId,
    },
  });
}

/**
 * A repair takes parts off the shelf.
 *
 * It is not refused when the shelf is short. A repair that happened is the
 * fact; the shelf is the record of it, and a record that blocks the fact
 * teaches people to stop recording. A count below zero is loud on the
 * screen and is what a stock-take is for.
 */
export async function issueForServicePart(
  tx: Tx,
  input: { servicePartId: string; partId: string; qty: number; occurredOn: string; actorId: string; reason?: string },
): Promise<void> {
  await tx.stockMove.create({
    data: {
      partId: input.partId,
      kind: 'issue',
      qty: -Math.abs(input.qty),
      occurredOn: dateFromISO(input.occurredOn)!,
      servicePartId: input.servicePartId,
      reason: input.reason ?? null,
      createdById: input.actorId,
    },
  });
}

/** A repair line removed puts its parts back. */
export async function unissueForServicePart(tx: Tx, servicePartId: string): Promise<void> {
  await tx.stockMove.deleteMany({ where: { servicePartId } });
}
