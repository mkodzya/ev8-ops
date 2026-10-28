// «Задачи» (GitHub issue #18 of the director, part A; ADR-0050): the rules
// the list, the block on «Сегодня», the menu's counters and the server share.
// Every task here is invented.
import { describe, expect, it } from 'vitest';
import {
  ROLE_PERMISSIONS,
  mayGiveTodo,
  mayLinkTodo,
  nextTodoDue,
  repeatDayOf,
  todoBucket,
  todoCounts,
  todoDaysLate,
  todoDuesToMake,
  todoFault,
  todoLinkKindsFor,
  todoOnToday,
  todoRecordEnded,
  todoShownFrom,
  weekEndOf,
} from '../src/index.js';

// Monday 26.10.2026, as on the director's mockup.
const MONDAY = '2026-10-26';

describe('who gives a task to whom (the director’s issue, «Кто кому»)', () => {
  const me = 'owner-1';
  const person = (id: string, role: 'owner' | 'manager' | 'mechanic' | 'chief_mechanic', active = true) => ({ id, role, active });

  it('lets an owner give one to himself, a manager or the chief mechanic — and to no other owner and no mechanic', () => {
    const owner = ROLE_PERMISSIONS.owner;
    expect(mayGiveTodo(owner, me, person(me, 'owner'))).toBe(true);
    expect(mayGiveTodo(owner, me, person('m-1', 'manager'))).toBe(true);
    expect(mayGiveTodo(owner, me, person('c-1', 'chief_mechanic'))).toBe(true);
    expect(mayGiveTodo(owner, me, person('o-2', 'owner'))).toBe(false);
    expect(mayGiveTodo(owner, me, person('x-1', 'mechanic'))).toBe(false);
    // A login switched off is given nothing.
    expect(mayGiveTodo(owner, me, person('m-2', 'manager', false))).toBe(false);
  });

  it('lets a manager and either mechanic give one to himself only', () => {
    for (const role of ['manager', 'mechanic', 'chief_mechanic'] as const) {
      const mine = ROLE_PERMISSIONS[role];
      expect(mayGiveTodo(mine, 'p-1', person('p-1', role)), role).toBe(true);
      expect(mayGiveTodo(mine, 'p-1', person('m-9', 'manager')), role).toBe(false);
      expect(mayGiveTodo(mine, 'p-1', person('c-9', 'chief_mechanic')), role).toBe(false);
    }
  });

  it('ties a task to a moped for anyone, to a rental or a customer only for whoever reads them (ADR-0033 §2)', () => {
    expect(todoLinkKindsFor('manager')).toEqual(['vehicle', 'rental', 'customer']);
    expect(todoLinkKindsFor('owner')).toEqual(['vehicle', 'rental', 'customer']);
    expect(todoLinkKindsFor('chief_mechanic')).toEqual(['vehicle']);
    expect(todoLinkKindsFor('mechanic')).toEqual(['vehicle']);
    // An owner finds the record; a mechanic finds none — he reads no fleet.
    expect(mayLinkTodo(ROLE_PERMISSIONS.owner, 'chief_mechanic', 'vehicle')).toBe(true);
    expect(mayLinkTodo(ROLE_PERMISSIONS.owner, 'chief_mechanic', 'customer')).toBe(false);
    expect(mayLinkTodo(ROLE_PERMISSIONS.manager, 'manager', 'rental')).toBe(true);
    expect(mayLinkTodo(ROLE_PERMISSIONS.chief_mechanic, 'chief_mechanic', 'vehicle')).toBe(false);
  });
});

