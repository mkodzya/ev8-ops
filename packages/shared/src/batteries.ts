// The battery count (wave 4 §3.8, D16, `batteries.md`). Batteries have no
// numbers, so nothing here tracks a battery — it counts them: the owner's
// last stocktake, plus what the acts and the repairs did since.
import type { ISODate } from './types.js';

export interface BatteryInventory {
  countedOn: ISODate;
  showroomQty: number;
  repairQty: number;
  couriersQty: number;
  totalQty: number;
}

export interface BatteryMove {
  kind: 'to_repair' | 'from_repair' | 'lost' | 'found';
  qty: number;
}

export interface BatteryCount {
  /** Every battery the company still has. */
  total: number;
  /** With the couriers: what the live rentals' acts handed over. */
  couriers: number;
  /** Away being fixed, or known broken. */
  repair: number;
  /** What should be on the shelf: everything else. */
  showroom: number;
}

/**
 * `couriersNow` is counted from the acts of the rentals that are still out,
 * so it never drifts from what the hand-overs say; the rest is the stocktake
 * moved on by what happened after it.
 */
export function batteryCount(input: { inventory: BatteryInventory | null; movesSince: BatteryMove[]; couriersNow: number }): BatteryCount {
  const sum = (kind: BatteryMove['kind']) => input.movesSince.filter((m) => m.kind === kind).reduce((n, m) => n + m.qty, 0);
  const lost = sum('lost');
  const found = sum('found');
  const repair = Math.max(0, (input.inventory?.repairQty ?? 0) + sum('to_repair') - sum('from_repair'));
  const total = Math.max(0, (input.inventory?.totalQty ?? 0) - lost + found);
  const couriers = Math.min(input.couriersNow, total);
  return { total, couriers, repair: Math.min(repair, total), showroom: Math.max(0, total - couriers - Math.min(repair, total)) };
}
