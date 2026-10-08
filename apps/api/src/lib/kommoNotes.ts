// The Kommo link, step 2: a payment taken here becomes a note in the deal
// (Mika, 08.10.2026; ADR-0013).
//
// Until now the staff took a payment and typed "01.10 — 150" into the Kommo
// deal by hand; that note was the only record there was. From the day the
// business runs in EV8 Ops the payment is entered here, and typing it into
// Kommo a second time is how the two start to disagree. So EV8 Ops writes
// the note itself.
//
// How, and why this way:
//   · Nothing hooks into the places a payment is made (the money form, a
//     bank line sorted, the hand-over's first payment). Every few minutes
//     this walks the payments and asks which of them has no note yet. The
//     payments are the truth and the list of notes is derived from them, so
//     a new way of taking money cannot forget to tell Kommo.
//   · A note is owed for a payment that came in for a rental (rent, deposit,
//     charges). Sales are not kept in Kommo, and money moved out of a deposit
//     is not money that came.
//   · The deal is the rental's Kommo link, or its customer's — the same rule
//     the comparison uses. No deal, no note: the row says so and stays.
//   · Kommo not answering is not a reason to lose a note: it stays `pending`
//     and goes out on a later walk. Kommo refusing one note (a deal that was
//     deleted) is: that row is `refused`, the owner sees it, the walk goes on.
//   · A payment voided before its note left never sends one; voided after,
//     it sends a second note that takes the first back. Nothing in Kommo is
//     edited or deleted.
//
// Writing is off unless the stand says otherwise (`KOMMO_WRITE`): a stand
// that is being tried out talks to the real Kommo account, and a trial
// payment must not land in a real customer's deal. Payments made before
// writing was first switched on are never written at all.
//
// A note carries a sum and a staff member's name, so its text is never
// logged; what is logged and returned is counts and our own words.

import { kommoLeadId, kommoMayWriteTo, paymentNoteText, paymentVoidNoteText } from '@ev8/shared';
import { isoDate } from './dates.js';
import { prisma } from './db.js';
import { KommoError, kommoClient, kommoConfig, type KommoConfig, type KommoFailure } from './kommo.js';

/** Payments looked at per walk, and notes sent per walk (about four seconds at the client's pace). */
const QUEUE_BATCH = 100;
const SEND_BATCH = 25;

export type KommoNotesOutcome =
  | { status: 'off' }
  | { status: 'busy' }
  | { status: 'ok'; queued: number; sent: number; refused: number; waiting: number }
  | { status: 'failed'; failure: KommoFailure; httpStatus: number | null; queued: number; sent: number; refused: number; waiting: number };

let running: Promise<KommoNotesOutcome> | null = null;

/**
 * One walk: note down what is owed, then send what is waiting. Never throws
 * for Kommo's sake.
 */
export function deliverKommoNotes(now: Date = new Date()): Promise<KommoNotesOutcome> {
  const cfg = kommoConfig();
  if (!cfg || cfg.write.kind === 'off') return Promise.resolve({ status: 'off' });
  if (running) return Promise.resolve({ status: 'busy' });
  running = walk(cfg, now).finally(() => {
    running = null;
  });
  return running;
}