describe('the repeat (every week on its weekday, every month on its date)', () => {
  it('reads the repeat’s day from the due date', () => {
    expect(repeatDayOf('weekly', MONDAY)).toBe(1);
    expect(repeatDayOf('weekly', '2026-11-01')).toBe(7);
    expect(repeatDayOf('monthly', '2026-11-15')).toBe(15);
  });

  it('gives the next weekday a week on, and finds it from any day', () => {
    expect(nextTodoDue('weekly', 1, MONDAY)).toBe('2026-11-02');
    // From a Wednesday, the Monday after.
    expect(nextTodoDue('weekly', 1, '2026-10-28')).toBe('2026-11-02');
    expect(nextTodoDue('weekly', 5, MONDAY)).toBe('2026-10-30');
  });

  it('keeps the date of the month, and the last day of a month too short for it', () => {
    expect(nextTodoDue('monthly', 15, '2026-10-15')).toBe('2026-11-15');
    expect(nextTodoDue('monthly', 15, '2026-12-15')).toBe('2027-01-15');
    // The 31st: the 28th in February, the 31st again in March.
    expect(nextTodoDue('monthly', 31, '2026-01-31')).toBe('2026-02-28');
    expect(nextTodoDue('monthly', 31, '2026-02-28')).toBe('2026-03-31');
    expect(nextTodoDue('monthly', 30, '2026-11-30')).toBe('2026-12-30');
    expect(nextTodoDue('monthly', 29, '2028-01-29')).toBe('2028-02-29');
    // A date later in the same month comes first.
    expect(nextTodoDue('monthly', 20, '2026-10-05')).toBe('2026-10-20');
  });

  it('makes every next one while the last is before today — a late one stays, the next appears anyway', () => {
    // The September return was due 15.10 and nobody closed it: on 26.10 the November one is made, ahead.
    expect(todoDuesToMake('monthly', 15, '2026-10-15', MONDAY)).toEqual(['2026-11-15']);
    // A weekly round left for three weeks: three of its own, the last of them today.
    expect(todoDuesToMake('weekly', 1, '2026-10-05', MONDAY)).toEqual(['2026-10-12', '2026-10-19', '2026-10-26']);
    // Today's is the last one made: the next waits until tomorrow.
    expect(todoDuesToMake('weekly', 1, MONDAY, MONDAY)).toEqual([]);
    expect(todoDuesToMake('weekly', 1, MONDAY, '2026-10-27')).toEqual(['2026-11-02']);
    // One ahead already: nothing more.
    expect(todoDuesToMake('monthly', 15, '2026-11-15', MONDAY)).toEqual([]);
    expect(todoDuesToMake('weekly', 1, '2020-01-06', MONDAY, 5)).toHaveLength(5);
  });
});

describe('the groups by day (the director’s mockup: Просрочено · Сегодня · Завтра · Эта неделя · Позже)', () => {
  const t = (dueOn: string, leadDays = 0) => ({ dueOn, leadDays });

  it('puts a task in its day’s group', () => {
    expect(todoBucket(t('2026-10-15'), MONDAY)).toBe('overdue');
    expect(todoBucket(t(MONDAY), MONDAY)).toBe('today');
    expect(todoBucket(t('2026-10-27'), MONDAY)).toBe('tomorrow');
    expect(todoBucket(t('2026-10-30'), MONDAY)).toBe('week');
    expect(todoBucket(t('2026-11-01'), MONDAY)).toBe('week');
    expect(todoBucket(t('2026-11-02'), MONDAY)).toBe('later');
    expect(weekEndOf(MONDAY)).toBe('2026-11-01');
    // On a Sunday tomorrow is next week’s Monday, and «Эта неделя» is empty.
    expect(todoBucket(t('2026-11-02'), '2026-11-01')).toBe('tomorrow');
    expect(todoBucket(t('2026-11-03'), '2026-11-01')).toBe('later');
  });

  it('shows a task ahead of its day on «Сегодня» from the day it was asked to («Показать заранее за N дней»)', () => {
    const vat = t('2026-11-15', 3);
    expect(todoShownFrom(vat)).toBe('2026-11-12');
    expect(todoShownFrom(t('2026-11-15'))).toBeNull();
    expect(todoBucket(vat, '2026-11-11')).toBe('week');
    expect(todoBucket(vat, '2026-11-12')).toBe('today');
    expect(todoOnToday(vat, '2026-11-12')).toBe(true);
    expect(todoOnToday(vat, '2026-11-11')).toBe(false);
    expect(todoBucket(vat, '2026-11-16')).toBe('overdue');
  });

  it('counts for the menu the rows «Сегодня» lists: late red, today’s grey', () => {
    const mine = [t('2026-10-15'), t('2026-10-25'), t(MONDAY), t('2026-10-28', 2), t('2026-10-30'), t('2026-11-15', 3)];
    expect(todoCounts(mine, MONDAY)).toEqual({ late: 2, today: 2 });
    expect(mine.filter((x) => todoOnToday(x, MONDAY))).toHaveLength(4);
    expect(todoCounts([], MONDAY)).toEqual({ late: 0, today: 0 });
    expect(todoDaysLate('2026-10-15', MONDAY)).toBe(11);
    expect(todoDaysLate('2026-10-30', MONDAY)).toBe(0);
  });
});

