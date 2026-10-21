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
