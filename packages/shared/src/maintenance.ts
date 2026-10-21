// The planned maintenance of a moped (stage 6 of docs/spec/mechanic-in-erp-plan.md;
// ADR-0038 §1–3). Nothing here is stored: the next one is worked out at
// every read from the mileage EV8 Ops recorded and the planned repairs that
// closed — a figure kept beside them would one day disagree with them.

/** Every 5 000 km by the spec; the owner changes it in the repair settings. */
export const MAINTENANCE_INTERVAL_KM = 5000;
/** «Пора на ТО» when fewer than 300 km are left, by the spec. */
export const MAINTENANCE_WARN_KM = 300;
/** What the settings accept for the interval; the warning stays below it. */
export const MAINTENANCE_INTERVAL_MIN_KM = 500;
export const MAINTENANCE_INTERVAL_MAX_KM = 100_000;

/**
 * Where a moped stands: no mileage recorded — nothing to say (ADR-0038 §1);
 * more than the warning left; less than that; past the mark.
 */
export type MaintenanceState = 'unknown' | 'ok' | 'soon' | 'overdue';

/** One reading of the odometer that EV8 Ops recorded, and when. */
export interface MileageReading {
  km: number;
  at: Date | string;
}

export interface NextMaintenance {
  state: MaintenanceState;
  /** The latest reading, and when it was taken. */
  currentKm: number | null;
  currentAt: string | null;
  /** The earliest reading: where the first mark is counted from. */
  firstKm: number | null;
  /** The mileage the next maintenance is due at. */
  dueKm: number | null;
  /** How far it is; below nought when it is overdue. */
  leftKm: number | null;
}

const UNKNOWN: NextMaintenance = { state: 'unknown', currentKm: null, currentAt: null, firstKm: null, dueKm: null, leftKm: null };

const ms = (at: Date | string): number => (typeof at === 'string' ? Date.parse(at) : at.getTime());

/**
 * The next planned maintenance (ADR-0038 §2): the mileage of the last closed
 * planned repair plus the interval; before there is one, the first multiple of
 * the interval not below the first reading and not below the interval itself —
 * a moped first read at 4 820 km waits for 5 000, one read at 5 000 is due now.
 * The mark does not move ahead with the mileage: passed without a maintenance,
 * it is overdue.
 */
export function nextMaintenance(input: {
  readings: readonly MileageReading[];
  /** The reading of the latest closed planned repair; none — no maintenance yet. */
  lastPlannedKm: number | null;
  intervalKm: number;
  warnKm: number;
}): NextMaintenance {
  const readings = input.readings.filter((r) => Number.isFinite(r.km) && Number.isFinite(ms(r.at)));
  if (readings.length === 0) return UNKNOWN;
  // The latest by time; two at the same minute — the higher one.
  const current = readings.reduce((a, b) => (ms(b.at) > ms(a.at) || (ms(b.at) === ms(a.at) && b.km > a.km) ? b : a));
  // The earliest by time; two at the same minute — the lower one.
  const first = readings.reduce((a, b) => (ms(b.at) < ms(a.at) || (ms(b.at) === ms(a.at) && b.km < a.km) ? b : a));
  const interval = input.intervalKm;
  const dueKm = input.lastPlannedKm != null ? input.lastPlannedKm + interval : Math.max(interval, Math.ceil(first.km / interval) * interval);
  const leftKm = dueKm - current.km;
  return {
    state: leftKm < 0 ? 'overdue' : leftKm < input.warnKm ? 'soon' : 'ok',
    currentKm: current.km,
    currentAt: new Date(ms(current.at)).toISOString(),
    firstKm: first.km,
    dueKm,
    leftKm,
  };
}

/** «Пора на ТО»: less than the warning left, or past the mark (ADR-0038 §3). */
export function maintenanceDue(state: MaintenanceState): boolean {
  return state === 'soon' || state === 'overdue';
}
