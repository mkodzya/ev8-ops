// What a return costs (wave 3 §3.4, `rental.md`, contract §6).
//
// The week that began before the return is paid in full — an early return
// does not cut it (Mika, 17.09.2026). A key not brought back is 250 by the
// contract. Days past a planned return are 30 each (20 rent + 10 fine), but
// they and the week they fall in are two prices for the same days: the owner
// takes one of the two, the smaller by default (Q17, Mika 18.09.2026). Without
// a planned date there is no fine, only weeks.
import type { ISODate } from './types.js';
import type { Tetri } from './money.js';

export const KEY_FEE_TETRI: Tetri = 250_00;
export const LATE_FEE_PER_DAY_TETRI: Tetri = 30_00;

export interface SettlementPeriod {
  id: string;
  seq: number;
  startsOn: ISODate;
  endsOn: ISODate;
  amountTetri: Tetri;
  paidTetri: Tetri;
}

export interface SettlementInput {
  returnedOn: ISODate;
  expectedReturnOn: ISODate | null;
  /** Every period there is by the return day. */
  periods: SettlementPeriod[];
  keyMissing: boolean;
  /** Left out: the smaller of the two. */
  lateChoice?: 'week' | 'late' | null;
}

export interface Settlement {
  /** Weeks begun by the return day and not fully paid, as they will be charged. */
  weeks: { id: string; seq: number; startsOn: ISODate; endsOn: ISODate; owesTetri: Tetri }[];
  /** Weeks the delay replaces when it is chosen. */
  replacedWeeks: { id: string; seq: number; owesTetri: Tetri }[];
  late: null | { days: number; perDayTetri: Tetri; amountTetri: Tetri; weekTetri: Tetri };
  choice: 'week' | 'late' | null;
  keyTetri: Tetri;
  /** Everything owed at the return: the weeks (or the delay) and the key. */
  claimsTetri: Tetri;
}

const daysBetween = (a: ISODate, b: ISODate) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export function returnSettlement(input: SettlementInput): Settlement {
  const begun = input.periods
    .filter((p) => p.startsOn <= input.returnedOn && p.paidTetri < p.amountTetri)
    .sort((a, b) => a.seq - b.seq)
    .map((p) => ({ id: p.id, seq: p.seq, startsOn: p.startsOn, endsOn: p.endsOn, owesTetri: p.amountTetri - p.paidTetri }));

  let late: Settlement['late'] = null;
  let replaced: Settlement['replacedWeeks'] = [];
  if (input.expectedReturnOn && input.returnedOn > input.expectedReturnOn) {
    // The weeks that began after the planned day are the days of delay.
    replaced = begun.filter((w) => w.startsOn > input.expectedReturnOn!).map((w) => ({ id: w.id, seq: w.seq, owesTetri: w.owesTetri }));
    if (replaced.length > 0) {
      const days = daysBetween(input.expectedReturnOn, input.returnedOn);
      late = {
        days,
        perDayTetri: LATE_FEE_PER_DAY_TETRI,
        amountTetri: days * LATE_FEE_PER_DAY_TETRI,
        weekTetri: replaced.reduce((n, w) => n + w.owesTetri, 0),
      };
    }
  }
  const choice: Settlement['choice'] = late ? input.lateChoice ?? (late.amountTetri < late.weekTetri ? 'late' : 'week') : null;
  const kept = choice === 'late' ? begun.filter((w) => !replaced.some((r) => r.id === w.id)) : begun;
  const keyTetri = input.keyMissing ? KEY_FEE_TETRI : 0;
  const claims = kept.reduce((n, w) => n + w.owesTetri, 0) + (choice === 'late' ? late!.amountTetri : 0) + keyTetri;
  return { weeks: kept, replacedWeeks: choice === 'late' ? replaced : [], late, choice, keyTetri, claimsTetri: claims };
}
