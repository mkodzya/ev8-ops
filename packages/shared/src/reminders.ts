// Reminders of the rent, sent on a schedule (issue #20 of the director,
// 01.11.2026; ADR-0052). Step 1 decides; it sends nothing — the job writes
// what WOULD go, and the screen says so. Sending is step 2, by Kommo (the
// director's answer), once it is shown to send an approved template.
//
// The schedule, Tbilisi time, counted from the day the rental's rent is due
// (ADR-0017: `rentDueOn` — the oldest week not paid in full):
//   the due day           12:00         ev8_payment_due
//   1st day overdue       12:00, 18:00  ev8_overdue_1   — and «пора звонить»
//   2nd day overdue       12:00, 18:00  ev8_overdue_2   — and «пора звонить»
//   3rd day and after     nothing by itself: a person blocks the moped.
// A holiday of the Georgian Orthodox calendar sends nothing, and the whole
// chain moves a day — or the 2nd-day warning would reach somebody who never
// had the first. Weekends send. Each message only while the debt is still
// there at the moment of sending; none on the day a rental is handed over;
// none for a rental whose reminders a person switched off, with a reason.
import { addDays } from './time.js';
import type { ISODate } from './types.js';
import type { Tetri } from './money.js';

export const REMINDER_TEMPLATES = ['payment_due', 'overdue_1', 'overdue_2'] as const;
export type ReminderTemplate = (typeof REMINDER_TEMPLATES)[number];

/** The two moments of a day, Tbilisi time. */
export const REMINDER_SLOTS = ['12:00', '18:00'] as const;
export type ReminderSlot = (typeof REMINDER_SLOTS)[number];

/** The template's name in Meta, as the director registers it. */
export const REMINDER_META_NAME: Record<ReminderTemplate, string> = {
  payment_due: 'ev8_payment_due',
  overdue_1: 'ev8_overdue_1',
  overdue_2: 'ev8_overdue_2',
};

/** The languages a customer's messages go in; Russian has no template and goes in English (director, 01.11.2026). */
export const MESSAGE_LANGS = ['ka', 'ru', 'en'] as const;
export type MessageLang = (typeof MESSAGE_LANGS)[number];
export const templateLang = (lang: MessageLang | string | null | undefined): 'ka' | 'en' => (lang === 'en' || lang === 'ru' ? 'en' : 'ka');

/**
 * Orthodox Easter, as a Gregorian date: the Julian computus (Meeus), then the
 * thirteen days between the calendars — true from 1900 to 2099.
 */
export function orthodoxEaster(year: number): ISODate {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  const julian = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return addDays(julian, 13);
}

/**
 * The days no reminder goes, the director's list (issue #20): Christmas
 * (7 January), the Epiphany (19 January), Good Friday, Holy Saturday, Easter
 * and Easter Monday — Easter as the Orthodox Church counts it — St Andrew
 * (12 May), the Dormition (28 August), Svetitskhovloba (14 October) and
 * St George's day (23 November).
 */
export function georgianHolidays(year: number): ISODate[] {
  const easter = orthodoxEaster(year);
  const fixed = ['01-07', '01-19', '05-12', '08-28', '10-14', '11-23'].map((md) => `${year}-${md}`);
  return [...fixed, addDays(easter, -2), addDays(easter, -1), easter, addDays(easter, 1)].sort();
}

export function isReminderHoliday(day: ISODate): boolean {
  return georgianHolidays(Number(day.slice(0, 4))).includes(day);
}

/**
 * Which message of the chain today is, counted in days that send: 0 the due
 * day's, 1 and 2 the overdue ones, 3 and on — none. Null before the due day,
 * and on a holiday: nothing goes today, and the chain waits a day.
 */
export function reminderStage(dueOn: ISODate, today: ISODate): number | null {
  if (today < dueOn || isReminderHoliday(today)) return null;
  let sending = 0;
  // The chain is short: once three sending days have passed, it is over.
  for (let d = dueOn, i = 0; d <= today && i < 400; d = addDays(d, 1), i++) {
    if (!isReminderHoliday(d)) sending++;
    if (sending > 3) return 3;
  }
  return sending - 1;
}

export interface ReminderRental {
  /** The EFFECTIVE status (`rentStateOf`): only a running rental is reminded. */
  status: string;
  pickedUpOn: ISODate | null;
  /** The day its rent is due (`rentDueOn`); null — nothing to count from. */
  dueOn: ISODate | null;
  /** What it owes now: its part of the one debt figure. */
  owesTetri: Tetri;
  /** Switched off by a person, with a reason (MSG-02). */
  off: boolean;
}

export type ReminderDecision =
  | { send: true; template: ReminderTemplate; stage: number }
  | { send: false; why: 'not_running' | 'handed_over_today' | 'off' | 'nothing_owed' | 'not_due' | 'holiday' | 'over' | 'not_this_slot' };

/**
 * What a rental is sent at this slot of this day — the one rule the job and
 * the screen both read. Every message is decided at its own moment: one who
 * paid between 12:00 and 18:00 gets nothing at 18:00.
 */
export function reminderFor(r: ReminderRental, today: ISODate, slot: ReminderSlot): ReminderDecision {
  if (r.status !== 'due_today' && r.status !== 'overdue') return { send: false, why: 'not_running' };
  if (r.pickedUpOn === today) return { send: false, why: 'handed_over_today' };
  if (r.off) return { send: false, why: 'off' };
  if (r.owesTetri <= 0) return { send: false, why: 'nothing_owed' };
  if (!r.dueOn || today < r.dueOn) return { send: false, why: 'not_due' };
  const stage = reminderStage(r.dueOn, today);
  if (stage == null) return { send: false, why: 'holiday' };
  if (stage >= 3) return { send: false, why: 'over' };
  if (stage === 0 && slot !== '12:00') return { send: false, why: 'not_this_slot' };
  return { send: true, template: REMINDER_TEMPLATES[stage], stage };
}

/** «Пора звонить»: the 1st and 2nd day overdue, as the chain counts them — the days the warnings go. */
export function callDue(r: Pick<ReminderRental, 'status' | 'dueOn' | 'owesTetri' | 'pickedUpOn'>, today: ISODate): boolean {
  if (r.status !== 'overdue' || r.owesTetri <= 0 || !r.dueOn || r.pickedUpOn === today) return false;
  const stage = reminderStage(r.dueOn, today);
  return stage === 1 || stage === 2;
}

/** What «К звонку» says of a rental beside its row: today's reminders, «пора звонить», a switch-off with its reason. */
export interface RentalReminders {
  today: { slot: ReminderSlot; template: ReminderTemplate; mode: 'dry_run' | 'sent' | 'failed' }[];
  call: boolean;
  off: string | null;
}

/** The slot a moment falls in, Tbilisi time: before 18:00 — the noon one. */
export function slotOf(hourInTbilisi: number): ReminderSlot {
  return hourInTbilisi >= 18 ? '18:00' : '12:00';
}