describe('a record that ends closes the tasks about it', () => {
  it('ends with a rental returned, a moped sold or written off — never with a customer', () => {
    expect(todoRecordEnded({ kind: 'rental', rentalStatus: 'returned' })).toBe(true);
    for (const s of ['active', 'overdue', 'paused', 'disputed', 'booked'] as const) expect(todoRecordEnded({ kind: 'rental', rentalStatus: s }), s).toBe(false);
    expect(todoRecordEnded({ kind: 'vehicle', vehicleState: 'sold' })).toBe(true);
    expect(todoRecordEnded({ kind: 'vehicle', vehicleState: 'out' })).toBe(true);
    expect(todoRecordEnded({ kind: 'vehicle', vehicleState: 'service' })).toBe(false);
    expect(todoRecordEnded({ kind: 'vehicle', vehicleState: 'available', vehicleArchived: true })).toBe(true);
    expect(todoRecordEnded({ kind: 'customer' })).toBe(false);
  });
});

describe('a task as written', () => {
  const ok = { text: 'Обход парковки (пример)', dueOn: MONDAY, leadDays: 0, today: MONDAY };

  it('takes a text, a real day not in the past, and up to a month ahead', () => {
    expect(todoFault(ok)).toBeNull();
    expect(todoFault({ ...ok, text: '   ' })).toEqual({ code: 'todo_text_missing', field: 'text' });
    expect(todoFault({ ...ok, text: 'x'.repeat(301) })).toEqual({ code: 'todo_text_long', field: 'text' });
    expect(todoFault({ ...ok, note: 'x'.repeat(2001) })).toEqual({ code: 'todo_note_long', field: 'note' });
    expect(todoFault({ ...ok, dueOn: '2026-02-30' })).toEqual({ code: 'todo_due_bad', field: 'dueOn' });
    expect(todoFault({ ...ok, dueOn: '26.10.2026' })).toEqual({ code: 'todo_due_bad', field: 'dueOn' });
    expect(todoFault({ ...ok, dueOn: '2026-10-25' })).toEqual({ code: 'todo_due_past', field: 'dueOn' });
    expect(todoFault({ ...ok, leadDays: 31 })).toEqual({ code: 'todo_lead_bad', field: 'leadDays' });
    expect(todoFault({ ...ok, leadDays: 1.5 })).toEqual({ code: 'todo_lead_bad', field: 'leadDays' });
    expect(todoFault({ ...ok, leadDays: 30 })).toBeNull();
  });

  it('lets a late task keep its day while its words change', () => {
    expect(todoFault({ ...ok, dueOn: '2026-10-15', dueChanged: false })).toBeNull();
    expect(todoFault({ ...ok, dueOn: '2026-10-15', dueChanged: true })).toEqual({ code: 'todo_due_past', field: 'dueOn' });
  });
});
