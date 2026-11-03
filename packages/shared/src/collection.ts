// «Взыскание» — what happens after the reminders (the director's scenario of
// 03.11.2026; Mika's answers the same day; ADR-0054). The reminders go on the
// payment day and the 1st and 2nd day late (ADR-0052, ADR-0053). From the 3rd
// day a manager calls the customer and looks where the moped is in the
// tracker's app; a customer who does not get in touch within a day has the
// moped blocked in the tracker and picked up by a manager. One who promised to
// pay by a day is waited for until that day — they are late, but they pay
// (Mika) — and called again after it. Paid at any step: the ladder stops.
//
// The rule is here, pure, so «Сегодня» and the rental's card say the same.
// EV8 Ops sees neither the GPS nor the block: a person does both in the
// tracker's app and writes down here what they did.
import { reminderStage } from './reminders.js';
import { addDays } from './time.js';
import type { ISODate } from './types.js';
import type { Tetri } from './money.js';

/** What a call came to. */
export const COLLECTION_OUTCOMES = ['paid_today', 'promised', 'refuses', 'no_answer'] as const;
export type CollectionOutcome = (typeof COLLECTION_OUTCOMES)[number];

/** What the tracker showed at the call. */
export const COLLECTION_GPS = ['still', 'moving', 'unseen'] as const;
export type CollectionGps = (typeof COLLECTION_GPS)[number];

/** What a person wrote down: a call, or the moped blocked or unblocked in the tracker. */
export const COLLECTION_KINDS = ['call', 'blocked', 'unblocked'] as const;
export type CollectionKind = (typeof COLLECTION_KINDS)[number];

/** The day of the chain the ladder starts on: after the payment day and the two days of reminders. */
export const COLLECTION_FROM_STAGE = 3;

/**
 * Where a rental stands:
 * - `call` — call and look at the GPS; write down how it went;
 * - `waiting` — promised to pay by `until` (or today): nothing to do until then;
 * - `block` — did not get in touch since a call that failed: block and pick up;
 * - `pickup` — blocked, still owing: a manager picks the moped up, the return act closes it;
 * - `unblock` — blocked, and has paid since: take the block off in the tracker.
 */
export type CollectionStep = 'call' | 'waiting' | 'block' | 'pickup' | 'unblock';

export interface CollectionEvent {
  kind: CollectionKind;
  /** The Tbilisi day it was written on. */
  on: ISODate;
  outcome?: CollectionOutcome | null;
  promisedOn?: ISODate | null;
}

export interface CollectionFacts {
  /** The EFFECTIVE status, as «Оплаты по графику» says it (`statusBySchedule`). */
  status: string;
  pickedUpOn: ISODate | null;
  /** The day the oldest unpaid week was due (the late `sinceOn`); null — nothing late. */
  dueOn: ISODate | null;
  owesTetri: Tetri;
  /** Reminders switched off by a person, with a reason (MSG-02): the ladder stays off too. */
  off: boolean;
  /** Everything written for this rental, oldest first. */
  events: CollectionEvent[];
}

export interface CollectionState {
  step: CollectionStep;
  /** The day of the chain (holidays not counted, as the reminders count them); null on `pickup` and `unblock`. */
  stage: number | null;
  /** `waiting`: the day it waits for. */
  until?: ISODate;
  /** `pickup`, `unblock`: the day the block was written. */
  blockedOn?: ISODate;
}

/** The chain's day today, or on the last day that counted when today is a holiday. */
function stageOn(dueOn: ISODate, today: ISODate): number | null {
  let day = today;
  for (let i = 0; i < 14 && day >= dueOn; i++) {
    const s = reminderStage(dueOn, day);
    if (s != null) return s;
    day = addDays(day, -1);
  }
  return null;
}

/** Whether the last of the block marks is «blocked», and since when. */
export function blockedSince(events: CollectionEvent[]): ISODate | null {
  const marks = events.filter((e) => e.kind === 'blocked' || e.kind === 'unblocked');
  const last = marks[marks.length - 1];
  return last?.kind === 'blocked' ? last.on : null;
}

/** Where the rental stands on the ladder today; null — nothing to do. */
export function collectionStep(f: CollectionFacts, today: ISODate): CollectionState | null {
  const owing = f.status === 'overdue' && f.owesTetri > 0;
  // A block outlives the debt it was for: paid since, it is still to be taken off.
  const blockedOn = blockedSince(f.events);
  if (blockedOn) return { step: owing ? 'pickup' : 'unblock', stage: null, blockedOn };

  if (!owing || !f.dueOn || f.off || f.pickedUpOn === today) return null;
  const stage = stageOn(f.dueOn, today);
  if (stage == null || stage < COLLECTION_FROM_STAGE) return null;

  // Only what was said about this debt: calls from the day it fell due.
  let calls = f.events.filter((e) => e.kind === 'call' && e.on >= f.dueOn!);
  // A promise — or «pays today» — is waited for; after its day the calls start over.
  const lastWord = calls.map((c) => c.outcome).lastIndexOf('promised');
  const lastToday = calls.map((c) => c.outcome).lastIndexOf('paid_today');
  const i = Math.max(lastWord, lastToday);
  if (i >= 0) {
    const c = calls[i]!;
    const until = c.outcome === 'promised' && c.promisedOn ? c.promisedOn : c.on;
    if (today <= until) return { step: 'waiting', stage, until };
    calls = calls.slice(i + 1);
  }
  // Did not get in touch within a day: a call that failed on an earlier day.
  const failed = calls.some((c) => (c.outcome === 'no_answer' || c.outcome === 'refuses') && c.on < today);
  return { step: failed ? 'block' : 'call', stage };
}
