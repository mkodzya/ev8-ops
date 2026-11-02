import {
  REMINDER_AMOUNT_FIELD,
  REMINDER_BOT_KEYS,
  REMINDER_SEND_MODES,
  callDue,
  kommoLeadId,
  reminderAmountText,
  reminderFor,
  schedulePayOf,
  slotOf,
  templateLang,
  todayISO,
  type ISODate,
  type PaymentsCalendar,
  type ReminderBotKey,
  type ReminderDecision,
  type ReminderFailure,
  type ReminderSendMode,
  type ReminderSlot,
  type ReminderTemplate,
  type RentalReminders,
} from '@ev8/shared';
import { dateFromISO, isoDate } from './dates.js';
import { prisma } from './db.js';
import { env } from './env.js';
import { isUniqueViolation } from './errors.js';
import { KommoError, kommoClient, kommoConfig, type KommoField } from './kommo.js';

// The rent reminders' data side (issue #20 of the director, ADR-0052). The
// rule is shared (`packages/shared/src/reminders.ts`); here it is read against
// «Оплаты по графику» — the one rule of who is late and who pays today since
// issue #18, the credit the night will place counted — and what it decides is
// written down. Step 1 sent nothing: every row was `dry_run`.
//
// Step 2 (ADR-0053) sends through Kommo: the sum goes into the deal's
// «Amount due», is read back, and only then is the bot of that template and
// language started. How far a stand sends is its own (REMINDERS_SEND: off,
// test, on) — the test stand holds a copy of production's customers — and an
// owner can pause every stand from the screen. Kommo's template with an empty
// field sends the sample Meta approved, so no sum read back, no bot.

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

// ── Sending ─────────────────────────────────────────────────────────────

/** How far this stand sends (ADR-0053): its env file says; said nothing, or nonsense — nothing is sent. */
export function reminderSendMode(e: NodeJS.ProcessEnv = process.env): ReminderSendMode {
  const v = (e.REMINDERS_SEND ?? '').trim().toLowerCase();
  return (REMINDER_SEND_MODES as readonly string[]).includes(v) ? (v as ReminderSendMode) : 'off';
}

/** What a screen says of sending: the stand's mode, unless an owner paused it. */
export async function reminderSending(): Promise<ReminderSendMode | 'paused'> {
  const mode = reminderSendMode();
  return mode !== 'off' && (await reminderSettings()).paused ? 'paused' : mode;
}

/** The owner's side of sending, as the screen and the job read it. */
export interface ReminderSettingsView {
  paused: boolean;
  bots: Partial<Record<ReminderBotKey, number>>;
  testLeads: string[];
  updatedAt: Date;
  updatedById: string | null;
}

/** The bots as kept: a key that is not one of the six, or a number that is not a bot's, is not read. */
export function botsOf(json: unknown): Partial<Record<ReminderBotKey, number>> {
  const raw = json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
  const out: Partial<Record<ReminderBotKey, number>> = {};
  for (const k of REMINDER_BOT_KEYS) {
    const v = raw[k];
    if (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) out[k] = v;
  }
  return out;
}

/** The one row, made on the first read if the migration's row ever went missing. */
export async function reminderSettings(): Promise<ReminderSettingsView> {
  const row = (await prisma.reminderSettings.findUnique({ where: { id: true } })) ?? (await prisma.reminderSettings.upsert({ where: { id: true }, create: { id: true }, update: {} }));
  return { paused: row.paused, bots: botsOf(row.bots), testLeads: row.testLeads, updatedAt: row.updatedAt, updatedById: row.updatedById };
}

/**
 * The Kommo deal each rental's reminder goes to: the rental's own link; else
 * its customer's; else the one deal of the rented stage the poll tied to that
 * customer (ADR-0015). Two such deals and no link — none: which of them is
 * this rental is a question for a person.
 */
