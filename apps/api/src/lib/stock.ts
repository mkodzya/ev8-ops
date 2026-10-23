// The shelf: what is on it, what it is worth, and the only ways it changes.
//
// Every count on every screen comes through here, and every movement is a
// row somebody can point at — a shipment line, a repair line, or a person's
// signed stock-take with a reason. There is no fourth way.
import { type StockMoveKind, type StockState, shortfall, stockState } from '@ev8/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { conflict } from './errors.js';
import { dateFromISO, isoDate } from './dates.js';
import { prisma } from './db.js';

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

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
  /** A GPS tracker: fitting one asks for its IMEI and SIM (ADR-0036). */
  isTracker: boolean;
  onHand: number;
  valueTetri: number;
  avgCostTetri: number | null;
  shortBy: number;
}

/** Every part with what the ledger makes of it — or only the ones asked for. */
export async function partRows(opts: { includeArchived?: boolean; ids?: string[] } = {}): Promise<PartRow[]> {
  const parts = await prisma.part.findMany({
    where: { ...(opts.includeArchived ? {} : { archived: false }), ...(opts.ids ? { id: { in: opts.ids } } : {}) },
    orderBy: { name: 'asc' },
    include: { moves: { select: { kind: true, qty: true, unitCostTetri: true, occurredOn: true, createdAt: true } } },
  });
  return parts.map((p) => {
    const state = stockState(
      p.moves.map((m) => ({
        kind: m.kind as StockMoveKind,
        qty: m.qty,
        unitCostTetri: m.unitCostTetri,
        occurredOn: isoDate(m.occurredOn)!,
        at: m.createdAt.toISOString(),
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
      isTracker: p.isTracker,
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
  const line = await tx.servicePart.findUnique({ where: { id: input.servicePartId }, select: { id: true, partId: true, qty: true, unitCostTetri: true, kind: true } });
  if (!line?.partId) return 0; // a line typed by hand never touched the shelf
  // A part that only passed through (bought, off a donor) left the shelf as it
  // came; taking the line off leaves the shelf alone. A part taken off a moped
  // onto the shelf, written by mistake, goes off it again at the nought it came
  // in at (ADR-0036).
  if (line.kind === 'bought' || line.kind === 'donor') return 0;
  if (line.kind === 'removed') {
    await tx.stockMove.create({
      data: {
        partId: line.partId,
        kind: 'issue',
        qty: -Math.abs(line.qty),
        unitCostTetri: 0,
        occurredOn: dateFromISO(input.occurredOn)!,
        servicePartId: line.id,
        reason: input.reason,
        createdById: input.actorId,
      },
    });
    return line.qty;
  }
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
  // Only what was taken off the shelf goes back to it. A part bought or off a
  // donor passed through; one taken off the moped is on the shelf already.
  const lines = await tx.servicePart.findMany({ where: { jobId: input.jobId, partId: { not: null }, kind: 'stock' }, select: { id: true, partId: true, qty: true, unitCostTetri: true } });
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
 * A repair called off gives its shelf's parts back, so a tracker it took off
 * the shelf was never fitted (ADR-0036). One it moved off a donor, or took off
 * the moped, stays as it is: those parts did not go back anywhere.
 */
export async function unfitTrackers(tx: Tx, jobId: string): Promise<void> {
  await tx.vehicleTracker.deleteMany({ where: { serviceJobId: jobId, removedOn: null, servicePart: { kind: 'stock' } } });
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

/**
 * What a repair line adds to what the repair cost, as the places that sum a
 * repair read it (`partLineTetri`, ADR-0036): a select to spread into theirs.
 */
export const PART_MONEY = { qty: true, unitPriceTetri: true, kind: true, paidTetri: true, rejectedAt: true } as const;

/**
 * What a line of the mechanic's work adds to what a company repair cost
 * (`repairTotalTetri`, ADR-0037 §6): its norm and rate as written, and the
 * decision on it. The sibling of PART_MONEY.
 */
export const WORK_MONEY = { qty: true, normSec: true, rateTetri: true, approvedAt: true, rejectedAt: true } as const;

/**
 * A part that only passed through the shelf on its way into a moped — bought
 * by the mechanic, or taken off a donor (ADR-0036): in at what it cost and out
 * at the same, written as one. The shelf's count and its average are as they
 * were; the movements are there so the part's history says where it went.
 */
export async function passThrough(
  tx: Tx,
  input: { servicePartId: string; partId: string; qty: number; unitCostTetri: number; occurredOn: string; actorId: string; reason: string },
): Promise<void> {
  const at = new Date();
  const on = dateFromISO(input.occurredOn)!;
  const common = { partId: input.partId, unitCostTetri: input.unitCostTetri, occurredOn: on, servicePartId: input.servicePartId, reason: input.reason, createdById: input.actorId, createdAt: at };
  await tx.stockMove.create({ data: { ...common, kind: 'receipt', qty: Math.abs(input.qty) } });
  await tx.stockMove.create({ data: { ...common, kind: 'issue', qty: -Math.abs(input.qty) } });
}

/**
 * A working part taken off a moped goes onto the shelf at a cost of nought —
 * a figure somebody named, not one nobody knows — and the shelf's average
 * falls with it (Mika, 20.10.2026; ADR-0036).
 */
export async function receiveRemoved(
  tx: Tx,
  input: { servicePartId: string; partId: string; qty: number; occurredOn: string; actorId: string; reason: string },
): Promise<void> {
  await tx.stockMove.create({
    data: {
      partId: input.partId,
      kind: 'receipt',
      qty: Math.abs(input.qty),
      unitCostTetri: 0,
      occurredOn: dateFromISO(input.occurredOn)!,
      servicePartId: input.servicePartId,
      reason: input.reason,
      createdById: input.actorId,
    },
  });
}

/**
 * One part's shelf as its movements say, read through the client given — a
 * transaction's, so a sale counts what is there after its own lock (issue #11).
 */
export async function partOnHandTx(db: Db, partId: string): Promise<StockState> {
  const moves = await db.stockMove.findMany({ where: { partId }, select: { kind: true, qty: true, unitCostTetri: true, occurredOn: true, createdAt: true } });
  return stockState(moves.map((m) => ({ kind: m.kind as StockMoveKind, qty: m.qty, unitCostTetri: m.unitCostTetri, occurredOn: isoDate(m.occurredOn)!, at: m.createdAt.toISOString() })));
}

/**
 * What one of a part costs today: the shelf's average, or else what the last
 * shipment paid for one, or else nobody knows. A repair line and a goods sale
 * take their cost from here, so the two cannot price the same part apart.
 */
export async function shelfCost(db: Db, partId: string): Promise<number | null> {
  const state = await partOnHandTx(db, partId);
  if (state.avgCostTetri != null) return state.avgCostTetri;
  const last = await db.stockMove.findFirst({
    where: { partId, kind: 'receipt', servicePartId: null, unitCostTetri: { gt: 0 } },
    orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
    select: { unitCostTetri: true },
  });
  return last?.unitCostTetri ?? null;
}

/**
 * The day a part was last counted by a person: a stock-take, or the first
 * count of a part that had never moved. A sale dated on or before it asks
 * whether the count already saw the part gone (ADR-0045 §9).
 */
export async function lastCountOn(db: Db, partId: string): Promise<string | null> {
  const last = await db.stockMove.findFirst({
    where: { partId, OR: [{ kind: 'adjust' }, { kind: 'receipt', reason: 'initial' }] },
    orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
    select: { occurredOn: true },
  });
  return last ? isoDate(last.occurredOn) : null;
}

/**
 * A goods sale's line takes parts off the shelf (issue #11). Like a repair's
 * issue it carries no cost of its own: the shelf's average goes with it. One
 * issue a line — the unique index refuses a second.
 */
export async function issueForGoodsLine(
  tx: Tx,
  input: { goodsSaleLineId: string; partId: string; qty: number; occurredOn: string; actorId: string; reason: string },
): Promise<void> {
  await tx.stockMove.create({
    data: {
      partId: input.partId,
      kind: 'issue',
      qty: -Math.abs(input.qty),
      occurredOn: dateFromISO(input.occurredOn)!,
      goodsSaleLineId: input.goodsSaleLineId,
      reason: input.reason,
      createdById: input.actorId,
    },
  });
}

/**
 * A goods sale called off puts its parts back on the shelf, at the cost the
 * line remembered — so the shelf's average is where it was — or, when nobody
 * knew one, at what its shelfmates are worth.
 */
export async function returnGoodsLine(
  tx: Tx,
  input: { goodsSaleLineId: string; partId: string; qty: number; unitCostTetri: number | null; occurredOn: string; actorId: string; reason: string },
): Promise<void> {
  await tx.stockMove.create({
    data: {
      partId: input.partId,
      kind: 'return',
      qty: Math.abs(input.qty),
      unitCostTetri: input.unitCostTetri,
      occurredOn: dateFromISO(input.occurredOn)!,
      goodsSaleLineId: input.goodsSaleLineId,
      reason: input.reason,
      createdById: input.actorId,
    },
  });
}
