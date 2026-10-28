import {
  addDays,
  dayStart,
  fleetNumber,
  todoCounts,
  todoDuesToMake,
  todoRecordEnded,
  type ISODate,
  type Permission,
  type RentalStatus,
  type Role,
  type TodoLink,
  type TodoRepeatKind,
  type TodoView,
  type VehicleState,
} from '@ev8/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { audit } from './audit.js';
import { dateFromISO, isoDate } from './dates.js';
import { prisma } from './db.js';
import { env } from './env.js';

// «Задачи» (GitHub issue #18 of the director, part A; ADR-0050): what the
// list, the block on «Сегодня» and the menu's numbers read, and the two
// things that happen to tasks without anybody pressing a button — a repeat
// makes its next occurrence, and a record that ended closes the tasks about
// it. Both are done when the tasks are read, not at night: the menu asks on
// every screen, so nobody ever reads a list the night has not caught up
// with, and there is no job to forget. Both are idempotent — one occurrence
// per day of a series is a unique index, a closing asks the task still open.

/** What a task is read with, everywhere: one select, so the list and a write's answer cannot part. */
export const TODO_SELECT = {
  id: true,
  text: true,
  note: true,
  dueOn: true,
  leadDays: true,
  needsFile: true,
  assigneeId: true,
  createdById: true,
  createdAt: true,
  closedAt: true,
  closeNote: true,
  closedByRecord: true,
  seriesId: true,
  seriesOn: true,
  assignee: { select: { id: true, name: true, role: true } },
  createdBy: { select: { id: true, name: true } },
  closedBy: { select: { id: true, name: true } },
  vehicle: { select: { id: true, vin: true, fleetNo: true, state: true, archived: true, model: { select: { brand: true, name: true } } } },
  rental: { select: { id: true, number: true, status: true, customer: { select: { name: true } } } },
  customer: { select: { id: true, name: true } },
  series: { select: { repeat: true, repeatDay: true, stoppedAt: true } },
  files: { where: { archived: false }, select: { id: true, label: true, mimeType: true }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.TodoSelect;

export type TodoRow = Prisma.TodoGetPayload<{ select: typeof TODO_SELECT }>;

/** Who reads a task: his id and his rights in this session. */
export interface TodoReader {
  id: string;
  permissions: readonly Permission[];
}

/**
 * The record a task is about, as this reader may see it. Whoever does not
 * read the fleet — a mechanic — reads a moped's number and model and opens no
 * card; a rental's customer is not named to him (he is never given one,
 * `todoLinkKindsFor`, but an owner's list holds every task).
 */
function linkOf(r: TodoRow, reader: TodoReader): TodoLink | null {
  const fleet = reader.permissions.includes('fleet.view');
  if (r.vehicle) {
    return {
      kind: 'vehicle',
      id: r.vehicle.id,
      label: fleetNumber(r.vehicle.fleetNo) ?? `···${r.vehicle.vin.slice(-4)}`,
      sub: `${r.vehicle.model.brand} ${r.vehicle.model.name}`,
      open: fleet,
    };
  }
  if (r.rental) return { kind: 'rental', id: r.rental.id, label: r.rental.number, sub: fleet ? r.rental.customer.name : null, open: fleet };
  if (r.customer) return { kind: 'customer', id: r.customer.id, label: fleet ? r.customer.name : '—', sub: null, open: fleet };
  return null;
}

/**
 * The record a task is about has ended (`todoRecordEnded`): a rental returned,
 * a moped sold, written off or taken off the list. A closed task about it is
 * not opened again — it would close at the next look (`todo_record_ended`) —
 * and the list does not offer it: the route and `may.reopen` ask this one
 * question (QA before 1.17.0: «Вернуть в работу» was shown, and refused).
 */
export function todoLinkEnded(r: { rental: { status: RentalStatus } | null; vehicle: { state: VehicleState; archived: boolean } | null }): boolean {
  return (
    (r.rental != null && todoRecordEnded({ kind: 'rental', rentalStatus: r.rental.status })) ||
    (r.vehicle != null && todoRecordEnded({ kind: 'vehicle', vehicleState: r.vehicle.state, vehicleArchived: r.vehicle.archived }))
  );
}

/** A task as the screen gets it, with what this reader may do to it. */
export function todoView(r: TodoRow, reader: TodoReader): TodoView {
  const open = r.closedAt == null;
  const repeats = r.series != null && r.series.stoppedAt == null;
  return {
    id: r.id,
    text: r.text,
    note: r.note,
    dueOn: isoDate(r.dueOn)!,
    leadDays: r.leadDays,
    needsFile: r.needsFile,
    repeat: repeats ? (r.series!.repeat as TodoRepeatKind) : 'none',
    repeatDay: repeats ? r.series!.repeatDay : null,
    assignee: { id: r.assignee.id, name: r.assignee.name, role: r.assignee.role as Role },
    setBy: r.createdBy,
    setAt: r.createdAt.toISOString(),
    link: linkOf(r, reader),
    closedAt: r.closedAt?.toISOString() ?? null,
    closedBy: r.closedBy,
    closedByRecord: r.closedByRecord,
    closeNote: r.closeNote,
    files: r.files,
    may: {
      close: open && r.assigneeId === reader.id,
      edit: open && r.createdById === reader.id,
      reopen: !open && (r.assigneeId === reader.id || r.createdById === reader.id) && !todoLinkEnded(r),
    },
  };
}

/**
 * A record that has ended (`TODO_ENDED_RENTAL`, `TODO_ENDED_VEHICLE` of
 * @ev8/shared): a rental returned, a moped sold, written off or taken off the
 * list. A customer does not end. Written out for Prisma, whose rental status
 * has no `due_today` — the shared list is tested against this one.
 */
export const ENDED_RECORD = {
  OR: [{ rental: { status: 'returned' as const } }, { vehicle: { OR: [{ state: { in: ['sold' as const, 'out' as const] } }, { archived: true }] } }],
} satisfies Prisma.TodoWhereInput;

const ENDED_SERIES = {
  OR: [{ rental: { status: 'returned' as const } }, { vehicle: { OR: [{ state: { in: ['sold' as const, 'out' as const] } }, { archived: true }] } }],
} satisfies Prisma.TodoSeriesWhereInput;

/**
 * Close the open tasks about a record that ended, and stop the repeats tied
 * to one (the director's issue: «поручение по аренде — аренда возвращена»).
 * Nobody closed them: the task says it closed by itself, and the journal
 * writes it without a person.
 */
async function closeEnded(): Promise<void> {
  const rows = await prisma.todo.findMany({ where: { closedAt: null, deletedAt: null, ...ENDED_RECORD }, select: { id: true, rentalId: true, vehicleId: true } });
  for (const r of rows) {
    const at = new Date();
    const { count } = await prisma.todo.updateMany({ where: { id: r.id, closedAt: null }, data: { closedAt: at, closedByRecord: true, updatedAt: at } });
    if (count > 0) await audit({ actorId: null, action: 'todo.close.record', entityType: 'todo', entityId: r.id, after: { rentalId: r.rentalId ?? undefined, vehicleId: r.vehicleId ?? undefined } });
  }
  const series = await prisma.todoSeries.findMany({ where: { stoppedAt: null, ...ENDED_SERIES }, select: { id: true } });
  for (const s of series) {
    const { count } = await prisma.todoSeries.updateMany({ where: { id: s.id, stoppedAt: null }, data: { stoppedAt: new Date() } });
    if (count > 0) await audit({ actorId: null, action: 'todo.repeat.stop', entityType: 'todo_series', entityId: s.id, note: 'record ended' });
  }
}

/**
 * Every repeat makes the occurrences it owes: each next one while its last is
 * before today, late ones included (`todoDuesToMake`). Two readers at once make
 * one — the second meets the unique day and skips it.
 */
async function makeDue(today: ISODate): Promise<void> {
  const running = await prisma.todoSeries.findMany({ where: { stoppedAt: null, lastOn: { lt: dateFromISO(today)! } } });
  for (const s of running) {
    const dues = todoDuesToMake(s.repeat as TodoRepeatKind, s.repeatDay, isoDate(s.lastOn)!, today);
    const last = dues.at(-1);
    if (!last) continue;
    await prisma.todo.createMany({
      data: dues.map((d) => ({
        text: s.text,
        note: s.note,
        dueOn: dateFromISO(d)!,
        leadDays: s.leadDays,
        needsFile: s.needsFile,
        assigneeId: s.assigneeId,
        createdById: s.createdById,
        vehicleId: s.vehicleId,
        rentalId: s.rentalId,
        customerId: s.customerId,
        seriesId: s.id,
        seriesOn: dateFromISO(d)!,
      })),
      skipDuplicates: true,
    });
    await prisma.todoSeries.updateMany({ where: { id: s.id, lastOn: { lt: dateFromISO(last)! } }, data: { lastOn: dateFromISO(last)! } });
  }
}

/** Bring the tasks up to `today` before they are read: the ended records first, so a stopped repeat makes nothing. */
export async function keepTodos(today: ISODate): Promise<void> {
  await closeEnded();
  await makeDue(today);
}

/** The two numbers beside «Задачи» in the menu: one's own late and today's (`todoCounts`). */
export async function todoCountsOf(userId: string, today: ISODate): Promise<{ late: number; today: number }> {
  await keepTodos(today);
  const open = await prisma.todo.findMany({ where: { assigneeId: userId, closedAt: null, deletedAt: null }, select: { dueOn: true, leadDays: true } });
  return todoCounts(
    open.map((t) => ({ dueOn: isoDate(t.dueOn)!, leadDays: t.leadDays })),
    today,
  );
}

/** «Сделано за 7 дней»: the first instant of the seventh Tbilisi day back, today the last of them. */
export function doneSince(today: ISODate): Date {
  return dayStart(addDays(today, -6), env.TZ);
}
