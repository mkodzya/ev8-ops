import type { Dict } from '../i18n/en.js';
import type { Locale } from '../i18n/index.js';
import { groupDigits } from './workBook.js';

// Planned maintenance and repair downtime as the screens read them (stage 6;
// ADR-0038). Nothing is worked out here: the API counts, the screen says it.

export type MaintenanceState = 'unknown' | 'ok' | 'soon' | 'overdue';

/** One moped's maintenance, as `/api/service/maintenance` and the moped's card give it. */
export interface VehicleMaintenance {
  vehicleId: string;
  number: string | null;
  model: string;
  vin: string;
  state: MaintenanceState;
  currentKm: number | null;
  currentAt: string | null;
  readingSource: 'pickup' | 'return' | 'repair_open' | 'repair_close' | null;
  /** The reading was one of a swap's two acts (ADR-0040); absent while an older API answers. */
  readingBySwap?: boolean;
  dueKm: number | null;
  leftKm: number | null;
  lastPlanned: { jobId: string; number: string; km: number; closedOn: string | null } | null;
  /** A planned repair already waiting or in work: the maintenance is under way. */
  openPlanned: { jobId: string; number: string; status: string } | null;
}

export interface MaintenanceList {
  intervalKm: number;
  warnKm: number;
  due: VehicleMaintenance[];
  unknownCount: number;
  knownCount: number;
}

/** A repair's downtime: minutes from opening to closing, and of them waiting for approval. */
export interface Downtime {
  minutes: number;
  waitMinutes: number;
  running: boolean;
}

/** 12 345 → «12 345». */
export const kmText = (km: number) => groupDigits(km);

/**
 * Minutes as the workshop says them: under an hour in minutes, then hours to
 * a tenth — «25 мин», «3,5 ч», «26 ч». Summed in minutes, rounded once here.
 */
export function spanText(minutes: number, t: Dict, locale: Locale): string {
  if (minutes < 60) return t.wmaint.minutes(minutes);
  const tenths = Math.round(minutes / 6) / 10;
  const h = String(tenths);
  return t.wmaint.hours(locale === 'en' ? h : h.replace('.', ','));
}

/** «осталось 140 км» or «просрочено на 320 км». */
export function leftText(m: { leftKm: number | null }, t: Dict): string {
  if (m.leftKm == null) return '';
  return m.leftKm < 0 ? t.wmaint.over(kmText(-m.leftKm)) : t.wmaint.left(kmText(m.leftKm));
}

/** Downtime over a period: what the week and the utilisation reports carry (ADR-0038). */
export interface RepairHours {
  minutes: number;
  waitMinutes: number;
  counted: number;
  unknown: number;
}

/** «26 ч · ожидание согласования 2 ч · 1 без времени». */
export function repairHoursText(r: RepairHours, t: Dict, locale: Locale): string {
  const main = t.wmaint.repairsValue(spanText(r.minutes, t, locale), spanText(r.waitMinutes, t, locale));
  return r.unknown > 0 ? `${main} · ${t.wmaint.repairsUnknown(r.unknown)}` : main;
}