async function walk(cfg: KommoConfig, now: Date): Promise<KommoNotesOutcome> {
  // The moment writing first came on here. Nothing older is ever written.
  const sync = await prisma.kommoSync.upsert({ where: { id: true }, update: {}, create: { id: true } });
  const from = sync.notesFrom ?? now;
  if (!sync.notesFrom) await prisma.kommoSync.update({ where: { id: true }, data: { notesFrom: from } });

  const queued = (await queuePayments(cfg, from)) + (await queueVoids(cfg));

  const client = kommoClient(cfg);
  const pending = await prisma.kommoNote.findMany({ where: { state: 'pending' }, orderBy: { createdAt: 'asc' }, take: SEND_BATCH });
  let sent = 0;
  let refused = 0;
  let stopped: { failure: KommoFailure; httpStatus: number | null } | null = null;
  for (const note of pending) {
    try {
      const made = await client.addLeadNote(note.leadId ?? '', note.body ?? '');
      await prisma.kommoNote.update({ where: { id: note.id }, data: { state: 'sent', sentAt: now, kommoNoteId: made.noteId, attempts: note.attempts + 1, reason: null, httpStatus: null } });
      sent++;
    } catch (err) {
      if (!(err instanceof KommoError)) throw err;
      const tried = { attempts: note.attempts + 1, reason: err.failure, httpStatus: err.httpStatus };
      const status = err.httpStatus ?? 0;
      if (err.failure === 'bad_answer' && status >= 200 && status < 300) {
        // Kommo took it and answered with something unreadable: the note is there.
        await prisma.kommoNote.update({ where: { id: note.id }, data: { state: 'sent', sentAt: now, attempts: note.attempts + 1, reason: null, httpStatus: null } });
        sent++;
      } else if ((err.failure === 'http' && status >= 400 && status < 500) || (err.failure === 'bad_answer' && !err.httpStatus)) {
        // This note, not Kommo as a whole: a deal that is gone, a text it will not take.
        await prisma.kommoNote.update({ where: { id: note.id }, data: { ...tried, state: 'refused' } });
        refused++;
      } else {
        // Kommo as a whole: the token, the line, the limit. Everything waits.
        await prisma.kommoNote.update({ where: { id: note.id }, data: tried });
        stopped = { failure: err.failure, httpStatus: err.httpStatus };
        break;
      }
    }
  }
  const waiting = await prisma.kommoNote.count({ where: { state: 'pending' } });
  return stopped ? { status: 'failed', ...stopped, queued, sent, refused, waiting } : { status: 'ok', queued, sent, refused, waiting };
}

/** A row for every payment that came in for a rental since writing came on and has none yet. */
async function queuePayments(cfg: KommoConfig, from: Date): Promise<number> {
  const payments = await prisma.payment.findMany({
    where: { createdAt: { gte: from }, direction: 'in', kind: { in: ['rent', 'on_account'] }, kommoNotes: { none: { kind: 'payment' } } },
    orderBy: { createdAt: 'asc' },
    take: QUEUE_BATCH,
    select: {
      id: true,
      occurredOn: true,
      channel: true,
      grossTetri: true,
      rentalId: true,
      voidedAt: true,
      createdBy: { select: { name: true } },
      allocations: { select: { target: true, amountTetri: true, period: { select: { rentalId: true } }, deposit: { select: { rentalId: true } }, charge: { select: { rentalId: true } } } },
    },
  });

  let queued = 0;
  for (const p of payments) {
    const row = (data: { state: string; reason?: string; rentalId?: string | null; leadId?: string | null; body?: string }) =>
      prisma.kommoNote.create({ data: { kind: 'payment', paymentId: p.id, rentalId: null, ...data } });

    const rentalOf = (a: (typeof p.allocations)[number]) => a.period?.rentalId ?? a.deposit?.rentalId ?? a.charge?.rentalId ?? null;
    const touched = [...new Set(p.allocations.map(rentalOf).filter((id): id is string => !!id))];
    // The rental the payment was made for; without one, the only rental it closed anything on.
    const rentalId = p.rentalId ?? (touched.length === 1 ? touched[0]! : null);
    if (!rentalId) {
      await row({ state: 'skipped', reason: 'no_single_rental' });
      continue;
    }
    if (p.channel === 'deposit') {
      // Rent taken out of a deposit: no money came.
      await row({ state: 'skipped', reason: 'from_deposit', rentalId });
      continue;
    }
    const rental = await prisma.rental.findUnique({ where: { id: rentalId }, select: { number: true, kommoRef: true, paidThrough: true, customer: { select: { kommoRef: true } } } });
    const leadId = rental ? (kommoLeadId(rental.kommoRef) ?? kommoLeadId(rental.customer.kommoRef)) : null;
    if (!rental || !leadId) {
      await row({ state: 'skipped', reason: 'no_deal', rentalId });
      continue;
    }
    if (!kommoMayWriteTo(cfg.write, leadId)) {
      await row({ state: 'skipped', reason: 'not_a_test_deal', rentalId, leadId });
      continue;
    }
    if (p.voidedAt) {
      await row({ state: 'cancelled', reason: 'voided', rentalId, leadId });
      continue;
    }
    const sum = (target: string) => p.allocations.filter((a) => a.target === target && rentalOf(a) === rentalId).reduce((n, a) => n + a.amountTetri, 0);
    const body = paymentNoteText(
      {
        rentalNumber: rental.number,
        occurredOn: isoDate(p.occurredOn)!,
        channel: p.channel,
        grossTetri: p.grossTetri,
        rentTetri: sum('period'),
        depositTetri: sum('deposit'),
        chargesTetri: sum('charge'),
        paidThrough: isoDate(rental.paidThrough),
        takenBy: p.createdBy?.name ?? null,
      },
      cfg.noteLocale,
    );
    await row({ state: 'pending', rentalId, leadId, body });
    queued++;
  }
  return queued;
}

