// «Задачи» — the tasks people set by hand (GitHub issue #18 of the director,
// part A; Mika's «А» of 28.10.2026; ADR-0050). An owner sets one to a
// manager, to the chief mechanic or to himself; everybody else to himself.
// One is a text, a due day, whose it is, a comment, «нужно фото или файл,
// чтобы закрыть» and, if wanted, the moped, rental or customer it is about.
// It may repeat every week on its weekday or every month on its date.
//
// The code calls them todos. «Task» already names the rows of «Сегодня»
// (`today.ts`: `TaskRow`, `TASK_GROUPS`), which the system builds by itself
// from the data — and the two must not be confused: nothing «Сегодня» derives
// is ever copied into a todo (the director's issue, «Чтобы не задвоить»).
//
// The rules live here, so the list, the block on «Сегодня», the counters of
// the menu and the server read one answer.
import { isoWeekday } from './periods.js';
import { ROLE_PERMISSIONS, type Permission } from './permissions.js';
import { addDays, daysBetween, isISODate } from './time.js';
import type { ISODate, RentalStatus, Role, VehicleState } from './types.js';

/** How a todo repeats: not at all, every week on its weekday, every month on its date. */
export const TODO_REPEATS = ['none', 'weekly', 'monthly'] as const;
export type TodoRepeat = (typeof TODO_REPEATS)[number];
export type TodoRepeatKind = Exclude<TodoRepeat, 'none'>;

/**
 * The groups of «Задачи», by day (the director's mockup): late, today — due
 * today or shown ahead of its day —, tomorrow, the rest of this week, later.
 * «Сделано» is a group of the screen, not of an open todo.
 */
export const TODO_BUCKETS = ['overdue', 'today', 'tomorrow', 'week', 'later'] as const;
export type TodoBucket = (typeof TODO_BUCKETS)[number];

/** What a todo may be about (the director's issue): a moped, a rental or a customer. */
export const TODO_LINK_KINDS = ['vehicle', 'rental', 'customer'] as const;
export type TodoLinkKind = (typeof TODO_LINK_KINDS)[number];

export const TODO_TEXT_MAX = 300;
export const TODO_NOTE_MAX = 2000;
/** «Показать заранее за N дней»: a month at most. */
export const TODO_LEAD_MAX = 30;
/** What the form offers for it; the server takes any whole number up to the maximum. */
export const TODO_LEAD_CHOICES: readonly number[] = [0, 1, 2, 3, 5, 7, 14];

/** The owner's filter that shows his own tasks; the others are people's ids, and «Все» is `all` (chips.ts). */
export const TODO_MINE = 'mine';

/**
 * Whom an owner gives a task to besides himself (the director's issue, «Кто
 * кому»): a manager or the chief mechanic. Not another owner, not a mechanic.
 */
export const TODO_ASSIGNEE_ROLES: readonly Role[] = ['manager', 'chief_mechanic'];

/**
 * May a person with these rights give a task to `to`? Himself always; anybody
 * else only with `todos.assign` (an owner) and only a manager or the chief
 * mechanic who is not switched off.
 */
export function mayGiveTodo(permissions: readonly Permission[], me: string, to: { id: string; role: Role; active: boolean }): boolean {
  if (to.id === me) return true;
  return permissions.includes('todos.assign') && to.active && TODO_ASSIGNEE_ROLES.includes(to.role);
}

/**
 * Which records a task given to this role may be about: a moped for anyone; a
 * rental or a customer only for a role that reads them — a mechanic sees no
 * customer (ADR-0033 §2), so he is not sent one through a task.
 */
export function todoLinkKindsFor(role: Role): TodoLinkKind[] {
  return ROLE_PERMISSIONS[role].includes('fleet.view') ? [...TODO_LINK_KINDS] : ['vehicle'];
}

/**
 * May a person with these rights tie a task given to `assignee` to a record
 * of this kind? He has to read the fleet to find it at all, and the record has
 * to be one the assignee reads.
 */
