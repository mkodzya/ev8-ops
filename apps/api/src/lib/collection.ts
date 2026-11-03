import { collectionStep, schedulePayOf, type CollectionEvent, type CollectionState, type ISODate, type PaymentsCalendar } from '@ev8/shared';
import { isoDate } from './dates.js';
import { prisma } from './db.js';

// «Взыскание» — the data side (ADR-0054). The rule is shared
// (`packages/shared/src/collection.ts`); here it is read against «Оплаты по
// графику», the one rule of who is late since issue #18, and against what
// people wrote down: calls, and the moped blocked or unblocked in the
// tracker's app. EV8 Ops does neither itself.

type CalendarNow = Pick<PaymentsCalendar, 'today' | 'entries' | 'late'>;

export interface CollectionNow {
  state: CollectionState;
  /** Calendar days since the oldest unpaid week fell due, as «Просрочки» says it; null — not late. */
  lateDays: number | null;
  debtTetri: number;
}

const RUNNING = ['active', 'overdue'] as const;

/**
 * Every rental on the ladder today: the late ones «Оплаты по графику» names,
 * and the ones still marked blocked — a block outlives the debt it was for.
 */
export async function collectionNow(a: CalendarNow): Promise<Map<string, CollectionNow>> {
  const pay = schedulePayOf(a);
  const late = new Map(a.late.rentals.map((l) => [l.rentalId, l]));
  const lateIds = [...pay.entries()].filter(([, p]) => p.state === 'overdue').map(([id]) => id);
  const marked = await prisma.collectionEvent.findMany({ where: { kind: 'blocked', rental: { status: { in: [...RUNNING] } } }, select: { rentalId: true } });
  const ids = [...new Set([...lateIds, ...marked.map((m) => m.rentalId)])];
  if (ids.length === 0) return new Map();
  const [rows, events] = await Promise.all([
    prisma.rental.findMany({ where: { id: { in: ids }, status: { in: [...RUNNING] } }, select: { id: true, pickedUpOn: true, remindersOffReason: true } }),
    prisma.collectionEvent.findMany({ where: { rentalId: { in: ids } }, orderBy: { createdAt: 'asc' }, select: { rentalId: true, kind: true, day: true, outcome: true, promisedOn: true } }),
  ]);
  const byRental = new Map<string, CollectionEvent[]>();
  for (const e of events) {
    const list = byRental.get(e.rentalId) ?? [];
    list.push({ kind: e.kind as CollectionEvent['kind'], on: isoDate(e.day) as ISODate, outcome: (e.outcome as CollectionEvent['outcome']) ?? null, promisedOn: e.promisedOn ? (isoDate(e.promisedOn) as ISODate) : null });
    byRental.set(e.rentalId, list);
  }
  const out = new Map<string, CollectionNow>();
  for (const r of rows) {
    const l = late.get(r.id);
    const p = pay.get(r.id);
    const state = collectionStep(
      {
        status: p?.state ?? 'active',
        pickedUpOn: r.pickedUpOn ? (isoDate(r.pickedUpOn) as ISODate) : null,
        dueOn: l?.sinceOn ?? null,
        owesTetri: l?.debtTetri ?? 0,
        off: r.remindersOffReason != null,
        events: byRental.get(r.id) ?? [],
      },
      a.today,
    );
    if (state) out.set(r.id, { state, lateDays: l?.days ?? null, debtTetri: l?.debtTetri ?? 0 });
  }
  return out;
}

/** What the rental's card says under «Взыскание»: the step, what was written, and the moped's tracker. */
export interface CollectionCard {
  state: CollectionState | null;
  lateDays: number | null;
  debtTetri: number;
  events: { kind: string; day: string | null; outcome: string | null; promisedOn: string | null; gps: string | null; place: string | null; note: string | null; by: string | null; at: string }[];
  /** The tracker on the moped now, by the last four of its IMEI — it is looked up in the tracker's app. */
  tracker: { imeiTail: string; sim: boolean } | null;
}

/** Null when the rental is not on the ladder and nothing was ever written for it. */
export async function collectionCard(rentalId: string, vehicleId: string | null, now: CollectionNow | null): Promise<CollectionCard | null> {
  const [events, tracker] = await Promise.all([
    prisma.collectionEvent.findMany({ where: { rentalId }, orderBy: { createdAt: 'desc' }, take: 20, include: { createdBy: { select: { name: true } } } }),
    vehicleId ? prisma.vehicleTracker.findFirst({ where: { vehicleId, removedOn: null }, orderBy: { installedOn: 'desc' }, select: { imei: true, simPhone: true } }) : null,
  ]);
  if (!now && events.length === 0) return null;
  return {
    state: now?.state ?? null,
    lateDays: now?.lateDays ?? null,
    debtTetri: now?.debtTetri ?? 0,
    events: events.map((e) => ({
      kind: e.kind,
      day: isoDate(e.day),
      outcome: e.outcome,
      promisedOn: isoDate(e.promisedOn),
      gps: e.gps,
      place: e.place,
      note: e.note,
      by: e.createdBy.name,
      at: e.createdAt.toISOString(),
    })),
    tracker: tracker ? { imeiTail: tracker.imei.slice(-4), sim: Boolean(tracker.simPhone?.trim()) } : null,
  };
}