export async function reminderLeads(rentalIds: string[]): Promise<Map<string, string | null>> {
  if (rentalIds.length === 0) return new Map();
  const rows = await prisma.rental.findMany({ where: { id: { in: rentalIds } }, select: { id: true, kommoRef: true, customerId: true, customer: { select: { kommoRef: true } } } });
  const tied = await prisma.kommoLead.findMany({ where: { kind: 'rent', customerId: { in: [...new Set(rows.map((r) => r.customerId))] } }, select: { leadId: true, customerId: true } });
  const byCustomer = new Map<string, string[]>();
  for (const l of tied) if (l.customerId) byCustomer.set(l.customerId, [...(byCustomer.get(l.customerId) ?? []), l.leadId]);
  return new Map(
    rows.map((r) => {
      const own = byCustomer.get(r.customerId) ?? [];
      return [r.id, kommoLeadId(r.kommoRef) ?? kommoLeadId(r.customer.kommoRef) ?? (own.length === 1 ? own[0]! : null)];
    }),
  );
}

/** Kommo's refusals that are the account's, not one deal's: after one, the run asks Kommo nothing more. */
const STOPS_THE_RUN = new Set<ReminderFailure>(['unauthorized', 'rate_limited', 'network']);

/** The sum Kommo gave back is the sum written: «320» and 320, «320.50» and 320.5 are the same. */
function sameAmount(back: string, written: string): boolean {
  const a = Number(back.replace(',', '.'));
  const b = Number(written);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round(a * 100) === Math.round(b * 100) : back.trim() === written;
}

export interface RemindersOutcome {
  decided: number;
  written: number;
  /** The stand's REMINDERS_SEND. */
  sendMode: ReminderSendMode;
  /** Why this run sent nothing although the stand sends: an owner paused it, or the run was for another day. */
  held: 'paused' | 'not_today' | null;
  sent: number;
  failed: number;
}

/**
 * The job at 12:00 and at 18:00 (the worker's clock): what goes at this slot,
 * written once — a second run of the same slot finds it written and sends
 * nothing again. A row is claimed (`sending`) before Kommo is asked, so two
 * runs at once cannot both send it. Counts only in the answer: no name, no
 * phone, no sum.
 */