/**
 * Payments voided since their note was written. One whose note has not left
 * yet simply never sends it; one whose note is in Kommo gets a second note
 * that says the first no longer stands.
 */
async function queueVoids(cfg: KommoConfig): Promise<number> {
  await prisma.kommoNote.updateMany({ where: { kind: 'payment', state: 'pending', payment: { voidedAt: { not: null } } }, data: { state: 'cancelled', reason: 'voided' } });

  const sentAndVoided = await prisma.kommoNote.findMany({
    where: { kind: 'payment', state: 'sent', payment: { voidedAt: { not: null }, kommoNotes: { none: { kind: 'payment_void' } } } },
    take: QUEUE_BATCH,
    select: { paymentId: true, rentalId: true, leadId: true, payment: { select: { occurredOn: true, grossTetri: true, voidReason: true, voidedBy: { select: { name: true } } } } },
  });
  let queued = 0;
  for (const n of sentAndVoided) {
    const rental = n.rentalId ? await prisma.rental.findUnique({ where: { id: n.rentalId }, select: { number: true, paidThrough: true } }) : null;
    if (!rental || !n.leadId) {
      await prisma.kommoNote.create({ data: { kind: 'payment_void', paymentId: n.paymentId, rentalId: n.rentalId, leadId: n.leadId, state: 'skipped', reason: 'no_deal' } });
      continue;
    }
    const body = paymentVoidNoteText(
      { rentalNumber: rental.number, occurredOn: isoDate(n.payment.occurredOn)!, grossTetri: n.payment.grossTetri, reason: n.payment.voidReason, paidThrough: isoDate(rental.paidThrough), voidedBy: n.payment.voidedBy?.name ?? null },
      cfg.noteLocale,
    );
    await prisma.kommoNote.create({ data: { kind: 'payment_void', paymentId: n.paymentId, rentalId: n.rentalId, leadId: n.leadId, state: 'pending', body } });
    queued++;
  }
  return queued;
}

// ── What the owner is shown ─────────────────────────────────────────────

export interface KommoNotesState {
  /** `off` — this stand writes nothing; `all` — every deal; `only` — test deals. */
  mode: 'off' | 'all' | 'only';
  sent: number;
  waiting: number;
  /** Notes that will not go by themselves: Kommo refused them, or the rental names no deal. */
  stuck: { id: string; paymentId: string; rentalId: string | null; rentalNumber: string | null; customer: string | null; why: 'refused' | 'no_deal'; httpStatus: number | null; createdAt: Date }[];
}

export async function kommoNotesState(): Promise<KommoNotesState | null> {
  const cfg = kommoConfig();
  if (!cfg) return null;
  const [sent, waiting, rows] = await Promise.all([
    prisma.kommoNote.count({ where: { state: 'sent' } }),
    prisma.kommoNote.count({ where: { state: 'pending' } }),
    prisma.kommoNote.findMany({
      where: { OR: [{ state: 'refused' }, { state: 'skipped', reason: 'no_deal' }] },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, paymentId: true, rentalId: true, state: true, httpStatus: true, createdAt: true },
    }),
  ]);
  const rentals = await prisma.rental.findMany({ where: { id: { in: rows.map((r) => r.rentalId).filter((id): id is string => !!id) } }, select: { id: true, number: true, customer: { select: { name: true } } } });
  const rentalOf = new Map(rentals.map((r) => [r.id, r]));
  return {
    mode: cfg.write.kind,
    sent,
    waiting,
    stuck: rows.map((r) => ({
      id: r.id,
      paymentId: r.paymentId,
      rentalId: r.rentalId,
      rentalNumber: r.rentalId ? (rentalOf.get(r.rentalId)?.number ?? null) : null,
      customer: r.rentalId ? (rentalOf.get(r.rentalId)?.customer.name ?? null) : null,
      why: r.state === 'refused' ? 'refused' : 'no_deal',
      httpStatus: r.httpStatus,
      createdAt: r.createdAt,
    })),
  };
}

/** For "Today": how many notes Kommo refused. Zero with the link off. */
export async function kommoNotesRefused(): Promise<number> {
  return kommoConfig() ? prisma.kommoNote.count({ where: { state: 'refused' } }) : 0;
}
