// A moped's history on its card (QA walk of 21–22.10.2026).
//
// The card's «История» puts two kinds of line in one list: what happened to
// the moped — its events — and what somebody corrected by hand — the rows of
// its journal (QA-W5-01). They came from two places and were drawn one after
// the other, the journal on top and the events below it oldest first, so the
// list read «21.10, 21.10, 22.09, 20.10, 20.10». One order for both, the
// newest on top, as the card's other lists read and as the redesign drew the
// timeline (blueprint `Timeline`: «новое событие сверху»; prototype 08-vehicle).
import type { MopedAct } from './rental-mopeds.js';
import type { ISODate } from './types.js';

/** A line of the history: the company's day it is about, and the moment it was written. */
export interface HistoryLine {
  day: ISODate | null;
  /** When it was written; none from an API that did not say. */
  at?: Date | string | null;
}

const moment = (at: Date | string | null | undefined): number => {
  if (at == null) return Number.NEGATIVE_INFINITY;
  const n = at instanceof Date ? at.getTime() : Date.parse(at);
  return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
};

/**
 * The newest first: by the day it is about — an event entered late keeps its
 * own day — then, within one day, by when it was written. Lines that tie on
 * both — an event and its journal row are written in one transaction — keep
 * the order they came in. A line with no day goes last.
 */
export function newestFirst<T extends HistoryLine>(lines: readonly T[]): T[] {
  return [...lines].sort((a, b) => {
    if (a.day !== b.day) {
      if (a.day == null) return 1;
      if (b.day == null) return -1;
      return a.day < b.day ? 1 : -1;
    }
    const ma = moment(a.at);
    const mb = moment(b.at);
    return ma === mb ? 0 : mb > ma ? 1 : -1;
  });
}

/**
 * Which half of a swap this hand-over or return of the moped was (ADR-0040),
 * or null for a plain one. A swap writes the moped given back a `return` event
 * and the one handed out a `pickup` event, both in the running rental, so the
 * old moped's history read «Возвращён · Свободен R-…» — as if the rental had
 * ended. The rental's acts tell the two apart: a `swap_out` of this moped on
 * that day, or a `swap_in`.
 */
export function swapSideOf(
  event: { kind: string; occurredOn: ISODate; rentalId: string | null },
  acts: readonly MopedAct[],
  vehicleId: string,
): 'out' | 'in' | null {
  if (event.rentalId == null) return null;
  const half = event.kind === 'return' ? 'swap_out' : event.kind === 'pickup' ? 'swap_in' : null;
  if (!half) return null;
  const found = acts.some((a) => a.kind === half && a.vehicleId === vehicleId && a.occurredOn === event.occurredOn);
  return found ? (half === 'swap_out' ? 'out' : 'in') : null;
}