export async function runReminders(a: CalendarNow, slot: ReminderSlot, now: Date = new Date()): Promise<RemindersOutcome> {
  const plan = (await planReminders(a, slot)).filter((p) => p.decision.send);
  const day = dateFromISO(a.today)!;
  const sendMode = reminderSendMode();
  const settings = await reminderSettings();
  // Never for a day that is not today: `asOf` is for trying the rule, and a sum of another day is not today's debt.
  const held = sendMode === 'off' ? null : settings.paused ? 'paused' : todayISO(now, env.TZ) !== a.today ? 'not_today' : null;
  const templateOf = (p: PlannedReminder): ReminderTemplate => (p.decision.send ? p.decision.template : 'payment_due');
  const row = (p: PlannedReminder) => ({ rentalId: p.rentalId, day, slot, template: templateOf(p), lang: p.lang, amountTetri: p.amountTetri });

  if (sendMode === 'off' || held) {
    const res = await prisma.rentReminder.createMany({ data: plan.map((p) => ({ ...row(p), mode: 'dry_run' })), skipDuplicates: true });
    return { decided: plan.length, written: res.count, sendMode, held, sent: 0, failed: 0 };
  }

  const leads = await reminderLeads(plan.map((p) => p.rentalId));
  const cfg = kommoConfig();
  const client = cfg ? kommoClient(cfg) : null;
  const amountFieldId = cfg?.amountFieldId ?? 0;
  let field: KommoField | null | undefined; // undefined — not asked yet
  let stop: ReminderFailure | null = null;
  const out: RemindersOutcome = { decided: plan.length, written: 0, sendMode, held: null, sent: 0, failed: 0 };

  const sendOne = async (p: PlannedReminder, lead: string | null): Promise<ReminderFailure | null> => {
    if (!client) return 'kommo_off';
    if (!lead) return 'no_deal';
    const botId = settings.bots[`${templateOf(p)}.${p.lang}`];
    if (!botId) return 'no_bot';
    if (stop) return stop;
    try {
      if (field === undefined) field = await client.leadField(amountFieldId, REMINDER_AMOUNT_FIELD);
      if (!field) return 'no_field';
      const text = reminderAmountText(p.amountTetri);
      await client.setLeadField(lead, field, text);
      // Read back before the bot: an empty or stale field sends a sum that is not his.
      const back = await client.leadFieldValue(lead, field.id);
      if (back === undefined) return 'deal_gone';
      if (back === null || !sameAmount(back, text)) return 'not_written';
      await client.runBot(botId, lead);
      return null;
    } catch (err) {
      if (!(err instanceof KommoError)) throw err;
      if (STOPS_THE_RUN.has(err.failure)) stop = err.failure;
      return err.failure;
    }
  };

  for (const p of plan) {
    const lead = leads.get(p.rentalId) ?? null;
    // A stand in `test` sends to the test deals an owner listed and to nobody else.
    if (sendMode === 'test' && !(lead && settings.testLeads.includes(lead))) {
      out.written += (await prisma.rentReminder.createMany({ data: [{ ...row(p), mode: 'dry_run' }], skipDuplicates: true })).count;
      continue;
    }
    let id: string;
    try {
      id = (await prisma.rentReminder.create({ data: { ...row(p), mode: 'sending', leadId: lead }, select: { id: true } })).id;
    } catch (err) {
      if (isUniqueViolation(err)) continue; // this slot of this rental is already written
      throw err;
    }
    out.written++;
    let failure: ReminderFailure | null;
    try {
      failure = await sendOne(p, lead);
    } catch (err) {
      await prisma.rentReminder.update({ where: { id }, data: { mode: 'failed', failure: 'interrupted' } });
      throw err;
    }
    await prisma.rentReminder.update({ where: { id }, data: failure ? { mode: 'failed', failure } : { mode: 'sent', sentAt: new Date() } });
    if (failure) out.failed++;
    else out.sent++;
  }
  return out;
}

/**
 * What «К звонку» says of each rental beside its row: the reminders of today,
 * «пора звонить», and a switch-off with its reason. One read for every rental
 * the answer names.
 */
export async function remindersOfToday(a: CalendarNow, rentalIds: string[]): Promise<Record<string, RentalReminders>> {
  if (rentalIds.length === 0) return {};
  const [rows, offs, leads] = await Promise.all([
    prisma.rentReminder.findMany({
      where: { rentalId: { in: rentalIds }, day: dateFromISO(a.today)! },
      orderBy: [{ slot: 'asc' }],
      select: { rentalId: true, slot: true, template: true, mode: true, failure: true },
    }),
    prisma.rental.findMany({ where: { id: { in: rentalIds } }, select: { id: true, remindersOffReason: true } }),
    reminderLeads(rentalIds),
  ]);
  // «Пора звонить» is the rule's, with nothing about the slot in it.
  const plan = await planReminders(a, '12:00');
  const call = new Map(plan.map((p) => [p.rentalId, p.call]));
  const out: Record<string, RentalReminders> = {};
  for (const r of offs) {
    out[r.id] = {
      today: rows
        .filter((x) => x.rentalId === r.id)
        .map((x) => ({
          slot: x.slot as ReminderSlot,
          template: x.template as RentalReminders['today'][number]['template'],
          mode: x.mode as RentalReminders['today'][number]['mode'],
          failure: x.failure as ReminderFailure | null,
        })),
      call: call.get(r.id) ?? false,
      off: r.remindersOffReason,
      deal: leads.get(r.id) != null,
    };
  }
  return out;
}

/** The slot of this moment, Tbilisi time. */
export function slotNow(now: Date = new Date()): ReminderSlot {
  return slotOf(Number(new Intl.DateTimeFormat('en-GB', { timeZone: env.TZ, hour: '2-digit', hourCycle: 'h23' }).format(now)));
}
