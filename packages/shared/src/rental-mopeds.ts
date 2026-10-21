// Which moped a rental had, and when (ADR-0040).
//
// A running rental can change its moped: the customer gives one back and
// takes another, and the rental — its number, weeks, deposit, debt and pay
// day — goes on. Nothing stores "the rental's mopeds" as a list. They are read
// from the rental's acts, the way a moped's state is read from its events:
// a hand-over (`pickup`) or the second half of a swap (`swap_in`) begins a
// stretch with a moped; the first half of a swap (`swap_out`) or a return
// ends it. A return taken back (B5-08) ends nothing — the rental ran on.
//
// One set of functions for every place that used to assume "one rental, one
// moped": the mileage at hand-over a return is checked against, the contract
// and the return act, the moped's card and its earnings.
import type { ISODate } from './types.js';

/** An act as these functions read it: its kind, the moped it names, its day. */
export interface MopedAct {
  kind: string;
  /** The moped the act is about; none on an act written before migration 0063 could say. */
  vehicleId: string | null;
  occurredOn: ISODate;
  /** When it was written: two acts of one day keep the order they were made in. */
  createdAt?: Date | string | number | null;
  /** A return taken back (B5-08): it ends nothing. */
  undone?: boolean;
}

/** A stretch of a rental with one moped. */
export interface MopedLeg {
  vehicleId: string;
  /** The day it was handed out: the hand-over, or the day of the swap. */
  from: ISODate;
  /** The day it was given back; null while the customer has it. */
  to: ISODate | null;
  began: 'pickup' | 'swap_in';
  /** How it ended; null while it runs, or when a hand-over of another moped closed it without an act. */
  ended: 'return' | 'swap_out' | null;
}

const HANDS_OUT = new Set(['pickup', 'swap_in']);
const TAKES_BACK = new Set(['return', 'swap_out']);
/**
 * Within one moment — a swap writes both its acts in one transaction — the
 * moped given back comes before the one handed out, and a hand-over before
 * anything that ends it.
 */
const RANK: Record<string, number> = { pickup: 0, swap_out: 1, swap_in: 2, return: 3 };

const ms = (at: Date | string | number | null | undefined): number => (at == null ? 0 : at instanceof Date ? at.getTime() : typeof at === 'number' ? at : Date.parse(at));

/** The acts in the order they happened: by day, then as they were written, then by kind. */
export function actsInOrder<T extends MopedAct>(acts: readonly T[]): T[] {
  return [...acts].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || ms(a.createdAt) - ms(b.createdAt) || (RANK[a.kind] ?? 9) - (RANK[b.kind] ?? 9));
}

/**
 * The rental's stretches, one per moped it had, in order. `rentalVehicleId`
 * stands for the moped of an act that names none — one written before the
 * acts said, when an act could only be about its rental's moped.
 */
export function mopedLegs(acts: readonly MopedAct[], rentalVehicleId: string | null = null): MopedLeg[] {
  const legs: MopedLeg[] = [];
  let open: MopedLeg | null = null;
  for (const a of actsInOrder(acts)) {
    const vehicleId = a.vehicleId ?? rentalVehicleId;
    if (HANDS_OUT.has(a.kind)) {
      if (!vehicleId) continue;
      if (open) {
        // The same moped handed over again is the same stretch.
        if (open.vehicleId === vehicleId) continue;
        open.to = a.occurredOn;
        legs.push(open);
      }
      open = { vehicleId, from: a.occurredOn, to: null, began: a.kind as MopedLeg['began'], ended: null };
    } else if (TAKES_BACK.has(a.kind)) {
      if (!open || a.undone) continue;
      // An act about another moped does not end this one's stretch.
      if (vehicleId && vehicleId !== open.vehicleId) continue;
      open.to = a.occurredOn;
      open.ended = a.kind as MopedLeg['ended'];
      legs.push(open);
      open = null;
    }
  }
  if (open) legs.push(open);
  return legs;
}

/**
 * The moped the rental had on a day: the latest stretch begun by then. On the
 * day of a swap that is the new one. Before the first stretch — the first.
 */
export function mopedOnDay(legs: readonly MopedLeg[], day: ISODate): string | null {
  let found: string | null = null;
  for (const l of legs) if (l.from <= day) found = l.vehicleId;
  return found ?? legs[0]?.vehicleId ?? null;
}

/**
 * The act that handed this moped out in this rental — the hand-over, or the
 * swap that brought it — the latest if there were two. Its mileage is the one
 * a return of this moped is checked against, its day and photos are the
 * contract's. An act that names no moped is the rental's own, from before the
 * acts said: it answers when no act names this one.
 */
export function handOverActOf<T extends MopedAct>(acts: readonly T[], vehicleId: string | null): T | null {
  const out = actsInOrder(acts).filter((a) => HANDS_OUT.has(a.kind));
  const own = out.filter((a) => (a.vehicleId ?? null) === (vehicleId ?? null));
  if (own.length > 0) return own[own.length - 1];
  const unnamed = out.filter((a) => a.vehicleId == null);
  return unnamed[unnamed.length - 1] ?? null;
}

/**
 * One moped's part in a rental, for its card: from when to when it was with
 * the customer, and whether a swap brought it or took it away. None — the
 * rental never had it.
 */
export function mopedSpan(legs: readonly MopedLeg[], vehicleId: string): { from: ISODate; to: ISODate | null; swappedIn: boolean; swappedOut: boolean } | null {
  const own = legs.filter((l) => l.vehicleId === vehicleId);
  if (own.length === 0) return null;
  const first = own[0];
  const last = own[own.length - 1];
  return { from: first.from, to: last.to, swappedIn: first.began === 'swap_in', swappedOut: last.ended === 'swap_out' };
}
