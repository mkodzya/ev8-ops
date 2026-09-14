// What one moped earned and cost (DSH-03).
//
// The question the owner asks is "was this VIN worth it", and answering it
// means adding up things that live in four different places: what it cost
// to land, what its rentals brought in, what its repairs took out, and what
// it sold for. None of that is stored as a total anywhere, on purpose —
// totals go stale and the parts do not.
//
// Idle days are worked out from the moped's own events, because that is the
// only honest source: the fleet knows what state a VIN is in now, but only
// the events know how long it has been there.
import type { ISODate, VehicleState } from './types.js';
import { daysBetween, minDate } from './time.js';

export interface StateSpan {
  state: VehicleState;
  from: ISODate;
  /** Exclusive: the day the next state began, or the day the count ends. */
  to: ISODate;
  days: number;
}

/**
 * How long a moped spent in each state, from its first event to `until`.
 *
 * Two events on one day mean the first lasted no time at all, which is the
 * truth: a moped that came back and went out again the same morning was
 * never free for a day.
 */
export function stateSpans(
  events: { occurredOn: ISODate; toState: VehicleState }[],
  until: ISODate,
): StateSpan[] {
  const sorted = [...events].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn));
  const spans: StateSpan[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const from = sorted[i].occurredOn;
    if (from > until) break;
    const next = sorted[i + 1]?.occurredOn;
    const to = next ? minDate(next, until) : until;
    spans.push({ state: sorted[i].toState, from, to, days: Math.max(0, daysBetween(from, to)) });
  }
  return spans;
}

export function daysInStates(
  events: { occurredOn: ISODate; toState: VehicleState }[],
  until: ISODate,
): Record<VehicleState, number> {
  const out = { available: 0, rented: 0, service: 0, out: 0, sold: 0 } as Record<VehicleState, number>;
  for (const s of stateSpans(events, until)) out[s.state] += s.days;
  return out;
}

export interface VehicleEconomics {
  costTetri: number | null;
  rentalRevenueTetri: number;
  saleRevenueTetri: number;
  buyBackTetri: number;
  serviceCompanyTetri: number;
  serviceChargedTetri: number;
  /** Everything in, less everything out, less what it cost to land. */
  marginTetri: number | null;
  days: Record<VehicleState, number>;
  /** Days it could have earned and did not: free or in service. */
  idleDays: number;
}

export function vehicleEconomics(input: {
  costTetri: number | null;
  /** Money allocated to periods of this moped's rentals. */
  rentalRevenueTetri: number;
  /** Money received against sales of this moped. */
  saleRevenueTetri: number;
  /** Money paid out to buy it back. */
  buyBackTetri: number;
  /** Repairs the company paid for. */
  serviceCompanyTetri: number;
  /** Repairs charged to a renter — a cost recovered, not a cost borne. */
  serviceChargedTetri: number;
  events: { occurredOn: ISODate; toState: VehicleState }[];
  until: ISODate;
}): VehicleEconomics {
  const days = daysInStates(input.events, input.until);
  const income = input.rentalRevenueTetri + input.saleRevenueTetri;
  const spent = input.buyBackTetri + input.serviceCompanyTetri;
  return {
    costTetri: input.costTetri,
    rentalRevenueTetri: input.rentalRevenueTetri,
    saleRevenueTetri: input.saleRevenueTetri,
    buyBackTetri: input.buyBackTetri,
    serviceCompanyTetri: input.serviceCompanyTetri,
    serviceChargedTetri: input.serviceChargedTetri,
    // Without a landed cost there is no margin to state, and a guess here
    // would be the kind of number that ends up in a decision.
    marginTetri: input.costTetri == null ? null : income - spent - input.costTetri,
    days,
    idleDays: days.available + days.service,
  };
}
