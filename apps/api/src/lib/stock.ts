// The shelf: what is on it, what it is worth, and the only ways it changes.
//
// Every count on every screen comes through here, and every movement is a
// row somebody can point at — a shipment line, a repair line, or a person's
// signed stock-take with a reason. There is no fourth way.
import { type StockMoveKind, shortfall, stockState } from '@ev8/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { conflict } from './errors.js';
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

/** A repair line removed while the job is open puts its parts back. */
/**
 * One line taken off a repair gives its parts back (QA-W5-18, wave 5 §3.7).
 *
 * It used to delete the movement that issued them, and that was wrong for
 * the same reason a cancelled repair writes a return instead of an erasure:
 * the parts did leave the shelf, somebody carried them to the workshop, and
 * a ledger that rubs that out cannot say where they were on Tuesday. The
 * tester and the designer both said so; I argued it was a correction of an
 * entry rather than a movement, and I was wrong.
 */
export async function returnServicePart(tx: Tx, input: { servicePartId: string; occurredOn: string; actorId: string; reason: string }): Promise<number> {
  const line = await tx.servicePart.findUnique({ where: { id: input.servicePartId }, select: { id: true, partId: true, qty: true, unitCostTetri: true } });
  if (!line?.partId) return 0; // a line typed by hand never touched the shelf
  await tx.stockMove.create({
    data: {
      partId: line.partId,
      kind: 'return',
      qty: Math.abs(line.qty),
      // Back at what it left at, so the shelf's average is where it was.
      unitCostTetri: line.unitCostTetri,
      occurredOn: dateFromISO(input.occurredOn)!,
      // The issuing movement keeps this line's id; the return cannot, because
      // the line is about to go. It names the repair in words instead.
      reason: input.reason,
      createdById: input.actorId,
    },
  });
  return line.qty;
}

/**
 * A repair cancelled gives its parts back (B8-04, wave 5 §3.7).
 *
 * This is a movement of its own rather than the removal of the old one: the
 * parts did leave the shelf, somebody carried them to the workshop, and a
 * ledger that rubs that out cannot explain where they were on Tuesday.
 */
export async function returnServiceParts(
  tx: Tx,
  input: { jobId: string; occurredOn: string; actorId: string; reason: string },
): Promise<number> {
  const lines = await tx.servicePart.findMany({ where: { jobId: input.jobId, partId: { not: null } }, select: { id: true, partId: true, qty: true, unitCostTetri: true } });
  let back = 0;
  for (const l of lines) {
    await tx.stockMove.create({
      data: {
        partId: l.partId!,
        kind: 'return',
        qty: Math.abs(l.qty),
        // Back at what it left at, so the shelf's average is where it was.
        unitCostTetri: l.unitCostTetri,
        occurredOn: dateFromISO(input.occurredOn)!,
        servicePartId: l.id,
        reason: input.reason,
        createdById: input.actorId,
      },
    });
    back += l.qty;
  }
  return back;
}

/**
 * The first count of a part that has never moved (B3-05): how many are on the
 * shelf and what one cost. It may happen once — after that the shelf has a
 * history and is corrected by a receipt or a stocktake, not by a new start.
 */
export async function initialStock(
  tx: Tx,
  input: { partId: string; qty: number; unitCostTetri: number; occurredOn: string; actorId: string },
): Promise<void> {
  const already = await tx.stockMove.findFirst({ where: { partId: input.partId }, select: { id: true } });
  if (already) throw conflict('stock_started', 'This part has movements already; its opening balance is history.', { field: 'qty' });
  await tx.stockMove.create({
    data: {
      partId: input.partId,
      kind: 'receipt',
      qty: input.qty,
      unitCostTetri: input.unitCostTetri,
      occurredOn: dateFromISO(input.occurredOn)!,
      reason: 'initial',
      createdById: input.actorId,
    },
  });
}
