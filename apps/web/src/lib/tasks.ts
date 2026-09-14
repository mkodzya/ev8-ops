import type { Permission } from '@ev8/shared';
import type { Dict } from '../i18n/en.js';

// What today is asking a person to do. One definition, because two places
// read it: the first row of "Today" (U1) and the badge on the bottom bar
// (U11). A badge that counts something other than what the screen lists is
// worse than no badge.

export interface DayTaskSource {
  rentals: { overdue: number; withoutVin: number };
  unmatchedLines: number;
  openServiceJobs: number;
  pickedUpToday: unknown[];
  dueBackToday: unknown[];
}

export interface DayTask {
  key: string;
  count: number;
  label: string;
  action: string;
  to: string;
  tone?: 'crit' | 'warn';
}

export function dayTasks(s: DayTaskSource, t: Dict, can: (p: Permission) => boolean): DayTask[] {
  const all: DayTask[] = [
    { key: 'dueBack', count: s.dueBackToday.length, label: t.today.dueBack, action: t.today.goReturn, to: '/rentals' },
    { key: 'pickedUp', count: s.pickedUpToday.length, label: t.today.pickedUp, action: t.today.goOpen, to: '/rentals' },
    { key: 'overdue', count: s.rentals.overdue, label: t.today.overdue, action: t.today.goOpen, to: '/rentals', tone: 'crit' },
    ...(can('payments.reconcile')
      ? [{ key: 'unmatched', count: s.unmatchedLines, label: t.today.unmatched, action: t.today.goSort, to: '/statements', tone: 'warn' as const }]
      : []),
    { key: 'withoutVin', count: s.rentals.withoutVin, label: t.today.withoutVin, action: t.today.goOpen, to: '/rentals', tone: 'warn' },
    { key: 'service', count: s.openServiceJobs, label: t.today.openService, action: t.today.goOpen, to: '/service', tone: 'warn' },
  ];
  // Only what is actually waiting: a task with nothing in it is not a task.
  return all.filter((task) => task.count > 0);
}

/** The badge: how many things, not how many kinds of thing. */
export function dayTaskCount(tasks: DayTask[]): number {
  return tasks.reduce((n, task) => n + task.count, 0);
}