export function mayLinkTodo(permissions: readonly Permission[], assignee: Role, kind: TodoLinkKind): boolean {
  return permissions.includes('fleet.view') && todoLinkKindsFor(assignee).includes(kind);
}

const pad = (n: number) => String(n).padStart(2, '0');
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** The day a repeat keeps, read from the task's due date: its weekday (1 = Monday … 7 = Sunday), or its day of the month. */
export function repeatDayOf(repeat: TodoRepeatKind, dueOn: ISODate): number {
  return repeat === 'weekly' ? isoWeekday(dueOn) : Number(dueOn.slice(8, 10));
}

/**
 * The first day after `after` the repeat falls on: the next of its weekday, or
 * the next of its date — the last day of a month too short for it (the 31st
 * is the 30th in November and the 28th in February), and its own date again
 * in the month after.
 */
export function nextTodoDue(repeat: TodoRepeatKind, day: number, after: ISODate): ISODate {
  if (repeat === 'weekly') {
    const ahead = (day - isoWeekday(after) + 7) % 7;
    return addDays(after, ahead === 0 ? 7 : ahead);
  }
  let year = Number(after.slice(0, 4));
  let month = Number(after.slice(5, 7));
  const inMonth = `${year}-${pad(month)}-${pad(Math.min(day, daysInMonth(year, month)))}`;
  if (inMonth > after) return inMonth;
  month += 1;
  if (month > 12) {
    month = 1;
    year += 1;
  }
  return `${year}-${pad(month)}-${pad(Math.min(day, daysInMonth(year, month)))}`;
}

/**
 * The due days a series still owes after the last one it made: each next one
 * while the last is before today — so every late one stays a task of its own,
 * and the first on or after today waits in the list as the next. «Следующая
 * появляется сама, даже если прошлая не закрыта» (the director's issue). The
 * cap only keeps a series nobody looked at for years from running away.
 */
export function todoDuesToMake(repeat: TodoRepeatKind, day: number, lastOn: ISODate, today: ISODate, cap = 400): ISODate[] {
  const out: ISODate[] = [];
  let d = lastOn;
  while (d < today && out.length < cap) {
    d = nextTodoDue(repeat, day, d);
    out.push(d);
  }
  return out;
}

/** The Sunday of the week `today` is in (weeks run Monday to Sunday). */
export function weekEndOf(today: ISODate): ISODate {
  return addDays(today, 7 - isoWeekday(today));
}

/** The first day a task shown ahead stands on «Сегодня»; null when it is not shown ahead. */
export function todoShownFrom(t: { dueOn: ISODate; leadDays: number }): ISODate | null {
  return t.leadDays > 0 ? addDays(t.dueOn, -t.leadDays) : null;
}

/**
 * Which group of «Задачи» an open task stands in on `today`. A task shown
 * ahead («Показать заранее за N дней») is today's from its first day on: it
 * appears on «Сегодня» earlier than its due day, and the menu's grey number
 * counts it there.
 */
export function todoBucket(t: { dueOn: ISODate; leadDays: number }, today: ISODate): TodoBucket {
  if (t.dueOn < today) return 'overdue';
  if (addDays(t.dueOn, -Math.max(0, t.leadDays)) <= today) return 'today';
  if (t.dueOn === addDays(today, 1)) return 'tomorrow';
  if (t.dueOn <= weekEndOf(today)) return 'week';
  return 'later';
}

/** On «Сегодня»: late, or today's. The block there lists these, and nothing else. */
export function todoOnToday(t: { dueOn: ISODate; leadDays: number }, today: ISODate): boolean {
  const b = todoBucket(t, today);
  return b === 'overdue' || b === 'today';
}

/**
 * The two numbers beside «Задачи» in the menu: red — late, grey — today's. Of
 * one's own open tasks, the ones the block on «Сегодня» lists (ux №10).
 */
export function todoCounts(todos: readonly { dueOn: ISODate; leadDays: number }[], today: ISODate): { late: number; today: number } {
  let late = 0;
  let due = 0;
  for (const t of todos) {
    const b = todoBucket(t, today);
    if (b === 'overdue') late++;
    else if (b === 'today') due++;
  }
  return { late, today: due };
}

