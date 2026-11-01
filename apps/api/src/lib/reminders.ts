import { callDue, reminderFor, schedulePayOf, slotOf, templateLang, type ISODate, type PaymentsCalendar, type ReminderDecision, type ReminderSlot, type RentalReminders } from '@ev8/shared';
import { dateFromISO, isoDate } from './dates.js';
import { prisma } from './db.js';
import { env } from './env.js';

// The rent reminders' data side (issue #20 of the director, ADR-0052). The
// rule is shared (`packages/shared/src/reminders.ts`); here it is read against
// «Оплаты по графику» — the one rule of who is late and who pays today since
// issue #18, the credit the night will place counted — and what it decides is
// written down. Step 1 sends nothing: every row is `dry_run`, and the screen
// says so. Step 2 (Kommo) is where `mode` becomes `sent` or `failed`.

/** What a rental is reminded of at one slot, and the facts it was decided on. */
export interface PlannedReminder {
  rentalId: string;
  decision: ReminderDecision;
  /** What it owes now: today's week left for one due today, its debt for one late. */
  amountTetri: number;
  lang: 'ka' | 'en';
  call: boolean;
}

type CalendarNow = Pick<PaymentsCalendar, 'today' | 'entries' | 'late'>;

/** Every rental «Оплаты по графику» names today, with what the rule says of it at this slot. */
export async function planReminders(a: CalendarNow, slot: ReminderSlot): Promise<PlannedReminder[]> {
  const today = a.today;
  const pay = schedulePayOf(a);
  const ids = [...pay.keys()];
  if (ids.length === 0) return [];
  const rows = await prisma.rental.findMany({
    where: { id: { in: ids } },
    select: { id: true, pickedUpOn: true, remindersOffReason: true, customer: { select: { messageLang: true } } },
  });
  const late = new Map(a.late.rentals.map((l) => [l.rentalId, l]));
  const out: PlannedReminder[] = [];
  for (const r of rows) {
    const p = pay.get(r.id)!;
    const l = late.get(r.id);
    const dueOn: ISODate = p.state === 'overdue' && l ? l.sinceOn : today;
    const amountTetri =
      p.state === 'overdue' && l ? l.debtTetri : a.entries.filter((e) => e.rentalId === r.id && e.dueOn === today && e.state === 'due_today').reduce((n, e) => n + e.leftTetri, 0);
    const facts = { status: p.state, pickedUpOn: isoDate(r.pickedUpOn), dueOn, owesTetri: amountTetri, off: r.remindersOffReason != null };
    out.push({ rentalId: r.id, decision: reminderFor(facts, today, slot), amountTetri, lang: templateLang(r.customer.messageLang), call: callDue(facts, today) });
  }
  return out;
}

/**
 * The job at 12:00 and at 18:00 (the worker's clock): what goes at this slot,
 * written once — a second run of the same slot finds it written. Counts only
 * in the answer: no name, no phone, no sum.
 */
export async function runReminders(a: CalendarNow, slot: ReminderSlot): Promise<{ decided: number; written: number; mode: 'dry_run' }> {
  const plan = (await planReminders(a, slot)).filter((p) => p.decision.send);
  const day = dateFromISO(a.today)!;
  const res = await prisma.rentReminder.createMany({
    data: plan.map((p) => ({
      rentalId: p.rentalId,
      day,
      slot,
      template: p.decision.send ? p.decision.template : 'payment_due',
      lang: p.lang,
      amountTetri: p.amountTetri,
      mode: 'dry_run',
    })),
    skipDuplicates: true,
  });
  return { decided: plan.length, written: res.count, mode: 'dry_run' };
}

/**
 * What «К звонку» says of each rental beside its row: the reminders of today,
 * «пора звонить», and a switch-off with its reason. One read for every rental
 * the answer names.
 */
export async function remindersOfToday(a: CalendarNow, rentalIds: string[]): Promise<Record<string, RentalReminders>> {
  if (rentalIds.length === 0) return {};
  const [rows, offs] = await Promise.all([
    prisma.rentReminder.findMany({
      where: { rentalId: { in: rentalIds }, day: dateFromISO(a.today)! },
      orderBy: [{ slot: 'asc' }],
      select: { rentalId: true, slot: true, template: true, mode: true },
    }),
    prisma.rental.findMany({ where: { id: { in: rentalIds } }, select: { id: true, remindersOffReason: true } }),
  ]);
  // «Пора звонить» is the rule's, with nothing about the slot in it.
  const plan = await planReminders(a, '12:00');
  const call = new Map(plan.map((p) => [p.rentalId, p.call]));
  const out: Record<string, RentalReminders> = {};
  for (const r of offs) {
    out[r.id] = {
      today: rows.filter((x) => x.rentalId === r.id).map((x) => ({ slot: x.slot as ReminderSlot, template: x.template as RentalReminders['today'][number]['template'], mode: x.mode as RentalReminders['today'][number]['mode'] })),
      call: call.get(r.id) ?? false,
      off: r.remindersOffReason,
    };
  }
  return out;
}

/** The slot of this moment, Tbilisi time. */
export function slotNow(now: Date = new Date()): ReminderSlot {
  return slotOf(Number(new Intl.DateTimeFormat('en-GB', { timeZone: env.TZ, hour: '2-digit', hourCycle: 'h23' }).format(now)));
}
