import type { ISODate } from './types.js';

/**
 * «Изменить данные» on a moped's card (issue #19 of the director, item 2): its
 * colour, its year and the day it came, put right by an owner after the moped
 * was added — on 27.10.2026 a moped's colour was wrong and nothing could
 * correct it. The rules the sheet shows before anything is sent and the server
 * refuses by, so the two never disagree.
 */

/** The earliest year a moped may be of — what adding one by hand has refused below since wave 1. */
export const VEHICLE_YEAR_MIN = 2000;

/**
 * The years a moped's year may be: from 2000 to next year. A model year runs
 * ahead of the calendar by one, never by more; the company's year, not the
 * device's (Asia/Tbilisi).
 */
export function vehicleYearRange(today: ISODate): { min: number; max: number } {
  return { min: VEHICLE_YEAR_MIN, max: Number(today.slice(0, 4)) + 1 };
}

/** Why a year cannot be the moped's; null when it will do. */
export type VehicleYearFault = 'too_early' | 'too_late';

export function vehicleYearFault(year: number, today: ISODate): VehicleYearFault | null {
  const { min, max } = vehicleYearRange(today);
  if (!Number.isInteger(year) || year < min) return 'too_early';
  if (year > max) return 'too_late';
  return null;
}

/** Why a day cannot be the day the moped came. */
export type ArrivalFault = 'future' | 'after_history';

/**
 * The latest day a moped may have come, and what sets it: today, or the first
 * day its history holds besides the arrival itself — a hand-over, a move by
 * hand, an assignment, a repair opened, a tracker on it. A moped is not handed
 * out, repaired or assigned before it is here. `historyOn` leaves the arrival
 * out: that is the day being moved. The same day as the first thing in the
 * history will do.
 */
export function arrivalLatestDay(input: { today: ISODate; historyOn: readonly (ISODate | null | undefined)[] }): { on: ISODate; by: 'today' | 'history' } {
  let first: ISODate | null = null;
  for (const day of input.historyOn) if (day && (first == null || day < first)) first = day;
  return first != null && first < input.today ? { on: first, by: 'history' } : { on: input.today, by: 'today' };
}

/** Null when `on` may be the day the moped came: not after today, not after the first thing in its history. */
export function arrivalFault(input: { on: ISODate; today: ISODate; historyOn: readonly (ISODate | null | undefined)[] }): ArrivalFault | null {
  if (input.on > input.today) return 'future';
  return input.on > arrivalLatestDay(input).on ? 'after_history' : null;
}
