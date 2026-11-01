import { describe, expect, it } from 'vitest';
import { callDue, georgianHolidays, isReminderHoliday, orthodoxEaster, reminderFor, reminderStage, slotOf, templateLang, type ReminderRental } from '../src/reminders.js';

// The rent reminders' rule (issue #20 of the director, ADR-0052).

const running = (over: Partial<ReminderRental> = {}): ReminderRental => ({ status: 'overdue', pickedUpOn: '2026-10-01', dueOn: '2026-11-03', owesTetri: 15000, off: false, ...over });

describe('the Georgian Orthodox holidays', () => {
  it('counts Orthodox Easter for the years the business will see', () => {
    // As the Georgian Church published them.
    expect(orthodoxEaster(2025)).toBe('2025-04-20');
    expect(orthodoxEaster(2026)).toBe('2026-04-12');
    expect(orthodoxEaster(2027)).toBe('2027-05-02');
    expect(orthodoxEaster(2028)).toBe('2028-04-16');
  });

  it('is the director’s list: four days round Easter and six fixed ones', () => {
    expect(georgianHolidays(2026)).toEqual(['2026-01-07', '2026-01-19', '2026-04-10', '2026-04-11', '2026-04-12', '2026-04-13', '2026-05-12', '2026-08-28', '2026-10-14', '2026-11-23']);
    expect(isReminderHoliday('2026-11-23')).toBe(true);
    // A weekend sends; so does a public holiday that is not on the list.
    expect(isReminderHoliday('2026-11-01')).toBe(false);
    expect(isReminderHoliday('2026-03-08')).toBe(false);
  });
});

describe('the chain, counted in days that send', () => {
  it('is the due day, then two days overdue, then nothing', () => {
    expect(reminderStage('2026-11-03', '2026-11-02')).toBeNull();
    expect(reminderStage('2026-11-03', '2026-11-03')).toBe(0);
    expect(reminderStage('2026-11-03', '2026-11-04')).toBe(1);
    expect(reminderStage('2026-11-03', '2026-11-05')).toBe(2);
    expect(reminderStage('2026-11-03', '2026-11-06')).toBe(3);
    expect(reminderStage('2026-11-03', '2026-12-30')).toBe(3);
  });

  it('waits on a holiday and moves on a day: nobody gets the warning without the reminder before it', () => {
    // 23.11 is St George's day. Due on the 22nd: the 1st overdue message waits till the 24th.
    expect(reminderStage('2026-11-22', '2026-11-22')).toBe(0);
    expect(reminderStage('2026-11-22', '2026-11-23')).toBeNull();
    expect(reminderStage('2026-11-22', '2026-11-24')).toBe(1);
    expect(reminderStage('2026-11-22', '2026-11-25')).toBe(2);
    // Due on the holiday itself: the due day's message goes the day after.
    expect(reminderStage('2026-11-23', '2026-11-24')).toBe(0);
    // Easter 2026: four days in a row.
    expect(reminderStage('2026-04-09', '2026-04-14')).toBe(1);
  });
});

describe('what a rental is sent at a slot', () => {
  it('the due day at noon only; the two overdue days at noon and at six', () => {
    const due = running({ status: 'due_today' });
    expect(reminderFor(due, '2026-11-03', '12:00')).toEqual({ send: true, template: 'payment_due', stage: 0 });
    expect(reminderFor(due, '2026-11-03', '18:00')).toEqual({ send: false, why: 'not_this_slot' });
    expect(reminderFor(running(), '2026-11-04', '12:00')).toEqual({ send: true, template: 'overdue_1', stage: 1 });
    expect(reminderFor(running(), '2026-11-04', '18:00')).toEqual({ send: true, template: 'overdue_1', stage: 1 });
    expect(reminderFor(running(), '2026-11-05', '18:00')).toEqual({ send: true, template: 'overdue_2', stage: 2 });
    expect(reminderFor(running(), '2026-11-06', '12:00')).toEqual({ send: false, why: 'over' });
  });

  it('only while the debt is there, never on the hand-over day, never when switched off, never for a rental not running', () => {
    expect(reminderFor(running({ owesTetri: 0 }), '2026-11-04', '18:00')).toEqual({ send: false, why: 'nothing_owed' });
    expect(reminderFor(running({ status: 'due_today', pickedUpOn: '2026-11-03' }), '2026-11-03', '12:00')).toEqual({ send: false, why: 'handed_over_today' });
    expect(reminderFor(running({ off: true }), '2026-11-04', '12:00')).toEqual({ send: false, why: 'off' });
    for (const status of ['active', 'returned', 'paused', 'disputed', 'booked']) expect(reminderFor(running({ status }), '2026-11-04', '12:00')).toEqual({ send: false, why: 'not_running' });
    expect(reminderFor(running(), '2026-11-23', '12:00')).toEqual({ send: false, why: 'holiday' });
  });

  it('says «пора звонить» on the two warning days only', () => {
    expect(callDue(running(), '2026-11-03')).toBe(false);
    expect(callDue(running(), '2026-11-04')).toBe(true);
    expect(callDue(running(), '2026-11-05')).toBe(true);
    expect(callDue(running(), '2026-11-06')).toBe(false);
    expect(callDue(running({ owesTetri: 0 }), '2026-11-04')).toBe(false);
  });
});

describe('the slot and the language', () => {
  it('reads the slot off the hour, and sends Russian in English', () => {
    expect(slotOf(12)).toBe('12:00');
    expect(slotOf(17)).toBe('12:00');
    expect(slotOf(18)).toBe('18:00');
    expect([templateLang('ka'), templateLang('ru'), templateLang('en'), templateLang(null)]).toEqual(['ka', 'en', 'en', 'ka']);
  });
});