/** How many days a task is late: «−10 дн.»; nought for one not late. */
export function todoDaysLate(dueOn: ISODate, today: ISODate): number {
  return Math.max(0, daysBetween(dueOn, today));
}

/**
 * A record that has ended closes the tasks about it, and stops a repeat tied
 * to it (the director's issue: «поручение по аренде — аренда возвращена»):
 * a rental returned, a moped sold or written off. A customer does not end.
 */
export const TODO_ENDED_RENTAL: readonly RentalStatus[] = ['returned'];
export const TODO_ENDED_VEHICLE: readonly VehicleState[] = ['sold', 'out'];

export function todoRecordEnded(link: { kind: TodoLinkKind; rentalStatus?: RentalStatus | null; vehicleState?: VehicleState | null; vehicleArchived?: boolean | null }): boolean {
  if (link.kind === 'rental') return link.rentalStatus != null && TODO_ENDED_RENTAL.includes(link.rentalStatus);
  if (link.kind === 'vehicle') return link.vehicleArchived === true || (link.vehicleState != null && TODO_ENDED_VEHICLE.includes(link.vehicleState));
  return false;
}

/** What is wrong with a task as written: the code the server refuses with and the field it is about. */
export type TodoFault = { code: 'todo_text_missing' | 'todo_text_long' | 'todo_note_long' | 'todo_due_bad' | 'todo_due_past' | 'todo_lead_bad'; field: 'text' | 'note' | 'dueOn' | 'leadDays' };

/**
 * The checks of a task's own fields, the same on the form and on the server.
 * A due day is not set in the past — a task is not given late; one already
 * late keeps its day while its other fields change (`dueChanged` false).
 */
export function todoFault(input: { text: string; note?: string | null; dueOn: string; leadDays: number; today: ISODate; dueChanged?: boolean }): TodoFault | null {
  const text = input.text.trim();
  if (!text) return { code: 'todo_text_missing', field: 'text' };
  if (text.length > TODO_TEXT_MAX) return { code: 'todo_text_long', field: 'text' };
  if ((input.note ?? '').trim().length > TODO_NOTE_MAX) return { code: 'todo_note_long', field: 'note' };
  if (!isISODate(input.dueOn)) return { code: 'todo_due_bad', field: 'dueOn' };
  if (input.dueChanged !== false && input.dueOn < input.today) return { code: 'todo_due_past', field: 'dueOn' };
  if (!Number.isInteger(input.leadDays) || input.leadDays < 0 || input.leadDays > TODO_LEAD_MAX) return { code: 'todo_lead_bad', field: 'leadDays' };
  return null;
}

/** A record a task is about, as the reader sees it. */
export interface TodoLink {
  kind: TodoLinkKind;
  id: string;
  /** EV-007 or the VIN's last four, R-00412, a customer's name. */
  label: string;
  /** The model of a moped, the customer of a rental; null for a customer. */
  sub: string | null;
  /** False when the reader may not open that card: a mechanic and a moped (ADR-0033). */
  open: boolean;
}

/** A task as `GET /api/todos` gives it. */
export interface TodoView {
  id: string;
  text: string;
  note: string | null;
  dueOn: ISODate;
  leadDays: number;
  needsFile: boolean;
  repeat: TodoRepeat;
  /** The weekday or the date it repeats on; null when it does not. */
  repeatDay: number | null;
  assignee: { id: string; name: string; role: Role };
  setBy: { id: string; name: string };
  setAt: string;
  link: TodoLink | null;
  closedAt: string | null;
  /** Null when it closed by itself: the record it was about ended. */
  closedBy: { id: string; name: string } | null;
  closedByRecord: boolean;
  closeNote: string | null;
  files: { id: string; label: string; mimeType: string }[];
  /** What the reader may do: close it and add a file (whose it is), change and delete it (who set it), open it again (either). */
  may: { close: boolean; edit: boolean; reopen: boolean };
}
