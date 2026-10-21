// How long a moped stood in repair, in hours (stage 6 of
// docs/spec/mechanic-in-erp-plan.md; ADR-0038 §5): from the minute the repair
// opened to the minute it closed, and apart from that the wait for the
// approval — to the first approval, or to the refusal. Worked out from the
// minutes the repair carries, never from its days: a repair with no minute of
// opening (before stage 2) or a day written in afterwards has no hours, and
// says so, rather than a figure made up from its days (CLAUDE.md rule 1).
import { addDays, dayStart, minutesBetween, todayISO } from './time.js';
import { ORG_TZ, type ISODate } from './types.js';

/** What a repair carries about its time. */
export interface RepairClock {
  status: string;
  openedOn: ISODate;
  closedOn: ISODate | null;
  openedAt: Date | string | null;
  approvedAt: Date | string | null;
  rejectedAt: Date | string | null;
  closedAt: Date | string | null;
}

export interface RepairDowntime {
  /** From opening to closing — or to now, while it runs. */
  minutes: number;
  /** Of that, waiting for the approval. */
  waitMinutes: number;
  /** Still open or waiting: the minutes go on. */
  running: boolean;
}

export interface PeriodDowntime {
  /** Minutes in repair within the period, summed over the repairs. */
  minutes: number;
  waitMinutes: number;
  /** Repairs whose minutes are in the sums. */
  counted: number;
  /** Repairs in the period by their days whose hours are not known: «нет данных», never nought. */
  unknown: number;
}

const at = (x: Date | string): Date => (typeof x === 'string' ? new Date(x) : x);
const closed = (status: string) => status === 'done' || status === 'cancelled';

/** The instants the repair stood from and to, and the wait's end; null when its hours cannot be known. */
function span(job: RepairClock, now: Date, tz: string): { from: number; to: number; waitTo: number; running: boolean } | null {
  if (job.openedAt == null) return null;
  const opened = at(job.openedAt);
  // The day was written in afterwards (an owner may say when it opened or
  // closed): the minute is not when the moped came in, so there are no hours.
  if (todayISO(opened, tz) !== job.openedOn) return null;
  const done = closed(job.status);
  if (done && (job.closedAt == null || job.closedOn == null || todayISO(at(job.closedAt), tz) !== job.closedOn)) return null;
  const from = opened.getTime();
  const to = Math.max(from, done ? at(job.closedAt!).getTime() : now.getTime());
  // The first approval let the work start; a repair still waiting waits now;
  // a refused one waited until it was refused; one opened in work never did.
  const waitTo = job.approvedAt != null ? at(job.approvedAt).getTime() : job.status === 'draft' ? now.getTime() : job.rejectedAt != null ? at(job.rejectedAt).getTime() : from;
  return { from, to, waitTo: Math.min(Math.max(from, waitTo), to), running: !done };
}

/** The hours of one repair, or null when they cannot be known. */
export function repairDowntime(job: RepairClock, now: Date, tz: string = ORG_TZ): RepairDowntime | null {
  const s = span(job, now, tz);
  if (!s) return null;
  return { minutes: minutesBetween(new Date(s.from), new Date(s.to)), waitMinutes: minutesBetween(new Date(s.from), new Date(s.waitTo)), running: s.running };
}

/**
 * The repairs' hours within the Tbilisi days `fromDay`…`toDay`, each repair
 * cut to them. A repair called off by mistake — cancelled, not refused — never
 * stood and is left out; a refused one stood while it waited and counts.
 */
export function downtimeInPeriod(jobs: readonly RepairClock[], fromDay: ISODate, toDay: ISODate, now: Date, tz: string = ORG_TZ): PeriodDowntime {
  const start = dayStart(fromDay, tz).getTime();
  const end = dayStart(addDays(toDay, 1), tz).getTime();
  const clip = (a: number, b: number) => Math.max(0, Math.floor((Math.min(b, end) - Math.max(a, start)) / 60_000));
  const out: PeriodDowntime = { minutes: 0, waitMinutes: 0, counted: 0, unknown: 0 };
  for (const j of jobs) {
    if (j.status === 'cancelled' && j.rejectedAt == null) continue;
    const s = span(j, now, tz);
    if (!s) {
      // In the period by its days, with no hours to give.
      if (j.openedOn <= toDay && (j.closedOn == null || j.closedOn >= fromDay)) out.unknown++;
      continue;
    }
    const inside = s.from < end && (s.to > start || (s.to === s.from && s.from >= start));
    if (!inside) continue;
    out.counted++;
    out.minutes += clip(s.from, s.to);
    out.waitMinutes += clip(s.from, s.waitTo);
  }
  return out;
}
